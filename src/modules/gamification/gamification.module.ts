import { Module } from '@nestjs/common';
import { TierService } from './tiers/tier.service';
import { TierEvaluatorService } from './tiers/tier-evaluator.service';
import { TierController } from './tiers/tier.controller';
import { MilestoneService } from './milestones/milestone.service';
import { MilestoneEvaluatorService } from './milestones/milestone-evaluator.service';
import { MilestoneController } from './milestones/milestone.controller';
import { PerformanceService } from './performance/performance.service';
import { PerformanceAggregationService } from './performance/performance-aggregation.service';
import { PerformanceReconciliationService } from './performance/performance-reconciliation.service';
import { PerformanceController } from './performance/performance.controller';
import { RewardService } from './rewards/reward.service';
import { RewardExecutorService } from './rewards/reward-executor.service';
import { AffiliateGamificationController } from './affiliate-portal/affiliate-gamification.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MembershipsModule } from '../memberships/memberships.module';

@Module({
  imports: [LedgerModule, NotificationsModule, MembershipsModule, CommissionsModule],
  controllers: [
    TierController,
    MilestoneController,
    PerformanceController,
    AffiliateGamificationController,
  ],
  providers: [
    TierService,
    TierEvaluatorService,
    MilestoneService,
    MilestoneEvaluatorService,
    PerformanceService,
    PerformanceAggregationService,
    PerformanceReconciliationService,
    RewardService,
    RewardExecutorService,
  ],
  exports: [
    TierService,
    TierEvaluatorService,
    MilestoneService,
    MilestoneEvaluatorService,
    PerformanceService,
    PerformanceAggregationService,
    PerformanceReconciliationService,
    RewardService,
    RewardExecutorService,
  ],
})
export class GamificationModule {}
