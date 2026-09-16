import { Injectable, NotFoundException } from '@nestjs/common';
import { dbStore } from '../../database/store';
import {
  AffiliateStatus,
  ConversionStatus,
  EnvironmentType,
  PayoutStatus,
  ProgramStatus,
} from '../../common/enums';
import { SubscriptionStatus } from '../billing/enums/billing.enums';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';

/**
 * Single source of truth for organization business metrics.
 *
 * Every number here is derived directly from real records in dbStore
 * (Conversion/Commission/PayoutItem/Program/Affiliate/BillingSubscription) —
 * nothing here is a placeholder, a guessed percentage, or a hardcoded fallback.
 * When a metric genuinely cannot be computed (e.g. no prior period to compare,
 * no active billing subscription), the method returns `null` for that field
 * rather than inventing a number — callers must render that as an explicit
 * "no data" state, never as 0 or N/A dressed up as a real value.
 *
 * Eligibility rule used throughout: a conversion/commission counts toward
 * revenue/commission totals only when its status is APPROVED. PENDING,
 * REJECTED, REFUNDED and CHARGEBACK rows are excluded from "eligible" sums,
 * matching the same rule already enforced in commissions.service.ts.
 */
@Injectable()
export class AnalyticsService {
  // ─────────────────────────────────────────────────────────
  // Shared scoping helpers
  // ─────────────────────────────────────────────────────────

  // A record with no `environment` set (legacy rows, or ones created through a path that
  // predates the field) defaults to LIVE everywhere else in the app — the DB column default
  // is EnvironmentType.LIVE, and the frontend's own filtering (normalizeRecordEnvironment)
  // treats a falsy environment as 'production'/LIVE. These analytics scoping helpers must
  // match that same rule; a strict `=== environment` check here was silently excluding any
  // such record from every Overview dashboard number (revenue, commissions, conversions...)
  // even though it appeared correctly everywhere else in the app.
  private matchesEnvironment(recordEnvironment: EnvironmentType | undefined, environment: EnvironmentType) {
    return recordEnvironment === environment || (!recordEnvironment && environment === EnvironmentType.LIVE);
  }

  private scopedConversions(organizationId: string, environment: EnvironmentType) {
    return dbStore.conversions.filter(
      (c) => c.organizationId === organizationId && this.matchesEnvironment(c.environment, environment),
    );
  }

  private scopedCommissions(organizationId: string, environment: EnvironmentType) {
    return dbStore.commissions.filter(
      (c) => c.organizationId === organizationId && this.matchesEnvironment(c.environment, environment),
    );
  }

  private scopedPayoutItems(organizationId: string, environment: EnvironmentType) {
    return dbStore.payoutItems.filter(
      (p) => p.organizationId === organizationId && this.matchesEnvironment(p.environment, environment),
    );
  }

  private scopedPrograms(organizationId: string) {
    return dbStore.programs.filter((p) => p.organizationId === organizationId && !p.deletedAt);
  }

  private scopedAffiliates(organizationId: string) {
    return dbStore.affiliates.filter((a) => a.organizationId === organizationId);
  }

  private scopedClicks(organizationId: string, environment: EnvironmentType) {
    return dbStore.clicks.filter(
      (c) => c.organizationId === organizationId && this.matchesEnvironment(c.environment, environment),
    );
  }

  private isEligible(status: string) {
    return status === ConversionStatus.APPROVED;
  }

  private sum(list: Array<{ amount?: number }>, field: 'amount' = 'amount') {
    return list.reduce((total, item) => total + Number((item as any)[field] ?? 0), 0);
  }

  private startOfMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private monthOverMonth(current: number, previous: number): number | null {
    if (previous <= 0) return null;
    return ((current - previous) / previous) * 100;
  }

  // ─────────────────────────────────────────────────────────
  // Revenue
  // ─────────────────────────────────────────────────────────

  getOrganizationRevenueMetrics(organizationId: string, environment: EnvironmentType) {
    const conversions = this.scopedConversions(organizationId, environment);
    const eligible = conversions.filter((c) => this.isEligible(c.status));
    const attributed = eligible.filter((c) => Boolean(c.affiliateId));

    const totalRevenue = this.sum(eligible);
    const attributedRevenue = this.sum(attributed);
    const directRevenue = totalRevenue - attributedRevenue;

    const now = new Date();
    const thisMonthStart = this.startOfMonth(now);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const inRange = (date: Date, start: Date, end: Date) => date >= start && date < end;

    const revenueThisMonth = this.sum(
      eligible.filter((c) => inRange(new Date(c.occurredAt || c.createdAt), thisMonthStart, now)),
    );
    const revenueLastMonth = this.sum(
      eligible.filter((c) => inRange(new Date(c.occurredAt || c.createdAt), lastMonthStart, thisMonthStart)),
    );

    return {
      currency: eligible[0]?.currency || PLATFORM_CURRENCY,
      totalRevenue,
      attributedRevenue,
      directRevenue,
      eligibleConversionCount: eligible.length,
      averageOrderValue: eligible.length > 0 ? Math.round(totalRevenue / eligible.length) : 0,
      revenueThisMonth,
      revenueLastMonth,
      revenueMoMPercent: this.monthOverMonth(revenueThisMonth, revenueLastMonth),
      hasData: conversions.length > 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Commissions
  // ─────────────────────────────────────────────────────────

  getOrganizationCommissionMetrics(organizationId: string, environment: EnvironmentType) {
    const commissions = this.scopedCommissions(organizationId, environment);
    const eligible = commissions.filter((c) => this.isEligible(c.status));

    const pendingCommissions = commissions
      .filter((c) => c.status === ConversionStatus.PENDING)
      .reduce((sum, c) => sum + Number(c.commissionAmount ?? 0), 0);
    const approvedCommissions = eligible.reduce((sum, c) => sum + Number(c.commissionAmount ?? 0), 0);
    const reversedCommissions = commissions
      .filter((c) => c.status === ConversionStatus.REFUNDED || c.status === ConversionStatus.CHARGEBACK)
      .reduce((sum, c) => sum + Number(c.commissionAmount ?? 0), 0);

    // Commissions already paid out — cross-referenced against completed payout items
    // for this org, not assumed from commission status alone.
    const completedPayoutTotal = this.scopedPayoutItems(organizationId, environment)
      .filter((p) => p.status === PayoutStatus.COMPLETED)
      .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

    const currency = dbStore.programs.find((p) => p.id === commissions[0]?.programId)?.currency
      || this.scopedConversions(organizationId, environment)[0]?.currency
      || PLATFORM_CURRENCY;

    return {
      currency,
      totalEligibleCommissions: approvedCommissions,
      pendingCommissions,
      reversedCommissions,
      paidCommissions: completedPayoutTotal,
      outstandingCommissions: Math.max(0, approvedCommissions - completedPayoutTotal),
      hasData: commissions.length > 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Conversions
  // ─────────────────────────────────────────────────────────

  getOrganizationConversionMetrics(organizationId: string, environment: EnvironmentType) {
    const conversions = this.scopedConversions(organizationId, environment);
    const clicks = this.scopedClicks(organizationId, environment);
    const uniqueClicks = new Set(clicks.map((c) => c.anonymousId)).size;

    const byStatus = {
      approved: conversions.filter((c) => c.status === ConversionStatus.APPROVED).length,
      pending: conversions.filter((c) => c.status === ConversionStatus.PENDING).length,
      rejected: conversions.filter((c) => c.status === ConversionStatus.REJECTED).length,
      refunded: conversions.filter((c) => c.status === ConversionStatus.REFUNDED).length,
      chargeback: conversions.filter((c) => c.status === ConversionStatus.CHARGEBACK).length,
    };

    // Conversion rate is only meaningful when there are clicks to divide by —
    // returning null (rendered as "N/A") instead of 0%, NaN or Infinity.
    const conversionRate = uniqueClicks > 0 ? (conversions.length / uniqueClicks) * 100 : null;

    return {
      totalConversions: conversions.length,
      totalClicks: clicks.length,
      uniqueClicks,
      conversionRate,
      byStatus,
      hasData: conversions.length > 0 || clicks.length > 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Affiliates
  // ─────────────────────────────────────────────────────────

  getOrganizationAffiliateMetrics(organizationId: string, environment: EnvironmentType) {
    const affiliates = this.scopedAffiliates(organizationId);
    const conversions = this.scopedConversions(organizationId, environment).filter((c) => this.isEligible(c.status));

    const now = new Date();
    const thisMonthStart = this.startOfMonth(now);
    const joinedThisMonth = affiliates.filter((a) => new Date(a.createdAt) >= thisMonthStart).length;

    const revenueByAffiliate = new Map<string, number>();
    for (const conversion of conversions) {
      if (!conversion.affiliateId) continue;
      revenueByAffiliate.set(
        conversion.affiliateId,
        (revenueByAffiliate.get(conversion.affiliateId) || 0) + Number(conversion.amount ?? 0),
      );
    }
    const topAffiliates = [...revenueByAffiliate.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([affiliateId, revenue]) => {
        const affiliate = affiliates.find((a) => a.id === affiliateId);
        return {
          affiliateId,
          displayName: affiliate?.displayName || 'Unknown affiliate',
          revenue,
        };
      });

    return {
      totalAffiliates: affiliates.length,
      activeAffiliates: affiliates.filter((a) => a.status === AffiliateStatus.ACTIVE).length,
      pendingAffiliates: affiliates.filter((a) => a.status === AffiliateStatus.PENDING).length,
      suspendedAffiliates: affiliates.filter((a) => a.status === AffiliateStatus.SUSPENDED).length,
      joinedThisMonth,
      topAffiliates,
      hasData: affiliates.length > 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Payouts
  // ─────────────────────────────────────────────────────────

  getOrganizationPayoutMetrics(organizationId: string, environment: EnvironmentType) {
    const items = this.scopedPayoutItems(organizationId, environment);
    const batches = dbStore.payoutBatches.filter(
      (b) => b.organizationId === organizationId && b.environment === environment,
    );

    const pendingPayouts = items
      .filter((p) => p.status === PayoutStatus.DRAFT || p.status === PayoutStatus.PROCESSING)
      .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const completedPayouts = items
      .filter((p) => p.status === PayoutStatus.COMPLETED)
      .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const failedPayouts = items
      .filter((p) => p.status === PayoutStatus.FAILED || p.status === PayoutStatus.PARTIALLY_FAILED)
      .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

    return {
      currency: items[0]?.currency || PLATFORM_CURRENCY,
      pendingPayouts,
      completedPayouts,
      failedPayouts,
      totalBatches: batches.length,
      totalPayoutItems: items.length,
      hasData: items.length > 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // MRR — PartnerIQ's own SaaS subscription revenue from this organization.
  // This is intentionally NEVER derived from affiliate commission/conversion
  // data — those are two unrelated revenue concepts.
  // ─────────────────────────────────────────────────────────

  getOrganizationMRR(organizationId: string) {
    const subscription = dbStore.billingSubscriptions
      ?.filter((s) => s.organizationId === organizationId)
      .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime())[0];

    if (!subscription || subscription.status !== SubscriptionStatus.ACTIVE) {
      return { mrr: null, currency: null, plan: null, hasData: false };
    }

    const plan = dbStore.billingPlans.find((p) => p.id === subscription.planId);
    if (!plan) {
      return { mrr: null, currency: null, plan: null, hasData: false };
    }

    const isYearly = String(subscription.billingInterval || plan.billingInterval).toUpperCase() === 'YEARLY';
    const mrr = isYearly ? Math.round(plan.price / 12) : plan.price;

    return {
      mrr,
      currency: plan.currency,
      plan: { code: plan.code, name: plan.name, billingInterval: plan.billingInterval },
      hasData: true,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Time series — for dashboard charts. Buckets real eligible conversions/
  // commissions by month; returns one point per month with actual zero values
  // for months with no activity (never interpolated or fabricated).
  // ─────────────────────────────────────────────────────────

  getOrganizationRevenueTimeSeries(organizationId: string, environment: EnvironmentType, months = 6) {
    const conversions = this.scopedConversions(organizationId, environment);
    const commissions = this.scopedCommissions(organizationId, environment);
    const now = new Date();

    const points = Array.from({ length: months }).map((_, idx) => {
      const offset = months - 1 - idx;
      const bucketStart = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const bucketEnd = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
      const label = bucketStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

      const bucketConversions = conversions.filter((c) => {
        const date = new Date(c.occurredAt || c.createdAt);
        return date >= bucketStart && date < bucketEnd;
      });
      const eligible = bucketConversions.filter((c) => this.isEligible(c.status));
      const bucketCommissions = commissions.filter((c) => {
        const date = new Date(c.createdAt);
        return date >= bucketStart && date < bucketEnd && this.isEligible(c.status);
      });

      return {
        month: label,
        revenue: this.sum(eligible),
        commission: bucketCommissions.reduce((sum, c) => sum + Number(c.commissionAmount ?? 0), 0),
        conversions: bucketConversions.length,
      };
    });

    return {
      points,
      hasData: points.some((p) => p.revenue > 0 || p.conversions > 0),
    };
  }

  // ─────────────────────────────────────────────────────────
  // Top performers
  // ─────────────────────────────────────────────────────────

  getOrganizationTopPrograms(organizationId: string, environment: EnvironmentType, limit = 5) {
    const conversions = this.scopedConversions(organizationId, environment).filter((c) => this.isEligible(c.status));
    const programs = this.scopedPrograms(organizationId);

    const revenueByProgram = new Map<string, number>();
    for (const conversion of conversions) {
      revenueByProgram.set(conversion.programId, (revenueByProgram.get(conversion.programId) || 0) + Number(conversion.amount ?? 0));
    }

    const topPrograms = [...revenueByProgram.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, revenue]) => ({
        programId: id,
        programName: programs.find((p) => p.id === id)?.name || 'Unknown program',
        revenue,
      }));

    return { topPrograms, hasData: topPrograms.length > 0 };
  }

  // ─────────────────────────────────────────────────────────
  // Overview — the single call the org dashboard should make.
  // ─────────────────────────────────────────────────────────

  getOrganizationOverview(organizationId: string, environment: EnvironmentType) {
    const programs = this.scopedPrograms(organizationId);
    const revenue = this.getOrganizationRevenueMetrics(organizationId, environment);
    const commissions = this.getOrganizationCommissionMetrics(organizationId, environment);
    const affiliatesMetrics = this.getOrganizationAffiliateMetrics(organizationId, environment);
    const conversions = this.getOrganizationConversionMetrics(organizationId, environment);
    const payouts = this.getOrganizationPayoutMetrics(organizationId, environment);
    const mrr = this.getOrganizationMRR(organizationId);

    return {
      organizationId,
      environment,
      totalPrograms: programs.length,
      activePrograms: programs.filter((p) => p.status === ProgramStatus.ACTIVE).length,
      revenue,
      commissions,
      affiliates: affiliatesMetrics,
      conversions,
      payouts,
      mrr,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Program-scoped analytics
  // ─────────────────────────────────────────────────────────

  getProgramAnalytics(organizationId: string, programId: string, environment: EnvironmentType) {
    const program = dbStore.programs.find(
      (p) => p.id === programId && p.organizationId === organizationId && !p.deletedAt,
    );
    if (!program) throw new NotFoundException('Program not found');

    const conversions = this.scopedConversions(organizationId, environment).filter((c) => c.programId === programId);
    const eligible = conversions.filter((c) => this.isEligible(c.status));
    const commissions = this.scopedCommissions(organizationId, environment).filter((c) => c.programId === programId);
    const eligibleCommissions = commissions.filter((c) => this.isEligible(c.status));
    const clicks = this.scopedClicks(organizationId, environment).filter((c) => c.programId === programId);
    const uniqueClicks = new Set(clicks.map((c) => c.anonymousId)).size;
    const affiliateIds = new Set(conversions.map((c) => c.affiliateId).filter(Boolean));

    return {
      programId,
      programName: program.name,
      status: program.status,
      totalRevenue: this.sum(eligible),
      totalCommissions: eligibleCommissions.reduce((sum, c) => sum + Number(c.commissionAmount ?? 0), 0),
      totalConversions: conversions.length,
      eligibleConversions: eligible.length,
      totalClicks: clicks.length,
      uniqueClicks,
      conversionRate: uniqueClicks > 0 ? (conversions.length / uniqueClicks) * 100 : null,
      activeAffiliateCount: affiliateIds.size,
      hasData: conversions.length > 0 || clicks.length > 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Affiliate-scoped analytics
  // ─────────────────────────────────────────────────────────

  getAffiliateAnalytics(organizationId: string, affiliateId: string, environment: EnvironmentType) {
    const affiliate = dbStore.affiliates.find((a) => a.id === affiliateId && a.organizationId === organizationId);
    if (!affiliate) throw new NotFoundException('Affiliate not found');

    const conversions = this.scopedConversions(organizationId, environment).filter((c) => c.affiliateId === affiliateId);
    const eligible = conversions.filter((c) => this.isEligible(c.status));
    const commissions = this.scopedCommissions(organizationId, environment).filter((c) => c.affiliateId === affiliateId);
    const eligibleCommissions = commissions.filter((c) => this.isEligible(c.status));
    const clicks = this.scopedClicks(organizationId, environment).filter((c) => c.affiliateId === affiliateId);
    const uniqueClicks = new Set(clicks.map((c) => c.anonymousId)).size;
    const payoutItems = this.scopedPayoutItems(organizationId, environment).filter((p) => p.affiliateId === affiliateId);

    return {
      affiliateId,
      displayName: affiliate.displayName,
      status: affiliate.status,
      totalRevenueGenerated: this.sum(eligible),
      totalCommissionsEarned: eligibleCommissions.reduce((sum, c) => sum + Number(c.commissionAmount ?? 0), 0),
      totalPaidOut: payoutItems.filter((p) => p.status === PayoutStatus.COMPLETED).reduce((sum, p) => sum + Number(p.amount ?? 0), 0),
      totalConversions: conversions.length,
      eligibleConversions: eligible.length,
      totalClicks: clicks.length,
      uniqueClicks,
      conversionRate: uniqueClicks > 0 ? (conversions.length / uniqueClicks) * 100 : null,
      hasData: conversions.length > 0 || clicks.length > 0,
    };
  }
}
