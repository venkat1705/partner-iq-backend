import { describe, it, expect, beforeEach } from '@jest/globals';
import { AdminWebhooksService } from '../../src/modules/webhooks/admin-webhooks.service';
import { dbStore } from '../../src/database/store';

describe('AdminWebhooksService', () => {
  let service: AdminWebhooksService;

  beforeEach(async () => {
    service = new AdminWebhooksService();
    await service.onModuleInit();
  });

  it('seeds full webhook operations baseline records in store', () => {
    expect(dbStore.webhookEndpointRecords.length).toBeGreaterThanOrEqual(8);
    expect(dbStore.webhookEventRecords.length).toBeGreaterThanOrEqual(35);
    expect(dbStore.webhookDeliveryRecords.length).toBeGreaterThanOrEqual(50);
    expect(dbStore.webhookDeliveryAttemptRecords.length).toBeGreaterThanOrEqual(50);
    expect(dbStore.webhookEventTypeDefinitions.length).toBeGreaterThanOrEqual(12);
  });

  it('computes overview KPIs and health signals', async () => {
    const overview = await service.getOverview('30d');
    expect(overview.kpis.totalEvents).toBeGreaterThan(0);
    expect(overview.kpis.totalDeliveries).toBeGreaterThan(0);
    expect(overview.kpis.deliverySuccessRate).toBeGreaterThan(0);
    expect(overview.kpis.deliverySuccessRate).toBeLessThanOrEqual(100);
    expect(overview.timeline.length).toBeGreaterThan(0);
    expect(overview.healthSignals.length).toBeGreaterThan(0);
  });

  it('ensures endpoint secrets are masked and safe', async () => {
    const endpoints = await service.getEndpoints();
    const hasUnmaskedSecret = endpoints.some(
      (e: any) => e.secretEncrypted || (e.secretMasked && !e.secretMasked.startsWith('••••••••••••'))
    );
    expect(hasUnmaskedSecret).toBe(false);
    expect(endpoints.length).toBeGreaterThan(0);
  });

  it('rotates secrets and logs audit entries', async () => {
    const ep = dbStore.webhookEndpointRecords[0];
    const initialHash = ep.secretHash;
    const initialAuditCount = dbStore.webhookAuditRecords.length;

    const res = await service.rotateSecret(ep.id, { id: 'usr_test', email: 'tester@example.test' });
    expect(res.secretMasked).toBeDefined();
    expect(ep.secretHash).not.toBe(initialHash);
    expect(dbStore.webhookAuditRecords.length).toBeGreaterThan(initialAuditCount);
  });

  it('updates endpoint configurations', async () => {
    const ep = dbStore.webhookEndpointRecords[1];
    const updateRes = await service.updateEndpoint(
      ep.id,
      { name: 'Updated Enterprise Hook Name', timeoutMs: 8000 },
      { id: 'usr_test', email: 'tester@example.test' }
    );
    expect(updateRes.name).toBe('Updated Enterprise Hook Name');
    expect(updateRes.timeoutMs).toBe(8000);
  });

  it('retrieves paginated deliveries and delivery detail dossier', async () => {
    const deliveriesPage = await service.getDeliveries({ limit: 10, page: 1 });
    expect(deliveriesPage.items.length).toBe(10);
    expect(deliveriesPage.total).toBeGreaterThan(10);

    const sampleDelivery = dbStore.webhookDeliveryRecords[0];
    const detail = await service.getDeliveryDetail(sampleDelivery.id);
    expect(detail.id).toBe(sampleDelivery.id);
    expect(detail.attempts.length).toBeGreaterThan(0);
    expect(detail.event).toBeDefined();
    expect(detail.endpoint).toBeDefined();
  });

  it('executes manual delivery retries', async () => {
    const failedDelivery = dbStore.webhookDeliveryRecords.find((d) => d.status !== 'DELIVERED') || dbStore.webhookDeliveryRecords[0];
    const prevAttempts = failedDelivery.attemptCount;
    const retryRes = await service.retryDelivery(failedDelivery.id, { id: 'usr_test', email: 'tester@example.test' });

    expect(retryRes.delivery.attemptCount).toBe(prevAttempts + 1);
    expect(retryRes.latestAttempt).toBeDefined();
  });

  it('resolves dead letters and exports data with audit', async () => {
    const deadLetters = await service.getDeadLetters();
    expect(deadLetters.length).toBeGreaterThan(0);

    const dl = deadLetters[0];
    const resolved = await service.resolveDeadLetter(dl.id, 'Verified receiver is fixed', {
      id: 'usr_test',
      email: 'tester@example.test',
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolutionNotes).toBe('Verified receiver is fixed');

    const exp = await service.exportData('deliveries', 'csv', 'audit@example.test');
    expect(exp.filename.endsWith('.csv')).toBe(true);
    expect(exp.data.includes('id,status,createdAt')).toBe(true);
    expect(exp.count).toBeGreaterThan(0);
  });
});

