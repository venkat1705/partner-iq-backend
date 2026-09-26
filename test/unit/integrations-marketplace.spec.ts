import { describe, it, expect, beforeEach } from '@jest/globals';
import { dbStore } from '../../src/database/store';
import { IntegrationStatus, PlatformRole } from '../../src/common/enums';
import { IntegrationCredentialService } from '../../src/modules/integrations/integration-credential.service';
import { HubSpotProvider } from '../../src/modules/integrations/providers/hubspot.provider';
import { ZohoCrmProvider } from '../../src/modules/integrations/providers/zoho-crm.provider';
import { RazorpayProvider } from '../../src/modules/integrations/providers/razorpay.provider';
import { CashfreeProvider } from '../../src/modules/integrations/providers/cashfree.provider';
import { IntegrationProviderFactory } from '../../src/modules/integrations/providers/provider.factory';
import { IntegrationsService } from '../../src/modules/integrations/integrations.service';
import { RazorpayTokenService } from '../../src/modules/integrations/razorpay/razorpay-token.service';

describe('Integrations Marketplace End-to-End Suite', () => {
  let credentialService: IntegrationCredentialService;
  let hubspotProvider: HubSpotProvider;
  let razorpayProvider: RazorpayProvider;
  let providerFactory: IntegrationProviderFactory;
  let integrationsService: IntegrationsService;

  beforeEach(() => {
    credentialService = new IntegrationCredentialService();
    hubspotProvider = new HubSpotProvider();
    const zohoProvider = new ZohoCrmProvider();
    razorpayProvider = new RazorpayProvider();
    const cashfreeProvider = new CashfreeProvider();

    providerFactory = new IntegrationProviderFactory(
      hubspotProvider,
      zohoProvider,
      razorpayProvider,
      cashfreeProvider,
    );

    const razorpayTokenService = new RazorpayTokenService(credentialService, razorpayProvider);
    integrationsService = new IntegrationsService(credentialService, providerFactory, razorpayTokenService);

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
  });

  it('registers all 4 providers in factory', () => {
    expect(providerFactory.hasProvider('HUBSPOT')).toBe(true);
    expect(providerFactory.hasProvider('ZOHO_CRM')).toBe(true);
    expect(providerFactory.hasProvider('RAZORPAY')).toBe(true);
    expect(providerFactory.hasProvider('CASHFREE')).toBe(true);
  });

  it('encrypts credentials with AES-256-GCM and decrypts correctly', () => {
    const testConnId = 'test-conn-123';
    credentialService.storeCredentials(testConnId, {
      keyId: 'rzp_test_1234567890',
      keySecret: 'mySuperSecretKey999',
    });

    const storedCreds = credentialService.getAllCredentials(testConnId);
    expect(storedCreds.keyId).toBe('rzp_test_1234567890');
    expect(storedCreds.keySecret).toBe('mySuperSecretKey999');

    const rawDbEntry = dbStore.integrationCredentials.find(
      (c) => c.organizationIntegrationId === testConnId && c.credentialKey === 'keySecret',
    );
    expect(rawDbEntry).toBeDefined();
    expect(rawDbEntry!.encryptedValue).not.toBe('mySuperSecretKey999');
    expect(rawDbEntry!.iv).toBeDefined();
    expect(rawDbEntry!.authTag).toBeDefined();
  });

  it('masks credentials safely for user presentation', () => {
    const maskedHubSpot = hubspotProvider.maskCredentials({ privateAppToken: 'pat-na1-12345678-abcdefgh' });
    expect(maskedHubSpot.privateAppToken).toBe('••••••••••••efgh');

    const maskedRazorpay = razorpayProvider.maskCredentials({ keyId: 'rzp_test_1234567890', keySecret: 'secret123' });
    expect(maskedRazorpay.keyId).toBe('••••••••••••7890');
    expect(maskedRazorpay.keySecret).toBe('••••••••••••');
  });

  it('gracefully handles live credential tests with invalid keys', async () => {
    const rzpResult = await razorpayProvider.testConnection({ keyId: 'invalid_key', keySecret: 'invalid_secret' }, 'TEST');
    expect(rzpResult.success).toBe(false);

    const hubspotResult = await hubspotProvider.testConnection({ privateAppToken: 'invalid_token' });
    expect(hubspotResult.success).toBe(false);
  });

  it('lists organization integrations and manages admin status toggles', async () => {
    const orgId = 'test-org-001';
    const orgMarketplace = integrationsService.listForOrganization(orgId);
    expect(orgMarketplace.integrations.length).toBe(4);
    expect(orgMarketplace.totalConnected).toBe(0);

    const adminUser: any = { userId: 'admin-1', isSuperAdmin: true, platformRole: PlatformRole.SUPER_ADMIN };
    const adminList = integrationsService.listAdminIntegrations(adminUser);
    expect(adminList.length).toBe(4);
    expect(adminList.every((i) => i.logo && i.logo.startsWith('/integrations/'))).toBe(true);

    const adminHealth = integrationsService.getAdminHealth(adminUser);
    expect(adminHealth.length).toBe(4);

    // Status toggle
    integrationsService.updateStatus(adminUser, 'hubspot', IntegrationStatus.COMING_SOON);
    const updatedHubspot = integrationsService.getForOrganization(orgId, 'hubspot');
    expect(updatedHubspot.status).toBe(IntegrationStatus.COMING_SOON);

    // Restore to ACTIVE
    integrationsService.updateStatus(adminUser, 'hubspot', IntegrationStatus.ACTIVE);
    const restoredHubspot = integrationsService.getForOrganization(orgId, 'hubspot');
    expect(restoredHubspot.status).toBe(IntegrationStatus.ACTIVE);
  });
});

