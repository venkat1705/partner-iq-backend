import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../database/store';
import { AffiliatesService } from '../modules/affiliates/affiliates.service';
import { TierService } from '../modules/gamification/tiers/tier.service';
import { TierEvaluatorService } from '../modules/gamification/tiers/tier-evaluator.service';
import { EnvironmentType, AffiliateStatus } from '../common/enums';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${name}`, detail ?? '');
    failed++;
  }
}

async function runTests() {
  console.log('--- Starting Affiliate Management & Intelligence Engine Tests ---');

  const testOrgId = uuidv4();
  const testProgramId = uuidv4();

  // Initialize tier evaluator and tier service
  const tierEvaluator = new TierEvaluatorService();
  const tierService = new TierService(tierEvaluator);

  // Initialize service with dependencies
  const affiliatesService = new AffiliatesService(
    { sendAffiliateInvitationEmail: async () => undefined } as any,
    tierService,
    { trigger: async () => undefined, handleEvent: async () => undefined } as any,
  );

  // Seed default tiers for this org in dbStore
  dbStore.partnerTiers.push(
    {
      id: 'tier-bronze',
      organizationId: testOrgId,
      name: 'Bronze',
      code: 'BRONZE',
      level: 1,
      displayOrder: 1,
      icon: 'award',
      badge: '🥉',
      colorToken: 'amber',
      isDefault: true,
      isActive: true,
      isVisibleToAffiliate: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    {
      id: 'tier-silver',
      organizationId: testOrgId,
      name: 'Silver',
      code: 'SILVER',
      level: 2,
      displayOrder: 2,
      icon: 'award',
      badge: '🥈',
      colorToken: 'slate',
      isDefault: false,
      isActive: true,
      isVisibleToAffiliate: true,
      conditions: { minConversions: 20 },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    {
      id: 'tier-gold',
      organizationId: testOrgId,
      name: 'Gold',
      code: 'GOLD',
      level: 3,
      displayOrder: 3,
      icon: 'award',
      badge: '🥇',
      colorToken: 'amber',
      isDefault: false,
      isActive: true,
      isVisibleToAffiliate: true,
      conditions: { minConversions: 50 },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    {
      id: 'tier-platinum',
      organizationId: testOrgId,
      name: 'Platinum',
      code: 'PLATINUM',
      level: 4,
      displayOrder: 4,
      icon: 'crown',
      badge: '💎',
      colorToken: 'indigo',
      isDefault: false,
      isActive: true,
      isVisibleToAffiliate: true,
      conditions: { minConversions: 100 },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
  );

  // Seed Program
  dbStore.programs.push({
    id: testProgramId,
    organizationId: testOrgId,
    name: 'Enterprise Growth Program',
    environment: EnvironmentType.LIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  // 1. Test Baseline Seeding
  console.log('\n1. Testing Baseline Partner Seeding...');
  await affiliatesService.ensureDefaultAffiliates(testOrgId);
  const seeded = dbStore.affiliates.filter((a) => a.organizationId === testOrgId);
  assert(seeded.length >= 4, `Seeded ${seeded.length} partners (expected >= 4)`);

  // 2. Test getAffiliateAnalytics
  console.log('\n2. Testing getAffiliateAnalytics...');
  const analytics = await affiliatesService.getAffiliateAnalytics(testOrgId, EnvironmentType.LIVE, { period: '30d' });
  assert(analytics.totalAffiliates >= 4, `Total affiliates count: ${analytics.totalAffiliates}`);
  assert(analytics.activeAffiliates >= 3, `Active affiliates count: ${analytics.activeAffiliates}`);
  assert(analytics.trajectory.length === 14, `Trajectory has 14 daily data points (got ${analytics.trajectory.length})`);
  assert(analytics.tierDistribution.length >= 4, `Tier distribution includes Bronze, Silver, Gold, Platinum`);
  assert(analytics.networkHealth.awaitingApprovalCount !== undefined, `Network health indicators present`);
  assert(Boolean(analytics.currency), `Currency is set: ${analytics.currency}`);

  // 3. Test getAffiliatesPaginated
  console.log('\n3. Testing getAffiliatesPaginated...');
  const paginated = await affiliatesService.getAffiliatesPaginated(testOrgId, EnvironmentType.LIVE, {
    page: 1,
    limit: 10,
    search: 'Nexus',
  });
  assert(paginated.data.length === 1, `Search by 'Nexus' returned 1 partner (got ${paginated.data.length})`);
  assert(paginated.data[0].displayName.includes('Nexus'), `Partner display name is ${paginated.data[0].displayName}`);
  assert(paginated.data[0].tier !== undefined, `Partner is enriched with tier: ${paginated.data[0].tier?.name}`);
  assert(paginated.data[0].programs.length >= 1, `Partner is enrolled in ${paginated.data[0].programs.length} program(s)`);
  assert(paginated.data[0].metrics.clicks >= 0, `Partner clicks metric is available: ${paginated.data[0].metrics.clicks}`);

  // 4. Test getAffiliateDetail
  console.log('\n4. Testing getAffiliateDetail...');
  const partnerId = paginated.data[0].id;
  const dossier = await affiliatesService.getAffiliateDetail(testOrgId, partnerId, EnvironmentType.LIVE);
  assert(dossier.profile.id === partnerId, `Dossier matches partner ID: ${dossier.profile.id}`);
  assert(dossier.tier.currentTier !== undefined, `Dossier contains current tier: ${dossier.tier.currentTier.name}`);
  assert(dossier.tier.progressPercentage >= 0, `Dossier contains tier progress: ${dossier.tier.progressPercentage}%`);
  assert(Array.isArray(dossier.programs), `Dossier contains enrolled programs array (${dossier.programs.length})`);
  assert(Array.isArray(dossier.trackingLinks), `Dossier contains tracking links array (${dossier.trackingLinks.length})`);
  assert(Array.isArray(dossier.activity), `Dossier contains activity stream (${dossier.activity.length})`);

  // 5. Test bulkUpdateAffiliates
  console.log('\n5. Testing bulkUpdateAffiliates...');
  const bulkRes = await affiliatesService.bulkUpdateAffiliates(testOrgId, {
    affiliateIds: [partnerId],
    action: 'PAUSE',
    reason: 'Temporary routine audit',
  });
  assert(bulkRes.success && bulkRes.updatedCount === 1, `Bulk paused ${bulkRes.updatedCount} partner(s)`);
  const pausedPartner = dbStore.affiliates.find((a) => a.id === partnerId);
  assert(pausedPartner?.status === AffiliateStatus.INACTIVE, `Partner status updated to INACTIVE`);

  // Re-activate partner
  await affiliatesService.bulkUpdateAffiliates(testOrgId, {
    affiliateIds: [partnerId],
    action: 'ACTIVATE',
  });
  const activePartner = dbStore.affiliates.find((a) => a.id === partnerId);
  assert(activePartner?.status === AffiliateStatus.ACTIVE, `Partner status restored to ACTIVE`);

  // 6. Test updateAffiliateTier
  console.log('\n6. Testing updateAffiliateTier...');
  const tierRes = await affiliatesService.updateAffiliateTier(testOrgId, partnerId, {
    tierId: 'tier-gold',
    isLocked: true,
    lockReason: 'VIP Partnership Override',
  });
  assert(tierRes !== undefined, `Tier updated and locked successfully`);

  // 7. Test exportAffiliatesCsv
  console.log('\n7. Testing exportAffiliatesCsv...');
  const csv = await affiliatesService.exportAffiliatesCsv(testOrgId, EnvironmentType.LIVE);
  assert(csv.startsWith('affiliate_id,display_name,email'), `CSV header is correctly formatted`);
  assert(csv.includes('Nexus Media Collective'), `CSV contains seeded partner data`);

  console.log(`\n===================================`);
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`===================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
