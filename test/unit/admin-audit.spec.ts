import { describe, it, expect, beforeEach } from '@jest/globals';
import { AdminAuditService } from '../../src/modules/audit/admin-audit.service';
import { dbStore } from '../../src/database/store';

describe('AdminAuditService', () => {
  let service: AdminAuditService;

  beforeEach(() => {
    service = new AdminAuditService();
  });

  it('verifies baseline audit records are initialized', () => {
    expect(dbStore.auditLogs.length).toBeGreaterThanOrEqual(14);
  });

  it('computes overview KPIs and signals', async () => {
    const overview = await service.getOverview('30d');
    expect(overview.kpis.totalEvents).toBeGreaterThan(0);
    expect(overview.kpis.adminActionsCount).toBeGreaterThanOrEqual(0);
    expect(overview.kpis.securityEventsCount).toBeGreaterThanOrEqual(0);
    expect(overview.timeline.length).toBeGreaterThan(0);
    expect(overview.categoryBreakdown.length).toBeGreaterThan(0);
    expect(overview.signals.length).toBeGreaterThan(0);
  });

  it('automatically redacts secrets in before/after and metadata snapshots', async () => {
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
    expect(unmaskedSecretsFound).toBe(false);
  });

  it('calculates field-level diff on event detail', async () => {
    const detail = await service.getEventDetail(dbStore.auditLogs[0].id);
    expect(Array.isArray(detail.diff)).toBe(true);
  });

  it('verifies cryptographic SHA-256 forward hash chain integrity', async () => {
    const integrity = await service.verifyIntegrity();
    expect(integrity.status).toBe('VERIFIED');
    expect(integrity.validChainCount).toBeGreaterThan(0);
  });

  it('filters events by category and organization', async () => {
    const securityEvents = await service.getEvents({ category: 'SECURITY', limit: 10 });
    expect(securityEvents.items.length).toBeGreaterThan(0);
    expect(securityEvents.items.every((item) => item.category === 'SECURITY')).toBe(true);

    const orgEvents = await service.getEvents({ organizationId: 'org_acme', limit: 50 });
    expect(orgEvents.items.length).toBeGreaterThan(0);
    expect(orgEvents.items.every((item) => item.organizationId === 'org_acme')).toBe(true);
  });

  it('exports audit logs and creates AUDIT_LOG_EXPORTED audit event', async () => {
    const beforeCount = dbStore.auditLogs.length;
    const exportResult = await service.exportAuditLogs(
      { category: 'ALL', format: 'CSV' },
      { id: 'usr_venkat', email: 'venkat@example.test' }
    );
    expect(exportResult.filename.includes('.csv')).toBe(true);
    expect(exportResult.count).toBeGreaterThan(0);
    expect(dbStore.auditLogs.length).toBe(beforeCount + 1);
    expect(String(dbStore.auditLogs[0].action)).toBe('AUDIT_LOG_EXPORTED');
  });

  it('resolves resource audit timeline and tracks failed/denied events', async () => {
    const targetWithEvents = dbStore.auditLogs.find((l) => l.resourceId === 'ep_acme_production_v1');
    expect(targetWithEvents).toBeDefined();
    const detail = await service.getEventDetail(targetWithEvents!.id);
    expect(detail.targetType).toBeDefined();

    const deniedEvents = await service.getEvents({ result: 'DENIED' });
    const failedEvents = await service.getEvents({ result: 'FAILED' });
    expect(deniedEvents.items.length).toBeGreaterThan(0);
    expect(failedEvents.items.length).toBeGreaterThan(0);
  });
});

