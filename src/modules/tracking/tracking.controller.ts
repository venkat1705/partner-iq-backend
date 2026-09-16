import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { TrackingService } from './tracking.service';
import { CreateTrackingLinkDto, BrowserClickDto, IdentifyCustomerDto } from './dto/tracking.dto';
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

@ApiTags('Tracking & Redirects')
@Controller()
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) { }

  @Post('api/v1/organizations/:organizationId/tracking-links')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, ProgramGuard, PermissionsGuard)
  @RequirePermissions('manage.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new tracking link for an affiliate' })
  async createLink(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateTrackingLinkDto,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.trackingService.createLink(organizationId, dto, user.userId, environment);
  }

  @Get('api/v1/organizations/:organizationId/tracking-links')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, ProgramGuard, PermissionsGuard)
  @RequirePermissions('manage.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List tracking links for organization or filtered by program' })
  async getLinks(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query('programId') programId?: string,
  ) {
    return this.trackingService.getLinks(organizationId, environment, programId);
  }

  @Get('r/:shortCode')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
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
    });

    if (result.tracked && result.anonymousId) {
      this.setAttributionCookie(res, req, result.anonymousId, result.cookieMaxAgeMs);
    }

    return res.redirect(302, result.destinationUrl);
  }

  @Post('api/v1/tracking/click')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Browser SDK click tracking endpoint' })
  async browserClick(@Body() dto: BrowserClickDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = this.getClientIp(req);
    return this.trackingService.handleBrowserClick(dto, userAgent, ipAddress);
  }

  @Post('api/v1/tracking/identify')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Identify customer association with anonymous click' })
  async identifyCustomer(@Body() dto: IdentifyCustomerDto) {
    return this.trackingService.identifyCustomer(dto);
  }

  private getClientIp(req: Request) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (Array.isArray(forwardedFor)) return forwardedFor[0];
    return forwardedFor || req.ip;
  }

  private buildLandingUrl(req: Request): string | undefined {
    // The redirect endpoint has no visibility into the page the customer ultimately lands on;
    // the incoming short-link URL (with its UTM query string) is the closest server-observable
    // proxy for "landing context" at click time.
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = req.headers.host || '';
    return `${proto}://${host}${req.originalUrl}`.slice(0, 2000);
  }

  /**
   * pi_anon_id is a correlation id for an anonymous click, not a session/auth token - but it is
   * still first-party attribution state, so it gets the same hardening as any tracking cookie:
   * Secure (over HTTPS), SameSite=Lax, and a maxAge that matches the program's actual
   * cookieDurationDays/attributionWindowDays instead of a hardcoded value.
   */
  private setAttributionCookie(res: Response, req: Request, anonymousId: string, maxAgeMs: number) {
    res.cookie('pi_anon_id', anonymousId, {
      maxAge: maxAgeMs,
      httpOnly: false,
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      sameSite: 'lax',
      path: '/',
    });
  }
}
