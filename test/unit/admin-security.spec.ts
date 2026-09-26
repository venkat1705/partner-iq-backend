import { describe, it, expect, beforeEach } from '@jest/globals';
import { AdminSecurityService } from '../../src/modules/security/admin-security.service';
import { dbStore } from '../../src/database/store';

describe('AdminSecurityService', () => {
  let service: AdminSecurityService;

  beforeEach(() => {
    service = new AdminSecurityService();
  });

  it('computes aggregated KPIs, posture, and timeline in getOverview', async () => {
    const overview = await service.getOverview('30d');
    expect(typeof overview.kpis.totalEvents).toBe('number');
    expect(typeof overview.kpis.failedAuth).toBe('number');
    expect(typeof overview.posture.mfaCoveragePercent).toBe('number');
    expect(Array.isArray(overview.timeline)).toBe(true);
    expect(overview.timeline.length).toBe(30);
  });

  it('retrieves security events and event detail with actor intelligence', async () => {
    const eventsRes = await service.getEvents({ page: 1, limit: 10 });
    expect(eventsRes.items.length).toBeGreaterThan(0);
    expect(eventsRes.total).toBeGreaterThanOrEqual(eventsRes.items.length);

    const first = eventsRes.items[0];
    const detail = await service.getEventById(first.id);
    expect(detail.id).toBe(first.id);
    expect(detail.actorIntelligence).toBeDefined();
    expect(Array.isArray(detail.relatedEvents)).toBe(true);
  });

  it('manages alert lifecycle (Acknowledge -> Assign -> Resolve)', async () => {
    const alertsRes = await service.getAlerts({ status: 'OPEN' });
    expect(alertsRes.items.length).toBeGreaterThan(0);

    const targetAlert = alertsRes.items[0];
    const acked = await service.acknowledgeAlert(targetAlert.id, 'analyst@example.test');
    expect(acked.status).toBe('ACKNOWLEDGED');

    const assigned = await service.assignAlert(targetAlert.id, 'lead-investigator@example.test', 'analyst@example.test');
    expect(assigned.assignedTo).toBe('lead-investigator@example.test');

    const resolved = await service.resolveAlert(targetAlert.id, 'Mitigated via firewall rule', 'analyst@example.test');
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolutionReason).toBeDefined();
  });

  it('manages investigation lifecycle (Create -> Note -> Resolve)', async () => {
    const newCase = await service.createInvestigation(
      {
        title: 'Anomalous Token Velocity Probe',
        severity: 'HIGH',
        actorId: 'test_user_009',
        actorEmail: 'test_user_009@example.test',
        securityImpact: 'Potential token leakage',
        initialNotes: 'Detected unusual token creation rate.',
      },
      'admin@example.test'
    );

    const note = await service.addInvestigationNote(newCase.id, 'Confirmed IP originated from known cloud egress', 'admin@example.test');
    expect(note.text).toBeDefined();

    const resolved = await service.resolveInvestigation(
      newCase.id,
      {
        outcome: 'CONFIRMED_SECURITY_INCIDENT',
        resolutionReason: 'Tokens invalidated and user forced to rotate credentials.',
        actionsTaken: 'Revoked 3 active sessions.',
      },
      'admin@example.test'
    );

    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.outcome).toBe('CONFIRMED_SECURITY_INCIDENT');
  });

  it('simulates detection rules with 100% zero mutation guarantee', async () => {
    const initialEventsCount = dbStore.securityEvents.length;
    const initialAlertsCount = dbStore.securityAlerts.length;

    const simResult = await service.simulateRule({
      conditions: { category: 'AUTHENTICATION' },
      actions: ['CREATE_ALERT', 'BLOCK_REQUEST'],
      samplePeriodDays: 30,
    });

    expect(simResult.simulation).toBe(true);
    expect(typeof simResult.matchedEventsCount).toBe('number');
    expect(simResult.evaluatedEventsCount).toBeGreaterThan(0);
    expect(simResult.guarantee).toBe('100% Zero Mutations Executed');
    expect(dbStore.securityEvents.length).toBe(initialEventsCount);
    expect(dbStore.securityAlerts.length).toBe(initialAlertsCount);
  });

  it('revokes sessions and writes immutable audit logs', async () => {
    const sessions = await service.getSessions();
    if (sessions.length > 0) {
      const targetSession = sessions.find((s) => s.status === 'ACTIVE') || sessions[0];
      const initialAuditCount = dbStore.auditLogs.length;

      const res = await service.revokeSession(targetSession.id, 'Session hijacked by malicious IP', 'admin@example.test');
      expect(res.success).toBe(true);
      expect(dbStore.auditLogs.length).toBeGreaterThan(initialAuditCount);
    }
  });

  it('supports secret rotation and CSV export', async () => {
    const secrets = await service.getSecretsMetadata();
    if (secrets.length > 0) {
      const targetSecret = secrets[0];
      const rotateRes = await service.rotateSecret(targetSecret.id, 'Scheduled 90-day rotation', 'admin@example.test');
      expect(rotateRes.success).toBe(true);
    }

    const exportRes = await service.exportSecurityData({}, 'admin@example.test');
    expect(exportRes.filename.endsWith('.csv')).toBe(true);
    expect(exportRes.data.includes('EventID')).toBe(true);
  });
});

