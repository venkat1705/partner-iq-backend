/**
 * Standalone sanity check for AnalyticsService — exercises the pure calculation
 * logic against fabricated dbStore records, without needing a running server or
 * database. Not part of the permanent test suite; run manually with:
 *   npx tsx src/tests/analytics-sanity-check.ts
 */
import { dbStore } from '../database/store';
import { AnalyticsService } from '../modules/analytics/analytics.service';
import { AffiliateStatus, ConversionStatus, EnvironmentType, PayoutStatus, ProgramStatus, CommissionType } from '../common/enums';

const orgId = 'org-test-1';
const programId = 'prog-test-1';
const affiliateId = 'aff-test-1';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

// ── Test 1: empty organization — everything should be zero/null, never NaN/Infinity ──
{
  const service = new AnalyticsService();
  const overview = service.getOrganizationOverview('org-empty', EnvironmentType.LIVE);
  assert(overview.revenue.totalRevenue === 0, 'empty org: totalRevenue is 0');
  assert(overview.revenue.revenueMoMPercent === null, 'empty org: revenueMoMPercent is null, not NaN');
  assert(overview.conversions.conversionRate === null, 'empty org: conversionRate is null (no clicks), not 0/NaN');
  assert(overview.mrr.mrr === null, 'empty org: mrr is null (no subscription)');
  assert(overview.revenue.hasData === false, 'empty org: revenue.hasData is false');
}

// ── Test 2: organization with real conversion/commission/payout data ──
{
  dbStore.programs.push({
    id: programId,
    organizationId: orgId,
    name: 'Test Program',
    slug: 'test-program',
    type: 'AFFILIATE' as any,
    status: ProgramStatus.ACTIVE,
    currency: 'USD',
    commissionType: CommissionType.PERCENTAGE,
    defaultCommissionValue: 1500,
    attributionModel: 'LAST_CLICK' as any,
    cookieDurationDays: 30,
    affiliateApprovalMode: 'MANUAL' as any,
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  dbStore.affiliates.push({
    id: affiliateId,
    organizationId: orgId,
    displayName: 'Test Affiliate',
    email: 'affiliate@example.com',
    country: 'US',
    status: AffiliateStatus.ACTIVE,
    trustScore: 80,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  dbStore.clicks.push(
    { id: 'click-1', organizationId: orgId, environment: EnvironmentType.LIVE, programId, affiliateId, trackingLinkId: 'tl-1', anonymousId: 'anon-1', ipHash: 'x', createdAt: new Date() } as any,
    { id: 'click-2', organizationId: orgId, environment: EnvironmentType.LIVE, programId, affiliateId, trackingLinkId: 'tl-1', anonymousId: 'anon-2', ipHash: 'x', createdAt: new Date() } as any,
  );

  dbStore.conversions.push(
    { id: 'conv-1', organizationId: orgId, environment: EnvironmentType.LIVE, programId, affiliateId, amount: 10000, currency: 'USD', status: ConversionStatus.APPROVED, occurredAt: new Date(), createdAt: new Date() } as any,
    { id: 'conv-2', organizationId: orgId, environment: EnvironmentType.LIVE, programId, affiliateId: undefined, amount: 5000, currency: 'USD', status: ConversionStatus.PENDING, occurredAt: new Date(), createdAt: new Date() } as any,
  );

  dbStore.commissions.push(
    { id: 'comm-1', organizationId: orgId, environment: EnvironmentType.LIVE, programId, affiliateId, conversionId: 'conv-1', rate: 1500, baseAmount: 10000, commissionAmount: 1500, calculationVersion: 'v1', status: ConversionStatus.APPROVED, createdAt: new Date() } as any,
  );

  dbStore.payoutItems.push(
    { id: 'pi-1', batchId: 'batch-1', organizationId: orgId, environment: EnvironmentType.LIVE, affiliateId, amount: 1000, currency: 'USD', status: PayoutStatus.COMPLETED, createdAt: new Date() } as any,
  );

  const service = new AnalyticsService();

  const revenue = service.getOrganizationRevenueMetrics(orgId, EnvironmentType.LIVE);
  assert(revenue.totalRevenue === 10000, `revenue.totalRevenue is 10000 (got ${revenue.totalRevenue})`);
  assert(revenue.attributedRevenue === 10000, 'revenue.attributedRevenue excludes the PENDING conversion');
  assert(revenue.eligibleConversionCount === 1, 'only the APPROVED conversion counts as eligible');

  const commissions = service.getOrganizationCommissionMetrics(orgId, EnvironmentType.LIVE);
  assert(commissions.totalEligibleCommissions === 1500, `commissions.totalEligibleCommissions is 1500 (got ${commissions.totalEligibleCommissions})`);
  assert(commissions.paidCommissions === 1000, 'commissions.paidCommissions reflects the completed payout item');
  assert(commissions.outstandingCommissions === 500, 'commissions.outstandingCommissions = eligible - paid');

  const conversions = service.getOrganizationConversionMetrics(orgId, EnvironmentType.LIVE);
  assert(conversions.totalConversions === 2, 'conversions.totalConversions counts all statuses');
  assert(conversions.uniqueClicks === 2, 'conversions.uniqueClicks dedupes by anonymousId');
  assert(conversions.conversionRate === 100, `conversionRate = 2 conversions / 2 unique clicks * 100 = 100 (got ${conversions.conversionRate})`);

  const affiliates = service.getOrganizationAffiliateMetrics(orgId, EnvironmentType.LIVE);
  assert(affiliates.activeAffiliates === 1, 'affiliates.activeAffiliates counts the ACTIVE affiliate');
  assert(affiliates.topAffiliates[0]?.revenue === 10000, 'topAffiliates ranks by real revenue');

  const programAnalytics = service.getProgramAnalytics(orgId, programId, EnvironmentType.LIVE);
  assert(programAnalytics.totalRevenue === 10000, 'program-scoped revenue matches org revenue for single-program org');

  const affiliateAnalytics = service.getAffiliateAnalytics(orgId, affiliateId, EnvironmentType.LIVE);
  assert(affiliateAnalytics.totalRevenueGenerated === 10000, 'affiliate-scoped revenue is correct');
  assert(affiliateAnalytics.totalPaidOut === 1000, 'affiliate-scoped paid-out total is correct');

  const timeSeries = service.getOrganizationRevenueTimeSeries(orgId, EnvironmentType.LIVE, 6);
  assert(timeSeries.points.length === 6, 'time series returns exactly the requested number of months');
  assert(timeSeries.points[5].revenue === 10000, 'the current month bucket carries the real conversion revenue');
  assert(timeSeries.points[0].revenue === 0, 'a month with no activity is a real zero, not omitted or interpolated');
  assert(timeSeries.hasData === true, 'time series hasData is true when any bucket has activity');

  const topPrograms = service.getOrganizationTopPrograms(orgId, EnvironmentType.LIVE);
  assert(topPrograms.topPrograms[0]?.programId === programId, 'top programs ranks the real program by revenue');
  assert(topPrograms.topPrograms[0]?.revenue === 10000, 'top programs revenue matches real conversion total');
}

if (process.exitCode) {
  console.error('\nSome checks FAILED.');
} else {
  console.log('\nAll analytics sanity checks passed.');
}
