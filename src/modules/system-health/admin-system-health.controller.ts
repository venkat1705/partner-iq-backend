import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminSystemHealthService } from './admin-system-health.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import type { RequestWithUser } from '../../common/interfaces/request-with-user.interface';
import { IncidentSeverity, IncidentStatus } from '../../database/schema-system-health';

@ApiTags('Admin - System Health & Infrastructure Operations')
@Controller('api/v1/admin/system-health')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminSystemHealthController {
  constructor(private readonly healthService: AdminSystemHealthService) { }

  @Get('global')
  @ApiOperation({ summary: 'Get global system health, overall status, and KPI cards' })
  getGlobalHealth(@Query('environment') environment?: string) {
    return this.healthService.getGlobalHealth(environment || 'production');
  }

  @Post('run-diagnostics')
  @ApiOperation({ summary: 'Execute live health check probes across all components' })
  runDiagnosticProbes() {
    return this.healthService.runDiagnosticProbes();
  }

  @Get('services')
  @ApiOperation({ summary: 'List monitored services registry with status and latencies' })
  getServices(
    @Query('category') category?: string,
    @Query('criticality') criticality?: string
  ) {
    return this.healthService.getServices(category, criticality);
  }

  @Get('services/:id')
  @ApiOperation({ summary: 'Get single service deep-dive workspace' })
  getServiceDetail(@Param('id') id: string) {
    return this.healthService.getServiceDetail(id);
  }

  @Get('infrastructure')
  @ApiOperation({ summary: 'Get deep-dive infrastructure telemetry (DB, Redis, Host, Storage)' })
  getInfrastructureMetrics() {
    return this.healthService.getInfrastructureMetrics();
  }

  @Get('queues')
  @ApiOperation({ summary: 'Get queue depth, worker heartbeats, and scheduler jobs' })
  getQueueAndWorkerMetrics() {
    return this.healthService.getQueueAndWorkerMetrics();
  }

  @Get('dependencies')
  @ApiOperation({ summary: 'Get dependency topology graph and cascade impact matrix' })
  getDependencyTopology() {
    return this.healthService.getDependencyTopology();
  }

  @Get('incidents')
  @ApiOperation({ summary: 'List platform operational incidents' })
  getIncidents(
    @Query('status') status?: string,
    @Query('severity') severity?: string
  ) {
    return this.healthService.getIncidents(status, severity);
  }

  @Post('incidents')
  @ApiOperation({ summary: 'Manually open and log an operational incident' })
  createIncident(
    @Body()
    dto: {
      title: string;
      severity: IncidentSeverity;
      affectedServices: string[];
      impactDescription?: string;
      detectionSource?: string;
    },
    @Req() req: RequestWithUser
  ) {
    const actorEmail = req.user?.email || 'admin@partneriq.in';
    return this.healthService.createIncident(dto, actorEmail);
  }

  @Patch('incidents/:id')
  @ApiOperation({ summary: 'Update incident status, add timeline event, or resolve' })
  updateIncidentStatus(
    @Param('id') id: string,
    @Body()
    dto: {
      status: IncidentStatus;
      message: string;
      rootCause?: string;
      resolution?: string;
    },
    @Req() req: RequestWithUser
  ) {
    const actorEmail = req.user?.email || 'admin@partneriq.in';
    return this.healthService.updateIncidentStatus(id, dto, actorEmail);
  }

  @Get('deployments')
  @ApiOperation({ summary: 'Get deployment history and health correlation data' })
  getDeployments() {
    return this.healthService.getDeployments();
  }

  @Get('maintenance')
  @ApiOperation({ summary: 'Get scheduled and active maintenance windows' })
  getMaintenanceWindows() {
    return this.healthService.getMaintenanceWindows();
  }

  @Post('maintenance')
  @ApiOperation({ summary: 'Schedule a maintenance window' })
  createMaintenanceWindow(
    @Body()
    dto: {
      title: string;
      startAt: string;
      endAt: string;
      affectedServices: string[];
      description?: string;
    },
    @Req() req: RequestWithUser
  ) {
    const actorEmail = req.user?.email || 'admin@partneriq.in';
    return this.healthService.createMaintenanceWindow(dto, actorEmail);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get health check thresholds and SLA policies' })
  getHealthSettings() {
    return this.healthService.getHealthSettings();
  }
}

