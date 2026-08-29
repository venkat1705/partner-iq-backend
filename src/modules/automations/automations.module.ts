import { Module, forwardRef } from '@nestjs/common';
import { WorkflowService } from './workflows/workflow.service';
import { WorkflowValidatorService } from './workflows/workflow-validator.service';
import { WorkflowController } from './workflows/workflow.controller';
import { EmailTemplateService } from './templates/email-template.service';
import { EmailTemplateController } from './templates/email-template.controller';
import { AutomationEngineService } from './engine/automation-engine.service';
import { AutomationStepRunnerService } from './engine/automation-step-runner.service';
import { AutomationSchedulerService } from './scheduler/automation-scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { LedgerModule } from '../ledger/ledger.module';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [
    NotificationsModule,
    MembershipsModule,
    LedgerModule,
    forwardRef(() => GamificationModule),
  ],
  controllers: [
    WorkflowController,
    EmailTemplateController,
  ],
  providers: [
    WorkflowService,
    WorkflowValidatorService,
    EmailTemplateService,
    AutomationStepRunnerService,
    AutomationEngineService,
    AutomationSchedulerService,
  ],
  exports: [
    WorkflowService,
    EmailTemplateService,
    AutomationEngineService,
    AutomationSchedulerService,
    AutomationStepRunnerService,
  ],
})
export class AutomationsModule {}
