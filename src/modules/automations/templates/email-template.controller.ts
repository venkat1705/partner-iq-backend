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
import { EmailTemplateService } from './email-template.service';
import {
  CreateEmailTemplateDto,
  UpdateEmailTemplateDto,
  PreviewEmailTemplateDto,
  TestEmailTemplateDto,
} from '../dto/email-template.dto';
import { JwtAuthGuard as AuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard as RbacGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions as RequirePermission } from '../../../common/decorators/require-permissions.decorator';

@Controller(['api/v1/automations/email-templates', 'automations/email-templates'])
@UseGuards(AuthGuard, RbacGuard)
export class EmailTemplateController {
  constructor(private readonly emailTemplateService: EmailTemplateService) {}

  @Get()
  @RequirePermission('automations.view')
  async getTemplates(@Req() req: any, @Query('programId') programId?: string) {
    const orgId = req.user.organizationId;
    return this.emailTemplateService.getTemplates(orgId, programId);
  }

  @Post()
  @RequirePermission('automations.create')
  async createTemplate(@Req() req: any, @Body() dto: CreateEmailTemplateDto) {
    const orgId = req.user.organizationId;
    return this.emailTemplateService.createTemplate(orgId, dto);
  }

  @Get(':id')
  @RequirePermission('automations.view')
  async getTemplate(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.emailTemplateService.getTemplate(orgId, id);
  }

  @Patch(':id')
  @RequirePermission('automations.edit')
  async updateTemplate(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateEmailTemplateDto,
  ) {
    const orgId = req.user.organizationId;
    return this.emailTemplateService.updateTemplate(orgId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('automations.delete')
  async deleteTemplate(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.emailTemplateService.deleteTemplate(orgId, id);
  }

  @Post('preview')
  @RequirePermission('automations.view')
  async previewTemplate(@Body() dto: PreviewEmailTemplateDto) {
    return this.emailTemplateService.previewTemplate(dto);
  }

  @Post('test')
  @RequirePermission('automations.edit')
  async sendTestEmail(@Req() req: any, @Body() dto: TestEmailTemplateDto) {
    const orgId = req.user.organizationId;
    return this.emailTemplateService.sendTestEmail(orgId, dto);
  }
}
