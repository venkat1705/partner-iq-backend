import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  dbStore,
  AutomationExecutionEntity,
  AutomationScheduledStepEntity,
  AutomationWorkflowEntity,
  AutomationEmailLogEntity,
} from '../../../database/store';
import {
  AutomationActionType,
  AutomationEmailDeliveryStatus,
  AutomationExecutionStatus,
  AutomationNodeType,
  AutomationStepStatus,
  LedgerEntryType,
} from '../../../common/enums';
import { EmailTemplateService } from '../templates/email-template.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { LedgerService } from '../../ledger/ledger.service';
import { TierService } from '../../gamification/tiers/tier.service';

@Injectable()
export class AutomationStepRunnerService {
  private readonly logger = new Logger(AutomationStepRunnerService.name);

  constructor(
    private readonly emailTemplateService: EmailTemplateService,
    private readonly notificationsService: NotificationsService,
    private readonly ledgerService: LedgerService,
    private readonly tierService: TierService,
  ) {}

  /**
   * Run the next step of a workflow execution starting from nodeId.
   */
  async runStep(
    execution: AutomationExecutionEntity,
    workflow: AutomationWorkflowEntity,
    nodeId: string,
  ): Promise<{ status: AutomationExecutionStatus; nextNodeId?: string }> {
    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) {
      this.logger.warn(`Node '${nodeId}' not found in workflow ${workflow.id}. Marking execution completed.`);
      execution.status = AutomationExecutionStatus.COMPLETED;
      execution.completedAt = new Date();
      return { status: AutomationExecutionStatus.COMPLETED };
    }

    execution.currentNodeId = nodeId;
    execution.updatedAt = new Date();

    const affiliate = dbStore.affiliates.find((a) => a.id === execution.affiliateId);
    const context = execution.context || {};

    // 1. Check if execution goal is already satisfied before executing node
    if (workflow.goalConfig && this.evaluateGoal(workflow, execution)) {
      this.logger.log(`Goal satisfied for workflow ${workflow.name} (Execution ${execution.id}).`);
      execution.status = AutomationExecutionStatus.GOAL_REACHED;
      execution.completedAt = new Date();
      this.cancelPendingStepsForExecution(execution.id, 'Goal achieved prior to step execution');
      return { status: AutomationExecutionStatus.GOAL_REACHED };
    }

    // 2. Process node by type
    switch (node.type) {
      case AutomationNodeType.TRIGGER: {
        const nextEdge = workflow.edges.find((e) => e.sourceNodeId === node.id);
        if (nextEdge) {
          return await this.runStep(execution, workflow, nextEdge.targetNodeId);
        }
        break;
      }

      case AutomationNodeType.DELAY: {
        const delayAmount = Number(node.config?.delayAmount || 1);
        const delayUnit = String(node.config?.delayUnit || 'DAYS').toUpperCase();

        let delayMs = delayAmount * 24 * 3600 * 1000;
        if (delayUnit === 'HOURS') delayMs = delayAmount * 3600 * 1000;
        if (delayUnit === 'MINUTES') delayMs = delayAmount * 60 * 1000;

        const executeAt = new Date(Date.now() + delayMs);
        const nextEdge = workflow.edges.find((e) => e.sourceNodeId === node.id);

        if (nextEdge) {
          // Schedule durable step
          const scheduledStep: AutomationScheduledStepEntity = {
            id: uuidv4(),
            executionId: execution.id,
            workflowId: workflow.id,
            organizationId: execution.organizationId,
            affiliateId: execution.affiliateId,
            nodeId: nextEdge.targetNodeId,
            executeAt,
            status: AutomationStepStatus.PENDING,
            attemptCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          dbStore.automationScheduledSteps.push(scheduledStep);

          execution.status = AutomationExecutionStatus.WAITING;
          return { status: AutomationExecutionStatus.WAITING, nextNodeId: nextEdge.targetNodeId };
        }
        break;
      }

      case AutomationNodeType.CONDITION: {
        const branchKey = this.evaluateCondition(node.config, execution) ? 'YES' : 'NO';
        const nextEdge =
          workflow.edges.find((e) => e.sourceNodeId === node.id && e.branchKey === branchKey) ||
          workflow.edges.find((e) => e.sourceNodeId === node.id && !e.branchKey);

        if (nextEdge) {
          return await this.runStep(execution, workflow, nextEdge.targetNodeId);
        }
        break;
      }

      case AutomationNodeType.ACTION: {
        await this.executeAction(node.config, execution, workflow);
        const nextEdge = workflow.edges.find((e) => e.sourceNodeId === node.id);
        if (nextEdge) {
          return await this.runStep(execution, workflow, nextEdge.targetNodeId);
        }
        break;
      }

      case AutomationNodeType.GOAL: {
        execution.status = AutomationExecutionStatus.GOAL_REACHED;
        execution.completedAt = new Date();
        this.cancelPendingStepsForExecution(execution.id, 'Goal node reached');
        return { status: AutomationExecutionStatus.GOAL_REACHED };
      }

      case AutomationNodeType.END:
      default: {
        execution.status = AutomationExecutionStatus.COMPLETED;
        execution.completedAt = new Date();
        return { status: AutomationExecutionStatus.COMPLETED };
      }
    }

    execution.status = AutomationExecutionStatus.COMPLETED;
    execution.completedAt = new Date();
    return { status: AutomationExecutionStatus.COMPLETED };
  }

  private evaluateCondition(config: any, execution: AutomationExecutionEntity): boolean {
    const conditions = config?.conditions || [];
    if (!conditions.length) return true;

    const metrics = this.getAffiliateCurrentMetrics(execution.organizationId, execution.programId, execution.affiliateId);
    const matchType = config.matchType || 'ALL';

    const results = conditions.map((cond: any) => {
      const field = cond.field;
      const operator = String(cond.operator || 'EQUAL').toUpperCase();
      const targetVal = cond.value;
      const actualVal = metrics[field] !== undefined ? metrics[field] : 0;

      switch (operator) {
        case 'EQUAL':
        case 'EQUALS':
        case 'EQ':
          return actualVal === targetVal;
        case 'NOT_EQUAL':
        case 'NEQ':
          return actualVal !== targetVal;
        case 'GREATER_THAN':
        case 'GT':
          return Number(actualVal) > Number(targetVal);
        case 'GREATER_THAN_OR_EQUAL':
        case 'GTE':
          return Number(actualVal) >= Number(targetVal);
        case 'LESS_THAN':
        case 'LT':
          return Number(actualVal) < Number(targetVal);
        case 'LESS_THAN_OR_EQUAL':
        case 'LTE':
          return Number(actualVal) <= Number(targetVal);
        default:
          return actualVal === targetVal;
      }
    });

    return matchType === 'ANY' ? results.some(Boolean) : results.every(Boolean);
  }

  private evaluateGoal(workflow: AutomationWorkflowEntity, execution: AutomationExecutionEntity): boolean {
    if (!workflow.goalConfig) return false;
    const metrics = this.getAffiliateCurrentMetrics(execution.organizationId, execution.programId, execution.affiliateId);
    const goalMetric = workflow.goalConfig.metric || 'TRACKING_LINKS_CREATED';
    const op = String(workflow.goalConfig.operator || 'GREATER_THAN').toUpperCase();
    const targetVal = Number(workflow.goalConfig.value || 0);

    let actualVal = 0;
    if (goalMetric === 'TRACKING_LINKS_CREATED' || goalMetric === 'trackingLinksCreated') {
      actualVal = metrics.trackingLinksCreated;
    } else if (goalMetric === 'APPROVED_CONVERSIONS' || goalMetric === 'approvedConversions') {
      actualVal = metrics.approvedConversions;
    } else if (goalMetric === 'CLICKS' || goalMetric === 'clicks') {
      actualVal = metrics.clicks;
    }

    if (op === 'GREATER_THAN' || op === 'GT') return actualVal > targetVal;
    if (op === 'GREATER_THAN_OR_EQUAL' || op === 'GTE') return actualVal >= targetVal;
    if (op === 'EQUAL' || op === 'EQ') return actualVal === targetVal;
    return actualVal > 0;
  }

  private async executeAction(config: any, execution: AutomationExecutionEntity, workflow: AutomationWorkflowEntity) {
    const affiliate = dbStore.affiliates.find((a) => a.id === execution.affiliateId);
    const organization = dbStore.organizations.find((o) => o.id === execution.organizationId);
    const program = dbStore.programs.find((p) => p.id === execution.programId);
    const tierState = dbStore.affiliateTiers.find((at) => at.affiliateId === execution.affiliateId);
    const currentTier = tierState ? dbStore.partnerTiers.find((t) => t.id === tierState.currentTierId) : null;
    const nextTier = dbStore.partnerTiers
      .filter((t) => t.organizationId === execution.organizationId && t.level > (currentTier?.level || 0))
      .sort((a, b) => a.level - b.level)[0];

    const metrics = this.getAffiliateCurrentMetrics(execution.organizationId, execution.programId, execution.affiliateId);

    const templateVariables = {
      affiliate_name: affiliate?.displayName || 'Partner',
      affiliate_first_name: (affiliate?.displayName || 'Partner').split(' ')[0],
      affiliate_email: affiliate?.email || '',
      organization_name: organization?.name || 'PartnerIQ',
      program_name: program?.name || 'Partner Program',
      current_tier: currentTier?.name || 'Bronze',
      next_tier: nextTier?.name || 'Silver',
      current_commission_rate: currentTier?.commissionRateOverride ? (currentTier.commissionRateOverride / 100).toFixed(1) + '%' : '15%',
      next_commission_rate: nextTier?.commissionRateOverride ? (nextTier.commissionRateOverride / 100).toFixed(1) + '%' : '20%',
      current_conversions: String(metrics.approvedConversions),
      target_conversions: String(nextTier?.conditions?.minimumConversions || 10),
      conversions_remaining: String(Math.max(0, (nextTier?.conditions?.minimumConversions || 10) - metrics.approvedConversions)),
      tracking_link_url: `https://partneriq.demo/r/${affiliate?.id?.substring(0, 6) || 'demo'}`,
      asset_library_url: `https://partneriq.demo/app/assets`,
      affiliate_dashboard_url: `https://partneriq.demo/app/affiliate-portal`,
      referral_code: affiliate?.id?.substring(0, 6) || 'PARTNER',
    };

    // 1. EMAIL ACTION
    if (config.actionType === AutomationActionType.SEND_EMAIL || config.emailTemplateCode) {
      const templateCode = config.emailTemplateCode;
      let template = dbStore.automationEmailTemplates.find(
        (t) => t.organizationId === execution.organizationId && t.code === templateCode,
      );

      const subject = template
        ? this.emailTemplateService.substituteVariables(template.subject, templateVariables)
        : (config.notificationTitle || `Important update from ${organization?.name || 'PartnerIQ'}`);

      if (affiliate?.email) {
        dbStore.automationEmailLogs.push({
          id: uuidv4(),
          organizationId: execution.organizationId,
          executionId: execution.id,
          affiliateId: execution.affiliateId,
          templateId: template?.id,
          toEmail: affiliate.email,
          subject,
          status: AutomationEmailDeliveryStatus.SENT,
          sentAt: new Date(),
          createdAt: new Date(),
        });
        this.logger.log(`Automation email sent to ${affiliate.email}: ${subject}`);
      }
    }

    // 2. IN-APP NOTIFICATION
    if (config.notificationTitle || config.notificationBody || config.actionType === AutomationActionType.SEND_IN_APP_NOTIFICATION) {
      const title = this.emailTemplateService.substituteVariables(
        config.notificationTitle || 'Important Partner Update',
        templateVariables,
      );
      const body = this.emailTemplateService.substituteVariables(
        config.notificationBody || 'Check your partner portal for the latest opportunities.',
        templateVariables,
      );

      const user = dbStore.users.find((u) => u.email.toLowerCase() === affiliate?.email.toLowerCase());
      if (user) {
        await this.notificationsService.createNotification({
          userId: user.id,
          organizationId: execution.organizationId,
          title,
          body,
          type: 'program',
          priority: 'normal',
          metadata: { workflowId: workflow.id, executionId: execution.id },
        });
      }
    }

    // 3. ASSIGN TIER
    if (config.actionType === AutomationActionType.ASSIGN_TIER && config.tierId) {
      await this.tierService.assignTierManually(
        execution.organizationId,
        execution.affiliateId,
        { tierId: config.tierId, programId: execution.programId, reason: `Automation action: ${workflow.name}` },
      );
    }

    // 4. GRANT BONUS
    if (config.actionType === AutomationActionType.GRANT_BONUS && config.bonusAmountCents) {
      await this.ledgerService.recordTransaction(
        execution.organizationId,
        execution.affiliateId,
        LedgerEntryType.COMMISSION_EARNED,
        `Automation bonus from ${workflow.name}`,
        uuidv4(),
        config.bonusAmountCents,
      );
    }
  }

  cancelPendingStepsForExecution(executionId: string, reason: string) {
    dbStore.automationScheduledSteps.forEach((step) => {
      if (step.executionId === executionId && step.status === AutomationStepStatus.PENDING) {
        step.status = AutomationStepStatus.CANCELLED;
        step.lastError = reason;
        step.updatedAt = new Date();
      }
    });
  }

  private getAffiliateCurrentMetrics(organizationId: string, programId: string, affiliateId: string) {
    const summary = dbStore.affiliatePerformanceSummaries.find(
      (s) => s.organizationId === organizationId && s.programId === programId && s.affiliateId === affiliateId && s.periodType === 'LIFETIME',
    );

    if (summary) {
      return summary;
    }

    const links = dbStore.trackingLinks.filter((l) => l.organizationId === organizationId && l.affiliateId === affiliateId);
    const conversions = dbStore.conversions.filter((c) => c.organizationId === organizationId && c.affiliateId === affiliateId && c.status === 'APPROVED');
    const clicks = dbStore.clicks.filter((c) => c.organizationId === organizationId && c.affiliateId === affiliateId);

    return {
      trackingLinksCreated: links.length,
      approvedConversions: conversions.length,
      clicks: clicks.length,
      revenue: conversions.reduce((sum, c) => sum + (c.amount || 0), 0),
      commissionEarned: 0,
      qualifiedLeads: 0,
      closedWonDeals: 0,
    };
  }
}
