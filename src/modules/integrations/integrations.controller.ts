import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { IntegrationStatus } from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { IntegrationsService } from './integrations.service';

@ApiTags('Integrations')
@Controller('api/v1')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get('admin/integrations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List platform integrations with health metrics' })
  list(@CurrentUser() user: AuthUserPayload) {
    return this.integrationsService.listAdminIntegrations(user);
  }

  @Get('admin/integrations/metrics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  metrics(@CurrentUser() user: AuthUserPayload) {
    return this.integrationsService.getMetrics(user);
  }

  @Get('admin/integrations/:integrationId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  detail(@CurrentUser() user: AuthUserPayload, @Param('integrationId') integrationId: string) {
    return this.integrationsService.getAdminIntegration(user, integrationId);
  }

  @Patch('admin/integrations/:integrationId/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  updateStatus(
    @CurrentUser() user: AuthUserPayload,
    @Param('integrationId') integrationId: string,
    @Body('status') status: IntegrationStatus,
  ) {
    return this.integrationsService.updateStatus(user, integrationId, status);
  }

  @Get('admin/integrations/:integrationId/connections')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  connections(@CurrentUser() user: AuthUserPayload, @Param('integrationId') integrationId: string) {
    return this.integrationsService.connections(user, integrationId);
  }

  @Get('admin/integrations/:integrationId/events')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  events(@CurrentUser() user: AuthUserPayload, @Param('integrationId') integrationId: string) {
    return this.integrationsService.events(user, integrationId);
  }

  @Post('integrations/:provider/webhooks/:publicConnectionId')
  receiveWebhook(
    @Param('provider') provider: string,
    @Param('publicConnectionId') publicConnectionId: string,
    @Body() body: any,
    @Headers() headers: Record<string, any>,
  ) {
    return this.integrationsService.receiveWebhook(provider, publicConnectionId, body, headers);
  }
}
