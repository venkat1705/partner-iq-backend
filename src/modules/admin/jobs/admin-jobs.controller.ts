import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminJobsService, JobsFilterQuery } from './admin-jobs.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../../common/guards/platform-admin.guard';

@ApiTags('Admin - Jobs & Queues Operations Center')
@Controller('api/v1/admin/jobs')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminJobsController {
  constructor(private readonly jobsService: AdminJobsService) { }

  @Get('overview')
  @ApiOperation({ summary: 'Get global jobs and queues overview with live stream and KPIs' })
  getOverview(@Query('timeframe') timeframe?: string) {
    return this.jobsService.getOverview(timeframe || '24h');
  }

  @Get('list')
  @ApiOperation({ summary: 'Get filterable paginated background jobs' })
  getJobs(@Query() query: JobsFilterQuery) {
    return this.jobsService.getJobs(query);
  }

  @Get('detail/:id')
  @ApiOperation({ summary: 'Get deep inspection details and attempts for a specific job' })
  getJobDetail(@Param('id') id: string) {
    return this.jobsService.getJobDetail(id);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed or delayed job' })
  retryJob(@Param('id') id: string) {
    return this.jobsService.retryJob(id);
  }

  @Post('bulk-retry')
  @ApiOperation({ summary: 'Retry multiple jobs simultaneously' })
  bulkRetryJobs(@Body() body: { ids: string[] }) {
    return this.jobsService.bulkRetryJobs(body.ids || []);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an active or waiting job' })
  cancelJob(@Param('id') id: string) {
    return this.jobsService.cancelJob(id);
  }

  @Get('queues')
  @ApiOperation({ summary: 'Get list of queues with counts and status' })
  getQueues() {
    return this.jobsService.getQueues();
  }

  @Post('queues/:name/pause')
  @ApiOperation({ summary: 'Pause a queue' })
  pauseQueue(@Param('name') name: string) {
    return this.jobsService.pauseQueue(name);
  }

  @Post('queues/:name/resume')
  @ApiOperation({ summary: 'Resume a paused queue' })
  resumeQueue(@Param('name') name: string) {
    return this.jobsService.resumeQueue(name);
  }

  @Post('queues/:name/drain')
  @ApiOperation({ summary: 'Drain jobs of a specific state from a queue' })
  drainQueue(
    @Param('name') name: string,
    @Body() body: { state: 'WAITING' | 'FAILED' | 'DELAYED' }
  ) {
    return this.jobsService.drainQueue(name, body.state || 'WAITING');
  }

  @Patch('queues/:name/concurrency')
  @ApiOperation({ summary: 'Update concurrency limit for a queue' })
  updateQueueConcurrency(
    @Param('name') name: string,
    @Body() body: { concurrency: number }
  ) {
    return this.jobsService.updateQueueConcurrency(name, body.concurrency);
  }

  @Get('workers')
  @ApiOperation({ summary: 'Get active worker daemons and utilization' })
  getWorkers() {
    return this.jobsService.getWorkers();
  }

  @Post('workers/:id/ping')
  @ApiOperation({ summary: 'Ping a worker daemon' })
  pingWorker(@Param('id') id: string) {
    return this.jobsService.pingWorker(id);
  }

  @Post('workers/:id/restart')
  @ApiOperation({ summary: 'Signal a worker daemon to restart' })
  restartWorker(@Param('id') id: string) {
    return this.jobsService.restartWorker(id);
  }

  @Get('failed')
  @ApiOperation({ summary: 'Get failed jobs and failure analysis' })
  getFailedJobs() {
    return this.jobsService.getFailedJobs();
  }

  @Get('retries')
  @ApiOperation({ summary: 'Get retrying and delayed jobs' })
  getRetries() {
    return this.jobsService.getRetries();
  }

  @Post('retries/:id/force')
  @ApiOperation({ summary: 'Force immediate execution of a delayed retry' })
  forceRetry(@Param('id') id: string) {
    return this.jobsService.forceRetry(id);
  }

  @Get('scheduled')
  @ApiOperation({ summary: 'Get recurring scheduled cron jobs' })
  getScheduledJobs() {
    return this.jobsService.getScheduledJobs();
  }

  @Post('scheduled/:id/trigger')
  @ApiOperation({ summary: 'Manually trigger a scheduled job now' })
  triggerScheduledJob(@Param('id') id: string) {
    return this.jobsService.triggerScheduledJob(id);
  }

  @Post('scheduled/:id/toggle')
  @ApiOperation({ summary: 'Enable or disable a scheduled cron job' })
  toggleScheduledJob(@Param('id') id: string) {
    return this.jobsService.toggleScheduledJob(id);
  }

  @Get('dead-letter')
  @ApiOperation({ summary: 'Get dead letter queue records' })
  getDeadLetterRecords() {
    return this.jobsService.getDeadLetterRecords();
  }

  @Post('dead-letter/:id/replay')
  @ApiOperation({ summary: 'Replay a dead-lettered job to source queue' })
  replayDlqJob(
    @Param('id') id: string,
    @Body() body: { modifiedPayload?: any }
  ) {
    return this.jobsService.replayDlqJob(id, body?.modifiedPayload);
  }

  @Post('dead-letter/:id/discard')
  @ApiOperation({ summary: 'Permanently discard a dead letter record' })
  discardDlqJob(@Param('id') id: string) {
    return this.jobsService.discardDlqJob(id);
  }

  @Get('performance')
  @ApiOperation({ summary: 'Get queue performance and latency percentiles' })
  getPerformanceMetrics() {
    return this.jobsService.getPerformanceMetrics();
  }

  @Get('exceptions')
  @ApiOperation({ summary: 'Get detected anomalies and exceptions' })
  getExceptions() {
    return this.jobsService.getExceptions();
  }

  @Post('exceptions/:id/resolve')
  @ApiOperation({ summary: 'Resolve an operational exception' })
  resolveException(
    @Param('id') id: string,
    @Body() body: { notes?: string }
  ) {
    return this.jobsService.resolveException(id, body?.notes);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get job engine configuration and SLA targets' })
  getSettings() {
    return this.jobsService.getSettings();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update job engine settings' })
  updateSettings(@Body() body: any) {
    return this.jobsService.updateSettings(body);
  }
}

