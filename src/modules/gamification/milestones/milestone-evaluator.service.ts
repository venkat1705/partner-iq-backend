import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  dbStore,
  MilestoneEntity,
  AffiliateMilestoneAchievementEntity,
} from '../../../database/store';
import {
  GamificationMetric,
  MilestoneResetBehavior,
  MilestoneRewardStatus,
  AuditAction,
} from '../../../common/enums';
import { RewardExecutorService } from '../rewards/reward-executor.service';

export interface MilestoneProgressItem {
  milestone: MilestoneEntity;
  currentValue: number;
  targetValue: number;
  percentage: number;
  isAchieved: boolean;
  achievedAt?: Date;
  achievementId?: string;
  repeatCount?: number;
}

@Injectable()
export class MilestoneEvaluatorService {
  private readonly logger = new Logger(MilestoneEvaluatorService.name);

  constructor(private readonly rewardExecutor: RewardExecutorService) {}

  /**
   * Evaluate all active milestones for an affiliate upon a performance change.
   */
  async evaluateMilestonesForAffiliate(
    organizationId: string,
    programId: string,
    affiliateId: string,
  ): Promise<AffiliateMilestoneAchievementEntity[]> {
    const milestones = dbStore.milestones.filter(
      (m) =>
        m.organizationId === organizationId &&
        (!m.programId || m.programId === programId) &&
        m.isActive,
    );

    const newlyAchieved: AffiliateMilestoneAchievementEntity[] = [];

    for (const milestone of milestones) {
      const metricValue = this.resolveMetricValue(organizationId, programId, affiliateId, milestone.metric, milestone.period);
      const isQualifying = metricValue >= milestone.targetValue;

      if (!isQualifying) {
        continue;
      }

      // Check period key / repeatability
      const periodKey = this.computePeriodKey(milestone, metricValue);

      // Check existing achievement for this period key
      const existingAchievement = dbStore.affiliateMilestoneAchievements.find(
        (a) =>
          a.organizationId === organizationId &&
          a.affiliateId === affiliateId &&
          a.milestoneId === milestone.id &&
          a.periodKey === periodKey,
      );

      if (existingAchievement) {
        continue; // Already processed for this period/iteration
      }

      // Deterministic idempotency key
      const idempotencyKey = `milestone-${organizationId}-${affiliateId}-${milestone.id}-${periodKey}`;

      const achievement: AffiliateMilestoneAchievementEntity = {
        id: uuidv4(),
        organizationId,
        programId,
        affiliateId,
        milestoneId: milestone.id,
        periodKey,
        periodStart: new Date(),
        periodEnd: undefined,
        metricValue,
        targetValue: milestone.targetValue,
        achievedAt: new Date(),
        rewardStatus: MilestoneRewardStatus.PROCESSING,
        rewardProcessedAt: undefined,
        idempotencyKey,
        createdAt: new Date(),
      };

      dbStore.affiliateMilestoneAchievements.push(achievement);

      // Execute Rewards
      const execResult = await this.rewardExecutor.executeReward({
        organizationId,
        programId,
        affiliateId,
        rewardType: milestone.rewardType,
        rewardConfig: {
          ...milestone.rewardConfig,
          badgeName: milestone.badgeName || milestone.name,
          badgeIcon: milestone.badgeIcon || 'award',
          notificationTitle: `🏆 Milestone Reached: ${milestone.name}`,
          notificationBody: `Congratulations! You achieved the '${milestone.name}' milestone.`,
        },
        idempotencyKey,
        milestoneId: milestone.id,
        source: 'MILESTONE',
        reason: `Achieved milestone ${milestone.name} (${metricValue}/${milestone.targetValue})`,
      });

      achievement.rewardStatus = execResult.success
        ? MilestoneRewardStatus.COMPLETED
        : MilestoneRewardStatus.FAILED;
      achievement.rewardProcessedAt = new Date();
      if (execResult.error) {
        achievement.rewardError = execResult.error;
      }

      // Record audit log
      dbStore.auditLogs.push({
        id: uuidv4(),
        organizationId,
        actorType: 'SYSTEM',
        actorId: 'system',
        action: AuditAction.MILESTONE_ACHIEVED,
        resourceType: 'milestone',
        resourceId: milestone.id,
        metadata: {
          affiliateId,
          milestoneName: milestone.name,
          metricValue,
          targetValue: milestone.targetValue,
          periodKey,
        },
        createdAt: new Date(),
      });

      newlyAchieved.push(achievement);
      this.logger.log(`Affiliate ${affiliateId} achieved milestone '${milestone.name}' (${periodKey})`);
    }

    return newlyAchieved;
  }

  /**
   * Get progress for all milestones for an affiliate.
   */
  async getAffiliateMilestoneProgress(
    organizationId: string,
    programId: string,
    affiliateId: string,
  ): Promise<MilestoneProgressItem[]> {
    const milestones = dbStore.milestones
      .filter(
        (m) =>
          m.organizationId === organizationId &&
          (!m.programId || m.programId === programId) &&
          m.isActive,
      )
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const achievements = dbStore.affiliateMilestoneAchievements.filter(
      (a) =>
        a.organizationId === organizationId &&
        a.programId === programId &&
        a.affiliateId === affiliateId,
    );

    return milestones.map((milestone) => {
      const currentValue = this.resolveMetricValue(organizationId, programId, affiliateId, milestone.metric, milestone.period);
      const targetValue = milestone.targetValue;
      const percentage = Math.min(100, Math.round((currentValue / targetValue) * 100));

      const milestoneAchievements = achievements.filter((a) => a.milestoneId === milestone.id);
      const latestAchievement = milestoneAchievements.sort(
        (a, b) => new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime(),
      )[0];

      return {
        milestone,
        currentValue,
        targetValue,
        percentage,
        isAchieved: Boolean(latestAchievement),
        achievedAt: latestAchievement?.achievedAt,
        achievementId: latestAchievement?.id,
        repeatCount: milestoneAchievements.length,
      };
    });
  }

  private resolveMetricValue(
    organizationId: string,
    programId: string,
    affiliateId: string,
    metric: GamificationMetric,
    period?: string,
  ): number {
    const isMonthly = period === 'MONTHLY';
    const now = new Date();
    const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    if (isMonthly) {
      const summary = dbStore.affiliatePerformanceSummaries.find(
        (s) =>
          s.organizationId === organizationId &&
          s.programId === programId &&
          s.affiliateId === affiliateId &&
          s.periodKey === currentMonthKey,
      );
      if (summary) {
        return this.extractMetricFromSummary(summary, metric);
      }
    }

    // Default to lifetime
    const summary = dbStore.affiliatePerformanceSummaries.find(
      (s) =>
        s.organizationId === organizationId &&
        s.programId === programId &&
        s.affiliateId === affiliateId &&
        s.periodType === 'LIFETIME',
    );

    if (summary) {
      return this.extractMetricFromSummary(summary, metric);
    }

    // Direct count fallback
    switch (metric) {
      case GamificationMetric.APPROVED_CONVERSIONS:
        return dbStore.conversions.filter(
          (c) => c.organizationId === organizationId && c.programId === programId && c.affiliateId === affiliateId && c.status === 'APPROVED',
        ).length;
      case GamificationMetric.REVENUE_GENERATED:
      case GamificationMetric.ATTRIBUTED_REVENUE:
        return Math.round(
          dbStore.conversions
            .filter((c) => c.organizationId === organizationId && c.programId === programId && c.affiliateId === affiliateId && c.status === 'APPROVED')
            .reduce((sum, c) => sum + (c.amount || 0), 0) / 100,
        );
      case GamificationMetric.COMMISSION_EARNED:
        return Math.round(
          dbStore.commissions
            .filter((c) => c.organizationId === organizationId && c.programId === programId && c.affiliateId === affiliateId && c.status === 'APPROVED')
            .reduce((sum, c) => sum + (c.commissionAmount || 0), 0) / 100,
        );
      case GamificationMetric.TRACKING_LINK_CLICKS:
        return dbStore.clicks.filter((c) => c.organizationId === organizationId && c.affiliateId === affiliateId).length;
      case GamificationMetric.CLOSED_WON_DEALS:
        return dbStore.partnerDeals.filter((d) => d.organizationId === organizationId && d.affiliateId === affiliateId && d.status === 'CLOSED_WON').length;
      default:
        return 0;
    }
  }

  private extractMetricFromSummary(summary: any, metric: GamificationMetric): number {
    switch (metric) {
      case GamificationMetric.APPROVED_CONVERSIONS:
        return summary.approvedConversions;
      case GamificationMetric.REVENUE_GENERATED:
      case GamificationMetric.ATTRIBUTED_REVENUE:
        return Math.round(summary.revenue / 100);
      case GamificationMetric.COMMISSION_EARNED:
        return Math.round(summary.commissionEarned / 100);
      case GamificationMetric.TRACKING_LINK_CLICKS:
        return summary.clicks;
      case GamificationMetric.QUALIFIED_LEADS:
        return summary.qualifiedLeads;
      case GamificationMetric.CLOSED_WON_DEALS:
        return summary.closedWonDeals;
      default:
        return summary.approvedConversions;
    }
  }

  private computePeriodKey(milestone: MilestoneEntity, metricValue: number): string {
    const now = new Date();
    if (milestone.resetBehavior === MilestoneResetBehavior.RESET_AT_PERIOD_START) {
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    if (milestone.isRepeatable && milestone.repeatInterval) {
      const iteration = Math.floor(metricValue / milestone.repeatInterval);
      return `iter-${iteration}`;
    }

    return 'LIFETIME';
  }
}
