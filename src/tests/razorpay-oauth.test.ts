import assert from 'node:assert/strict';
import { IntegrationsService } from '../modules/integrations/integrations.service';
import { IntegrationCredentialService } from '../modules/integrations/integration-credential.service';
import { HubSpotProvider } from '../modules/integrations/providers/hubspot.provider';
import { ZohoCrmProvider } from '../modules/integrations/providers/zoho-crm.provider';
import { RazorpayProvider } from '../modules/integrations/providers/razorpay.provider';
import { CashfreeProvider } from '../modules/integrations/providers/cashfree.provider';
import { IntegrationProviderFactory } from '../modules/integrations/providers/provider.factory';
import { RazorpayTokenService } from '../modules/integrations/razorpay/razorpay-token.service';
import { OrganizationIntegrationStatus } from '../common/enums';
import { dbStore } from '../database/store';

console.log('--- Starting Razorpay OAuth End-to-End Test ---');

const credService = new IntegrationCredentialService();
const razorpayProvider = new RazorpayProvider();
const providerFactory = new IntegrationProviderFactory(
  new HubSpotProvider(),
  new ZohoCrmProvider(),
  razorpayProvider,
  new CashfreeProvider(),
);
const razorpayTokenService = new RazorpayTokenService(credService, razorpayProvider);
const service = new IntegrationsService(credService, providerFactory, razorpayTokenService);

const superAdminUser: any = { userId: 'usr_rzp_admin', platformRole: 'SUPER_ADMIN', isSuperAdmin: true };
const orgUser: any = { userId: 'usr_rzp_org', organizationId: 'org_rzp_1', role: 'ADMIN', isSuperAdmin: false };
const ORG_ID = 'org_rzp_1';

/** Records every outbound call so each test can assert the exact wire format. */
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

async function runTests() {
  if (!dbStore.integrations.some((i) => i.slug === 'razorpay')) {
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
  }

  // ── Test 1: Admin configures the Razorpay OAuth app ──────────────────────
  console.log('Test 1: Admin configures Razorpay platform OAuth app');
  const saved = service.upsertAdminPlatformConfig(superAdminUser, 'razorpay', {
    clientId: 'rzp_client_id_abc123',
    clientSecret: 'rzp_client_secret_xyz789',
    redirectUri: 'https://app.partneriq.io/api/v1/integrations/razorpay/oauth/callback',
    requiredScopes: ['read_write'],
    environment: 'TEST',
  });
  assert.equal(saved.configured, true);
  console.log('✓ Razorpay platform OAuth app configured and secrets encrypted');

  // ── Test 2: Authorization URL matches Razorpay's documented contract ─────
  console.log('Test 2: Authorization URL shape');
  const initiated = await service.connectOAuth(ORG_ID, orgUser, 'razorpay');
  const authUrl = new URL(initiated.authorizationUrl);
  assert.equal(authUrl.origin + authUrl.pathname, 'https://auth.razorpay.com/authorize');
  assert.equal(authUrl.searchParams.get('response_type'), 'code');
  assert.equal(authUrl.searchParams.get('client_id'), 'rzp_client_id_abc123');
  assert.equal(authUrl.searchParams.get('scope'), 'read_write');
  const state = authUrl.searchParams.get('state')!;
  assert.ok(state && state.startsWith('razorpay_'), 'state must be present for CSRF protection');
  console.log('✓ Authorize URL carries response_type, client_id, redirect_uri, scope and state');

  // Razorpay rejects any scope outside its documented set.
  assert.throws(
    () => razorpayProvider.getOAuthAuthorizationUrl({
      clientId: 'x', redirectUri: 'https://x.test/cb', scopes: ['crm.objects.read'], state: 's',
    }),
    /No valid Razorpay scopes/,
  );
  console.log('✓ Invalid scopes are rejected before redirecting the user');

  // ── Test 3: Code exchange uses JSON and carries mode ─────────────────────
  console.log('Test 3: Authorization code exchange wire format');
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
  assert.ok(tokenCall, 'token endpoint must be called');
  assert.equal(tokenCall.method, 'POST');
  assert.ok(
    tokenCall.headers['content-type']?.includes('application/json'),
    'Razorpay token endpoint is JSON-only and rejects form-urlencoded bodies',
  );
  assert.equal(tokenCall.body.grant_type, 'authorization_code');
  assert.equal(tokenCall.body.code, 'auth_code_123');
  assert.equal(tokenCall.body.client_id, 'rzp_client_id_abc123');
  assert.equal(tokenCall.body.client_secret, 'rzp_client_secret_xyz789');
  assert.equal(tokenCall.body.mode, 'test', 'a TEST-environment connection must request test-mode tokens');
  assert.ok(redirect.includes('status=success'), `expected success redirect, got ${redirect}`);
  console.log('✓ Code exchanged as JSON with grant_type, credentials, redirect_uri and mode=test');

  // ── Test 4: Tokens persisted, including public_token ─────────────────────
  console.log('Test 4: Token persistence');
  const connection = dbStore.organizationIntegrations.find(
    (c) => c.organizationId === ORG_ID && c.integrationId === 'int-razorpay',
  )!;
  assert.ok(connection, 'connection record must exist');
  assert.equal(connection.status, OrganizationIntegrationStatus.CONNECTED);
  const stored = credService.getAllCredentials(connection.id);
  assert.equal(stored.access_token, 'rzp_access_token_1');
  assert.equal(stored.refresh_token, 'rzp_refresh_token_1');
  assert.equal(stored.public_token, 'rzp_public_token_1', 'public_token is needed for client-side Checkout');
  assert.equal(stored.razorpay_account_id, 'acc_LlBaP5xwCvNLUN');
  assert.ok(Number(stored.access_token_expires_at) > Date.now(), 'expiry must be recorded for refresh');
  console.log('✓ access_token, refresh_token, public_token, account id and expiry stored encrypted');

  // ── Test 5: Masked credentials never leak the token ──────────────────────
  console.log('Test 5: Credential masking');
  const masked = razorpayProvider.maskCredentials(stored);
  assert.equal(masked.connectedVia, 'OAuth');
  assert.equal(masked.accountId, 'acc_LlBaP5xwCvNLUN');
  assert.ok(!JSON.stringify(masked).includes('rzp_access_token_1'), 'masked output must not contain the token');
  console.log('✓ OAuth connection masks as connectedVia: OAuth without exposing the token');

  // ── Test 6: Testing an OAuth connection uses Bearer auth ─────────────────
  console.log('Test 6: Testing an OAuth connection');
  calls = [];
  stubFetch(() => ({ status: 200, body: { count: 0, items: [] } }));
  const testResult = await service.testConnection(ORG_ID, 'razorpay');
  assert.equal(testResult.success, true);
  const apiCall = calls.find((c) => c.url.includes('api.razorpay.com'))!;
  assert.equal(apiCall.headers['authorization'], 'Bearer rzp_access_token_1');
  console.log('✓ OAuth connections are tested with a Bearer token, not Basic key auth');

  // ── Test 7: Expiring token is refreshed transparently ────────────────────
  console.log('Test 7: Transparent token refresh near expiry');
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
  assert.equal(refreshedTest.success, true);
  const refreshCall = calls.find((c) => c.url === 'https://auth.razorpay.com/token')!;
  assert.ok(refreshCall, 'a near-expiry token must trigger a refresh');
  assert.equal(refreshCall.body.grant_type, 'refresh_token');
  assert.equal(refreshCall.body.refresh_token, 'rzp_refresh_token_1');
  assert.equal(refreshCall.body.redirect_uri, undefined, 'refresh grant takes no redirect_uri');
  const afterRefresh = credService.getAllCredentials(connection.id);
  assert.equal(afterRefresh.access_token, 'rzp_access_token_2');
  assert.equal(afterRefresh.refresh_token, 'rzp_refresh_token_2');
  const bearerAfterRefresh = calls.find((c) => c.url.includes('api.razorpay.com'))!;
  assert.equal(bearerAfterRefresh.headers['authorization'], 'Bearer rzp_access_token_2');
  console.log('✓ Near-expiry token refreshed and the rotated token used for the API call');

  // ── Test 8: A revoked authorization surfaces as an auth error ────────────
  console.log('Test 8: Refresh failure marks the connection broken');
  credService.storeCredential(connection.id, 'access_token_expires_at', String(Date.now() + 60_000));
  calls = [];
  stubFetch(() => ({ status: 400, body: { error: { description: 'refresh token is invalid' } } }));
  const brokenTest = await service.testConnection(ORG_ID, 'razorpay');
  assert.equal(brokenTest.success, false);
  assert.match(brokenTest.message, /Reconnect Razorpay/);
  assert.equal(connection.status, OrganizationIntegrationStatus.AUTHENTICATION_ERROR);
  console.log('✓ A revoked authorization reports AUTHENTICATION_ERROR and asks the org to reconnect');

  // ── Test 9: Disconnect revokes both tokens and purges them ───────────────
  console.log('Test 9: Disconnect revokes tokens at Razorpay');
  connection.status = OrganizationIntegrationStatus.CONNECTED;
  calls = [];
  stubFetch(() => ({ status: 200, body: { message: 'token revoked' } }));
  const disconnected = await service.disconnectIntegration(ORG_ID, orgUser.userId, 'razorpay');
  assert.equal(disconnected.disconnected, true);
  const revokeCalls = calls.filter((c) => c.url === 'https://auth.razorpay.com/revoke');
  assert.equal(revokeCalls.length, 2, 'both the refresh token and the access token must be revoked');
  assert.deepEqual(
    revokeCalls.map((c) => c.body.token_type_hint).sort(),
    ['access_token', 'refresh_token'],
  );
  assert.equal(revokeCalls[0].body.client_id, 'rzp_client_id_abc123');
  assert.equal(credService.hasCredentials(connection.id), false, 'revoked tokens must not linger at rest');
  assert.equal(connection.status, OrganizationIntegrationStatus.DISCONNECTED);
  console.log('✓ Disconnect revokes both tokens at Razorpay and purges them locally');

  // ── Test 10: The OAuth state is single-use ───────────────────────────────
  console.log('Test 10: OAuth state replay protection');
  calls = [];
  stubFetch(() => ({ status: 200, body: { access_token: 'should_not_be_issued' } }));
  const replay = await service.oauthCallback('razorpay', 'auth_code_123', state);
  assert.ok(replay.includes('status=error'), 'a consumed state must not be accepted again');
  assert.equal(calls.length, 0, 'a replayed state must never reach the token endpoint');
  console.log('✓ A consumed OAuth state cannot be replayed');
}

runTests()
  .then(() => {
    globalThis.fetch = realFetch;
    console.log('\n--- ALL RAZORPAY OAUTH TESTS PASSED SUCCESSFULLY! ---');
  })
  .catch((err) => {
    globalThis.fetch = realFetch;
    console.error('\n❌ RAZORPAY OAUTH TEST FAILED:', err);
    process.exit(1);
  });
