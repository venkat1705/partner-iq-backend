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

describe('Razorpay OAuth End-to-End Suite', () => {
  let credService: IntegrationCredentialService;
  let razorpayProvider: RazorpayProvider;
  let service: IntegrationsService;

  const superAdminUser: any = { userId: 'usr_rzp_admin', platformRole: 'SUPER_ADMIN', isSuperAdmin: true };
  const orgUser: any = { userId: 'usr_rzp_org', organizationId: 'org_rzp_1', role: 'ADMIN', isSuperAdmin: false };
  const ORG_ID = 'org_rzp_1';

  interface RecordedCall { url: string; method?: string; headers: Record<string, string>; body?: any }
  let calls: RecordedCall[] = [];
  const realFetch = globalThis.fetch;

  function stubFetch(handler: (call: RecordedCall) => { status: number; body: any }) {
    globalThis.fetch = (async (input: any, init: any = {}) => {
      const headers = Object.fromEntries(
        Object.entries((init.headers || {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
      );
      let body = init.body;
      if (typeof body === 'string' && headers['content-type']?.includes('application/json')) {
        body = JSON.parse(body);
      }
      const call: RecordedCall = { url: String(input), method: init.method, headers, body };
      calls.push(call);
      const { status, body: responseBody } = handler(call);
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(responseBody),
      } as any;
    }) as any;
  }

  beforeEach(() => {
    credService = new IntegrationCredentialService();
    razorpayProvider = new RazorpayProvider();
    const providerFactory = new IntegrationProviderFactory(
      new HubSpotProvider(),
      new ZohoCrmProvider(),
      razorpayProvider,
      new CashfreeProvider(),
    );
    const razorpayTokenService = new RazorpayTokenService(credService, razorpayProvider);
    service = new IntegrationsService(credService, providerFactory, razorpayTokenService);

    dbStore.integrations.push({
      id: 'int-razorpay',
      name: 'Razorpay',
      slug: 'razorpay',
      code: 'RAZORPAY',
      provider: 'RAZORPAY',
      category: 'PAYMENTS' as any,
      status: 'ACTIVE' as any,
      logo: '/integrations/razorpay.svg',
      capabilities: ['payments', 'refunds', 'conversions'],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('manages full Razorpay OAuth lifecycle with token exchange, refresh, and revocation', async () => {
    // 1. Admin configures Razorpay platform OAuth app
    const saved = service.upsertAdminPlatformConfig(superAdminUser, 'razorpay', {
      clientId: 'rzp_client_id_abc123',
      clientSecret: 'rzp_client_secret_xyz789',
      redirectUri: 'https://app.partneriq.io/api/v1/integrations/razorpay/oauth/callback',
      requiredScopes: ['read_write'],
      environment: 'TEST',
    });
    expect(saved.configured).toBe(true);

    // 2. Authorization URL shape
    const initiated = await service.connectOAuth(ORG_ID, orgUser, 'razorpay');
    const authUrl = new URL(initiated.authorizationUrl);
    expect(authUrl.origin + authUrl.pathname).toBe('https://auth.razorpay.com/authorize');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('client_id')).toBe('rzp_client_id_abc123');
    expect(authUrl.searchParams.get('scope')).toBe('read_write');
    const state = authUrl.searchParams.get('state')!;
    expect(state && state.startsWith('razorpay_')).toBe(true);

    // Invalid scopes rejection
    expect(() =>
      razorpayProvider.getOAuthAuthorizationUrl({
        clientId: 'x', redirectUri: 'https://x.test/cb', scopes: ['crm.objects.read'], state: 's',
      })
    ).toThrow();

    // 3. Authorization code exchange
    calls = [];
    stubFetch(() => ({
      status: 200,
      body: {
        token_type: 'Bearer',
        expires_in: 7776000,
        access_token: 'rzp_access_token_1',
        refresh_token: 'rzp_refresh_token_1',
        public_token: 'rzp_public_token_1',
        razorpay_account_id: 'acc_LlBaP5xwCvNLUN',
      },
    }));

    const redirect = await service.oauthCallback('razorpay', 'auth_code_123', state);
    const tokenCall = calls.find((c) => c.url === 'https://auth.razorpay.com/token')!;
    expect(tokenCall).toBeDefined();
    expect(tokenCall.method).toBe('POST');
    expect(tokenCall.headers['content-type']?.includes('application/json')).toBe(true);
    expect(tokenCall.body.grant_type).toBe('authorization_code');
    expect(tokenCall.body.code).toBe('auth_code_123');
    expect(tokenCall.body.client_id).toBe('rzp_client_id_abc123');
    expect(tokenCall.body.client_secret).toBe('rzp_client_secret_xyz789');
    expect(tokenCall.body.mode).toBe('test');
    expect(redirect.includes('status=success')).toBe(true);

    // 4. Token persistence
    const connection = dbStore.organizationIntegrations.find(
      (c) => c.organizationId === ORG_ID && c.integrationId === 'int-razorpay',
    )!;
    expect(connection).toBeDefined();
    expect(connection.status).toBe(OrganizationIntegrationStatus.CONNECTED);
    const stored = credService.getAllCredentials(connection.id);
    expect(stored.access_token).toBe('rzp_access_token_1');
    expect(stored.refresh_token).toBe('rzp_refresh_token_1');
    expect(stored.public_token).toBe('rzp_public_token_1');
    expect(stored.razorpay_account_id).toBe('acc_LlBaP5xwCvNLUN');
    expect(Number(stored.access_token_expires_at)).toBeGreaterThan(Date.now());

    // 5. Credential masking
    const masked = razorpayProvider.maskCredentials(stored);
    expect(masked.connectedVia).toBe('OAuth');
    expect(masked.accountId).toBe('acc_LlBaP5xwCvNLUN');
    expect(!JSON.stringify(masked).includes('rzp_access_token_1')).toBe(true);

    // 6. Testing OAuth connection uses Bearer auth
    calls = [];
    stubFetch(() => ({ status: 200, body: { count: 0, items: [] } }));
    const testResult = await service.testConnection(ORG_ID, 'razorpay');
    expect(testResult.success).toBe(true);
    const apiCall = calls.find((c) => c.url.includes('api.razorpay.com'))!;
    expect(apiCall.headers['authorization']).toBe('Bearer rzp_access_token_1');

    // 7. Transparent token refresh near expiry
    credService.storeCredential(connection.id, 'access_token_expires_at', String(Date.now() + 60_000));
    calls = [];
    stubFetch((call) => {
      if (call.url === 'https://auth.razorpay.com/token') {
        return {
          status: 200,
          body: {
            token_type: 'Bearer',
            expires_in: 7776000,
            access_token: 'rzp_access_token_2',
            refresh_token: 'rzp_refresh_token_2',
            public_token: 'rzp_public_token_2',
            razorpay_account_id: 'acc_LlBaP5xwCvNLUN',
          },
        };
      }
      return { status: 200, body: { count: 0, items: [] } };
    });

    const refreshedTest = await service.testConnection(ORG_ID, 'razorpay');
    expect(refreshedTest.success).toBe(true);
    const refreshCall = calls.find((c) => c.url === 'https://auth.razorpay.com/token')!;
    expect(refreshCall).toBeDefined();
    expect(refreshCall.body.grant_type).toBe('refresh_token');
    expect(refreshCall.body.refresh_token).toBe('rzp_refresh_token_1');
    const afterRefresh = credService.getAllCredentials(connection.id);
    expect(afterRefresh.access_token).toBe('rzp_access_token_2');
    expect(afterRefresh.refresh_token).toBe('rzp_refresh_token_2');

    // 8. Refresh failure marks connection broken
    credService.storeCredential(connection.id, 'access_token_expires_at', String(Date.now() + 60_000));
    calls = [];
    stubFetch(() => ({ status: 400, body: { error: { description: 'refresh token is invalid' } } }));
    const brokenTest = await service.testConnection(ORG_ID, 'razorpay');
    expect(brokenTest.success).toBe(false);
    expect(brokenTest.message).toMatch(/Reconnect Razorpay/);
    expect(connection.status).toBe(OrganizationIntegrationStatus.AUTHENTICATION_ERROR);

    // 9. Disconnect revokes both tokens
    connection.status = OrganizationIntegrationStatus.CONNECTED;
    calls = [];
    stubFetch(() => ({ status: 200, body: { message: 'token revoked' } }));
    const disconnected = await service.disconnectIntegration(ORG_ID, orgUser.userId, 'razorpay');
    expect(disconnected.disconnected).toBe(true);
    const revokeCalls = calls.filter((c) => c.url === 'https://auth.razorpay.com/revoke');
    expect(revokeCalls.length).toBe(2);
    expect(credService.hasCredentials(connection.id)).toBe(false);
    expect(connection.status).toBe(OrganizationIntegrationStatus.DISCONNECTED);

    // 10. Single-use OAuth state protection
    calls = [];
    stubFetch(() => ({ status: 200, body: { access_token: 'should_not_be_issued' } }));
    const replay = await service.oauthCallback('razorpay', 'auth_code_123', state);
    expect(replay.includes('status=error')).toBe(true);
    expect(calls.length).toBe(0);
  });
});

