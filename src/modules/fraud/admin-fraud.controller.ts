import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { AdminFraudService } from './admin-fraud.service';
import {
  CreateFraudRuleDto,
  UpdateFraudRuleDto,
  TestRuleSimulationDto,
  CreateInvestigationDto,
  ResolveInvestigationDto,
  CreateFraudHoldDto,
} from './admin-fraud.dto';

@ApiTags('Platform Admin - Fraud Intelligence')
@Controller('api/v1/admin/fraud')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminFraudController {
  constructor(private readonly adminFraudService: AdminFraudService) { }

  @Get('overview')
  @ApiOperation({ summary: 'Get flagship Bento KPI overview and risk timeline' })
  getOverview(@Query('period') period?: string) {
    return this.adminFraudService.getOverview(period);
  }

  // Alerts
  @Get('alerts')
  @ApiOperation({ summary: 'List filterable fraud alerts' })
  getAlerts(@Query() query?: any) {
    return this.adminFraudService.getAlerts(query);
  }

  @Get('alerts/:id')
  @ApiOperation({ summary: 'Get fraud alert details with explainable evidence' })
  getAlertById(@Param('id') id: string) {
    return this.adminFraudService.getAlertById(id);
  }

  @Post('alerts/:id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign alert to an investigator or analyst' })
  assignAlert(
    @Param('id') id: string,
    @Body('assignedTo') assignedTo: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.adminFraudService.assignAlert(id, assignedTo, user.email || user.userId);
  }

  @Post('alerts/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge an open fraud alert' })
  acknowledgeAlert(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.adminFraudService.acknowledgeAlert(id, user.email || user.userId);
  }

  @Post('alerts/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve or dismiss a fraud alert' })
  resolveAlert(
    @Param('id') id: string,
    @Body('status') status: 'RESOLVED' | 'DISMISSED',
    @Body('notes') notes: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.adminFraudService.resolveAlert(id, status, notes, user.email || user.userId);
  }

  @Post('alerts/:id/investigate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an investigation case directly from an alert' })
  createInvestigationFromAlert(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.adminFraudService.createInvestigationFromAlert(id, user.email || user.userId);
  }

  // Investigations
  @Get('investigations')
  @ApiOperation({ summary: 'List investigation cases' })
  getInvestigations(@Query() query?: any) {
    return this.adminFraudService.getInvestigations(query);
  }

  @Get('investigations/:id')
  @ApiOperation({ summary: 'Get investigation case file with timeline and evidence graph' })
  getInvestigationById(@Param('id') id: string) {
    return this.adminFraudService.getInvestigationById(id);
  }

  @Post('investigations/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition investigation case lifecycle status' })
  updateInvestigationStatus(
    @Param('id') id: string,
    @Body('status') status: any,
    @Body('note') note: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.adminFraudService.updateInvestigationStatus(id, status, note, user.email || user.userId);
  }

  @Post('investigations/:id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign case investigator' })
  assignInvestigation(
    @Param('id') id: string,
    @Body('assignedTo') assignedTo: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.adminFraudService.assignInvestigation(id, assignedTo, user.email || user.userId);
  }

  @Post('investigations/:id/notes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Append internal investigation note' })
  addInvestigationNote(
    @Param('id') id: string,
    @Body('text') text: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.adminFraudService.addInvestigationNote(id, text, user.email || user.userId);
  }

  @Post('investigations/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve investigation with formal outcome and action' })
  resolveInvestigation(
    @Param('id') id: string,
    @Body() dto: ResolveInvestigationDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.adminFraudService.resolveInvestigation(
      id,
      dto,
      user.email || user.userId,
    );
  }

  // Rules Engine
  @Get('rules')
  @ApiOperation({ summary: 'List fraud detection rules and versioning' })
  getRules() {
    return this.adminFraudService.getRules();
  }

  @Get('rules/:id')
  @ApiOperation({ summary: 'Get rule detail and version history' })
  getRuleById(@Param('id') id: string) {
    return this.adminFraudService.getRuleById(id);
  }

  @Post('rules')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new fraud rule with visual builder configuration' })
  createRule(@Body() dto: CreateFraudRuleDto, @CurrentUser() user: AuthUserPayload) {
    return this.adminFraudService.createRule(dto, user.email || user.userId);
  }

  @Put('rules/:id')
  @ApiOperation({ summary: 'Update fraud rule with immutable version record' })
  updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateFraudRuleDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.adminFraudService.updateRule(id, dto, user.email || user.userId);
  }

  @Post('rules/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle rule status between ACTIVE, DISABLED, and DRY_RUN' })
  toggleRuleStatus(
    @Param('id') id: string,
    @Body('status') status: 'ACTIVE' | 'DISABLED' | 'DRY_RUN',
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.adminFraudService.toggleRuleStatus(id, status, user.email || user.userId);
  }

  @Post('rules/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Simulate rule against historical data safely with zero mutations' })
  testRuleSimulation(@Body() dto: TestRuleSimulationDto) {
    return this.adminFraudService.testRuleSimulation(dto);
  }

  // Signals
  @Get('signals')
  @ApiOperation({ summary: 'Stream explainable risk signals' })
  getSignals(@Query() query?: any) {
    return this.adminFraudService.getSignals(query);
  }

  // Holds
  @Get('holds')
  @ApiOperation({ summary: 'List active and historical conversion, commission, payout holds' })
  getHolds(@Query() query?: any) {
    return this.adminFraudService.getHolds(query);
  }

  @Post('holds')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Place a protective financial hold' })
  placeHold(@Body() dto: CreateFraudHoldDto, @CurrentUser() user: AuthUserPayload) {
    return this.adminFraudService.placeHold(dto, user.email || user.userId);
  }

  @Post('holds/:id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release financial hold with explicit audit confirmation' })
  releaseHold(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.adminFraudService.releaseHold(id, reason, user.email || user.userId);
  }

  // Patterns & Telemetry
  @Get('patterns')
  @ApiOperation({ summary: 'Get behavioral cluster patterns' })
  getPatterns() {
    return this.adminFraudService.getPatterns();
  }

  @Get('device-network')
  @ApiOperation({ summary: 'Get privacy-masked device fingerprints and IP patterns' })
  getDeviceNetwork() {
    return this.adminFraudService.getDeviceNetwork();
  }

  @Get('exceptions')
  @ApiOperation({ summary: 'Get risk engine operational exceptions' })
  getExceptions() {
    return this.adminFraudService.getExceptions();
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Get chronological audit logs for all fraud operations' })
  getAuditLogs() {
    return this.adminFraudService.getAuditLogs();
  }
}

