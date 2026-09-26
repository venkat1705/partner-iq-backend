import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { getAppConfig } from '../../config/app.config';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';

@ApiTags('Demo Bookings — Google Calendar Connection')
@Controller('api/v1')
export class GoogleCalendarOAuthController {
  constructor(private readonly oauthService: GoogleCalendarOAuthService) { }

  @Get('admin/demo-bookings/google-calendar/status')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current Google Calendar connection status' })
  async status() {
    return this.oauthService.getStatus();
  }

  @Get('admin/demo-bookings/google-calendar/authorize')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Build the Google OAuth consent URL to connect a calendar' })
  async authorize(@CurrentUser() user: AuthUserPayload) {
    const authorizationUrl = this.oauthService.buildAuthorizationUrl(user.userId, user.email);
    return { authorizationUrl };
  }

  @Post('admin/demo-bookings/google-calendar/disconnect')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect the Google Calendar connection' })
  async disconnect() {
    await this.oauthService.disconnect();
    return this.oauthService.getStatus();
  }

  /**
   * Google redirects the admin's browser here directly after consent — no
   * Authorization header is available, so this route is intentionally public;
   * the `state` param (minted only from the guarded /authorize call above) is
   * what actually authorizes this request.
   */
  @Get('demo-bookings/google-calendar/oauth/callback')
  @ApiOperation({ summary: 'Google Calendar OAuth redirect target (not called directly)' })
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    const frontendUrl = getAppConfig().frontendUrl;
    const redirectTo = `${frontendUrl}/admin/demo-bookings`;

    if (error || !code || !state) {
      res.redirect(`${redirectTo}?googleCalendar=error&message=${encodeURIComponent(error || 'Missing authorization code.')}`);
      return;
    }

    try {
      await this.oauthService.handleCallback(code, state);
      res.redirect(`${redirectTo}?googleCalendar=connected`);
    } catch (err: any) {
      res.redirect(`${redirectTo}?googleCalendar=error&message=${encodeURIComponent(err?.message || 'Connection failed.')}`);
    }
  }
}
