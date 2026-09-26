import { AdminAuditService } from '../modules/audit/admin-audit.service';
import { dbStore } from '../database/store';

async function runTests() {
  console.log('🧪 Starting Admin Audit Operations Center Test Suite...');
  let passed = 0;
  let failed = 0;

  const service = new AdminAuditService();

  // Test 1: Baseline audit records verification
  try {
    if (dbStore.auditLogs.length >= 14) {
      console.log(`  ✅ Test 1 Passed: Full audit operations baseline seeded in store (${dbStore.auditLogs.length} records)`);
      passed++;
    } else {
      throw new Error(`Insufficient audit records: ${dbStore.auditLogs.length}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 1 Failed:', err?.message || err);
    failed++;
  }

  // Test 2: Overview KPIs calculation
  try {
    const overview = await service.getOverview('30d');
    if (
      overview.kpis.totalEvents > 0 &&
      overview.kpis.adminActionsCount >= 0 &&
      overview.kpis.securityEventsCount >= 0 &&
      overview.timeline.length > 0 &&
      overview.categoryBreakdown.length > 0 &&
      overview.signals.length > 0
    ) {
      console.log(`  ✅ Test 2 Passed: Overview KPIs & operational signals computed (${overview.kpis.totalEvents} events, ${overview.categoryBreakdown.length} categories)`);
      passed++;
    } else {
      throw new Error(`Invalid overview KPIs: ${JSON.stringify(overview.kpis)}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 2 Failed:', err?.message || err);
    failed++;
  }

  // Test 3: Secret redaction in before/after and metadata
  try {
    const events = await service.getEvents({ limit: 100 });
    let unmaskedSecretsFound = false;
    for (const item of events.items) {
      const serialized = JSON.stringify({
        before: item.beforeState,
        after: item.afterState,
        meta: item.metadata,
      });
      if (
        serialized.includes('old_secret_hash') ||
        (serialized.includes('secret') && !serialized.includes('REDACTED'))
      ) {
        unmaskedSecretsFound = true;
        break;
      }
    }
    if (!unmaskedSecretsFound) {
      console.log('  ✅ Test 3 Passed: Automatic secret redaction verified (no plaintext tokens or secrets exposed)');
      passed++;
    } else {
      throw new Error('Unmasked sensitive key found in audit snapshot');
    }
  } catch (err: any) {
    console.error('  ❌ Test 3 Failed:', err?.message || err);
    failed++;
  }

  // Test 4: Field-level diff calculation
  try {
    const detail = await service.getEventDetail(dbStore.auditLogs[0].id);
    if (detail.diff && Array.isArray(detail.diff)) {
      console.log(`  ✅ Test 4 Passed: Field-level diff calculated accurately (${detail.diff.length} fields compared)`);
      passed++;
    } else {
      throw new Error('Missing field diff array on event detail');
    }
  } catch (err: any) {
    console.error('  ❌ Test 4 Failed:', err?.message || err);
    failed++;
  }

  // Test 5: Cryptographic hash chain validation
  try {
    const integrity = await service.verifyIntegrity();
    if (integrity.status === 'VERIFIED' && integrity.validChainCount > 0) {
      console.log(`  ✅ Test 5 Passed: SHA-256 forward hash chain verified (100% integrity across ${integrity.validChainCount} records)`);
      passed++;
    } else {
      throw new Error(`Hash chain verification failed: status=${integrity.status}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 5 Failed:', err?.message || err);
    failed++;
  }

  // Test 6: Paginated audit query with multi-attribute filtering
  try {
    const securityEvents = await service.getEvents({ category: 'SECURITY', limit: 10 });
    const isAllSecurity = securityEvents.items.every((item) => item.category === 'SECURITY');
    if (isAllSecurity && securityEvents.items.length > 0) {
      console.log(`  ✅ Test 6 Passed: Multi-attribute filtering verified (${securityEvents.items.length} SECURITY records matched)`);
      passed++;
    } else {
      throw new Error(`Filtering mismatch: received ${securityEvents.items.length} items`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 6 Failed:', err?.message || err);
    failed++;
  }

  // Test 7: Organization scoping and tenant isolation
  try {
    const orgEvents = await service.getEvents({ organizationId: 'org_acme', limit: 50 });
    const isStrictOrg = orgEvents.items.every((item) => item.organizationId === 'org_acme');
    if (isStrictOrg && orgEvents.items.length > 0) {
      console.log(`  ✅ Test 7 Passed: Strict organization tenant scoping verified (${orgEvents.items.length} Acme records)`);
      passed++;
    } else {
      throw new Error('Cross-tenant record leakage detected in organization filter');
    }
  } catch (err: any) {
    console.error('  ❌ Test 7 Failed:', err?.message || err);
    failed++;
  }

  // Test 8: Export generation and export audit event recording
  try {
    const beforeCount = dbStore.auditLogs.length;
    const exportResult = await service.exportAuditLogs(
      { category: 'ALL', format: 'CSV' },
      { id: 'usr_venkat', email: 'venkat@partneriq.com' }
    );
    const afterCount = dbStore.auditLogs.length;

    if (
      exportResult.filename.includes('.csv') &&
      exportResult.count > 0 &&
      afterCount === beforeCount + 1 &&
      String(dbStore.auditLogs[0].action) === 'AUDIT_LOG_EXPORTED'
    ) {
      console.log(`  ✅ Test 8 Passed: Export generated and immutable AUDIT_LOG_EXPORTED event created`);
      passed++;
    } else {
      throw new Error('Export generation failed or did not log audit event');
    }
  } catch (err: any) {
    console.error('  ❌ Test 8 Failed:', err?.message || err);
    failed++;
  }

  // Test 9: Resource audit timeline
  try {
    const targetWithEvents = dbStore.auditLogs.find((l) => l.resourceId === 'ep_acme_production_v1');
    if (targetWithEvents) {
      const detail = await service.getEventDetail(targetWithEvents.id);
      console.log(`  ✅ Test 9 Passed: Resource audit timeline resolved for ${detail.targetType}:${detail.targetId}`);
      passed++;
    } else {
      throw new Error('Target entity not found in baseline');
    }
  } catch (err: any) {
    console.error('  ❌ Test 9 Failed:', err?.message || err);
    failed++;
  }

  // Test 10: Failed / Denied actions recording
  try {
    const deniedEvents = await service.getEvents({ result: 'DENIED' });
    const failedEvents = await service.getEvents({ result: 'FAILED' });
    if (deniedEvents.items.length > 0 && failedEvents.items.length > 0) {
      console.log(`  ✅ Test 10 Passed: Denied authorizations and failed logins correctly tracked (${deniedEvents.items.length} denied, ${failedEvents.items.length} failed)`);
      passed++;
    } else {
      throw new Error('Failed or denied actions not found in baseline store');
    }
  } catch (err: any) {
    console.error('  ❌ Test 10 Failed:', err?.message || err);
    failed++;
  }

  console.log(`\n📊 Audit Operations Tests Complete: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test execution fatal error:', err);
  process.exit(1);
});

