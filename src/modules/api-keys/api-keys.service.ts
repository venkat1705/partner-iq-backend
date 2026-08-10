import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, ApiKeyEntity } from '../../database/store';
import { SecurityUtils } from '../../common/utils/security.utils';
import { AuditAction } from '../../common/enums';
import { CreateApiKeyDto } from './dto/api-key.dto';

@Injectable()
export class ApiKeysService {
  async create(organizationId: string, createdByUserId: string, dto: CreateApiKeyDto) {
    const environment = dto.environment || 'live';
    const { key, prefix, hash } = SecurityUtils.generateApiKey(environment);

    const apiKey: ApiKeyEntity = {
      id: uuidv4(),
      organizationId,
      name: dto.name,
      prefix,
      keyHash: hash,
      scopes: dto.scopes,
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

    // RETURN RAW KEY ONLY ONCE ON CREATION
    return {
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      key, // Raw unhashed secret key
      scopes: apiKey.scopes,
      createdAt: apiKey.createdAt,
      warning: 'Save this API key immediately. You will not be able to see it again.',
    };
  }

  async findAll(organizationId: string) {
    return dbStore.apiKeys
      .filter((k) => k.organizationId === organizationId)
      .map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        lastUsedAt: k.lastUsedAt,
        revokedAt: k.revokedAt,
        createdAt: k.createdAt,
      }));
  }

  async revoke(organizationId: string, apiKeyId: string, userId: string) {
    const apiKey = dbStore.apiKeys.find(
      (k) => k.id === apiKeyId && k.organizationId === organizationId,
    );

    if (!apiKey) {
      throw new NotFoundException('API Key not found');
    }

    apiKey.revokedAt = new Date();

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

    return { success: true, message: 'API key revoked successfully' };
  }
}
