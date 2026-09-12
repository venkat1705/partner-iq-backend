import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { getAppConfig } from '../../../config/app.config';
import { AffiliateAuthService } from './affiliate-auth.service';

function affiliateRefreshCookieOptions(maxAge = 30 * 24 * 3600 * 1000): CookieOptions {
  const appConfig = getAppConfig();
  return {
    httpOnly: true,
    secure: appConfig.cookieSecure,
    sameSite: appConfig.cookieSameSite,
    path: '/',
    maxAge,
  };
}

@ApiTags('Affiliate Auth')
@Controller(['api/v1/affiliate/auth', 'api/affiliate/auth'])
export class AffiliateAuthController {
  constructor(private readonly affiliateAuthService: AffiliateAuthService) { }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register affiliate portal account' })
  async register(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.affiliateAuthService.register(
      body,
      req.headers['user-agent'],
      req.ip || (req.headers['x-forwarded-for'] as string),
    );
    if (result.refreshToken) {
      res.cookie('affiliateRefreshToken', result.refreshToken, affiliateRefreshCookieOptions());
    }
    return { success: true, data: result };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login to affiliate portal' })
  async login(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.affiliateAuthService.login(
      body.email,
      body.password,
      req.headers['user-agent'],
      req.ip || (req.headers['x-forwarded-for'] as string),
    );
    if (result.refreshToken) {
      res.cookie('affiliateRefreshToken', result.refreshToken, affiliateRefreshCookieOptions());
    }
    return { success: true, data: result };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh affiliate portal session' })
  async refresh(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken =
      req.cookies?.affiliateRefreshToken ||
      (req.headers['x-refresh-token'] as string) ||
      body?.refreshToken;
    const result = await this.affiliateAuthService.refresh(
      rawRefreshToken,
      req.headers['user-agent'],
      req.ip || (req.headers['x-forwarded-for'] as string),
    );
    res.cookie('affiliateRefreshToken', result.refreshToken, affiliateRefreshCookieOptions());
    return { success: true, data: result };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Logout affiliate portal session' })
  async logout(@CurrentUser() user: any, @Res({ passthrough: true }) res: Response) {
    const appConfig = getAppConfig();
    const result = await this.affiliateAuthService.logout(user.sessionId, user.userId);
    res.clearCookie('affiliateRefreshToken', { path: '/', secure: appConfig.cookieSecure, sameSite: appConfig.cookieSameSite });
    return { success: true, data: result };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Current affiliate portal user' })
  async me(@CurrentUser() user: any) {
    const result = await this.affiliateAuthService.me(user.userId);
    return { success: true, data: result };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset for affiliate account' })
  async forgotPassword(@Body() body: any, @Req() req: Request) {
    const origin = body?.origin || req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : undefined);
    const result = await this.affiliateAuthService.forgotPassword(body.email, origin as string);
    return { success: true, data: result };
  }

  @Get('verify-reset-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify affiliate password reset token validity' })
  async verifyResetToken(@Query('token') token: string) {
    const result = await this.affiliateAuthService.verifyResetToken(token);
    return { success: true, data: result };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset affiliate password with secure token' })
  async resetPassword(@Body() body: any) {
    const result = await this.affiliateAuthService.resetPassword(body);
    return { success: true, data: result };
  }

  @Get('google/status')
  async googleStatus() {
    return { success: true, data: this.affiliateAuthService.getGoogleStatus() };
  }

  @Get('google')
  @ApiOperation({ summary: 'Start affiliate Google OAuth flow' })
  async google(@Query() query: any, @Req() req: Request, @Res() res: Response) {
    const origin = query.origin || req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : undefined);
    const result = await this.affiliateAuthService.initiateGoogleAuth({ ...query, origin });
    if (req.headers.accept?.includes('application/json') || req.query.json === 'true') {
      return res.json({ success: true, data: result });
    }
    return res.redirect(result.url);
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Affiliate Google OAuth callback' })
  async googleCallback(@Query() query: any, @Res() res: Response) {
    const config = getAppConfig();
    try {
      const result = await this.affiliateAuthService.handleGoogleCallback(query);
      const affiliateBase = result.frontendOrigin || config.affiliateFrontendUrl.replace(/\/$/, '');
      res.cookie('affiliateRefreshToken', result.refreshToken, affiliateRefreshCookieOptions());
      const targetPath = result.returnUrl?.startsWith('/') ? result.returnUrl : '/dashboard';
      const redirectUrl = `${affiliateBase}/auth/google/callback?token=${encodeURIComponent(result.accessToken)}&refreshToken=${encodeURIComponent(result.refreshToken || '')}&returnUrl=${encodeURIComponent(targetPath)}&isNew=${result.isNewUser ? 'true' : 'false'}`;
      return res.redirect(redirectUrl);
    } catch (err: any) {
      const affiliateBase = config.affiliateFrontendUrl.replace(/\/$/, '');
      return res.redirect(`${affiliateBase}/auth?error=${encodeURIComponent(err.message || 'Google authentication failed.')}`);
    }
  }
}

