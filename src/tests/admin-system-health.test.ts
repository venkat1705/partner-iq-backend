import { AdminSystemHealthService } from '../modules/system-health/admin-system-health.service';
import { dbStore } from '../database/store';

async function runTests() {
  console.log('🧪 Starting Admin System Health Operations Center Test Suite...');
  let passed = 0;
  let failed = 0;

  const service = new AdminSystemHealthService();

  // Test 1: Service registry seeding
  try {
    const services = service.getServices();
    if (services.length >= 15) {
      console.log(`  ✅ Test 1 Passed: Canonical monitored service registry seeded (${services.length} services)`);
      passed++;
    } else {
      throw new Error(`Insufficient monitored services: ${services.length}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 1 Failed:', err?.message || err);
    failed++;
  }

  // Test 2: Live diagnostic probe runner execution
  try {
    const probeRun = await service.runDiagnosticProbes();
    if (
      probeRun.results.length >= 4 &&
      probeRun.results.some((r) => r.checkType === 'DATABASE') &&
      probeRun.results.some((r) => r.checkType === 'HTTP') &&
      probeRun.results.some((r) => r.checkType === 'QUEUE')
    ) {
      console.log(`  ✅ Test 2 Passed: Diagnostic probe runner executed (${probeRun.results.length} probes, ${probeRun.durationMs}ms)`);
      passed++;
    } else {
      throw new Error('Diagnostic probe execution did not yield expected checks');
    }
  } catch (err: any) {
    console.error('  ❌ Test 2 Failed:', err?.message || err);
    failed++;
  }

  // Test 3: Global health overview & explainable reasons
  try {
    const globalHealth = await service.getGlobalHealth('production');
    if (
      globalHealth.monitoredServicesCount >= 15 &&
      globalHealth.statusExplanation.length > 0 &&
      globalHealth.categoryBreakdown.length === 4 &&
      typeof globalHealth.p95LatencyMs === 'number'
    ) {
      console.log(`  ✅ Test 3 Passed: Global health status computed (Status: ${globalHealth.overallStatus}, ${globalHealth.monitoredServicesCount} services, P95: ${globalHealth.p95LatencyMs}ms)`);
      passed++;
    } else {
      throw new Error('Global health evaluation did not return expected breakdown');
    }
  } catch (err: any) {
    console.error('  ❌ Test 3 Failed:', err?.message || err);
    failed++;
  }

  // Test 4: Monitored services category filtering
  try {
    const appServices = service.getServices('APPLICATION');
    const infraServices = service.getServices('INFRASTRUCTURE');
    const bgServices = service.getServices('BACKGROUND');
    const extServices = service.getServices('EXTERNAL_PROVIDER');

    if (appServices.length > 0 && infraServices.length > 0 && bgServices.length > 0 && extServices.length > 0) {
      console.log(`  ✅ Test 4 Passed: Category filtering verified (Apps: ${appServices.length}, Infra: ${infraServices.length}, BG: ${bgServices.length}, Ext: ${extServices.length})`);
      passed++;
    } else {
      throw new Error('Category filtering returned empty sets');
    }
  } catch (err: any) {
    console.error('  ❌ Test 4 Failed:', err?.message || err);
    failed++;
  }

  // Test 5: Service detail workspace & dependencies
  try {
    const detail = service.getServiceDetail('admin-api');
    if (detail.service && detail.dependencies.upstream.length > 0) {
      console.log(`  ✅ Test 5 Passed: Service workspace resolved for admin-api (${detail.dependencies.upstream.length} upstream dependencies)`);
      passed++;
    } else {
      throw new Error('Service workspace resolution failed for admin-api');
    }
  } catch (err: any) {
    console.error('  ❌ Test 5 Failed:', err?.message || err);
    failed++;
  }

  // Test 6: Infrastructure deep dive telemetry
  try {
    const infra = service.getInfrastructureMetrics();
    if (
      infra.database.type.includes('MySQL') &&
      infra.computeHost.nodeVersion &&
      infra.storage.bucket === 'partneriq-prod-assets-vault'
    ) {
      console.log(`  ✅ Test 6 Passed: Infrastructure metrics verified (DB: ${infra.database.type}, Node: ${infra.computeHost.nodeVersion}, RSS: ${infra.computeHost.rssMb}MB)`);
      passed++;
    } else {
      throw new Error('Infrastructure deep dive missing core metrics');
    }
  } catch (err: any) {
    console.error('  ❌ Test 6 Failed:', err?.message || err);
    failed++;
  }

  // Test 7: Queue depth, workers & cron daemons
  try {
    const q = service.getQueueAndWorkerMetrics();
    if (q.queues.length >= 3 && q.workers.length >= 3 && q.scheduledJobs.length >= 3) {
      console.log(`  ✅ Test 7 Passed: Queues & Worker daemons verified (${q.queues.length} queues, ${q.workers.length} workers, ${q.scheduledJobs.length} cron daemons)`);
      passed++;
    } else {
      throw new Error('Queue and worker telemetry incomplete');
    }
  } catch (err: any) {
    console.error('  ❌ Test 7 Failed:', err?.message || err);
    failed++;
  }

  // Test 8: Dependency topology graph & cascade failure impact
  try {
    const topology = service.getDependencyTopology();
    if (topology.nodes.length >= 15 && topology.edges.length >= 5) {
      console.log(`  ✅ Test 8 Passed: Dependency topology generated (${topology.nodes.length} nodes, ${topology.edges.length} directed edges)`);
      passed++;
    } else {
      throw new Error('Dependency topology graph incomplete');
    }
  } catch (err: any) {
    console.error('  ❌ Test 8 Failed:', err?.message || err);
    failed++;
  }

  // Test 9: Incident lifecycle (Create -> Update Timeline -> Resolve -> Restore Health)
  try {
    const incident = service.createIncident(
      {
        title: 'Transient high latency on HubSpot connector',
        severity: 'SEV-3',
        affectedServices: ['hubspot-crm'],
        impactDescription: 'Sync queue delayed by 6 minutes',
      },
      'admin@partneriq.in'
    );

    const hubspotService = dbStore.systemMonitoredServices.find((s) => s.serviceId === 'hubspot-crm');
    if (hubspotService?.status !== 'DEGRADED') {
      throw new Error('Affected service was not degraded on incident creation');
    }

    const updated = service.updateIncidentStatus(
      incident.id,
      {
        status: 'RESOLVED',
        message: 'HubSpot API rate limit window reset; all sync jobs caught up',
        resolution: 'Permanent resolution verified',
      },
      'admin@partneriq.in'
    );

    if (updated.status !== 'RESOLVED' || !updated.resolvedAt) {
      throw new Error('Incident status update to RESOLVED failed');
    }

    if ((hubspotService.status as string) !== 'OPERATIONAL') {
      throw new Error('Service status was not restored to OPERATIONAL post-incident resolution');
    }

    console.log(`  ✅ Test 9 Passed: Incident lifecycle verified (${incident.incidentNumber} created -> degraded -> resolved -> restored)`);
    passed++;
  } catch (err: any) {
    console.error('  ❌ Test 9 Failed:', err?.message || err);
    failed++;
  }

  // Test 10: Deployments & Maintenance windows
  try {
    const deployments = service.getDeployments();
    const maintenance = service.getMaintenanceWindows();
    const settings = service.getHealthSettings();

    if (deployments.length > 0 && maintenance.length > 0 && settings.probeIntervalSeconds > 0) {
      console.log(`  ✅ Test 10 Passed: Deployments & Maintenance verified (${deployments.length} deployments, ${maintenance.length} maintenance windows, probe interval: ${settings.probeIntervalSeconds}s)`);
      passed++;
    } else {
      throw new Error('Deployments or maintenance windows incomplete');
    }
  } catch (err: any) {
    console.error('  ❌ Test 10 Failed:', err?.message || err);
    failed++;
  }

  console.log(`\n📊 System Health Tests Complete: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
