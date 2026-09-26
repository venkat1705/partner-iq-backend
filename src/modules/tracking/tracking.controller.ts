import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { TrackingService } from './tracking.service';
import {
  CreateTrackingLinkDto,
  UpdateTrackingLinkDto,
  ListTrackingLinksQueryDto,
  TrackingLinkAnalyticsQueryDto,
  BulkUpdateTrackingLinksDto,
  ValidateDestinationUrlDto,
  BrowserClickDto,
  IdentifyCustomerDto,
} from './dto/tracking.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { ProgramGuard } from '../../common/guards/program.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentEnvironment } from '../../common/decorators/environment.decorator';
import { EnvironmentGuard } from '../../common/guards/environment.guard';
import { EnvironmentType } from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Tracking & Referral Link Intelligence')
@Controller()
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) { }

  // ---------------------------------------------------------------------------
  // ENTERPRISE MANAGEMENT & INTELLIGENCE ENDPOINTS (JWT AUTH)
  // ---------------------------------------------------------------------------

  @Get('api/v1/organizations/:organizationId/tracking-links/analytics')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('view.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get 360-degree tracking link analytics, trajectories, and health overview' })
  async getAnalytics(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query() query: TrackingLinkAnalyticsQueryDto,
  ) {
    return this.trackingService.getTrackingAnalytics(organizationId, environment, query);
  }

  @Get('api/v1/organizations/:organizationId/tracking-links/paginated')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('view.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List tracking links with server-side pagination, search, sorting, and filters' })
  async getLinksPaginated(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query() query: ListTrackingLinksQueryDto,
  ) {
    return this.trackingService.getLinksPaginated(organizationId, environment, query);
  }

  @Get('api/v1/organizations/:organizationId/tracking-links/export')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('view.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export filtered tracking links as sanitized CSV' })
  async exportCsv(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query() query: ListTrackingLinksQueryDto,
    @Res() res: Response,
  ) {
    const csvContent = await this.trackingService.generateCsvExport(organizationId, environment, query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="tracking_links_${Date.now()}.csv"`);
    return res.status(200).send(csvContent);
  }

  @Get('api/v1/organizations/:organizationId/tracking-links/:id/detail')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('view.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get 360 dossier for a tracking link including UTMs, click telemetry, and audit' })
  async getLinkDetail(
    @Param('organizationId') organizationId: string,
    @Param('id') linkId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.trackingService.getLinkDetail(organizationId, linkId, environment);
  }

  @Post('api/v1/organizations/:organizationId/tracking-links')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, ProgramGuard, PermissionsGuard)
  @RequirePermissions('manage.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new tracking link with validation and collision-safe short code' })
  async createLink(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateTrackingLinkDto,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.trackingService.createLink(organizationId, dto, user.userId, environment);
  }

  @Patch('api/v1/organizations/:organizationId/tracking-links/:id')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('manage.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update tracking link destination URL, status, or campaign parameters' })
  async updateLink(
    @Param('organizationId') organizationId: string,
    @Param('id') linkId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
    @Body() dto: UpdateTrackingLinkDto,
  ) {
    return this.trackingService.updateLink(organizationId, linkId, user.userId || 'admin', dto, environment);
  }

  @Post('api/v1/organizations/:organizationId/tracking-links/bulk')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('manage.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk update tracking links (activate, deactivate, archive)' })
  async bulkUpdate(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
    @Body() dto: BulkUpdateTrackingLinksDto,
  ) {
    return this.trackingService.bulkUpdateLinks(organizationId, user.userId || 'admin', dto, environment);
  }

  @Post('api/v1/organizations/:organizationId/tracking-links/validate-destination')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate destination URL security and open redirect safety' })
  async validateDestination(@Body() dto: ValidateDestinationUrlDto) {
    return this.trackingService.validateDestinationUrl(dto.url);
  }

  @Get('api/v1/organizations/:organizationId/tracking-links')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, ProgramGuard, PermissionsGuard)
  @RequirePermissions('view.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List tracking links for organization or filtered by program (Legacy)' })
  async getLinks(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query('programId') programId?: string,
  ) {
    return this.trackingService.getLinks(organizationId, environment, programId);
  }

  // ---------------------------------------------------------------------------
  // PUBLIC HIGH-PERFORMANCE REDIRECT & SDK ENDPOINTS
  // ---------------------------------------------------------------------------

  @Get('r/:shortCode')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'High-performance referral tracking redirect' })
  async redirect(
    @Param('shortCode') shortCode: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = this.getClientIp(req);
    const referrer = req.headers.referer || req.headers.referrer as string;
    const country = req.headers['cf-ipcountry'] as string || req.headers['x-country'] as string;
    const query = req.query as Record<string, string | undefined>;

    const result = await this.trackingService.handleRedirect(shortCode, userAgent, ipAddress, referrer, country, {
      landingUrl: this.buildLandingUrl(req),
      utmSource: query.utm_source,
      utmMedium: query.utm_medium,
      utmCampaign: query.utm_campaign,
      utmTerm: query.utm_term,
      utmContent: query.utm_content,
      affiliateId: query.aff || query.affiliateId || query.affiliate || query.ref,
      host: req.headers.host,
      existingAnonymousId: req.cookies?.pi_anon_id,
      passthroughParams: this.collectPassthroughParams(query),
      deepLinkTarget: query.url,
    });

    if (result.tracked && result.anonymousId && result.clickId) {
      this.setAttributionCookies(res, req, result.anonymousId, result.clickId, result.cookieMaxAgeMs);
    }

    return res.redirect(302, result.destinationUrl);
  }

  @Post('api/v1/tracking/click')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Browser SDK click tracking endpoint' })
  async browserClick(@Body() dto: BrowserClickDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = this.getClientIp(req);
    return this.trackingService.handleBrowserClick(dto, userAgent, ipAddress);
  }

  @Post('api/v1/tracking/identify')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Identify customer association with anonymous click' })
  async identifyCustomer(@Body() dto: IdentifyCustomerDto) {
    return this.trackingService.identifyCustomer(dto);
  }

  /**
   * Query parameters this redirect consumes itself and therefore never forwards:
   * the UTM set is re-applied from the recorded click, the affiliate aliases are
   * used to resolve the partner, and the `pi_` identifiers are minted server-side
   * — echoing an inbound copy of those would let a visitor spoof attribution.
   */
  private static readonly RESERVED_REDIRECT_PARAMS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'aff', 'affiliateid', 'affiliate', 'ref',
    'pi_click_id', 'pi_anon_id',
    'url',
  ]);

  private static readonly PASSTHROUGH_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
  private static readonly MAX_PASSTHROUGH_PARAMS = 15;
  private static readonly MAX_PASSTHROUGH_VALUE_LENGTH = 512;

  /**
   * Everything else an affiliate tacked onto the short link — `sub_id`,
   * placement tags, campaign slugs — is carried through to the destination so
   * the merchant's own analytics sees it. Bounded in count, key shape and value
   * length, since this is attacker-controlled input being written into a URL we
   * hand to a third-party site.
   */
  private collectPassthroughParams(query: Record<string, string | undefined>) {
    const passthrough: Record<string, string> = {};

    for (const [key, value] of Object.entries(query || {})) {
      if (Object.keys(passthrough).length >= TrackingController.MAX_PASSTHROUGH_PARAMS) break;
      if (typeof value !== 'string' || !value) continue;
      if (TrackingController.RESERVED_REDIRECT_PARAMS.has(key.toLowerCase())) continue;
      if (!TrackingController.PASSTHROUGH_KEY_PATTERN.test(key)) continue;

      passthrough[key] = value.slice(0, TrackingController.MAX_PASSTHROUGH_VALUE_LENGTH);
    }

    return passthrough;
  }

  private getClientIp(req: Request) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (Array.isArray(forwardedFor)) return forwardedFor[0];
    return forwardedFor || req.ip;
  }

  private buildLandingUrl(req: Request): string | undefined {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = req.headers.host || '';
    return `${proto}://${host}${req.originalUrl}`.slice(0, 2000);
  }

  private setAttributionCookies(
    res: Response,
    req: Request,
    anonymousId: string,
    clickId: string,
    maxAgeMs: number,
  ) {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

    // `SameSite=Lax` is not sent on cross-site XHR/fetch, so a merchant site
    // calling this API from its own origin never saw these cookies. `None` lifts
    // that restriction but every browser requires `Secure` alongside it — and
    // rejects the cookie outright without it — so plain-HTTP local development
    // has to stay on `Lax`.
    const crossSite = isHttps ? { sameSite: 'none' as const, secure: true } : { sameSite: 'lax' as const, secure: false };

    const options = {
      maxAge: maxAgeMs,
      httpOnly: false, // the browser SDK reads these via getAttribution()
      path: '/',
      ...crossSite,
    };

    res.cookie('pi_anon_id', anonymousId, options);
    // Documented as the primary, durable attribution identifier, but never
    // actually set until now — getAttribution().clickId always read undefined.
    res.cookie('pi_click_id', clickId, options);
  }
}
