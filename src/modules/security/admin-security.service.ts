import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  dbStore,
  SecurityEventEntity,
  SecuritySignalEntity,
  SecurityAlertEntity,
  SecurityInvestigationEntity,
  SecurityIncidentEntity,
  SecurityRuleEntity,
  SecurityRuleVersionEntity,
  SecurityActionEntity,
  SecurityExceptionEntity,
} from '../../database/store';
import { AuditAction } from '../../common/enums';
import {
  CreateSecurityRuleDto,
  UpdateSecurityRuleDto,
  TestRuleSimulationDto,
  CreateInvestigationDto,
  ResolveInvestigationDto,
  CreateIncidentDto,
  ResolveIncidentDto,
  ExportSecurityQueryDto,
} from './admin-security.dto';

@Injectable()
export class AdminSecurityService {
  private readonly logger = new Logger(AdminSecurityService.name);

  constructor() {
    this.ensureSeedData();
  }

  // =========================================================================
  // 1. OVERVIEW & BENTO KPIS
  // =========================================================================
  async getOverview(period = '30d') {
    this.ensureSeedData();
    const events = dbStore.securityEvents;
    const alerts = dbStore.securityAlerts;
    const investigations = dbStore.securityInvestigations;
    const incidents = dbStore.securityIncidents;
    const sessions = dbStore.authSessions;
    const apiKeys = dbStore.apiKeys;
    const rules = dbStore.securityRules;

    const days = period === '24h' ? 1 : period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const prevCutoff = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000);

    const currentPeriodEvents = events.filter((e) => new Date(e.occurredAt) >= cutoff);
    const previousPeriodEvents = events.filter((e) => new Date(e.occurredAt) >= prevCutoff && new Date(e.occurredAt) < cutoff);

    const totalEvents = currentPeriodEvents.length;
    const prevTotalEvents = previousPeriodEvents.length;
    const eventDiffPercent = prevTotalEvents > 0 ? Math.round(((totalEvents - prevTotalEvents) / prevTotalEvents) * 100) : 0;

    const failedAuth = currentPeriodEvents.filter(
      (e) => (e.category === 'AUTHENTICATION' || e.eventType.includes('LOGIN')) && (e.result === 'FAILED' || e.result === 'BLOCKED')
    ).length;

    const accessDenials = currentPeriodEvents.filter(
      (e) => e.category === 'AUTHORIZATION' && (e.result === 'DENIED' || e.result === 'BLOCKED')
    ).length;

    const apiSecurityEvents = currentPeriodEvents.filter((e) => e.category === 'API').length;
    const integrationEvents = currentPeriodEvents.filter((e) => e.category === 'INTEGRATION' || e.category === 'WEBHOOK').length;
    const suspiciousEvents = currentPeriodEvents.filter((e) => e.severity === 'HIGH' || e.severity === 'CRITICAL').length;

    const openAlerts = alerts.filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED' || a.status === 'INVESTIGATING');
    const criticalAlerts = openAlerts.filter((a) => a.severity === 'CRITICAL');
    const highAlerts = openAlerts.filter((a) => a.severity === 'HIGH');

    const openInvestigations = investigations.filter(
      (i) => i.status === 'OPEN' || i.status === 'INVESTIGATING' || i.status === 'ACTION_REQUIRED'
    );

    const activeIncidents = incidents.filter(
      (inc) => inc.status === 'OPEN' || inc.status === 'CONTAINING' || inc.status === 'INVESTIGATING' || inc.status === 'REMEDIATING'
    );

    const activeSessions = sessions.filter((s) => !s.revokedAt && new Date(s.expiresAt) > new Date()).length;

    // Security Posture Metrics
    const totalUsers = dbStore.users.length;
    const mfaUsers = dbStore.users.filter((u) => (u as any).mfaEnabled || (u as any).twoFactorEnabled).length;
    const mfaCoveragePercent = totalUsers > 0 ? Math.round((mfaUsers / totalUsers) * 100) : 0;

    const now = Date.now();
    const expiredApiKeys = apiKeys.filter((k) => k.expiresAt && new Date(k.expiresAt).getTime() < now).length;
    const keysNeedingRotation = apiKeys.filter((k) => {
      const createdTime = new Date(k.createdAt).getTime();
      return now - createdTime > 90 * 24 * 60 * 60 * 1000 && !k.revokedAt;
    }).length;

    const failedWebhooks = dbStore.webhookDeliveries.filter((d) => d.responseCode >= 400).length;

    // Timeline Aggregation
    const timeline = this.generateTimeline(days, events);

    // Attention Alerts (top critical or high)
    const attentionAlerts = openAlerts
      .sort((a, b) => (b.severity === 'CRITICAL' ? 1 : 0) - (a.severity === 'CRITICAL' ? 1 : 0))
      .slice(0, 5);

    // Recent Critical Security Activity
    const recentActivity = [
      ...alerts.slice(-6).map((a) => ({
        id: a.id,
        type: 'ALERT' as const,
        title: a.title,
        severity: a.severity,
        timestamp: a.createdAt,
        reference: a.alertNumber,
        status: a.status,
      })),
      ...investigations.slice(-4).map((i) => ({
        id: i.id,
        type: 'INVESTIGATION' as const,
        title: i.title,
        severity: i.severity,
        timestamp: i.openedAt,
        reference: i.caseNumber,
        status: i.status,
      })),
      ...incidents.slice(-3).map((inc) => ({
        id: inc.id,
        type: 'INCIDENT' as const,
        title: inc.title,
        severity: inc.severity,
        timestamp: inc.openedAt,
        reference: inc.incidentNumber,
        status: inc.status,
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Category distribution
    const categoryMap = new Map<string, number>();
    for (const e of currentPeriodEvents) {
      categoryMap.set(e.category, (categoryMap.get(e.category) || 0) + 1);
    }
    const categoryDistribution = Array.from(categoryMap.entries()).map(([category, count]) => ({
      category,
      count,
      pct: totalEvents > 0 ? Math.round((count / totalEvents) * 100) : 0,
    }));

    // Severity distribution
    const severityMap = new Map<string, number>();
    for (const e of currentPeriodEvents) {
      severityMap.set(e.severity, (severityMap.get(e.severity) || 0) + 1);
    }
    const severityDistribution = Array.from(severityMap.entries()).map(([severity, count]) => ({
      severity,
      count,
      pct: totalEvents > 0 ? Math.round((count / totalEvents) * 100) : 0,
    }));

    return {
      kpis: {
        totalEvents,
        totalEventsDiffPercent: eventDiffPercent,
        failedAuth,
        accessDenials,
        suspiciousEvents,
        openAlertsCount: openAlerts.length,
        criticalAlertsCount: criticalAlerts.length,
        highAlertsCount: highAlerts.length,
        openInvestigationsCount: openInvestigations.length,
        activeIncidentsCount: activeIncidents.length,
        activeSessionsCount: activeSessions,
        apiSecurityEventsCount: apiSecurityEvents,
        integrationEventsCount: integrationEvents,
      },
      posture: {
        mfaCoveragePercent,
        keysNeedingRotation,
        expiredApiKeys,
        failedWebhooks,
        activeDetectionRulesCount: rules.filter((r) => r.status === 'ACTIVE').length,
        unresolvedExceptionsCount: dbStore.securityExceptions.filter((e) => e.retryState !== 'RESOLVED').length,
        postureScore: Math.max(20, Math.min(99, Math.round((mfaCoveragePercent * 0.4) + ((1 - (criticalAlerts.length / Math.max(1, openAlerts.length + 1))) * 30) + ((1 - Math.min(1, failedAuth / Math.max(1, totalEvents))) * 30)))),
      },
      timeline,
      categoryDistribution,
      severityDistribution,
      attentionAlerts,
      recentActivity,
    };
  }

  // =========================================================================
  // 2. SECURITY EVENTS
  // =========================================================================
  async getEvents(query: any = {}) {
    this.ensureSeedData();
    let events = [...dbStore.securityEvents];

    if (query.category && query.category !== 'ALL') {
      events = events.filter((e) => e.category === query.category);
    }
    if (query.severity && query.severity !== 'ALL') {
      events = events.filter((e) => e.severity === query.severity);
    }
    if (query.result && query.result !== 'ALL') {
      events = events.filter((e) => e.result === query.result);
    }
    if (query.actorType && query.actorType !== 'ALL') {
      events = events.filter((e) => e.actorType === query.actorType);
    }
    if (query.organizationId && query.organizationId !== 'ALL') {
      events = events.filter((e) => e.organizationId === query.organizationId);
    }
    if (query.search) {
      const s = query.search.toLowerCase();
      events = events.filter(
        (e) =>
          e.eventNumber.toLowerCase().includes(s) ||
          e.eventType.toLowerCase().includes(s) ||
          (e.actorEmail && e.actorEmail.toLowerCase().includes(s)) ||
          e.actorId.toLowerCase().includes(s) ||
          (e.organizationName && e.organizationName.toLowerCase().includes(s)) ||
          (e.ipAddress && e.ipAddress.toLowerCase().includes(s)) ||
          (e.correlationId && e.correlationId.toLowerCase().includes(s)) ||
          (e.resourceType && e.resourceType.toLowerCase().includes(s))
      );
    }

    events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const total = events.length;
    const paginated = events.slice((page - 1) * limit, page * limit);

    return {
      items: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getEventById(id: string) {
    this.ensureSeedData();
    const event = dbStore.securityEvents.find((e) => e.id === id || e.eventNumber === id);
    if (!event) throw new NotFoundException(`Security event ${id} not found`);

    // Actor context
    const actorUser = dbStore.users.find((u) => u.id === event.actorId || u.email === event.actorEmail);
    const actorOrg = event.organizationId ? dbStore.organizations.find((o) => o.id === event.organizationId) : null;
    const actorSessions = actorUser ? dbStore.authSessions.filter((s) => s.userId === actorUser.id) : [];

    // Related events (sharing correlationId or same actor in last 24h)
    const relatedEvents = dbStore.securityEvents
      .filter((e) => e.id !== event.id && (e.correlationId === event.correlationId || e.actorId === event.actorId))
      .slice(0, 10);

    // Related signals
    const signals = dbStore.securitySignals.filter((s) => s.eventId === event.id || s.actorId === event.actorId);

    // Related alerts
    const alerts = dbStore.securityAlerts.filter(
      (a) => a.actorId === event.actorId || (event.organizationId && a.organizationId === event.organizationId)
    );

    return {
      ...event,
      actorIntelligence: {
        actorId: event.actorId,
        actorType: event.actorType,
        email: actorUser?.email || event.actorEmail || 'unknown',
        role: actorUser?.platformRole || 'ORG_MEMBER',
        mfaEnabled: Boolean((actorUser as any)?.mfaEnabled || (actorUser as any)?.twoFactorEnabled),
        accountStatus: actorUser?.status || 'ACTIVE',
        totalSessions: actorSessions.length,
        activeSessions: actorSessions.filter((s) => !s.revokedAt && new Date(s.expiresAt) > new Date()).length,
      },
      organization: actorOrg ? { id: actorOrg.id, name: actorOrg.name, status: actorOrg.status } : null,
      relatedEvents,
      signals,
      alerts,
    };
  }

  // =========================================================================
  // 3. SECURITY ALERTS
  // =========================================================================
  async getAlerts(query: any = {}) {
    this.ensureSeedData();
    let alerts = [...dbStore.securityAlerts];

    if (query.status && query.status !== 'ALL') {
      alerts = alerts.filter((a) => a.status === query.status);
    }
    if (query.severity && query.severity !== 'ALL') {
      alerts = alerts.filter((a) => a.severity === query.severity);
    }
    if (query.search) {
      const s = query.search.toLowerCase();
      alerts = alerts.filter(
        (a) =>
          a.alertNumber.toLowerCase().includes(s) ||
          a.title.toLowerCase().includes(s) ||
          (a.ruleName && a.ruleName.toLowerCase().includes(s)) ||
          (a.actorEmail && a.actorEmail.toLowerCase().includes(s)) ||
          (a.organizationName && a.organizationName.toLowerCase().includes(s))
      );
    }

    alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const total = alerts.length;

    return {
      items: alerts.slice((page - 1) * limit, page * limit),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getAlertById(id: string) {
    this.ensureSeedData();
    const alert = dbStore.securityAlerts.find((a) => a.id === id || a.alertNumber === id);
    if (!alert) throw new NotFoundException(`Alert ${id} not found`);

    const relatedEvents = dbStore.securityEvents
      .filter((e) => e.actorId === alert.actorId || (alert.organizationId && e.organizationId === alert.organizationId))
      .slice(0, 10);

    const relatedInvestigation = alert.id
      ? dbStore.securityInvestigations.find((i) => i.alertId === alert.id)
      : null;

    return {
      ...alert,
      relatedEvents,
      relatedInvestigation,
    };
  }

  async acknowledgeAlert(id: string, actor: string) {
    this.ensureSeedData();
    const alert = dbStore.securityAlerts.find((a) => a.id === id || a.alertNumber === id);
    if (!alert) throw new NotFoundException(`Alert ${id} not found`);

    const beforeState = { status: alert.status };
    alert.status = 'ACKNOWLEDGED';
    alert.acknowledgedAt = new Date();
    alert.updatedAt = new Date();

    this.recordSecurityAction('ACKNOWLEDGE_ALERT', actor, 'ALERT', alert.id, beforeState, { status: alert.status }, 'Alert acknowledged by analyst');
    this.writeAuditLog(actor, AuditAction.SECURITY_ALERT_ACKNOWLEDGED, 'SecurityAlert', alert.id, { alertNumber: alert.alertNumber, action: 'ACKNOWLEDGED' });

    return alert;
  }

  async assignAlert(id: string, assignedTo: string, actor: string) {
    this.ensureSeedData();
    const alert = dbStore.securityAlerts.find((a) => a.id === id || a.alertNumber === id);
    if (!alert) throw new NotFoundException(`Alert ${id} not found`);

    const beforeState = { assignedTo: alert.assignedTo };
    alert.assignedTo = assignedTo;
    alert.status = alert.status === 'OPEN' ? 'INVESTIGATING' : alert.status;
    alert.updatedAt = new Date();

    this.recordSecurityAction('ASSIGN_ALERT', actor, 'ALERT', alert.id, beforeState, { assignedTo }, `Assigned alert to ${assignedTo}`);
    this.writeAuditLog(actor, AuditAction.SECURITY_ALERT_ASSIGNED, 'SecurityAlert', alert.id, { alertNumber: alert.alertNumber, assignedTo });

    return alert;
  }

  async resolveAlert(id: string, reason: string, actor: string) {
    this.ensureSeedData();
    const alert = dbStore.securityAlerts.find((a) => a.id === id || a.alertNumber === id);
    if (!alert) throw new NotFoundException(`Alert ${id} not found`);

    const beforeState = { status: alert.status };
    alert.status = 'RESOLVED';
    alert.resolvedAt = new Date();
    alert.resolvedBy = actor;
    alert.resolutionReason = reason;
    alert.updatedAt = new Date();

    this.recordSecurityAction('RESOLVE_ALERT', actor, 'ALERT', alert.id, beforeState, { status: alert.status }, reason);
    this.writeAuditLog(actor, AuditAction.SECURITY_ALERT_RESOLVED, 'SecurityAlert', alert.id, { alertNumber: alert.alertNumber, reason });

    return alert;
  }

  // =========================================================================
  // 4. SECURITY INVESTIGATIONS
  // =========================================================================
  async getInvestigations(query: any = {}) {
    this.ensureSeedData();
    let cases = [...dbStore.securityInvestigations];

    if (query.status && query.status !== 'ALL') {
      cases = cases.filter((c) => c.status === query.status);
    }
    if (query.severity && query.severity !== 'ALL') {
      cases = cases.filter((c) => c.severity === query.severity);
    }
    if (query.search) {
      const s = query.search.toLowerCase();
      cases = cases.filter(
        (c) =>
          c.caseNumber.toLowerCase().includes(s) ||
          c.title.toLowerCase().includes(s) ||
          (c.assignedTo && c.assignedTo.toLowerCase().includes(s)) ||
          (c.organizationName && c.organizationName.toLowerCase().includes(s))
      );
    }

    cases.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const total = cases.length;

    return {
      items: cases.slice((page - 1) * limit, page * limit),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getInvestigationById(id: string) {
    this.ensureSeedData();
    const inv = dbStore.securityInvestigations.find((c) => c.id === id || c.caseNumber === id);
    if (!inv) throw new NotFoundException(`Investigation ${id} not found`);

    const relatedAlert = inv.alertId ? dbStore.securityAlerts.find((a) => a.id === inv.alertId) : null;
    const relatedEvents = dbStore.securityEvents
      .filter((e) => e.actorId === inv.actorId || (inv.organizationId && e.organizationId === inv.organizationId))
      .slice(0, 15);

    return {
      ...inv,
      relatedAlert,
      relatedEvents,
    };
  }

  async createInvestigation(dto: CreateInvestigationDto, actor: string) {
    this.ensureSeedData();
    const org = dto.organizationId ? dbStore.organizations.find((o) => o.id === dto.organizationId) : null;
    const caseNum = `SEC-INV-${String(dbStore.securityInvestigations.length + 1).padStart(4, '0')}`;

    const newCase: SecurityInvestigationEntity = {
      id: uuidv4(),
      caseNumber: caseNum,
      title: dto.title,
      severity: dto.severity,
      status: 'OPEN',
      alertId: dto.alertId,
      organizationId: dto.organizationId,
      organizationName: org?.name,
      actorId: dto.actorId,
      actorEmail: dto.actorEmail,
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      assignedTo: dto.assignedTo || actor,
      securityImpact: dto.securityImpact,
      notes: dto.initialNotes ? [{ id: uuidv4(), author: actor, text: dto.initialNotes, createdAt: new Date() }] : [],
      evidence: [],
      actions: [],
      openedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    dbStore.securityInvestigations.unshift(newCase);

    if (dto.alertId) {
      const alert = dbStore.securityAlerts.find((a) => a.id === dto.alertId);
      if (alert) {
        alert.status = 'INVESTIGATING';
        alert.assignedTo = dto.assignedTo || actor;
        alert.updatedAt = new Date();
      }
    }

    this.recordSecurityAction('CREATE_INVESTIGATION', actor, 'INVESTIGATION', newCase.id, null, newCase, dto.title);
    this.writeAuditLog(actor, AuditAction.SECURITY_INVESTIGATION_CREATED, 'SecurityInvestigation', newCase.id, { caseNumber: caseNum, title: dto.title });

    return newCase;
  }

  async updateInvestigationStatus(id: string, status: string, actor: string) {
    this.ensureSeedData();
    const inv = dbStore.securityInvestigations.find((c) => c.id === id || c.caseNumber === id);
    if (!inv) throw new NotFoundException(`Investigation ${id} not found`);

    const beforeState = { status: inv.status };
    inv.status = status;
    inv.updatedAt = new Date();

    this.recordSecurityAction('UPDATE_INVESTIGATION_STATUS', actor, 'INVESTIGATION', inv.id, beforeState, { status }, `Status changed to ${status}`);
    this.writeAuditLog(actor, AuditAction.SECURITY_INVESTIGATION_UPDATED, 'SecurityInvestigation', inv.id, { caseNumber: inv.caseNumber, status });

    return inv;
  }

  async addInvestigationNote(id: string, text: string, author: string) {
    this.ensureSeedData();
    const inv = dbStore.securityInvestigations.find((c) => c.id === id || c.caseNumber === id);
    if (!inv) throw new NotFoundException(`Investigation ${id} not found`);

    const note = {
      id: uuidv4(),
      author,
      text,
      createdAt: new Date(),
    };

    inv.notes = [...(inv.notes || []), note];
    inv.updatedAt = new Date();

    return note;
  }

  async resolveInvestigation(id: string, dto: ResolveInvestigationDto, actor: string) {
    this.ensureSeedData();
    const inv = dbStore.securityInvestigations.find((c) => c.id === id || c.caseNumber === id);
    if (!inv) throw new NotFoundException(`Investigation ${id} not found`);

    const beforeState = { status: inv.status, outcome: inv.outcome };
    inv.status = 'RESOLVED';
    inv.outcome = dto.outcome;
    inv.resolutionReason = dto.resolutionReason;
    inv.resolution = dto.actionsTaken || 'Case resolved successfully';
    inv.resolvedAt = new Date();
    inv.updatedAt = new Date();

    if (inv.alertId) {
      const alert = dbStore.securityAlerts.find((a) => a.id === inv.alertId);
      if (alert) {
        alert.status = 'RESOLVED';
        alert.resolvedAt = new Date();
        alert.resolvedBy = actor;
        alert.resolutionReason = dto.resolutionReason;
      }
    }

    this.recordSecurityAction('RESOLVE_INVESTIGATION', actor, 'INVESTIGATION', inv.id, beforeState, { status: inv.status, outcome: dto.outcome }, dto.resolutionReason);
    this.writeAuditLog(actor, AuditAction.SECURITY_INVESTIGATION_RESOLVED, 'SecurityInvestigation', inv.id, { caseNumber: inv.caseNumber, outcome: dto.outcome });

    return inv;
  }

  // =========================================================================
  // 5. SECURITY INCIDENTS
  // =========================================================================
  async getIncidents(query: any = {}) {
    this.ensureSeedData();
    let incidents = [...dbStore.securityIncidents];

    if (query.status && query.status !== 'ALL') {
      incidents = incidents.filter((i) => i.status === query.status);
    }
    if (query.severity && query.severity !== 'ALL') {
      incidents = incidents.filter((i) => i.severity === query.severity);
    }
    if (query.search) {
      const s = query.search.toLowerCase();
      incidents = incidents.filter(
        (i) =>
          i.incidentNumber.toLowerCase().includes(s) ||
          i.title.toLowerCase().includes(s) ||
          i.category.toLowerCase().includes(s)
      );
    }

    incidents.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const total = incidents.length;

    return {
      items: incidents.slice((page - 1) * limit, page * limit),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getIncidentById(id: string) {
    this.ensureSeedData();
    const incident = dbStore.securityIncidents.find((i) => i.id === id || i.incidentNumber === id);
    if (!incident) throw new NotFoundException(`Incident ${id} not found`);

    return incident;
  }

  async createIncident(dto: CreateIncidentDto, actor: string) {
    this.ensureSeedData();
    const incNumber = `SEC-INC-${String(dbStore.securityIncidents.length + 1).padStart(4, '0')}`;

    const newIncident: SecurityIncidentEntity = {
      id: uuidv4(),
      incidentNumber: incNumber,
      title: dto.title,
      category: dto.category,
      severity: dto.severity,
      status: 'OPEN',
      assignedOwner: dto.assignedOwner || actor,
      affectedOrganizations: dto.affectedOrganizations || [],
      affectedUsers: dto.affectedUsers || [],
      affectedResources: dto.affectedResources || [],
      securityImpact: dto.securityImpact,
      containmentAction: dto.containmentAction,
      remediationAction: dto.remediationAction,
      openedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    dbStore.securityIncidents.unshift(newIncident);

    this.recordSecurityAction('CREATE_INCIDENT', actor, 'INCIDENT', newIncident.id, null, newIncident, dto.title);
    this.writeAuditLog(actor, AuditAction.SECURITY_INCIDENT_CREATED, 'SecurityIncident', newIncident.id, { incidentNumber: incNumber, title: dto.title });

    return newIncident;
  }

  async resolveIncident(id: string, dto: ResolveIncidentDto, actor: string) {
    this.ensureSeedData();
    const incident = dbStore.securityIncidents.find((i) => i.id === id || i.incidentNumber === id);
    if (!incident) throw new NotFoundException(`Incident ${id} not found`);

    const beforeState = { status: incident.status, outcome: incident.outcome };
    incident.status = 'RESOLVED';
    incident.outcome = dto.outcome;
    incident.resolutionReason = dto.resolutionReason;
    incident.resolvedAt = new Date();
    incident.updatedAt = new Date();

    this.recordSecurityAction('RESOLVE_INCIDENT', actor, 'INCIDENT', incident.id, beforeState, { status: incident.status, outcome: dto.outcome }, dto.resolutionReason);
    this.writeAuditLog(actor, AuditAction.SECURITY_INCIDENT_RESOLVED, 'SecurityIncident', incident.id, { incidentNumber: incident.incidentNumber, outcome: dto.outcome });

    return incident;
  }

  // =========================================================================
  // 6. AUTHENTICATION & SESSIONS
  // =========================================================================
  async getAuthenticationSummary() {
    this.ensureSeedData();
    const authEvents = dbStore.securityEvents.filter((e) => e.category === 'AUTHENTICATION');

    const totalAuth = authEvents.length;
    const successfulAuth = authEvents.filter((e) => e.result === 'SUCCESS').length;
    const failedAuth = authEvents.filter((e) => e.result === 'FAILED' || e.result === 'BLOCKED').length;
    const challengedAuth = authEvents.filter((e) => e.result === 'CHALLENGED').length;

    const lockedUsers = dbStore.users.filter((u) => u.status === 'LOCKED').map((u) => ({
      id: u.id,
      email: u.email,
      lockedUntil: (u as any).lockedUntil,
      reason: 'Authentication failure threshold exceeded',
    }));

    return {
      totalAttempts: totalAuth,
      successfulAttempts: successfulAuth,
      failedAttempts: failedAuth,
      challengedAttempts: challengedAuth,
      successRate: totalAuth > 0 ? Math.round((successfulAuth / totalAuth) * 100) : 100,
      lockedAccounts: lockedUsers,
      recentAuthEvents: authEvents.slice(0, 20),
    };
  }

  async getSessions(query: any = {}) {
    this.ensureSeedData();
    const now = new Date();
    const sessions = dbStore.authSessions.map((s) => {
      const user = dbStore.users.find((u) => u.id === s.userId);
      const isRevoked = Boolean(s.revokedAt);
      const isExpired = new Date(s.expiresAt) <= now;
      const status = isRevoked ? 'REVOKED' : isExpired ? 'EXPIRED' : 'ACTIVE';

      return {
        id: s.id,
        userId: s.userId,
        userEmail: user?.email || 'unknown',
        device: s.deviceName || 'Desktop Workstation',
        browser: s.userAgent ? this.parseBrowser(s.userAgent) : 'Chrome',
        operatingSystem: s.userAgent ? this.parseOS(s.userAgent) : 'Windows',
        ipAddress: s.ipAddress || '127.0.0.1',
        location: s.country ? `${s.city || 'Bengaluru'}, ${s.country}` : 'India',
        authenticationLevel: s.authenticationLevel || 'PASSWORD',
        mfaVerified: Boolean(s.mfaVerifiedAt),
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt,
        status,
      };
    });

    let filtered = sessions;
    if (query.status && query.status !== 'ALL') {
      filtered = filtered.filter((s) => s.status === query.status);
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      filtered = filtered.filter((s) => s.userEmail.toLowerCase().includes(q) || s.ipAddress.includes(q));
    }

    filtered.sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime());

    return filtered;
  }

  async revokeSession(id: string, reason: string, actor: string) {
    this.ensureSeedData();
    const session = dbStore.authSessions.find((s) => s.id === id);
    if (!session) throw new NotFoundException(`Session ${id} not found`);

    session.revokedAt = new Date();
    session.revokeReason = reason;

    const user = dbStore.users.find((u) => u.id === session.userId);

    this.recordSecurityAction('REVOKE_SESSION', actor, 'SESSION', session.id, { active: true }, { active: false, revokedAt: session.revokedAt }, reason);
    this.writeAuditLog(actor, AuditAction.SECURITY_SESSION_REVOKED, 'AuthSession', session.id, { userEmail: user?.email, reason });

    return { success: true, message: `Session ${id} successfully revoked` };
  }

  async revokeAllUserSessions(userId: string, reason: string, actor: string) {
    this.ensureSeedData();
    const userSessions = dbStore.authSessions.filter((s) => s.userId === userId && !s.revokedAt);
    const now = new Date();

    for (const session of userSessions) {
      session.revokedAt = now;
      session.revokeReason = reason;
    }

    const user = dbStore.users.find((u) => u.id === userId);

    this.recordSecurityAction(
      'REVOKE_ALL_SESSIONS',
      actor,
      'USER',
      userId,
      { activeSessionsCount: userSessions.length },
      { activeSessionsCount: 0 },
      reason
    );
    this.writeAuditLog(actor, AuditAction.SECURITY_ALL_SESSIONS_REVOKED, 'AuthSession', userId, { userEmail: user?.email, revokedCount: userSessions.length, reason });

    return { success: true, revokedCount: userSessions.length };
  }

  // =========================================================================
  // 7. ACCESS & AUTHORIZATION
  // =========================================================================
  async getAccessEvents(query: any = {}) {
    this.ensureSeedData();
    return dbStore.securityEvents
      .filter((e) => e.category === 'AUTHORIZATION')
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }

  // =========================================================================
  // 8. API SECURITY
  // =========================================================================
  async getApiSecurityEvents(query: any = {}) {
    this.ensureSeedData();
    return dbStore.securityEvents
      .filter((e) => e.category === 'API')
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }

  // =========================================================================
  // 9. INTEGRATIONS & WEBHOOKS
  // =========================================================================
  async getIntegrationSecurityEvents(query: any = {}) {
    this.ensureSeedData();
    return dbStore.securityEvents
      .filter((e) => e.category === 'INTEGRATION' || e.category === 'WEBHOOK')
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }

  // =========================================================================
  // 10. SECRETS & CREDENTIALS
  // =========================================================================
  async getSecretsMetadata(query: any = {}) {
    this.ensureSeedData();
    const now = Date.now();
    const secrets = dbStore.apiKeys.map((key) => {
      const org = dbStore.organizations.find((o) => o.id === key.organizationId);
      const isRevoked = Boolean(key.revokedAt);
      const isExpired = key.expiresAt ? new Date(key.expiresAt).getTime() < now : false;
      const isOld = now - new Date(key.createdAt).getTime() > 90 * 24 * 60 * 60 * 1000;
      const status = isRevoked ? 'REVOKED' : isExpired ? 'EXPIRED' : isOld ? 'ROTATION_REQUIRED' : 'ACTIVE';

      return {
        id: key.id,
        name: key.name,
        type: 'API_KEY',
        maskedIdentifier: `${key.prefix}_••••••${key.id.slice(-4).toUpperCase()}`,
        organizationId: key.organizationId,
        organizationName: org?.name || 'PartnerIQ Organization',
        scopes: key.scopes || ['read', 'write'],
        environment: key.environment || 'LIVE',
        status,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
        revokedAt: key.revokedAt,
      };
    });

    return secrets;
  }

  async rotateSecret(id: string, reason: string, actor: string) {
    this.ensureSeedData();
    const key = dbStore.apiKeys.find((k) => k.id === id);
    if (!key) throw new NotFoundException(`Secret ${id} not found`);

    const beforeState = { lastUsedAt: key.lastUsedAt, prefix: key.prefix };
    key.prefix = `pk_live_${uuidv4().slice(0, 6)}`;
    key.createdAt = new Date(); // Rotation resets age

    this.recordSecurityAction('ROTATE_CREDENTIAL', actor, 'CREDENTIAL', key.id, beforeState, { prefix: key.prefix }, reason);
    this.writeAuditLog(actor, AuditAction.SECURITY_CREDENTIAL_ROTATED, 'ApiKey', key.id, { name: key.name, action: 'ROTATED', reason });

    return { success: true, message: `Credential ${id} rotated successfully` };
  }

  async revokeSecret(id: string, reason: string, actor: string) {
    this.ensureSeedData();
    const key = dbStore.apiKeys.find((k) => k.id === id);
    if (!key) throw new NotFoundException(`Secret ${id} not found`);

    key.revokedAt = new Date();
    key.status = 'REVOKED';

    this.recordSecurityAction('REVOKE_CREDENTIAL', actor, 'CREDENTIAL', key.id, { status: 'ACTIVE' }, { status: 'REVOKED' }, reason);
    this.writeAuditLog(actor, AuditAction.SECURITY_CREDENTIAL_REVOKED, 'ApiKey', key.id, { name: key.name, action: 'REVOKED', reason });

    return { success: true, message: `Credential ${id} revoked` };
  }

  // =========================================================================
  // 11. SECURITY POLICIES
  // =========================================================================
  async getPolicies() {
    this.ensureSeedData();
    return [
      {
        id: 'policy_mfa_global',
        name: 'MFA Enforcement Policy',
        description: 'Mandatory Two-Factor Authentication for platform admins and sensitive operations',
        enabled: true,
        scope: 'SUPER_ADMIN,ORG_ADMIN',
        updatedAt: new Date(),
      },
      {
        id: 'policy_session_timeout',
        name: 'Session Idle Expiration',
        description: 'Automatic invalidation of user sessions after 12 hours of inactivity',
        enabled: true,
        timeoutMinutes: 720,
        updatedAt: new Date(),
      },
      {
        id: 'policy_webhook_signature',
        name: 'Webhook Fail-Closed Verification',
        description: 'Reject all webhooks immediately if HMAC SHA-256 signature does not match secret',
        enabled: true,
        failClosed: true,
        updatedAt: new Date(),
      },
      {
        id: 'policy_rate_limit',
        name: 'Global API Rate Limiting',
        description: 'Throttles inbound API requests to 120 per minute per token or IP',
        enabled: true,
        limitPerMinute: 120,
        updatedAt: new Date(),
      },
    ];
  }

  // =========================================================================
  // 12. DETECTION RULES & SIMULATION
  // =========================================================================
  async getRules() {
    this.ensureSeedData();
    return dbStore.securityRules.map((r) => ({
      ...r,
      versionsCount: dbStore.securityRuleVersions.filter((v) => v.ruleId === r.id).length,
    }));
  }

  async createRule(dto: CreateSecurityRuleDto, actor: string) {
    this.ensureSeedData();
    const existing = dbStore.securityRules.find((r) => r.code === dto.code);
    if (existing) throw new BadRequestException(`Rule with code ${dto.code} already exists`);

    const newRule: SecurityRuleEntity = {
      id: uuidv4(),
      code: dto.code,
      name: dto.name,
      category: dto.category,
      description: dto.description,
      severity: dto.severity,
      status: dto.status || 'ACTIVE',
      conditions: dto.conditions,
      actions: dto.actions,
      version: 1,
      triggerCount: 0,
      alertCount: 0,
      incidentCount: 0,
      createdBy: actor,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    dbStore.securityRules.unshift(newRule);

    const initialVersion: SecurityRuleVersionEntity = {
      id: uuidv4(),
      ruleId: newRule.id,
      version: 1,
      conditions: dto.conditions,
      actions: dto.actions,
      severity: dto.severity,
      changedBy: actor,
      changeReason: 'Initial rule creation',
      createdAt: new Date(),
    } as any;

    dbStore.securityRuleVersions.push(initialVersion);

    this.recordSecurityAction('CREATE_RULE', actor, 'RULE', newRule.id, null, newRule, `Created security rule ${dto.name}`);
    this.writeAuditLog(actor, AuditAction.SECURITY_RULE_CREATED, 'SecurityRule', newRule.id, { code: dto.code, name: dto.name });

    return newRule;
  }

  async updateRule(id: string, dto: UpdateSecurityRuleDto, actor: string) {
    this.ensureSeedData();
    const rule = dbStore.securityRules.find((r) => r.id === id);
    if (!rule) throw new NotFoundException(`Rule ${id} not found`);

    const beforeState = { ...rule };
    rule.name = dto.name || rule.name;
    rule.category = dto.category || rule.category;
    rule.description = dto.description || rule.description;
    rule.severity = dto.severity || rule.severity;
    rule.status = dto.status || rule.status;
    rule.conditions = dto.conditions || rule.conditions;
    rule.actions = dto.actions || rule.actions;
    rule.version = (rule.version || 1) + 1;
    rule.updatedAt = new Date();

    const newVersion: SecurityRuleVersionEntity = {
      id: uuidv4(),
      ruleId: rule.id,
      version: rule.version,
      conditions: rule.conditions,
      actions: rule.actions,
      severity: rule.severity,
      changedBy: actor,
      changeReason: dto.changeReason || 'Rule configuration update',
      createdAt: new Date(),
    } as any;

    dbStore.securityRuleVersions.push(newVersion);

    this.recordSecurityAction('UPDATE_RULE', actor, 'RULE', rule.id, beforeState, rule, dto.changeReason || 'Rule updated');
    this.writeAuditLog(actor, AuditAction.SECURITY_RULE_UPDATED, 'SecurityRule', rule.id, { code: rule.code, version: rule.version });

    return rule;
  }

  async toggleRuleStatus(id: string, status: 'ACTIVE' | 'DISABLED' | 'DRY_RUN', actor: string) {
    this.ensureSeedData();
    const rule = dbStore.securityRules.find((r) => r.id === id);
    if (!rule) throw new NotFoundException(`Rule ${id} not found`);

    const beforeState = { status: rule.status };
    rule.status = status;
    rule.updatedAt = new Date();

    this.recordSecurityAction('TOGGLE_RULE_STATUS', actor, 'RULE', rule.id, beforeState, { status }, `Toggled status to ${status}`);
    this.writeAuditLog(actor, AuditAction.SECURITY_RULE_TOGGLED, 'SecurityRule', rule.id, { code: rule.code, status });

    return rule;
  }

  async simulateRule(dto: TestRuleSimulationDto) {
    this.ensureSeedData();
    const days = dto.samplePeriodDays || 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const candidateEvents = dbStore.securityEvents.filter((e) => new Date(e.occurredAt) >= cutoff);

    const conditions = dto.conditions || {};
    const matchingEvents: SecurityEventEntity[] = [];

    for (const evt of candidateEvents) {
      let isMatch = true;
      if (conditions.category && evt.category !== conditions.category) isMatch = false;
      if (conditions.eventType && evt.eventType !== conditions.eventType) isMatch = false;
      if (conditions.result && evt.result !== conditions.result) isMatch = false;
      if (conditions.severity && evt.severity !== conditions.severity) isMatch = false;

      if (isMatch) matchingEvents.push(evt);
    }

    const wouldAlert = dto.actions?.includes('CREATE_ALERT') ? matchingEvents.length : 0;
    const wouldBlock = dto.actions?.includes('BLOCK_REQUEST') ? matchingEvents.length : 0;
    const wouldRevokeSession = dto.actions?.includes('REVOKE_SESSION') ? matchingEvents.length : 0;

    return {
      simulation: true,
      evaluatedEventsCount: candidateEvents.length,
      matchedEventsCount: matchingEvents.length,
      wouldAlertCount: wouldAlert,
      wouldBlockCount: wouldBlock,
      wouldRevokeSessionCount: wouldRevokeSession,
      sampleMatches: matchingEvents.slice(0, 5),
      guarantee: '100% Zero Mutations Executed',
    };
  }

  // =========================================================================
  // 13. EXCEPTIONS
  // =========================================================================
  async getExceptions() {
    this.ensureSeedData();
    return dbStore.securityExceptions.sort(
      (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
    );
  }

  // =========================================================================
  // 14. EXPORTS
  // =========================================================================
  async exportSecurityData(dto: ExportSecurityQueryDto, actor: string) {
    this.ensureSeedData();
    const events = dbStore.securityEvents;

    const csvRows = [
      'EventID,Timestamp,Type,Category,Severity,Result,Actor,Organization,IP,Source',
      ...events.map(
        (e) =>
          `"${e.eventNumber}","${new Date(e.occurredAt).toISOString()}","${e.eventType}","${e.category}","${e.severity}","${e.result}","${e.actorEmail || e.actorId}","${e.organizationName || ''}","${e.ipAddress || ''}","${e.source}"`
      ),
    ];

    this.recordSecurityAction('EXPORT_SECURITY_DATA', actor, 'EXPORT', 'security_events_csv', null, { rowCount: events.length }, 'Exported security events');
    this.writeAuditLog(actor, AuditAction.SECURITY_DATA_EXPORTED, 'SecurityExport', 'security_events_csv', { rowCount: events.length });

    return {
      filename: `security_events_export_${Date.now()}.csv`,
      data: csvRows.join('\n'),
      totalRecords: events.length,
    };
  }

  // =========================================================================
  // 15. AUDIT LOGS
  // =========================================================================
  async getAuditLogs() {
    this.ensureSeedData();
    const actionLogs = dbStore.securityActions.map((act) => ({
      id: act.id,
      timestamp: act.executedAt,
      actor: act.actorEmail || act.actorId,
      action: act.actionType,
      targetType: act.targetType,
      targetId: act.targetId,
      details: act.reason || `${act.actionType} on ${act.targetType}`,
      beforeState: act.beforeState,
      afterState: act.afterState,
      success: act.success,
      source: act.source,
    }));

    const generalAudit = dbStore.auditLogs
      .filter((l) => l.action?.toString().includes('SECURITY') || l.resourceType?.includes('Security') || l.resourceType === 'AuthSession' || l.resourceType === 'ApiKey')
      .map((l) => ({
        id: l.id,
        timestamp: l.createdAt,
        actor: l.actorId,
        action: l.action,
        targetType: l.resourceType,
        targetId: l.resourceId,
        details: l.metadata?.reason || l.metadata?.title || l.metadata?.name || JSON.stringify(l.metadata || {}),
        metadata: l.metadata,
        success: true,
        source: 'system_audit',
      }));

    return [...actionLogs, ...generalAudit].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  // =========================================================================
  // 15. PRIVATE HELPERS & SEED DATA INITIALIZER
  // =========================================================================
  private recordSecurityAction(
    actionType: string,
    actor: string,
    targetType: string,
    targetId: string,
    beforeState: any,
    afterState: any,
    reason: string
  ) {
    const action: SecurityActionEntity = {
      id: uuidv4(),
      actionType,
      actorId: actor,
      actorEmail: actor.includes('@') ? actor : 'admin@partneriq.io',
      targetType,
      targetId,
      beforeState,
      afterState,
      reason,
      source: 'admin_portal',
      success: true,
      executedAt: new Date(),
    } as any;

    dbStore.securityActions.unshift(action);
  }

  private writeAuditLog(actorId: string, action: AuditAction, resourceType: string, resourceId: string, metadata: any) {
    dbStore.auditLogs.unshift({
      id: uuidv4(),
      actorType: 'user',
      actorId,
      action,
      resourceType,
      resourceId,
      metadata,
      createdAt: new Date(),
    } as any);
  }

  private generateTimeline(days: number, events: SecurityEventEntity[]) {
    const timeline = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);

      const dayEvents = events.filter((e) => new Date(e.occurredAt).toISOString().slice(0, 10) === dateStr);
      const authEvents = dayEvents.filter((e) => e.category === 'AUTHENTICATION').length;
      const apiEvents = dayEvents.filter((e) => e.category === 'API').length;
      const deniedEvents = dayEvents.filter((e) => e.result === 'DENIED' || e.result === 'BLOCKED').length;

      timeline.push({
        date: dateStr,
        totalEvents: dayEvents.length,
        authEvents,
        apiEvents,
        deniedEvents,
      });
    }

    return timeline;
  }

  private parseBrowser(ua: string): string {
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    return 'Browser';
  }

  private parseOS(ua: string): string {
    if (ua.includes('Windows')) return 'Windows';
    if (ua.includes('Macintosh')) return 'macOS';
    if (ua.includes('Linux')) return 'Linux';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    if (ua.includes('Android')) return 'Android';
    return 'OS';
  }

  private ensureSeedData() {
    // 1. Seed Security Rules
    if (dbStore.securityRules.length === 0) {
      const rulesData = [
        {
          code: 'RULE-AUTH-001',
          name: 'Repeated Authentication Failures',
          category: 'AUTHENTICATION',
          description: 'Detects and flags when an account incurs 5 or more failed login attempts within 5 minutes',
          severity: 'HIGH',
          status: 'ACTIVE',
          conditions: { eventType: 'LOGIN_FAILED', threshold: 5, windowMinutes: 5, field: 'actor' },
          actions: ['CREATE_ALERT', 'CHALLENGE_MFA'],
        },
        {
          code: 'RULE-TENANT-001',
          name: 'Cross-Tenant Access / IDOR Guardrail',
          category: 'AUTHORIZATION',
          description: 'Fails closed and alerts if a user session attempts to query resources belonging to another organization',
          severity: 'CRITICAL',
          status: 'ACTIVE',
          conditions: { eventType: 'CROSS_TENANT_ACCESS_ATTEMPT', result: 'DENIED' },
          actions: ['BLOCK_REQUEST', 'CREATE_ALERT', 'CREATE_INVESTIGATION'],
        },
        {
          code: 'RULE-TOKEN-001',
          name: 'Refresh Token Family Hijack Detection',
          category: 'SESSION',
          description: 'Identifies refresh token replay attacks and automatically revokes the entire token family',
          severity: 'HIGH',
          status: 'ACTIVE',
          conditions: { eventType: 'TOKEN_FAMILY_REUSED' },
          actions: ['REVOKE_SESSION', 'CREATE_ALERT'],
        },
        {
          code: 'RULE-RATE-001',
          name: 'API Rate Limit & Endpoint Abuse',
          category: 'API',
          description: 'Monitors client API keys for sudden burst activity exceeding 120 calls per minute',
          severity: 'MEDIUM',
          status: 'ACTIVE',
          conditions: { eventType: 'RATE_LIMIT_EXCEEDED', threshold: 120, windowMinutes: 1 },
          actions: ['THROTTLE_CLIENT', 'CREATE_ALERT'],
        },
        {
          code: 'RULE-WEBHOOK-001',
          name: 'Webhook Signature Failure (Fail-Closed)',
          category: 'WEBHOOK',
          description: 'Rejects inbound integration webhooks if the HMAC-SHA256 signature does not strictly validate',
          severity: 'HIGH',
          status: 'ACTIVE',
          conditions: { eventType: 'WEBHOOK_SIGNATURE_INVALID' },
          actions: ['REJECT_PAYLOAD', 'CREATE_ALERT'],
        },
      ];

      for (const r of rulesData) {
        const rule: SecurityRuleEntity = {
          id: uuidv4(),
          code: r.code,
          name: r.name,
          category: r.category,
          description: r.description,
          severity: r.severity as any,
          status: r.status as any,
          conditions: r.conditions,
          actions: r.actions,
          version: 1,
          triggerCount: 0,
          alertCount: 0,
          incidentCount: 0,
          lastTriggeredAt: undefined,
          createdBy: 'system@partneriq.io',
          createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
        } as any;

        dbStore.securityRules.push(rule);
        dbStore.securityRuleVersions.push({
          id: uuidv4(),
          ruleId: rule.id,
          version: 1,
          conditions: r.conditions,
          actions: r.actions,
          severity: r.severity as any,
          changedBy: 'system@partneriq.io',
          changeReason: 'Default baseline security policy',
          createdAt: rule.createdAt,
        } as any);
      }
    }

    // Everything below fabricates sample activity (events/alerts/investigations/
    // incidents/exceptions attached to whichever real user/org happens to be
    // first in the store) for local demos. Explicit opt-in, independent of
    // NODE_ENV — see ENABLE_DEV_FIXTURES in .env.example. A security
    // dashboard showing invented incidents next to real ones is actively
    // dangerous for anyone investigating a real event.
    if (process.env.ENABLE_DEV_FIXTURES !== 'true') return;

    // 2. Seed Realistic Security Events from System State
    if (dbStore.securityEvents.length === 0) {
      const now = Date.now();
      const adminUser = dbStore.users.find((u) => u.platformRole === 'SUPER_ADMIN') || dbStore.users[0];
      const memberUser = dbStore.users.find((u) => u.id !== adminUser?.id) || adminUser;
      const primaryOrg = dbStore.organizations[0];
      const secondOrg = dbStore.organizations[1] || primaryOrg;

      const eventsData: Partial<SecurityEventEntity>[] = [
        {
          eventNumber: 'SEC-EVT-0001',
          eventType: 'ADMIN_PORTAL_LOGIN',
          category: 'AUTHENTICATION',
          severity: 'INFO',
          result: 'SUCCESS',
          actorType: 'PLATFORM_ADMIN',
          actorId: adminUser?.id || 'admin-01',
          actorEmail: adminUser?.email || 'admin@partneriq.io',
          organizationId: primaryOrg?.id,
          organizationName: primaryOrg?.name,
          resourceType: 'AdminPortal',
          resourceId: 'admin_dashboard',
          source: 'admin_portal',
          service: 'core-api',
          ipAddress: '103.245.128.42',
          country: 'India',
          city: 'Bengaluru',
          occurredAt: new Date(now - 12 * 60 * 1000),
          detectedAt: new Date(now - 12 * 60 * 1000),
        },
        {
          eventNumber: 'SEC-EVT-0002',
          eventType: 'CROSS_TENANT_ACCESS_ATTEMPT',
          category: 'AUTHORIZATION',
          severity: 'CRITICAL',
          result: 'DENIED',
          actorType: 'ORG_MEMBER',
          actorId: memberUser?.id || 'user-02',
          actorEmail: memberUser?.email || 'user@example.com',
          organizationId: secondOrg?.id,
          organizationName: secondOrg?.name,
          resourceType: 'OrganizationCommission',
          resourceId: 'comm_849204',
          source: 'core_api',
          service: 'core-api',
          endpoint: '/api/v1/commissions/comm_849204',
          httpMethod: 'GET',
          ipAddress: '49.207.210.14',
          country: 'India',
          city: 'Mumbai',
          reason: 'Attempted to query resource belonging to different tenant',
          occurredAt: new Date(now - 28 * 60 * 1000),
          detectedAt: new Date(now - 28 * 60 * 1000),
        },
        {
          eventNumber: 'SEC-EVT-0003',
          eventType: 'LOGIN_FAILED',
          category: 'AUTHENTICATION',
          severity: 'HIGH',
          result: 'FAILED',
          actorType: 'USER',
          actorId: memberUser?.id || 'user-02',
          actorEmail: memberUser?.email || 'user@example.com',
          organizationId: primaryOrg?.id,
          organizationName: primaryOrg?.name,
          resourceType: 'AuthEndpoint',
          resourceId: '/auth/login',
          source: 'web_portal',
          service: 'auth-service',
          ipAddress: '185.220.101.5',
          country: 'Germany',
          city: 'Frankfurt',
          reason: 'Invalid credentials supplied 5 consecutive times',
          occurredAt: new Date(now - 45 * 60 * 1000),
          detectedAt: new Date(now - 45 * 60 * 1000),
        },
        {
          eventNumber: 'SEC-EVT-0004',
          eventType: 'WEBHOOK_SIGNATURE_INVALID',
          category: 'WEBHOOK',
          severity: 'HIGH',
          result: 'BLOCKED',
          actorType: 'WEBHOOK',
          actorId: 'webhook_inbound_razorpay',
          organizationId: primaryOrg?.id,
          organizationName: primaryOrg?.name,
          resourceType: 'WebhookEndpoint',
          resourceId: '/webhooks/razorpay',
          source: 'webhook_receiver',
          service: 'webhooks-service',
          endpoint: '/api/v1/webhooks/razorpay',
          httpMethod: 'POST',
          ipAddress: '52.66.182.11',
          country: 'India',
          city: 'Chennai',
          reason: 'HMAC signature verification failed (Fail-Closed triggered)',
          occurredAt: new Date(now - 90 * 60 * 1000),
          detectedAt: new Date(now - 90 * 60 * 1000),
        },
        {
          eventNumber: 'SEC-EVT-0005',
          eventType: 'API_RATE_LIMIT_TRIGGERED',
          category: 'API',
          severity: 'MEDIUM',
          result: 'BLOCKED',
          actorType: 'API_CLIENT',
          actorId: 'api_client_partner_sync',
          organizationId: primaryOrg?.id,
          organizationName: primaryOrg?.name,
          resourceType: 'ApiEndpoint',
          resourceId: '/api/v1/conversions',
          source: 'api_gateway',
          service: 'core-api',
          endpoint: '/api/v1/conversions',
          httpMethod: 'POST',
          ipAddress: '103.111.45.9',
          country: 'India',
          city: 'Bengaluru',
          reason: 'Exceeded rate threshold 120 requests/min',
          occurredAt: new Date(now - 3 * 3600 * 1000),
          detectedAt: new Date(now - 3 * 3600 * 1000),
        },
      ];

      for (const item of eventsData) {
        dbStore.securityEvents.push({
          id: uuidv4(),
          eventSchemaVersion: '1.0',
          createdAt: item.occurredAt || new Date(),
          ...item,
        } as any);
      }
    }

    // 3. Seed Security Signals & Alerts
    if (dbStore.securityAlerts.length === 0) {
      const primaryOrg = dbStore.organizations[0];
      const adminUser = dbStore.users.find((u) => u.platformRole === 'SUPER_ADMIN') || dbStore.users[0];

      const alert1: SecurityAlertEntity = {
        id: uuidv4(),
        alertNumber: 'SEC-ALT-0001',
        title: 'Cross-Tenant Access Attempt Blocked',
        severity: 'CRITICAL',
        status: 'OPEN',
        ruleName: 'Cross-Tenant Access / IDOR Guardrail',
        ruleVersion: 1,
        eventCount: 1,
        actorType: 'ORG_MEMBER',
        actorId: 'user-02',
        actorEmail: 'analyst@acme.io',
        organizationId: primaryOrg?.id,
        organizationName: primaryOrg?.name,
        resourceType: 'OrganizationCommission',
        resourceId: 'comm_849204',
        assignedTo: adminUser?.email,
        impact: 'High risk of unauthorized cross-organization commission record discovery.',
        evidence: {
          observedValue: 'Tenant Mismatch: Requesting Org != Resource Owner',
          expectedValue: 'Strict Tenant Isolation',
          threshold: '0 cross-tenant queries',
          source: 'AuthorizationGuard',
        },
        createdAt: new Date(Date.now() - 25 * 60 * 1000),
        updatedAt: new Date(),
      } as any;

      const alert2: SecurityAlertEntity = {
        id: uuidv4(),
        alertNumber: 'SEC-ALT-0002',
        title: 'Repeated Authentication Failures Detected',
        severity: 'HIGH',
        status: 'OPEN',
        ruleName: 'Repeated Authentication Failures',
        ruleVersion: 1,
        eventCount: 5,
        actorType: 'USER',
        actorId: 'user-02',
        actorEmail: 'finance@partneriq.io',
        organizationId: primaryOrg?.id,
        organizationName: primaryOrg?.name,
        resourceType: 'AuthEndpoint',
        resourceId: '/auth/login',
        impact: 'Potential credential stuffing or brute force attack against operator account.',
        evidence: {
          observedValue: '5 failed logins in 3 minutes',
          expectedValue: '< 3 failures per 15 minutes',
          threshold: '5 failures',
          source: 'AuthGuard',
        },
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
        updatedAt: new Date(),
      } as any;

      dbStore.securityAlerts.push(alert1);
      dbStore.securityAlerts.push(alert2);
    }

    // 4. Seed Security Investigations
    if (dbStore.securityInvestigations.length === 0) {
      const primaryOrg = dbStore.organizations[0];
      const alert = dbStore.securityAlerts[0];
      const adminUser = dbStore.users.find((u) => u.platformRole === 'SUPER_ADMIN') || dbStore.users[0];

      dbStore.securityInvestigations.push({
        id: uuidv4(),
        caseNumber: 'SEC-INV-0001',
        title: 'Investigation into Cross-Tenant Commission Discovery Probe',
        severity: 'CRITICAL',
        status: 'INVESTIGATING',
        alertId: alert?.id,
        organizationId: primaryOrg?.id,
        organizationName: primaryOrg?.name,
        actorId: 'user-02',
        actorEmail: 'analyst@acme.io',
        resourceType: 'OrganizationCommission',
        resourceId: 'comm_849204',
        assignedTo: adminUser?.email || 'security-lead@partneriq.io',
        securityImpact: 'Attempted horizontal privilege escalation via direct API parameter modification.',
        notes: [
          {
            id: uuidv4(),
            author: adminUser?.email || 'admin@partneriq.io',
            text: 'Guardrail caught the mismatch before data serialization. Session IP mapped to Mumbai telecom subnet.',
            createdAt: new Date(Date.now() - 20 * 60 * 1000),
          },
        ],
        evidence: [
          {
            id: uuidv4(),
            type: 'LOG_ENTRY',
            title: 'Authorization Guard Event SEC-EVT-0002',
            timestamp: new Date(Date.now() - 28 * 60 * 1000),
          },
        ],
        actions: [
          {
            id: uuidv4(),
            type: 'ACCESS_RESTRICTED',
            description: 'Temporarily elevated auditing on user session',
            executedAt: new Date(),
          },
        ],
        openedAt: new Date(Date.now() - 22 * 60 * 1000),
        createdAt: new Date(Date.now() - 22 * 60 * 1000),
        updatedAt: new Date(),
      } as any);
    }

    // 5. Seed Security Incidents
    if (dbStore.securityIncidents.length === 0) {
      const primaryOrg = dbStore.organizations[0];
      const adminUser = dbStore.users.find((u) => u.platformRole === 'SUPER_ADMIN') || dbStore.users[0];

      dbStore.securityIncidents.push({
        id: uuidv4(),
        incidentNumber: 'SEC-INC-0001',
        title: 'Credential Stuffing Subnet Containment',
        category: 'ACCOUNT_COMPROMISE',
        severity: 'HIGH',
        status: 'RESOLVED',
        assignedOwner: adminUser?.email || 'admin@partneriq.io',
        affectedOrganizations: [primaryOrg?.name || 'Default Organization'],
        affectedUsers: ['finance@partneriq.io'],
        affectedResources: ['/auth/login'],
        securityImpact: 'Repeated authentication requests from high-velocity proxy subnet.',
        containmentAction: 'Temporarily blocked origin IP block and challenged active sessions for MFA.',
        remediationAction: 'Account password reset enforced and rate-limit window restricted.',
        outcome: 'CONTAINED',
        resolutionReason: 'All target accounts secured; no unauthorized session tokens were minted.',
        openedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        resolvedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      } as any);
    }

    // 6. Seed Security Exceptions
    if (dbStore.securityExceptions.length === 0) {
      dbStore.securityExceptions.push({
        id: uuidv4(),
        exceptionCode: 'WEBHOOK_SIGNATURE_PARSING_FAILURE',
        severity: 'MEDIUM',
        component: 'WebhookIngestionPipeline',
        entity: 'RazorpayPaymentWebhook',
        expected: 'Valid HMAC SHA256 signature in X-Razorpay-Signature header',
        actual: 'Header present but computed hash mismatched by 2 bytes',
        retryState: 'RESOLVED',
        retryCount: 1,
        impact: 'Failed delivery quarantined; payment verification required manual webhook resend.',
        resolution: 'Merchant rotated webhook secret in Razorpay dashboard and re-synced.',
        detectedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      } as any);
    }
  }
}

