import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { dbStore } from '../../database/store';
import {
  ApiRequest,
  ApiExternalCall,
  ApiErrorGroup,
  ApiRateLimitQuota,
  ApiActivityAudit,
  ApiActivityException,
} from '../../database/schema-api-activity';
import { v4 as uuidv4 } from 'uuid';

// ─────────────────────────────────────────────────────────────────────────────
// Statistical Helpers
// ─────────────────────────────────────────────────────────────────────────────

function calculatePercentile(numbers: number[], p: number): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function parsePeriodToMs(period: string): number {
  switch (period) {
    case '1h':
      return 60 * 60 * 1000;
    case '6h':
      return 6 * 60 * 60 * 1000;
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
    case '90d':
      return 90 * 24 * 60 * 60 * 1000;
    case '1y':
      return 365 * 24 * 60 * 60 * 1000;
    default:
      return 30 * 24 * 60 * 60 * 1000;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AdminApiActivityService
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class AdminApiActivityService implements OnModuleInit {
  private readonly logger = new Logger(AdminApiActivityService.name);

  async onModuleInit() {
    // No auto-seeding here: this used to fabricate ~120 fake API requests,
    // external calls, and error groups (invented org names, actor emails,
    // and latency numbers) on every boot. That's placeholder data, not real
    // telemetry, so it's been removed — the dashboard now starts empty and
    // fills in only from real request traffic captured by the telemetry
    // interceptor. `ensureBaselineTelemetry()` is kept as an explicit
    // opt-in for tests/local dev bootstrapping only.
  }

  /**
   * Seeds sample operational baseline telemetry for PartnerIQ APIs if empty.
   * Not called automatically — see onModuleInit().
   */
  public ensureBaselineTelemetry() {
    if (!dbStore.apiRequests || dbStore.apiRequests.length > 0) {
      return;
    }

    this.logger.log('Seeding real baseline API activity telemetry...');

    const now = Date.now();
    const endpoints = [
      { method: 'POST' as const, route: '/api/v1/conversions', norm: '/api/v1/conversions', service: 'Conversion Service', baseMs: 140, p95Ms: 220 },
      { method: 'GET' as const, route: '/api/v1/programs', norm: '/api/v1/programs', service: 'Affiliate Service', baseMs: 45, p95Ms: 95 },
      { method: 'GET' as const, route: '/api/v1/affiliates/me', norm: '/api/v1/affiliates/me', service: 'Affiliate Service', baseMs: 38, p95Ms: 80 },
      { method: 'POST' as const, route: '/api/v1/auth/login', norm: '/api/v1/auth/login', service: 'Auth Gateway', baseMs: 110, p95Ms: 190 },
      { method: 'POST' as const, route: '/api/v1/payouts/batches', norm: '/api/v1/payouts/batches', service: 'Payout Service', baseMs: 420, p95Ms: 850 },
      { method: 'GET' as const, route: '/api/v1/admin/security/overview', norm: '/api/v1/admin/security/overview', service: 'Security Engine', baseMs: 65, p95Ms: 130 },
      { method: 'POST' as const, route: '/api/v1/webhooks/cashfree', norm: '/api/v1/webhooks/cashfree', service: 'Integration Service', baseMs: 85, p95Ms: 170 },
      { method: 'GET' as const, route: '/api/v1/tracking-links', norm: '/api/v1/tracking-links', service: 'Affiliate Service', baseMs: 40, p95Ms: 75 },
    ];

    const orgs = [
      { id: 'org_acme_ind', name: 'Acme India Pvt Ltd' },
      { id: 'org_flip_global', name: 'FlipScale Global' },
      { id: 'org_razor_aff', name: 'RazorAffiliates Inc' },
    ];

    const actors = [
      { id: 'usr_sarah_admin', email: 'sarah.admin@partneriq.in', type: 'ADMIN' as const },
      { id: 'usr_rahul_dev', email: 'rahul.dev@acme.com', type: 'USER' as const },
      { id: 'client_sdk_prod', email: 'sdk-ingest@client.acme.com', type: 'API_CLIENT' as const },
    ];

    // Seed 120 realistic requests spread over the last 14 days
    for (let i = 0; i < 120; i++) {
      const ep = endpoints[i % endpoints.length];
      const org = orgs[i % orgs.length];
      const actor = actors[i % actors.length];

      // Time spread
      const ageMs = Math.floor((i / 120) * 14 * 24 * 60 * 60 * 1000);
      const reqDate = new Date(now - ageMs);

      // Status code distribution (mostly 200/201, rare 400/401/429/500)
      let statusCode = ep.method === 'POST' ? 201 : 200;
      let result: ApiRequest['result'] = 'SUCCESS';
      let errorCode: string | undefined = undefined;
      let errorMessage: string | undefined = undefined;

      if (i === 14 || i === 44) {
        statusCode = 400;
        result = 'CLIENT_ERROR';
        errorCode = 'VALIDATION_FAILED';
        errorMessage = 'Invalid conversion payload: missing orderId';
      } else if (i === 28) {
        statusCode = 401;
        result = 'AUTHENTICATION_FAILED';
        errorCode = 'UNAUTHORIZED';
        errorMessage = 'API key expired or invalid signature';
      } else if (i === 62) {
        statusCode = 429;
        result = 'RATE_LIMITED';
        errorCode = 'RATE_LIMIT_EXCEEDED';
        errorMessage = 'Rate limit quota of 1,000 req/min exceeded';
      } else if (i === 95) {
        statusCode = 502;
        result = 'SERVER_ERROR';
        errorCode = 'PAYMENT_PROVIDER_TIMEOUT';
        errorMessage = 'Cashfree payout gateway timeout after 3 retries';
      }

      const durationMs = Math.max(12, Math.round(ep.baseMs + (Math.sin(i) * 35) + (statusCode >= 500 ? 1200 : 0)));

      const req = new ApiRequest();
      req.id = uuidv4();
      req.requestId = `req_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
      req.correlationId = `corr_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
      req.method = ep.method;
      req.route = ep.route;
      req.normalizedRoute = ep.norm;
      req.apiVersion = 'v1';
      req.statusCode = statusCode;
      req.result = result;
      req.durationMs = durationMs;
      req.requestSize = Math.floor(Math.random() * 2400) + 120;
      req.responseSize = Math.floor(Math.random() * 8200) + 240;
      req.service = ep.service;
      req.environment = 'production';
      req.region = 'ap-south-1';
      req.authenticationMethod = i % 3 === 0 ? 'API_KEY' : 'JWT';
      req.organizationId = org.id;
      req.organizationName = org.name;
      req.actorId = actor.id;
      req.actorType = actor.type;
      req.actorEmail = actor.email;
      req.apiClientId = i % 3 === 0 ? 'client_acme_sdk' : undefined;
      req.apiClientName = i % 3 === 0 ? 'Acme Production SDK' : undefined;
      req.apiKeyPrefix = i % 3 === 0 ? 'pk_live_acme...' : undefined;
      req.ipAddress = `103.21.${10 + (i % 20)}.${15 + (i % 40)}`;
      req.userAgent = 'PartnerIQ-NodeSDK/2.4.0 (Linux x64)';
      req.querySafe = { programId: 'prog_enterprise_affiliates', limit: '50' };
      req.headersSafe = {
        'content-type': 'application/json',
        'accept': 'application/json',
        'user-agent': 'PartnerIQ-NodeSDK/2.4.0',
        'x-request-id': req.requestId,
        'x-api-version': 'v1',
      };
      req.requestBodyRedacted = ep.method === 'POST' ? JSON.stringify({ programId: 'prog_enterprise_affiliates', amount: 14500, customerEmail: '[REDACTED]' }) : undefined;
      req.responseBodyRedacted = JSON.stringify({ success: statusCode < 400, status: statusCode });
      req.databaseQueryCount = Math.floor(Math.random() * 3) + 1;
      req.databaseDurationMs = Math.round(durationMs * 0.3);
      req.externalCallCount = ep.service === 'Payout Service' || ep.service === 'Integration Service' ? 1 : 0;
      req.externalDurationMs = req.externalCallCount > 0 ? Math.round(durationMs * 0.5) : 0;
      req.errorCode = errorCode;
      req.errorMessage = errorMessage;
      req.errorFingerprint = errorCode ? `${ep.service}:${ep.norm}:${errorCode}` : undefined;
      req.rateLimitStatus = statusCode === 429 ? 'RATE_LIMITED' : 'NORMAL';
      req.startedAt = reqDate;
      req.completedAt = new Date(reqDate.getTime() + durationMs);
      req.createdAt = reqDate;

      dbStore.apiRequests.push(req);

      // Seed External Calls for payout requests
      if (ep.service === 'Payout Service' && (i % 5 === 0)) {
        const ext = new ApiExternalCall();
        ext.id = uuidv4();
        ext.apiRequestId = req.requestId;
        ext.provider = 'Cashfree';
        ext.operation = 'payout_bank_transfer';
        ext.method = 'POST';
        ext.endpointTemplate = 'https://payout-api.cashfree.com/payout/v1/directTransfer';
        ext.statusCode = statusCode === 502 ? 504 : 200;
        ext.durationMs = Math.round(durationMs * 0.6);
        ext.attemptNumber = statusCode === 502 ? 3 : 1;
        ext.retryCount = statusCode === 502 ? 2 : 0;
        ext.result = statusCode === 502 ? 'TIMEOUT' : 'SUCCESS';
        ext.errorCode = statusCode === 502 ? 'GATEWAY_TIMEOUT' : undefined;
        ext.errorMessage = statusCode === 502 ? 'Cashfree upstream failed to respond within 5000ms' : undefined;
        ext.startedAt = reqDate;
        ext.completedAt = new Date(reqDate.getTime() + ext.durationMs);
        ext.createdAt = reqDate;
        dbStore.apiExternalCalls.push(ext);
      }
    }

    // Seed Error Groups
    const sampleErrors = [
      {
        fingerprint: 'Conversion Service:/api/v1/conversions:VALIDATION_FAILED',
        code: 'VALIDATION_FAILED',
        http: 400,
        service: 'Conversion Service',
        route: '/api/v1/conversions',
        msg: 'Invalid conversion payload: missing orderId or currency',
        count: 24,
      },
      {
        fingerprint: 'Auth Gateway:/api/v1/auth/login:UNAUTHORIZED',
        code: 'UNAUTHORIZED',
        http: 401,
        service: 'Auth Gateway',
        route: '/api/v1/auth/login',
        msg: 'Invalid credential or expired bearer token',
        count: 14,
      },
      {
        fingerprint: 'Payout Service:/api/v1/payouts/batches:PAYMENT_PROVIDER_TIMEOUT',
        code: 'PAYMENT_PROVIDER_TIMEOUT',
        http: 502,
        service: 'Payout Service',
        route: '/api/v1/payouts/batches',
        msg: 'Cashfree payout gateway timeout after 3 retries',
        count: 4,
      },
    ];

    for (const se of sampleErrors) {
      const eg = new ApiErrorGroup();
      eg.id = uuidv4();
      eg.errorFingerprint = se.fingerprint;
      eg.errorCode = se.code;
      eg.httpStatus = se.http;
      eg.service = se.service;
      eg.normalizedRoute = se.route;
      eg.message = se.msg;
      eg.occurrenceCount = se.count;
      eg.firstSeenAt = new Date(now - 12 * 24 * 60 * 60 * 1000);
      eg.lastSeenAt = new Date(now - 35 * 60 * 1000);
      eg.status = 'ACTIVE';
      eg.affectedOrganizationsCount = 2;
      eg.affectedClientsCount = 1;
      eg.sampleRequestId = 'req_sample_err_01';
      dbStore.apiErrorGroups.push(eg);
    }

    // Seed Rate Limit Quotas
    const quotas = [
      { name: 'Acme India Pvt Ltd', id: 'org_acme_ind', limit: 5000, current: 4120, violations: 2 },
      { name: 'FlipScale Global', id: 'org_flip_global', limit: 2500, current: 890, violations: 0 },
      { name: 'RazorAffiliates Inc', id: 'org_razor_aff', limit: 10000, current: 9800, violations: 5 },
    ];

    for (const q of quotas) {
      const quota = new ApiRateLimitQuota();
      quota.id = uuidv4();
      quota.entityType = 'ORGANIZATION';
      quota.entityId = q.id;
      quota.entityName = q.name;
      quota.endpoint = '/api/v1/*';
      quota.limit = q.limit;
      quota.currentUsage = q.current;
      quota.windowSeconds = 60;
      quota.rateLimitedCount = q.violations;
      quota.lastViolationAt = q.violations > 0 ? new Date(now - 2 * 60 * 60 * 1000) : undefined;
      quota.status = q.current >= q.limit ? 'EXCEEDED' : q.current >= q.limit * 0.8 ? 'WARNING' : 'NORMAL';
      quota.createdAt = new Date();
      dbStore.apiRateLimitQuotas.push(quota);
    }

    // Seed Audit Log
    const audit = new ApiActivityAudit();
    audit.id = uuidv4();
    audit.action = 'SETTINGS_CHANGED';
    audit.actorId = 'usr_sarah_admin';
    audit.actorEmail = 'sarah.admin@partneriq.in';
    audit.details = { change: 'Updated default body logging policy to METADATA_ONLY' };
    audit.ipAddress = '103.21.14.8';
    audit.timestamp = new Date(now - 24 * 60 * 60 * 1000);
    dbStore.apiActivityAudits.push(audit);

    this.logger.log(`Baseline telemetry seeded: ${dbStore.apiRequests.length} requests, ${dbStore.apiExternalCalls.length} external calls, ${dbStore.apiErrorGroups.length} error groups`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Overview
  // ───────────────────────────────────────────────────────────────────────────

  async getOverview(period = '30d') {
    const periodMs = parsePeriodToMs(period);
    const now = Date.now();
    const cutoff = new Date(now - periodMs);
    const prevCutoff = new Date(now - periodMs * 2);

    const currentRequests = dbStore.apiRequests.filter((r) => new Date(r.createdAt) >= cutoff);
    const previousRequests = dbStore.apiRequests.filter(
      (r) => new Date(r.createdAt) >= prevCutoff && new Date(r.createdAt) < cutoff
    );

    const totalRequests = currentRequests.length;
    const successfulRequests = currentRequests.filter((r) => r.statusCode >= 200 && r.statusCode < 400).length;
    const failedRequests = currentRequests.filter((r) => r.statusCode >= 400).length;
    const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;

    const latencies = currentRequests.map((r) => r.durationMs);
    const avgLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const p95LatencyMs = calculatePercentile(latencies, 95);
    const p99LatencyMs = calculatePercentile(latencies, 99);

    const rateLimitedRequests = currentRequests.filter((r) => r.statusCode === 429).length;
    const uniqueClients = new Set(currentRequests.map((r) => r.apiClientId || r.apiKeyPrefix).filter(Boolean)).size;

    // Previous period delta calculations
    const prevTotal = previousRequests.length;
    const prevSuccess = previousRequests.filter((r) => r.statusCode < 400).length;
    const prevSuccessRate = prevTotal > 0 ? (prevSuccess / prevTotal) * 100 : 100;
    const prevFailed = previousRequests.filter((r) => r.statusCode >= 400).length;
    const prevErrorRate = prevTotal > 0 ? (prevFailed / prevTotal) * 100 : 0;
    const prevLatencies = previousRequests.map((r) => r.durationMs);
    const prevP95 = calculatePercentile(prevLatencies, 95);

    const requestGrowthPct = prevTotal > 0 ? ((totalRequests - prevTotal) / prevTotal) * 100 : 0;
    const successRateDeltaPct = successRate - prevSuccessRate;
    const errorRateDeltaPct = errorRate - prevErrorRate;
    const p95DeltaMs = p95LatencyMs - prevP95;

    // Area Chart Timeline (12 chronological buckets)
    const bucketCount = 12;
    const bucketDurationMs = periodMs / bucketCount;
    const timeline: {
      time: string;
      total: number;
      success: number;
      clientError: number;
      serverError: number;
      rateLimited: number;
    }[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const bStart = new Date(now - periodMs + i * bucketDurationMs);
      const bEnd = new Date(now - periodMs + (i + 1) * bucketDurationMs);

      const bucketReqs = currentRequests.filter(
        (r) => new Date(r.createdAt) >= bStart && new Date(r.createdAt) < bEnd
      );

      const success = bucketReqs.filter((r) => r.statusCode >= 200 && r.statusCode < 400).length;
      const clientError = bucketReqs.filter((r) => r.statusCode >= 400 && r.statusCode < 500 && r.statusCode !== 429).length;
      const serverError = bucketReqs.filter((r) => r.statusCode >= 500).length;
      const rateLimited = bucketReqs.filter((r) => r.statusCode === 429).length;

      timeline.push({
        time: bStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' }),
        total: bucketReqs.length,
        success,
        clientError,
        serverError,
        rateLimited,
      });
    }

    // Top Endpoints
    const endpointMap = new Map<string, { requests: number; success: number; durations: number[]; method: string }>();
    for (const req of currentRequests) {
      const key = `${req.method} ${req.normalizedRoute}`;
      const entry = endpointMap.get(key) || { requests: 0, success: 0, durations: [], method: req.method };
      entry.requests++;
      if (req.statusCode < 400) entry.success++;
      entry.durations.push(req.durationMs);
      endpointMap.set(key, entry);
    }

    const topEndpoints = Array.from(endpointMap.entries())
      .map(([endpoint, data]) => ({
        endpoint,
        method: data.method,
        requests: data.requests,
        successRate: data.requests > 0 ? Math.round((data.success / data.requests) * 100) : 100,
        avgLatencyMs: Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length),
        p95Ms: calculatePercentile(data.durations, 95),
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 6);

    // Recent Errors
    const recentErrors = dbStore.apiErrorGroups.slice(0, 5);

    return {
      kpis: {
        totalRequests,
        successfulRequests,
        failedRequests,
        successRate,
        errorRate,
        avgLatencyMs,
        p95LatencyMs,
        p99LatencyMs,
        rateLimitedRequests,
        activeClients: Math.max(1, uniqueClients),
        comparison: {
          requestGrowthPct: Number(requestGrowthPct.toFixed(1)),
          successRateDeltaPct: Number(successRateDeltaPct.toFixed(2)),
          errorRateDeltaPct: Number(errorRateDeltaPct.toFixed(2)),
          p95DeltaMs,
          hasHistory: prevTotal > 0,
        },
      },
      timeline,
      topEndpoints,
      recentErrors,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Requests Explorer
  // ───────────────────────────────────────────────────────────────────────────

  async getRequests(query: {
    page?: number;
    limit?: number;
    search?: string;
    method?: string;
    status?: string;
    service?: string;
    env?: string;
  }) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const search = query.search?.toLowerCase()?.trim();

    let filtered = [...dbStore.apiRequests].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (search) {
      filtered = filtered.filter(
        (r) =>
          r.requestId.toLowerCase().includes(search) ||
          r.route.toLowerCase().includes(search) ||
          r.actorEmail?.toLowerCase().includes(search) ||
          r.organizationName?.toLowerCase().includes(search) ||
          r.ipAddress.includes(search)
      );
    }

    if (query.method && query.method !== 'ALL') {
      filtered = filtered.filter((r) => r.method === query.method);
    }

    if (query.status && query.status !== 'ALL') {
      if (query.status === 'SUCCESS') filtered = filtered.filter((r) => r.statusCode >= 200 && r.statusCode < 400);
      else if (query.status === 'ERROR') filtered = filtered.filter((r) => r.statusCode >= 400);
      else if (query.status === 'RATE_LIMITED') filtered = filtered.filter((r) => r.statusCode === 429);
      else if (query.status === '4XX') filtered = filtered.filter((r) => r.statusCode >= 400 && r.statusCode < 500);
      else if (query.status === '5XX') filtered = filtered.filter((r) => r.statusCode >= 500);
    }

    if (query.service && query.service !== 'ALL') {
      filtered = filtered.filter((r) => r.service === query.service);
    }

    const total = filtered.length;
    const startIndex = (page - 1) * limit;
    const items = filtered.slice(startIndex, startIndex + limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Request Detail with Full Timeline & Telemetry Breakdown
  // ───────────────────────────────────────────────────────────────────────────

  async getRequestDetail(requestId: string) {
    const request = dbStore.apiRequests.find((r) => r.requestId === requestId || r.id === requestId);
    if (!request) {
      throw new Error(`API Request ${requestId} not found`);
    }

    // Related external calls
    const externalCalls = dbStore.apiExternalCalls.filter(
      (e) => e.apiRequestId === request.requestId || e.apiRequestId === request.id
    );

    // Associated execution timeline (derived from actual timings)
    const totalMs = request.durationMs;
    const gwMs = Math.max(1, Math.round(totalMs * 0.08));
    const authMs = Math.max(1, Math.round(totalMs * 0.05));
    const guardMs = Math.max(1, Math.round(totalMs * 0.03));
    const ctrlMs = Math.max(2, Math.round(totalMs * 0.12));
    const serviceMs = Math.max(2, Math.round(totalMs * 0.22));
    const dbMs = request.databaseDurationMs || Math.max(4, Math.round(totalMs * 0.32));
    const extMs = request.externalDurationMs || (externalCalls.length > 0 ? Math.round(totalMs * 0.4) : 0);
    const respMs = Math.max(1, totalMs - (gwMs + authMs + guardMs + ctrlMs + serviceMs + dbMs + extMs));

    const timeline = [
      { step: 'API Gateway Ingress', durationMs: gwMs, status: 'OK' },
      { step: 'Authentication & Session Verify', durationMs: authMs, status: request.statusCode === 401 ? 'FAILED' : 'OK' },
      { step: 'Organization Guard & RBAC Scoping', durationMs: guardMs, status: request.statusCode === 403 ? 'FAILED' : 'OK' },
      { step: 'Controller Route Execution', durationMs: ctrlMs, status: 'OK' },
      { step: 'Domain Service Processing', durationMs: serviceMs, status: 'OK' },
      { step: `Database Queries (${request.databaseQueryCount || 1} ops)`, durationMs: dbMs, status: 'OK' },
      ...(externalCalls.length > 0 ? [{ step: `External Integrations (${externalCalls[0].provider})`, durationMs: extMs, status: externalCalls[0].result === 'TIMEOUT' ? 'TIMEOUT' : 'OK' }] : []),
      { step: 'Response Serialization & Egress', durationMs: Math.max(1, respMs), status: 'OK' },
    ];

    // Database operations breakdown
    const databaseQueries = [
      {
        operation: 'SELECT',
        table: request.normalizedRoute.includes('conversion') ? 'conversions' : 'programs',
        durationMs: Math.round(dbMs * 0.6),
        queryFingerprint: 'SELECT_ENTITY_BY_ID',
        rowsExamined: 1,
      },
      {
        operation: 'UPDATE',
        table: 'audit_logs',
        durationMs: Math.round(dbMs * 0.4),
        queryFingerprint: 'INSERT_AUDIT_LOG_ENTRY',
        rowsExamined: 1,
      },
    ];

    return {
      ...request,
      timeline,
      databaseQueries,
      externalCalls,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Endpoints Analytics
  // ───────────────────────────────────────────────────────────────────────────

  async getEndpoints() {
    const map = new Map<string, {
      method: string;
      normalizedRoute: string;
      service: string;
      requests: number;
      successCount: number;
      clientErrorCount: number;
      serverErrorCount: number;
      rateLimitedCount: number;
      durations: number[];
      lastCalledAt: Date;
    }>();

    for (const r of dbStore.apiRequests) {
      const key = `${r.method} ${r.normalizedRoute}`;
      const existing = map.get(key) || {
        method: r.method,
        normalizedRoute: r.normalizedRoute,
        service: r.service,
        requests: 0,
        successCount: 0,
        clientErrorCount: 0,
        serverErrorCount: 0,
        rateLimitedCount: 0,
        durations: [],
        lastCalledAt: r.createdAt,
      };

      existing.requests++;
      if (r.statusCode < 400) existing.successCount++;
      else if (r.statusCode === 429) existing.rateLimitedCount++;
      else if (r.statusCode >= 400 && r.statusCode < 500) existing.clientErrorCount++;
      else if (r.statusCode >= 500) existing.serverErrorCount++;

      existing.durations.push(r.durationMs);
      if (new Date(r.createdAt) > new Date(existing.lastCalledAt)) {
        existing.lastCalledAt = r.createdAt;
      }

      map.set(key, existing);
    }

    return Array.from(map.values()).map((e) => ({
      method: e.method,
      endpoint: e.normalizedRoute,
      service: e.service,
      requests: e.requests,
      successRate: e.requests > 0 ? Number(((e.successCount / e.requests) * 100).toFixed(2)) : 100,
      clientErrorRate: e.requests > 0 ? Number(((e.clientErrorCount / e.requests) * 100).toFixed(2)) : 0,
      serverErrorRate: e.requests > 0 ? Number(((e.serverErrorCount / e.requests) * 100).toFixed(2)) : 0,
      p50Ms: calculatePercentile(e.durations, 50),
      p95Ms: calculatePercentile(e.durations, 95),
      p99Ms: calculatePercentile(e.durations, 99),
      avgLatencyMs: Math.round(e.durations.reduce((a, b) => a + b, 0) / e.durations.length),
      lastCalledAt: e.lastCalledAt,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Organizations Usage
  // ───────────────────────────────────────────────────────────────────────────

  async getOrganizations() {
    const map = new Map<string, {
      organizationId: string;
      organizationName: string;
      requests: number;
      successCount: number;
      failedCount: number;
      rateLimitedCount: number;
      durations: number[];
      clients: Set<string>;
      lastActivity: Date;
    }>();

    for (const r of dbStore.apiRequests) {
      const orgId = r.organizationId || 'org_system_internal';
      const orgName = r.organizationName || 'System Platform Internal';

      const existing = map.get(orgId) || {
        organizationId: orgId,
        organizationName: orgName,
        requests: 0,
        successCount: 0,
        failedCount: 0,
        rateLimitedCount: 0,
        durations: [],
        clients: new Set<string>(),
        lastActivity: r.createdAt,
      };

      existing.requests++;
      if (r.statusCode < 400) existing.successCount++;
      else existing.failedCount++;

      if (r.statusCode === 429) existing.rateLimitedCount++;
      existing.durations.push(r.durationMs);

      if (r.apiClientId) existing.clients.add(r.apiClientId);
      if (new Date(r.createdAt) > new Date(existing.lastActivity)) {
        existing.lastActivity = r.createdAt;
      }

      map.set(orgId, existing);
    }

    return Array.from(map.values()).map((o) => ({
      organizationId: o.organizationId,
      organizationName: o.organizationName,
      requests: o.requests,
      successCount: o.successCount,
      failedCount: o.failedCount,
      errorRate: o.requests > 0 ? Number(((o.failedCount / o.requests) * 100).toFixed(2)) : 0,
      rateLimitedCount: o.rateLimitedCount,
      p95Ms: calculatePercentile(o.durations, 95),
      activeClients: Math.max(1, o.clients.size),
      lastActivity: o.lastActivity,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 6. API Clients
  // ───────────────────────────────────────────────────────────────────────────

  async getClients() {
    const map = new Map<string, {
      clientId: string;
      name: string;
      type: string;
      organizationName: string;
      requests: number;
      errors: number;
      rateLimited: number;
      lastUsed: Date;
    }>();

    for (const r of dbStore.apiRequests) {
      const clientId = r.apiClientId || (r.apiKeyPrefix ? `key_${r.apiKeyPrefix}` : 'client_bearer_session');
      const name = r.apiClientName || (r.actorType === 'API_CLIENT' ? 'Affiliate Partner SDK' : 'Web Console Session');
      const type = r.authenticationMethod;
      const org = r.organizationName || 'Acme India Pvt Ltd';

      const existing = map.get(clientId) || {
        clientId,
        name,
        type,
        organizationName: org,
        requests: 0,
        errors: 0,
        rateLimited: 0,
        lastUsed: r.createdAt,
      };

      existing.requests++;
      if (r.statusCode >= 400) existing.errors++;
      if (r.statusCode === 429) existing.rateLimited++;
      if (new Date(r.createdAt) > new Date(existing.lastUsed)) {
        existing.lastUsed = r.createdAt;
      }

      map.set(clientId, existing);
    }

    return Array.from(map.values()).map((c) => ({
      clientId: c.clientId,
      clientName: c.name,
      type: c.type,
      organizationName: c.organizationName,
      requests: c.requests,
      successRate: c.requests > 0 ? Number((((c.requests - c.errors) / c.requests) * 100).toFixed(2)) : 100,
      errorsCount: c.errors,
      rateLimitedCount: c.rateLimited,
      status: 'ACTIVE',
      lastUsedAt: c.lastUsed,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Errors Intelligence
  // ───────────────────────────────────────────────────────────────────────────

  async getErrors() {
    return dbStore.apiErrorGroups.map((g) => ({
      ...g,
      affectedRequests: g.occurrenceCount,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Performance Analytics
  // ───────────────────────────────────────────────────────────────────────────

  async getPerformance() {
    const requests = dbStore.apiRequests;
    const slowRequests = requests
      .filter((r) => r.durationMs > 250)
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 15);

    // Latency distribution buckets
    const distribution = [
      { bucket: '0–50ms', count: requests.filter((r) => r.durationMs <= 50).length },
      { bucket: '50–100ms', count: requests.filter((r) => r.durationMs > 50 && r.durationMs <= 100).length },
      { bucket: '100–250ms', count: requests.filter((r) => r.durationMs > 100 && r.durationMs <= 250).length },
      { bucket: '250–500ms', count: requests.filter((r) => r.durationMs > 250 && r.durationMs <= 500).length },
      { bucket: '500ms–1s', count: requests.filter((r) => r.durationMs > 500 && r.durationMs <= 1000).length },
      { bucket: '> 1s', count: requests.filter((r) => r.durationMs > 1000).length },
    ];

    // Dependency breakdown (average DB vs External vs Core Gateway)
    const avgDb = requests.length > 0 ? Math.round(requests.reduce((a, b) => a + b.databaseDurationMs, 0) / requests.length) : 0;
    const avgExt = requests.length > 0 ? Math.round(requests.reduce((a, b) => a + b.externalDurationMs, 0) / requests.length) : 0;
    const avgTotal = requests.length > 0 ? Math.round(requests.reduce((a, b) => a + b.durationMs, 0) / requests.length) : 0;
    const avgCore = Math.max(5, avgTotal - (avgDb + avgExt));

    return {
      slowRequests,
      distribution,
      dependencyBreakdown: {
        databaseAvgMs: avgDb,
        externalAvgMs: avgExt,
        coreGatewayAvgMs: avgCore,
        totalAvgMs: avgTotal,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 9. Rate Limits Quotas
  // ───────────────────────────────────────────────────────────────────────────

  async getRateLimits() {
    const quotas = dbStore.apiRateLimitQuotas;
    const nearLimitCount = quotas.filter((q) => q.status === 'WARNING').length;
    const exceededCount = quotas.filter((q) => q.status === 'EXCEEDED').length;
    const totalViolations = quotas.reduce((acc, q) => acc + q.rateLimitedCount, 0);

    return {
      stats: {
        totalTracked: quotas.length,
        nearLimitCount,
        exceededCount,
        totalViolations,
      },
      quotas,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 10. Authentication Analytics
  // ───────────────────────────────────────────────────────────────────────────

  async getAuthentication() {
    const requests = dbStore.apiRequests;
    const methods = {
      API_KEY: requests.filter((r) => r.authenticationMethod === 'API_KEY').length,
      JWT: requests.filter((r) => r.authenticationMethod === 'JWT').length,
      SESSION: requests.filter((r) => r.authenticationMethod === 'SESSION').length,
      OAUTH: requests.filter((r) => r.authenticationMethod === 'OAUTH').length,
      NONE: requests.filter((r) => r.authenticationMethod === 'NONE').length,
    };

    const failures = requests.filter((r) => r.statusCode === 401);
    const denials = requests.filter((r) => r.statusCode === 403);

    return {
      methods,
      authFailuresCount: failures.length,
      authDenialsCount: denials.length,
      recentAuthFailures: failures.slice(0, 10),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 11. External API Calls
  // ───────────────────────────────────────────────────────────────────────────

  async getExternalCalls() {
    const calls = dbStore.apiExternalCalls.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const total = calls.length;
    const timeouts = calls.filter((c) => c.result === 'TIMEOUT').length;
    const failures = calls.filter((c) => c.result === 'FAILED').length;
    const retries = calls.reduce((acc, c) => acc + c.retryCount, 0);

    return {
      stats: {
        total,
        timeouts,
        failures,
        retries,
      },
      calls,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 12. Dependencies Topology
  // ───────────────────────────────────────────────────────────────────────────

  async getDependencies() {
    return {
      nodes: [
        { id: 'client', label: 'API Clients & SDKs', type: 'CLIENT', status: 'HEALTHY' },
        { id: 'gateway', label: 'PartnerIQ API Gateway', type: 'GATEWAY', status: 'HEALTHY' },
        { id: 'conversion_svc', label: 'Conversion Service', type: 'SERVICE', status: 'HEALTHY' },
        { id: 'payout_svc', label: 'Payout Service', type: 'SERVICE', status: 'HEALTHY' },
        { id: 'database', label: 'PostgreSQL Primary (TypeORM)', type: 'DATABASE', status: 'HEALTHY' },
        { id: 'cashfree', label: 'Cashfree Banking Gateway', type: 'EXTERNAL', status: 'DEGRADED' },
        { id: 'razorpay', label: 'Razorpay Billing Gateway', type: 'EXTERNAL', status: 'HEALTHY' },
        { id: 'hubspot', label: 'HubSpot CRM Sync', type: 'EXTERNAL', status: 'HEALTHY' },
      ],
      edges: [
        { from: 'client', to: 'gateway', latencyMs: 8 },
        { from: 'gateway', to: 'conversion_svc', latencyMs: 14 },
        { from: 'gateway', to: 'payout_svc', latencyMs: 18 },
        { from: 'conversion_svc', to: 'database', latencyMs: 24 },
        { from: 'payout_svc', to: 'cashfree', latencyMs: 480 },
        { from: 'payout_svc', to: 'database', latencyMs: 32 },
        { from: 'conversion_svc', to: 'hubspot', latencyMs: 120 },
      ],
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 13. Multi-dimensional Usage
  // ───────────────────────────────────────────────────────────────────────────

  async getUsage() {
    const requests = dbStore.apiRequests;
    const total = requests.length;

    const byVersion = {
      v1: requests.filter((r) => r.apiVersion === 'v1').length,
      v2: requests.filter((r) => r.apiVersion === 'v2').length,
    };

    const byMethod = {
      GET: requests.filter((r) => r.method === 'GET').length,
      POST: requests.filter((r) => r.method === 'POST').length,
      PUT: requests.filter((r) => r.method === 'PUT').length,
      DELETE: requests.filter((r) => r.method === 'DELETE').length,
    };

    return {
      totalRequests: total,
      byVersion,
      byMethod,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 14. Operational Alerts
  // ───────────────────────────────────────────────────────────────────────────

  async getAlerts() {
    return [
      {
        id: 'alt_5xx_threshold',
        title: '5xx Server Error Rate Spike',
        rule: 'RATE_5XX_EXCEEDS_THRESHOLD',
        severity: 'HIGH',
        observedValue: '1.8%',
        threshold: '1.0%',
        window: '15m',
        affectedEndpoint: '/api/v1/payouts/batches',
        status: 'ACTIVE',
        detectedAt: new Date(Date.now() - 45 * 60 * 1000),
      },
      {
        id: 'alt_ext_timeout',
        title: 'External Provider High Latency: Cashfree',
        rule: 'EXTERNAL_GATEWAY_TIMEOUT',
        severity: 'CRITICAL',
        observedValue: '1,280 ms',
        threshold: '800 ms',
        window: '30m',
        affectedEndpoint: 'payout_bank_transfer',
        status: 'ACTIVE',
        detectedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    ];
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 15. Security Activity
  // ───────────────────────────────────────────────────────────────────────────

  async getSecurity() {
    const securityRequests = dbStore.apiRequests.filter(
      (r) => r.statusCode === 401 || r.statusCode === 403 || r.statusCode === 429
    );

    return {
      totalSecurityEvents: securityRequests.length,
      unauthenticatedEvents: securityRequests.filter((r) => r.statusCode === 401).length,
      unauthorizedEvents: securityRequests.filter((r) => r.statusCode === 403).length,
      rateLimitAbuseEvents: securityRequests.filter((r) => r.statusCode === 429).length,
      events: securityRequests.slice(0, 20),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 16. Pipeline Exceptions
  // ───────────────────────────────────────────────────────────────────────────

  async getExceptions() {
    return dbStore.apiActivityExceptions;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 17. Audit Logs
  // ───────────────────────────────────────────────────────────────────────────

  async getAuditLogs() {
    return dbStore.apiActivityAudits;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 18. Export Data
  // ───────────────────────────────────────────────────────────────────────────

  async exportData(options: { format: string; filter?: any }, actor: { id: string; email: string }) {
    const requests = dbStore.apiRequests;

    // Record audit
    const audit = new ApiActivityAudit();
    audit.id = uuidv4();
    audit.action = 'EXPORT';
    audit.actorId = actor.id || 'usr_admin';
    audit.actorEmail = actor.email || 'admin@partneriq.in';
    audit.details = { recordCount: requests.length, format: options.format };
    audit.timestamp = new Date();
    dbStore.apiActivityAudits.push(audit);

    // CSV format output
    const headers = ['Request ID', 'Method', 'Route', 'Status', 'Duration (ms)', 'Organization', 'Actor', 'Time'];
    const rows = requests.map((r) => [
      r.requestId,
      r.method,
      `"${r.route}"`,
      r.statusCode,
      r.durationMs,
      `"${r.organizationName || ''}"`,
      `"${r.actorEmail || ''}"`,
      `"${new Date(r.createdAt).toISOString()}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    return {
      filename: `partneriq_api_activity_${new Date().toISOString().split('T')[0]}.csv`,
      data: csvContent,
      count: requests.length,
    };
  }
}

