import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { NotificationsService } from './notifications.service';

@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async listForUser(
    @CurrentUser() user: AuthUserPayload,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.notificationsService.listForUser(user.userId, organizationId);
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  async markAsRead(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(id, user.userId);
  }

  @Post('read-all')
  @UseGuards(JwtAuthGuard)
  async markAllAsRead(@CurrentUser() user: AuthUserPayload) {
    return this.notificationsService.markAllAsRead(user.userId);
  }

  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  async getPreferences(
    @CurrentUser() user: AuthUserPayload,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.notificationsService.getPreferences(user.userId, organizationId);
  }

  @Patch('preferences')
  @UseGuards(JwtAuthGuard)
  async updatePreferences(
    @CurrentUser() user: AuthUserPayload,
    @Body() updates: Record<string, any>,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.notificationsService.updatePreferences(user.userId, updates, organizationId);
  }
}
