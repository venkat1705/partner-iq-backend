import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationSettingsService } from './organization-settings.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import {
  ExportDataDto,
  DeactivateOrgDto,
  DeleteOrgDto,
} from './dto/organization-settings.dto';

@ApiTags('Organization Settings & Control Center')
@Controller('api/v1/organizations/:organizationId/settings')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class OrganizationSettingsController {
  constructor(private readonly settingsService: OrganizationSettingsService) { }

  @Get()
  @RequirePermissions('manage.organization')
  @ApiOperation({ summary: 'Get consolidated organization settings, branding, and completeness score' })
  async getSettings(@Param('organizationId') organizationId: string) {
    return this.settingsService.getSettings(organizationId);
  }

  @Patch(':section')
  @RequirePermissions('manage.organization')
  @ApiOperation({ summary: 'Update a specific settings section (e.g. general, profile, localization, tracking, commissions, payouts, email, documents, domains, developer, security, privacy)' })
  async updateSection(
    @Param('organizationId') organizationId: string,
    @Param('section') section: string,
    @Body() dto: Record<string, any>,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.settingsService.updateSection(organizationId, section, dto, user.userId);
  }

  @Post('danger/export')
  @RequirePermissions('manage.organization')
  @ApiOperation({ summary: 'Request organization data archive export' })
  async exportData(
    @Param('organizationId') organizationId: string,
    @Body() dto: ExportDataDto,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.settingsService.exportData(organizationId, user.userId, dto);
  }

  @Post('danger/deactivate')
  @RequirePermissions('manage.organization')
  @ApiOperation({ summary: 'Temporarily deactivate organization affiliate tracking' })
  async deactivateOrganization(
    @Param('organizationId') organizationId: string,
    @Body() dto: DeactivateOrgDto,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.settingsService.deactivateOrganization(organizationId, user.userId, dto);
  }

  @Delete('danger/delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.organization')
  @ApiOperation({ summary: 'Soft-delete organization with mandatory slug confirmation' })
  async deleteOrganization(
    @Param('organizationId') organizationId: string,
    @Body() dto: DeleteOrgDto,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.settingsService.deleteOrganization(organizationId, user.userId, dto);
  }
}

