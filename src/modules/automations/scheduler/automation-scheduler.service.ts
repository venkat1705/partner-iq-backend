import { Injectable, Logger } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { AutomationExecutionStatus, AutomationStepStatus } from '../../../common/enums';
import { AutomationStepRunnerService } from '../engine/automation-step-runner.service';

@Injectable()
export class AutomationSchedulerService {
  private readonly logger = new Logger(AutomationSchedulerService.name);

  constructor(private readonly stepRunner: AutomationStepRunnerService) {}

  /**
   * Process all pending scheduled steps whose execution time has arrived.
   */
  async processScheduledSteps() {
    const now = new Date();
    const pendingSteps = dbStore.automationScheduledSteps.filter(
      (s) => s.status === AutomationStepStatus.PENDING && new Date(s.executeAt) <= now,
    );

    if (!pendingSteps.length) return { processed: 0 };

    this.logger.debug(`Processing ${pendingSteps.length} scheduled automation steps.`);

    let processedCount = 0;

    for (const step of pendingSteps) {
      step.status = AutomationStepStatus.PROCESSING;
      step.attemptCount += 1;
      step.updatedAt = new Date();

      const execution = dbStore.automationExecutions.find((e) => e.id === step.executionId);
      const workflow = dbStore.automationWorkflows.find((w) => w.id === step.workflowId);

      if (!execution || !workflow || execution.status === AutomationExecutionStatus.CANCELLED || execution.status === AutomationExecutionStatus.GOAL_REACHED) {
        step.status = AutomationStepStatus.CANCELLED;
        step.lastError = 'Execution already cancelled or goal reached';
        continue;
      }

      // Quiet Hours Protection Check (10:00 PM to 08:00 AM)
      if (workflow.quietHoursEnabled && this.isQuietHour(workflow.quietHoursStart || '22:00', workflow.quietHoursEnd || '08:00')) {
        // Reschedule to 8:05 AM tomorrow
        const tomorrow8am = new Date();
        tomorrow8am.setDate(tomorrow8am.getDate() + 1);
        tomorrow8am.setHours(8, 5, 0, 0);
        step.executeAt = tomorrow8am;
        step.status = AutomationStepStatus.PENDING;
        this.logger.log(`Step ${step.id} deferred to ${tomorrow8am.toISOString()} due to quiet hours protection.`);
        continue;
      }

      // Email Frequency Capping Protection Check
      if (this.hasExceededEmailFrequency(execution.organizationId, execution.affiliateId, workflow.maxEmailsPerDay || 2)) {
        // Reschedule by 12 hours
        step.executeAt = new Date(Date.now() + 12 * 3600 * 1000);
        step.status = AutomationStepStatus.PENDING;
        this.logger.log(`Step ${step.id} deferred due to daily email frequency protection limit.`);
        continue;
      }

      try {
        await this.stepRunner.runStep(execution, workflow, step.nodeId);
        step.status = AutomationStepStatus.COMPLETED;
        step.updatedAt = new Date();
        processedCount++;
      } catch (err: any) {
        this.logger.error(`Error processing step ${step.id}: ${err.message}`);
        step.status = AutomationStepStatus.FAILED;
        step.lastError = err.message;
        step.updatedAt = new Date();
      }
    }

    return { processed: processedCount };
  }

  private isQuietHour(startTime: string, endTime: string): boolean {
    const now = new Date();
    const currentHour = now.getHours();

    const [startH] = startTime.split(':').map(Number);
    const [endH] = endTime.split(':').map(Number);

    if (startH > endH) {
      // Overnight range, e.g. 22:00 to 08:00
      return currentHour >= startH || currentHour < endH;
    } else {
      return currentHour >= startH && currentHour < endH;
    }
  }

  private hasExceededEmailFrequency(organizationId: string, affiliateId: string, maxPerDay: number): boolean {
    const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const sentToday = dbStore.automationEmailLogs.filter(
      (l) => l.organizationId === organizationId && l.affiliateId === affiliateId && new Date(l.createdAt) >= oneDayAgo,
    ).length;

    return sentToday >= maxPerDay;
  }
}
