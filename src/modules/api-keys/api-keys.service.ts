import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, ApiKeyEntity } from '../../database/store';
import { SecurityUtils } from '../../common/utils/security.utils';
import { AuditAction, EnvironmentType } from '../../common/enums';
import { API_KEY_SCOPES, API_KEY_SCOPE_PRESETS, CreateApiKeyDto } from './dto/api-key.dto';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import { SystemEmailDispatchService } from '../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import { NotificationsService } from '../notifications/notifications.service';
import { getAppConfig } from '../../config/app.config';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly emailDispatch?: SystemEmailDispatchService,
    private readonly notificationsService?: NotificationsService,
  ) { }

  private async notifyApiKeyEvent(
    templateKey: SystemTemplateKey,
    userId: string,
    organizationId: string,
    keyName: string,
    environment: EnvironmentType,
    keyPrefix: string,
  ) {
    const user = dbStore.users.find((u) => u.id === userId);
    if (!user?.email) return;

    const environmentLabel = environment === EnvironmentType.TEST ? 'Test / Sandbox' : 'Live / Production';
    const isRevoked = templateKey === SystemTemplateKey.SECURITY_API_KEY_REVOKED;

    await this.emailDispatch?.send(
      templateKey,
      user.email,
      {
        // Flat field names — these match the email-design template's own variables
        // (keyName/environment/maskedKey/createdBy/revokedBy), since the resolver renders
        // the actual seeded email-design template, not a generic dot-path fallback body.
        user: { firstName: user.firstName },
        keyName,
        environment: environmentLabel,
        maskedKey: `${keyPrefix}••••••••••••••••`,
        createdBy: user.email,
        revokedBy: user.email,
        createdDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        revokedDate: new Date().toUTCString(),
        manageKeysUrl: `${getAppConfig().frontendUrl.replace(/\/$/, '')}/organizations/${organizationId}/settings?tab=apikeys`,
      },
      { organizationId, userId },
    );

    this.notificationsService?.createNotification({
      userId,
      organizationId,
      type: 'security',
      title: isRevoked ? 'API key revoked' : 'API key created',
      body: isRevoked ? `API key "${keyName}" was revoked.` : `API key "${keyName}" was created.`,
      channel: 'in_app',
      priority: 'normal',
      actionUrl: `/organizations/${organizationId}/settings?tab=apikeys`,
    }).catch(() => undefined);
  }

  async create(organizationId: string, createdByUserId: string, dto: CreateApiKeyDto, requestedEnvironment?: EnvironmentType) {
    const environment = requestedEnvironment || EnvironmentUtils.normalizeEnvironment(dto.environment || 'LIVE');
    const keyEnvironment = environment === EnvironmentType.TEST ? 'test' : 'live';
    const requestedScopes = dto.scopes?.length
      ? dto.scopes
      : dto.preset
        ? [...API_KEY_SCOPE_PRESETS[dto.preset]]
        : [...API_KEY_SCOPE_PRESETS.CONVERSION_TRACKING];
    const invalidScope = requestedScopes.find((scope) => !(API_KEY_SCOPES as readonly string[]).includes(scope));
    if (invalidScope) {
      throw new BadRequestException(`Unsupported API key scope: ${invalidScope}`);
    }

    const { key, prefix, hash } = SecurityUtils.generateApiKey(keyEnvironment);

    const apiKey: ApiKeyEntity = {
      id: uuidv4(),
      organizationId,
      environment,
      name: dto.name,
      prefix,
      keyHash: hash,
      scopes: requestedScopes,
      status: 'ACTIVE',
      createdBy: createdByUserId,
      createdAt: new Date(),
    };

    dbStore.apiKeys.push(apiKey);

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: createdByUserId,
      action: AuditAction.API_KEY_CREATED,
      resourceType: 'api_key',
      resourceId: apiKey.id,
      createdAt: new Date(),
    });

    this.notifyApiKeyEvent(SystemTemplateKey.SECURITY_API_KEY_CREATED, createdByUserId, organizationId, apiKey.name, environment, apiKey.prefix).catch(() => undefined);

    // RETURN RAW KEY ONLY ONCE ON CREATION
    return {
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      key,
      maskedKey: SecurityUtils.maskCredential(key),
      environment,
      scopes: apiKey.scopes,
      createdAt: apiKey.createdAt,
      warning: 'Save this API key immediately. You will not be able to see it again.',
    };
  }

  async findAll(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    return dbStore.apiKeys
      .filter((k) =>
        k.organizationId === organizationId &&
        EnvironmentUtils.normalizeEnvironment((k as any).environment || ((k.prefix || '').includes('_test_') ? 'TEST' : 'LIVE')) === environment,
      )
      .map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        environment: EnvironmentUtils.normalizeEnvironment((k as any).environment || (k.prefix.includes('_test_') ? 'TEST' : 'LIVE')) === EnvironmentType.TEST ? 'test' : 'live',
        scopes: k.scopes,
        status: (k as any).status || (k.revokedAt ? 'REVOKED' : 'ACTIVE'),
        lastUsedAt: k.lastUsedAt,
        lastUsedIpHash: (k as any).lastUsedIpHash,
        revokedAt: k.revokedAt,
        createdAt: k.createdAt,
      }));
  }

  async revoke(organizationId: string, apiKeyId: string, userId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    const apiKey = dbStore.apiKeys.find(
      (k) =>
        k.id === apiKeyId &&
        k.organizationId === organizationId &&
        EnvironmentUtils.normalizeEnvironment((k as any).environment || ((k.prefix || '').includes('_test_') ? 'TEST' : 'LIVE')) === environment,
    );

    if (!apiKey) {
      throw new NotFoundException('API Key not found');
    }

    apiKey.revokedAt = new Date();
    (apiKey as any).status = 'REVOKED';

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: AuditAction.API_KEY_REVOKED,
      resourceType: 'api_key',
      resourceId: apiKey.id,
      createdAt: new Date(),
    });

    this.notifyApiKeyEvent(SystemTemplateKey.SECURITY_API_KEY_REVOKED, userId, organizationId, apiKey.name, environment, apiKey.prefix).catch(() => undefined);

    return { success: true, message: 'API key revoked successfully' };
  }
}
