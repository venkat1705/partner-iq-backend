import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminWebhooksService } from './admin-webhooks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';

@ApiTags('Admin - Webhooks Operations Center')
@Controller('api/v1/admin/webhooks')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminWebhooksController {
  constructor(private readonly adminWebhooksService: AdminWebhooksService) { }

  @Get('overview')
  @ApiOperation({ summary: 'Get high-level Webhook Operations KPIs and timeline' })
  async getOverview(@Query('period') period?: string) {
    return this.adminWebhooksService.getOverview(period);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get detailed time-series delivery analytics' })
  async getAnalytics(
    @Query('range') range?: string,
    @Query('organizationId') organizationId?: string,
    @Query('endpointId') endpointId?: string,
    @Query('eventType') eventType?: string
  ) {
    return this.adminWebhooksService.getAnalytics({
      range,
      organizationId,
      endpointId,
      eventType,
    });
  }

  @Get('endpoints')
  @ApiOperation({ summary: 'List all registered webhook endpoints across tenants' })
  async getEndpoints(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('organizationId') organizationId?: string
  ) {
    return this.adminWebhooksService.getEndpoints({ search, status, organizationId });
  }

  @Get('endpoints/:id')
  @ApiOperation({ summary: 'Get detailed endpoint dossier and delivery history' })
  async getEndpointDetail(@Param('id') id: string) {
    return this.adminWebhooksService.getEndpointDetail(id);
  }

  @Patch('endpoints/:id')
  @ApiOperation({ summary: 'Update endpoint configuration with SSRF protection' })
  async updateEndpoint(
    @Param('id') id: string,
    @Body() dto: any,
    @Req() req: any
  ) {
    const actor = {
      id: req.user?.userId || 'usr_admin',
      email: req.user?.email || 'admin@partneriq.com',
    };
    return this.adminWebhooksService.updateEndpoint(id, dto, actor);
  }

  @Post('endpoints/:id/rotate-secret')
  @ApiOperation({ summary: 'Rotate endpoint secret securely with audit trail' })
  async rotateSecret(@Param('id') id: string, @Req() req: any) {
    const actor = {
      id: req.user?.userId || 'usr_admin',
      email: req.user?.email || 'admin@partneriq.com',
    };
    return this.adminWebhooksService.rotateSecret(id, actor);
  }

  @Get('events')
  @ApiOperation({ summary: 'List business events that triggered webhook deliveries' })
  async getEvents(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('eventType') eventType?: string,
    @Query('organizationId') organizationId?: string
  ) {
    return this.adminWebhooksService.getEvents({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      search,
      eventType,
      organizationId,
    });
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'Get business event detail with sanitized JSON payload' })
  async getEventDetail(@Param('id') id: string) {
    return this.adminWebhooksService.getEventDetail(id);
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'Get paginated webhook deliveries with filtering' })
  async getDeliveries(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('endpointId') endpointId?: string,
    @Query('eventType') eventType?: string,
    @Query('organizationId') organizationId?: string
  ) {
    return this.adminWebhooksService.getDeliveries({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      search,
      status,
      endpointId,
      eventType,
      organizationId,
    });
  }

  @Get('deliveries/:id')
  @ApiOperation({ summary: 'Get deep delivery dossier with attempts timeline' })
  async getDeliveryDetail(@Param('id') id: string) {
    return this.adminWebhooksService.getDeliveryDetail(id);
  }

  @Post('deliveries/:id/retry')
  @ApiOperation({ summary: 'Manually retry a failed delivery server-side' })
  async retryDelivery(@Param('id') id: string, @Req() req: any) {
    const actor = {
      id: req.user?.userId || 'usr_admin',
      email: req.user?.email || 'admin@partneriq.com',
    };
    return this.adminWebhooksService.retryDelivery(id, actor);
  }

  @Post('deliveries/bulk-retry')
  @ApiOperation({ summary: 'Bulk retry selected failed deliveries' })
  async bulkRetry(@Body('deliveryIds') deliveryIds: string[], @Req() req: any) {
    const actor = {
      id: req.user?.userId || 'usr_admin',
      email: req.user?.email || 'admin@partneriq.com',
    };
    return this.adminWebhooksService.bulkRetry(deliveryIds || [], actor);
  }

  @Get('failed')
  @ApiOperation({ summary: 'Get deliveries classified by failure category' })
  async getFailedDeliveries(
    @Query('category') category?: string,
    @Query('search') search?: string
  ) {
    return this.adminWebhooksService.getFailedDeliveries({ category, search });
  }

  @Get('retries')
  @ApiOperation({ summary: 'Get active retry queue awaiting next attempt' })
  async getRetryQueue() {
    return this.adminWebhooksService.getRetryQueue();
  }

  @Get('dead-letter')
  @ApiOperation({ summary: 'Get dead letter queue of exhausted deliveries' })
  async getDeadLetters(@Query('status') status?: string) {
    return this.adminWebhooksService.getDeadLetters({ status });
  }

  @Post('dead-letter/:id/resolve')
  @ApiOperation({ summary: 'Resolve a dead letter record with operator notes' })
  async resolveDeadLetter(
    @Param('id') id: string,
    @Body('notes') notes: string,
    @Req() req: any
  ) {
    const actor = {
      id: req.user?.userId || 'usr_admin',
      email: req.user?.email || 'admin@partneriq.com',
    };
    return this.adminWebhooksService.resolveDeadLetter(id, notes || 'Resolved by admin', actor);
  }

  @Post('dead-letter/:id/retry')
  @ApiOperation({ summary: 'Re-queue a dead lettered delivery' })
  async retryDeadLetter(@Param('id') id: string, @Req() req: any) {
    const actor = {
      id: req.user?.userId || 'usr_admin',
      email: req.user?.email || 'admin@partneriq.com',
    };
    return this.adminWebhooksService.retryDeadLetter(id, actor);
  }

  @Get('event-types')
  @ApiOperation({ summary: 'Get registry of supported event types and schemas' })
  async getEventTypes() {
    return this.adminWebhooksService.getEventTypes();
  }

  @Get('event-types/:id')
  @ApiOperation({ summary: 'Get event type detail with JSON schema' })
  async getEventTypeDetail(@Param('id') id: string) {
    return this.adminWebhooksService.getEventTypeDetail(id);
  }

  @Get('organizations')
  @ApiOperation({ summary: 'Get tenant consumption breakdown' })
  async getOrganizations() {
    return this.adminWebhooksService.getOrganizations();
  }

  @Get('integrations')
  @ApiOperation({ summary: 'Get outbound third-party provider integration webhooks' })
  async getIntegrations() {
    return this.adminWebhooksService.getIntegrations();
  }

  @Get('performance')
  @ApiOperation({ summary: 'Get latency percentiles and slowest destination endpoints' })
  async getPerformance() {
    return this.adminWebhooksService.getPerformance();
  }

  @Get('security')
  @ApiOperation({ summary: 'Get webhook security incidents and SSRF block attempts' })
  async getSecurity() {
    return this.adminWebhooksService.getSecurity();
  }

  @Get('exceptions')
  @ApiOperation({ summary: 'Get runtime pipeline webhook exceptions' })
  async getExceptions() {
    return this.adminWebhooksService.getExceptions();
  }

  @Get('audit')
  @ApiOperation({ summary: 'Get immutable audit logs of webhook administrative mutations' })
  async getAuditLogs() {
    return this.adminWebhooksService.getAuditLogs();
  }

  @Post('export')
  @ApiOperation({ summary: 'Export webhook data to CSV with audit recording' })
  async exportData(
    @Body('type') type: string,
    @Body('format') format: string,
    @Req() req: any
  ) {
    const actorEmail = req.user?.email || 'admin@partneriq.com';
    return this.adminWebhooksService.exportData(type || 'deliveries', format || 'csv', actorEmail);
  }
}

