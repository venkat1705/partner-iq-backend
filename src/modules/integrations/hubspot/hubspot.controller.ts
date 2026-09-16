import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { getAppConfig } from '../../../config/app.config';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import { HubSpotService } from './hubspot.service';
import {
  UpdateHubSpotFieldMappingsDto,
  UpdateHubSpotPipelineMappingDto,
  UpsertHubSpotPlatformConfigDto,
} from './dto/hubspot.dto';

@ApiTags('HubSpot Integration')
@Controller('api/v1')
export class HubSpotController {
  constructor(private readonly hubSpot: HubSpotService) {}

  @Get('admin/integrations/hubspot/config')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getPlatformConfig(@CurrentUser() user: AuthUserPayload) {
    return this.hubSpot.getPlatformConfig(user);
  }

  @Patch('admin/integrations/hubspot/config')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  upsertPlatformConfig(@CurrentUser() user: AuthUserPayload, @Body() dto: UpsertHubSpotPlatformConfigDto) {
    return this.hubSpot.upsertPlatformConfig(user, dto);
  }

  @Post('admin/integrations/hubspot/test')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  testPlatformConfig(@CurrentUser() user: AuthUserPayload) {
    return this.hubSpot.testPlatformConfig(user);
  }

  @Get('organizations/:organizationId/integrations')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.view')
  @ApiBearerAuth()
  listOrganizationIntegrations(@Param('organizationId') organizationId: string) {
    return this.hubSpot.listOrganizationIntegrations(organizationId);
  }

  @Get('organizations/:organizationId/integrations/hubspot')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.view')
  @ApiBearerAuth()
  getOrganizationHubSpot(@Param('organizationId') organizationId: string) {
    return this.hubSpot.getOrganizationHubSpot(organizationId);
  }

  @Post('organizations/:organizationId/integrations/hubspot/connect')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.connect')
  @ApiBearerAuth()
  connect(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body('redirectUrl') redirectUrl?: string,
  ) {
    return this.hubSpot.connectUrl(organizationId, user, redirectUrl);
  }

  @Get('integrations/hubspot/oauth/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const callbackUrl = this.frontendCallbackUrl();
    if (error) {
      callbackUrl.searchParams.set('status', 'error');
      callbackUrl.searchParams.set('message', errorDescription || error);
      return res.redirect(callbackUrl.toString());
    }

    try {
      const result = await this.hubSpot.oauthCallback(code, state);
      callbackUrl.searchParams.set('status', 'success');
      callbackUrl.searchParams.set('organizationId', result.connection.organizationId || '');
      callbackUrl.searchParams.set('account', result.connection.externalAccountName || 'HubSpot CRM');
      if (result.redirectUrl) callbackUrl.searchParams.set('returnTo', result.redirectUrl);
    } catch (err: any) {
      callbackUrl.searchParams.set('status', 'error');
      callbackUrl.searchParams.set('message', err?.message || 'HubSpot connection failed');
    }

    return res.redirect(callbackUrl.toString());
  }

  private frontendCallbackUrl() {
    return new URL('/app/integrations/hubspot/callback', getAppConfig().frontendUrl);
  }

  @Post('organizations/:organizationId/integrations/hubspot/test')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.test')
  @ApiBearerAuth()
  testConnection(@Param('organizationId') organizationId: string) {
    return this.hubSpot.testConnection(organizationId);
  }

  @Post('organizations/:organizationId/integrations/hubspot/sync')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.sync')
  @ApiBearerAuth()
  sync(@Param('organizationId') organizationId: string) {
    return this.hubSpot.testConnection(organizationId);
  }

  @Post('organizations/:organizationId/integrations/hubspot/disconnect')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.disconnect')
  @ApiBearerAuth()
  disconnect(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload) {
    return this.hubSpot.disconnect(organizationId, user);
  }

  @Get('organizations/:organizationId/integrations/hubspot/pipelines')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.configure')
  @ApiBearerAuth()
  pipelines(@Param('organizationId') organizationId: string) {
    return this.hubSpot.getPipelines(organizationId);
  }

  @Get('organizations/:organizationId/integrations/hubspot/pipelines/:pipelineId/stages')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.configure')
  @ApiBearerAuth()
  stages(@Param('organizationId') organizationId: string, @Param('pipelineId') pipelineId: string) {
    return this.hubSpot.getPipelineStages(organizationId, pipelineId);
  }

  @Get('organizations/:organizationId/integrations/hubspot/pipeline-mapping')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.view')
  @ApiBearerAuth()
  getPipelineMapping(@Param('organizationId') organizationId: string, @Query('pipelineId') pipelineId?: string) {
    return this.hubSpot.getPipelineMapping(organizationId, pipelineId);
  }

  @Patch('organizations/:organizationId/integrations/hubspot/pipeline-mapping')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.configure')
  @ApiBearerAuth()
  updatePipelineMapping(@Param('organizationId') organizationId: string, @Body() dto: UpdateHubSpotPipelineMappingDto) {
    return this.hubSpot.updatePipelineMapping(organizationId, dto);
  }

  @Get('organizations/:organizationId/integrations/hubspot/field-mappings')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.configure')
  @ApiBearerAuth()
  fieldMappings(@Param('organizationId') organizationId: string) {
    return this.hubSpot.getFieldMappings(organizationId);
  }

  @Patch('organizations/:organizationId/integrations/hubspot/field-mappings')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.configure')
  @ApiBearerAuth()
  updateFieldMappings(@Param('organizationId') organizationId: string, @Body() dto: UpdateHubSpotFieldMappingsDto) {
    return this.hubSpot.updateFieldMappings(organizationId, dto);
  }

  @Get('organizations/:organizationId/integrations/hubspot/sync-logs')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('integrations.view')
  @ApiBearerAuth()
  syncLogs(@Param('organizationId') organizationId: string) {
    return this.hubSpot.syncLogs(organizationId);
  }
}
