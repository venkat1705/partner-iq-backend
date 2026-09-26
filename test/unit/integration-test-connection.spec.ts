import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { IntegrationsService } from '../../src/modules/integrations/integrations.service';
import { IntegrationCredentialService } from '../../src/modules/integrations/integration-credential.service';
import { HubSpotProvider } from '../../src/modules/integrations/providers/hubspot.provider';
import { ZohoCrmProvider } from '../../src/modules/integrations/providers/zoho-crm.provider';
import { RazorpayProvider } from '../../src/modules/integrations/providers/razorpay.provider';
import { CashfreeProvider } from '../../src/modules/integrations/providers/cashfree.provider';
import { IntegrationProviderFactory } from '../../src/modules/integrations/providers/provider.factory';
import { RazorpayTokenService } from '../../src/modules/integrations/razorpay/razorpay-token.service';
import { OrganizationIntegrationStatus } from '../../src/common/enums';
import { dbStore } from '../../src/database/store';

describe('Integration Test-Connection Regression Suite', () => {
  let credService: IntegrationCredentialService;
  let razorpayProvider: RazorpayProvider;
  let zohoProvider: ZohoCrmProvider;
  let providerFactory: IntegrationProviderFactory;
  let service: IntegrationsService;

  const ORG_ID = 'org_testconn_1';
  const superAdmin: any = { userId: 'usr_tc_admin', platformRole: 'SUPER_ADMIN', isSuperAdmin: true };
  const realFetch = globalThis.fetch;
  let lastAuthHeader: string | undefined;

  function stubFetch(impl: (url: string, init: any) => { status: number; body: any } | Promise<never>) {
    globalThis.fetch = (async (input: any, init: any = {}) => {
      const headers = Object.fromEntries(
        Object.entries((init.headers || {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
      );
      lastAuthHeader = headers['authorization'];
      const result = await impl(String(input), init);
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        text: async () => JSON.stringify(result.body),
      } as any;
    }) as any;
  }

  function seedOAuthConnection(slug: string, provider: string, id: string) {
    if (!dbStore.integrations.some((i) => i.slug === slug)) {
      dbStore.integrations.push({
        id,
        name: slug,
        slug,
        code: provider,
        provider,
        category: 'PAYMENTS' as any,
        status: 'ACTIVE' as any,
        logo: `/integrations/${slug}.svg`,
        capabilities: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }
    const connection: any = {
      id: `conn_${slug}`,
      organizationId: ORG_ID,
      integrationId: id,
      publicId: `${slug}_pub`,
      status: OrganizationIntegrationStatus.CONNECTED,
      environment: 'TEST',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    dbStore.organizationIntegrations.push(connection);
    credService.storeCredential(connection.id, 'access_token', `${slug}_access_token`);
    credService.storeCredential(connection.id, 'refresh_token', `${slug}_refresh_token`);
    return connection;
  }

  beforeEach(() => {
    credService = new IntegrationCredentialService();
    razorpayProvider = new RazorpayProvider();
    zohoProvider = new ZohoCrmProvider();
    providerFactory = new IntegrationProviderFactory(
      new HubSpotProvider(),
      zohoProvider,
      razorpayProvider,
      new CashfreeProvider(),
    );
    service = new IntegrationsService(
      credService,
      providerFactory,
      new RazorpayTokenService(credService, razorpayProvider),
    );
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('verifies Zoho OAuth connection with access token', async () => {
    const zohoConn = seedOAuthConnection('zoho-crm', 'ZOHO_CRM', 'int-zoho-tc');
    stubFetch(() => ({ status: 200, body: { org: [{ company_name: 'Acme' }] } }));
    const zohoResult = await service.testConnection(ORG_ID, 'zoho-crm');
    expect(zohoResult.success).toBe(true);
    expect(lastAuthHeader).toBe('Zoho-oauthtoken zoho-crm_access_token');
    expect(zohoConn.status).toBe(OrganizationIntegrationStatus.CONNECTED);
  });

  it('marks Cashfree OAuth without Partner API Key as inconclusive without disconnecting', async () => {
    const cfConn = seedOAuthConnection('cashfree', 'CASHFREE', 'int-cashfree-tc');
    cfConn.config.externalAccountId = 'CF_MERCHANT_9001';
    const cfUnconfigured = await service.testConnection(ORG_ID, 'cashfree');
    expect(cfUnconfigured.inconclusive).toBe(true);
    expect(cfUnconfigured.message).toMatch(/Partner API Key is not configured/);
    expect(cfConn.status).toBe(OrganizationIntegrationStatus.CONNECTED);
  });

  it('genuinely verifies Cashfree OAuth via partner auth headers', async () => {
    const cfConn = seedOAuthConnection('cashfree', 'CASHFREE', 'int-cashfree-tc');
    cfConn.config.externalAccountId = 'CF_MERCHANT_9001';

    service.upsertAdminPlatformConfig(superAdmin, 'cashfree', {
      clientId: 'cf_oauth_client',
      clientSecret: 'cf_oauth_secret',
      partnerApiKey: 'cf_partner_api_key_123',
      redirectUri: 'https://app.partneriq.io/api/v1/integrations/cashfree/oauth/callback',
      requiredScopes: ['read_write'],
      environment: 'TEST',
    });

    let cfHeaders: Record<string, string> = {};
    let cfUrl = '';
    stubFetch((url, init) => {
      cfUrl = url;
      cfHeaders = Object.fromEntries(
        Object.entries((init.headers || {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
      );
      return { status: 200, body: [] };
    });

    const cfVerified = await service.testConnection(ORG_ID, 'cashfree');
    expect(cfVerified.success).toBe(true);
    expect(!cfVerified.inconclusive).toBe(true);
    expect(cfHeaders['x-partner-apikey']).toBe('cf_partner_api_key_123');
    expect(cfHeaders['x-partner-merchantid']).toBe('CF_MERCHANT_9001');
    expect(cfHeaders['x-client-id']).toBeUndefined();
    expect(cfUrl.startsWith('https://sandbox.cashfree.com/pg/orders')).toBe(true);
    expect(cfConn.status).toBe(OrganizationIntegrationStatus.CONNECTED);
  });

  it('marks revoked Cashfree authorization as ERROR', async () => {
    const cfConn = seedOAuthConnection('cashfree', 'CASHFREE', 'int-cashfree-tc');
    cfConn.config.externalAccountId = 'CF_MERCHANT_9001';
    service.upsertAdminPlatformConfig(superAdmin, 'cashfree', {
      clientId: 'cf_oauth_client',
      clientSecret: 'cf_oauth_secret',
      partnerApiKey: 'cf_partner_api_key_123',
      redirectUri: 'https://app.partneriq.io/api/v1/integrations/cashfree/oauth/callback',
      requiredScopes: ['read_write'],
      environment: 'TEST',
    });

    stubFetch(() => ({ status: 401, body: { message: 'unauthorized' } }));
    const cfRejected = await service.testConnection(ORG_ID, 'cashfree');
    expect(cfRejected.success).toBe(false);
    expect(!cfRejected.inconclusive).toBe(true);
    expect(cfRejected.message).toMatch(/reconnect your Cashfree account/i);
    expect(cfConn.status).toBe(OrganizationIntegrationStatus.ERROR);
  });

  it('keeps healthy connection CONNECTED on network failure blip', async () => {
    const rzpConn = seedOAuthConnection('razorpay', 'RAZORPAY', 'int-razorpay-tc');
    stubFetch(() => Promise.reject(new Error('ECONNRESET')));
    const blip = await service.testConnection(ORG_ID, 'razorpay');
    expect(blip.success).toBe(false);
    expect(blip.inconclusive).toBe(true);
    expect(rzpConn.status).toBe(OrganizationIntegrationStatus.CONNECTED);
    expect(rzpConn.lastError).toBeUndefined();
  });

  it('marks connection ERROR on genuine 401 rejection', async () => {
    const rzpConn = seedOAuthConnection('razorpay', 'RAZORPAY', 'int-razorpay-tc');
    stubFetch(() => ({ status: 401, body: { error: { description: 'unauthorized' } } }));
    const rejected = await service.testConnection(ORG_ID, 'razorpay');
    expect(rejected.success).toBe(false);
    expect(!rejected.inconclusive).toBe(true);
    expect(rzpConn.status).toBe(OrganizationIntegrationStatus.ERROR);
    expect(rzpConn.lastError).toBeDefined();
  });
});

