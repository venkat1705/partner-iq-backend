import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { AdminApiActivityService } from './admin-api-activity.service';

@ApiTags('Platform Admin - API Activity & Observability')
@Controller('api/v1/admin/api-activity')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminApiActivityController {
  constructor(private readonly apiActivityService: AdminApiActivityService) { }

  @Get('overview')
  @ApiOperation({ summary: 'Get API operations overview KPIs and timeline' })
  async getOverview(@Query('period') period?: string) {
    return this.apiActivityService.getOverview(period || '30d');
  }

  @Get('requests')
  @ApiOperation({ summary: 'Query paginated API requests stream' })
  async getRequests(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('method') method?: string,
    @Query('status') status?: string,
    @Query('service') service?: string,
    @Query('env') env?: string
  ) {
    return this.apiActivityService.getRequests({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search,
      method,
      status,
      service,
      env,
    });
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Get comprehensive request detail, timeline, and traces' })
  async getRequestDetail(@Param('id') id: string) {
    return this.apiActivityService.getRequestDetail(id);
  }

  @Get('endpoints')
  @ApiOperation({ summary: 'Get aggregated endpoint performance and error rates' })
  async getEndpoints() {
    return this.apiActivityService.getEndpoints();
  }

  @Get('organizations')
  @ApiOperation({ summary: 'Get API consumption and latency percentiles per organization' })
  async getOrganizations() {
    return this.apiActivityService.getOrganizations();
  }

  @Get('clients')
  @ApiOperation({ summary: 'Get API clients and SDKs activity' })
  async getClients() {
    return this.apiActivityService.getClients();
  }

  @Get('errors')
  @ApiOperation({ summary: 'Get fingerprinted error clusters' })
  async getErrors() {
    return this.apiActivityService.getErrors();
  }

  @Get('performance')
  @ApiOperation({ summary: 'Get latency distribution and slow requests' })
  async getPerformance() {
    return this.apiActivityService.getPerformance();
  }

  @Get('rate-limits')
  @ApiOperation({ summary: 'Get rate limit quotas and violations' })
  async getRateLimits() {
    return this.apiActivityService.getRateLimits();
  }

  @Get('authentication')
  @ApiOperation({ summary: 'Get authentication method breakdown and failure stats' })
  async getAuthentication() {
    return this.apiActivityService.getAuthentication();
  }

  @Get('external')
  @ApiOperation({ summary: 'Get outbound integration API calls' })
  async getExternalCalls() {
    return this.apiActivityService.getExternalCalls();
  }

  @Get('dependencies')
  @ApiOperation({ summary: 'Get dependency map topology and latencies' })
  async getDependencies() {
    return this.apiActivityService.getDependencies();
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get multi-dimensional API usage analytics' })
  async getUsage() {
    return this.apiActivityService.getUsage();
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Get operational threshold alerts' })
  async getAlerts() {
    return this.apiActivityService.getAlerts();
  }

  @Get('security')
  @ApiOperation({ summary: 'Get security-related API events' })
  async getSecurity() {
    return this.apiActivityService.getSecurity();
  }

  @Get('exceptions')
  @ApiOperation({ summary: 'Get API telemetry pipeline exceptions' })
  async getExceptions() {
    return this.apiActivityService.getExceptions();
  }

  @Get('audit')
  @ApiOperation({ summary: 'Get API activity audit records' })
  async getAuditLogs() {
    return this.apiActivityService.getAuditLogs();
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export filtered API telemetry to CSV/JSON with audit' })
  async exportData(
    @Body() body: { format?: string; filter?: any },
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.apiActivityService.exportData(
      { format: body?.format || 'csv', filter: body?.filter },
      { id: user?.userId || 'usr_admin', email: user?.email || 'admin@partneriq.in' }
    );
  }
}

