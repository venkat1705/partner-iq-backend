import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  dbStore,
  AutomationWorkflowEntity,
  AutomationWorkflowVersionEntity,
} from '../../../database/store';
import {
  CreateAutomationWorkflowDto,
  UpdateAutomationWorkflowDto,
  InstallTemplateDto,
} from '../dto/workflow.dto';
import {
  AuditAction,
  AutomationExecutionStatus,
  AutomationTriggerType,
  AutomationWorkflowStatus,
} from '../../../common/enums';
import { PREBUILT_WORKFLOW_TEMPLATES } from './workflow-templates.data';
import { WorkflowValidatorService } from './workflow-validator.service';

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(private readonly validator: WorkflowValidatorService) {}

  async createWorkflow(
    organizationId: string,
    dto: CreateAutomationWorkflowDto,
    actorId?: string,
  ): Promise<AutomationWorkflowEntity> {
    if (dto.programId) {
      const program = dbStore.programs.find(
        (p) => p.id === dto.programId && p.organizationId === organizationId && !p.deletedAt,
      );
      if (!program) throw new NotFoundException('Program not found');
    }

    const workflow: AutomationWorkflowEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      name: dto.name.trim(),
      description: dto.description,
      triggerType: dto.triggerType || AutomationTriggerType.AFFILIATE_JOINED_PROGRAM,
      status: dto.status || AutomationWorkflowStatus.DRAFT,
      version: 1,
      goalType: dto.goalType,
      goalConfig: dto.goalConfig,
      maxEmailsPerDay: dto.maxEmailsPerDay ?? 2,
      maxEmailsPerWeek: dto.maxEmailsPerWeek ?? 5,
      quietHoursEnabled: dto.quietHoursEnabled !== undefined ? dto.quietHoursEnabled : true,
      quietHoursStart: dto.quietHoursStart || '22:00',
      quietHoursEnd: dto.quietHoursEnd || '08:00',
      nodes: dto.nodes || [],
      edges: dto.edges || [],
      createdBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (workflow.status === AutomationWorkflowStatus.ACTIVE) {
      this.validator.validateWorkflow(workflow);
    }

    dbStore.automationWorkflows.push(workflow);

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.AUTOMATION_CREATED,
      resourceType: 'automation_workflow',
      resourceId: workflow.id,
      metadata: { name: workflow.name, triggerType: workflow.triggerType },
      createdAt: new Date(),
    });

    return workflow;
  }

  async getWorkflows(organizationId: string, programId?: string) {
    const workflows = dbStore.automationWorkflows.filter(
      (w) =>
        w.organizationId === organizationId &&
        (!programId || !w.programId || w.programId === programId) &&
        w.status !== AutomationWorkflowStatus.ARCHIVED,
    );

    return workflows.map((w) => {
      const executions = dbStore.automationExecutions.filter((e) => e.workflowId === w.id);
      const goalReachedCount = executions.filter((e) => e.status === AutomationExecutionStatus.GOAL_REACHED).length;
      const completedCount = executions.filter((e) => e.status === AutomationExecutionStatus.COMPLETED).length;

      return {
        ...w,
        executionStats: {
          totalEntered: executions.length,
          currentlyRunning: executions.filter((e) => e.status === AutomationExecutionStatus.RUNNING || e.status === AutomationExecutionStatus.WAITING).length,
          goalReached: goalReachedCount,
          completed: completedCount,
          goalConversionRate: executions.length > 0 ? Math.round((goalReachedCount / executions.length) * 100) : 0,
        },
      };
    });
  }

  async getWorkflow(organizationId: string, id: string): Promise<AutomationWorkflowEntity> {
    const workflow = dbStore.automationWorkflows.find(
      (w) => w.id === id && w.organizationId === organizationId,
    );
    if (!workflow) throw new NotFoundException('Automation workflow not found');
    return workflow;
  }

  async updateWorkflow(
    organizationId: string,
    id: string,
    dto: UpdateAutomationWorkflowDto,
    actorId?: string,
  ): Promise<AutomationWorkflowEntity> {
    const workflow = await this.getWorkflow(organizationId, id);

    if (dto.name) workflow.name = dto.name.trim();
    if (dto.description !== undefined) workflow.description = dto.description;
    if (dto.triggerType) workflow.triggerType = dto.triggerType;
    if (dto.goalType !== undefined) workflow.goalType = dto.goalType;
    if (dto.goalConfig !== undefined) workflow.goalConfig = dto.goalConfig;
    if (dto.maxEmailsPerDay !== undefined) workflow.maxEmailsPerDay = dto.maxEmailsPerDay;
    if (dto.maxEmailsPerWeek !== undefined) workflow.maxEmailsPerWeek = dto.maxEmailsPerWeek;
    if (dto.quietHoursEnabled !== undefined) workflow.quietHoursEnabled = dto.quietHoursEnabled;
    if (dto.quietHoursStart) workflow.quietHoursStart = dto.quietHoursStart;
    if (dto.quietHoursEnd) workflow.quietHoursEnd = dto.quietHoursEnd;
    if (dto.nodes) workflow.nodes = dto.nodes;
    if (dto.edges) workflow.edges = dto.edges;
    workflow.updatedBy = actorId;
    workflow.updatedAt = new Date();

    if (workflow.status === AutomationWorkflowStatus.ACTIVE) {
      this.validator.validateWorkflow(workflow);
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.AUTOMATION_UPDATED,
      resourceType: 'automation_workflow',
      resourceId: workflow.id,
      metadata: { name: workflow.name },
      createdAt: new Date(),
    });

    return workflow;
  }

  async publishWorkflow(organizationId: string, id: string, actorId?: string): Promise<AutomationWorkflowEntity> {
    const workflow = await this.getWorkflow(organizationId, id);

    // Validate graph structure before publishing
    this.validator.validateWorkflow(workflow);

    workflow.version += 1;
    workflow.status = AutomationWorkflowStatus.ACTIVE;
    workflow.updatedBy = actorId;
    workflow.updatedAt = new Date();

    // Snapshot version
    const versionSnapshot: AutomationWorkflowVersionEntity = {
      id: uuidv4(),
      workflowId: workflow.id,
      organizationId,
      version: workflow.version,
      definition: {
        name: workflow.name,
        triggerType: workflow.triggerType,
        goalType: workflow.goalType,
        goalConfig: workflow.goalConfig,
        nodes: workflow.nodes,
        edges: workflow.edges,
      },
      publishedBy: actorId,
      publishedAt: new Date(),
    };
    dbStore.automationWorkflowVersions.push(versionSnapshot);

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.AUTOMATION_PUBLISHED,
      resourceType: 'automation_workflow',
      resourceId: workflow.id,
      metadata: { version: workflow.version },
      createdAt: new Date(),
    });

    return workflow;
  }

  async pauseWorkflow(organizationId: string, id: string, actorId?: string): Promise<AutomationWorkflowEntity> {
    const workflow = await this.getWorkflow(organizationId, id);
    workflow.status = AutomationWorkflowStatus.PAUSED;
    workflow.updatedBy = actorId;
    workflow.updatedAt = new Date();

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.AUTOMATION_PAUSED,
      resourceType: 'automation_workflow',
      resourceId: workflow.id,
      metadata: { name: workflow.name },
      createdAt: new Date(),
    });

    return workflow;
  }

  async duplicateWorkflow(organizationId: string, id: string, actorId?: string): Promise<AutomationWorkflowEntity> {
    const source = await this.getWorkflow(organizationId, id);
    return this.createWorkflow(
      organizationId,
      {
        programId: source.programId,
        name: `${source.name} (Copy)`,
        description: source.description,
        triggerType: source.triggerType,
        status: AutomationWorkflowStatus.DRAFT,
        goalType: source.goalType,
        goalConfig: source.goalConfig,
        maxEmailsPerDay: source.maxEmailsPerDay,
        maxEmailsPerWeek: source.maxEmailsPerWeek,
        quietHoursEnabled: source.quietHoursEnabled,
        nodes: JSON.parse(JSON.stringify(source.nodes)),
        edges: JSON.parse(JSON.stringify(source.edges)),
      },
      actorId,
    );
  }

  async deleteWorkflow(organizationId: string, id: string, actorId?: string): Promise<{ success: boolean }> {
    const workflow = await this.getWorkflow(organizationId, id);
    workflow.status = AutomationWorkflowStatus.ARCHIVED;
    workflow.updatedAt = new Date();

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.AUTOMATION_ARCHIVED,
      resourceType: 'automation_workflow',
      resourceId: workflow.id,
      metadata: { name: workflow.name },
      createdAt: new Date(),
    });

    return { success: true };
  }

  getTemplates() {
    return PREBUILT_WORKFLOW_TEMPLATES;
  }

  async installTemplate(organizationId: string, dto: InstallTemplateDto, actorId?: string) {
    const template = PREBUILT_WORKFLOW_TEMPLATES.find((t) => t.id === dto.templateId);
    if (!template) throw new NotFoundException('Template not found');

    return this.createWorkflow(
      organizationId,
      {
        programId: dto.programId,
        name: dto.customName || template.name,
        description: template.description,
        triggerType: template.triggerType,
        status: AutomationWorkflowStatus.ACTIVE,
        goalType: template.goalType,
        goalConfig: template.goalConfig,
        nodes: JSON.parse(JSON.stringify(template.nodes)),
        edges: JSON.parse(JSON.stringify(template.edges)),
      },
      actorId,
    );
  }

  async getWorkflowExecutions(organizationId: string, workflowId: string) {
    const executions = dbStore.automationExecutions
      .filter((e) => e.organizationId === organizationId && e.workflowId === workflowId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return executions.map((e) => {
      const affiliate = dbStore.affiliates.find((a) => a.id === e.affiliateId);
      const scheduledSteps = dbStore.automationScheduledSteps.filter((s) => s.executionId === e.id);
      const emailLogs = dbStore.automationEmailLogs.filter((l) => l.executionId === e.id);

      return {
        ...e,
        affiliate: affiliate
          ? { id: affiliate.id, displayName: affiliate.displayName, email: affiliate.email }
          : null,
        scheduledSteps,
        emailLogs,
      };
    });
  }

  async getWorkflowAnalytics(organizationId: string, workflowId: string) {
    const workflow = await this.getWorkflow(organizationId, workflowId);
    const executions = dbStore.automationExecutions.filter((e) => e.workflowId === workflowId);
    const emailLogs = dbStore.automationEmailLogs.filter((l) => l.executionId && executions.some((e) => e.id === l.executionId));

    const totalEntered = executions.length;
    const completed = executions.filter((e) => e.status === AutomationExecutionStatus.COMPLETED).length;
    const goalReached = executions.filter((e) => e.status === AutomationExecutionStatus.GOAL_REACHED).length;
    const running = executions.filter((e) => e.status === AutomationExecutionStatus.RUNNING || e.status === AutomationExecutionStatus.WAITING).length;
    const failed = executions.filter((e) => e.status === AutomationExecutionStatus.FAILED).length;
    const cancelled = executions.filter((e) => e.status === AutomationExecutionStatus.CANCELLED).length;

    const emailsSent = emailLogs.length;
    const emailsDelivered = emailLogs.filter((l) => l.status === 'DELIVERED' || l.status === 'SENT').length;
    const emailsOpened = emailLogs.filter((l) => l.status === 'OPENED').length;
    const emailsClicked = emailLogs.filter((l) => l.status === 'CLICKED').length;

    return {
      workflow: { id: workflow.id, name: workflow.name, status: workflow.status, version: workflow.version },
      funnel: {
        totalEntered,
        completed,
        goalReached,
        running,
        failed,
        cancelled,
        goalConversionRate: totalEntered > 0 ? Math.round((goalReached / totalEntered) * 100) : 0,
        activationRateLabel: `${totalEntered > 0 ? Math.round((goalReached / totalEntered) * 100) : 0}% activated after entering workflow`,
      },
      emailEngagement: {
        sent: emailsSent,
        delivered: emailsDelivered,
        opened: emailsOpened,
        clicked: emailsClicked,
        deliveryRate: emailsSent > 0 ? Math.round((emailsDelivered / emailsSent) * 100) : 100,
      },
    };
  }
}
