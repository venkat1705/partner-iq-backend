import { Injectable, Logger } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { TierEvaluatorService } from '../tiers/tier-evaluator.service';
import { MilestoneEvaluatorService } from '../milestones/milestone-evaluator.service';

@Injectable()
export class PerformanceReconciliationService {
  private readonly logger = new Logger(PerformanceReconciliationService.name);

  constructor(
    private readonly tierEvaluator: TierEvaluatorService,
    private readonly milestoneEvaluator: MilestoneEvaluatorService,
  ) {}

  /**
   * Run scheduled reconciliation across all affiliates in an organization:
   * 1. Detect missed events
   * 2. Recalculate tier qualification at period boundaries
   * 3. Process period downgrade and grace period expirations
   */
  async runPeriodicReconciliation(organizationId?: string) {
    this.logger.log('Starting scheduled Gamification & Tier reconciliation run...');

    const orgs = organizationId
      ? dbStore.organizations.filter((o) => o.id === organizationId)
      : dbStore.organizations.filter((o) => o.status === 'ACTIVE');

    let evaluatedCount = 0;
    let transitionCount = 0;

    for (const org of orgs) {
      const programAffiliates = dbStore.programAffiliates.filter(
        (pa) => pa.organizationId === org.id && pa.status === 'ACTIVE',
      );

      for (const pa of programAffiliates) {
        evaluatedCount++;

        // 1. Evaluate Milestones
        await this.milestoneEvaluator.evaluateMilestonesForAffiliate(org.id, pa.programId, pa.affiliateId);

        // 2. Evaluate Tier (with period boundary flag = true)
        const result = await this.tierEvaluator.evaluateAffiliateTier(org.id, pa.programId, pa.affiliateId, {
          isPeriodBoundaryJob: true,
        });

        if (result && (result.upgraded || result.downgraded)) {
          transitionCount++;
        }
      }
    }

    this.logger.log(
      `Gamification reconciliation complete: Evaluated ${evaluatedCount} affiliates, ${transitionCount} tier transitions.`,
    );

    return { evaluatedCount, transitionCount };
  }
}
