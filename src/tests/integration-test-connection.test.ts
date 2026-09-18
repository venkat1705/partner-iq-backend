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

console.log('--- Starting Test-Connection Regression Test ---');

const credService = new IntegrationCredentialService();
const razorpayProvider = new RazorpayProvider();
const zohoProvider = new ZohoCrmProvider();
const providerFactory = new IntegrationProviderFactory(
  new HubSpotProvider(),
  zohoProvider,
  razorpayProvider,
  new CashfreeProvider(),
);
const service = new IntegrationsService(
  credService,
  providerFactory,
  new RazorpayTokenService(credService, razorpayProvider),
);

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

/** Registers a catalog entry plus a CONNECTED org connection holding OAuth tokens. */
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

async function runTests() {
  // ── Test 1: A Zoho OAuth connection is testable with its access token ────
  console.log('Test 1: Zoho OAuth connection uses its access token');
  const zohoConn = seedOAuthConnection('zoho-crm', 'ZOHO_CRM', 'int-zoho-tc');
  stubFetch(() => ({ status: 200, body: { org: [{ company_name: 'Acme' }] } }));
  const zohoResult = await service.testConnection(ORG_ID, 'zoho-crm');
  assert.equal(zohoResult.success, true, `expected success, got: ${zohoResult.message}`);
  assert.equal(lastAuthHeader, 'Zoho-oauthtoken zoho-crm_access_token');
  assert.equal(zohoConn.status, OrganizationIntegrationStatus.CONNECTED);
  console.log('✓ Zoho OAuth connection verifies instead of reporting a missing API key');

  // ── Test 2: Cashfree OAuth without a Partner API Key is inconclusive ─────
  console.log('Test 2: Cashfree OAuth connection without a Partner API Key');
  const cfConn = seedOAuthConnection('cashfree', 'CASHFREE', 'int-cashfree-tc');
  cfConn.config.externalAccountId = 'CF_MERCHANT_9001';
  const cfUnconfigured = await service.testConnection(ORG_ID, 'cashfree');
  assert.equal(cfUnconfigured.inconclusive, true);
  assert.match(cfUnconfigured.message, /Partner API Key is not configured/);
  assert.equal(
    cfConn.status,
    OrganizationIntegrationStatus.CONNECTED,
    'a missing platform key is our gap, not a broken connection',
  );
  console.log('✓ Missing Partner API Key reports actionably without disconnecting');

  // ── Test 3: Cashfree OAuth is genuinely verified via partner auth ────────
  console.log('Test 3: Cashfree OAuth verified with partner headers');
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
  assert.equal(cfVerified.success, true, `expected success, got: ${cfVerified.message}`);
  assert.ok(!cfVerified.inconclusive, 'a real partner-authenticated call reaches a verdict');
  assert.equal(cfHeaders['x-partner-apikey'], 'cf_partner_api_key_123');
  assert.equal(cfHeaders['x-partner-merchantid'], 'CF_MERCHANT_9001');
  assert.equal(cfHeaders['x-client-id'], undefined, 'partner auth must not send merchant key headers');
  assert.ok(cfUrl.startsWith('https://sandbox.cashfree.com/pg/orders'), `unexpected url: ${cfUrl}`);
  assert.equal(cfConn.status, OrganizationIntegrationStatus.CONNECTED);
  console.log('✓ Cashfree OAuth verified with x-partner-apikey + x-partner-merchantid against sandbox');

  // ── Test 4: A revoked Cashfree authorization is reported as broken ───────
  console.log('Test 4: Cashfree partner rejection marks the connection ERROR');
  stubFetch(() => ({ status: 401, body: { message: 'unauthorized' } }));
  const cfRejected = await service.testConnection(ORG_ID, 'cashfree');
  assert.equal(cfRejected.success, false);
  assert.ok(!cfRejected.inconclusive);
  assert.match(cfRejected.message, /reconnect your Cashfree account/i);
  assert.equal(cfConn.status, OrganizationIntegrationStatus.ERROR);
  console.log('✓ A revoked Cashfree authorization surfaces as ERROR');

  // ── Test 5: A network blip never disconnects a healthy connection ────────
  console.log('Test 5: Network failure does not disconnect');
  const rzpConn = seedOAuthConnection('razorpay', 'RAZORPAY', 'int-razorpay-tc');
  stubFetch(() => Promise.reject(new Error('ECONNRESET')));
  const blip = await service.testConnection(ORG_ID, 'razorpay');
  assert.equal(blip.success, false);
  assert.equal(blip.inconclusive, true);
  assert.equal(
    rzpConn.status,
    OrganizationIntegrationStatus.CONNECTED,
    'a transport failure is not a credential rejection',
  );
  assert.equal(rzpConn.lastError, undefined, 'a blip must not stamp an error on the connection');
  console.log('✓ A network blip leaves the connection CONNECTED and unmarked');

  // ── Test 6: A genuine rejection still marks the connection broken ────────
  console.log('Test 6: A real rejection still marks the connection as ERROR');
  stubFetch(() => ({ status: 401, body: { error: { description: 'unauthorized' } } }));
  const rejected = await service.testConnection(ORG_ID, 'razorpay');
  assert.equal(rejected.success, false);
  assert.ok(!rejected.inconclusive, 'a 401 is a definitive verdict, not an inconclusive one');
  assert.equal(rzpConn.status, OrganizationIntegrationStatus.ERROR);
  assert.ok(rzpConn.lastError);
  console.log('✓ A genuine 401 still marks the connection ERROR, so real breakage surfaces');
}

runTests()
  .then(() => {
    globalThis.fetch = realFetch;
    console.log('\n--- ALL TEST-CONNECTION REGRESSION TESTS PASSED! ---');
  })
  .catch((err) => {
    globalThis.fetch = realFetch;
    console.error('\n❌ TEST-CONNECTION REGRESSION TEST FAILED:', err);
    process.exit(1);
  });
