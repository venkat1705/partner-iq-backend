import { AdminApiActivityService } from '../modules/api-activity/admin-api-activity.service';
import {
  sanitizeQuery,
  sanitizeHeaders,
  normalizeRoutePath,
  classifyApiResult,
  generateFingerprint,
} from '../modules/api-activity/api-telemetry.interceptor';
import { dbStore } from '../database/store';

async function runTests() {
  console.log('🧪 Starting Admin API Activity & Observability Test Suite...');
  let passed = 0;
  let failed = 0;

  const service = new AdminApiActivityService();
  await service.onModuleInit();

  // Test 1: Redaction of sensitive query params
  try {
    const query = {
      programId: 'prog_123',
      token: 'secret_jwt_token_here',
      apiKey: 'pk_live_supersecret',
      limit: '20',
    };
    const clean = sanitizeQuery(query);
    if (
      clean.programId === 'prog_123' &&
      clean.limit === '20' &&
      clean.token === '[REDACTED]' &&
      clean.apiKey === '[REDACTED]'
    ) {
      console.log('  ✅ Test 1 Passed: Sensitive query parameters redacted server-side');
      passed++;
    } else {
      throw new Error(`Unexpected query sanitization: ${JSON.stringify(clean)}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 1 Failed:', err?.message || err);
    failed++;
  }

  // Test 2: Safe headers allowlist and redaction
  try {
    const headers = {
      'content-type': 'application/json',
      'authorization': 'Bearer eyJhbGciOi...',
      'cookie': 'session_token=abc123xyz',
      'x-request-id': 'req_test123',
      'x-custom-secret': 'super_sensitive_key',
    };
    const clean = sanitizeHeaders(headers);
    if (
      clean['content-type'] === 'application/json' &&
      clean['x-request-id'] === 'req_test123' &&
      clean['authorization'] === '[REDACTED]' &&
      clean['cookie'] === '[REDACTED]'
    ) {
      console.log('  ✅ Test 2 Passed: Safe headers allowlisted and auth headers redacted');
      passed++;
    } else {
      throw new Error(`Unexpected header sanitization: ${JSON.stringify(clean)}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 2 Failed:', err?.message || err);
    failed++;
  }

  // Test 3: Route normalization
  try {
    const norm1 = normalizeRoutePath('/api/v1/conversions/c7b2a95e-1234-4567-890a-bcdef0123456');
    const norm2 = normalizeRoutePath('/api/v1/programs/4289?filter=active');
    if (norm1 === '/api/v1/conversions/:id' && norm2 === '/api/v1/programs/:id') {
      console.log('  ✅ Test 3 Passed: Route paths normalized with :id placeholders');
      passed++;
    } else {
      throw new Error(`Route normalization failed: ${norm1}, ${norm2}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 3 Failed:', err?.message || err);
    failed++;
  }

  // Test 4: Classification of HTTP status codes
  try {
    if (
      classifyApiResult(200) === 'SUCCESS' &&
      classifyApiResult(400) === 'CLIENT_ERROR' &&
      classifyApiResult(401) === 'AUTHENTICATION_FAILED' &&
      classifyApiResult(403) === 'AUTHORIZATION_FAILED' &&
      classifyApiResult(429) === 'RATE_LIMITED' &&
      classifyApiResult(502) === 'SERVER_ERROR'
    ) {
      console.log('  ✅ Test 4 Passed: Status codes mapped to semantic categories');
      passed++;
    } else {
      throw new Error('Status classification mismatch');
    }
  } catch (err: any) {
    console.error('  ❌ Test 4 Failed:', err?.message || err);
    failed++;
  }

  // Test 5: Error fingerprint clustering
  try {
    const fp1 = generateFingerprint('Conversion Service', 'POST', '/api/v1/conversions', 'VALIDATION_FAILED');
    const fp2 = generateFingerprint('Conversion Service', 'POST', '/api/v1/conversions', 'VALIDATION_FAILED');
    const fp3 = generateFingerprint('Conversion Service', 'GET', '/api/v1/conversions', 'VALIDATION_FAILED');
    if (fp1 === fp2 && fp1 !== fp3) {
      console.log('  ✅ Test 5 Passed: Error fingerprinting groups identical faults');
      passed++;
    } else {
      throw new Error('Fingerprint mismatch');
    }
  } catch (err: any) {
    console.error('  ❌ Test 5 Failed:', err?.message || err);
    failed++;
  }

  // Test 6: Overview KPIs and timeline
  try {
    const overview = await service.getOverview('30d');
    if (
      overview.kpis.totalRequests > 0 &&
      overview.kpis.successRate > 0 &&
      overview.kpis.p95LatencyMs > 0 &&
      overview.timeline.length === 12 &&
      overview.topEndpoints.length > 0
    ) {
      console.log('  ✅ Test 6 Passed: Real overview KPIs and area chart timeline calculated');
      passed++;
    } else {
      throw new Error(`Overview returned invalid data: ${JSON.stringify(overview.kpis)}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 6 Failed:', err?.message || err);
    failed++;
  }

  // Test 7: Paginated requests stream
  try {
    const res = await service.getRequests({ page: 1, limit: 10 });
    if (res.items.length > 0 && res.total > 0 && res.items[0].requestId) {
      console.log(`  ✅ Test 7 Passed: Paginated requests retrieved (${res.total} total requests)`);
      passed++;
    } else {
      throw new Error('No requests returned');
    }
  } catch (err: any) {
    console.error('  ❌ Test 7 Failed:', err?.message || err);
    failed++;
  }

  // Test 8: Request detail trace
  try {
    const res = await service.getRequests({ page: 1, limit: 1 });
    const firstReq = res.items[0];
    const detail = await service.getRequestDetail(firstReq.requestId);
    if (detail.requestId === firstReq.requestId && detail.timeline.length >= 5) {
      console.log('  ✅ Test 8 Passed: Full request detail and execution timeline verified');
      passed++;
    } else {
      throw new Error('Request detail missing timeline');
    }
  } catch (err: any) {
    console.error('  ❌ Test 8 Failed:', err?.message || err);
    failed++;
  }

  // Test 9: Data export and audit log
  try {
    const beforeCount = dbStore.apiActivityAudits.length;
    const exportRes = await service.exportData(
      { format: 'csv' },
      { id: 'usr_test', email: 'test.admin@partneriq.in' }
    );
    if (exportRes.filename.includes('.csv') && exportRes.data.includes('Request ID') && dbStore.apiActivityAudits.length === beforeCount + 1) {
      console.log('  ✅ Test 9 Passed: Telemetry exported to CSV with immutable audit log');
      passed++;
    } else {
      throw new Error('Export verification failed');
    }
  } catch (err: any) {
    console.error('  ❌ Test 9 Failed:', err?.message || err);
    failed++;
  }

  console.log(`\n📊 API Activity Tests Complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

