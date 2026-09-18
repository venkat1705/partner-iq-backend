import assert from 'assert';
import { dbStore } from '../database/store';
import { IntegrationStatus, OrganizationIntegrationStatus, PlatformRole } from '../common/enums';
import { IntegrationCredentialService } from '../modules/integrations/integration-credential.service';
import { HubSpotProvider } from '../modules/integrations/providers/hubspot.provider';
import { ZohoCrmProvider } from '../modules/integrations/providers/zoho-crm.provider';
import { RazorpayProvider } from '../modules/integrations/providers/razorpay.provider';
import { CashfreeProvider } from '../modules/integrations/providers/cashfree.provider';
import { IntegrationProviderFactory } from '../modules/integrations/providers/provider.factory';
import { IntegrationsService } from '../modules/integrations/integrations.service';
import { RazorpayTokenService } from '../modules/integrations/razorpay/razorpay-token.service';

async function runIntegrationsTest() {
  console.log('--- Starting Integrations Marketplace End-to-End Test ---');

  const credentialService = new IntegrationCredentialService();
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

  const razorpayTokenService = new RazorpayTokenService(credentialService, razorpayProvider);
  const integrationsService = new IntegrationsService(credentialService, providerFactory, razorpayTokenService);

  // 1. Check Provider Factory
  console.log('Test 1: Provider Factory lookup');
  assert(providerFactory.hasProvider('HUBSPOT'), 'HubSpot provider not registered');
  assert(providerFactory.hasProvider('ZOHO_CRM'), 'Zoho CRM provider not registered');
  assert(providerFactory.hasProvider('RAZORPAY'), 'Razorpay provider not registered');
  assert(providerFactory.hasProvider('CASHFREE'), 'Cashfree provider not registered');
  console.log('✓ All 4 providers correctly registered in factory');

  // 2. Test Credential Encryption & Decryption
  console.log('Test 2: AES-256-GCM Credential Storage');
  const testConnId = 'test-conn-123';
  credentialService.storeCredentials(testConnId, {
    keyId: 'rzp_test_1234567890',
    keySecret: 'mySuperSecretKey999',
  });

  const storedCreds = credentialService.getAllCredentials(testConnId);
  assert.strictEqual(storedCreds.keyId, 'rzp_test_1234567890');
  assert.strictEqual(storedCreds.keySecret, 'mySuperSecretKey999');

  // Verify raw ciphertext in dbStore is NOT plain text
  const rawDbEntry = dbStore.integrationCredentials.find(
    (c) => c.organizationIntegrationId === testConnId && c.credentialKey === 'keySecret',
  );
  assert(rawDbEntry, 'Database entry not found');
  assert.notStrictEqual(rawDbEntry.encryptedValue, 'mySuperSecretKey999');
  assert(rawDbEntry.iv, 'IV is missing');
  assert(rawDbEntry.authTag, 'AuthTag is missing');
  console.log('✓ Credentials encrypted with AES-256-GCM and decrypted correctly');

  // 3. Test Masking Credentials
  console.log('Test 3: Credential Masking');
  const maskedHubSpot = hubspotProvider.maskCredentials({ privateAppToken: 'pat-na1-12345678-abcdefgh' });
  assert.strictEqual(maskedHubSpot.privateAppToken, '••••••••••••efgh');

  const maskedRazorpay = razorpayProvider.maskCredentials({ keyId: 'rzp_test_1234567890', keySecret: 'secret123' });
  assert.strictEqual(maskedRazorpay.keyId, '••••••••••••7890');
  assert.strictEqual(maskedRazorpay.keySecret, '••••••••••••');
  console.log('✓ Masking works properly and conceals all secrets');

  // 4. Test Live Credential Verification with invalid keys (should reject properly without crash)
  console.log('Test 4: Outbound Credential Testing');
  const rzpResult = await razorpayProvider.testConnection({ keyId: 'invalid_key', keySecret: 'invalid_secret' }, 'TEST');
  assert.strictEqual(rzpResult.success, false);
  assert(rzpResult.message.includes('rejected') || rzpResult.message.includes('error'), 'Unexpected failure message');
  console.log('✓ Razorpay test returns real rejection message:', rzpResult.message);

  const hubspotResult = await hubspotProvider.testConnection({ privateAppToken: 'invalid_token' });
  assert.strictEqual(hubspotResult.success, false);
  console.log('✓ HubSpot test returns real rejection message:', hubspotResult.message);

  // 5. Seed Catalog Check
  console.log('Test 5: Integration Catalog in dbStore');
  // Seed dbStore with the 4 integrations if empty
  if (dbStore.integrations.length === 0) {
    dbStore.integrations.push(
      {
        id: 'int-hubspot',
        name: 'HubSpot',
        slug: 'hubspot',
        code: 'HUBSPOT',
        provider: 'HUBSPOT',
        category: 'CRM' as any,
        status: IntegrationStatus.ACTIVE,
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
        status: IntegrationStatus.ACTIVE,
        logo: '/integrations/zoho.svg',
        capabilities: ['leads', 'contacts', 'deals', 'conversions'],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      {
        id: 'int-razorpay',
        name: 'Razorpay',
        slug: 'razorpay',
        code: 'RAZORPAY',
        provider: 'RAZORPAY',
        category: 'PAYMENTS' as any,
        status: IntegrationStatus.ACTIVE,
        logo: '/integrations/razorpay.svg',
        capabilities: ['payments', 'orders', 'refunds', 'customers', 'webhooks'],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      {
        id: 'int-cashfree',
        name: 'Cashfree',
        slug: 'cashfree',
        code: 'CASHFREE',
        provider: 'CASHFREE',
        category: 'PAYMENTS' as any,
        status: IntegrationStatus.ACTIVE,
        logo: '/integrations/cashfree.svg',
        capabilities: ['payments', 'orders', 'refunds', 'customers', 'webhooks'],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    );
  }

  const orgId = 'test-org-001';
  const orgMarketplace = integrationsService.listForOrganization(orgId);
  assert.strictEqual(orgMarketplace.integrations.length, 4);
  assert.strictEqual(orgMarketplace.totalConnected, 0);
  console.log('✓ Organization marketplace returns all 4 integrations with totalConnected: 0');

  // 6. Admin Listing & Metrics
  console.log('Test 6: Admin Integration APIs');
  const adminUser: any = { userId: 'admin-1', isSuperAdmin: true, platformRole: PlatformRole.SUPER_ADMIN };
  const adminList = integrationsService.listAdminIntegrations(adminUser);
  assert.strictEqual(adminList.length, 4);
  assert(adminList.every((i) => i.logo && i.logo.startsWith('/integrations/')), 'Logos not populated');
  assert(adminList.every((i) => i.health === 'Healthy'), 'Initial health should be Healthy');

  const adminHealth = integrationsService.getAdminHealth(adminUser);
  assert.strictEqual(adminHealth.length, 4);
  console.log('✓ Admin listing & health return 4 healthy integrations');

  // 7. Status Toggle (Active -> Coming Soon -> Active)
  console.log('Test 7: Status Toggle by Admin');
  integrationsService.updateStatus(adminUser, 'hubspot', IntegrationStatus.COMING_SOON);
  const updatedHubspot = integrationsService.getForOrganization(orgId, 'hubspot');
  assert.strictEqual(updatedHubspot.status, IntegrationStatus.COMING_SOON);

  // Restore to ACTIVE
  integrationsService.updateStatus(adminUser, 'hubspot', IntegrationStatus.ACTIVE);
  const restoredHubspot = integrationsService.getForOrganization(orgId, 'hubspot');
  assert.strictEqual(restoredHubspot.status, IntegrationStatus.ACTIVE);
  console.log('✓ Admin can toggle status, correctly reflected in organization view');

  console.log('--- ALL INTEGRATIONS TESTS PASSED SUCCESSFULLY! ---');
}

runIntegrationsTest().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});

