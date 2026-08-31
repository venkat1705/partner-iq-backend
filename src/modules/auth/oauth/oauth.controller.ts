import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { OAuthService } from './oauth.service';
import {
  InitiateGoogleAuthDto,
  GoogleCallbackQueryDto,
  GoogleTokenExchangeDto,
  SetPasswordDto,
} from './dto/oauth.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import { getAppConfig } from '../../../config/app.config';

@ApiTags('OAuth Authentication')
@Controller('api/v1/auth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  private refreshCookieOptions(maxAge?: number): CookieOptions {
    const appConfig = getAppConfig();
    return {
      httpOnly: true,
      secure: appConfig.cookieSecure,
      sameSite: appConfig.cookieSameSite,
      path: '/',
      ...(maxAge !== undefined ? { maxAge } : {}),
    };
  }

  @Get('google')
  @ApiOperation({ summary: 'Initiate Google OAuth 2.0 / OpenID Connect authorization' })
  async initiateGoogle(
    @Query() query: InitiateGoogleAuthDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    const userAgent = req.headers['user-agent'];
    const currentUserId = (req as any).user?.userId;

    const result = await this.oauthService.initiateGoogleAuth(
      query,
      currentUserId,
      { ipAddress, userAgent },
    );

    // If client requested JSON via headers or query, respond with JSON payload
    if (req.headers.accept?.includes('application/json') || req.query.json === 'true') {
      return res.json(result);
    }

    // Otherwise perform immediate 302 redirect to Google consent screen
    return res.redirect(result.url);
  }

  @Get('google/authorize')
  @ApiOperation({ summary: 'Get Google authorization URL payload' })
  async getAuthorizeUrl(
    @Query() query: InitiateGoogleAuthDto,
    @Req() req: Request,
  ) {
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    const userAgent = req.headers['user-agent'];
    const currentUserId = (req as any).user?.userId;

    return this.oauthService.initiateGoogleAuth(
      query,
      currentUserId,
      { ipAddress, userAgent },
    );
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback handler' })
  async googleCallback(
    @Query() query: GoogleCallbackQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const appConfig = getAppConfig();
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    const userAgent = req.headers['user-agent'];

    try {
      const result = await this.oauthService.handleGoogleCallback(query, {
        ipAddress,
        userAgent,
      });

      if ('accessToken' in result) {
        // Set HTTP-only refresh token cookie
        res.cookie(
          'refreshToken',
          result.refreshToken,
          this.refreshCookieOptions(7 * 24 * 3600 * 1000),
        );

        // Redirect to frontend destination with token / status
        const frontendBase = appConfig.frontendUrl.replace(/\/$/, '');
        const targetPath = result.returnUrl.startsWith('/') ? result.returnUrl : `/${result.returnUrl}`;
        const redirectUrl = `${frontendBase}/auth/google/callback?token=${encodeURIComponent(result.accessToken)}&returnUrl=${encodeURIComponent(targetPath)}&isNew=${result.isNewUser ? 'true' : 'false'}`;

        return res.redirect(redirectUrl);
      }

      // Account Linking flow redirect
      const frontendBase = appConfig.frontendUrl.replace(/\/$/, '');
      const targetPath = result.returnUrl.startsWith('/') ? result.returnUrl : `/${result.returnUrl}`;
      const redirectUrl = `${frontendBase}${targetPath}?googleLinked=true`;
      return res.redirect(redirectUrl);
    } catch (err: any) {
      const frontendBase = appConfig.frontendUrl.replace(/\/$/, '');
      const errorMessage = encodeURIComponent(err.message || 'Google authentication failed.');
      return res.redirect(`${frontendBase}/auth?error=${errorMessage}`);
    }
  }

  @Post('google/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange Google authorization code for session tokens' })
  async exchangeToken(
    @Body() dto: GoogleTokenExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    const userAgent = req.headers['user-agent'];

    const result = await this.oauthService.exchangeToken(dto, { ipAddress, userAgent });

    if ('refreshToken' in result) {
      res.cookie(
        'refreshToken',
        result.refreshToken,
        this.refreshCookieOptions(7 * 24 * 3600 * 1000),
      );
    }

    return result;
  }

  @Get('identities')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List connected login methods and password status for current user' })
  async getIdentities(@CurrentUser() user: AuthUserPayload) {
    return this.oauthService.getUserIdentities(user.userId);
  }

  @Delete('identities/:identityId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect an external identity provider (with lockout prevention)' })
  async unlinkIdentity(
    @CurrentUser() user: AuthUserPayload,
    @Param('identityId') identityId: string,
    @Req() req: Request,
  ) {
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    const userAgent = req.headers['user-agent'];

    return this.oauthService.unlinkIdentity(user.userId, identityId, {
      ipAddress,
      userAgent,
    });
  }

  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Configure a password for Google-authenticated users' })
  async setPassword(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: SetPasswordDto,
    @Req() req: Request,
  ) {
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    const userAgent = req.headers['user-agent'];

    return this.oauthService.setPassword(user.userId, dto, {
      ipAddress,
      userAgent,
    });
  }

  @Get('google/status')
  @ApiOperation({ summary: 'Get Google OAuth configuration health status' })
  async getGoogleStatus() {
    return this.oauthService.getStatus();
  }
}
