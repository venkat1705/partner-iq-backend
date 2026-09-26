import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { AdminSecurityService } from './admin-security.service';
import {
  CreateSecurityRuleDto,
  UpdateSecurityRuleDto,
  TestRuleSimulationDto,
  CreateInvestigationDto,
  ResolveInvestigationDto,
  CreateIncidentDto,
  ResolveIncidentDto,
  RevokeSessionDto,
  RevokeAllUserSessionsDto,
  ExportSecurityQueryDto,
} from './admin-security.dto';

@ApiTags('Platform Admin - Security Operations')
@Controller('api/v1/admin/security')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminSecurityController {
  constructor(private readonly securityService: AdminSecurityService) { }

  @Get('overview')
  @ApiOperation({ summary: 'Get flagship Bento KPI overview and security timeline' })
  getOverview(@Query('period') period?: string) {
    return this.securityService.getOverview(period);
  }

  // ─────────────────────────────────────────
  // Security Events
  // ─────────────────────────────────────────
  @Get('events')
  @ApiOperation({ summary: 'List filterable security events' })
  getEvents(@Query() query?: any) {
    return this.securityService.getEvents(query);
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'Get full security event details with actor and network intelligence' })
  getEventById(@Param('id') id: string) {
    return this.securityService.getEventById(id);
  }

  // ─────────────────────────────────────────
  // Security Alerts
  // ─────────────────────────────────────────
  @Get('alerts')
  @ApiOperation({ summary: 'List security alerts' })
  getAlerts(@Query() query?: any) {
    return this.securityService.getAlerts(query);
  }

  @Get('alerts/:id')
  @ApiOperation({ summary: 'Get security alert detail with explainable evidence' })
  getAlertById(@Param('id') id: string) {
    return this.securityService.getAlertById(id);
  }

  @Post('alerts/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge an open security alert' })
  acknowledgeAlert(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.securityService.acknowledgeAlert(id, user.email || user.userId);
  }

  @Post('alerts/:id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign alert to an investigator or security engineer' })
  assignAlert(
    @Param('id') id: string,
    @Body('assignedTo') assignedTo: string,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.securityService.assignAlert(id, assignedTo, user.email || user.userId);
  }

  @Post('alerts/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a security alert with reason' })
  resolveAlert(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.securityService.resolveAlert(id, reason, user.email || user.userId);
  }

  // ─────────────────────────────────────────
  // Security Investigations
  // ─────────────────────────────────────────
  @Get('investigations')
  @ApiOperation({ summary: 'List security investigation cases' })
  getInvestigations(@Query() query?: any) {
    return this.securityService.getInvestigations(query);
  }

  @Get('investigations/:id')
  @ApiOperation({ summary: 'Get investigation case details, evidence, notes, and actions' })
  getInvestigationById(@Param('id') id: string) {
    return this.securityService.getInvestigationById(id);
  }

  @Post('investigations')
  @ApiOperation({ summary: 'Open a formal security investigation case' })
  createInvestigation(@Body() dto: CreateInvestigationDto, @CurrentUser() user: AuthUserPayload) {
    return this.securityService.createInvestigation(dto, user.email || user.userId);
  }

  @Patch('investigations/:id/status')
  @ApiOperation({ summary: 'Update investigation case status' })
  updateInvestigationStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.securityService.updateInvestigationStatus(id, status, user.email || user.userId);
  }

  @Post('investigations/:id/notes')
  @ApiOperation({ summary: 'Add note or observation to an investigation' })
  addInvestigationNote(
    @Param('id') id: string,
    @Body('text') text: string,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.securityService.addInvestigationNote(id, text, user.email || user.userId);
  }

  @Post('investigations/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve an investigation case with formal outcome' })
  resolveInvestigation(
    @Param('id') id: string,
    @Body() dto: ResolveInvestigationDto,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.securityService.resolveInvestigation(id, dto, user.email || user.userId);
  }

  // ─────────────────────────────────────────
  // Security Incidents
  // ─────────────────────────────────────────
  @Get('incidents')
  @ApiOperation({ summary: 'List high-level security incidents' })
  getIncidents(@Query() query?: any) {
    return this.securityService.getIncidents(query);
  }

  @Get('incidents/:id')
  @ApiOperation({ summary: 'Get incident details' })
  getIncidentById(@Param('id') id: string) {
    return this.securityService.getIncidentById(id);
  }

  @Post('incidents')
  @ApiOperation({ summary: 'Create a security incident' })
  createIncident(@Body() dto: CreateIncidentDto, @CurrentUser() user: AuthUserPayload) {
    return this.securityService.createIncident(dto, user.email || user.userId);
  }

  @Post('incidents/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve an incident' })
  resolveIncident(
    @Param('id') id: string,
    @Body() dto: ResolveIncidentDto,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.securityService.resolveIncident(id, dto, user.email || user.userId);
  }

  // ─────────────────────────────────────────
  // Authentication & Sessions
  // ─────────────────────────────────────────
  @Get('authentication')
  @ApiOperation({ summary: 'Get authentication security telemetry, failure rates, and anomalies' })
  getAuthenticationSummary() {
    return this.securityService.getAuthenticationSummary();
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List active and historic user sessions with IP and device context' })
  getSessions(@Query() query?: any) {
    return this.securityService.getSessions(query);
  }

  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an active user session with required reason and audit log' })
  revokeSession(
    @Param('id') id: string,
    @Body() dto: RevokeSessionDto,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.securityService.revokeSession(id, dto.reason, user.email || user.userId);
  }

  @Post('sessions/revoke-user-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke all sessions for a user with required reason and audit log' })
  revokeAllUserSessions(@Body() dto: RevokeAllUserSessionsDto, @CurrentUser() user: AuthUserPayload) {
    return this.securityService.revokeAllUserSessions(dto.userId, dto.reason, user.email || user.userId);
  }

  // ─────────────────────────────────────────
  // Access, API, Integrations, Secrets
  // ─────────────────────────────────────────
  @Get('access')
  @ApiOperation({ summary: 'List authorization events, permission changes, and cross-tenant blocks' })
  getAccessEvents(@Query() query?: any) {
    return this.securityService.getAccessEvents(query);
  }

  @Get('api')
  @ApiOperation({ summary: 'List API security activity, rate limits, and authentication errors' })
  getApiSecurityEvents(@Query() query?: any) {
    return this.securityService.getApiSecurityEvents(query);
  }

  @Get('integrations')
  @ApiOperation({ summary: 'List webhook security validations and third-party integration events' })
  getIntegrationSecurityEvents(@Query() query?: any) {
    return this.securityService.getIntegrationSecurityEvents(query);
  }

  @Get('secrets')
  @ApiOperation({ summary: 'List credential metadata with zero plaintext secrets' })
  getSecretsMetadata(@Query() query?: any) {
    return this.securityService.getSecretsMetadata(query);
  }

  @Post('secrets/:id/rotate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate credential prefix with audit logging' })
  rotateSecret(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.securityService.rotateSecret(id, reason || 'Manual rotation requested', user.email || user.userId);
  }

  @Post('secrets/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke credential' })
  revokeSecret(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.securityService.revokeSecret(id, reason || 'Manual revocation', user.email || user.userId);
  }

  @Get('policies')
  @ApiOperation({ summary: 'Get platform security policies' })
  getPolicies() {
    return this.securityService.getPolicies();
  }

  // ─────────────────────────────────────────
  // Detection Rules & Simulation
  // ─────────────────────────────────────────
  @Get('rules')
  @ApiOperation({ summary: 'List security detection rules' })
  getRules() {
    return this.securityService.getRules();
  }

  @Post('rules')
  @ApiOperation({ summary: 'Create a security detection rule with versioning' })
  createRule(@Body() dto: CreateSecurityRuleDto, @CurrentUser() user: AuthUserPayload) {
    return this.securityService.createRule(dto, user.email || user.userId);
  }

  @Put('rules/:id')
  @ApiOperation({ summary: 'Update a security detection rule and increment version' })
  updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateSecurityRuleDto,
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.securityService.updateRule(id, dto, user.email || user.userId);
  }

  @Post('rules/:id/toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle rule status between ACTIVE, DISABLED, and DRY_RUN' })
  toggleRuleStatus(
    @Param('id') id: string,
    @Body('status') status: 'ACTIVE' | 'DISABLED' | 'DRY_RUN',
    @CurrentUser() user: AuthUserPayload
  ) {
    return this.securityService.toggleRuleStatus(id, status, user.email || user.userId);
  }

  @Post('rules/simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test detection rule against historical events with 0 mutations' })
  simulateRule(@Body() dto: TestRuleSimulationDto) {
    return this.securityService.simulateRule(dto);
  }

  // ─────────────────────────────────────────
  // Exceptions & Export
  // ─────────────────────────────────────────
  @Get('exceptions')
  @ApiOperation({ summary: 'List security pipeline exceptions' })
  getExceptions() {
    return this.securityService.getExceptions();
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate server-side CSV export with audit logging' })
  exportSecurityData(@Body() dto: ExportSecurityQueryDto, @CurrentUser() user: AuthUserPayload) {
    return this.securityService.exportSecurityData(dto, user.email || user.userId);
  }

  @Get('audit')
  @ApiOperation({ summary: 'List immutable security operations audit trail' })
  getAuditLogs() {
    return this.securityService.getAuditLogs();
  }
}

