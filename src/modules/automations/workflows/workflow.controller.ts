import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import {
  CreateAutomationWorkflowDto,
  UpdateAutomationWorkflowDto,
  InstallTemplateDto,
} from '../dto/workflow.dto';
import { JwtAuthGuard as AuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard as RbacGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions as RequirePermission } from '../../../common/decorators/require-permissions.decorator';

@Controller(['api/v1/automations', 'automations'])
@UseGuards(AuthGuard, RbacGuard)
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get()
  @RequirePermission('automations.view')
  async getWorkflows(@Req() req: any, @Query('programId') programId?: string) {
    const orgId = req.user.organizationId;
    return this.workflowService.getWorkflows(orgId, programId);
  }

  @Post()
  @RequirePermission('automations.create')
  async createWorkflow(@Req() req: any, @Body() dto: CreateAutomationWorkflowDto) {
    const orgId = req.user.organizationId;
    return this.workflowService.createWorkflow(orgId, dto, req.user.id);
  }

  @Get('templates')
  @RequirePermission('automations.view')
  async getTemplates() {
    return this.workflowService.getTemplates();
  }

  @Post('templates/install')
  @RequirePermission('automations.create')
  async installTemplate(@Req() req: any, @Body() dto: InstallTemplateDto) {
    const orgId = req.user.organizationId;
    return this.workflowService.installTemplate(orgId, dto, req.user.id);
  }

  @Get(':id')
  @RequirePermission('automations.view')
  async getWorkflow(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.workflowService.getWorkflow(orgId, id);
  }

  @Patch(':id')
  @RequirePermission('automations.edit')
  async updateWorkflow(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateAutomationWorkflowDto,
  ) {
    const orgId = req.user.organizationId;
    return this.workflowService.updateWorkflow(orgId, id, dto, req.user.id);
  }

  @Post(':id/publish')
  @RequirePermission('automations.publish')
  async publishWorkflow(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.workflowService.publishWorkflow(orgId, id, req.user.id);
  }

  @Post(':id/pause')
  @RequirePermission('automations.pause')
  async pauseWorkflow(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.workflowService.pauseWorkflow(orgId, id, req.user.id);
  }

  @Post(':id/duplicate')
  @RequirePermission('automations.create')
  async duplicateWorkflow(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.workflowService.duplicateWorkflow(orgId, id, req.user.id);
  }

  @Delete(':id')
  @RequirePermission('automations.delete')
  async deleteWorkflow(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.workflowService.deleteWorkflow(orgId, id, req.user.id);
  }

  @Get(':id/executions')
  @RequirePermission('automations.view')
  async getExecutions(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.workflowService.getWorkflowExecutions(orgId, id);
  }

  @Get(':id/analytics')
  @RequirePermission('automations.view')
  async getAnalytics(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.workflowService.getWorkflowAnalytics(orgId, id);
  }
}
