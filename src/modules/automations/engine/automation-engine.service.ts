import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  dbStore,
  awaitPersist,
  AutomationExecutionEntity,
  AutomationWorkflowEntity,
} from '../../../database/store';
import {
  AutomationExecutionStatus,
  AutomationTriggerType,
  AutomationWorkflowStatus,
  AutomationNodeType,
} from '../../../common/enums';
import { AutomationStepRunnerService } from './automation-step-runner.service';

@Injectable()
export class AutomationEngineService {
  private readonly logger = new Logger(AutomationEngineService.name);

  constructor(private readonly stepRunner: AutomationStepRunnerService) {}

  /**
   * Handle generic lifecycle and performance events.
   */
  async handleEvent(
    triggerType: AutomationTriggerType,
    organizationId: string,
    programId: string,
    affiliateId: string,
    payload?: Record<string, any>,
  ) {
    this.logger.debug(
      `Processing automation event '${triggerType}' for affiliate ${affiliateId} (Org: ${organizationId})`,
    );

    // 1. Check goal evaluations for currently running/waiting executions to see if event satisfies exit goals
    await this.checkRunningExecutionGoals(organizationId, programId, affiliateId);

    // 2. Find active workflows matching this trigger
    const matchingWorkflows = dbStore.automationWorkflows.filter(
      (w) =>
        w.organizationId === organizationId &&
        (!w.programId || w.programId === programId) &&
        w.triggerType === triggerType &&
        w.status === AutomationWorkflowStatus.ACTIVE,
    );

    for (const workflow of matchingWorkflows) {
      // Prevent duplicate active running execution for the same workflow and affiliate
      const existingRunning = dbStore.automationExecutions.find(
        (e) =>
          e.workflowId === workflow.id &&
          e.affiliateId === affiliateId &&
          (e.status === AutomationExecutionStatus.RUNNING || e.status === AutomationExecutionStatus.WAITING),
      );

      if (existingRunning) {
        this.logger.debug(`Affiliate ${affiliateId} already has an active execution for workflow ${workflow.name}.`);
        continue;
      }

      // Start new execution
      const triggerNode = workflow.nodes.find((n) => n.type === AutomationNodeType.TRIGGER);
      if (!triggerNode) continue;

      const execution: AutomationExecutionEntity = {
        id: uuidv4(),
        organizationId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        affiliateId,
        programId,
        status: AutomationExecutionStatus.RUNNING,
        currentNodeId: triggerNode.id,
        context: {
          triggerType,
          payload: payload || {},
          startedAt: new Date(),
        },
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      dbStore.automationExecutions.push(execution);
      await awaitPersist(execution);

      // Advance execution
      await this.stepRunner.runStep(execution, workflow, triggerNode.id);
    }
  }

  /**
   * Check running executions and complete them if exit goals are reached.
   */
  private async checkRunningExecutionGoals(
    organizationId: string,
    programId: string,
    affiliateId: string,
  ) {
    const activeExecutions = dbStore.automationExecutions.filter(
      (e) =>
        e.organizationId === organizationId &&
        e.affiliateId === affiliateId &&
        (e.status === AutomationExecutionStatus.RUNNING || e.status === AutomationExecutionStatus.WAITING),
    );

    const pending: Promise<unknown>[] = [];
    for (const execution of activeExecutions) {
      const workflow = dbStore.automationWorkflows.find((w) => w.id === execution.workflowId);
      if (!workflow || !workflow.goalConfig) continue;

      // Evaluate goal
      const links = dbStore.trackingLinks.filter((l) => l.organizationId === organizationId && l.affiliateId === affiliateId);
      const conversions = dbStore.conversions.filter((c) => c.organizationId === organizationId && c.affiliateId === affiliateId && c.status === 'APPROVED');
      const clicks = dbStore.clicks.filter((c) => c.organizationId === organizationId && c.affiliateId === affiliateId);

      const goalMetric = workflow.goalConfig.metric || 'TRACKING_LINKS_CREATED';
      const targetVal = Number(workflow.goalConfig.value || 0);

      let isGoalMet = false;
      if ((goalMetric === 'TRACKING_LINKS_CREATED' || goalMetric === 'trackingLinksCreated') && links.length > targetVal) {
        isGoalMet = true;
      } else if ((goalMetric === 'APPROVED_CONVERSIONS' || goalMetric === 'approvedConversions') && conversions.length > targetVal) {
        isGoalMet = true;
      } else if ((goalMetric === 'CLICKS' || goalMetric === 'clicks') && clicks.length > targetVal) {
        isGoalMet = true;
      }

      if (isGoalMet) {
        this.logger.log(`Affiliate ${affiliateId} reached goal for workflow '${workflow.name}'. Cancelling pending steps.`);
        execution.status = AutomationExecutionStatus.GOAL_REACHED;
        execution.completedAt = new Date();
        pending.push(awaitPersist(execution));
        this.stepRunner.cancelPendingStepsForExecution(execution.id, 'Goal achieved: Affiliate performed target activity');
      }
    }
    await Promise.all(pending);
  }
}
