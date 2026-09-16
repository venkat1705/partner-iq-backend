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
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { PermissionsGuard as RbacGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions as RequirePermission } from '../../../common/decorators/require-permissions.decorator';

@Controller(['api/v1/organizations/:organizationId/automations', 'organizations/:organizationId/automations'])
@UseGuards(AuthGuard, OrganizationGuard, RbacGuard)
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get()
  @RequirePermission('automations.view')
  async getWorkflows(@Param('organizationId') orgId: string, @Query('programId') programId?: string) {
    return this.workflowService.getWorkflows(orgId, programId);
  }

  @Post()
  @RequirePermission('automations.create')
  async createWorkflow(@Req() req: any, @Param('organizationId') orgId: string, @Body() dto: CreateAutomationWorkflowDto) {
    return this.workflowService.createWorkflow(orgId, dto, req.user.id);
  }

  @Get('templates')
  @RequirePermission('automations.view')
  async getTemplates() {
    return this.workflowService.getTemplates();
  }

  @Post('templates/install')
  @RequirePermission('automations.create')
  async installTemplate(@Req() req: any, @Param('organizationId') orgId: string, @Body() dto: InstallTemplateDto) {
    return this.workflowService.installTemplate(orgId, dto, req.user.id);
  }

  @Get(':id')
  @RequirePermission('automations.view')
  async getWorkflow(@Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.workflowService.getWorkflow(orgId, id);
  }

  @Patch(':id')
  @RequirePermission('automations.edit')
  async updateWorkflow(
    @Req() req: any,
    @Param('organizationId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAutomationWorkflowDto,
  ) {
    return this.workflowService.updateWorkflow(orgId, id, dto, req.user.id);
  }

  @Post(':id/publish')
  @RequirePermission('automations.publish')
  async publishWorkflow(@Req() req: any, @Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.workflowService.publishWorkflow(orgId, id, req.user.id);
  }

  @Post(':id/pause')
  @RequirePermission('automations.pause')
  async pauseWorkflow(@Req() req: any, @Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.workflowService.pauseWorkflow(orgId, id, req.user.id);
  }

  @Post(':id/duplicate')
  @RequirePermission('automations.create')
  async duplicateWorkflow(@Req() req: any, @Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.workflowService.duplicateWorkflow(orgId, id, req.user.id);
  }

  @Delete(':id')
  @RequirePermission('automations.delete')
  async deleteWorkflow(@Req() req: any, @Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.workflowService.deleteWorkflow(orgId, id, req.user.id);
  }

  @Get(':id/executions')
  @RequirePermission('automations.view')
  async getExecutions(@Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.workflowService.getWorkflowExecutions(orgId, id);
  }

  @Get(':id/analytics')
  @RequirePermission('automations.view')
  async getAnalytics(@Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.workflowService.getWorkflowAnalytics(orgId, id);
  }
}
