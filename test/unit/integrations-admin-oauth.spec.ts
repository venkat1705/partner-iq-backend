import { describe, it, expect, beforeEach } from '@jest/globals';
import { IntegrationsService } from '../../src/modules/integrations/integrations.service';
import { HubSpotService } from '../../src/modules/integrations/hubspot/hubspot.service';
import { IntegrationCredentialService } from '../../src/modules/integrations/integration-credential.service';
import { HubSpotProvider } from '../../src/modules/integrations/providers/hubspot.provider';
import { ZohoCrmProvider } from '../../src/modules/integrations/providers/zoho-crm.provider';
import { RazorpayProvider } from '../../src/modules/integrations/providers/razorpay.provider';
import { CashfreeProvider } from '../../src/modules/integrations/providers/cashfree.provider';
import { IntegrationProviderFactory } from '../../src/modules/integrations/providers/provider.factory';
import { RazorpayTokenService } from '../../src/modules/integrations/razorpay/razorpay-token.service';
import { dbStore } from '../../src/database/store';

describe('Admin Platform OAuth End-to-End Suite', () => {
  let credService: IntegrationCredentialService;
  let service: IntegrationsService;

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

  beforeEach(() => {
    credService = new IntegrationCredentialService();
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
    const razorpayTokenService = new RazorpayTokenService(credService, razorpayProvider);
    service = new IntegrationsService(credService, providerFactory, razorpayTokenService, hubspotService);

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
  });

  it('manages admin platform config lifecycle and restricts non-admins', async () => {
    // 1. Initially unconfigured
    const initialConfig = service.getAdminPlatformConfig(superAdminUser, 'hubspot');
    expect(initialConfig.slug).toBe('hubspot');
    expect(initialConfig.redirectUri.includes('/api/v1/integrations/hubspot/oauth/callback')).toBe(true);
    expect(Array.isArray(initialConfig.requiredScopes)).toBe(true);

    // 2. Saving platform OAuth credentials
    const saved = service.upsertAdminPlatformConfig(superAdminUser, 'hubspot', {
      clientId: 'test-hubspot-client-id-9988',
      clientSecret: 'test-hubspot-secret-supersecret-1234',
      redirectUri: 'https://app.partneriq.io/api/v1/integrations/hubspot/oauth/callback',
      requiredScopes: ['crm.objects.contacts.read', 'crm.objects.deals.read', 'oauth'],
      appId: 'app_98765',
      environment: 'LIVE',
    });
    expect(saved.configured).toBe(true);
    expect(saved.redirectUri).toBe('https://app.partneriq.io/api/v1/integrations/hubspot/oauth/callback');
    expect(saved.clientIdMasked).toBeDefined();
    expect(saved.clientSecretMasked?.endsWith('1234')).toBe(true);

    // 3. Testing OAuth app
    const testRes = await service.testAdminPlatformConfig(superAdminUser, 'hubspot');
    expect(testRes.status).toBe('HEALTHY');
    expect(testRes.configured).toBe(true);

    // 4. Marketplace reflects configured status
    const orgIntegrations = await service.listForOrganization('org_tenant_1');
    const hs = orgIntegrations.integrations.find((i) => i.slug === 'hubspot');
    expect(hs).toBeDefined();
    expect(hs!.platformConfigured).toBe(true);
    expect(hs!.supportsOAuth).toBe(true);

    // 5. Connect OAuth initiation
    const oauthRes = await service.connectOAuth('org_tenant_1', orgUser, 'hubspot', 'https://app.partneriq.io/app/integrations');
    expect(oauthRes.provider).toBe('HUBSPOT');
    expect(oauthRes.authorizationUrl).toBeDefined();
    const url = new URL(oauthRes.authorizationUrl);
    expect(url.searchParams.get('client_id')).toBe('test-hubspot-client-id-9988');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.partneriq.io/api/v1/integrations/hubspot/oauth/callback');
    expect(url.searchParams.get('state')).toBeDefined();

    // 6. Non-admin forbidden
    expect(() => {
      service.upsertAdminPlatformConfig(orgUser, 'hubspot', { clientId: 'malicious' });
    }).toThrow();
  });
});

