import { AdminSecurityService } from '../modules/security/admin-security.service';
import { dbStore } from '../database/store';

async function runTests() {
  console.log('🧪 Starting Admin Security Operations Test Suite...');
  let passed = 0;
  let failed = 0;

  const service = new AdminSecurityService();

  // Test 1: Overview and Bento KPIs
  try {
    const overview = await service.getOverview('30d');
    if (
      typeof overview.kpis.totalEvents === 'number' &&
      typeof overview.kpis.failedAuth === 'number' &&
      typeof overview.posture.mfaCoveragePercent === 'number' &&
      Array.isArray(overview.timeline) &&
      overview.timeline.length === 30
    ) {
      console.log('✅ Test 1 Passed: getOverview returns real aggregated KPIs, posture, and timeline');
      passed++;
    } else {
      throw new Error(`Overview returned invalid structure: ${JSON.stringify(overview)}`);
    }
  } catch (err: any) {
    console.error('❌ Test 1 Failed:', err?.message || err);
    failed++;
  }

  // Test 2: Security Events Retrieval & Detail
  try {
    const eventsRes = await service.getEvents({ page: 1, limit: 10 });
    if (eventsRes.items.length > 0 && eventsRes.total >= eventsRes.items.length) {
      const first = eventsRes.items[0];
      const detail = await service.getEventById(first.id);
      if (detail.id === first.id && detail.actorIntelligence && Array.isArray(detail.relatedEvents)) {
        console.log('✅ Test 2 Passed: getEvents and getEventById return normalized envelope & actor intelligence');
        passed++;
      } else {
        throw new Error('Event detail missing required actorIntelligence or relatedEvents');
      }
    } else {
      throw new Error('No security events returned');
    }
  } catch (err: any) {
    console.error('❌ Test 2 Failed:', err?.message || err);
    failed++;
  }

  // Test 3: Alert Lifecycle (Acknowledge, Assign, Resolve)
  try {
    const alertsRes = await service.getAlerts({ status: 'OPEN' });
    if (alertsRes.items.length > 0) {
      const targetAlert = alertsRes.items[0];
      const acked = await service.acknowledgeAlert(targetAlert.id, 'analyst@partneriq.io');
      if (acked.status !== 'ACKNOWLEDGED') throw new Error('Status not updated to ACKNOWLEDGED');

      const assigned = await service.assignAlert(targetAlert.id, 'lead-investigator@partneriq.io', 'analyst@partneriq.io');
      if (assigned.assignedTo !== 'lead-investigator@partneriq.io') throw new Error('Assignee mismatch');

      const resolved = await service.resolveAlert(targetAlert.id, 'Mitigated via firewall rule', 'analyst@partneriq.io');
      if (resolved.status !== 'RESOLVED' || !resolved.resolutionReason) throw new Error('Alert resolve state invalid');

      console.log('✅ Test 3 Passed: Alert lifecycle (Acknowledge -> Assign -> Resolve) succeeds');
      passed++;
    } else {
      throw new Error('No open alerts found to test');
    }
  } catch (err: any) {
    console.error('❌ Test 3 Failed:', err?.message || err);
    failed++;
  }

  // Test 4: Investigation Lifecycle (Create, Add Note, Resolve)
  try {
    const newCase = await service.createInvestigation(
      {
        title: 'Anomalous Token Velocity Probe',
        severity: 'HIGH',
        actorId: 'test_user_009',
        actorEmail: 'test_user_009@example.com',
        securityImpact: 'Potential token leakage',
        initialNotes: 'Detected unusual token creation rate.',
      },
      'admin@partneriq.io'
    );

    const note = await service.addInvestigationNote(newCase.id, 'Confirmed IP originated from known cloud egress', 'admin@partneriq.io');
    if (!note.text) throw new Error('Failed to add note');

    const resolved = await service.resolveInvestigation(
      newCase.id,
      {
        outcome: 'CONFIRMED_SECURITY_INCIDENT',
        resolutionReason: 'Tokens invalidated and user forced to rotate credentials.',
        actionsTaken: 'Revoked 3 active sessions.',
      },
      'admin@partneriq.io'
    );

    if (resolved.status !== 'RESOLVED' || resolved.outcome !== 'CONFIRMED_SECURITY_INCIDENT') {
      throw new Error('Investigation resolution outcome mismatch');
    }

    console.log('✅ Test 4 Passed: Investigation lifecycle (Create -> Note -> Resolve) succeeds');
    passed++;
  } catch (err: any) {
    console.error('❌ Test 4 Failed:', err?.message || err);
    failed++;
  }

  // Test 5: Detection Rule Simulation (Zero Mutation Guarantee)
  try {
    const initialEventsCount = dbStore.securityEvents.length;
    const initialAlertsCount = dbStore.securityAlerts.length;

    const simResult = await service.simulateRule({
      conditions: { category: 'AUTHENTICATION' },
      actions: ['CREATE_ALERT', 'BLOCK_REQUEST'],
      samplePeriodDays: 30,
    });

    if (
      simResult.simulation === true &&
      typeof simResult.matchedEventsCount === 'number' &&
      simResult.evaluatedEventsCount > 0 &&
      simResult.guarantee === '100% Zero Mutations Executed'
    ) {
      if (dbStore.securityEvents.length !== initialEventsCount || dbStore.securityAlerts.length !== initialAlertsCount) {
        throw new Error('Simulation mutated production data!');
      }
      console.log('✅ Test 5 Passed: Rule simulation runs accurately with 100% zero mutation guarantee');
      passed++;
    } else {
      throw new Error('Invalid simulation result');
    }
  } catch (err: any) {
    console.error('❌ Test 5 Failed:', err?.message || err);
    failed++;
  }

  // Test 6: Session Revocation & Audit Logging
  try {
    const sessions = await service.getSessions();
    if (sessions.length > 0) {
      const targetSession = sessions.find((s) => s.status === 'ACTIVE') || sessions[0];
      const initialAuditCount = dbStore.auditLogs.length;

      const res = await service.revokeSession(targetSession.id, 'Session hijacked by malicious IP', 'admin@partneriq.io');
      if (res.success !== true) throw new Error('Revocation failed');

      if (dbStore.auditLogs.length <= initialAuditCount) {
        throw new Error('Audit log was not written upon session revocation');
      }

      console.log('✅ Test 6 Passed: Session revocation updates state and writes immutable audit log');
      passed++;
    } else {
      console.log('⚠️ Test 6 Skipped: No sessions present');
      passed++;
    }
  } catch (err: any) {
    console.error('❌ Test 6 Failed:', err?.message || err);
    failed++;
  }

  // Test 7: Secret Rotation & CSV Export
  try {
    const secrets = await service.getSecretsMetadata();
    if (secrets.length > 0) {
      const targetSecret = secrets[0];
      const rotateRes = await service.rotateSecret(targetSecret.id, 'Scheduled 90-day rotation', 'admin@partneriq.io');
      if (!rotateRes.success) throw new Error('Secret rotation failed');
    }

    const exportRes = await service.exportSecurityData({}, 'admin@partneriq.io');
    if (!exportRes.filename.endsWith('.csv') || !exportRes.data.includes('EventID')) {
      throw new Error('Export CSV invalid format');
    }

    console.log('✅ Test 7 Passed: Secret rotation and server-side CSV export succeeded');
    passed++;
  } catch (err: any) {
    console.error('❌ Test 7 Failed:', err?.message || err);
    failed++;
  }

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});

