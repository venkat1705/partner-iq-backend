import {
  Body,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { RegisterDto } from '../auth/dto/auth.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { getAppConfig } from '../../config/app.config';
import { MembershipsService } from './memberships.service';
import { assertUserEligibleForOrganization } from '../affiliates/affiliate-eligibility.policy';

@ApiTags('Organization Invitations')
@Controller('api/v1/invitations')
export class InvitationsController {
  constructor(
    private readonly membershipsService: MembershipsService,
    private readonly authService: AuthService,
  ) { }

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

  @Get(':token')
  @ApiOperation({ summary: 'Get invitation details' })
  getInvitation(@Param('token') token: string) {
    return this.membershipsService.getInvitation(token);
  }

  @Post(':token/register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create account and accept invitation' })
  async registerAndAccept(
    @Param('token') token: string,
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const invitation = this.membershipsService.getInvitation(token);
    const email = dto.email.toLowerCase().trim();
    assertUserEligibleForOrganization(email);
    if (email !== invitation.email.toLowerCase()) {
      throw new BadRequestException('Invitation email does not match registration email');
    }

    const result = await this.authService.register(dto, req.headers['user-agent'], req.ip || (req.headers['x-forwarded-for'] as string));
    try {
      await this.membershipsService.acceptInvitationForUser(token, result.userId);
      res.cookie('refreshToken', result.refreshToken, this.refreshCookieOptions(7 * 24 * 3600 * 1000));
      return result;
    } catch (error) {
      await this.authService.removeNewlyRegisteredUser(result.userId);
      res.clearCookie('refreshToken', this.refreshCookieOptions());
      throw error;
    }
  }

  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept invitation with current authenticated user' })
  async acceptInvitation(@Param('token') token: string, @CurrentUser() user: AuthUserPayload) {
    return this.membershipsService.acceptInvitationForUser(token, user.userId);
  }
}
