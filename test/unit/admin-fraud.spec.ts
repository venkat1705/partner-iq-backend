import { describe, it, expect, beforeEach } from '@jest/globals';
import { AdminFraudService } from '../../src/modules/fraud/admin-fraud.service';

describe('Admin Fraud Intelligence Operations Center Test Suite', () => {
  let service: AdminFraudService;

  beforeEach(() => {
    service = new AdminFraudService();
  });

  it('computes flagship overview KPIs and real financial exposure', async () => {
    const overview = await service.getOverview('30d');
    expect(overview).toBeDefined();
    expect(overview.kpis).toBeDefined();
    expect(overview.kpis.activeAlertsCount).toBeGreaterThanOrEqual(0);
    expect(overview.kpis.financialExposure).toBeDefined();
    expect(overview.kpis.financialExposure.currency).toBe('INR');
    expect(Array.isArray(overview.timeline)).toBe(true);
    expect(overview.timeline.length).toBe(30);
    expect(Array.isArray(overview.ruleActivity)).toBe(true);
    expect(Array.isArray(overview.recentActivity)).toBe(true);
  });

  it('lists alerts and acknowledges an alert', async () => {
    const alerts = await service.getAlerts();
    expect(alerts.length).toBeGreaterThan(0);
    const firstAlert = alerts[0];
    expect(firstAlert.alertNumber.startsWith('FR-')).toBe(true);
    expect(firstAlert.evidenceSummary).toBeDefined();

    const ackAlert = await service.acknowledgeAlert(firstAlert.id, 'admin@example.test');
    expect(ackAlert.status).toBe('ACKNOWLEDGED');
    expect(ackAlert.acknowledgedAt).toBeDefined();
  });

  it('creates an investigation case from an alert', async () => {
    const alerts = await service.getAlerts();
    const alert = alerts[0];
    const investigation = await service.createInvestigationFromAlert(alert.id, 'analyst@example.test');
    expect(investigation).toBeDefined();
    expect(investigation.caseNumber.startsWith('INV-')).toBe(true);
    expect(investigation.status).toBe('INVESTIGATING');
    expect(investigation.linkedAlertIds?.includes(alert.id)).toBe(true);
  });

  it('creates a new fraud rule and tests simulation safely', async () => {
    const rule = await service.createRule(
      {
        name: 'Rapid Conversion Velocity Test',
        code: `TEST_VELOCITY_SPIKE_${Date.now()}`,
        description: 'Test rule for rapid velocity thresholding',
        category: 'CONVERSION_ANOMALY',
        severity: 'HIGH',
        status: 'DRY_RUN',
        conditions: { metric: 'conversion_count', windowMinutes: 5, operator: 'GT', threshold: 5 },
        actions: { createAlert: true, placeHold: true },
      },
      'admin@example.test'
    );

    expect(rule).toBeDefined();
    expect(rule.currentVersion).toBe(1);
    expect(rule.status).toBe('DRY_RUN');

    const simulation = await service.testRuleSimulation({
      conditions: rule.conditions,
      period: '30d',
    });

    expect(simulation).toBeDefined();
    expect(simulation.isDryRun).toBe(true);
    expect(simulation.totalEvaluated).toBeGreaterThanOrEqual(0);
  });

  it('places and releases a protective financial hold', async () => {
    const hold = await service.placeHold(
      {
        entityType: 'COMMISSION',
        entityId: 'c1234567-0000-0000-0000-000000000001',
        amountPaise: 2500000,
        currency: 'INR',
        reason: 'Hold placed for compliance review',
      },
      'admin@example.test'
    );

    expect(hold).toBeDefined();
    expect(hold.holdNumber.startsWith('HLD-')).toBe(true);
    expect(hold.status).toBe('ACTIVE');
    expect(hold.amountPaise).toBe(2500000);

    const released = await service.releaseHold(hold.id, 'Partner provided valid order verification', 'admin@example.test');
    expect(released.status).toBe('RELEASED');
    expect(released.releasedAt).toBeDefined();
  });

  it('returns patterns and masked device network intelligence', async () => {
    const patterns = await service.getPatterns();
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);

    const deviceNetwork = await service.getDeviceNetwork();
    expect(Array.isArray(deviceNetwork)).toBe(true);
    expect(deviceNetwork[0].maskedIp.includes('***')).toBe(true);
    expect(deviceNetwork[0].maskedFingerprint.includes('***')).toBe(true);
  });
});

