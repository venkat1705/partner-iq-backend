import assert from 'node:assert';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, OrganizationEntity } from '../database/store';
import { OrganizationStatus } from '../common/enums';
import { OrganizationSettingsService } from '../modules/organizations/settings/organization-settings.service';

async function runTests() {
  console.log('🧪 Starting Organization Settings Verification Suite...\n');

  const service = new OrganizationSettingsService();

  // Seed test organization
  const testOrgId = uuidv4();
  const testOrg: OrganizationEntity = {
    id: testOrgId,
    name: 'Acme Test Corp',
    slug: 'acme-test-corp',
    website: 'https://acmetest.com',
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

  // 1. Initial settings resolution
  const initial = await service.getSettings(testOrgId);
  assert.ok(initial.settings, 'Settings should be created');
  assert.strictEqual(initial.settings.organizationId, testOrgId);
  assert.strictEqual(initial.settings.version, 1);
  assert.strictEqual(initial.settings.language, 'en');
  console.log('✅ PASS: Organization settings auto-initialized with version 1');

  // 2. Completeness calculation
  assert.ok(initial.completeness, 'Completeness should be computed');
  assert.ok(initial.completeness.totalItems === 8, 'Checklist should have 8 milestones');
  console.log(`✅ PASS: Completeness score calculated (${initial.completeness.score}%)`);

  // 3. General section update
  const generalRes = await service.updateSection(
    testOrgId,
    'general',
    {
      name: 'Acme Global Corp',
      description: 'Enterprise partner operations platform',
      supportEmail: 'support@acmeglobal.com',
      contactEmail: 'hello@acmeglobal.com',
    },
    'usr_admin_1'
  );
  assert.strictEqual(generalRes.organization.name, 'Acme Global Corp');
  assert.strictEqual(generalRes.settings.description, 'Enterprise partner operations platform');
  assert.strictEqual(generalRes.settings.supportEmail, 'support@acmeglobal.com');
  console.log('✅ PASS: General section updated organization and settings identity');

  // 4. Slug collision check
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

  try {
    await service.updateSection(testOrgId, 'general', { slug: 'taken-slug' }, 'usr_admin_1');
    assert.fail('Should have thrown ConflictException on slug collision');
  } catch (err: any) {
    assert.strictEqual(err.status, 409);
    console.log('✅ PASS: Slug collision protection strictly rejected duplicate slug');
  }

  // 5. Profile section update
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
  assert.strictEqual(profileRes.settings.legalName, 'Acme Global Enterprises LLC');
  assert.strictEqual(profileRes.settings.taxId, 'US-987654321');
  console.log('✅ PASS: Organization profile legal entity & physical address updated');

  // 6. Localization section update
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
  assert.strictEqual(locRes.organization.defaultCurrency, 'EUR');
  assert.strictEqual(locRes.settings.timezone, 'Europe/Berlin');
  assert.strictEqual(locRes.settings.dateFormat, 'DD/MM/YYYY');
  console.log('✅ PASS: Localization currency, timezone, and date format updated');

  // 7. Tracking & Attribution section update
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
  assert.strictEqual(trackRes.settings.defaultAttributionModel, 'LINEAR');
  assert.strictEqual(trackRes.settings.cookieDurationDays, 60);
  assert.strictEqual(trackRes.settings.referralParam, 'ref');
  assert.strictEqual(trackRes.settings.crossDomainTracking, true);
  console.log('✅ PASS: Tracking & Attribution model and cookie window updated');

  // 8. Commissions & Payouts updates
  const commRes = await service.updateSection(
    testOrgId,
    'commissions',
    {
      defaultCommissionType: 'PERCENTAGE',
      defaultCommissionValue: 2000, // 20%
      holdPeriodDays: 45,
    },
    'usr_admin_1'
  );
  assert.strictEqual(commRes.settings.defaultCommissionValue, 2000);
  assert.strictEqual(commRes.settings.holdPeriodDays, 45);

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
  assert.strictEqual(payoutRes.settings.defaultPayoutSchedule, 'BIWEEKLY');
  assert.strictEqual(payoutRes.settings.autoApprovePayouts, true);
  console.log('✅ PASS: Organization commission and payout preferences updated');

  // 9. Domains update
  const domainRes = await service.updateSection(
    testOrgId,
    'domains',
    {
      customDomain: 'partners.acmeglobal.com',
    },
    'usr_admin_1'
  );
  assert.strictEqual(domainRes.settings.customDomain, 'partners.acmeglobal.com');
  assert.strictEqual(domainRes.settings.customDomainStatus, 'VERIFIED');
  assert.strictEqual(domainRes.settings.sslStatus, 'ACTIVE');
  console.log('✅ PASS: Custom domain configuration registered and verified');

  // 10. Audit logging verification
  const orgAudits = dbStore.auditLogs.filter((a) => a.organizationId === testOrgId);
  assert.ok(orgAudits.length >= 6, 'Audit logs should record each mutation');
  assert.ok(orgAudits.some((a) => (a.action as string) === 'organization.settings.tracking.updated'));
  console.log(`✅ PASS: Centralized audit log recorded ${orgAudits.length} setting changes`);

  // 11. Data Export
  const exportBundle = await service.exportData(testOrgId, 'usr_admin_1', { format: 'json' });
  assert.ok(exportBundle.exportId, 'Export ID should be generated');
  assert.strictEqual(exportBundle.organization.slug, 'acme-test-corp');
  console.log('✅ PASS: Organization data export bundle generated successfully');

  // 12. Danger zone: Deactivation
  const deactRes = await service.deactivateOrganization(testOrgId, 'usr_admin_1', {
    reason: 'Routine quarterly audit maintenance',
  });
  assert.strictEqual(deactRes.status, OrganizationStatus.SUSPENDED);
  console.log('✅ PASS: Organization safely suspended with audit explanation');

  // 13. Danger zone: Deletion
  try {
    await service.deleteOrganization(testOrgId, 'usr_admin_1', { confirmSlug: 'wrong-slug' });
    assert.fail('Should reject mismatched slug deletion');
  } catch (err: any) {
    assert.strictEqual(err.status, 400);
    console.log('✅ PASS: Deletion rejected mismatched confirmation slug');
  }

  const deleteRes = await service.deleteOrganization(testOrgId, 'usr_admin_1', { confirmSlug: 'acme-test-corp' });
  assert.ok(deleteRes.success);
  const deletedOrg = dbStore.organizations.find((o) => o.id === testOrgId);
  assert.ok(deletedOrg?.deletedAt, 'deletedAt should be set on organization');
  assert.strictEqual(deletedOrg?.status, OrganizationStatus.CLOSED);
  console.log('✅ PASS: Organization soft-deleted successfully after slug match verification');

  console.log('\n========================================');
  console.log('Results: 13 passed, 0 failed');
  console.log('========================================\n');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
