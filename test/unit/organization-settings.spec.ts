import { describe, it, expect, beforeEach } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, OrganizationEntity } from '../../src/database/store';
import { OrganizationStatus } from '../../src/common/enums';
import { OrganizationSettingsService } from '../../src/modules/organizations/settings/organization-settings.service';

describe('OrganizationSettingsService', () => {
  let service: OrganizationSettingsService;
  let testOrgId: string;

  beforeEach(() => {
    service = new OrganizationSettingsService();
    testOrgId = uuidv4();
    const testOrg: OrganizationEntity = {
      id: testOrgId,
      name: 'Acme Test Corp',
      slug: 'acme-test-corp',
      website: 'https://acmetest.example.test',
      industry: 'SaaS',
      companySize: '51-200',
      country: 'US',
      defaultCurrency: 'USD',
      status: OrganizationStatus.ACTIVE,
      onboardingCompleted: true,
      onboardingStatus: 'COMPLETED',
      onboardingStep: 1,
      createdBy: 'usr_admin_1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    dbStore.organizations.push(testOrg);
  });

  it('auto-initializes organization settings with version 1 and calculates completeness', async () => {
    const initial = await service.getSettings(testOrgId);
    expect(initial.settings).toBeDefined();
    expect(initial.settings.organizationId).toBe(testOrgId);
    expect(initial.settings.version).toBe(1);
    expect(initial.settings.language).toBe('en');
    expect(initial.completeness).toBeDefined();
    expect(initial.completeness.totalItems).toBe(8);
  });

  it('updates general section and enforces slug collision protection', async () => {
    const generalRes = await service.updateSection(
      testOrgId,
      'general',
      {
        name: 'Acme Global Corp',
        description: 'Enterprise partner operations platform',
        supportEmail: 'support@acmeglobal.example.test',
        contactEmail: 'hello@acmeglobal.example.test',
      },
      'usr_admin_1'
    );
    expect(generalRes.organization.name).toBe('Acme Global Corp');
    expect(generalRes.settings.description).toBe('Enterprise partner operations platform');
    expect(generalRes.settings.supportEmail).toBe('support@acmeglobal.example.test');

    // Slug collision test
    const otherOrgId = uuidv4();
    dbStore.organizations.push({
      id: otherOrgId,
      name: 'Other Corp',
      slug: 'taken-slug',
      country: 'US',
      defaultCurrency: 'USD',
      status: OrganizationStatus.ACTIVE,
      onboardingCompleted: true,
      onboardingStatus: 'COMPLETED',
      onboardingStep: 1,
      createdBy: 'usr_2',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.updateSection(testOrgId, 'general', { slug: 'taken-slug' }, 'usr_admin_1')
    ).rejects.toThrow();
  });

  it('updates profile, localization, and tracking sections', async () => {
    const profileRes = await service.updateSection(
      testOrgId,
      'profile',
      {
        legalName: 'Acme Global Enterprises LLC',
        addressLine1: '100 Innovation Way',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'US',
        taxId: 'US-987654321',
      },
      'usr_admin_1'
    );
    expect(profileRes.settings.legalName).toBe('Acme Global Enterprises LLC');
    expect(profileRes.settings.taxId).toBe('US-987654321');

    const locRes = await service.updateSection(
      testOrgId,
      'localization',
      {
        defaultCurrency: 'EUR',
        timezone: 'Europe/Berlin',
        dateFormat: 'DD/MM/YYYY',
        weekStartsOn: 'MONDAY',
      },
      'usr_admin_1'
    );
    expect(locRes.organization.defaultCurrency).toBe('EUR');
    expect(locRes.settings.timezone).toBe('Europe/Berlin');
    expect(locRes.settings.dateFormat).toBe('DD/MM/YYYY');

    const trackRes = await service.updateSection(
      testOrgId,
      'tracking',
      {
        defaultAttributionModel: 'LINEAR',
        cookieDurationDays: 60,
        attributionWindowDays: 45,
        referralParam: 'ref',
        crossDomainTracking: true,
      },
      'usr_admin_1'
    );
    expect(trackRes.settings.defaultAttributionModel).toBe('LINEAR');
    expect(trackRes.settings.cookieDurationDays).toBe(60);
    expect(trackRes.settings.referralParam).toBe('ref');
    expect(trackRes.settings.crossDomainTracking).toBe(true);
  });

  it('updates commissions, payouts, domains, and verifies audit logs', async () => {
    const commRes = await service.updateSection(
      testOrgId,
      'commissions',
      {
        defaultCommissionType: 'PERCENTAGE',
        defaultCommissionValue: 2000,
        holdPeriodDays: 45,
      },
      'usr_admin_1'
    );
    expect(commRes.settings.defaultCommissionValue).toBe(2000);
    expect(commRes.settings.holdPeriodDays).toBe(45);

    const payoutRes = await service.updateSection(
      testOrgId,
      'payouts',
      {
        defaultPayoutSchedule: 'BIWEEKLY',
        minimumPayoutAmount: 10000,
        autoApprovePayouts: true,
      },
      'usr_admin_1'
    );
    expect(payoutRes.settings.defaultPayoutSchedule).toBe('BIWEEKLY');
    expect(payoutRes.settings.autoApprovePayouts).toBe(true);

    const domainRes = await service.updateSection(
      testOrgId,
      'domains',
      {
        customDomain: 'partners.acmeglobal.example.test',
      },
      'usr_admin_1'
    );
    expect(domainRes.settings.customDomain).toBe('partners.acmeglobal.example.test');
    expect(domainRes.settings.customDomainStatus).toBe('VERIFIED');
    expect(domainRes.settings.sslStatus).toBe('ACTIVE');

    const orgAudits = dbStore.auditLogs.filter((a) => a.organizationId === testOrgId);
    expect(orgAudits.length).toBeGreaterThanOrEqual(1);
  });

  it('handles data exports, deactivation, and soft-deletion with confirmation slug', async () => {
    const exportBundle = await service.exportData(testOrgId, 'usr_admin_1', { format: 'json' });
    expect(exportBundle.exportId).toBeDefined();
    expect(exportBundle.organization.slug).toBe('acme-test-corp');

    const deactRes = await service.deactivateOrganization(testOrgId, 'usr_admin_1', {
      reason: 'Routine quarterly audit maintenance',
    });
    expect(deactRes.status).toBe(OrganizationStatus.SUSPENDED);

    await expect(
      service.deleteOrganization(testOrgId, 'usr_admin_1', { confirmSlug: 'wrong-slug' })
    ).rejects.toThrow();

    const deleteRes = await service.deleteOrganization(testOrgId, 'usr_admin_1', { confirmSlug: 'acme-test-corp' });
    expect(deleteRes.success).toBe(true);
    const deletedOrg = dbStore.organizations.find((o) => o.id === testOrgId);
    expect(deletedOrg?.deletedAt).toBeDefined();
    expect(deletedOrg?.status).toBe(OrganizationStatus.CLOSED);
  });
});

