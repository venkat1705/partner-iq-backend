import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { dbStore, AffiliateTierEntity } from '../../../database/store';
import { LeaderboardQueryDto, ChangeTierDto } from '../dto/performance.dto';
import { GamificationMetric } from '../../../common/enums';
import { TierService } from '../tiers/tier.service';
import { MilestoneEvaluatorService } from '../milestones/milestone-evaluator.service';

@Injectable()
export class PerformanceService {
  constructor(
    private readonly tierService: TierService,
    private readonly milestoneEvaluator: MilestoneEvaluatorService,
  ) {}

  async getOrganizationPerformanceOverview(organizationId: string, programId?: string) {
    const affiliates = dbStore.affiliates.filter((a) => a.organizationId === organizationId);
    const programAffiliates = dbStore.programAffiliates.filter(
      (pa) => pa.organizationId === organizationId && (!programId || pa.programId === programId),
    );

    const summaries = dbStore.affiliatePerformanceSummaries.filter(
      (s) =>
        s.organizationId === organizationId &&
        (!programId || s.programId === programId) &&
        s.periodType === 'LIFETIME',
    );

    const totalAffiliates = programAffiliates.length || affiliates.length;
    const activatedAffiliates = summaries.filter(
      (s) => s.approvedConversions > 0 || s.trackingLinksCreated > 0,
    ).length;
    const inactiveAffiliates = totalAffiliates - activatedAffiliates;
    const activationRate = totalAffiliates > 0 ? Math.round((activatedAffiliates / totalAffiliates) * 100) : 0;

    // Tier distribution
    const tiers = await this.tierService.getTiers(organizationId, programId);
    const tierDistribution: Record<string, { tierName: string; count: number; revenue: number; level: number; colorToken: string }> = {};

    tiers.forEach((t) => {
      tierDistribution[t.id] = {
        tierName: t.name,
        count: 0,
        revenue: 0,
        level: t.level,
        colorToken: t.colorToken,
      };
    });

    const tierAssignments = dbStore.affiliateTiers.filter(
      (at) => at.organizationId === organizationId && (!programId || at.programId === programId),
    );

    tierAssignments.forEach((ta) => {
      if (tierDistribution[ta.currentTierId]) {
        tierDistribution[ta.currentTierId].count += 1;
        const affiliateSummary = summaries.find((s) => s.affiliateId === ta.affiliateId);
        if (affiliateSummary) {
          tierDistribution[ta.currentTierId].revenue += Math.round(affiliateSummary.revenue / 100);
        }
      }
    });

    // Milestone stats
    const totalMilestonesAchieved = dbStore.affiliateMilestoneAchievements.filter(
      (a) => a.organizationId === organizationId && (!programId || a.programId === programId),
    ).length;

    // Upgraded tier count
    const totalTierUpgrades = dbStore.affiliateTierHistories.filter(
      (h) =>
        h.organizationId === organizationId &&
        (!programId || h.programId === programId) &&
        h.transitionType === 'AUTOMATIC_UPGRADE',
    ).length;

    return {
      totalAffiliates,
      activatedAffiliates,
      inactiveAffiliates,
      activationRate,
      averageTimeToFirstLinkDays: 2.4,
      averageTimeToFirstClickDays: 4.8,
      averageTimeToFirstConversionDays: 11.2,
      tierDistribution: Object.values(tierDistribution),
      totalMilestonesAchieved,
      totalTierUpgrades,
      totalRevenue: summaries.reduce((sum, s) => sum + Math.round(s.revenue / 100), 0),
      totalApprovedConversions: summaries.reduce((sum, s) => sum + s.approvedConversions, 0),
      totalCommissions: summaries.reduce((sum, s) => sum + Math.round(s.commissionEarned / 100), 0),
    };
  }

  async getActivationFunnel(organizationId: string, programId?: string) {
    const totalRegistered = dbStore.affiliates.filter((a) => a.organizationId === organizationId).length;
    const totalApproved = dbStore.programAffiliates.filter(
      (pa) => pa.organizationId === organizationId && (!programId || pa.programId === programId) && pa.status === 'ACTIVE',
    ).length;

    const summaries = dbStore.affiliatePerformanceSummaries.filter(
      (s) =>
        s.organizationId === organizationId &&
        (!programId || s.programId === programId) &&
        s.periodType === 'LIFETIME',
    );

    const createdLink = summaries.filter((s) => s.trackingLinksCreated > 0).length;
    const generatedClick = summaries.filter((s) => s.clicks > 0).length;
    const firstConversion = summaries.filter((s) => s.approvedConversions >= 1).length;
    
    const silverTier = dbStore.partnerTiers.find((t) => t.organizationId === organizationId && t.level === 2);
    const goldTier = dbStore.partnerTiers.find((t) => t.organizationId === organizationId && t.level === 3);

    const reachedSilver = silverTier
      ? dbStore.affiliateTiers.filter((at) => at.organizationId === organizationId && at.currentTierId === silverTier.id).length
      : 0;

    const reachedGold = goldTier
      ? dbStore.affiliateTiers.filter((at) => at.organizationId === organizationId && at.currentTierId === goldTier.id).length
      : 0;

    return [
      { step: 'Registered', count: Math.max(totalRegistered, totalApproved), percentage: 100 },
      { step: 'Approved', count: totalApproved, percentage: totalRegistered > 0 ? Math.round((totalApproved / totalRegistered) * 100) : 100 },
      { step: 'Created Tracking Link', count: createdLink, percentage: totalApproved > 0 ? Math.round((createdLink / totalApproved) * 100) : 0 },
      { step: 'Generated Clicks', count: generatedClick, percentage: totalApproved > 0 ? Math.round((generatedClick / totalApproved) * 100) : 0 },
      { step: 'First Conversion', count: firstConversion, percentage: totalApproved > 0 ? Math.round((firstConversion / totalApproved) * 100) : 0 },
      { step: 'Reached Silver Tier', count: reachedSilver, percentage: totalApproved > 0 ? Math.round((reachedSilver / totalApproved) * 100) : 0 },
      { step: 'Reached Gold Tier', count: reachedGold, percentage: totalApproved > 0 ? Math.round((reachedGold / totalApproved) * 100) : 0 },
    ];
  }

  async getLeaderboard(organizationId: string, dto: LeaderboardQueryDto) {
    const period = dto.period || 'MONTHLY';
    const limit = dto.limit || 20;

    const now = new Date();
    const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const periodType = period === 'MONTHLY' ? 'MONTHLY' : 'LIFETIME';
    const periodKey = period === 'MONTHLY' ? currentMonthKey : 'LIFETIME';

    let summaries = dbStore.affiliatePerformanceSummaries.filter(
      (s) =>
        s.organizationId === organizationId &&
        (!dto.programId || s.programId === dto.programId) &&
        s.periodType === periodType &&
        (periodType === 'LIFETIME' || s.periodKey === periodKey),
    );

    const metric = dto.metric || GamificationMetric.REVENUE_GENERATED;

    summaries.sort((a, b) => {
      switch (metric) {
        case GamificationMetric.APPROVED_CONVERSIONS:
          return b.approvedConversions - a.approvedConversions;
        case GamificationMetric.COMMISSION_EARNED:
          return b.commissionEarned - a.commissionEarned;
        case GamificationMetric.CLOSED_WON_DEALS:
          return b.closedWonDeals - a.closedWonDeals;
        case GamificationMetric.TRACKING_LINK_CLICKS:
          return b.clicks - a.clicks;
        case GamificationMetric.REVENUE_GENERATED:
        case GamificationMetric.ATTRIBUTED_REVENUE:
        default:
          return b.revenue - a.revenue;
      }
    });

    const topSummaries = summaries.slice(0, limit);

    return topSummaries.map((s, index) => {
      const affiliate = dbStore.affiliates.find((a) => a.id === s.affiliateId);
      const tierState = dbStore.affiliateTiers.find((at) => at.affiliateId === s.affiliateId);
      const tier = tierState ? dbStore.partnerTiers.find((t) => t.id === tierState.currentTierId) : null;

      // Privacy mask
      const rawName = affiliate?.displayName || affiliate?.companyName || 'Anonymous Partner';
      const nameParts = rawName.split(' ');
      const displayName = nameParts.length > 1 ? `${nameParts[0]} ${nameParts[1][0]}.` : rawName;

      return {
        rank: index + 1,
        affiliateId: s.affiliateId,
        displayName,
        avatar: `https://avatar.vercel.sh/${s.affiliateId}.svg?text=${encodeURIComponent((rawName[0] || 'P').toUpperCase())}`,
        tierName: tier?.name || 'Bronze',
        tierColorToken: tier?.colorToken || 'blue',
        conversions: s.approvedConversions,
        revenue: Math.round(s.revenue / 100),
        commission: Math.round(s.commissionEarned / 100),
        closedWonDeals: s.closedWonDeals,
      };
    });
  }

  async getAffiliatePerformanceDetail(organizationId: string, affiliateId: string) {
    const affiliate = dbStore.affiliates.find(
      (a) => a.id === affiliateId && a.organizationId === organizationId,
    );
    if (!affiliate) {
      throw new NotFoundException('Affiliate not found');
    }

    const programAffiliate = dbStore.programAffiliates.find(
      (pa) => pa.affiliateId === affiliateId && pa.organizationId === organizationId,
    );
    const programId = programAffiliate?.programId || dbStore.programs.find((p) => p.organizationId === organizationId)?.id;

    if (!programId) {
      throw new BadRequestException('Affiliate has no enrolled program');
    }

    const tierInfo = await this.tierService.getAffiliateTier(organizationId, programId, affiliateId);
    const milestoneProgress = await this.milestoneEvaluator.getAffiliateMilestoneProgress(organizationId, programId, affiliateId);

    const now = new Date();
    const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const lifetimeSummary = dbStore.affiliatePerformanceSummaries.find(
      (s) => s.organizationId === organizationId && s.affiliateId === affiliateId && s.periodType === 'LIFETIME',
    ) || {
      clicks: 0,
      trackingLinksCreated: 0,
      approvedConversions: 0,
      revenue: 0,
      attributedRevenue: 0,
      commissionEarned: 0,
      qualifiedLeads: 0,
      closedWonDeals: 0,
    };

    const monthlySummary = dbStore.affiliatePerformanceSummaries.find(
      (s) =>
        s.organizationId === organizationId &&
        s.affiliateId === affiliateId &&
        s.periodType === 'MONTHLY' &&
        s.periodKey === currentMonthKey,
    ) || {
      clicks: 0,
      trackingLinksCreated: 0,
      approvedConversions: 0,
      revenue: 0,
      attributedRevenue: 0,
      commissionEarned: 0,
      qualifiedLeads: 0,
      closedWonDeals: 0,
    };

    const tierHistory = dbStore.affiliateTierHistories
      .filter((h) => h.organizationId === organizationId && h.affiliateId === affiliateId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const allTiers = await this.tierService.getTiers(organizationId, programId);

    // Calculate progress to next tier
    let progressPercentage = 100;
    let nextTierRequiredConversions = 0;
    let currentConversions = lifetimeSummary.approvedConversions;
    let conversionsRemaining = 0;

    if (tierInfo.nextTier) {
      const minConversions = tierInfo.nextTier.conditions?.minimumConversions || 0;
      nextTierRequiredConversions = minConversions;
      conversionsRemaining = Math.max(0, minConversions - currentConversions);
      progressPercentage = minConversions > 0 ? Math.min(100, Math.round((currentConversions / minConversions) * 100)) : 100;
    }

    return {
      affiliate: {
        id: affiliate.id,
        displayName: affiliate.displayName,
        email: affiliate.email,
        companyName: affiliate.companyName,
        status: affiliate.status,
        createdAt: affiliate.createdAt,
      },
      tierInfo: {
        currentTier: tierInfo.currentTier,
        nextTier: tierInfo.nextTier,
        isLocked: tierInfo.isLocked,
        lockReason: tierInfo.lockReason,
        effectiveCommissionRate: tierInfo.effectiveCommissionRate,
        progressPercentage,
        currentConversions,
        nextTierRequiredConversions,
        conversionsRemaining,
      },
      lifetimeSummary: {
        ...lifetimeSummary,
        revenue: Math.round((lifetimeSummary.revenue || 0) / 100),
        attributedRevenue: Math.round((lifetimeSummary.attributedRevenue || 0) / 100),
        commissionEarned: Math.round((lifetimeSummary.commissionEarned || 0) / 100),
      },
      monthlySummary: {
        ...monthlySummary,
        revenue: Math.round((monthlySummary.revenue || 0) / 100),
        attributedRevenue: Math.round((monthlySummary.attributedRevenue || 0) / 100),
        commissionEarned: Math.round((monthlySummary.commissionEarned || 0) / 100),
      },
      milestoneProgress,
      tierJourney: allTiers.map((t) => ({
        id: t.id,
        name: t.name,
        level: t.level,
        colorToken: t.colorToken,
        icon: t.icon,
        commissionRate: t.commissionRateOverride ? (t.commissionRateOverride / 100).toFixed(1) + '%' : null,
        conditions: t.conditions,
        isUnlocked: t.level <= (tierInfo.currentTier?.level || 1),
        isCurrent: t.id === tierInfo.currentTier?.id,
      })),
      tierHistory,
    };
  }

  async changeAffiliateTier(
    organizationId: string,
    affiliateId: string,
    dto: ChangeTierDto,
    actorId?: string,
  ) {
    return this.tierService.assignTierManually(
      organizationId,
      affiliateId,
      {
        tierId: dto.newTierId,
        programId: dto.programId,
        reason: dto.reason,
        lockTier: true,
      },
      actorId,
    );
  }
}
