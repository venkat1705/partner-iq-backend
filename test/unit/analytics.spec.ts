import { describe, it, expect, beforeEach } from '@jest/globals';
import { dbStore } from '../../src/database/store';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service';
import {
  AffiliateStatus,
  ConversionStatus,
  EnvironmentType,
  PayoutStatus,
  ProgramStatus,
  CommissionType,
} from '../../src/common/enums';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    service = new AnalyticsService();
  });

  it('calculates zero/null metrics for empty organization without NaN/Infinity', () => {
    const overview = service.getOrganizationOverview('org-empty', EnvironmentType.LIVE);
    expect(overview.revenue.totalRevenue).toBe(0);
    expect(overview.revenue.revenueMoMPercent).toBeNull();
    expect(overview.conversions.conversionRate).toBeNull();
    expect(overview.mrr.mrr).toBeNull();
    expect(overview.revenue.hasData).toBe(false);
  });

  it('calculates accurate conversion, commission, payout, and time series metrics', () => {
    const orgId = 'org-test-1';
    const programId = 'prog-test-1';
    const affiliateId = 'aff-test-1';

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
      email: 'affiliate@example.test',
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

    const revenue = service.getOrganizationRevenueMetrics(orgId, EnvironmentType.LIVE);
    expect(revenue.totalRevenue).toBe(10000);
    expect(revenue.attributedRevenue).toBe(10000);
    expect(revenue.eligibleConversionCount).toBe(1);

    const commissions = service.getOrganizationCommissionMetrics(orgId, EnvironmentType.LIVE);
    expect(commissions.totalEligibleCommissions).toBe(1500);
    expect(commissions.paidCommissions).toBe(1000);
    expect(commissions.outstandingCommissions).toBe(500);

    const conversions = service.getOrganizationConversionMetrics(orgId, EnvironmentType.LIVE);
    expect(conversions.totalConversions).toBe(2);
    expect(conversions.uniqueClicks).toBe(2);
    expect(conversions.conversionRate).toBe(100);

    const affiliates = service.getOrganizationAffiliateMetrics(orgId, EnvironmentType.LIVE);
    expect(affiliates.activeAffiliates).toBe(1);
    expect(affiliates.topAffiliates[0]?.revenue).toBe(10000);

    const programAnalytics = service.getProgramAnalytics(orgId, programId, EnvironmentType.LIVE);
    expect(programAnalytics.totalRevenue).toBe(10000);

    const affiliateAnalytics = service.getAffiliateAnalytics(orgId, affiliateId, EnvironmentType.LIVE);
    expect(affiliateAnalytics.totalRevenueGenerated).toBe(10000);
    expect(affiliateAnalytics.totalPaidOut).toBe(1000);

    const timeSeries = service.getOrganizationRevenueTimeSeries(orgId, EnvironmentType.LIVE, 6);
    expect(timeSeries.points.length).toBe(6);
    expect(timeSeries.points[5].revenue).toBe(10000);
    expect(timeSeries.points[0].revenue).toBe(0);
    expect(timeSeries.hasData).toBe(true);

    const topPrograms = service.getOrganizationTopPrograms(orgId, EnvironmentType.LIVE);
    expect(topPrograms.topPrograms[0]?.programId).toBe(programId);
    expect(topPrograms.topPrograms[0]?.revenue).toBe(10000);
  });
});

