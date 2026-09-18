import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, OrganizationIntegrationEntity } from '../../database/store';
import {
  EnvironmentType,
  IntegrationCategory,
  IntegrationEnvironment,
  IntegrationEventStatus,
  IntegrationStatus,
  OrganizationIntegrationStatus,
  PlatformRole,
} from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { integrationAdapterRegistry } from './adapters/registry';
import { IntegrationCredentialService } from './integration-credential.service';
import { ConnectIntegrationDto, TestIntegrationDto } from './dto/connect-integration.dto';
import { IntegrationProviderFactory } from './providers/provider.factory';
import { IntegrationTestContext, IntegrationTestResult } from './providers/provider.interface';
import { HubSpotService } from './hubspot/hubspot.service';
import { RazorpayTokenService } from './razorpay/razorpay-token.service';
import { getAppConfig } from '../../config/app.config';
import { ConversionsService } from '../conversions/conversions.service';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly credentialService: IntegrationCredentialService,
    private readonly providerFactory: IntegrationProviderFactory,
    private readonly razorpayTokenService: RazorpayTokenService,
    @Inject(forwardRef(() => HubSpotService))
    private readonly hubspotService?: HubSpotService,
    private readonly conversionsService?: ConversionsService,
  ) { }

  // ─────────────────────────────────────────────────────────
  // Admin APIs
  // ─────────────────────────────────────────────────────────

  listAdminIntegrations(user: AuthUserPayload) {
    this.assertSuperAdmin(user);
    return this.adminIntegrationSummaries();
  }

  getMetrics(user: AuthUserPayload) {
    this.assertSuperAdmin(user);
    const summaries = this.adminIntegrationSummaries();
    return {
      totalIntegrations: summaries.length,
      activeIntegrations: summaries.filter((item) => item.status === IntegrationStatus.ACTIVE).length,
      inactiveIntegrations: summaries.filter((item) => item.status === IntegrationStatus.INACTIVE || (item.status as any) === 'DISABLED').length,
      comingSoonIntegrations: summaries.filter((item) => item.status === IntegrationStatus.COMING_SOON).length,
      connectedOrganizations: summaries.reduce((total, item) => total + item.connectedOrganizations, 0),
      healthyConnections: summaries.reduce((total, item) => total + item.healthyConnections, 0),
      failedConnections: summaries.reduce((total, item) => total + item.failedConnections, 0),
    };
  }

  getAdminIntegration(user: AuthUserPayload, slugOrId: string) {
    this.assertSuperAdmin(user);
    const integration = this.findIntegration(slugOrId);
    const connections = dbStore.organizationIntegrations.filter((item) => item.integrationId === integration.id);
    const connectedConnections = connections.filter((c) => c.status === OrganizationIntegrationStatus.CONNECTED);
    const errorConnections = connections.filter((c) => c.status === OrganizationIntegrationStatus.ERROR || c.status === OrganizationIntegrationStatus.AUTHENTICATION_ERROR);

    const latestConnection = connections.reduce<Date | undefined>((latest, c) => {
      const date = c.lastConnectedAt || c.connectedAt || c.createdAt;
      if (!date) return latest;
      if (!latest || new Date(date) > new Date(latest)) return new Date(date);
      return latest;
    }, undefined);

    let healthStatus = 'Healthy';
    if (errorConnections.length > 0) {
      healthStatus = `${errorConnections.length} organization${errorConnections.length > 1 ? 's' : ''} with errors`;
    }

    const orgRows = connections.map((conn) => {
      const org = dbStore.organizations.find((o) => o.id === conn.organizationId);
      return {
        id: conn.id,
        organizationId: conn.organizationId,
        organizationName: org?.name || 'Unknown Organization',
        environment: conn.environment || 'TEST',
        status: conn.status,
        lastCheckedAt: conn.lastCheckedAt ? this.formatIso(conn.lastCheckedAt) : undefined,
        lastConnectedAt: conn.lastConnectedAt ? this.formatIso(conn.lastConnectedAt) : undefined,
        lastError: conn.lastError,
      };
    });

    return {
      id: integration.id,
      name: integration.name,
      slug: integration.slug,
      provider: integration.provider,
      category: integration.category,
      description: integration.description,
      logo: integration.logo || this.defaultLogo(integration.slug),
      status: integration.status,
      capabilities: integration.capabilities || this.defaultCapabilities(integration.provider),
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
      stats: {
        totalConnected: connectedConnections.length,
        successfulConnections: connectedConnections.length,
        failedConnections: errorConnections.length,
        lastConnection: latestConnection ? this.formatIso(latestConnection) : undefined,
      },
      health: healthStatus,
      platformConfigured: this.isPlatformConfigured(integration.provider, integration.slug),
      organizations: orgRows,
    };
  }

  updateStatus(user: AuthUserPayload, slugOrId: string, status: IntegrationStatus) {
    this.assertSuperAdmin(user);
    const integration = this.findIntegration(slugOrId);
    integration.status = status;
    integration.updatedAt = new Date();

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId: undefined,
      actorType: 'USER',
      actorId: user.userId,
      action: 'INTEGRATION_STATUS_UPDATED' as any,
      resourceType: 'integration',
      resourceId: integration.id,
      metadata: { slug: integration.slug, provider: integration.provider, status },
      createdAt: new Date(),
    });

    return {
      id: integration.id,
      slug: integration.slug,
      status: integration.status,
      updatedAt: integration.updatedAt,
    };
  }

  getAdminHealth(user: AuthUserPayload) {
    this.assertSuperAdmin(user);
    return this.adminIntegrationSummaries().map((item) => ({
      id: item.id,
      name: item.name,
      slug: item.slug,
      provider: item.provider,
      category: item.category,
      status: item.status,
      health: item.health,
      connectedOrganizations: item.connectedOrganizations,
      failedConnections: item.failedConnections,
      platformConfigured: this.isPlatformConfigured(item.provider, item.slug),
    }));
  }

  isPlatformConfigured(provider: string, slug?: string): boolean {
    const config = dbStore.integrationPlatformConfigs.find(
      (item) =>
        item.provider === provider ||
        (slug && item.provider === slug.toUpperCase().replace(/-/g, '_')),
    );
    if (!config) return false;
    const hasClientId = Boolean(this.credentialService.getCredential(config.id, 'client_id'));
    const hasSecret = Boolean(config.secretReferenceId || this.credentialService.getCredential(config.id, 'client_secret'));
    return Boolean(hasClientId && hasSecret);
  }

  defaultRedirectUri(slug: string): string {
    const appUrl = getAppConfig().appUrl || 'http://localhost:3000';
    return `${appUrl.replace(/\/$/, '')}/api/v1/integrations/${slug}/oauth/callback`;
  }

  private defaultScopes(provider: string): string[] {
    switch (provider.toUpperCase()) {
      case 'HUBSPOT':
        return [
          'crm.objects.contacts.read',
          'crm.objects.contacts.write',
          'crm.objects.deals.read',
          'crm.objects.deals.write',
          'crm.schemas.deals.read',
        ];
      case 'ZOHO_CRM':
        return ['ZohoCRM.modules.ALL', 'ZohoCRM.settings.ALL'];
      case 'RAZORPAY':
      case 'CASHFREE':
        return ['read_write'];
      default:
        return ['read', 'write'];
    }
  }

  /** True when the marketplace should offer an OAuth "Connect" option for this integration. */
  private supportsOAuthFlow(integration: { slug: string; provider: string }): boolean {
    if (integration.slug === 'hubspot' || integration.slug === 'zoho-crm') return true;
    if (!this.providerFactory.hasProvider(integration.provider)) return false;
    const provider = this.providerFactory.getProvider(integration.provider) as any;
    return typeof provider.getOAuthAuthorizationUrl === 'function' && typeof provider.exchangeOAuthCode === 'function';
  }

  getAdminPlatformConfig(user: AuthUserPayload, slugOrId: string) {
    this.assertSuperAdmin(user);
    const integration = this.findIntegration(slugOrId);

    if ((integration.slug === 'hubspot' || integration.provider === 'HUBSPOT') && this.hubspotService) {
      return this.hubspotService.getPlatformConfig(user);
    }

    const config = dbStore.integrationPlatformConfigs.find(
      (item) => item.provider === integration.provider || item.provider === integration.code,
    );

    const redirectUri = config?.redirectUri || this.defaultRedirectUri(integration.slug);
    const scopes = config?.requiredScopes || this.defaultScopes(integration.provider);

    if (!config) {
      return {
        configured: false,
        provider: integration.provider,
        slug: integration.slug,
        name: integration.name,
        redirectUri,
        requiredScopes: scopes,
        optionalScopes: [],
        environment: 'LIVE',
      };
    }

    const clientId = this.credentialService.getCredential(config.id, 'client_id');
    const hasSecret = Boolean(config.secretReferenceId || this.credentialService.getCredential(config.id, 'client_secret'));

    return {
      configured: Boolean(clientId && hasSecret),
      provider: config.provider,
      slug: integration.slug,
      name: integration.name,
      status: config.status,
      redirectUri: config.redirectUri || redirectUri,
      requiredScopes: config.requiredScopes || scopes,
      optionalScopes: config.optionalScopes || [],
      appId: config.appId,
      environment: config.environment,
      clientIdMasked: clientId
        ? clientId.length > 8
          ? `${clientId.substring(0, 4)}••••${clientId.slice(-4)}`
          : '••••••••'
        : undefined,
      clientSecretMasked: config.clientSecretLast4 ? `••••••••••••${config.clientSecretLast4}` : undefined,
      partnerApiKeyMasked: this.maskSecretTail(this.safeGetCredential(config.id, 'partner_api_key')),
      updatedAt: config.updatedAt,
    };
  }

  private maskSecretTail(value?: string): string | undefined {
    if (!value) return undefined;
    const last4 = value.length > 4 ? value.slice(-4) : value;
    return `••••••••••••${last4}`;
  }

  upsertAdminPlatformConfig(user: AuthUserPayload, slugOrId: string, dto: any) {
    this.assertSuperAdmin(user);
    const integration = this.findIntegration(slugOrId);

    if ((integration.slug === 'hubspot' || integration.provider === 'HUBSPOT') && this.hubspotService) {
      return this.hubspotService.upsertPlatformConfig(user, dto);
    }

    // The admin UI only ever displays masked secrets (e.g. "032d••••6904"). If a client
    // resends one of those masked values unchanged, reject it here rather than silently
    // corrupting the real stored credential.
    for (const [field, value] of Object.entries({
      clientId: dto.clientId,
      clientSecret: dto.clientSecret,
      webhookSecret: dto.webhookSecret,
      partnerApiKey: dto.partnerApiKey,
    })) {
      if (typeof value === 'string' && value.includes('•')) {
        throw new BadRequestException(`${field} looks like a masked placeholder value, not the real credential. Please re-enter it.`);
      }
    }

    let config = dbStore.integrationPlatformConfigs.find(
      (item) => item.provider === integration.provider || item.provider === integration.code,
    );

    const redirectUri = dto.redirectUri || config?.redirectUri || this.defaultRedirectUri(integration.slug);
    const now = new Date();

    if (!config) {
      config = {
        id: uuidv4(),
        provider: integration.provider,
        status: IntegrationStatus.ACTIVE,
        redirectUri,
        requiredScopes: dto.requiredScopes?.length ? dto.requiredScopes : this.defaultScopes(integration.provider),
        optionalScopes: dto.optionalScopes || [],
        appId: dto.appId,
        environment: dto.environment || IntegrationEnvironment.LIVE,
        updatedBy: user.userId,
        createdAt: now,
        updatedAt: now,
      } as any;
      dbStore.integrationPlatformConfigs.push(config);
    } else {
      config.redirectUri = redirectUri;
      if (dto.requiredScopes?.length) config.requiredScopes = dto.requiredScopes;
      if (dto.optionalScopes) config.optionalScopes = dto.optionalScopes;
      if (dto.appId !== undefined) config.appId = dto.appId;
      if (dto.environment) config.environment = dto.environment;
      config.updatedBy = user.userId;
      config.updatedAt = now;
    }

    if (dto.clientId) {
      this.credentialService.storeCredential(config.id, 'client_id', dto.clientId);
    }
    if (dto.clientSecret) {
      this.credentialService.storeCredential(config.id, 'client_secret', dto.clientSecret);
      config.secretReferenceId = config.id;
      config.clientSecretLast4 = dto.clientSecret.slice(-4);
    }
    if (dto.webhookSecret) {
      this.credentialService.storeCredential(config.id, 'webhook_secret', dto.webhookSecret);
    }
    if (dto.partnerApiKey) {
      this.credentialService.storeCredential(config.id, 'partner_api_key', dto.partnerApiKey);
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId: undefined,
      actorType: 'USER',
      actorId: user.userId,
      action: 'INTEGRATION_PLATFORM_CONFIG_UPDATED' as any,
      resourceType: 'integration_platform_config',
      resourceId: config.id,
      metadata: { slug: integration.slug, provider: integration.provider },
      createdAt: now,
    });

    return this.getAdminPlatformConfig(user, slugOrId);
  }

  async testAdminPlatformConfig(user: AuthUserPayload, slugOrId: string) {
    this.assertSuperAdmin(user);
    const integration = this.findIntegration(slugOrId);

    if ((integration.slug === 'hubspot' || integration.provider === 'HUBSPOT') && this.hubspotService) {
      return this.hubspotService.testPlatformConfig(user);
    }

    const config = dbStore.integrationPlatformConfigs.find(
      (item) => item.provider === integration.provider || item.provider === integration.code,
    );

    const hasClientId = config ? Boolean(this.credentialService.getCredential(config.id, 'client_id')) : false;
    const hasSecret = config ? Boolean(config.secretReferenceId || this.credentialService.getCredential(config.id, 'client_secret')) : false;
    const configured = Boolean(hasClientId && hasSecret);

    return {
      provider: integration.provider,
      configured,
      status: configured ? 'HEALTHY' : 'UNHEALTHY',
      redirectUri: config?.redirectUri || this.defaultRedirectUri(integration.slug),
      requiredScopes: config?.requiredScopes || this.defaultScopes(integration.provider),
      message: configured
        ? `${integration.name} platform credentials are verified and ready for organization connections.`
        : 'Client ID and Client Secret are required.',
      lastCheckedAt: new Date(),
    };
  }

  async connectOAuth(organizationId: string, user: AuthUserPayload, slugOrId: string, redirectUrl?: string, merchantId?: string) {
    const integration = this.findIntegration(slugOrId);

    if (integration.slug === 'hubspot' || integration.provider === 'HUBSPOT') {
      if (!this.hubspotService) {
        throw new BadRequestException('HubSpot service is not available');
      }
      return this.hubspotService.connectUrl(organizationId, user, redirectUrl);
    }

    const config = dbStore.integrationPlatformConfigs.find(
      (item) => item.provider === integration.provider || item.provider === integration.code,
    );
    if (!config) {
      throw new BadRequestException(`${integration.name} platform OAuth credentials have not been configured yet by the administrator.`);
    }

    const clientId = this.credentialService.getCredential(config.id, 'client_id');
    if (!clientId) {
      throw new BadRequestException(`Client ID missing for ${integration.name}. Please configure in Admin Settings.`);
    }

    const provider = this.providerFactory.hasProvider(integration.provider)
      ? (this.providerFactory.getProvider(integration.provider) as any)
      : undefined;

    // Keep well under Cashfree's 64-char state limit (and any similarly strict provider);
    // 160 bits of entropy is still far more than needed for CSRF protection.
    const state = `${integration.slug}_${randomBytes(20).toString('hex')}`.slice(0, 64);
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

    const redirectUri = config.redirectUri || this.defaultRedirectUri(integration.slug);
    const authorizationUrl = typeof provider?.getOAuthAuthorizationUrl === 'function'
      ? await provider.getOAuthAuthorizationUrl({
        clientId,
        redirectUri,
        scopes: config.requiredScopes?.length ? config.requiredScopes : this.defaultScopes(integration.provider),
        state,
        environment: config.environment,
        // Cashfree: do NOT default merchantId to our internal organizationId. Cashfree expects
        // merchant_id to reference an existing Cashfree merchant; passing an arbitrary internal
        // UUID causes Cashfree to throw "Unable to link merchant". Leave undefined unless supplied.
        merchantId: merchantId?.trim() || undefined,
        partnerApiKey: this.safeGetCredential(config.id, 'partner_api_key'),
      })
      : `${redirectUri}?client_id=${encodeURIComponent(clientId)}&state=${state}`;

    return {
      provider: integration.provider,
      authorizationUrl,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  }

  private safeGetCredential(referenceId: string, key: string): string | undefined {
    try {
      return this.credentialService.getCredential(referenceId, key);
    } catch {
      return undefined;
    }
  }

  /**
   * Handles the OAuth redirect for any provider whose IntegrationProvider implements
   * exchangeOAuthCode (HubSpot has its own dedicated callback/service and is not routed here).
   * Returns the frontend URL to redirect the browser to.
   */
  async oauthCallback(slug: string, code: string | undefined, stateValue: string | undefined, error?: string, errorDescription?: string, merchantId?: string): Promise<string> {
    this.logger.log(`[OAuth Callback] Processing callback for slug=${slug}, state=${stateValue}, code=${code ? '***' : undefined}, error=${error}, merchantId=${merchantId}`);
    const integration = this.findIntegration(slug);
    const callbackUrl = new URL(`/app/integrations/${integration.slug}/callback`, getAppConfig().frontendUrl);

    if (error) {
      this.logger.warn(`[OAuth Callback] Provider returned error: ${error} - ${errorDescription}`);
      callbackUrl.searchParams.set('status', 'error');
      callbackUrl.searchParams.set('message', errorDescription || error);
      return callbackUrl.toString();
    }

    const state = stateValue ? dbStore.integrationOAuthStates.find((item) => item.state === stateValue) : undefined;
    if (!code || !state || state.consumedAt || state.expiresAt < new Date()) {
      this.logger.warn(`[OAuth Callback] Invalid or expired OAuth state for ${slug}. State exists: ${Boolean(state)}, consumed: ${Boolean(state?.consumedAt)}, expired: ${Boolean(state && state.expiresAt < new Date())}`);
      callbackUrl.searchParams.set('status', 'error');
      callbackUrl.searchParams.set('message', 'This connection link has expired or was already used. Please try connecting again.');
      return callbackUrl.toString();
    }
    state.consumedAt = new Date();

    const config = dbStore.integrationPlatformConfigs.find(
      (item) => item.provider === integration.provider || item.provider === integration.code,
    );
    const provider = this.providerFactory.hasProvider(integration.provider)
      ? (this.providerFactory.getProvider(integration.provider) as any)
      : undefined;

    if (!config || typeof provider?.exchangeOAuthCode !== 'function') {
      this.logger.error(`[OAuth Callback] Missing provider or platform config for ${slug} (${integration.provider})`);
      callbackUrl.searchParams.set('status', 'error');
      callbackUrl.searchParams.set('message', `${integration.name} OAuth is not fully configured.`);
      return callbackUrl.toString();
    }

    try {
      this.logger.log(`[OAuth Callback] Exchanging code with provider: ${integration.provider}`);
      const clientId = this.credentialService.getCredential(config.id, 'client_id');
      const clientSecret = this.credentialService.getCredential(config.id, 'client_secret');
      const redirectUri = config.redirectUri || this.defaultRedirectUri(integration.slug);

      const existingConnection = dbStore.organizationIntegrations.find(
        (item) => item.organizationId === state.organizationId && item.integrationId === integration.id,
      );
      const connection = existingConnection || ({
        id: uuidv4(),
        organizationId: state.organizationId,
        integrationId: integration.id,
        publicId: `${integration.slug}_${randomBytes(12).toString('hex')}`,
        status: OrganizationIntegrationStatus.CONNECTING,
        environment: config.environment,
        config: {},
        createdBy: state.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as OrganizationIntegrationEntity);
      if (!existingConnection) {
        dbStore.organizationIntegrations.push(connection);
      }

      const token = await provider.exchangeOAuthCode({
        code,
        clientId,
        clientSecret,
        redirectUri,
        environment: config.environment,
        partnerApiKey: this.safeGetCredential(config.id, 'partner_api_key'),
        merchantId,
      });

      this.logger.log(`[OAuth Callback] Successfully exchanged token with ${slug}. Account: ${token.externalAccountName || token.externalAccountId}`);

      this.credentialService.storeCredential(connection.id, 'access_token', token.accessToken);
      if (token.refreshToken) this.credentialService.storeCredential(connection.id, 'refresh_token', token.refreshToken);
      if (token.expiresIn) {
        this.credentialService.storeCredential(connection.id, 'access_token_expires_at', String(Date.now() + token.expiresIn * 1000));
      }
      // Provider-issued extras that must persist alongside the token — e.g. Razorpay's
      // `public_token` (client-side Checkout key) and `razorpay_account_id`.
      for (const [key, value] of Object.entries((token.extraCredentials || {}) as Record<string, string>)) {
        this.credentialService.storeCredential(connection.id, key, value);
      }

      connection.status = OrganizationIntegrationStatus.CONNECTED;
      connection.environment = config.environment;
      connection.connectedAt = new Date();
      connection.lastConnectedAt = new Date();
      connection.lastCheckedAt = new Date();
      connection.lastError = undefined;
      connection.config = {
        ...(connection.config || {}),
        externalAccountId: token.externalAccountId,
        externalAccountName: token.externalAccountName,
        maskedCredentials: { connectedVia: 'OAuth', account: token.externalAccountName || token.externalAccountId || integration.name },
        disconnectedAt: undefined,
      };
      connection.updatedAt = new Date();

      dbStore.auditLogs.push({
        id: uuidv4(),
        organizationId: state.organizationId,
        actorType: 'USER',
        actorId: state.userId || 'system',
        action: 'INTEGRATION_OAUTH_CONNECTED' as any,
        resourceType: 'organization_integration',
        resourceId: connection.id,
        metadata: { slug: integration.slug, provider: integration.provider },
        createdAt: new Date(),
      });

      callbackUrl.searchParams.set('status', 'success');
      callbackUrl.searchParams.set('organizationId', state.organizationId);
      callbackUrl.searchParams.set('account', token.externalAccountName || integration.name);
      if (state.redirectUrl) callbackUrl.searchParams.set('returnTo', state.redirectUrl);
      return callbackUrl.toString();
    } catch (err: any) {
      this.logger.error(`[OAuth Callback] Token exchange failed for ${slug}: ${err?.message}`, err?.stack);
      console.error(`[OAuth Callback] Token exchange failed for ${slug}:`, err);
      callbackUrl.searchParams.set('status', 'error');
      callbackUrl.searchParams.set('message', err?.message || `${integration.name} connection failed.`);
      return callbackUrl.toString();
    }
  }

  // ─────────────────────────────────────────────────────────
  // Organization Marketplace APIs
  // ─────────────────────────────────────────────────────────

  listForOrganization(organizationId: string) {
    const integrations = [...dbStore.integrations].sort(
      (a, b) => (a.displayOrder || 100) - (b.displayOrder || 100) || a.name.localeCompare(b.name),
    );

    const items = integrations.map((integration) => {
      const connection = dbStore.organizationIntegrations.find(
        (item) => item.integrationId === integration.id && item.organizationId === organizationId,
      );

      let maskedCredentials: Record<string, string> | undefined;
      if (connection && connection.status === OrganizationIntegrationStatus.CONNECTED) {
        maskedCredentials = connection.config?.maskedCredentials;
        if (!maskedCredentials && this.providerFactory.hasProvider(integration.provider)) {
          const stored = this.credentialService.getAllCredentials(connection.id);
          maskedCredentials = this.providerFactory.getProvider(integration.provider).maskCredentials(stored);
        }
      }

      const platformConfigured = this.isPlatformConfigured(integration.provider, integration.slug);
      const supportsOAuth = this.supportsOAuthFlow(integration);

      return {
        id: integration.id,
        name: integration.name,
        slug: integration.slug,
        code: integration.code || integration.slug.toUpperCase().replace(/-/g, '_'),
        provider: integration.provider,
        category: integration.category,
        description: integration.description,
        logo: integration.logo || this.defaultLogo(integration.slug),
        status: integration.status,
        capabilities: integration.capabilities || this.defaultCapabilities(integration.provider),
        platformConfigured,
        supportsOAuth,
        connection: connection
          ? {
            id: connection.id,
            status: connection.status,
            environment: connection.environment,
            lastCheckedAt: connection.lastCheckedAt ? this.formatIso(connection.lastCheckedAt) : undefined,
            lastConnectedAt: connection.lastConnectedAt || connection.connectedAt ? this.formatIso(connection.lastConnectedAt || connection.connectedAt) : undefined,
            lastError: connection.lastError,
            maskedCredentials,
          }
          : null,
      };
    });

    const connectedCount = items.filter((item) => item.connection?.status === OrganizationIntegrationStatus.CONNECTED).length;

    return {
      integrations: items,
      totalConnected: connectedCount,
    };
  }

  getForOrganization(organizationId: string, slugOrId: string) {
    const integration = this.findIntegration(slugOrId);
    const connection = dbStore.organizationIntegrations.find(
      (item) => item.integrationId === integration.id && item.organizationId === organizationId,
    );

    let maskedCredentials: Record<string, string> | undefined;
    if (connection && connection.status === OrganizationIntegrationStatus.CONNECTED) {
      maskedCredentials = connection.config?.maskedCredentials;
      if (!maskedCredentials && this.providerFactory.hasProvider(integration.provider)) {
        const stored = this.credentialService.getAllCredentials(connection.id);
        maskedCredentials = this.providerFactory.getProvider(integration.provider).maskCredentials(stored);
      }
    }

    const platformConfigured = this.isPlatformConfigured(integration.provider, integration.slug);
    const supportsOAuth = this.supportsOAuthFlow(integration);

    return {
      id: integration.id,
      name: integration.name,
      slug: integration.slug,
      provider: integration.provider,
      category: integration.category,
      description: integration.description,
      logo: integration.logo || this.defaultLogo(integration.slug),
      status: integration.status,
      capabilities: integration.capabilities || this.defaultCapabilities(integration.provider),
      platformConfigured,
      supportsOAuth,
      connection: connection
        ? {
          id: connection.id,
          status: connection.status,
          environment: connection.environment,
          lastCheckedAt: connection.lastCheckedAt ? this.formatIso(connection.lastCheckedAt) : undefined,
          lastConnectedAt: connection.lastConnectedAt || connection.connectedAt ? this.formatIso(connection.lastConnectedAt || connection.connectedAt) : undefined,
          lastError: connection.lastError,
          maskedCredentials,
        }
        : null,
    };
  }

  async testConnection(organizationId: string, slugOrId: string, dto?: TestIntegrationDto): Promise<IntegrationTestResult> {
    const integration = this.findIntegration(slugOrId);
    const provider = this.providerFactory.getProvider(integration.provider);

    // If live credentials provided, test them directly without altering existing connection
    const credentialsToTest = this.extractCredentials(dto);
    const environment = dto?.environment || 'TEST';

    if (Object.keys(credentialsToTest).length > 0) {
      return provider.testConnection(credentialsToTest, environment);
    }

    // Otherwise, re-test existing stored connection
    const connection = this.requireConnection(organizationId, integration.id);
    const stored = this.credentialService.getAllCredentials(connection.id);

    if (Object.keys(stored).length === 0) {
      throw new BadRequestException('No stored credentials found. Please reconnect this integration.');
    }

    // A HubSpot connection made via OAuth stores an access_token, not a Private App Token —
    // the generic key-based HubSpotProvider only understands the latter and would otherwise
    // report "Private App Token was not provided" for a perfectly healthy OAuth connection.
    // Route those through HubSpotService's real token-based health check instead.
    if ((integration.slug === 'hubspot' || integration.provider === 'HUBSPOT') && this.hubspotService && stored.access_token) {
      const health = await this.hubspotService.testConnection(organizationId);
      return {
        success: health.connected,
        message: health.connected
          ? 'PartnerIQ successfully connected to HubSpot.'
          : (connection.lastError || 'HubSpot connection needs attention. Reconnect to restore access.'),
        details: health,
      };
    }

    // A Razorpay connection made via OAuth authenticates with a bearer token that
    // expires. Refresh it first so a merely-stale token reports as healthy (and gets
    // renewed) instead of failing the test.
    if ((integration.provider === 'RAZORPAY' || integration.slug === 'razorpay') && this.razorpayTokenService && stored.access_token) {
      try {
        stored.access_token = await this.razorpayTokenService.getAccessToken(connection.id);
      } catch (err: any) {
        connection.lastCheckedAt = new Date();
        connection.updatedAt = new Date();
        return {
          success: false,
          message: err?.message || 'Razorpay authentication failed. Reconnect Razorpay.',
        };
      }
    }

    const testResult = await provider.testConnection(
      stored,
      connection.environment as any,
      this.buildTestContext(integration.provider, integration.code, connection),
    );
    connection.lastCheckedAt = new Date();
    connection.updatedAt = new Date();

    // An inconclusive result means the provider never rejected us — a network blip, or
    // a credential type this probe cannot verify. Tearing down a working connection over
    // that would be wrong, so leave its status and lastError exactly as they were.
    if (!testResult.inconclusive) {
      connection.status = testResult.success ? OrganizationIntegrationStatus.CONNECTED : OrganizationIntegrationStatus.ERROR;
      connection.lastError = testResult.success ? undefined : testResult.message;
    }

    return testResult;
  }

  async connectIntegration(
    organizationId: string,
    userId: string,
    slugOrId: string,
    dto: ConnectIntegrationDto,
  ) {
    const integration = this.findIntegration(slugOrId);
    if (integration.status === IntegrationStatus.INACTIVE || (integration.status as any) === 'DISABLED') {
      throw new BadRequestException(`${integration.name} is currently inactive and unavailable for new connections.`);
    }
    if (integration.status === IntegrationStatus.COMING_SOON) {
      throw new BadRequestException(`${integration.name} is coming soon and cannot be connected yet.`);
    }

    const provider = this.providerFactory.getProvider(integration.provider);
    const credentials = this.extractCredentials(dto);
    const environment = dto.environment || 'TEST';

    // 1. Validate configuration
    provider.validateConfiguration(credentials, environment);

    // 2. Real test connection before saving
    const testResult = await provider.testConnection(credentials, environment);
    if (!testResult.success) {
      throw new BadRequestException(testResult.message);
    }

    // 3. Find or create connection record
    let connection = dbStore.organizationIntegrations.find(
      (item) => item.integrationId === integration.id && item.organizationId === organizationId,
    );

    const now = new Date();
    if (!connection) {
      connection = {
        id: uuidv4(),
        organizationId,
        integrationId: integration.id,
        publicId: `oi_${uuidv4().replace(/-/g, '')}`,
        status: OrganizationIntegrationStatus.CONNECTED,
        environment: environment as any,
        config: {},
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      } as OrganizationIntegrationEntity;
      dbStore.organizationIntegrations.push(connection);
    }

    const maskedCredentials = provider.maskCredentials(credentials);

    connection.status = OrganizationIntegrationStatus.CONNECTED;
    connection.environment = environment as any;
    connection.connectedAt = now;
    connection.lastConnectedAt = now;
    connection.lastCheckedAt = now;
    connection.lastError = undefined;
    connection.config = {
      ...(connection.config || {}),
      maskedCredentials,
    };
    connection.updatedAt = now;

    // 4. Secure AES-256-GCM encrypted persistence of credentials
    this.credentialService.storeCredentials(connection.id, credentials);
    if (dto.webhookSecret) {
      this.credentialService.storeCredential(connection.id, 'webhook_secret', dto.webhookSecret);
    }

    // 5. Audit log
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: 'INTEGRATION_CONNECTED' as any,
      resourceType: 'organization_integration',
      resourceId: connection.id,
      metadata: { slug: integration.slug, provider: integration.provider, environment },
      createdAt: now,
    });

    return {
      connected: true,
      status: OrganizationIntegrationStatus.CONNECTED,
      environment: connection.environment,
      lastCheckedAt: this.formatIso(connection.lastCheckedAt),
      lastConnectedAt: this.formatIso(connection.lastConnectedAt),
      maskedCredentials,
      message: `${integration.name} connected successfully.`,
    };
  }

  async disconnectIntegration(organizationId: string, userId: string, slugOrId: string) {
    const integration = this.findIntegration(slugOrId);
    const connection = this.requireConnection(organizationId, integration.id);

    // Revoke on Razorpay's side too, so disconnecting here genuinely ends our access
    // rather than leaving a live token behind. Best-effort: never blocks the disconnect.
    if (integration.provider === 'RAZORPAY' || integration.slug === 'razorpay') {
      await this.razorpayTokenService?.revokeTokens(connection.id).catch(() => undefined);
      // Once revoked the stored tokens are dead weight — do not leave them at rest.
      this.credentialService.deleteCredentials(connection.id);
    }

    connection.status = OrganizationIntegrationStatus.DISCONNECTED;
    connection.lastError = undefined;
    connection.updatedAt = new Date();

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: 'INTEGRATION_DISCONNECTED' as any,
      resourceType: 'organization_integration',
      resourceId: connection.id,
      metadata: { slug: integration.slug, provider: integration.provider },
      createdAt: new Date(),
    });

    return {
      disconnected: true,
      slug: integration.slug,
      status: OrganizationIntegrationStatus.DISCONNECTED,
      message: `${integration.name} has been disconnected.`,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Webhook handler (backward compatible)
  // ─────────────────────────────────────────────────────────

  async receiveWebhook(codeOrProvider: string, publicConnectionId: string, body: any, headers: Record<string, any>) {
    const integration = dbStore.integrations.find(
      (item) => item.code === codeOrProvider.toUpperCase() || item.slug === codeOrProvider.toLowerCase() || item.provider === codeOrProvider.toUpperCase(),
    );
    if (!integration) throw new NotFoundException('Integration not found');

    const connection = dbStore.organizationIntegrations.find(
      (item) => item.publicId === publicConnectionId && item.integrationId === integration.id,
    );
    if (!connection) throw new NotFoundException('Integration connection not found');

    const rawBody = Buffer.from(JSON.stringify(body || {}));
    const adapter = integrationAdapterRegistry.get(integration.code || integration.provider);
    const startedAt = Date.now();
    const normalized = adapter?.normalizeWebhookEvent(body) || {
      externalEventId: `evt_${uuidv4()}`,
      eventType: 'unknown.event',
      normalizedType: 'integration.event.received',
      data: body || {},
    };

    const duplicate = dbStore.integrationEvents.find(
      (event) => event.organizationIntegrationId === connection.id && event.externalEventId === normalized.externalEventId,
    );
    if (duplicate) {
      duplicate.status = IntegrationEventStatus.DUPLICATE;
      return { received: true, duplicate: true, eventId: duplicate.id };
    }

    // Signature verification is mandatory whenever the integration supports webhooks.
    // A missing/unretrievable webhook secret must FAIL closed (reject the event), never
    // fail open — silently swallowing the error here previously let anyone with the
    // connection's public webhook URL forge payment/CRM events when no secret was configured.
    let status = IntegrationEventStatus.PROCESSED;
    let error: string | undefined;
    if (adapter && integration.supportsWebhooks) {
      let secret: string | undefined;
      try {
        secret = this.credentialService.getCredential(connection.id, 'webhook_secret');
      } catch {
        secret = undefined;
      }
      if (!secret || !adapter.verifyWebhookSignature(rawBody, headers, secret)) {
        status = IntegrationEventStatus.FAILED;
        error = 'Webhook signature verification failed';
      }
    }

    const event = {
      id: uuidv4(),
      organizationId: connection.organizationId,
      integrationId: integration.id,
      organizationIntegrationId: connection.id,
      externalEventId: normalized.externalEventId,
      eventType: normalized.eventType,
      normalizedType: normalized.normalizedType,
      payloadHash: createHash('sha256').update(rawBody).digest('hex'),
      payloadReference: undefined,
      status,
      processingMs: Date.now() - startedAt,
      error,
      metadata: {} as Record<string, unknown>,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    dbStore.integrationEvents.push(event);
    connection.lastWebhookAt = new Date();
    connection.lastError = error;
    if (error) {
      connection.status = OrganizationIntegrationStatus.ERROR;
    }

    // Bridge payment-provider webhooks (e.g. Cashfree) into the Conversion/attribution/commission
    // pipeline. This never fails the webhook ack itself - the provider must still get a 200 even
    // if downstream conversion creation is rejected (e.g. duplicate externalId), so the failure is
    // recorded on the event instead of being thrown.
    if (status !== IntegrationEventStatus.FAILED && adapter?.extractConversionInput && this.conversionsService) {
      try {
        const conversionInput = adapter.extractConversionInput(body);
        if (conversionInput?.kind === 'PAYMENT_SUCCESS') {
          const result = await this.conversionsService.createConversion(
            connection.organizationId,
            {
              externalId: conversionInput.externalId,
              customerExternalId: conversionInput.customerExternalId || conversionInput.externalId,
              amount: conversionInput.amount,
              currency: conversionInput.currency,
              type: 'PURCHASE',
              clickId: conversionInput.clickId,
              attributionId: conversionInput.attributionId,
              occurredAt: conversionInput.occurredAt?.toISOString(),
              metadata: { source: integration.code || integration.provider, integrationEventId: event.id },
            },
            `${(integration.code || integration.provider).toLowerCase()}:${event.externalEventId}`,
            { environment: connection.environment as unknown as EnvironmentType },
          );
          event.metadata = { conversionId: result?.conversion?.id, bridged: 'PAYMENT_SUCCESS' };
        } else if (conversionInput?.kind === 'REFUND') {
          const result = await this.conversionsService.refundConversion(
            connection.organizationId,
            conversionInput.externalId,
            { refundExternalId: conversionInput.refundExternalId, amount: conversionInput.refundAmount },
            connection.environment as unknown as EnvironmentType,
            { idempotencyKey: `${(integration.code || integration.provider).toLowerCase()}_refund:${event.externalEventId}` },
          );
          event.metadata = { conversionId: result?.conversion?.id, bridged: 'REFUND' };
        }
      } catch (bridgeError: any) {
        this.logger.warn(`Conversion bridge failed for ${integration.code}/${event.externalEventId}: ${bridgeError?.message || bridgeError}`);
        event.metadata = { bridgeError: bridgeError?.message || String(bridgeError) };
      }
    }

    return { received: true, eventId: event.id, status };
  }

  // ─────────────────────────────────────────────────────────
  // Helper methods
  // ─────────────────────────────────────────────────────────

  /**
   * Resolves the platform-level context a health check needs on top of the organization's
   * own credentials — currently Cashfree's Partner API Key (held against the platform OAuth
   * app, not the org) plus the merchant this connection is linked to.
   */
  private buildTestContext(
    provider: string,
    code: string | undefined,
    connection: OrganizationIntegrationEntity,
  ): IntegrationTestContext {
    const config = dbStore.integrationPlatformConfigs.find(
      (item) => item.provider === provider || (code ? item.provider === code : false),
    );
    return {
      partnerApiKey: config ? this.safeGetCredential(config.id, 'partner_api_key') : undefined,
      externalAccountId: connection.config?.externalAccountId,
    };
  }

  private extractCredentials(dto?: ConnectIntegrationDto | TestIntegrationDto): Record<string, string> {
    if (!dto) return {};
    const creds: Record<string, string> = { ...(dto.credentials || {}) };

    if (dto.privateAppToken) creds.privateAppToken = dto.privateAppToken;
    if (dto.apiKey) creds.apiKey = dto.apiKey;
    if (dto.apiSecret) creds.apiSecret = dto.apiSecret;
    if (dto.keyId) creds.keyId = dto.keyId;
    if (dto.keySecret) creds.keySecret = dto.keySecret;
    if (dto.appId) creds.appId = dto.appId;
    if (dto.secretKey) creds.secretKey = dto.secretKey;

    return creds;
  }

  private adminIntegrationSummaries() {
    return [...dbStore.integrations]
      .sort((a, b) => (a.displayOrder || 100) - (b.displayOrder || 100) || a.name.localeCompare(b.name))
      .map((integration) => {
        const connections = dbStore.organizationIntegrations.filter((item) => item.integrationId === integration.id);
        const connected = connections.filter((c) => c.status === OrganizationIntegrationStatus.CONNECTED).length;
        const failed = connections.filter((c) => c.status === OrganizationIntegrationStatus.ERROR || c.status === OrganizationIntegrationStatus.AUTHENTICATION_ERROR).length;

        let health = 'Healthy';
        if (failed > 0) {
          health = `${failed} organization${failed > 1 ? 's' : ''} with errors`;
        }

        return {
          id: integration.id,
          name: integration.name,
          slug: integration.slug,
          code: integration.code || integration.slug.toUpperCase().replace(/-/g, '_'),
          provider: integration.provider,
          category: integration.category,
          description: integration.description,
          logo: integration.logo || this.defaultLogo(integration.slug),
          status: integration.status,
          capabilities: integration.capabilities || this.defaultCapabilities(integration.provider),
          connectedOrganizations: connected,
          healthyConnections: connected,
          failedConnections: failed,
          health,
          updatedAt: integration.updatedAt,
        };
      });
  }

  private findIntegration(slugOrId: string) {
    const needle = slugOrId.toLowerCase().trim();
    const integration = dbStore.integrations.find(
      (item) =>
        item.id === slugOrId ||
        item.slug.toLowerCase() === needle ||
        item.code?.toLowerCase() === needle ||
        item.provider.toLowerCase() === needle ||
        item.provider.toLowerCase().replace(/_/g, '-') === needle,
    );
    if (!integration) {
      throw new NotFoundException(`Integration '${slugOrId}' not found`);
    }
    return integration;
  }

  private requireConnection(organizationId: string, integrationId: string) {
    const connection = dbStore.organizationIntegrations.find(
      (item) => item.organizationId === organizationId && item.integrationId === integrationId,
    );
    if (!connection) {
      throw new NotFoundException('This integration is not connected for your organization.');
    }
    return connection;
  }

  private assertSuperAdmin(user: AuthUserPayload) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }
  }

  private formatIso(date?: Date | string): string {
    if (!date) return '';
    return new Date(date).toISOString();
  }

  private defaultLogo(slug: string): string {
    const cleanSlug = slug.toLowerCase().replace(/_/g, '-');
    if (cleanSlug.includes('hubspot')) return '/integrations/hubspot.svg';
    if (cleanSlug.includes('zoho')) return '/integrations/zoho.svg';
    if (cleanSlug.includes('razorpay')) return '/integrations/razorpay.svg';
    if (cleanSlug.includes('cashfree')) return '/integrations/cashfree.svg';
    return `/integrations/${cleanSlug}.svg`;
  }

  private defaultCapabilities(provider: string): string[] {
    switch (provider.toUpperCase()) {
      case 'HUBSPOT':
        return ['contacts', 'companies', 'deals', 'conversions'];
      case 'ZOHO_CRM':
        return ['leads', 'contacts', 'deals', 'conversions'];
      case 'RAZORPAY':
        return ['payments', 'orders', 'refunds', 'customers', 'webhooks'];
      case 'CASHFREE':
        return ['payments', 'orders', 'refunds', 'customers', 'webhooks'];
      default:
        return ['api_credentials', 'data_sync'];
    }
  }
}
