import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AdminFraudService } from '../modules/fraud/admin-fraud.service';

describe('Admin Fraud Intelligence Operations Center Test Suite', () => {
  const service = new AdminFraudService();

  it('should compute flagship overview KPIs and real financial exposure', async () => {
    const overview = await service.getOverview('30d');
    assert.ok(overview, 'Overview must be defined');
    assert.ok(overview.kpis, 'KPIs must be defined');
    assert.ok(overview.kpis.activeAlertsCount >= 0, 'Active alerts count must be valid');
    assert.ok(overview.kpis.financialExposure, 'Financial exposure must be defined');
    assert.strictEqual(overview.kpis.financialExposure.currency, 'INR');
    assert.ok(Array.isArray(overview.timeline), 'Timeline must be an array');
    assert.strictEqual(overview.timeline.length, 30);
    assert.ok(Array.isArray(overview.ruleActivity), 'Rule activity must be an array');
    assert.ok(Array.isArray(overview.recentActivity), 'Recent activity must be an array');
  });

  it('should list alerts and acknowledge an alert', async () => {
    const alerts = await service.getAlerts();
    assert.ok(alerts.length > 0, 'Should have seed alerts');
    const firstAlert = alerts[0];
    assert.ok(firstAlert.alertNumber.startsWith('FR-'));
    assert.ok(firstAlert.evidenceSummary, 'Alert must have explainable evidence summary');

    const ackAlert = await service.acknowledgeAlert(firstAlert.id, 'admin@partneriq.in');
    assert.strictEqual(ackAlert.status, 'ACKNOWLEDGED');
    assert.ok(ackAlert.acknowledgedAt);
  });

  it('should create an investigation case from an alert', async () => {
    const alerts = await service.getAlerts();
    const alert = alerts[0];
    const investigation = await service.createInvestigationFromAlert(alert.id, 'analyst@partneriq.in');
    assert.ok(investigation);
    assert.ok(investigation.caseNumber.startsWith('INV-'));
    assert.strictEqual(investigation.status, 'INVESTIGATING');
    assert.ok(investigation.linkedAlertIds?.includes(alert.id));
  });

  it('should create a new fraud rule and test simulation safely', async () => {
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
      'admin@partneriq.in'
    );

    assert.ok(rule);
    assert.strictEqual(rule.currentVersion, 1);
    assert.strictEqual(rule.status, 'DRY_RUN');

    const simulation = await service.testRuleSimulation({
      conditions: rule.conditions,
      period: '30d',
    });

    assert.ok(simulation);
    assert.strictEqual(simulation.isDryRun, true);
    assert.ok(simulation.totalEvaluated >= 0);
  });

  it('should place and release a protective financial hold', async () => {
    const hold = await service.placeHold(
      {
        entityType: 'COMMISSION',
        entityId: 'c1234567-0000-0000-0000-000000000001',
        amountPaise: 2500000, // ₹25,000
        currency: 'INR',
        reason: 'Hold placed for compliance review',
      },
      'admin@partneriq.in'
    );

    assert.ok(hold);
    assert.ok(hold.holdNumber.startsWith('HLD-'));
    assert.strictEqual(hold.status, 'ACTIVE');
    assert.strictEqual(hold.amountPaise, 2500000);

    const released = await service.releaseHold(hold.id, 'Partner provided valid order verification', 'admin@partneriq.in');
    assert.strictEqual(released.status, 'RELEASED');
    assert.ok(released.releasedAt);
  });

  it('should return patterns and masked device network intelligence', async () => {
    const patterns = await service.getPatterns();
    assert.ok(Array.isArray(patterns));
    assert.ok(patterns.length > 0);

    const deviceNetwork = await service.getDeviceNetwork();
    assert.ok(Array.isArray(deviceNetwork));
    assert.ok(deviceNetwork[0].maskedIp.includes('***'), 'IP must be privacy-masked');
    assert.ok(deviceNetwork[0].maskedFingerprint.includes('***'), 'Fingerprint must be privacy-masked');
  });
});

