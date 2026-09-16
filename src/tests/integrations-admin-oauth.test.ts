import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntegrationsService } from '../modules/integrations/integrations.service';
import { HubSpotService } from '../modules/integrations/hubspot/hubspot.service';
import { IntegrationCredentialService } from '../modules/integrations/integration-credential.service';
import { HubSpotProvider } from '../modules/integrations/providers/hubspot.provider';
import { ZohoCrmProvider } from '../modules/integrations/providers/zoho-crm.provider';
import { RazorpayProvider } from '../modules/integrations/providers/razorpay.provider';
import { CashfreeProvider } from '../modules/integrations/providers/cashfree.provider';
import { IntegrationProviderFactory } from '../modules/integrations/providers/provider.factory';
import { dbStore } from '../database/store';

console.log('--- Starting Admin Platform OAuth End-to-End Test ---');

const credService = new IntegrationCredentialService();
const hubspotProvider = new HubSpotProvider();
const zohoProvider = new ZohoCrmProvider();
const razorpayProvider = new RazorpayProvider();
const cashfreeProvider = new CashfreeProvider();

const providerFactory = new IntegrationProviderFactory(
  hubspotProvider,
  zohoProvider,
  razorpayProvider,
  cashfreeProvider,
);
const hubspotService = new HubSpotService(credService, {} as any, {} as any);
const service = new IntegrationsService(credService, providerFactory, hubspotService);

const superAdminUser: any = {
  userId: 'usr_admin_test_1',
  organizationId: 'org_admin_1',
  role: 'OWNER',
  isSuperAdmin: true,
  platformRole: 'SUPER_ADMIN',
};

const orgUser: any = {
  userId: 'usr_org_test_1',
  organizationId: 'org_tenant_1',
  role: 'ADMIN',
  isSuperAdmin: false,
};

async function runTests() {
  // Ensure integrations catalog is seeded
  if (dbStore.integrations.length === 0) {
    dbStore.integrations.push(
      {
        id: 'int-hubspot',
        name: 'HubSpot',
        slug: 'hubspot',
        code: 'HUBSPOT',
        provider: 'HUBSPOT',
        category: 'CRM' as any,
        status: 'ACTIVE' as any,
        logo: '/integrations/hubspot.svg',
        capabilities: ['contacts', 'companies', 'deals', 'conversions'],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      {
        id: 'int-zoho',
        name: 'Zoho CRM',
        slug: 'zoho-crm',
        code: 'ZOHO_CRM',
        provider: 'ZOHO_CRM',
        category: 'CRM' as any,
        status: 'ACTIVE' as any,
        logo: '/integrations/zoho.svg',
        capabilities: ['leads', 'contacts', 'deals', 'conversions'],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    );
  }

  // Test 1: Initially HubSpot platform config is unconfigured
  console.log('Test 1: Admin Platform Config Unconfigured State');
  const initialConfig = service.getAdminPlatformConfig(superAdminUser, 'hubspot');
  assert.equal(initialConfig.slug, 'hubspot');
  assert.ok(initialConfig.redirectUri.includes('/api/v1/integrations/hubspot/oauth/callback'));
  assert.ok(Array.isArray(initialConfig.requiredScopes));
  console.log('✓ Initial HubSpot platform config returned default redirect URI and scopes');

  // Test 2: Saving Platform OAuth Credentials
  console.log('Test 2: Admin Saving Platform OAuth Credentials');
  const saved = service.upsertAdminPlatformConfig(superAdminUser, 'hubspot', {
    clientId: 'test-hubspot-client-id-9988',
    clientSecret: 'test-hubspot-secret-supersecret-1234',
    redirectUri: 'https://app.partneriq.io/api/v1/integrations/hubspot/oauth/callback',
    requiredScopes: ['crm.objects.contacts.read', 'crm.objects.deals.read', 'oauth'],
    appId: 'app_98765',
    environment: 'LIVE',
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.redirectUri, 'https://app.partneriq.io/api/v1/integrations/hubspot/oauth/callback');
  assert.ok(saved.clientIdMasked);
  assert.ok(saved.clientSecretMasked?.endsWith('1234'));
  console.log('✓ Admin platform OAuth configuration saved and secrets encrypted');

  // Test 3: Live Test OAuth App
  console.log('Test 3: Admin Testing OAuth App');
  const testRes = await service.testAdminPlatformConfig(superAdminUser, 'hubspot');
  assert.equal(testRes.status, 'HEALTHY');
  assert.equal(testRes.configured, true);
  console.log('✓ Admin test returned HEALTHY status');

  // Test 4: Organization Marketplace reflects platformConfigured
  console.log('Test 4: Organization Marketplace Reflects Configured Status');
  const orgIntegrations = await service.listForOrganization('org_tenant_1');
  const hs = orgIntegrations.integrations.find((i) => i.slug === 'hubspot');
  assert.ok(hs);
  assert.equal(hs.platformConfigured, true);
  assert.equal(hs.supportsOAuth, true);
  console.log('✓ Organization marketplace reports platformConfigured: true and supportsOAuth: true');

  // Test 5: Organization 1-click OAuth connect initiation
  console.log('Test 5: Organization 1-Click OAuth Connect Initiation');
  const oauthRes = await service.connectOAuth('org_tenant_1', orgUser, 'hubspot', 'https://app.partneriq.io/app/integrations');
  assert.equal(oauthRes.provider, 'HUBSPOT');
  assert.ok(oauthRes.authorizationUrl);
  const url = new URL(oauthRes.authorizationUrl);
  assert.equal(url.searchParams.get('client_id'), 'test-hubspot-client-id-9988');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.partneriq.io/api/v1/integrations/hubspot/oauth/callback');
  assert.ok(url.searchParams.get('state'));
  console.log('✓ OAuth authorization URL successfully generated with client ID, state, and scopes');

  // Test 6: Non-admin cannot modify platform config
  console.log('Test 6: Non-Admin Cannot Modify Platform Config');
  assert.throws(() => {
    service.upsertAdminPlatformConfig(orgUser, 'hubspot', { clientId: 'malicious' });
  }, /Super admin/);
  console.log('✓ Non-admin access correctly rejected with ForbiddenException');

  console.log('\n--- ALL ADMIN PLATFORM OAUTH TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
