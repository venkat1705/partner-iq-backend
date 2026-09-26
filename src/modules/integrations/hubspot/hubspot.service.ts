import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, awaitPersist } from '../../../database/store';
import {
  CrmHealthStatus,
  IntegrationEnvironment,
  IntegrationEventStatus,
  IntegrationStatus,
  OrganizationIntegrationStatus,
  PartnerDealStatus,
  PlatformRole,
} from '../../../common/enums';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import { IntegrationCredentialService } from '../integration-credential.service';
import { HubSpotApiClient } from './hubspot-api.client';
import { HubSpotTokenService } from './hubspot-token.service';
import {
  HUBSPOT_CUSTOM_DEAL_PROPERTIES,
  HUBSPOT_DEFAULT_FIELD_MAPPINGS,
  HUBSPOT_PROVIDER,
  HUBSPOT_REQUIRED_SCOPES,
} from './hubspot.constants';
import {
  UpdateHubSpotFieldMappingsDto,
  UpdateHubSpotPipelineMappingDto,
  UpdateHubSpotSyncSettingsDto,
  UpsertHubSpotPlatformConfigDto,
} from './dto/hubspot.dto';

export const DEFAULT_HUBSPOT_SYNC_SETTINGS = {
  syncDirection: 'bidirectional' as const,
  autoConvertOnWon: true,
  autoCreateDealInCrm: true,
  tagPartnerAttribution: true,
};

@Injectable()
export class HubSpotService {
  constructor(
    private readonly credentials: IntegrationCredentialService,
    private readonly tokenService: HubSpotTokenService,
    private readonly api: HubSpotApiClient,
  ) { }

  getPlatformConfig(user: AuthUserPayload) {
    this.assertSuperAdmin(user);
    const config = this.platformConfig();
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const defaultRedirectUri = `${appUrl}/api/v1/integrations/hubspot/oauth/callback`;

    if (!config) {
      return {
        configured: false,
        provider: HUBSPOT_PROVIDER,
        slug: 'hubspot',
        name: 'HubSpot',
        redirectUri: defaultRedirectUri,
        requiredScopes: HUBSPOT_REQUIRED_SCOPES,
        optionalScopes: [],
        environment: 'LIVE',
      };
    }

    return {
      configured: Boolean(this.safeSecret(config.id, 'client_id') && (config.secretReferenceId || this.safeSecret(config.id, 'client_secret'))),
      provider: config.provider,
      slug: 'hubspot',
      name: 'HubSpot',
      status: config.status,
      redirectUri: config.redirectUri || defaultRedirectUri,
      requiredScopes: config.requiredScopes,
      optionalScopes: config.optionalScopes || [],
      appId: config.appId,
      environment: config.environment,
      clientIdMasked: this.mask(this.safeSecret(config.id, 'client_id')),
      clientSecretMasked: config.clientSecretLast4 ? `••••••••••••${config.clientSecretLast4}` : undefined,
      updatedAt: config.updatedAt,
    };
  }

  // NOTE: kept synchronous (not awaiting the credential/config persistence) — several
  // out-of-scope test callers (src/tests/integrations-admin-oauth.test.ts,
  // src/tests/razorpay-oauth.test.ts) invoke this without `await` and read the return value
  // synchronously. Making this `async` would turn the return into a Promise for them and break
  // those tests; see report for details.
  upsertPlatformConfig(user: AuthUserPayload, dto: UpsertHubSpotPlatformConfigDto) {
    this.assertSuperAdmin(user);
    const existing = this.platformConfig();
    const hasStoredClientId = Boolean(existing && this.safeSecret(existing.id, 'client_id'));
    if (!hasStoredClientId && !dto.clientId?.trim()) {
      throw new BadRequestException('Client ID is required for initial configuration');
    }
    if (!existing?.secretReferenceId && !dto.clientSecret?.trim()) {
      throw new BadRequestException('Client Secret is required for initial configuration');
    }
    const config = {
      ...(existing || { id: uuidv4(), provider: HUBSPOT_PROVIDER, createdAt: new Date() }),
      status: IntegrationStatus.ACTIVE,
      redirectUri: dto.redirectUri || existing?.redirectUri,
      requiredScopes: dto.requiredScopes?.length ? dto.requiredScopes : (existing?.requiredScopes || HUBSPOT_REQUIRED_SCOPES),
      optionalScopes: dto.optionalScopes || existing?.optionalScopes || [],
      appId: dto.appId !== undefined ? dto.appId : existing?.appId,
      environment: dto.environment || existing?.environment || IntegrationEnvironment.LIVE,
      updatedBy: user.userId,
      updatedAt: new Date(),
      secretReferenceId: existing?.secretReferenceId,
      clientSecretLast4: existing?.clientSecretLast4,
    };
    if (!config.redirectUri) {
      throw new BadRequestException('Redirect URI is required for initial configuration');
    }
    if (dto.clientId?.trim()) {
      this.credentials.storeCredential(config.id, 'client_id', dto.clientId.trim());
    }
    if (dto.clientSecret) {
      this.credentials.storeCredential(config.id, 'client_secret', dto.clientSecret);
      config.secretReferenceId = config.id;
      config.clientSecretLast4 = dto.clientSecret.slice(-4);
    }
    if (dto.webhookSecret) {
      this.credentials.storeCredential(config.id, 'webhook_secret', dto.webhookSecret);
    }
    if (existing) Object.assign(existing, config);
    else dbStore.integrationPlatformConfigs.push(config);
    this.audit(undefined, user.userId, 'HUBSPOT_PLATFORM_CONFIG_UPDATED', config.id, { redirectUri: dto.redirectUri, scopes: config.requiredScopes });
    return this.getPlatformConfig(user);
  }

  async testPlatformConfig(user: AuthUserPayload) {
    this.assertSuperAdmin(user);
    const config = this.requirePlatformConfig();
    const configured = Boolean(this.safeSecret(config.id, 'client_id') && this.safeSecret(config.id, 'client_secret'));
    return {
      provider: HUBSPOT_PROVIDER,
      configured,
      status: configured ? CrmHealthStatus.HEALTHY : CrmHealthStatus.UNHEALTHY,
      redirectUri: config.redirectUri,
      requiredScopes: config.requiredScopes,
      message: configured ? 'HubSpot OAuth app credentials are present.' : 'Client ID and Client Secret are required.',
      lastCheckedAt: new Date(),
    };
  }

  listOrganizationIntegrations(organizationId: string) {
    return [this.getOrganizationHubSpot(organizationId)];
  }

  getOrganizationHubSpot(organizationId: string) {
    const integration = this.requireIntegration();
    const connection = this.findConnection(organizationId);
    const config = connection?.config || {};
    return {
      provider: HUBSPOT_PROVIDER,
      name: 'HubSpot CRM',
      organizationId,
      connected: connection?.status === OrganizationIntegrationStatus.CONNECTED || connection?.status === OrganizationIntegrationStatus.DEGRADED,
      status: connection?.status || OrganizationIntegrationStatus.NOT_CONNECTED,
      publicId: connection?.publicId,
      externalAccountId: config.externalAccountId,
      externalAccountName: config.externalAccountName,
      grantedScopes: config.grantedScopes || [],
      health: {
        overall: config.lastHealthStatus || CrmHealthStatus.UNKNOWN,
        checks: config.healthChecks || {},
        lastCheckedAt: config.lastHealthCheckAt,
        lastErrorCode: config.lastHealthErrorCode,
      },
      lastSuccessfulSyncAt: config.lastSuccessfulSyncAt,
      syncSettings: { ...DEFAULT_HUBSPOT_SYNC_SETTINGS, ...(config.syncSettings || {}) },
      lastFailedSyncAt: config.lastFailedSyncAt,
      lastWebhookAt: connection?.lastWebhookAt,
      integrationId: integration.id,
    };
  }

  connectUrl(organizationId: string, user: AuthUserPayload, redirectUrl?: string) {
    const config = this.requirePlatformConfig();
    const integration = this.requireIntegration();
    const clientId = this.credentials.getCredential(config.id, 'client_id');
    const state = `hs_${randomBytes(32).toString('hex')}`;
    dbStore.integrationOAuthStates.push({
      id: uuidv4(),
      organizationId,
      integrationId: integration.id,
      userId: user.userId,
      state,
      nonce: randomBytes(16).toString('hex'),
      redirectUrl,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      createdAt: new Date(),
    });
    const url = new URL('https://app.hubspot.com/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('scope', config.requiredScopes.join(' '));
    if (config.optionalScopes?.length) url.searchParams.set('optional_scope', config.optionalScopes.join(' '));
    url.searchParams.set('state', state);
    return { provider: HUBSPOT_PROVIDER, authorizationUrl: url.toString(), expiresAt: new Date(Date.now() + 10 * 60 * 1000) };
  }

  async oauthCallback(code: string, stateValue: string) {
    const state = dbStore.integrationOAuthStates.find((item) => item.state === stateValue);
    if (!state || state.consumedAt || state.expiresAt < new Date()) throw new ForbiddenException('Invalid or expired HubSpot OAuth state');
    state.consumedAt = new Date();
    await awaitPersist(state);

    const config = this.requirePlatformConfig();
    const integration = this.requireIntegration();
    let connection = this.findConnection(state.organizationId);
    if (!connection) {
      connection = {
        id: uuidv4(),
        organizationId: state.organizationId,
        integrationId: integration.id,
        publicId: `hs_${randomBytes(12).toString('hex')}`,
        status: OrganizationIntegrationStatus.CONNECTING,
        environment: config.environment,
        config: {},
        createdBy: state.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.organizationIntegrations.push(connection);
    }

    connection.status = OrganizationIntegrationStatus.CONNECTING;
    connection.environment = config.environment;
    connection.lastError = undefined;
    connection.config = {
      ...(connection.config || {}),
      disconnectedAt: undefined,
    };
    connection.updatedAt = new Date();

    const token = await this.tokenService.exchangeAuthorizationCode(connection.id, code, {
      clientId: this.credentials.getCredential(config.id, 'client_id'),
      clientSecret: this.credentials.getCredential(config.id, 'client_secret'),
      redirectUri: config.redirectUri,
    });
    const accessToken = this.credentials.getCredential(connection.id, 'access_token');
    const tokenInfo = await this.api.accessTokenInfo(accessToken);
    connection.config = {
      ...(connection.config || {}),
      externalAccountId: String(tokenInfo.hub_id || token.hub_id || token.hubId || ''),
      externalAccountName: tokenInfo.hub_domain || tokenInfo.user || `HubSpot ${tokenInfo.hub_id || ''}`.trim(),
      grantedScopes: tokenInfo.scopes || token.scopes || String(token.scope || '').split(/\s+/).filter(Boolean),
    };
    connection.connectedAt = new Date();
    await awaitPersist(connection);
    await this.ensureDefaultFieldMappings(connection.id, connection.organizationId);
    const health = await this.testConnection(connection.organizationId);
    this.audit(connection.organizationId, state.userId || 'system', 'HUBSPOT_CONNECTED', connection.id, { externalAccountId: connection.config.externalAccountId, health: health.status });
    return { redirectUrl: state.redirectUrl, connection: this.getOrganizationHubSpot(connection.organizationId) };
  }

  async testConnection(organizationId: string) {
    const connection = this.requireConnection(organizationId);
    const config = this.requirePlatformConfig();
    const checks: Record<string, { status: CrmHealthStatus; message?: string }> = {};
    const granted = new Set<string>(connection.config?.grantedScopes || []);
    const missingScopes = config.requiredScopes.filter((scope) => !granted.has(scope));
    let account: any = null;
    let pipelines: any[] = [];

    try {
      const token = await this.tokenService.getAccessToken(connection.id);
      await this.api.accessTokenInfo(token);
      checks.authentication = { status: CrmHealthStatus.HEALTHY };
    } catch (err) {
      checks.authentication = { status: CrmHealthStatus.UNHEALTHY, message: this.errorMessage(err, 'Reconnect HubSpot to restore authentication.') };
    }

    try {
      account = await this.api.get(connection.id, '/integrations/v1/me');
      checks.account = { status: CrmHealthStatus.HEALTHY };
    } catch (err) {
      checks.account = { status: CrmHealthStatus.DEGRADED, message: this.errorMessage(err, 'Account metadata could not be read.') };
    }

    try {
      const response = await this.api.get(connection.id, '/crm/v3/pipelines/deals');
      pipelines = response.results || [];
      checks.pipelines = { status: CrmHealthStatus.HEALTHY };
    } catch (err) {
      checks.pipelines = { status: CrmHealthStatus.UNHEALTHY, message: this.errorMessage(err, 'Deal pipelines are not readable.') };
    }

    const missingCriticalScopes = missingScopes.filter((scope) => scope !== 'oauth');
    checks.permissions = missingCriticalScopes.length
      ? { status: CrmHealthStatus.DEGRADED, message: `Missing scopes: ${missingCriticalScopes.join(', ')}` }
      : { status: CrmHealthStatus.HEALTHY };

    const authenticationFailed = checks.authentication?.status === CrmHealthStatus.UNHEALTHY;
    const status = authenticationFailed
      ? CrmHealthStatus.UNHEALTHY
      : Object.values(checks).some((item) => item.status === CrmHealthStatus.DEGRADED || item.status === CrmHealthStatus.UNHEALTHY)
        ? CrmHealthStatus.DEGRADED
        : CrmHealthStatus.HEALTHY;

    connection.status = status === CrmHealthStatus.HEALTHY ? OrganizationIntegrationStatus.CONNECTED :
      status === CrmHealthStatus.DEGRADED ? OrganizationIntegrationStatus.DEGRADED :
        OrganizationIntegrationStatus.AUTHENTICATION_ERROR;
    connection.config = {
      ...(connection.config || {}),
      externalAccountId: String(account?.portalId || account?.hubId || connection.config?.externalAccountId || ''),
      externalAccountName: account?.accountName || account?.hubDomain || connection.config?.externalAccountName,
      lastHealthStatus: status,
      lastHealthCheckAt: new Date(),
      lastHealthErrorCode: status === CrmHealthStatus.HEALTHY ? undefined : 'HUBSPOT_HEALTH_CHECK_FAILED',
      healthChecks: checks,
      pipelineCount: pipelines.length,
    };
    connection.lastError = status === CrmHealthStatus.HEALTHY ? undefined : 'HubSpot connection needs attention.';
    connection.lastSyncAt = status === CrmHealthStatus.HEALTHY ? new Date() : connection.lastSyncAt;
    await awaitPersist(connection);
    this.syncLog(connection, 'connection_test', 'CONNECTION', 'HEALTH', status === CrmHealthStatus.UNHEALTHY ? 'FAILED' : 'SUCCEEDED', { missingScopes: missingCriticalScopes });
    return {
      provider: HUBSPOT_PROVIDER,
      status,
      connected: status !== CrmHealthStatus.UNHEALTHY,
      authentication: checks.authentication,
      permissions: {
        deals: granted.has('crm.objects.deals.read') && granted.has('crm.objects.deals.write'),
        contacts: granted.has('crm.objects.contacts.read') && granted.has('crm.objects.contacts.write'),
        companies: granted.has('crm.objects.companies.read') && granted.has('crm.objects.companies.write'),
        pipelines: checks.pipelines?.status === CrmHealthStatus.HEALTHY,
        missingScopes: missingCriticalScopes,
      },
      account: {
        externalAccountId: connection.config.externalAccountId,
        name: connection.config.externalAccountName,
      },
      checks,
      lastCheckedAt: connection.config.lastHealthCheckAt,
    };
  }

  async getPipelines(organizationId: string) {
    const connection = this.requireConnection(organizationId);
    const response = await this.api.get(connection.id, '/crm/v3/pipelines/deals');
    return response.results || [];
  }

  async getPipelineStages(organizationId: string, pipelineId: string) {
    const connection = this.requireConnection(organizationId);
    const response = await this.api.get(connection.id, `/crm/v3/pipelines/deals/${encodeURIComponent(pipelineId)}/stages`);
    return response.results || [];
  }

  getPipelineMapping(organizationId: string, pipelineId?: string) {
    const connection = this.requireConnection(organizationId);
    return dbStore.crmPipelineMappings.find(
      (item) => item.organizationIntegrationId === connection.id && item.isActive && (!pipelineId || item.externalPipelineId === pipelineId),
    ) || null;
  }

  async updatePipelineMapping(organizationId: string, dto: UpdateHubSpotPipelineMappingDto) {
    const connection = this.requireConnection(organizationId);
    const existing = dbStore.crmPipelineMappings.find((item) => item.organizationIntegrationId === connection.id && item.externalPipelineId === dto.externalPipelineId);
    const mapping = {
      ...(existing || { id: uuidv4(), createdAt: new Date() }),
      organizationId,
      organizationIntegrationId: connection.id,
      provider: HUBSPOT_PROVIDER,
      externalPipelineId: dto.externalPipelineId,
      externalPipelineLabel: dto.externalPipelineLabel,
      stageMappings: dto.stageMappings as Record<string, PartnerDealStatus>,
      closedWonStageId: dto.closedWonStageId,
      closedLostStageId: dto.closedLostStageId,
      isActive: true,
      updatedAt: new Date(),
    };
    if (existing) {
      Object.assign(existing, mapping);
      await awaitPersist(existing);
    } else {
      dbStore.crmPipelineMappings.push(mapping);
      await awaitPersist(mapping);
    }
    this.audit(organizationId, 'system', 'HUBSPOT_PIPELINE_MAPPING_CHANGED', mapping.id, { externalPipelineId: dto.externalPipelineId });
    await this.ensureDealCustomProperties(connection.id);
    return mapping;
  }

  /**
   * PartnerIQ writes partneriq_* custom properties onto every deal it pushes to HubSpot
   * (see HUBSPOT_CUSTOM_DEAL_PROPERTIES / createHubSpotDeal). A fresh HubSpot portal has
   * none of these defined, so outbound sync fails with PROPERTY_DOESNT_EXIST until they
   * exist. Provisioning is idempotent (HubSpot 409s on an existing name, which we ignore).
   */
  async ensureDealCustomProperties(connectionId: string) {
    for (const name of HUBSPOT_CUSTOM_DEAL_PROPERTIES) {
      try {
        await this.api.post(connectionId, '/crm/v3/properties/deals', {
          name,
          label: name.replace(/^partneriq_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          type: 'string',
          fieldType: 'text',
          groupName: 'dealinformation',
        });
      } catch {
        // Already exists (409) or portal doesn't allow custom properties on this group — non-fatal.
      }
    }
  }

  async getFieldMappings(organizationId: string) {
    const connection = this.requireConnection(organizationId);
    await this.ensureDefaultFieldMappings(connection.id, organizationId);
    return dbStore.crmFieldMappings.filter((item) => item.organizationIntegrationId === connection.id);
  }

  async updateFieldMappings(organizationId: string, dto: UpdateHubSpotFieldMappingsDto) {
    const connection = this.requireConnection(organizationId);
    const pending: Promise<unknown>[] = [];
    for (const item of dto.mappings || []) {
      const existing = dbStore.crmFieldMappings.find((mapping) => mapping.organizationIntegrationId === connection.id && mapping.partnerIqField === item.partnerIqField);
      const next = {
        ...(existing || { id: uuidv4(), createdAt: new Date() }),
        organizationId,
        organizationIntegrationId: connection.id,
        partnerIqField: item.partnerIqField,
        externalField: item.externalField,
        required: Boolean(item.required),
        updatedAt: new Date(),
      };
      if (existing) {
        Object.assign(existing, next);
        pending.push(awaitPersist(existing));
      } else {
        dbStore.crmFieldMappings.push(next);
        pending.push(awaitPersist(next));
      }
    }
    await Promise.all(pending);
    this.audit(organizationId, 'system', 'HUBSPOT_FIELD_MAPPING_CHANGED', connection.id, {});
    return this.getFieldMappings(organizationId);
  }

  async disconnect(organizationId: string, user: AuthUserPayload) {
    const connection = this.requireConnection(organizationId);
    connection.status = OrganizationIntegrationStatus.DISCONNECTED;
    connection.config = { ...(connection.config || {}), disconnectedAt: new Date() };
    connection.lastError = undefined;
    await awaitPersist(connection);
    this.audit(organizationId, user.userId, 'HUBSPOT_DISCONNECTED', connection.id, {});
    return this.getOrganizationHubSpot(organizationId);
  }

  getSyncSettings(organizationId: string) {
    const connection = this.requireConnection(organizationId);
    return { ...DEFAULT_HUBSPOT_SYNC_SETTINGS, ...(connection.config?.syncSettings || {}) };
  }

  async updateSyncSettings(organizationId: string, user: AuthUserPayload, dto: UpdateHubSpotSyncSettingsDto) {
    const connection = this.requireConnection(organizationId);
    const nextSettings = {
      ...DEFAULT_HUBSPOT_SYNC_SETTINGS,
      ...(connection.config?.syncSettings || {}),
      ...(dto.syncDirection !== undefined ? { syncDirection: dto.syncDirection } : {}),
      ...(dto.autoConvertOnWon !== undefined ? { autoConvertOnWon: dto.autoConvertOnWon } : {}),
      ...(dto.autoCreateDealInCrm !== undefined ? { autoCreateDealInCrm: dto.autoCreateDealInCrm } : {}),
      ...(dto.tagPartnerAttribution !== undefined ? { tagPartnerAttribution: dto.tagPartnerAttribution } : {}),
    };
    connection.config = { ...(connection.config || {}), syncSettings: nextSettings };
    await awaitPersist(connection);
    this.audit(organizationId, user.userId, 'HUBSPOT_SYNC_SETTINGS_CHANGED', connection.id, nextSettings);
    return nextSettings;
  }

  syncLogs(organizationId: string) {
    const connection = this.requireConnection(organizationId);
    return dbStore.integrationSyncLogs
      .filter((item) => item.organizationIntegrationId === connection.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 100);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined, secret: string | undefined) {
    if (!secret || !signature) return false;
    const digest = createHash('sha256').update(rawBody).update(secret).digest('hex');
    const left = Buffer.from(digest);
    const right = Buffer.from(signature);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  syncLog(connection: any, operation: string, entityType: string, direction: 'INBOUND' | 'OUTBOUND' | 'HEALTH', status: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'RETRYING' | 'IGNORED', metadata?: Record<string, unknown>, entityId?: string, externalEntityId?: string) {
    dbStore.integrationSyncLogs.push({
      id: uuidv4(),
      organizationId: connection.organizationId,
      organizationIntegrationId: connection.id,
      provider: HUBSPOT_PROVIDER,
      operation,
      entityType,
      entityId,
      externalEntityId,
      direction,
      status,
      attempt: Number(metadata?.attempt || 1),
      durationMs: metadata?.durationMs as number | undefined,
      errorCode: metadata?.errorCode as string | undefined,
      errorMessage: metadata?.errorMessage as string | undefined,
      metadata,
      createdAt: new Date(),
    });
  }

  requireConnection(organizationId: string) {
    const connection = this.findConnection(organizationId);
    if (!connection || connection.status === OrganizationIntegrationStatus.DISCONNECTED) throw new NotFoundException('HubSpot is not connected');
    return connection;
  }

  requireIntegration() {
    const integration = dbStore.integrations.find((item) => item.code === HUBSPOT_PROVIDER);
    if (!integration) throw new NotFoundException('HubSpot integration is not available');
    return integration;
  }

  private findConnection(organizationId: string) {
    const integration = this.requireIntegration();
    return dbStore.organizationIntegrations.find((item) => item.organizationId === organizationId && item.integrationId === integration.id);
  }

  private platformConfig() {
    return dbStore.integrationPlatformConfigs.find((item) => item.provider === HUBSPOT_PROVIDER);
  }

  private requirePlatformConfig() {
    const config = this.platformConfig();
    if (!config) throw new BadRequestException('Platform HubSpot OAuth credentials are not configured');
    return config;
  }

  private async ensureDefaultFieldMappings(connectionId: string, organizationId: string) {
    const pending: Promise<unknown>[] = [];
    for (const [partnerIqField, externalField, required] of HUBSPOT_DEFAULT_FIELD_MAPPINGS) {
      if (!dbStore.crmFieldMappings.some((item) => item.organizationIntegrationId === connectionId && item.partnerIqField === partnerIqField)) {
        const mapping = {
          id: uuidv4(),
          organizationId,
          organizationIntegrationId: connectionId,
          partnerIqField,
          externalField,
          required,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        dbStore.crmFieldMappings.push(mapping);
        pending.push(awaitPersist(mapping));
      }
    }
    await Promise.all(pending);
  }

  private audit(organizationId: string | undefined, actorId: string, action: string, resourceId: string, metadata?: Record<string, unknown>) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: action as any,
      resourceType: 'hubspot_integration',
      resourceId,
      metadata,
      createdAt: new Date(),
    });
  }

  private assertSuperAdmin(user: AuthUserPayload) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }
  }

  private safeSecret(referenceId: string, key: string) {
    try {
      return this.credentials.getCredential(referenceId, key);
    } catch {
      return undefined;
    }
  }

  private errorMessage(err: unknown, fallback: string) {
    if (err instanceof BadRequestException) {
      const response = err.getResponse();
      if (typeof response === 'string') return response;
      if (typeof response === 'object' && response && 'message' in response) {
        const message = (response as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message;
      }
    }
    if (err instanceof Error && err.message) return err.message;
    return fallback;
  }

  private mask(value?: string) {
    if (!value) return undefined;
    return value.length <= 6 ? '••••••' : `${value.slice(0, 3)}••••••${value.slice(-3)}`;
  }
}
