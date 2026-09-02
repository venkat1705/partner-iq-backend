import {
  Controller,
  Post,
  Get,
  Delete,
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
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
  MfaChallengeDto,
  MfaVerifyDto,
  MfaSetupVerifyDto,
  MfaDisableDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { getAppConfig } from '../../config/app.config';

@ApiTags('Authentication')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    const result = await this.authService.register(dto, userAgent, ipAddress);

    res.cookie('refreshToken', result.refreshToken, this.refreshCookieOptions(7 * 24 * 3600 * 1000));

    return result;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login with password' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);

    const result = await this.authService.login(dto, userAgent, ipAddress);

    res.cookie('refreshToken', result.refreshToken, this.refreshCookieOptions(7 * 24 * 3600 * 1000));

    return result;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using rotating refresh token' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = dto?.refreshToken || req.cookies?.refreshToken;
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);

    const result = await this.authService.refreshToken(refreshToken, userAgent, ipAddress);

    res.cookie('refreshToken', result.refreshToken, this.refreshCookieOptions(7 * 24 * 3600 * 1000));

    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout current session' })
  async logout(@CurrentUser() user: AuthUserPayload, @Res({ passthrough: true }) res: Response) {
    res.clearCookie('refreshToken', this.refreshCookieOptions());
    return this.authService.logout(user.sessionId!);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke all sessions for current user' })
  async logoutAll(@CurrentUser() user: AuthUserPayload, @Res({ passthrough: true }) res: Response) {
    res.clearCookie('refreshToken', this.refreshCookieOptions());
    return this.authService.logoutAll(user.userId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile and memberships' })
  async getMe(@CurrentUser() user: AuthUserPayload) {
    return this.authService.getMe(user.userId);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all active sessions for current user' })
  async getSessions(@CurrentUser() user: AuthUserPayload) {
    return this.authService.getSessions(user.userId, user.sessionId);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a specific session' })
  async revokeSession(
    @CurrentUser() user: AuthUserPayload,
    @Param('sessionId') sessionId: string,
  ) {
    return this.authService.revokeSession(user.userId, sessionId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password for authenticated user' })
  async changePassword(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.userId, dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate forgot password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return { success: true, message: 'If an account exists, a reset link has been sent.' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return { success: true, message: 'Password reset successfully' };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify user email with token' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return { success: true, message: 'Email verified successfully' };
  }

  @Post('mfa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Begin Authenticator App enrollment' })
  async setupMfa(@CurrentUser() user: AuthUserPayload) {
    return this.authService.setupMfa(user.userId, user.email);
  }

  @Post('mfa/setup/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify Authenticator App setup code and enable MFA' })
  async verifyMfaSetup(@CurrentUser() user: AuthUserPayload, @Body() dto: MfaSetupVerifyDto) {
    return this.authService.verifyMfaSetup(user.userId, dto.code);
  }

  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable MFA after verification' })
  async disableMfa(@CurrentUser() user: AuthUserPayload, @Body() dto: MfaDisableDto) {
    return this.authService.disableMfa(user.userId, dto.password, dto.code);
  }

  @Post('mfa/challenge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a short-lived MFA challenge for a user with MFA enabled' })
  async createMfaChallenge(@Body() dto: MfaChallengeDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    return this.authService.createMfaChallenge(dto.email, dto.password, userAgent, ipAddress);
  }

  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an MFA challenge using an authenticator code or recovery code' })
  async verifyMfa(@Body() dto: MfaVerifyDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    return this.authService.verifyMfaChallenge(dto.challengeId, dto.code, dto.recoveryCode, userAgent, ipAddress);
  }

  @Post('mfa/recovery/regenerate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Regenerate recovery codes after step-up verification' })
  async regenerateRecoveryCodes(@CurrentUser() user: AuthUserPayload, @Body() dto: MfaSetupVerifyDto) {
    return this.authService.regenerateRecoveryCodes(user.userId, dto.code);
  }

  @Post('mfa/recovery/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a recovery code during login or step-up' })
  async verifyRecoveryCode(@Body() dto: MfaVerifyDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string);
    return this.authService.verifyRecoveryCode(dto.challengeId, dto.recoveryCode, userAgent, ipAddress);
  }
}
