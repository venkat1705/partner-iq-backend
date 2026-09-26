import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, awaitPersist, FraudRuleEntity, FraudRuleVersionEntity, FraudAlertEntity, FraudInvestigationEntity, FraudHoldEntity, FraudExceptionEntity } from '../../database/store';
import { AuditAction } from '../../common/enums';
import {
  CreateFraudRuleDto,
  UpdateFraudRuleDto,
  TestRuleSimulationDto,
  CreateInvestigationDto,
  ResolveInvestigationDto,
  CreateFraudHoldDto,
} from './admin-fraud.dto';

@Injectable()
export class AdminFraudService {
  private readonly logger = new Logger(AdminFraudService.name);

  constructor() {
    this.ensureSeedData();
  }

  // =========================================================================
  // 1. OVERVIEW & BENTO KPIS
  // =========================================================================
  async getOverview(period = '30d') {
    this.ensureSeedData();
    const alerts = dbStore.fraudAlerts;
    const investigations = dbStore.fraudInvestigations;
    const holds = dbStore.fraudHolds;
    const rules = dbStore.fraudRules;
    const signals = dbStore.fraudSignals;

    const activeAlerts = alerts.filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED');
    const criticalAlerts = activeAlerts.filter((a) => a.severity === 'CRITICAL');
    const highAlerts = activeAlerts.filter((a) => a.severity === 'HIGH');
    const openInvestigations = investigations.filter(
      (i) => i.status === 'OPEN' || i.status === 'INVESTIGATING' || i.status === 'ACTION_REQUIRED'
    );
    const resolvedCases = investigations.filter((i) => i.status === 'RESOLVED' || i.status === 'CLOSED');
    const confirmedFraudCases = investigations.filter((i) => i.outcome === 'CONFIRMED_FRAUD');

    const activeHolds = holds.filter((h) => h.status === 'ACTIVE');
    const conversionHolds = activeHolds.filter((h) => h.entityType === 'CONVERSION');
    const commissionHolds = activeHolds.filter((h) => h.entityType === 'COMMISSION');
    const payoutHolds = activeHolds.filter((h) => h.entityType === 'PAYOUT');

    // Financial Exposure calculations (strictly in minor units / paise)
    const commissionAtRiskPaise = commissionHolds.reduce((sum, h) => sum + (h.amountPaise || 0), 0) +
      activeAlerts.reduce((sum, a) => sum + (a.financialExposurePaise || 0), 0);
    const payoutAtRiskPaise = payoutHolds.reduce((sum, h) => sum + (h.amountPaise || 0), 0);
    const confirmedLossPaise = confirmedFraudCases.reduce((sum, c) => sum + (c.financialExposurePaise || 0), 0);
    const preventedAmountPaise = activeHolds.reduce((sum, h) => sum + (h.amountPaise || 0), 0);
    const recoveredAmountPaise = Math.round(confirmedLossPaise * 0.45); // Recovered via clawbacks

    // Timeline Aggregation
    const days = period === '7d' ? 7 : period === '90d' ? 90 : period === '6m' ? 180 : period === '1y' ? 365 : 30;
    const timeline = this.generateTimeline(days);

    // Rule Activity
    const ruleActivity = rules
      .map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        category: r.category,
        severity: r.severity,
        status: r.status,
        triggerCount: r.triggerCount || 0,
        lastTriggeredAt: r.lastTriggeredAt,
      }))
      .sort((a, b) => b.triggerCount - a.triggerCount);

    // Attention Alerts
    const attentionAlerts = activeAlerts
      .filter((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH')
      .slice(0, 5)
      .map((a) => this.expandAlert(a));

    // Recent Risk Activities
    const recentActivity = [
      ...alerts.slice(-8).map((a) => ({
        id: a.id,
        type: 'ALERT' as const,
        title: a.title,
        severity: a.severity,
        timestamp: a.createdAt,
        reference: a.alertNumber,
        exposurePaise: a.financialExposurePaise,
        status: a.status,
      })),
      ...investigations.slice(-5).map((inv) => ({
        id: inv.id,
        type: 'INVESTIGATION' as const,
        title: inv.title,
        severity: inv.severity,
        timestamp: inv.openedAt,
        reference: inv.caseNumber,
        exposurePaise: inv.financialExposurePaise,
        status: inv.status,
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10);

    return {
      kpis: {
        activeAlertsCount: activeAlerts.length,
        criticalAlertsCount: criticalAlerts.length,
        highAlertsCount: highAlerts.length,
        openInvestigationsCount: openInvestigations.length,
        conversionsOnHoldCount: conversionHolds.length,
        commissionsOnHoldCount: commissionHolds.length,
        payoutsOnHoldCount: payoutHolds.length,
        totalActiveHoldsCount: activeHolds.length,
        confirmedFraudCount: confirmedFraudCases.length,
        resolvedCasesCount: resolvedCases.length,
        totalSignalsCount: signals.length,
        financialExposure: {
          commissionAtRiskPaise,
          payoutAtRiskPaise,
          confirmedLossPaise,
          preventedAmountPaise,
          recoveredAmountPaise,
          currency: 'INR',
        },
      },
      timeline,
      ruleActivity,
      attentionAlerts,
      recentActivity,
    };
  }

  // =========================================================================
  // 2. ALERTS OPERATIONS
  // =========================================================================
  async getAlerts(query?: {
    severity?: string;
    status?: string;
    search?: string;
    organizationId?: string;
    page?: number;
    limit?: number;
  }) {
    this.ensureSeedData();
    let rows = [...dbStore.fraudAlerts];

    if (query?.severity && query.severity !== 'ALL') {
      rows = rows.filter((a) => a.severity === query.severity);
    }
    if (query?.status && query.status !== 'ALL') {
      rows = rows.filter((a) => a.status === query.status);
    }
    if (query?.organizationId && query.organizationId !== 'ALL') {
      rows = rows.filter((a) => a.organizationId === query.organizationId);
    }
    if (query?.search) {
      const q = query.search.toLowerCase();
      rows = rows.filter(
        (a) =>
          a.alertNumber.toLowerCase().includes(q) ||
          a.title.toLowerCase().includes(q) ||
          a.signalCode.toLowerCase().includes(q) ||
          a.severityReason.toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return rows.map((a) => this.expandAlert(a));
  }

  async getAlertById(id: string) {
    const alert = dbStore.fraudAlerts.find((a) => a.id === id || a.alertNumber === id);
    if (!alert) throw new NotFoundException('Fraud Alert not found');
    return this.expandAlert(alert);
  }

  // NOTE: getAlertById() returns a spread copy (plus computed affiliate/program/org fields),
  // so mutating agree with the fixed pattern in programs.service.ts: look up and mutate the
  // raw tracked dbStore.fraudAlerts entity directly, then re-expand it for the response.
  private findRawAlert(id: string): FraudAlertEntity {
    const alert = dbStore.fraudAlerts.find((a) => a.id === id || a.alertNumber === id);
    if (!alert) throw new NotFoundException('Fraud Alert not found');
    return alert;
  }

  async assignAlert(id: string, assignedTo: string, actor = 'System') {
    const alert = this.findRawAlert(id);
    alert.assignedTo = assignedTo;
    alert.updatedAt = new Date();
    await awaitPersist(alert);
    this.logAudit('ALERT_ASSIGNED', alert.id, { assignedTo, alertNumber: alert.alertNumber }, actor);
    return this.expandAlert(alert);
  }

  async acknowledgeAlert(id: string, actor = 'System') {
    const alert = this.findRawAlert(id);
    alert.status = 'ACKNOWLEDGED';
    alert.acknowledgedAt = new Date();
    alert.updatedAt = new Date();
    await awaitPersist(alert);
    this.logAudit('ALERT_ACKNOWLEDGED', alert.id, { alertNumber: alert.alertNumber }, actor);
    return this.expandAlert(alert);
  }

  async resolveAlert(id: string, status: 'RESOLVED' | 'DISMISSED', notes?: string, actor = 'System') {
    const alert = this.findRawAlert(id);
    alert.status = status;
    alert.resolvedAt = new Date();
    alert.resolvedBy = actor;
    alert.resolutionNotes = notes;
    alert.updatedAt = new Date();
    await awaitPersist(alert);
    this.logAudit('ALERT_RESOLVED', alert.id, { status, notes, alertNumber: alert.alertNumber }, actor);
    return this.expandAlert(alert);
  }

  async createInvestigationFromAlert(alertId: string, actor = 'System') {
    const alert = this.findRawAlert(alertId);
    const caseNumber = `INV-${String(dbStore.fraudInvestigations.length + 101).padStart(6, '0')}`;

    const investigation: FraudInvestigationEntity = {
      id: uuidv4(),
      caseNumber,
      title: `Investigation: ${alert.title}`,
      severity: alert.severity,
      status: 'INVESTIGATING',
      assignedTo: alert.assignedTo || actor,
      assignedAt: new Date(),
      organizationId: alert.organizationId,
      affiliateId: alert.affiliateId,
      programId: alert.programId,
      financialExposurePaise: alert.financialExposurePaise,
      linkedAlertIds: [alert.id],
      linkedConversionIds: alert.conversionId ? [alert.conversionId] : [],
      linkedCommissionIds: alert.commissionId ? [alert.commissionId] : [],
      linkedPayoutIds: alert.payoutId ? [alert.payoutId] : [],
      notes: [
        {
          id: uuidv4(),
          author: actor,
          text: `Investigation opened from alert ${alert.alertNumber}: ${alert.severityReason}`,
          timestamp: new Date(),
        },
      ],
      timeline: [
        {
          timestamp: new Date(),
          event: 'INVESTIGATION_OPENED',
          description: `Opened case from alert ${alert.alertNumber}`,
          actor,
        },
      ],
      openedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.fraudInvestigations.push(investigation);
    alert.status = 'ACKNOWLEDGED';
    await Promise.all([awaitPersist(investigation), awaitPersist(alert)]);
    this.logAudit('INVESTIGATION_CREATED', investigation.id, { caseNumber, alertId: alert.id }, actor);
    return investigation;
  }

  // =========================================================================
  // 3. INVESTIGATIONS & CASE WORKBENCH
  // =========================================================================
  async getInvestigations(query?: {
    status?: string;
    severity?: string;
    search?: string;
    organizationId?: string;
  }) {
    this.ensureSeedData();
    let rows = [...dbStore.fraudInvestigations];

    if (query?.status && query.status !== 'ALL') {
      rows = rows.filter((i) => i.status === query.status);
    }
    if (query?.severity && query.severity !== 'ALL') {
      rows = rows.filter((i) => i.severity === query.severity);
    }
    if (query?.organizationId && query.organizationId !== 'ALL') {
      rows = rows.filter((i) => i.organizationId === query.organizationId);
    }
    if (query?.search) {
      const q = query.search.toLowerCase();
      rows = rows.filter(
        (i) =>
          i.caseNumber.toLowerCase().includes(q) ||
          i.title.toLowerCase().includes(q) ||
          (i.outcomeReason || '').toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
    return rows.map((i) => this.expandInvestigation(i));
  }

  async getInvestigationById(id: string) {
    const inv = dbStore.fraudInvestigations.find((i) => i.id === id || i.caseNumber === id);
    if (!inv) throw new NotFoundException('Fraud Investigation Case not found');
    return this.expandInvestigation(inv);
  }

  // NOTE: getInvestigationById() returns a spread copy (plus computed affiliate/program/org
  // fields), so mutating that would silently no-op — look up and mutate the raw tracked
  // dbStore.fraudInvestigations entity directly instead, matching programs.service.ts's fix.
  private findRawInvestigation(id: string): FraudInvestigationEntity {
    const inv = dbStore.fraudInvestigations.find((i) => i.id === id || i.caseNumber === id);
    if (!inv) throw new NotFoundException('Fraud Investigation Case not found');
    return inv;
  }

  async updateInvestigationStatus(id: string, status: any, note?: string, actor = 'System') {
    const inv = this.findRawInvestigation(id);
    const oldStatus = inv.status;
    inv.status = status;
    inv.updatedAt = new Date();

    if (!inv.timeline) inv.timeline = [];
    inv.timeline.push({
      timestamp: new Date(),
      event: 'STATUS_CHANGED',
      description: `Status changed from ${oldStatus} to ${status}${note ? `: ${note}` : ''}`,
      actor,
    });

    if (note) {
      if (!inv.notes) inv.notes = [];
      inv.notes.push({
        id: uuidv4(),
        author: actor,
        text: note,
        timestamp: new Date(),
      });
    }

    await awaitPersist(inv);
    this.logAudit('INVESTIGATION_UPDATED', inv.id, { oldStatus, newStatus: status, note }, actor);
    return this.expandInvestigation(inv);
  }

  async assignInvestigation(id: string, assignedTo: string, actor = 'System') {
    const inv = this.findRawInvestigation(id);
    inv.assignedTo = assignedTo;
    inv.assignedAt = new Date();
    inv.updatedAt = new Date();

    if (!inv.timeline) inv.timeline = [];
    inv.timeline.push({
      timestamp: new Date(),
      event: 'ASSIGNED',
      description: `Investigator assigned: ${assignedTo}`,
      actor,
    });

    await awaitPersist(inv);
    this.logAudit('INVESTIGATION_ASSIGNED', inv.id, { assignedTo }, actor);
    return this.expandInvestigation(inv);
  }

  async addInvestigationNote(id: string, text: string, actor = 'System') {
    const inv = this.findRawInvestigation(id);
    if (!inv.notes) inv.notes = [];
    const noteItem = {
      id: uuidv4(),
      author: actor,
      text,
      timestamp: new Date(),
    };
    inv.notes.push(noteItem);
    inv.updatedAt = new Date();
    await awaitPersist(inv);
    return noteItem;
  }

  async resolveInvestigation(id: string, dto: ResolveInvestigationDto, actor = 'System') {
    const inv = this.findRawInvestigation(id);
    inv.status = 'RESOLVED';
    inv.outcome = dto.outcome;
    inv.outcomeReason = dto.outcomeReason;
    inv.actionTaken = dto.actionTaken;
    inv.resolvedAt = new Date();
    inv.resolvedBy = actor;
    inv.updatedAt = new Date();

    if (!inv.timeline) inv.timeline = [];
    inv.timeline.push({
      timestamp: new Date(),
      event: 'CASE_RESOLVED',
      description: `Outcome: ${dto.outcome} — ${dto.outcomeReason}. Action: ${dto.actionTaken}`,
      actor,
    });

    const pending: Promise<unknown>[] = [awaitPersist(inv)];

    // Optionally release associated holds if flagged as false positive or no issue
    if (dto.releaseHolds || dto.outcome === 'FALSE_POSITIVE' || dto.outcome === 'NO_ISSUE') {
      const relatedHolds = dbStore.fraudHolds.filter((h) => h.investigationId === inv.id && h.status === 'ACTIVE');
      for (const h of relatedHolds) {
        h.status = 'RELEASED';
        h.releasedAt = new Date();
        h.releasedBy = actor;
        h.releaseReason = `Auto-released upon investigation resolution: ${dto.outcome}`;
        pending.push(awaitPersist(h));
      }
    }

    await Promise.all(pending);

    this.logAudit('INVESTIGATION_RESOLVED', inv.id, { outcome: dto.outcome, reason: dto.outcomeReason }, actor);
    return this.expandInvestigation(inv);
  }

  // =========================================================================
  // 4. RULES ENGINE & VERSIONING
  // =========================================================================
  async getRules() {
    this.ensureSeedData();
    return dbStore.fraudRules.map((r) => {
      const versions = dbStore.fraudRuleVersions.filter((v) => v.ruleId === r.id);
      return {
        ...r,
        versionHistory: versions,
      };
    });
  }

  async getRuleById(id: string) {
    const rule = dbStore.fraudRules.find((r) => r.id === id || r.code === id);
    if (!rule) throw new NotFoundException('Fraud Rule not found');
    const versions = dbStore.fraudRuleVersions.filter((v) => v.ruleId === rule.id);
    return { ...rule, versionHistory: versions };
  }

  async createRule(dto: CreateFraudRuleDto, actor = 'System') {
    const existing = dbStore.fraudRules.find((r) => r.code === dto.code);
    if (existing) throw new BadRequestException(`Rule with code ${dto.code} already exists`);

    const ruleId = uuidv4();
    const rule: FraudRuleEntity = {
      id: ruleId,
      name: dto.name,
      code: dto.code,
      description: dto.description,
      category: dto.category,
      severity: dto.severity,
      status: dto.status || 'ACTIVE',
      currentVersion: 1,
      conditions: dto.conditions,
      actions: dto.actions,
      triggerCount: 0,
      createdBy: actor,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const initialVersion: FraudRuleVersionEntity = {
      id: uuidv4(),
      ruleId,
      version: 1,
      conditions: dto.conditions,
      actions: dto.actions,
      severity: dto.severity,
      effectiveFrom: new Date(),
      createdBy: actor,
      createdAt: new Date(),
    };

    dbStore.fraudRules.push(rule);
    dbStore.fraudRuleVersions.push(initialVersion);
    await Promise.all([awaitPersist(rule), awaitPersist(initialVersion)]);
    this.logAudit('RULE_CREATED', rule.id, { code: rule.code, version: 1 }, actor);
    return rule;
  }

  // NOTE: getRuleById() returns a spread copy (plus versionHistory), so mutating that would
  // silently no-op — look up and mutate the raw tracked dbStore.fraudRules entity directly.
  private findRawRule(id: string): FraudRuleEntity {
    const rule = dbStore.fraudRules.find((r) => r.id === id || r.code === id);
    if (!rule) throw new NotFoundException('Fraud Rule not found');
    return rule;
  }

  async updateRule(id: string, dto: UpdateFraudRuleDto, actor = 'System') {
    const rule = this.findRawRule(id);
    const newVersionNum = (rule.currentVersion || 1) + 1;

    const pending: Promise<unknown>[] = [];

    // Archive previous version effectiveTo
    const lastVersion = dbStore.fraudRuleVersions
      .filter((v) => v.ruleId === rule.id)
      .sort((a, b) => b.version - a.version)[0];
    if (lastVersion) {
      lastVersion.effectiveTo = new Date();
      pending.push(awaitPersist(lastVersion));
    }

    if (dto.name) rule.name = dto.name;
    if (dto.description) rule.description = dto.description;
    if (dto.category) rule.category = dto.category;
    if (dto.severity) rule.severity = dto.severity;
    if (dto.status) rule.status = dto.status;
    if (dto.conditions) rule.conditions = dto.conditions;
    if (dto.actions) rule.actions = dto.actions;
    rule.currentVersion = newVersionNum;
    rule.updatedAt = new Date();
    pending.push(awaitPersist(rule));

    const newVersion: FraudRuleVersionEntity = {
      id: uuidv4(),
      ruleId: rule.id,
      version: newVersionNum,
      conditions: rule.conditions,
      actions: rule.actions,
      severity: rule.severity,
      effectiveFrom: new Date(),
      createdBy: actor,
      createdAt: new Date(),
    };

    dbStore.fraudRuleVersions.push(newVersion);
    pending.push(awaitPersist(newVersion));
    await Promise.all(pending);

    this.logAudit('RULE_UPDATED', rule.id, { version: newVersionNum }, actor);
    return rule;
  }

  async toggleRuleStatus(id: string, status: 'ACTIVE' | 'DISABLED' | 'DRY_RUN', actor = 'System') {
    const rule = this.findRawRule(id);
    const oldStatus = rule.status;
    rule.status = status;
    rule.updatedAt = new Date();
    await awaitPersist(rule);
    this.logAudit('RULE_STATUS_TOGGLED', rule.id, { oldStatus, newStatus: status }, actor);
    return rule;
  }

  async testRuleSimulation(dto: TestRuleSimulationDto) {
    // Safe simulation against historical conversions without mutating records
    const conversions = dbStore.conversions;
    const windowMinutes = dto.conditions?.windowMinutes || 10;
    const threshold = dto.conditions?.threshold || 5;

    let matchedEvents = 0;
    let simulatedExposurePaise = 0;

    // Evaluate group clusters by affiliate
    const affiliateMap = new Map<string, number>();
    conversions.forEach((c) => {
      affiliateMap.set(c.affiliateId, (affiliateMap.get(c.affiliateId) || 0) + 1);
      if ((affiliateMap.get(c.affiliateId) || 0) >= threshold) {
        matchedEvents++;
        simulatedExposurePaise += Math.round((c.amount || 0) * 100 * 0.15); // 15% estimated comm
      }
    });

    return {
      simulationPeriod: dto.period || '30d',
      totalEvaluated: conversions.length,
      matchedEvents,
      simulatedAlertsCount: Math.ceil(matchedEvents / threshold),
      simulatedExposurePaise,
      currency: 'INR',
      isDryRun: true,
      message: 'Simulation completed safely on historical telemetry with zero mutations.',
    };
  }

  // =========================================================================
  // 5. RISK SIGNALS STREAM
  // =========================================================================
  async getSignals(query?: { category?: string; detected?: boolean; search?: string }) {
    this.ensureSeedData();
    let rows = [...dbStore.fraudSignals];

    if (query?.category && query.category !== 'ALL') {
      rows = rows.filter((s) => s.category === query.category);
    }
    if (query?.detected !== undefined) {
      rows = rows.filter((s) => s.detected === query.detected);
    }
    if (query?.search) {
      const q = query.search.toLowerCase();
      rows = rows.filter(
        (s) => s.signalCode.toLowerCase().includes(q) || s.reason.toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return rows;
  }

  // =========================================================================
  // 6. HOLDS OPERATIONS (CONVERSIONS, COMMISSIONS, PAYOUTS)
  // =========================================================================
  async getHolds(query?: { entityType?: string; status?: string; search?: string }) {
    this.ensureSeedData();
    let rows = [...dbStore.fraudHolds];

    if (query?.entityType && query.entityType !== 'ALL') {
      rows = rows.filter((h) => h.entityType === query.entityType);
    }
    if (query?.status && query.status !== 'ALL') {
      rows = rows.filter((h) => h.status === query.status);
    }
    if (query?.search) {
      const q = query.search.toLowerCase();
      rows = rows.filter(
        (h) => h.holdNumber.toLowerCase().includes(q) || h.reason.toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return rows.map((h) => this.expandHold(h));
  }

  async placeHold(dto: CreateFraudHoldDto, actor = 'System') {
    const holdNumber = `HLD-${String(dbStore.fraudHolds.length + 101).padStart(6, '0')}`;
    const hold: FraudHoldEntity = {
      id: uuidv4(),
      holdNumber,
      entityType: dto.entityType,
      entityId: dto.entityId,
      amountPaise: dto.amountPaise,
      currency: dto.currency || 'INR',
      reason: dto.reason,
      alertId: dto.alertId,
      investigationId: dto.investigationId,
      status: 'ACTIVE',
      createdBy: actor,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.fraudHolds.push(hold);
    await awaitPersist(hold);
    this.logAudit('HOLD_CREATED', hold.id, { holdNumber, entityType: dto.entityType, amountPaise: dto.amountPaise }, actor);
    return hold;
  }

  async releaseHold(id: string, reason: string, actor = 'System') {
    const hold = dbStore.fraudHolds.find((h) => h.id === id || h.holdNumber === id);
    if (!hold) throw new NotFoundException('Fraud Hold not found');

    hold.status = 'RELEASED';
    hold.releasedAt = new Date();
    hold.releasedBy = actor;
    hold.releaseReason = reason;
    hold.updatedAt = new Date();
    await awaitPersist(hold);

    this.logAudit('HOLD_RELEASED', hold.id, { holdNumber: hold.holdNumber, reason }, actor);
    return hold;
  }

  // =========================================================================
  // 7. PATTERN INTELLIGENCE & PRIVACY-MASKED DEVICE / NETWORK
  // =========================================================================
  async getPatterns() {
    this.ensureSeedData();
    return [
      {
        id: 'pat-1',
        title: 'High-Frequency Conversion Burst',
        category: 'VELOCITY',
        severity: 'CRITICAL',
        description: '8 conversions recorded within 4 minutes from the same device cluster',
        evidence: 'Expected: <2 conversions/15m. Observed: 8 conversions/4m (+300% deviation)',
        affectedAffiliatesCount: 1,
        exposurePaise: 4200000,
        status: 'UNDER_INVESTIGATION',
        detectedAt: new Date(Date.now() - 3600000 * 4),
      },
      {
        id: 'pat-2',
        title: 'Multi-Affiliate Shared Device Fingerprint',
        category: 'DEVICE_SHARING',
        severity: 'HIGH',
        description: 'Device fingerprint df_883a9f shared across 3 distinct affiliate accounts',
        evidence: 'Expected: Unique hardware fingerprints. Observed: 3 partner identities sharing identical browser profile',
        affectedAffiliatesCount: 3,
        exposurePaise: 1850000,
        status: 'ACTIVE_HOLD',
        detectedAt: new Date(Date.now() - 3600000 * 18),
      },
      {
        id: 'pat-3',
        title: 'Self-Referral Purchase Anomaly',
        category: 'ATTRIBUTION',
        severity: 'HIGH',
        description: 'Customer email domain and payment card billing name matches affiliate registration profile',
        evidence: 'Affiliate email: rahul.m@growth.in vs Customer: rahul.m@gmail.com with identical billing hash',
        affectedAffiliatesCount: 1,
        exposurePaise: 1250000,
        status: 'ACTION_REQUIRED',
        detectedAt: new Date(Date.now() - 3600000 * 32),
      },
      {
        id: 'pat-4',
        title: 'Subnet Proxy / Datacenter IP Velocity',
        category: 'NETWORK',
        severity: 'MEDIUM',
        description: '14 conversions routed through known AWS / DigitalOcean commercial IP blocks',
        evidence: 'Expected: Residential ISPs. Observed: AS16509 (Amazon.com) hosting infrastructure',
        affectedAffiliatesCount: 2,
        exposurePaise: 950000,
        status: 'MONITORING',
        detectedAt: new Date(Date.now() - 3600000 * 48),
      },
    ];
  }

  async getDeviceNetwork() {
    this.ensureSeedData();
    // Privacy-masked device fingerprints and IP patterns
    return [
      {
        id: 'dev-1',
        maskedFingerprint: 'df_883a***9f2a',
        maskedIp: '103.214.***.42',
        isp: 'Airtel Broadband India',
        associatedAffiliates: ['Rahul Sharma', 'Vikas Tech Partners'],
        conversionsCount: 14,
        riskSignalsCount: 4,
        firstSeen: new Date(Date.now() - 86400000 * 12),
        lastSeen: new Date(Date.now() - 3600000 * 2),
        isProxyOrVpn: false,
      },
      {
        id: 'dev-2',
        maskedFingerprint: 'df_41c9***bc71',
        maskedIp: '49.36.***.18',
        isp: 'Reliance Jio Infocomm',
        associatedAffiliates: ['Direct Edge Media'],
        conversionsCount: 8,
        riskSignalsCount: 2,
        firstSeen: new Date(Date.now() - 86400000 * 5),
        lastSeen: new Date(Date.now() - 3600000 * 14),
        isProxyOrVpn: false,
      },
      {
        id: 'dev-3',
        maskedFingerprint: 'df_190e***fa33',
        maskedIp: '13.233.***.91',
        isp: 'Amazon Data Services India',
        associatedAffiliates: ['CloudScale Affiliates'],
        conversionsCount: 22,
        riskSignalsCount: 6,
        firstSeen: new Date(Date.now() - 86400000 * 20),
        lastSeen: new Date(Date.now() - 3600000 * 6),
        isProxyOrVpn: true,
      },
    ];
  }

  async getExceptions() {
    this.ensureSeedData();
    return dbStore.fraudExceptions;
  }

  async getAuditLogs() {
    return dbStore.auditLogs
      .filter((l) => l.action.startsWith('FRAUD_') || l.action.startsWith('RULE_') || l.action.startsWith('HOLD_') || l.action.startsWith('ALERT_') || l.action.startsWith('INVESTIGATION_'))
      .slice(-50)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // =========================================================================
  // HELPER METHODS & SEED DATA INITIALIZATION
  // =========================================================================
  private expandAlert(a: FraudAlertEntity) {
    const affiliate = dbStore.affiliates.find((x) => x.id === a.affiliateId);
    const program = dbStore.programs.find((x) => x.id === a.programId);
    const org = dbStore.organizations.find((x) => x.id === a.organizationId);

    return {
      ...a,
      affiliateName: affiliate ? (affiliate.displayName || affiliate.companyName || 'Partner') : 'Unknown Partner',
      affiliateEmail: affiliate?.email || 'N/A',
      programName: program?.name || 'SaaS Growth Program',
      organizationName: org?.name || 'PartnerIQ Platform',
    };
  }

  private expandInvestigation(i: FraudInvestigationEntity) {
    const affiliate = dbStore.affiliates.find((x) => x.id === i.affiliateId);
    const program = dbStore.programs.find((x) => x.id === i.programId);
    const org = dbStore.organizations.find((x) => x.id === i.organizationId);

    return {
      ...i,
      affiliateName: affiliate ? (affiliate.displayName || affiliate.companyName || 'Affiliate Partner') : 'Affiliate Partner',
      affiliateEmail: affiliate?.email || 'N/A',
      programName: program?.name || 'Growth Partnership',
      organizationName: org?.name || 'PartnerIQ Platform',
    };
  }

  private expandHold(h: FraudHoldEntity) {
    const affiliate = dbStore.affiliates.find((x) => x.id === h.affiliateId);
    const org = dbStore.organizations.find((x) => x.id === h.organizationId);

    return {
      ...h,
      affiliateName: affiliate ? (affiliate.displayName || affiliate.companyName || 'Partner Account') : 'Partner Account',
      organizationName: org?.name || 'Platform',
    };
  }

  private generateTimeline(days: number) {
    const timeline = [];
    const now = Date.now();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now - i * 86400000).toISOString().split('T')[0];
      const signalsDetected = Math.max(1, Math.round((Math.sin(i * 0.4) + 1.5) * 4));
      const alertsCreated = Math.max(0, Math.round(signalsDetected * 0.35));
      const investigationsOpened = alertsCreated > 2 ? 1 : 0;
      const preventedAmountPaise = alertsCreated * 450000;

      timeline.push({
        date,
        signalsDetected,
        alertsCreated,
        investigationsOpened,
        preventedAmountPaise,
      });
    }
    return timeline;
  }

  private logAudit(action: string, entityId: string, details: any, actor = 'System') {
    dbStore.auditLogs.push({
      id: uuidv4(),
      action: action as any,
      resourceType: 'FRAUD_INTELLIGENCE' as any,
      resourceId: entityId,
      actorType: 'USER' as any,
      actorId: actor.includes('-') && actor.length === 36 ? actor : uuidv4(),
      metadata: details,
      createdAt: new Date(),
    });
  }

  private ensureSeedData() {
    if (dbStore.fraudRules.length > 0) return;

    // 1. Seed Rules
    const r1: FraudRuleEntity = {
      id: uuidv4(),
      name: 'Conversion Velocity Spike Detection',
      code: 'CONVERSION_VELOCITY_SPIKE',
      description: 'Flags anomalous surges where an affiliate generates more than 5 conversions within 5 minutes.',
      category: 'CONVERSION_ANOMALY',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      currentVersion: 1,
      conditions: { metric: 'conversion_count', windowMinutes: 5, operator: 'GT', threshold: 5 },
      actions: { createAlert: true, createInvestigation: true, placeHold: true, holdTarget: 'COMMISSION' },
      triggerCount: 0,
      lastTriggeredAt: undefined,
      createdBy: 'System Engine',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const r2: FraudRuleEntity = {
      id: uuidv4(),
      name: 'Shared Device Hardware Cluster',
      code: 'SHARED_DEVICE_FINGERPRINT',
      description: 'Triggers when a single browser or device fingerprint is associated with multiple distinct affiliate IDs.',
      category: 'DEVICE_NETWORK',
      severity: 'HIGH',
      status: 'ACTIVE',
      currentVersion: 1,
      conditions: { metric: 'distinct_affiliates_per_device', operator: 'GT', threshold: 1 },
      actions: { createAlert: true, createInvestigation: true, placeHold: false },
      triggerCount: 0,
      lastTriggeredAt: undefined,
      createdBy: 'System Engine',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const r3: FraudRuleEntity = {
      id: uuidv4(),
      name: 'Self-Referral Identity Match',
      code: 'SELF_REFERRAL_IDENTITY',
      description: 'Detects purchases where the buyer email, IP, or payment card matches the promoting affiliate profile.',
      category: 'AFFILIATE_BEHAVIOR',
      severity: 'HIGH',
      status: 'ACTIVE',
      currentVersion: 1,
      conditions: { metric: 'identity_match_ratio', operator: 'GT', threshold: 0.8 },
      actions: { createAlert: true, createInvestigation: true, placeHold: true, holdTarget: 'COMMISSION' },
      triggerCount: 0,
      lastTriggeredAt: undefined,
      createdBy: 'System Engine',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const r4: FraudRuleEntity = {
      id: uuidv4(),
      name: 'Datacenter / Commercial Proxy IP Block',
      code: 'DATACENTER_PROXY_IP',
      description: 'Monitors conversions originating from AWS, DigitalOcean, or commercial VPN subnets rather than residential ISPs.',
      category: 'DEVICE_NETWORK',
      severity: 'MEDIUM',
      status: 'DRY_RUN',
      currentVersion: 1,
      conditions: { metric: 'ip_is_datacenter', operator: 'EQUALS', threshold: true },
      actions: { createAlert: true, notifyOnly: true },
      triggerCount: 0,
      lastTriggeredAt: undefined,
      createdBy: 'System Engine',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.fraudRules.push(r1, r2, r3, r4);

    // Rule Versions
    [r1, r2, r3, r4].forEach((r) => {
      dbStore.fraudRuleVersions.push({
        id: uuidv4(),
        ruleId: r.id,
        version: 1,
        conditions: r.conditions,
        actions: r.actions,
        severity: r.severity,
        effectiveFrom: new Date(Date.now() - 86400000 * 30),
        createdBy: 'System Engine',
        createdAt: new Date(Date.now() - 86400000 * 30),
      });
    });

    // Everything below this point is fabricated sample activity (fake
    // alerts/investigations/signals tied to invented customer names) used to
    // demo this dashboard locally. Explicit opt-in, independent of NODE_ENV —
    // see ENABLE_DEV_FIXTURES in .env.example. Alerts should only ever
    // reflect real detections against real accounts.
    if (process.env.ENABLE_DEV_FIXTURES !== 'true') return;

    // 2. Seed Alerts
    const a1: FraudAlertEntity = {
      id: uuidv4(),
      alertNumber: 'FR-000101',
      title: 'High-Frequency Conversion Burst Detected',
      severity: 'CRITICAL',
      severityReason: 'Observed 8 conversions within 4 minutes originating from device fingerprint df_883a9f.',
      status: 'OPEN',
      signalCode: 'CONVERSION_VELOCITY',
      signalCategory: 'CONVERSION_ANOMALY',
      evidenceSummary: {
        signal: 'CONVERSION_VELOCITY',
        observedValue: '8 conversions / 4 min',
        expectedBaseline: 'Low-frequency unique sessions (<2 / 15 min)',
        threshold: '5 conversions / 5 min',
        difference: '+160%',
        timestamp: new Date(Date.now() - 3600000 * 3).toISOString(),
        source: 'Conversion Event Telemetry',
      },
      financialExposurePaise: 4200000, // ₹42,000
      assignedTo: 'Vikram Mehta (Lead Risk Analyst)',
      createdAt: new Date(Date.now() - 3600000 * 3),
      updatedAt: new Date(Date.now() - 3600000 * 3),
    };

    const a2: FraudAlertEntity = {
      id: uuidv4(),
      alertNumber: 'FR-000102',
      title: 'Shared Hardware Fingerprint Across Multiple Affiliates',
      severity: 'HIGH',
      severityReason: 'Hardware device fingerprint df_883a9f recorded across 3 distinct affiliate registration profiles.',
      status: 'ACKNOWLEDGED',
      signalCode: 'DEVICE_REUSE_CLUSTER',
      signalCategory: 'DEVICE_NETWORK',
      evidenceSummary: {
        signal: 'DEVICE_REUSE_CLUSTER',
        observedValue: '3 distinct affiliate accounts',
        expectedBaseline: '1 affiliate per hardware fingerprint',
        threshold: '1 affiliate account',
        difference: '+200%',
        timestamp: new Date(Date.now() - 3600000 * 14).toISOString(),
        source: 'Device Fingerprint Ingestion Engine',
      },
      financialExposurePaise: 1850000, // ₹18,500
      assignedTo: 'Aditi Rao (Risk Specialist)',
      acknowledgedAt: new Date(Date.now() - 3600000 * 10),
      createdAt: new Date(Date.now() - 3600000 * 14),
      updatedAt: new Date(Date.now() - 3600000 * 10),
    };

    const a3: FraudAlertEntity = {
      id: uuidv4(),
      alertNumber: 'FR-000103',
      title: 'Self-Referral Customer Billing Name Match',
      severity: 'HIGH',
      severityReason: 'Customer card billing name matches promoting affiliate identity profile.',
      status: 'OPEN',
      signalCode: 'SELF_REFERRAL_NAME_MATCH',
      signalCategory: 'AFFILIATE_BEHAVIOR',
      evidenceSummary: {
        signal: 'SELF_REFERRAL_NAME_MATCH',
        observedValue: 'Identical name hash (Rahul Sharma)',
        expectedBaseline: 'Independent organic or referral customer',
        threshold: 'Identity difference score > 80%',
        difference: '100% Identity Match',
        timestamp: new Date(Date.now() - 3600000 * 28).toISOString(),
        source: 'Attribution & Payment Webhook Ingestion',
      },
      financialExposurePaise: 1250000, // ₹12,500
      createdAt: new Date(Date.now() - 3600000 * 28),
      updatedAt: new Date(Date.now() - 3600000 * 28),
    };

    dbStore.fraudAlerts.push(a1, a2, a3);

    // 3. Seed Investigations
    const inv1: FraudInvestigationEntity = {
      id: uuidv4(),
      caseNumber: 'INV-000201',
      title: 'Investigation: Conversion Velocity Surge on Campaign Q3',
      severity: 'CRITICAL',
      status: 'INVESTIGATING',
      assignedTo: 'Vikram Mehta (Lead Risk Analyst)',
      assignedAt: new Date(Date.now() - 3600000 * 2),
      financialExposurePaise: 4200000,
      linkedAlertIds: [a1.id],
      notes: [
        {
          id: uuidv4(),
          author: 'Vikram Mehta',
          text: 'Verified 8 orders placed in rapid succession. Billing addresses resolve to a single commercial IP range.',
          timestamp: new Date(Date.now() - 3600000 * 2),
        },
      ],
      timeline: [
        {
          timestamp: new Date(Date.now() - 3600000 * 3),
          event: 'ALERT_TRIGGERED',
          description: 'Rule CONVERSION_VELOCITY_SPIKE triggered by 8 rapid orders',
          actor: 'System Engine',
        },
        {
          timestamp: new Date(Date.now() - 3600000 * 2),
          event: 'INVESTIGATION_OPENED',
          description: 'Case opened and assigned to Vikram Mehta',
          actor: 'Vikram Mehta',
        },
        {
          timestamp: new Date(Date.now() - 3600000 * 2),
          event: 'COMMISSION_HOLD_PLACED',
          description: 'Automatic hold placed on ₹42,000 eligible commission',
          actor: 'System Engine',
        },
      ],
      openedAt: new Date(Date.now() - 3600000 * 2),
      createdAt: new Date(Date.now() - 3600000 * 2),
      updatedAt: new Date(Date.now() - 3600000 * 2),
    };

    const inv2: FraudInvestigationEntity = {
      id: uuidv4(),
      caseNumber: 'INV-000202',
      title: 'Investigation: Shared Fingerprint Cluster Review',
      severity: 'HIGH',
      status: 'ACTION_REQUIRED',
      assignedTo: 'Aditi Rao (Risk Specialist)',
      assignedAt: new Date(Date.now() - 3600000 * 10),
      financialExposurePaise: 1850000,
      linkedAlertIds: [a2.id],
      notes: [
        {
          id: uuidv4(),
          author: 'Aditi Rao',
          text: 'Requested KYC verification documents from all 3 registered partner accounts.',
          timestamp: new Date(Date.now() - 3600000 * 8),
        },
      ],
      timeline: [
        {
          timestamp: new Date(Date.now() - 3600000 * 14),
          event: 'ALERT_TRIGGERED',
          description: 'Hardware fingerprint reused across 3 accounts',
          actor: 'System Engine',
        },
        {
          timestamp: new Date(Date.now() - 3600000 * 10),
          event: 'INVESTIGATION_ASSIGNED',
          description: 'Assigned to Aditi Rao',
          actor: 'System Engine',
        },
      ],
      openedAt: new Date(Date.now() - 3600000 * 10),
      createdAt: new Date(Date.now() - 3600000 * 10),
      updatedAt: new Date(Date.now() - 3600000 * 10),
    };

    dbStore.fraudInvestigations.push(inv1, inv2);

    // 4. Seed Holds
    const h1: FraudHoldEntity = {
      id: uuidv4(),
      holdNumber: 'HLD-000301',
      entityType: 'COMMISSION',
      entityId: uuidv4(),
      amountPaise: 4200000, // ₹42,000
      currency: 'INR',
      reason: 'Automatic risk hold placed due to Rule CONVERSION_VELOCITY_SPIKE (Alert FR-000101)',
      alertId: a1.id,
      investigationId: inv1.id,
      status: 'ACTIVE',
      createdBy: 'System Engine',
      createdAt: new Date(Date.now() - 3600000 * 3),
      updatedAt: new Date(Date.now() - 3600000 * 3),
    };

    const h2: FraudHoldEntity = {
      id: uuidv4(),
      holdNumber: 'HLD-000302',
      entityType: 'PAYOUT',
      entityId: uuidv4(),
      amountPaise: 1850000, // ₹18,500
      currency: 'INR',
      reason: 'Payout blocked pending investigation of shared device hardware cluster (Alert FR-000102)',
      alertId: a2.id,
      investigationId: inv2.id,
      status: 'ACTIVE',
      createdBy: 'System Engine',
      createdAt: new Date(Date.now() - 3600000 * 14),
      updatedAt: new Date(Date.now() - 3600000 * 14),
    };

    dbStore.fraudHolds.push(h1, h2);

    // 5. Seed Real Risk Signals
    const s1 = {
      id: uuidv4(),
      assessmentId: uuidv4(),
      signalCode: 'CONVERSION_BURST_VELOCITY',
      category: 'VELOCITY',
      detected: true,
      score: 88,
      confidence: 95,
      reason: 'Observed 8 conversions in 4 minutes against expected baseline of <2 / 15m',
      metadata: {
        observedValue: '8 conversions / 4m',
        expectedBaseline: '< 2 conversions / 15m',
        threshold: '5 conversions / 5m',
        difference: '+160%',
        source: 'Event Telemetry',
        entityId: 'conv-burst-01',
      },
      createdAt: new Date(Date.now() - 3600000 * 3),
    };

    const s2 = {
      id: uuidv4(),
      assessmentId: uuidv4(),
      signalCode: 'SHARED_FINGERPRINT_MULTIPLE_ACCOUNTS',
      category: 'DEVICE_NETWORK',
      detected: true,
      score: 79,
      confidence: 92,
      reason: 'Hardware fingerprint df_883a9f recorded across 3 distinct affiliate accounts',
      metadata: {
        observedValue: '3 accounts on 1 device',
        expectedBaseline: '1 account / device',
        threshold: '1 account',
        difference: '+200%',
        source: 'Device Fingerprint Ingestion',
        entityId: 'dev-cluster-01',
      },
      createdAt: new Date(Date.now() - 3600000 * 14),
    };

    const s3 = {
      id: uuidv4(),
      assessmentId: uuidv4(),
      signalCode: 'AFFILIATE_CUSTOMER_IDENTITY_COLLISION',
      category: 'ATTRIBUTION',
      detected: true,
      score: 75,
      confidence: 90,
      reason: 'Customer payment billing name directly matches affiliate registration profile (Rahul Sharma)',
      metadata: {
        observedValue: 'Rahul Sharma (Customer == Affiliate)',
        expectedBaseline: 'Independent third-party customer',
        threshold: 'Identity difference > 80%',
        difference: '100% Match',
        source: 'Payment Webhook Hash',
        entityId: 'aff-self-ref-01',
      },
      createdAt: new Date(Date.now() - 3600000 * 28),
    };

    const s4 = {
      id: uuidv4(),
      assessmentId: uuidv4(),
      signalCode: 'COMMERCIAL_DATACENTER_PROXY_BURST',
      category: 'NETWORK',
      detected: true,
      score: 62,
      confidence: 85,
      reason: '14 conversions routed through AWS AS16509 IP ranges rather than residential broadband',
      metadata: {
        observedValue: '14 AWS hosting IPs',
        expectedBaseline: 'Residential / Mobile ISP',
        threshold: '0 datacenter IPs',
        difference: 'Commercial ASN detected',
        source: 'IP Geo & Proxy Pipeline',
        entityId: 'net-proxy-01',
      },
      createdAt: new Date(Date.now() - 3600000 * 48),
    };

    dbStore.fraudSignals.push(s1 as any, s2 as any, s3 as any, s4 as any);

    // 6. Seed Exceptions
    const exc1: FraudExceptionEntity = {
      id: uuidv4(),
      type: 'DEVICE_DATA_UNAVAILABLE',
      title: 'Client Fingerprint Payload Truncated',
      description: 'Incoming browser fingerprint payload contained corrupted canvas hash from Safari iOS client.',
      entityType: 'CLICK',
      entityId: uuidv4(),
      detectedAt: new Date(Date.now() - 3600000 * 5),
      retryState: 'RESOLVED_DEFAULT_FALLBACK',
      currentImpact: 'LOW',
      createdAt: new Date(Date.now() - 3600000 * 5),
    };

    dbStore.fraudExceptions.push(exc1);
  }
}
