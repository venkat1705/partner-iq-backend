import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LegalAcceptanceService } from './legal-acceptance.service';
import { LEGAL_DOCUMENT_VERSIONS } from '../../common/constants/legal-documents';
import { OAuthService } from './oauth/oauth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaRateLimiterGuard } from '../../common/guards/mfa-rate-limiter.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { getAppConfig } from '../../config/app.config';
import { safeReturnPath } from '../../common/utils/safe-redirect.utils';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  MfaVerifyDto,
  MfaSetupVerifyDto,
  MfaDisableDto,
  MfaChallengeDto,
  RegenerateRecoveryCodesDto,
  StepUpVerifyDto,
  UpdateOrgSecurityPolicyDto,
  VerifyEmailOtpDto,
  ResendEmailOtpDto,
} from './dto/auth.dto';

function refreshCookieOptions(appConfig: ReturnType<typeof getAppConfig>, expiresIn = 30 * 24 * 3600 * 1000) {
  return {
    httpOnly: true,
    secure: appConfig.cookieSecure,
    sameSite: appConfig.cookieSameSite,
    path: '/',
    maxAge: expiresIn,
  };
}

@ApiTags('Authentication')
@Controller(['api/v1/auth', 'auth'])
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oAuthService: OAuthService,
    private readonly legalAcceptance: LegalAcceptanceService,
  ) { }

  // ─────────────────────────────────────────────────────────
  // Register & Login
  // ─────────────────────────────────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const appConfig = getAppConfig();
    const result = await this.authService.register(
      dto,
      req.headers['user-agent'],
      req.ip || (req.headers['x-forwarded-for'] as string),
    );

    // No session is issued until the email OTP challenge is verified
    if (!('requiresEmailVerification' in result) && 'refreshToken' in (result as any)) {
      res.cookie('refreshToken', (result as any).refreshToken, refreshCookieOptions(appConfig));
    }
    return { success: true, data: result };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const appConfig = getAppConfig();
    const result = await this.authService.login(
      dto,
      req.headers['user-agent'],
      req.ip || (req.headers['x-forwarded-for'] as string),
    );

    // Only set refresh cookie when login is fully complete (not when an MFA or email-verification challenge is pending)
    if (!('requiresMfa' in result) && !('requiresEmailVerification' in result) && 'refreshToken' in result) {
      res.cookie('refreshToken', (result as any).refreshToken, refreshCookieOptions(appConfig));
      return { success: true, data: result };
    }

    return { success: true, data: result };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and get new access token' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const appConfig = getAppConfig();
    const rawRefreshToken =
      req.cookies?.refreshToken ||
      dto.refreshToken ||
      (req.headers['x-refresh-token'] as string);

    const result = await this.authService.refreshToken(
      rawRefreshToken,
      req.headers['user-agent'],
      req.ip || (req.headers['x-forwarded-for'] as string),
    );

    res.cookie('refreshToken', result.refreshToken, refreshCookieOptions(appConfig));
    return { success: true, data: result };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Logout current session' })
  async logout(
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const appConfig = getAppConfig();
    const result = await this.authService.logout(user.sessionId!, user.userId);
    res.clearCookie('refreshToken', { path: '/', secure: appConfig.cookieSecure, sameSite: appConfig.cookieSameSite });
    return { success: true, data: result };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Logout all sessions for current user' })
  async logoutAll(
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const appConfig = getAppConfig();
    const result = await this.authService.logoutAll(user.userId);
    res.clearCookie('refreshToken', { path: '/', secure: appConfig.cookieSecure, sameSite: appConfig.cookieSameSite });
    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // Email OTP Verification (Signup / Unverified Login)
  // ─────────────────────────────────────────────────────────

  @Post('verify-email-otp')
  @UseGuards(MfaRateLimiterGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the emailed OTP code to activate the account and receive a session' })
  async verifyEmailOtp(
    @Body() dto: VerifyEmailOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const appConfig = getAppConfig();
    const result = await this.authService.verifyEmailOtp(
      dto.challengeId,
      dto.code,
      req.headers['user-agent'],
      req.ip || (req.headers['x-forwarded-for'] as string),
    );

    if ('refreshToken' in result) {
      res.cookie('refreshToken', result.refreshToken, refreshCookieOptions(appConfig));
    }
    return { success: true, data: result };
  }

  @Post('resend-email-otp')
  @UseGuards(MfaRateLimiterGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend the email verification OTP (rate-limited, cooldown-gated)' })
  async resendEmailOtp(
    @Body() dto: ResendEmailOtpDto,
    @Req() req: Request,
  ) {
    const result = await this.authService.resendEmailOtp(
      dto.challengeId,
      dto.email,
      req.headers['user-agent'],
      req.ip || (req.headers['x-forwarded-for'] as string),
    );
    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // MFA Challenge (Login Flow)
  // ─────────────────────────────────────────────────────────

  @Post('mfa/challenge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create MFA challenge during login (deprecated — handled by /login)' })
  async createMfaChallenge(
    @Body() dto: MfaChallengeDto,
    @Req() req: Request,
  ) {
    const result = await this.authService.createMfaChallenge(
      dto.email,
      dto.password,
      req.headers['user-agent'],
      req.ip,
    );
    return { success: true, data: result };
  }

  @Post('mfa/verify')
  @UseGuards(MfaRateLimiterGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify MFA challenge after login' })
  async verifyMfaChallenge(
    @Body() dto: MfaVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const appConfig = getAppConfig();
    const result = await this.authService.verifyMfaChallenge(
      dto.challengeId,
      dto.code,
      dto.recoveryCode,
      req.headers['user-agent'],
      req.ip || (req.headers['x-forwarded-for'] as string),
      dto.trustDevice,
    );

    if ('refreshToken' in result) {
      res.cookie('refreshToken', result.refreshToken, refreshCookieOptions(appConfig));
      return { success: true, data: result };
    }

    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // MFA Setup (Settings)
  // ─────────────────────────────────────────────────────────

  @Post('mfa/setup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Begin MFA setup — returns QR code and manual setup key' })
  async setupMfa(@CurrentUser() user: any) {
    const result = await this.authService.setupMfa(user.userId, user.email);
    return { success: true, data: result };
  }

  @Post('mfa/setup/verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Verify TOTP code and activate MFA' })
  async verifyMfaSetup(
    @CurrentUser() user: any,
    @Body() dto: MfaSetupVerifyDto,
  ) {
    const result = await this.authService.verifyMfaSetup(user.userId, dto.code);
    return { success: true, data: result };
  }

  @Post('mfa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Disable MFA after password and code verification' })
  async disableMfa(
    @CurrentUser() user: any,
    @Body() dto: MfaDisableDto,
  ) {
    const result = await this.authService.disableMfa(user.userId, dto.password, dto.code);
    return { success: true, data: result };
  }

  @Post('mfa/recovery/regenerate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Regenerate recovery codes (requires TOTP verification)' })
  async regenerateRecoveryCodes(
    @CurrentUser() user: any,
    @Body() dto: RegenerateRecoveryCodesDto,
  ) {
    const result = await this.authService.regenerateRecoveryCodes(user.userId, dto.code);
    return { success: true, data: result };
  }

  @Get('mfa/status')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get current MFA status and recovery code count' })
  async getMfaStatus(@CurrentUser() user: any) {
    const result = await this.authService.getMfaStatus(user.userId);
    return { success: true, data: result };
  }

  @Get('mfa/recovery/count')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get remaining recovery code count' })
  async getRemainingRecoveryCodes(@CurrentUser() user: any) {
    const result = await this.authService.getRemainingRecoveryCodes(user.userId);
    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // Step-Up Authentication
  // ─────────────────────────────────────────────────────────

  @Post('step-up/challenge')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Create a step-up MFA challenge for sensitive actions' })
  async createStepUpChallenge(
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    const result = await this.authService.createStepUpChallenge(
      user.userId,
      user.sessionId!,
      req.headers['user-agent'],
      req.ip || (req.headers['x-forwarded-for'] as string),
    );
    return { success: true, data: result };
  }

  @Post('step-up/verify')
  @UseGuards(JwtAuthGuard, MfaRateLimiterGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Verify step-up MFA challenge' })
  async verifyStepUp(
    @CurrentUser() user: any,
    @Body() dto: StepUpVerifyDto,
    @Req() req: Request,
  ) {
    const result = await this.authService.verifyStepUp(
      user.userId,
      user.sessionId!,
      dto.challengeId,
      dto.code,
      req.headers['user-agent'],
      req.ip || (req.headers['x-forwarded-for'] as string),
    );
    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // Session Management
  // ─────────────────────────────────────────────────────────

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'List all active sessions for current user' })
  async getSessions(@CurrentUser() user: any) {
    const result = await this.authService.getSessions(user.userId, user.sessionId);
    return { success: true, data: result };
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Revoke a specific session' })
  async revokeSession(
    @CurrentUser() user: any,
    @Param('sessionId') sessionId: string,
  ) {
    const result = await this.authService.revokeSession(user.userId, sessionId);
    return { success: true, data: result };
  }

  @Post('sessions/logout-others')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Log out all other sessions except current' })
  async logoutOthers(@CurrentUser() user: any) {
    const result = await this.authService.logoutOthers(user.userId, user.sessionId!);
    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // Device Management
  // ─────────────────────────────────────────────────────────

  @Get('devices')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'List all recognized devices for current user' })
  async getDevices(@CurrentUser() user: any) {
    const result = await this.authService.getDevices(user.userId);
    return { success: true, data: result };
  }

  @Post('devices/:deviceId/trust')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Trust a device for 30 days (bypasses MFA on login)' })
  async trustDevice(
    @CurrentUser() user: any,
    @Param('deviceId') deviceId: string,
  ) {
    const result = await this.authService.trustDevice(user.userId, deviceId, user.sessionId);
    return { success: true, data: result };
  }

  @Delete('devices/:deviceId/trust')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Remove device trust' })
  async revokeTrust(
    @CurrentUser() user: any,
    @Param('deviceId') deviceId: string,
  ) {
    const result = await this.authService.revokeTrust(user.userId, deviceId, user.sessionId);
    return { success: true, data: result };
  }

  @Delete('devices/:deviceId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Remove a device and revoke its associated sessions' })
  async deleteDevice(
    @CurrentUser() user: any,
    @Param('deviceId') deviceId: string,
  ) {
    const result = await this.authService.deleteDevice(user.userId, deviceId, user.sessionId);
    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // Security Events
  // ─────────────────────────────────────────────────────────

  @Get('security-events')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'List security events (login history, MFA events, etc.)' })
  async getSecurityEvents(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.authService.getSecurityEvents(
      user.userId,
      page ? parseInt(page, 10) : 1,
      limit ? Math.min(parseInt(limit, 10), 100) : 20,
    );
    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // Organization Security Policy
  // ─────────────────────────────────────────────────────────

  @Get('organization/security-policy')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get organization security policy' })
  async getOrgSecurityPolicy(
    @CurrentUser() user: any,
    @Query('organizationId') organizationId: string,
  ) {
    const result = await this.authService.getOrganizationSecurityPolicy(organizationId);
    return { success: true, data: result };
  }

  @Put('organization/security-policy')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Update organization security policy (requires OWNER or ADMIN role)' })
  async updateOrgSecurityPolicy(
    @CurrentUser() user: any,
    @Body() dto: UpdateOrgSecurityPolicyDto,
  ) {
    const result = await this.authService.updateOrganizationSecurityPolicy(
      dto.organizationId,
      user.userId,
      {
        requireMfa: dto.requireMfa,
        mfaScope: dto.mfaScope,
        sensitiveRoles: dto.sensitiveRoles,
        sessionIdleTimeoutMinutes: dto.sessionIdleTimeoutMinutes,
      },
    );
    return { success: true, data: result };
  }

  @Get('organization/mfa-requirement')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Check if organization requires MFA for current user' })
  async checkOrgMfaRequirement(
    @CurrentUser() user: any,
    @Query('organizationId') organizationId: string,
  ) {
    const result = await this.authService.checkOrgMfaRequirement(user.userId, organizationId);
    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // Password Management
  // ─────────────────────────────────────────────────────────

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Change password (revokes all sessions)' })
  async changePassword(
    @CurrentUser() user: any,
    @Body() dto: ChangePasswordDto,
  ) {
    const result = await this.authService.changePassword(user.userId, dto);
    return { success: true, data: result };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset (timing-safe — always returns success)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    // Never derive the reset link destination from client-supplied Host/Origin/Referer
    // headers or body fields — only a known portal identifier ('affiliate' vs default)
    // selects between server-configured frontend URLs. See auth.service.forgotPassword.
    const result = await this.authService.forgotPassword(dto.email, dto.portal);
    return { success: true, data: result };
  }

  @Get('verify-reset-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify password reset token validity' })
  async verifyResetToken(@Query('token') token: string) {
    const result = await this.authService.verifyResetToken(token);
    return { success: true, data: result };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with secure token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    const result = await this.authService.resetPassword(dto);
    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // Current User
  // ─────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get current user profile, memberships, and MFA status' })
  async getMe(@CurrentUser() user: any) {
    const userId = user?.userId || user?.id || user?.sub;
    const result = await this.authService.getMe(userId);
    return { success: true, data: result };
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Update current user profile info and avatar' })
  async updateMe(
    @CurrentUser() user: any,
    @Body() dto: { firstName?: string; lastName?: string; avatarUrl?: string },
  ) {
    const userId = user?.userId || user?.id || user?.sub;
    const result = await this.authService.updateProfile(userId, dto);
    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // Google OAuth
  // ─────────────────────────────────────────────────────────

  @Get('google/status')
  @ApiOperation({ summary: 'Get Google OAuth configuration status' })
  async getGoogleStatus() {
    const status = await this.oAuthService.getStatus();
    return { success: true, data: status };
  }

  @Get('google/authorize')
  @ApiOperation({ summary: 'Get Google OAuth authorization URL' })
  async googleAuthorize(@Req() req: Request) {
    const flowType = req.query.flowType as any;
    const returnUrl = req.query.returnUrl as string | undefined;
    const invitationToken = req.query.invitationToken as string | undefined;
    const result = await this.oAuthService.initiateGoogleAuth(
      { flowType, returnUrl, invitationToken },
      (req as any).user?.userId,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );
    return { success: true, data: result };
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Handle Google OAuth callback' })
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string | undefined;
    const appConfig = getAppConfig();
    const frontendBase = (appConfig.frontendUrl || 'http://localhost:3000').replace(/\/$/, '');

    try {
      const result = await this.oAuthService.handleGoogleCallback(
        { code, state, error },
        { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
      );

      // If OAuth flow produced a refresh token, set the cookie for browser session
      if (result && typeof result === 'object' && 'refreshToken' in result && (result as any).refreshToken) {
        res.cookie('refreshToken', (result as any).refreshToken, refreshCookieOptions(appConfig));
      }

      if (result && typeof result === 'object' && 'accessToken' in result) {
        // startsWith('/') on its own admitted `//attacker.test`, which is a
        // protocol-relative URL pointing at another host. This value is handed to
        // the frontend as ?returnUrl= alongside the access token, so a weak check
        // here reopens the same token-leak path the audit recorded against the
        // affiliate flow.
        const targetPath = safeReturnPath((result as any).returnUrl, '/app/dashboard');
        const redirectUrl = `${frontendBase}/auth/google/callback?token=${encodeURIComponent((result as any).accessToken)}&returnUrl=${encodeURIComponent(targetPath)}&isNew=${(result as any).isNewUser ? 'true' : 'false'}`;
        return res.redirect(redirectUrl);
      }

      if (result && typeof result === 'object' && 'returnUrl' in result && (result as any).returnUrl) {
        // Only same-origin relative paths; never an absolute or external URL.
        const safePath = safeReturnPath((result as any).returnUrl as string, '/app/dashboard');
        return res.redirect(`${frontendBase}${safePath}`);
      }

      return res.redirect(`${frontendBase}/app/dashboard`);
    } catch (err: any) {
      const errorMessage = encodeURIComponent(err.message || 'Google authentication failed.');
      return res.redirect(`${frontendBase}/auth?error=${errorMessage}`);
    }
  }

  @Post('google/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange Google OAuth code for session tokens' })
  async exchangeGoogleToken(
    @Body() body: { code: string; state: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const appConfig = getAppConfig();
    const result = await this.oAuthService.exchangeToken(
      { code: body.code, state: body.state },
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );
    if ('refreshToken' in result && result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, refreshCookieOptions(appConfig));
      return { success: true, data: result };
    }
    return { success: true, data: result };
  }

  // ─────────────────────────────────────────────────────────
  // Legal acceptance
  // ─────────────────────────────────────────────────────────

  /**
   * The signed-in user's recorded acceptances, plus any required document they
   * have not accepted at the version currently in force. A non-empty
   * `outstanding` means their consent is stale and should be re-collected.
   */
  @Get('legal-acceptances')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get the current user’s legal document acceptances' })
  async getLegalAcceptances(@CurrentUser() user: any) {
    const accepted = this.legalAcceptance.listForUser(user.userId);
    const outstanding = this.legalAcceptance.getOutstandingDocuments(user.userId);
    return {
      success: true,
      data: {
        accepted,
        outstanding,
        currentVersions: LEGAL_DOCUMENT_VERSIONS,
        hasAcceptedAll: outstanding.length === 0,
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // Identity Management
  // ─────────────────────────────────────────────────────────

  @Get('identities')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get connected login methods' })
  async getIdentities(@CurrentUser() user: any) {
    const result = await this.oAuthService.getUserIdentities(user.userId);
    return { success: true, data: result };
  }

  @Delete('identities/:identityId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Unlink an external identity provider' })
  async unlinkIdentity(
    @CurrentUser() user: any,
    @Param('identityId') identityId: string,
    @Req() req: Request,
  ) {
    const result = await this.oAuthService.unlinkIdentity(
      user.userId,
      identityId,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );
    return { success: true, data: result };
  }

  @Post('set-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Set password for Google-only accounts' })
  async setPassword(
    @CurrentUser() user: any,
    @Body() body: { password: string },
    @Req() req: Request,
  ) {
    const result = await this.oAuthService.setPassword(
      user.userId,
      { password: body.password },
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );
    return { success: true, data: result };
  }
}
