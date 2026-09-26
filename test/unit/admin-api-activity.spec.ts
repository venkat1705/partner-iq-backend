import { describe, it, expect, beforeEach } from '@jest/globals';
import { AdminApiActivityService } from '../../src/modules/api-activity/admin-api-activity.service';
import {
  sanitizeQuery,
  sanitizeHeaders,
  normalizeRoutePath,
  classifyApiResult,
  generateFingerprint,
} from '../../src/modules/api-activity/api-telemetry.interceptor';
import { dbStore } from '../../src/database/store';

describe('AdminApiActivityService & Telemetry Interceptor', () => {
  let service: AdminApiActivityService;

  beforeEach(async () => {
    service = new AdminApiActivityService();
    await service.onModuleInit();
  });

  it('starts with no auto-seeded API telemetry after module init', async () => {
    expect(dbStore.apiRequests).toEqual([]);
    expect(dbStore.apiExternalCalls).toEqual([]);
    expect(dbStore.apiErrorGroups).toEqual([]);
  });

  it('redacts sensitive query parameters server-side', () => {
    const query = {
      programId: 'prog_123',
      token: 'secret_jwt_token_here',
      apiKey: 'pk_live_supersecret',
      limit: '20',
    };
    const clean = sanitizeQuery(query);
    expect(clean.programId).toBe('prog_123');
    expect(clean.limit).toBe('20');
    expect(clean.token).toBe('[REDACTED]');
    expect(clean.apiKey).toBe('[REDACTED]');
  });

  it('allowlists safe headers and redacts auth/cookie headers', () => {
    const headers = {
      'content-type': 'application/json',
      'authorization': 'Bearer eyJhbGciOi...',
      'cookie': 'session_token=abc123xyz',
      'x-request-id': 'req_test123',
      'x-custom-secret': 'super_sensitive_key',
    };
    const clean = sanitizeHeaders(headers);
    expect(clean['content-type']).toBe('application/json');
    expect(clean['x-request-id']).toBe('req_test123');
    expect(clean['authorization']).toBe('[REDACTED]');
    expect(clean['cookie']).toBe('[REDACTED]');
  });

  it('normalizes route paths with :id placeholders', () => {
    const norm1 = normalizeRoutePath('/api/v1/conversions/c7b2a95e-1234-4567-890a-bcdef0123456');
    const norm2 = normalizeRoutePath('/api/v1/programs/4289?filter=active');
    expect(norm1).toBe('/api/v1/conversions/:id');
    expect(norm2).toBe('/api/v1/programs/:id');
  });

  it('maps HTTP status codes to semantic categories', () => {
    expect(classifyApiResult(200)).toBe('SUCCESS');
    expect(classifyApiResult(400)).toBe('CLIENT_ERROR');
    expect(classifyApiResult(401)).toBe('AUTHENTICATION_FAILED');
    expect(classifyApiResult(403)).toBe('AUTHORIZATION_FAILED');
    expect(classifyApiResult(429)).toBe('RATE_LIMITED');
    expect(classifyApiResult(502)).toBe('SERVER_ERROR');
  });

  it('groups identical error faults into fingerprints', () => {
    const fp1 = generateFingerprint('Conversion Service', 'POST', '/api/v1/conversions', 'VALIDATION_FAILED');
    const fp2 = generateFingerprint('Conversion Service', 'POST', '/api/v1/conversions', 'VALIDATION_FAILED');
    const fp3 = generateFingerprint('Conversion Service', 'GET', '/api/v1/conversions', 'VALIDATION_FAILED');
    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
  });

  it('computes overview KPIs and timeline', async () => {
    service.ensureBaselineTelemetry();
    const overview = await service.getOverview('30d');
    expect(overview.kpis.totalRequests).toBeGreaterThan(0);
    expect(overview.kpis.successRate).toBeGreaterThan(0);
    expect(overview.kpis.p95LatencyMs).toBeGreaterThan(0);
    expect(overview.timeline.length).toBe(12);
    expect(overview.topEndpoints.length).toBeGreaterThan(0);
  });

  it('retrieves paginated requests stream', async () => {
    service.ensureBaselineTelemetry();
    const res = await service.getRequests({ page: 1, limit: 10 });
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.total).toBeGreaterThan(0);
    expect(res.items[0].requestId).toBeDefined();
  });

  it('retrieves request detail execution timeline trace', async () => {
    service.ensureBaselineTelemetry();
    const res = await service.getRequests({ page: 1, limit: 1 });
    const firstReq = res.items[0];
    const detail = await service.getRequestDetail(firstReq.requestId);
    expect(detail.requestId).toBe(firstReq.requestId);
    expect(detail.timeline.length).toBeGreaterThanOrEqual(5);
  });

  it('exports telemetry to CSV and records immutable audit log', async () => {
    const beforeCount = dbStore.apiActivityAudits.length;
    const exportRes = await service.exportData(
      { format: 'csv' },
      { id: 'usr_test', email: 'test.admin@example.test' }
    );
    expect(exportRes.filename.includes('.csv')).toBe(true);
    expect(exportRes.data.includes('Request ID')).toBe(true);
    expect(dbStore.apiActivityAudits.length).toBe(beforeCount + 1);
  });
});

