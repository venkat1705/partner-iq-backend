import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { TrackingService } from './tracking.service';
import { CreateTrackingLinkDto, BrowserClickDto, IdentifyCustomerDto } from './dto/tracking.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
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
  constructor(private readonly trackingService: TrackingService) {}

  @Post('api/v1/organizations/:organizationId/tracking-links')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
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
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('manage.links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List tracking links for organization' })
  async getLinks(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.trackingService.getLinks(organizationId, environment);
  }

  @Get('r/:shortCode')
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

    const result = await this.trackingService.handleRedirect(shortCode, userAgent, ipAddress, referrer, country);

    // Set first-party tracking cookie
    res.cookie('pi_anon_id', result.anonymousId, {
      maxAge: 30 * 24 * 3600 * 1000,
      httpOnly: false,
    });

    return res.redirect(302, result.destinationUrl);
  }

  @Post('api/v1/tracking/click')
  @ApiOperation({ summary: 'Browser SDK click tracking endpoint' })
  async browserClick(@Body() dto: BrowserClickDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = this.getClientIp(req);
    return this.trackingService.handleBrowserClick(dto, userAgent, ipAddress);
  }

  @Post('api/v1/tracking/identify')
  @ApiOperation({ summary: 'Identify customer association with anonymous click' })
  async identifyCustomer(@Body() dto: IdentifyCustomerDto) {
    return this.trackingService.identifyCustomer(dto);
  }

  private getClientIp(req: Request) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (Array.isArray(forwardedFor)) return forwardedFor[0];
    return forwardedFor || req.ip;
  }
}
