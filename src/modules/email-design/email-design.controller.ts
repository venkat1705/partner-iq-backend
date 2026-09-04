import { Controller, Delete, Get, Post, Put, Body, Headers, Param, Query, UseGuards, Req, Res, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { EmailDesignService } from './email-design.service';
import { EmailSuppressionService } from './services/email-suppression.service';
import { AuthService } from '../auth/auth.service';
import type { CookieOptions, Request, Response } from 'express';
import { getAppConfig } from '../../config/app.config';

@Controller('api/v1/admin/email-design')
export class EmailDesignController {
  constructor(
    private readonly svc: EmailDesignService,
    private readonly suppressionSvc: EmailSuppressionService,
    private readonly authService: AuthService,
  ) {}

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

    const user = await (this.authService as any).repositories().then((r: any) => r.users.findOne({ where: { id: userId } }));
    if (!user) throw new ForbiddenException('User not found');

    const tokens = await this.authService.createSessionAndTokens(user, 'email-design', req.ip);
    res.cookie('refreshToken', tokens.refreshToken, this.refreshCookieOptions(7 * 24 * 3600 * 1000));
    const profile = await this.authService.getMe(user.id);
    return { accessToken: tokens.accessToken, user: profile };
  }

  @Post('webhook')
  async webhookLegacy(@Body() body: any, @Headers('x-email-design-secret') secret?: string) {
    const expected = process.env.EMAIL_DESIGN_WEBHOOK_SECRET || 'dev_email_design_secret';
    if (secret !== expected) {
      throw new ForbiddenException('Invalid webhook secret');
    }

    const templates = Array.isArray(body.templates) ? body.templates : [];
    await this.svc.saveTemplates(templates);
    return { success: true };
  }

  @Post('provider-webhook/:provider')
  async providerWebhook(@Param('provider') provider: string, @Body() body: any) {
    return this.svc.handleWebhook(provider, body);
  }

  @Get('health')
  getHealth() {
    return this.svc.getHealth();
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get('catalog')
  async getCatalog() {
    return this.svc.getCatalog();
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
  @Get('delivery-logs')
  async getDeliveryLogs(@Query('orgId') orgId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.svc.getDeliveryLogs(orgId, Number(page) || 1, Number(limit) || 20);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Get('suppressions')
  async listSuppressions(@Query('orgId') orgId?: string) {
    return this.suppressionSvc.listSuppressions(orgId);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Post('suppressions')
  async addSuppression(@Body() body: { email: string; reason?: any; orgId?: string }) {
    return this.suppressionSvc.addSuppression({
      email: body.email,
      reason: body.reason || 'ADMIN_SUPPRESSED',
      organizationId: body.orgId,
    });
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Delete('suppressions/:email')
  async removeSuppression(@Param('email') email: string, @Query('orgId') orgId?: string) {
    return this.suppressionSvc.removeSuppression(email, orgId);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Put('overrides/:templateKey')
  async saveOverride(@Param('templateKey') templateKey: string, @Body() body: any) {
    return this.svc.saveOrganizationOverride(body.organizationId, templateKey, body);
  }

  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @Delete('overrides/:templateKey')
  async deleteOverride(@Param('templateKey') templateKey: string, @Query('organizationId') organizationId: string) {
    return this.svc.deleteOrganizationOverride(organizationId, templateKey);
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
