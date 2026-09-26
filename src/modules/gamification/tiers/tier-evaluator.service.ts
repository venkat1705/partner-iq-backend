import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  dbStore,
  PartnerTierEntity,
  AffiliateTierEntity,
  AffiliateTierHistoryEntity,
  AffiliatePerformanceSummaryEntity,
} from '../../../database/store';
import {
  GamificationMetric,
  TierDowngradeMode,
  TierEvaluationPeriod,
  TierTransitionType,
  AuditAction,
  CommissionRateEffectiveStrategy,
  MilestoneRewardType,
} from '../../../common/enums';
import { CommissionsService } from '../../commissions/commissions.service';
import { RewardExecutorService } from '../rewards/reward-executor.service';
import { netCommissionAmount } from '../../../common/utils/commission.utils';

export interface TierEvaluationResult {
  affiliateId: string;
  previousTier: PartnerTierEntity | null;
  newTier: PartnerTierEntity;
  transitionType: TierTransitionType | 'UNCHANGED';
  reason: string;
  metricSnapshot: Record<string, any>;
  upgraded: boolean;
  downgraded: boolean;
  effectiveCommissionRate?: number;
}

@Injectable()
export class TierEvaluatorService {
  private readonly logger = new Logger(TierEvaluatorService.name);

  constructor(
    private readonly rewardExecutor: RewardExecutorService,
    private readonly commissionsService: CommissionsService,
  ) {}

  /**
   * Evaluate whether an affiliate qualifies for a tier upgrade (or downgrade)
   * based on their aggregated performance and the organization's tier configuration.
   */
  async evaluateAffiliateTier(
    organizationId: string,
    programId: string,
    affiliateId: string,
    context?: { isPeriodBoundaryJob?: boolean; actorId?: string },
  ): Promise<TierEvaluationResult | null> {
    // 1. Fetch affiliate tier state
    let affiliateTier = dbStore.affiliateTiers.find(
      (at) =>
        at.organizationId === organizationId &&
        at.programId === programId &&
        at.affiliateId === affiliateId,
    );

    // 2. Load configured tiers for program (or org defaults)
    const tiers = this.getActiveTiers(organizationId, programId);
    if (!tiers.length) {
      return null;
    }

    const defaultTier = tiers.find((t) => t.isDefault) || tiers[tiers.length - 1];

    // If affiliate has no tier state yet, initialize at default tier
    if (!affiliateTier) {
      affiliateTier = {
        id: uuidv4(),
        organizationId,
        programId,
        affiliateId,
        currentTierId: defaultTier.id,
        previousTierId: undefined,
        effectiveFrom: new Date(),
        isLocked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.affiliateTiers.push(affiliateTier);

      // Record initial history
      dbStore.affiliateTierHistories.push({
        id: uuidv4(),
        organizationId,
        programId,
        affiliateId,
        previousTierId: undefined,
        newTierId: defaultTier.id,
        transitionType: TierTransitionType.INITIAL_ASSIGNMENT,
        reason: 'Initial default tier assignment on program enrollment',
        metricSnapshot: {},
        ruleSnapshot: { tierCode: defaultTier.code, name: defaultTier.name },
        effectiveCommissionRate: defaultTier.commissionRateOverride,
        createdAt: new Date(),
      });
    }

    // If tier is manually locked, do not modify
    if (affiliateTier.isLocked) {
      this.logger.debug(`Affiliate ${affiliateId} tier is locked (${affiliateTier.lockReason}). Skipping auto evaluation.`);
      const currentTier = tiers.find((t) => t.id === affiliateTier!.currentTierId) || defaultTier;
      return {
        affiliateId,
        previousTier: currentTier,
        newTier: currentTier,
        transitionType: 'UNCHANGED',
        reason: `Tier is locked: ${affiliateTier.lockReason || 'Manual lock'}`,
        metricSnapshot: {},
        upgraded: false,
        downgraded: false,
      };
    }

    const currentTier = tiers.find((t) => t.id === affiliateTier.currentTierId) || defaultTier;

    // 3. Gather affiliate metrics for relevant periods
    const performanceSummary = this.getPerformanceMetrics(organizationId, programId, affiliateId);
    const metricSnapshot = {
      approvedConversions: performanceSummary.approvedConversions,
      revenue: performanceSummary.revenue / 100, // in dollars
      attributedRevenue: performanceSummary.attributedRevenue / 100,
      commissionEarned: performanceSummary.commissionEarned / 100,
      qualifiedLeads: performanceSummary.qualifiedLeads,
      closedWonDeals: performanceSummary.closedWonDeals,
      clicks: performanceSummary.clicks,
      trackingLinksCreated: performanceSummary.trackingLinksCreated,
      conversionRate: performanceSummary.clicks > 0
        ? Number(((performanceSummary.approvedConversions / performanceSummary.clicks) * 100).toFixed(2))
        : 0,
    };

    // 4. Evaluate highest qualifying tier (tiers sorted highest level to lowest)
    let highestEligibleTier: PartnerTierEntity = defaultTier;

    for (const tier of tiers) {
      if (this.doesQualifyForTier(tier, metricSnapshot)) {
        highestEligibleTier = tier;
        break; // Tiers are ordered descending by level; first match is the highest
      }
    }

    // 5. Check if tier transition occurs
    if (highestEligibleTier.level > currentTier.level) {
      // UPGRADE: Immediate upgrade
      return await this.applyTierUpgrade(
        organizationId,
        programId,
        affiliateId,
        affiliateTier,
        currentTier,
        highestEligibleTier,
        metricSnapshot,
        context?.actorId,
      );
    } else if (highestEligibleTier.level < currentTier.level) {
      // Potential DOWNGRADE: check configured downgrade rules
      return await this.handlePotentialDowngrade(
        organizationId,
        programId,
        affiliateId,
        affiliateTier,
        currentTier,
        highestEligibleTier,
        metricSnapshot,
        Boolean(context?.isPeriodBoundaryJob),
      );
    }

    // No change in tier
    return {
      affiliateId,
      previousTier: currentTier,
      newTier: currentTier,
      transitionType: 'UNCHANGED',
      reason: 'Performance matches current tier requirements',
      metricSnapshot,
      upgraded: false,
      downgraded: false,
      effectiveCommissionRate: currentTier.commissionRateOverride,
    };
  }

  private async applyTierUpgrade(
    organizationId: string,
    programId: string,
    affiliateId: string,
    affiliateTier: AffiliateTierEntity,
    previousTier: PartnerTierEntity,
    newTier: PartnerTierEntity,
    metricSnapshot: Record<string, any>,
    actorId?: string,
  ): Promise<TierEvaluationResult> {
    const reason = `Auto upgrade from ${previousTier.name} to ${newTier.name} based on performance milestones`;
    
    // Update active tier record
    affiliateTier.previousTierId = previousTier.id;
    affiliateTier.currentTierId = newTier.id;
    affiliateTier.effectiveFrom = new Date();
    affiliateTier.gracePeriodExpiresAt = undefined;
    affiliateTier.updatedAt = new Date();

    // Create immutable tier history record
    const history: AffiliateTierHistoryEntity = {
      id: uuidv4(),
      organizationId,
      programId,
      affiliateId,
      previousTierId: previousTier.id,
      newTierId: newTier.id,
      transitionType: TierTransitionType.AUTOMATIC_UPGRADE,
      reason,
      metricSnapshot,
      ruleSnapshot: {
        tierLevel: newTier.level,
        tierCode: newTier.code,
        tierName: newTier.name,
        commissionRateOverride: newTier.commissionRateOverride,
        conditions: newTier.conditions,
      },
      effectiveCommissionRate: newTier.commissionRateOverride,
      createdBy: actorId,
      createdAt: new Date(),
    };
    dbStore.affiliateTierHistories.push(history);

    // Record audit log
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.AFFILIATE_TIER_UPGRADED,
      resourceType: 'affiliate_tier',
      resourceId: newTier.id,
      metadata: {
        affiliateId,
        programId,
        previousTier: previousTier.name,
        newTier: newTier.name,
        commissionRate: newTier.commissionRateOverride,
        metricSnapshot,
      },
      createdAt: new Date(),
    });

    // Handle commission effective strategy: if retroactive adjustments are required,
    // perform adjustments for the current period (audit and ledger entries).
    try {
      if (newTier.commissionRateEffectiveStrategy === CommissionRateEffectiveStrategy.RETROACTIVE_CURRENT_PERIOD) {
        await this.commissionsService.applyRetroactiveAdjustment(organizationId, programId, affiliateId, newTier);
      }
    } catch (adjErr: any) {
      this.logger.warn(`Retroactive adjustment failed for affiliate ${affiliateId}: ${adjErr?.message || adjErr}`);
    }

    // Execute Tier Rewards (bonus, notifications, badge)
    if (newTier.rewardsConfig) {
      await this.rewardExecutor.executeReward({
        organizationId,
        programId,
        affiliateId,
        rewardType: 'TIER_UPGRADE',
        rewardConfig: {
          ...newTier.rewardsConfig,
          notificationTitle: `🌟 You've been promoted to ${newTier.name} Tier!`,
          notificationBody: `Congratulations! You unlocked ${newTier.name} Tier. Your commission rate is now ${newTier.commissionRateOverride ? (newTier.commissionRateOverride / 100).toFixed(1) + '%' : 'upgraded'}.`,
          badgeName: newTier.badge || `${newTier.name} Partner`,
        },
        idempotencyKey: `tier-upgrade-${affiliateId}-${newTier.id}-${Date.now()}`,
        tierId: newTier.id,
        source: 'TIER',
        reason,
      });
    }

    this.logger.log(`Affiliate ${affiliateId} upgraded from ${previousTier.name} to ${newTier.name}`);

    return {
      affiliateId,
      previousTier,
      newTier,
      transitionType: TierTransitionType.AUTOMATIC_UPGRADE,
      reason,
      metricSnapshot,
      upgraded: true,
      downgraded: false,
      effectiveCommissionRate: newTier.commissionRateOverride,
    };
  }

  private async handlePotentialDowngrade(
    organizationId: string,
    programId: string,
    affiliateId: string,
    affiliateTier: AffiliateTierEntity,
    currentTier: PartnerTierEntity,
    eligibleTier: PartnerTierEntity,
    metricSnapshot: Record<string, any>,
    isPeriodBoundaryJob: boolean,
  ): Promise<TierEvaluationResult> {
    const downgradeMode = currentTier.downgradeMode || TierDowngradeMode.DOWNGRADE_NEXT_PERIOD;

    if (downgradeMode === TierDowngradeMode.NEVER_DOWNGRADE) {
      return {
        affiliateId,
        previousTier: currentTier,
        newTier: currentTier,
        transitionType: 'UNCHANGED',
        reason: 'Tier downgrade disabled by program setting (NEVER_DOWNGRADE)',
        metricSnapshot,
        upgraded: false,
        downgraded: false,
      };
    }

    // If grace period configured, apply grace period first
    if (downgradeMode === TierDowngradeMode.GRACE_PERIOD) {
      const graceDays = currentTier.gracePeriodDays || 7;
      if (!affiliateTier.gracePeriodExpiresAt) {
        // Start grace period
        affiliateTier.gracePeriodExpiresAt = new Date(Date.now() + graceDays * 24 * 3600 * 1000);
        affiliateTier.updatedAt = new Date();
        this.logger.log(`Affiliate ${affiliateId} entered ${graceDays}-day grace period before downgrade.`);
        return {
          affiliateId,
          previousTier: currentTier,
          newTier: currentTier,
          transitionType: 'UNCHANGED',
          reason: `In ${graceDays}-day grace period until ${affiliateTier.gracePeriodExpiresAt.toISOString()}`,
          metricSnapshot,
          upgraded: false,
          downgraded: false,
        };
      } else if (new Date() < new Date(affiliateTier.gracePeriodExpiresAt)) {
        // Grace period still active
        return {
          affiliateId,
          previousTier: currentTier,
          newTier: currentTier,
          transitionType: 'UNCHANGED',
          reason: `In grace period until ${affiliateTier.gracePeriodExpiresAt.toISOString()}`,
          metricSnapshot,
          upgraded: false,
          downgraded: false,
        };
      }
    }

    // If DOWNGRADE_NEXT_PERIOD, only execute downgrade during scheduled period boundary job
    if (downgradeMode === TierDowngradeMode.DOWNGRADE_NEXT_PERIOD && !isPeriodBoundaryJob) {
      return {
        affiliateId,
        previousTier: currentTier,
        newTier: currentTier,
        transitionType: 'UNCHANGED',
        reason: 'Tier downgrade deferred until next period boundary evaluation',
        metricSnapshot,
        upgraded: false,
        downgraded: false,
      };
    }

    // Execute Downgrade
    const reason = `Downgrade from ${currentTier.name} to ${eligibleTier.name} due to period metric reset`;
    affiliateTier.previousTierId = currentTier.id;
    affiliateTier.currentTierId = eligibleTier.id;
    affiliateTier.effectiveFrom = new Date();
    affiliateTier.gracePeriodExpiresAt = undefined;
    affiliateTier.updatedAt = new Date();

    dbStore.affiliateTierHistories.push({
      id: uuidv4(),
      organizationId,
      programId,
      affiliateId,
      previousTierId: currentTier.id,
      newTierId: eligibleTier.id,
      transitionType: TierTransitionType.AUTOMATIC_DOWNGRADE,
      reason,
      metricSnapshot,
      ruleSnapshot: { tierCode: eligibleTier.code, name: eligibleTier.name },
      effectiveCommissionRate: eligibleTier.commissionRateOverride,
      createdAt: new Date(),
    });

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'SYSTEM',
      actorId: 'system',
      action: AuditAction.AFFILIATE_TIER_DOWNGRADED,
      resourceType: 'affiliate_tier',
      resourceId: eligibleTier.id,
      metadata: {
        affiliateId,
        programId,
        previousTier: currentTier.name,
        newTier: eligibleTier.name,
        metricSnapshot,
      },
      createdAt: new Date(),
    });

    // Unlike upgrades, downgrade notifications aren't gated behind a configured
    // rewardsConfig — an affiliate should always be told when their tier drops.
    try {
      await this.rewardExecutor.executeReward({
        organizationId,
        programId,
        affiliateId,
        rewardType: MilestoneRewardType.NOTIFICATION,
        rewardConfig: {
          notificationTitle: `Your tier changed to ${eligibleTier.name}`,
          notificationBody: `Your partner tier moved from ${currentTier.name} to ${eligibleTier.name} based on your recent performance.${eligibleTier.commissionRateOverride ? ` Your commission rate is now ${(eligibleTier.commissionRateOverride / 100).toFixed(1)}%.` : ''}`,
          emailSubject: 'Your partner tier has changed',
          emailBody: `Your partner tier moved from ${currentTier.name} to ${eligibleTier.name} based on your recent performance.`,
          tierName: eligibleTier.name,
          commissionRate: eligibleTier.commissionRateOverride ? `${(eligibleTier.commissionRateOverride / 100).toFixed(1)}%` : undefined,
        },
        idempotencyKey: `tier-downgrade-${affiliateId}-${eligibleTier.id}-${Date.now()}`,
        tierId: eligibleTier.id,
        source: 'TIER',
        reason,
      });
    } catch (notifyErr: any) {
      this.logger.warn(`Downgrade notification failed for affiliate ${affiliateId}: ${notifyErr?.message || notifyErr}`);
    }

    return {
      affiliateId,
      previousTier: currentTier,
      newTier: eligibleTier,
      transitionType: TierTransitionType.AUTOMATIC_DOWNGRADE,
      reason,
      metricSnapshot,
      upgraded: false,
      downgraded: true,
      effectiveCommissionRate: eligibleTier.commissionRateOverride,
    };
  }

  doesQualifyForTier(tier: PartnerTierEntity, metrics: Record<string, any>): boolean {
    const conditions = tier.conditions;
    if (!conditions) {
      return true;
    }

    const rules = conditions.rules || [];
    const matchType = conditions.matchType || 'ALL';

    // Direct threshold fields fallback
    const directConditions: Array<{ metric: string; operator: string; value: number }> = [];
    if (conditions.minimumConversions !== undefined) {
      directConditions.push({ metric: GamificationMetric.APPROVED_CONVERSIONS, operator: 'GREATER_THAN_OR_EQUAL', value: conditions.minimumConversions });
    }
    if (conditions.minimumRevenue !== undefined) {
      directConditions.push({ metric: GamificationMetric.REVENUE_GENERATED, operator: 'GREATER_THAN_OR_EQUAL', value: conditions.minimumRevenue });
    }
    if (conditions.minimumQualifiedLeads !== undefined) {
      directConditions.push({ metric: GamificationMetric.QUALIFIED_LEADS, operator: 'GREATER_THAN_OR_EQUAL', value: conditions.minimumQualifiedLeads });
    }
    if (conditions.minimumClosedWonDeals !== undefined) {
      directConditions.push({ metric: GamificationMetric.CLOSED_WON_DEALS, operator: 'GREATER_THAN_OR_EQUAL', value: conditions.minimumClosedWonDeals });
    }
    if (conditions.minimumCommissionEarned !== undefined) {
      directConditions.push({ metric: GamificationMetric.COMMISSION_EARNED, operator: 'GREATER_THAN_OR_EQUAL', value: conditions.minimumCommissionEarned });
    }

    const allRules = [...rules, ...directConditions];
    if (!allRules.length) {
      return true;
    }

    const results = allRules.map((rule) => {
      const metricKey = this.mapMetricToProperty(rule.metric);
      const actualVal = Number(metrics[metricKey] || 0);
      const targetVal = Number(rule.value || 0);
      const op = String(rule.operator || 'GREATER_THAN_OR_EQUAL').toUpperCase();

      switch (op) {
        case 'GREATER_THAN':
        case 'GT':
          return actualVal > targetVal;
        case 'GREATER_THAN_OR_EQUAL':
        case 'GTE':
          return actualVal >= targetVal;
        case 'EQUAL':
        case 'EQUALS':
        case 'EQ':
          return actualVal === targetVal;
        case 'LESS_THAN':
        case 'LT':
          return actualVal < targetVal;
        case 'LESS_THAN_OR_EQUAL':
        case 'LTE':
          return actualVal <= targetVal;
        case 'BETWEEN':
          return actualVal >= targetVal && actualVal <= Number(rule.secondaryValue || Infinity);
        default:
          return actualVal >= targetVal;
      }
    });

    return matchType === 'ANY' ? results.some(Boolean) : results.every(Boolean);
  }

  private mapMetricToProperty(metric: string | GamificationMetric): string {
    switch (metric) {
      case GamificationMetric.APPROVED_CONVERSIONS:
        return 'approvedConversions';
      case GamificationMetric.REVENUE_GENERATED:
      case GamificationMetric.ATTRIBUTED_REVENUE:
        return 'revenue';
      case GamificationMetric.COMMISSION_EARNED:
        return 'commissionEarned';
      case GamificationMetric.QUALIFIED_LEADS:
        return 'qualifiedLeads';
      case GamificationMetric.CLOSED_WON_DEALS:
        return 'closedWonDeals';
      case GamificationMetric.TRACKING_LINK_CLICKS:
        return 'clicks';
      case GamificationMetric.NEW_CUSTOMERS:
        return 'approvedConversions';
      case GamificationMetric.CONVERSION_RATE:
        return 'conversionRate';
      default:
        return 'approvedConversions';
    }
  }

  getActiveTiers(organizationId: string, programId?: string): PartnerTierEntity[] {
    return dbStore.partnerTiers
      .filter(
        (t) =>
          t.organizationId === organizationId &&
          (!t.programId || t.programId === programId) &&
          t.isActive &&
          !t.deletedAt,
      )
      .sort((a, b) => b.level - a.level); // Descending by level
  }

  private getPerformanceMetrics(organizationId: string, programId: string, affiliateId: string) {
    // 1. Try aggregated summary
    const summary = dbStore.affiliatePerformanceSummaries.find(
      (s) =>
        s.organizationId === organizationId &&
        s.programId === programId &&
        s.affiliateId === affiliateId &&
        s.periodType === 'LIFETIME',
    );

    if (summary) {
      return summary;
    }

    // 2. Real-time compute fallback if summary hasn't been materialized yet
    const conversions = dbStore.conversions.filter(
      (c) =>
        c.organizationId === organizationId &&
        c.programId === programId &&
        c.affiliateId === affiliateId &&
        c.status === 'APPROVED',
    );

    const revenue = conversions.reduce((sum, c) => sum + (c.amount || 0), 0);
    const commissions = dbStore.commissions.filter(
      (c) =>
        c.organizationId === organizationId &&
        c.programId === programId &&
        c.affiliateId === affiliateId &&
        c.status === 'APPROVED',
    );
    const commissionEarned = commissions.reduce((sum, c) => sum + netCommissionAmount(c), 0);
    const links = dbStore.trackingLinks.filter(
      (l) => l.organizationId === organizationId && l.programId === programId && l.affiliateId === affiliateId,
    );
    const clicks = dbStore.clicks.filter(
      (c) => c.organizationId === organizationId && c.affiliateId === affiliateId,
    );
    const deals = dbStore.partnerDeals.filter(
      (d) => d.organizationId === organizationId && d.affiliateId === affiliateId && d.status === 'CLOSED_WON',
    );

    return {
      clicks: clicks.length,
      trackingLinksCreated: links.length,
      approvedConversions: conversions.length,
      revenue,
      attributedRevenue: revenue,
      commissionEarned,
      qualifiedLeads: 0,
      closedWonDeals: deals.length,
      closedWonRevenue: deals.reduce((sum, d) => sum + (d.actualValue || d.estimatedValue || 0), 0),
    };
  }
}
