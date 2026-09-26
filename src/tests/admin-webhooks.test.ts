import { AdminWebhooksService } from '../modules/webhooks/admin-webhooks.service';
import { dbStore } from '../database/store';

async function runTests() {
  console.log('🧪 Starting Admin Webhooks Operations Test Suite...');
  let passed = 0;
  let failed = 0;

  const service = new AdminWebhooksService();
  await service.onModuleInit();

  // Test 1: Telemetry seed verification
  try {
    if (
      dbStore.webhookEndpointRecords.length >= 8 &&
      dbStore.webhookEventRecords.length >= 35 &&
      dbStore.webhookDeliveryRecords.length >= 50 &&
      dbStore.webhookDeliveryAttemptRecords.length >= 50 &&
      dbStore.webhookEventTypeDefinitions.length >= 12
    ) {
      console.log('  ✅ Test 1 Passed: Full webhook operations baseline seeded in store');
      passed++;
    } else {
      throw new Error(`Insufficient seeded records: endpoints=${dbStore.webhookEndpointRecords.length}, events=${dbStore.webhookEventRecords.length}`);
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
      overview.kpis.totalDeliveries > 0 &&
      overview.kpis.deliverySuccessRate > 0 &&
      overview.kpis.deliverySuccessRate <= 100 &&
      overview.timeline.length > 0 &&
      overview.healthSignals.length > 0
    ) {
      console.log(`  ✅ Test 2 Passed: Overview KPIs & operational signals computed (${overview.kpis.deliverySuccessRate}% success rate)`);
      passed++;
    } else {
      throw new Error(`Invalid overview KPIs: ${JSON.stringify(overview.kpis)}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 2 Failed:', err?.message || err);
    failed++;
  }

  // Test 3: Endpoint secret masking & security
  try {
    const endpoints = await service.getEndpoints();
    const hasUnmaskedSecret = endpoints.some(
      (e: any) => e.secretEncrypted || (e.secretMasked && !e.secretMasked.startsWith('••••••••••••'))
    );
    if (!hasUnmaskedSecret && endpoints.length > 0) {
      console.log('  ✅ Test 3 Passed: Endpoint secrets safely masked and never exposed');
      passed++;
    } else {
      throw new Error('Endpoints leaked secret or failed masking');
    }
  } catch (err: any) {
    console.error('  ❌ Test 3 Failed:', err?.message || err);
    failed++;
  }

  // Test 4: Secret rotation
  try {
    const ep = dbStore.webhookEndpointRecords[0];
    const initialHash = ep.secretHash;
    const initialAuditCount = dbStore.webhookAuditRecords.length;

    const res = await service.rotateSecret(ep.id, { id: 'usr_test', email: 'tester@partneriq.com' });
    if (
      res.secretMasked &&
      ep.secretHash !== initialHash &&
      dbStore.webhookAuditRecords.length > initialAuditCount
    ) {
      console.log('  ✅ Test 4 Passed: Secret rotation updates hash and records audit log');
      passed++;
    } else {
      throw new Error('Secret rotation did not update hash or log audit');
    }
  } catch (err: any) {
    console.error('  ❌ Test 4 Failed:', err?.message || err);
    failed++;
  }

  // Test 5: Endpoint configuration update
  try {
    const ep = dbStore.webhookEndpointRecords[1];
    const updateRes = await service.updateEndpoint(
      ep.id,
      { name: 'Updated Enterprise Hook Name', timeoutMs: 8000 },
      { id: 'usr_test', email: 'tester@partneriq.com' }
    );
    if (updateRes.name === 'Updated Enterprise Hook Name' && updateRes.timeoutMs === 8000) {
      console.log('  ✅ Test 5 Passed: Endpoint configuration update verified');
      passed++;
    } else {
      throw new Error('Endpoint configuration update mismatch');
    }
  } catch (err: any) {
    console.error('  ❌ Test 5 Failed:', err?.message || err);
    failed++;
  }

  // Test 6: Paginated deliveries and filtering
  try {
    const deliveriesPage = await service.getDeliveries({ limit: 10, page: 1 });
    if (deliveriesPage.items.length === 10 && deliveriesPage.total > 10 && deliveriesPage.totalPages >= 2) {
      console.log(`  ✅ Test 6 Passed: Paginated deliveries retrieved (${deliveriesPage.total} total)`);
      passed++;
    } else {
      throw new Error(`Unexpected deliveries pagination: ${JSON.stringify(deliveriesPage)}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 6 Failed:', err?.message || err);
    failed++;
  }

  // Test 7: Delivery detail dossier with attempts timeline
  try {
    const sampleDelivery = dbStore.webhookDeliveryRecords[0];
    const detail = await service.getDeliveryDetail(sampleDelivery.id);
    if (
      detail.id === sampleDelivery.id &&
      detail.attempts.length > 0 &&
      detail.event &&
      detail.endpoint
    ) {
      console.log(`  ✅ Test 7 Passed: Full delivery detail with ${detail.attempts.length} attempts verified`);
      passed++;
    } else {
      throw new Error('Incomplete delivery detail dossier');
    }
  } catch (err: any) {
    console.error('  ❌ Test 7 Failed:', err?.message || err);
    failed++;
  }

  // Test 8: Manual delivery retry execution
  try {
    const failedDelivery = dbStore.webhookDeliveryRecords.find((d) => d.status !== 'DELIVERED') || dbStore.webhookDeliveryRecords[0];
    const prevAttempts = failedDelivery.attemptCount;
    const retryRes = await service.retryDelivery(failedDelivery.id, { id: 'usr_test', email: 'tester@partneriq.com' });

    if (retryRes.delivery.attemptCount === prevAttempts + 1 && retryRes.latestAttempt) {
      console.log(`  ✅ Test 8 Passed: Manual retry executed attempt #${retryRes.delivery.attemptCount}`);
      passed++;
    } else {
      throw new Error('Manual retry did not increment attempt or generate attempt record');
    }
  } catch (err: any) {
    console.error('  ❌ Test 8 Failed:', err?.message || err);
    failed++;
  }

  // Test 9: Dead-letter resolution
  try {
    const deadLetters = await service.getDeadLetters();
    if (deadLetters.length > 0) {
      const dl = deadLetters[0];
      const resolved = await service.resolveDeadLetter(dl.id, 'Verified receiver is fixed', {
        id: 'usr_test',
        email: 'tester@partneriq.com',
      });
      if (resolved.status === 'RESOLVED' && resolved.resolutionNotes === 'Verified receiver is fixed') {
        console.log('  ✅ Test 9 Passed: Dead letter resolved with operator audit notes');
        passed++;
      } else {
        throw new Error('Dead letter resolution failed');
      }
    } else {
      throw new Error('No dead letter records found');
    }
  } catch (err: any) {
    console.error('  ❌ Test 9 Failed:', err?.message || err);
    failed++;
  }

  // Test 10: Telemetry export to CSV with audit
  try {
    const exp = await service.exportData('deliveries', 'csv', 'audit@partneriq.com');
    if (exp.filename.endsWith('.csv') && exp.data.includes('id,status,createdAt') && exp.count > 0) {
      console.log(`  ✅ Test 10 Passed: Telemetry CSV export generated (${exp.count} rows)`);
      passed++;
    } else {
      throw new Error('Export CSV generation failed');
    }
  } catch (err: any) {
    console.error('  ❌ Test 10 Failed:', err?.message || err);
    failed++;
  }

  console.log(`\n📊 Webhook Operations Tests Complete: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

