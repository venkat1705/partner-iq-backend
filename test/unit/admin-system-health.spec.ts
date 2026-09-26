import { describe, it, expect, beforeEach } from '@jest/globals';
import { AdminSystemHealthService } from '../../src/modules/system-health/admin-system-health.service';
import { dbStore } from '../../src/database/store';

describe('AdminSystemHealthService', () => {
  let service: AdminSystemHealthService;

  beforeEach(() => {
    service = new AdminSystemHealthService();
  });

  it('starts with an empty monitored-service registry (no auto-seeded fixtures)', () => {
    expect(service.getServices()).toEqual([]);
    expect(dbStore.systemMonitoredServices).toEqual([]);
    expect(dbStore.systemServiceDependencies).toEqual([]);
    expect(dbStore.systemIncidents).toEqual([]);
  });

  it('can explicitly bootstrap the canonical monitored service registry', () => {
    service.seedBaselineHealthRegistry();
    const services = service.getServices();
    expect(services.length).toBeGreaterThanOrEqual(15);
  });

  it('executes live diagnostic probe runner', async () => {
    const probeRun = await service.runDiagnosticProbes();
    expect(probeRun.results.length).toBeGreaterThanOrEqual(4);
    expect(probeRun.results.some((r) => r.checkType === 'DATABASE')).toBe(true);
    expect(probeRun.results.some((r) => r.checkType === 'HTTP')).toBe(true);
    expect(probeRun.results.some((r) => r.checkType === 'QUEUE')).toBe(true);
  });

  it('computes global health overview and explainable status', async () => {
    service.seedBaselineHealthRegistry();
    const globalHealth = await service.getGlobalHealth('production');
    expect(globalHealth.monitoredServicesCount).toBeGreaterThanOrEqual(15);
    expect(globalHealth.statusExplanation.length).toBeGreaterThan(0);
    expect(globalHealth.categoryBreakdown.length).toBe(4);
    expect(typeof globalHealth.p95LatencyMs).toBe('number');
  });

  it('filters services by category and resolves service details', () => {
    service.seedBaselineHealthRegistry();
    const appServices = service.getServices('APPLICATION');
    const infraServices = service.getServices('INFRASTRUCTURE');
    const bgServices = service.getServices('BACKGROUND');
    const extServices = service.getServices('EXTERNAL_PROVIDER');

    expect(appServices.length).toBeGreaterThan(0);
    expect(infraServices.length).toBeGreaterThan(0);
    expect(bgServices.length).toBeGreaterThan(0);
    expect(extServices.length).toBeGreaterThan(0);

    const detail = service.getServiceDetail('admin-api');
    expect(detail.service).toBeDefined();
    expect(detail.dependencies.upstream.length).toBeGreaterThan(0);
  });

  it('retrieves infrastructure metrics and queue telemetry', () => {
    service.seedBaselineHealthRegistry();
    const infra = service.getInfrastructureMetrics();
    expect(infra.database.type.includes('MySQL')).toBe(true);
    expect(infra.computeHost.nodeVersion).toBeDefined();
    expect(infra.storage.bucket).toBe('partneriq-prod-assets-vault');

    const q = service.getQueueAndWorkerMetrics();
    expect(q.queues.length).toBeGreaterThanOrEqual(3);
    expect(q.workers.length).toBeGreaterThanOrEqual(3);
    expect(q.scheduledJobs.length).toBeGreaterThanOrEqual(3);
  });

  it('generates dependency topology graph', () => {
    service.seedBaselineHealthRegistry();
    const topology = service.getDependencyTopology();
    expect(topology.nodes.length).toBeGreaterThanOrEqual(15);
    expect(topology.edges.length).toBeGreaterThanOrEqual(5);
  });

  it('manages incident lifecycle and restores affected service health', () => {
    service.seedBaselineHealthRegistry();
    const incident = service.createIncident(
      {
        title: 'Transient high latency on HubSpot connector',
        severity: 'SEV-3',
        affectedServices: ['hubspot-crm'],
        impactDescription: 'Sync queue delayed by 6 minutes',
      },
      'admin@example.test'
    );

    const hubspotService = dbStore.systemMonitoredServices.find((s) => s.serviceId === 'hubspot-crm');
    expect(hubspotService?.status).toBe('DEGRADED');

    const updated = service.updateIncidentStatus(
      incident.id,
      {
        status: 'RESOLVED',
        message: 'HubSpot API rate limit window reset; all sync jobs caught up',
        resolution: 'Permanent resolution verified',
      },
      'admin@example.test'
    );

    expect(updated.status).toBe('RESOLVED');
    expect(updated.resolvedAt).toBeDefined();
    expect(hubspotService!.status as string).toBe('OPERATIONAL');
  });

  it('retrieves deployments, maintenance windows, and settings', () => {
    const deployments = service.getDeployments();
    const maintenance = service.getMaintenanceWindows();
    const settings = service.getHealthSettings();

    expect(Array.isArray(deployments)).toBe(true);
    expect(Array.isArray(maintenance)).toBe(true);
    expect(settings.probeIntervalSeconds).toBeGreaterThan(0);
  });
});

