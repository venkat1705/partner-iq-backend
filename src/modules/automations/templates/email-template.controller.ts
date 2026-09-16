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
} from '@nestjs/common';
import { EmailTemplateService } from './email-template.service';
import {
  CreateEmailTemplateDto,
  UpdateEmailTemplateDto,
  PreviewEmailTemplateDto,
  TestEmailTemplateDto,
} from '../dto/email-template.dto';
import { JwtAuthGuard as AuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { PermissionsGuard as RbacGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions as RequirePermission } from '../../../common/decorators/require-permissions.decorator';

@Controller(['api/v1/organizations/:organizationId/automations/email-templates', 'organizations/:organizationId/automations/email-templates'])
@UseGuards(AuthGuard, OrganizationGuard, RbacGuard)
export class EmailTemplateController {
  constructor(private readonly emailTemplateService: EmailTemplateService) {}

  @Get()
  @RequirePermission('automations.view')
  async getTemplates(@Param('organizationId') orgId: string, @Query('programId') programId?: string) {
    return this.emailTemplateService.getTemplates(orgId, programId);
  }

  @Post()
  @RequirePermission('automations.create')
  async createTemplate(@Param('organizationId') orgId: string, @Body() dto: CreateEmailTemplateDto) {
    return this.emailTemplateService.createTemplate(orgId, dto);
  }

  @Get(':id')
  @RequirePermission('automations.view')
  async getTemplate(@Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.emailTemplateService.getTemplate(orgId, id);
  }

  @Patch(':id')
  @RequirePermission('automations.edit')
  async updateTemplate(
    @Param('organizationId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmailTemplateDto,
  ) {
    return this.emailTemplateService.updateTemplate(orgId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('automations.delete')
  async deleteTemplate(@Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.emailTemplateService.deleteTemplate(orgId, id);
  }

  @Post('preview')
  @RequirePermission('automations.view')
  async previewTemplate(@Body() dto: PreviewEmailTemplateDto) {
    return this.emailTemplateService.previewTemplate(dto);
  }

  @Post('test')
  @RequirePermission('automations.edit')
  async sendTestEmail(@Param('organizationId') orgId: string, @Body() dto: TestEmailTemplateDto) {
    return this.emailTemplateService.sendTestEmail(orgId, dto);
  }
}
