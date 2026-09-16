import { Body, Controller, Delete, Get, Headers, Logger, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { IntegrationStatus } from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { IntegrationsService } from './integrations.service';
import { ConnectIntegrationDto, TestIntegrationDto } from './dto/connect-integration.dto';

@ApiTags('Integrations')
@Controller('api/v1')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) { }

  // ─────────────────────────────────────────────────────────
  // Admin Endpoints
  // ─────────────────────────────────────────────────────────

  @Get('admin/integrations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List platform integrations with DB connection counts and health' })
  listAdmin(@CurrentUser() user: AuthUserPayload) {
    return this.integrationsService.listAdminIntegrations(user);
  }

  @Get('admin/integrations/metrics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get aggregate metrics for all integrations' })
  metrics(@CurrentUser() user: AuthUserPayload) {
    return this.integrationsService.getMetrics(user);
  }

  @Get('admin/integrations/health')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get platform-wide integration health rollup' })
  adminHealth(@CurrentUser() user: AuthUserPayload) {
    return this.integrationsService.getAdminHealth(user);
  }

  @Get('admin/integrations/:slugOrId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get admin integration details with connected organizations' })
  adminDetail(@CurrentUser() user: AuthUserPayload, @Param('slugOrId') slugOrId: string) {
    return this.integrationsService.getAdminIntegration(user, slugOrId);
  }

  @Patch('admin/integrations/:slugOrId/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update integration status (ACTIVE, INACTIVE, COMING_SOON)' })
  updateStatus(
    @CurrentUser() user: AuthUserPayload,
    @Param('slugOrId') slugOrId: string,
    @Body('status') status: IntegrationStatus,
  ) {
    return this.integrationsService.updateStatus(user, slugOrId, status);
  }

  @Get('admin/integrations/:slugOrId/config')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get integration platform OAuth & API configuration' })
  getAdminConfig(@CurrentUser() user: AuthUserPayload, @Param('slugOrId') slugOrId: string) {
    return this.integrationsService.getAdminPlatformConfig(user, slugOrId);
  }

  @Patch('admin/integrations/:slugOrId/config')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save integration platform OAuth & API configuration' })
  saveAdminConfig(
    @CurrentUser() user: AuthUserPayload,
    @Param('slugOrId') slugOrId: string,
    @Body() dto: any,
  ) {
    return this.integrationsService.upsertAdminPlatformConfig(user, slugOrId, dto);
  }

  @Post('admin/integrations/:slugOrId/test')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Test integration platform OAuth app credentials' })
  testAdminConfig(@CurrentUser() user: AuthUserPayload, @Param('slugOrId') slugOrId: string) {
    return this.integrationsService.testAdminPlatformConfig(user, slugOrId);
  }

  // ─────────────────────────────────────────────────────────
  // Organization Endpoints
  // ─────────────────────────────────────────────────────────

  @Get('organizations/:organizationId/integrations')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('view.integrations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List published integration marketplace with real connection state' })
  listForOrganization(@Param('organizationId') organizationId: string) {
    return this.integrationsService.listForOrganization(organizationId);
  }

  @Get('organizations/:organizationId/integrations/:slugOrId')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('view.integrations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get integration details and organization connection state' })
  getForOrganization(
    @Param('organizationId') organizationId: string,
    @Param('slugOrId') slugOrId: string,
  ) {
    return this.integrationsService.getForOrganization(organizationId, slugOrId);
  }

  @Post('organizations/:organizationId/integrations/:slugOrId/connect')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.integrations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Connect an integration with credentials (validates before saving)' })
  connectIntegration(
    @Param('organizationId') organizationId: string,
    @Param('slugOrId') slugOrId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ConnectIntegrationDto,
  ) {
    return this.integrationsService.connectIntegration(organizationId, user.userId, slugOrId, dto);
  }

  @Post('organizations/:organizationId/integrations/:slugOrId/oauth/connect')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.integrations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate OAuth connection flow for an organization' })
  connectOAuth(
    @Param('organizationId') organizationId: string,
    @Param('slugOrId') slugOrId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body('redirectUrl') redirectUrl?: string,
    @Body('merchantId') merchantId?: string,
  ) {
    return this.integrationsService.connectOAuth(organizationId, user, slugOrId, redirectUrl, merchantId);
  }

  @Post('organizations/:organizationId/integrations/:slugOrId/test')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.integrations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Test credentials (either new or existing stored connection)' })
  testIntegration(
    @Param('organizationId') organizationId: string,
    @Param('slugOrId') slugOrId: string,
    @Body() dto: TestIntegrationDto,
  ) {
    return this.integrationsService.testConnection(organizationId, slugOrId, dto);
  }

  @Post('organizations/:organizationId/integrations/:slugOrId/disconnect')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.integrations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect an integration for this organization' })
  disconnectIntegrationPost(
    @Param('organizationId') organizationId: string,
    @Param('slugOrId') slugOrId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.integrationsService.disconnectIntegration(organizationId, user.userId, slugOrId);
  }

  @Delete('organizations/:organizationId/integrations/:slugOrId')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.integrations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect an integration for this organization (DELETE)' })
  disconnectIntegrationDelete(
    @Param('organizationId') organizationId: string,
    @Param('slugOrId') slugOrId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.integrationsService.disconnectIntegration(organizationId, user.userId, slugOrId);
  }

  // ─────────────────────────────────────────────────────────
  // OAuth Callbacks
  // Registered as exact literal paths (not a `:slug` wildcard) so they can
  // never shadow or be shadowed by another provider's dedicated callback
  // route (e.g. HubSpotController's own `integrations/hubspot/oauth/callback`).
  // ─────────────────────────────────────────────────────────

  private readonly logger = new Logger(IntegrationsController.name);

  @Get('integrations/razorpay/oauth/callback')
  @ApiOperation({ summary: 'Razorpay Partner OAuth redirect target' })
  async razorpayOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const query = (req?.query || {}) as Record<string, string | undefined>;
    this.logger.log(`[Razorpay OAuth Callback] Received redirect with query: ${JSON.stringify(query)}`);
    console.log('[Razorpay OAuth Callback] Raw query params:', query);

    const actualError = error || query.error_description || (query.status === 'error' ? query.message : undefined);
    const actualDesc = errorDescription || query.message || actualError;

    const redirectTo = await this.integrationsService.oauthCallback('razorpay', code, state, actualError, actualDesc);
    this.logger.log(`[Razorpay OAuth Callback] Redirecting browser to: ${redirectTo}`);
    return res.redirect(redirectTo);
  }

  @Get('integrations/cashfree/oauth/callback')
  @ApiOperation({ summary: 'Cashfree Partner OAuth redirect target' })
  async cashfreeOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Query('merchant_id') merchantId: string,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const query = (req?.query || {}) as Record<string, string | undefined>;
    this.logger.log(`[Cashfree OAuth Callback] Received redirect from Cashfree with query params: ${JSON.stringify(query)}`);
    console.log('[Cashfree OAuth Callback] Raw query params from Cashfree:', query);

    const actualCode = code || query.code;
    const actualState = state || query.state;
    const actualError = error || (query.status === 'error' || query.status === 'FAILED' ? (query.message || query.status) : undefined);
    const actualDesc = errorDescription || query.message || actualError;
    const actualMerchantId = merchantId || query.merchant_id || (query as any).merchantId;

    if (actualError) {
      this.logger.warn(`[Cashfree OAuth Callback] Cashfree returned error directly in callback: ${actualError} (${actualDesc})`);
      console.warn('[Cashfree OAuth Callback] Cashfree error in query:', { error: actualError, description: actualDesc });
    }

    const redirectTo = await this.integrationsService.oauthCallback('cashfree', actualCode, actualState, actualError, actualDesc, actualMerchantId);
    this.logger.log(`[Cashfree OAuth Callback] Redirecting browser to: ${redirectTo}`);
    console.log(`[Cashfree OAuth Callback] Redirecting browser to: ${redirectTo}`);
    return res.redirect(redirectTo);
  }

  @Get('integrations/zoho-crm/oauth/callback')
  @ApiOperation({ summary: 'Zoho CRM OAuth redirect target' })
  async zohoCrmOAuthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const redirectTo = await this.integrationsService.oauthCallback('zoho-crm', code, state, error, errorDescription);
    return res.redirect(redirectTo);
  }

  // ─────────────────────────────────────────────────────────
  // Webhooks
  // ─────────────────────────────────────────────────────────

  @Post('integrations/:provider/webhooks/:publicConnectionId')
  receiveWebhook(
    @Param('provider') provider: string,
    @Param('publicConnectionId') publicConnectionId: string,
    @Body() body: any,
    @Headers() headers: Record<string, any>,
  ) {
    return this.integrationsService.receiveWebhook(provider, publicConnectionId, body, headers);
  }
}
