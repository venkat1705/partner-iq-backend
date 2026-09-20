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
  ) { }

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

    // Real Activity Trend (daily aggregated metrics from conversions and milestone achievements)
    const trendMap = new Map<string, { date: string; conversions: number; revenue: number; points: number; achievements: number }>();
    const orgConversions = dbStore.conversions.filter(
      (c) => c.organizationId === organizationId && (!programId || c.programId === programId) && c.status === 'APPROVED',
    );

    for (const c of orgConversions) {
      const date = new Date(c.createdAt).toISOString().slice(0, 10);
      const entry = trendMap.get(date) || { date, conversions: 0, revenue: 0, points: 0, achievements: 0 };
      const rev = Math.round(Number(c.amount || 0) / 100);
      entry.conversions += 1;
      entry.revenue += rev;
      entry.points += rev + 50; // 50 pts per conversion + 1 pt per currency unit
      trendMap.set(date, entry);
    }

    const orgAchievements = dbStore.affiliateMilestoneAchievements.filter(
      (a) => a.organizationId === organizationId && (!programId || a.programId === programId),
    );

    for (const a of orgAchievements) {
      const date = new Date(a.achievedAt).toISOString().slice(0, 10);
      const entry = trendMap.get(date) || { date, conversions: 0, revenue: 0, points: 0, achievements: 0 };
      entry.achievements += 1;
      entry.points += 100; // 100 pts per milestone achievement
      trendMap.set(date, entry);
    }

    const activityTrend = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Real Activity Timeline stream (tier changes, milestone achievements, manual grants)
    interface TimelineItem {
      id: string;
      type: 'TIER_UPGRADE' | 'MILESTONE_UNLOCKED' | 'REWARD_GRANTED' | 'TIER_ASSIGNED';
      affiliateId: string;
      affiliateName: string;
      title: string;
      description: string;
      timestamp: string;
      badgeIcon?: string;
      colorToken?: string;
    }

    const timelineItems: TimelineItem[] = [];

    // Add tier upgrades
    const tierHistories = dbStore.affiliateTierHistories.filter(
      (h) => h.organizationId === organizationId && (!programId || h.programId === programId),
    );
    for (const h of tierHistories) {
      const affiliate = dbStore.affiliates.find((a) => a.id === h.affiliateId);
      const newTier = dbStore.partnerTiers.find((t) => t.id === h.newTierId);
      timelineItems.push({
        id: h.id,
        type: h.transitionType === 'AUTOMATIC_UPGRADE' ? 'TIER_UPGRADE' : 'TIER_ASSIGNED',
        affiliateId: h.affiliateId,
        affiliateName: affiliate?.displayName || affiliate?.companyName || 'Partner',
        title: `${affiliate?.displayName || 'Partner'} reached ${newTier?.name || 'New Tier'}`,
        description: `Advanced to level ${newTier?.level || 1} tier${newTier?.commissionRateOverride ? ` with ${(newTier.commissionRateOverride / 100).toFixed(1)}% commission override` : ''}.`,
        timestamp: new Date(h.createdAt).toISOString(),
        badgeIcon: newTier?.icon || 'award',
        colorToken: newTier?.colorToken || 'emerald',
      });
    }

    // Add milestone unlocks
    for (const a of orgAchievements) {
      const affiliate = dbStore.affiliates.find((aff) => aff.id === a.affiliateId);
      const milestone = dbStore.milestones.find((m) => m.id === a.milestoneId);
      timelineItems.push({
        id: a.id,
        type: 'MILESTONE_UNLOCKED',
        affiliateId: a.affiliateId,
        affiliateName: affiliate?.displayName || affiliate?.companyName || 'Partner',
        title: `Unlocked "${milestone?.name || 'Milestone'}"`,
        description: milestone?.description || `Reached target of ${a.targetValue} ${milestone?.metric || 'metric'} units.`,
        timestamp: new Date(a.achievedAt).toISOString(),
        badgeIcon: milestone?.badgeIcon || 'trophy',
        colorToken: 'amber',
      });
    }

    // Add manual reward audits
    const rewardAudits = dbStore.auditLogs.filter(
      (log) => log.organizationId === organizationId && log.action === 'REWARD_GRANTED',
    );
    for (const log of rewardAudits) {
      const affiliate = dbStore.affiliates.find((aff) => aff.id === log.resourceId);
      const rewardKind = (log.metadata as any)?.rewardKind || (log.metadata as any)?.rewardType || 'REWARD';
      timelineItems.push({
        id: log.id,
        type: 'REWARD_GRANTED',
        affiliateId: log.resourceId,
        affiliateName: affiliate?.displayName || affiliate?.companyName || 'Partner',
        title: `Reward Granted: ${rewardKind}`,
        description: (log.metadata as any)?.reason || 'Operator granted manual achievement bonus.',
        timestamp: new Date(log.createdAt).toISOString(),
        badgeIcon: 'gift',
        colorToken: 'indigo',
      });
    }

    const activityTimeline = timelineItems
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 30);

    // Top Performer
    const sortedSummaries = [...summaries].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    const topSummary = sortedSummaries[0];
    let topPerformer: any = null;
    if (topSummary) {
      const aff = dbStore.affiliates.find((a) => a.id === topSummary.affiliateId);
      const tierState = dbStore.affiliateTiers.find((at) => at.affiliateId === topSummary.affiliateId);
      const tier = tierState ? dbStore.partnerTiers.find((t) => t.id === tierState.currentTierId) : null;
      topPerformer = {
        affiliateId: topSummary.affiliateId,
        displayName: aff?.displayName || aff?.companyName || 'Top Partner',
        email: aff?.email,
        revenue: Math.round(topSummary.revenue / 100),
        conversions: topSummary.approvedConversions,
        tierName: tier?.name || 'Bronze',
        tierColor: tier?.colorToken || 'emerald',
        tierLevel: tier?.level || 1,
      };
    }

    // Inactivity Watchlist (Partners with prior conversions but no activity in > 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const atRiskAffiliates = summaries
      .filter((s) => s.approvedConversions > 0 && (!s.lastActivityAt || new Date(s.lastActivityAt) < thirtyDaysAgo))
      .map((s) => {
        const aff = dbStore.affiliates.find((a) => a.id === s.affiliateId);
        const tierState = dbStore.affiliateTiers.find((at) => at.affiliateId === s.affiliateId);
        const tier = tierState ? dbStore.partnerTiers.find((t) => t.id === tierState.currentTierId) : null;
        return {
          affiliateId: s.affiliateId,
          displayName: aff?.displayName || aff?.companyName || 'Partner',
          lastActivityAt: s.lastActivityAt,
          totalConversions: s.approvedConversions,
          revenue: Math.round(s.revenue / 100),
          tierName: tier?.name || 'Bronze',
          tierColor: tier?.colorToken || 'blue',
        };
      })
      .slice(0, 10);

    const totalRevenue = summaries.reduce((sum, s) => sum + Math.round(s.revenue / 100), 0);
    const totalApprovedConversions = summaries.reduce((sum, s) => sum + s.approvedConversions, 0);
    const totalCommissions = summaries.reduce((sum, s) => sum + Math.round(s.commissionEarned / 100), 0);

    // Categorical points by activity
    const pointsByActivity = [
      { category: 'Conversions', points: totalApprovedConversions * 50, count: totalApprovedConversions },
      { category: 'Attributed Revenue', points: totalRevenue, count: totalRevenue },
      { category: 'Milestones & Badges', points: totalMilestonesAchieved * 100, count: totalMilestonesAchieved },
      { category: 'Tier Advancements', points: totalTierUpgrades * 200, count: totalTierUpgrades },
    ];

    const totalPoints = pointsByActivity.reduce((acc, p) => acc + p.points, 0);

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
      totalRevenue,
      totalApprovedConversions,
      totalCommissions,
      totalPoints,
      activityTrend,
      activityTimeline,
      topPerformer,
      atRiskAffiliates,
      pointsByActivity,
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
        affiliateName: displayName,
        avatar: `https://avatar.vercel.sh/${s.affiliateId}.svg?text=${encodeURIComponent((rawName[0] || 'P').toUpperCase())}`,
        tierName: tier?.name || 'Bronze',
        tierColor: tier?.colorToken || 'blue',
        conversions: s.approvedConversions,
        revenue: Math.round(s.revenue / 100),
        commissionEarned: Math.round(s.commissionEarned / 100),
        closedWonDeals: s.closedWonDeals,
        score: Math.round(s.revenue / 100),
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
