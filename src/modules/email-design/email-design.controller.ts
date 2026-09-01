import { Controller, Delete, Get, Post, Put, Body, Headers, Param, UseGuards, Req, Res, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { EmailDesignService } from './email-design.service';
import { AuthService } from '../auth/auth.service';
import type { CookieOptions, Request, Response } from 'express';
import { getAppConfig } from '../../config/app.config';

@Controller('api/v1/admin/email-design')
export class EmailDesignController {
  constructor(private svc: EmailDesignService, private authService: AuthService) {}

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

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get('session')
  async createSession(@Req() req: Request & any, @Res({ passthrough: true }) res: Response) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('User not found');

    // Load user entity via authService repositories
    const user = await (this.authService as any).repositories().then((r: any) => r.users.findOne({ where: { id: userId } }));
    if (!user) throw new ForbiddenException('User not found');

    const tokens = await this.authService.createSessionAndTokens(user, 'email-design', req.ip);
    res.cookie('refreshToken', tokens.refreshToken, this.refreshCookieOptions(7 * 24 * 3600 * 1000));
    const profile = await this.authService.getMe(user.id);
    return { accessToken: tokens.accessToken, user: profile };
  }

  @Post('webhook')
  async webhook(@Body() body: any, @Headers('x-email-design-secret') secret?: string) {
    const expected = process.env.EMAIL_DESIGN_WEBHOOK_SECRET || 'dev_email_design_secret';
    if (secret !== expected) {
      throw new ForbiddenException('Invalid webhook secret');
    }

    const templates = Array.isArray(body.templates) ? body.templates : [];
    await this.svc.saveTemplates(templates);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get('templates')
  async list() {
    return this.svc.listTemplates();
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get('settings')
  async getSettings() {
    return this.svc.getSettings();
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Put('settings')
  async saveSettings(@Body() body: any) {
    return this.svc.saveSettings(body);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Post('send-test')
  async sendTest(@Body() body: any) {
    return this.svc.sendTestEmail(body);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Put('templates/:templateId')
  async save(@Param('templateId') templateId: string, @Body() body: any) {
    return this.svc.saveTemplate({ ...body, id: templateId });
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Delete('templates/:templateId')
  async delete(@Param('templateId') templateId: string) {
    return this.svc.deleteTemplate(templateId);
  }
}

export default EmailDesignController;
