import { PartnerIQ as NodeSDK, verifyWebhookSignature } from '../../packages/partneriq-node/src/index';
import { PartnerIQ as BrowserSDK } from '../../packages/partneriq-browser/src/index';
import { runSeed } from '../database/seeds/run-seed';
import { dbStore } from '../database/store';
import { SecurityUtils } from '../common/utils/security.utils';
import { WebhooksService } from '../modules/webhooks/webhooks.service';
import { PayoutsService } from '../modules/payouts/payouts.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { FraudService } from '../modules/fraud/fraud.service';
import { FraudContextFactory } from '../modules/fraud/fraud-context.factory';
import { FraudDecisionService } from '../modules/fraud/fraud-decision.service';
import { FraudEngineService } from '../modules/fraud/fraud-engine.service';
import { FraudPolicyService } from '../modules/fraud/fraud-policy.service';
import { FraudScoreService } from '../modules/fraud/fraud-score.service';
import { FraudSignalRegistry } from '../modules/fraud/fraud-signal-registry';
import { ConversionsService } from '../modules/conversions/conversions.service';
import { CommissionsService } from '../modules/commissions/commissions.service';
import { OrganizationsService } from '../modules/organizations/organizations.service';
import jwtPkg from 'jsonwebtoken';
const jwt = (jwtPkg as any).default || jwtPkg;
import { getJwtConfig } from '../config/jwt.config';

async function runSecurityAuditTests() {
  console.log('\n🔒 ========================================================');
  console.log('🛡️  PARTNERIQ APPLICATION SECURITY & SDK REGRESSION SUITE');
  console.log('🔒 ========================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
      failed++;
    }
  }

  // Initialize Seed Data
  const { admin, org, seedPrograms, affiliate } = await runSeed();

  // =========================================================================
  // 1. CLIENT-SIDE VS SERVER-SIDE CREDENTIAL ISOLATION
  // =========================================================================
  console.log('\n--- 1. Client-Side vs Server-Side Credential Isolation ---');

  // Test: Browser SDK must reject secret API keys (pi_sk_)
  try {
    BrowserSDK.init({ publicKey: 'pi_live_sk_acme_secret_key_12345678' });
    assert(false, 'Browser SDK rejected server secret API key');
  } catch (err: any) {
    assert(
      err.message.includes('Secret API keys cannot be used with @partneriq-io/browser'),
      'Browser SDK blocks secret keys (pi_live_sk_)',
    );
  }

  // Test: Browser SDK accepts valid public keys (pi_pk_)
  try {
    BrowserSDK.init({ publicKey: 'pi_live_pk_acme_public_browser_key_1234' });
    assert(true, 'Browser SDK accepts valid public browser key (pi_live_pk_)');
  } catch {
    assert(false, 'Browser SDK should accept valid public key');
  }

  // Test: Node SDK rejects public browser keys (pi_pk_)
  try {
    new NodeSDK({ apiKey: 'pi_live_pk_cannot_use_public_key_on_server' });
    assert(false, 'Node SDK rejected public browser key');
  } catch (err: any) {
    assert(
      err.message.includes('Use a secret key with pi_test_sk_ or pi_live_sk_ prefix'),
      'Node SDK enforces secret key prefix (pi_live_sk_)',
    );
  }

  // =========================================================================
  // 2. JWT SECURITY & ALGORITHM CONFUSION DEFENSE
  // =========================================================================
  console.log('\n--- 2. JWT Security & Algorithm Confusion Defense ---');

  const jwtConfig = getJwtConfig();
  const validToken = jwt.sign(
    { sub: admin.id, sid: 'session_123', type: 'access' },
    jwtConfig.accessSecret,
    { algorithm: 'HS256', expiresIn: '15m' },
  );

  // Test: Valid JWT verifies successfully
  try {
    const decoded = jwt.verify(validToken, jwtConfig.accessSecret, { algorithms: ['HS256'] }) as any;
    assert(decoded.sub === admin.id, 'Valid HS256 JWT Verified');
  } catch {
    assert(false, 'Valid JWT should verify');
  }

  // Test: Tampered JWT signature is rejected
  try {
    const tampered = validToken.slice(0, -5) + 'AAAAA';
    jwt.verify(tampered, jwtConfig.accessSecret, { algorithms: ['HS256'] });
    assert(false, 'Tampered JWT was accepted');
  } catch {
    assert(true, 'Tampered JWT Signature Rejected');
  }

  // =========================================================================
  // 3. WEBHOOK SECURITY & REPLAY ATTACK MITIGATION
  // =========================================================================
  console.log('\n--- 3. Webhook HMAC & Replay Attack Defense ---');

  const webhookSecret = 'whsec_prod_super_secret_9988776655443322';
  const rawBody = JSON.stringify({ event: 'conversion.created', data: { amount: 10000 } });
  const currentTs = Math.floor(Date.now() / 1000);
  const validSignature = SecurityUtils.signWebhookPayload(webhookSecret, currentTs, rawBody);

  // Test: Valid Webhook Signature
  const isValidSig = verifyWebhookSignature({
    rawBody,
    secret: webhookSecret,
    signature: `v1=${validSignature}`,
    timestamp: currentTs,
  });
  assert(isValidSig, 'Valid Webhook HMAC SHA-256 signature verified');

  // Test: Modified Payload Body is Rejected
  const tamperedBody = JSON.stringify({ event: 'conversion.created', data: { amount: 99999 } });
  const isTamperedSig = verifyWebhookSignature({
    rawBody: tamperedBody,
    secret: webhookSecret,
    signature: `v1=${validSignature}`,
    timestamp: currentTs,
  });
  assert(!isTamperedSig, 'Tampered Webhook Payload Rejected (Signature Mismatch)');

  // Test: Replay Attack (Timestamp > 300 seconds old)
  const expiredTs = currentTs - 360; // 6 minutes old
  const expiredSig = SecurityUtils.signWebhookPayload(webhookSecret, expiredTs, rawBody);
  const isReplayed = verifyWebhookSignature({
    rawBody,
    secret: webhookSecret,
    signature: `v1=${expiredSig}`,
    timestamp: expiredTs,
    toleranceSeconds: 300,
  });
  assert(!isReplayed, 'Replayed Webhook Event (>300s window) Rejected');

  // =========================================================================
  // 4. SSRF (SERVER-SIDE REQUEST FORGERY) DEFENSE
  // =========================================================================
  console.log('\n--- 4. SSRF Defense in Webhook Endpoints ---');

  const webhooksService = new WebhooksService();

  const ssrfTargets = [
    { url: 'http://example.com/webhook', reason: 'Non-HTTPS Protocol' },
    { url: 'https://localhost/webhook', reason: 'Localhost Hostname' },
    { url: 'https://127.0.0.1/webhook', reason: 'IPv4 Loopback' },
    { url: 'https://169.254.169.254/latest/meta-data/', reason: 'Cloud Instance Metadata IP (AWS/GCP/Azure)' },
    { url: 'https://10.0.0.5/api', reason: 'RFC 1918 Private IP (10.0.0.0/8)' },
    { url: 'https://192.168.1.1/api', reason: 'RFC 1918 Private IP (192.168.0.0/16)' },
    { url: 'https://172.16.0.1/api', reason: 'RFC 1918 Private IP (172.16.0.0/12)' },
    { url: 'https://[::1]/api', reason: 'IPv6 Loopback' },
  ];

  for (const target of ssrfTargets) {
    try {
      await webhooksService.createEndpoint(org.id, admin.id, {
        url: target.url,
        subscribedEvents: ['conversion.created' as any],
      });
      assert(false, `SSRF Protection failed for ${target.url}`);
    } catch (err: any) {
      assert(
        err.message.includes('Webhook URL cannot target') || err.message.includes('Webhook URL must use HTTPS'),
        `SSRF Blocked: ${target.reason} (${target.url})`,
      );
    }
  }

  // =========================================================================
  // 5. CSV FORMULA INJECTION DEFENSE (CWE-1236)
  // =========================================================================
  console.log('\n--- 5. CSV Formula Injection Defense (CWE-1236) ---');

  const payoutsService = new PayoutsService(new LedgerService(), {
    evaluatePayout: async () => ({ decision: 'APPROVE', score: 0 } as any),
  } as any);

  // Seed malicious affiliate company name with spreadsheet formula trigger
  const maliciousAffiliate = {
    id: 'aff_csv_inject_test',
    organizationId: org.id,
    userId: 'user_malicious',
    email: 'hacker@partneriq.demo',
    companyName: '=cmd|"/C calc"!A0', // Excel/Calc execution formula
    payoutMethod: 'BANK' as any,
    status: 'ACTIVE' as any,
    tierId: 'tier-1',
    createdAt: new Date(),
  };
  dbStore.affiliates.push(maliciousAffiliate as any);

  dbStore.payoutItems.push({
    id: 'item_csv_test_1',
    batchId: 'batch_csv_test',
    organizationId: org.id,
    affiliateId: maliciousAffiliate.id,
    amount: 5000,
    currency: 'USD',
    status: 'COMPLETED' as any,
    createdAt: new Date(),
  });

  const csvOutput = await payoutsService.generateCsvExport(org.id, 'batch_csv_test');

  // Verify formula was neutralized with a prepended single quote (')
  assert(
    csvOutput.includes(`"'=cmd|""/C calc""!A0"`),
    'CSV Formula Injection neutralized with single quote prefix & escaped quotes',
  );

  // =========================================================================
  // 6. MULTI-TENANT ISOLATION & IDOR PREVENTION
  // =========================================================================
  console.log('\n--- 6. Multi-Tenant Isolation & IDOR Prevention ---');

  const orgsService = new OrganizationsService();
  const orgVictim = await orgsService.create(admin.id, { name: 'Victim Corp', slug: 'victim-corp' });
  const orgAttacker = await orgsService.create(admin.id, { name: 'Attacker Corp', slug: 'attacker-corp' });

  // Create API key in Victim Org
  const victimKey = SecurityUtils.generateApiKey('live');
  dbStore.apiKeys.push({
    id: 'key_victim_1',
    organizationId: orgVictim.id,
    name: 'Victim Key',
    prefix: victimKey.prefix,
    keyHash: victimKey.hash,
    scopes: ['conversions:read', 'conversions:write'],
    status: 'ACTIVE',
    createdAt: new Date(),
  } as any);

  // Create active program in Victim Org
  dbStore.programs.push({
    id: 'prog_victim_1',
    organizationId: orgVictim.id,
    name: 'Victim SaaS Referral Program',
    status: 'ACTIVE',
    createdAt: new Date(),
  } as any);

  // Verify finding conversions in Victim Org cannot be queried by Attacker Org ID
  const conversionsService = new ConversionsService(
    { evaluateConversion: async () => ({ decision: 'APPROVE', score: 0 } as any) } as any,
    { calculateAndRecordCommission: async () => null } as any,
    new LedgerService(),
    { recordApprovedConversion: async () => {} } as any,
    { handleEvent: async () => {} } as any,
  );

  const victimConversion = await conversionsService.createConversion(
    orgVictim.id,
    {
      externalId: 'ORD_VICTIM_001',
      customerExternalId: 'victim_customer@acme.com',
      amount: 15000,
      currency: 'USD',
    },
    'victim_idemp_key',
  );

  // Attacker attempts to read Victim conversion using Attacker org context
  try {
    await conversionsService.findOne(orgAttacker.id, victimConversion.conversion.id);
    assert(false, 'Cross-tenant IDOR access succeeded (FAIL)');
  } catch (err: any) {
    assert(err.message.includes('Conversion not found'), 'Cross-Tenant IDOR Prevented: Victim data invisible to Attacker');
  }

  // =========================================================================
  // 7. FINANCIAL IDEMPOTENCY & DUPLICATE REPLAY DEFENSE
  // =========================================================================
  console.log('\n--- 7. Financial Idempotency & Duplicate Replay Defense ---');

  // Attempt duplicate conversion with different payload on same key -> Must throw 409 Conflict
  try {
    await conversionsService.createConversion(
      orgVictim.id,
      {
        externalId: 'ORD_VICTIM_002_TAMPERED',
        customerExternalId: 'victim_customer@acme.com',
        amount: 9999999, // Tampered amount
        currency: 'USD',
      },
      'victim_idemp_key', // Reused key
    );
    assert(false, 'Idempotency key reuse with tampered payload should fail with 409 Conflict');
  } catch (err: any) {
    assert(
      err.message.includes('Idempotency key reuse detected with different request payload'),
      'Idempotency Key Payload Tampering Blocked (409 Conflict)',
    );
  }

  // =========================================================================
  // 8. SWAGGER / API DOCS ENVIRONMENT ISOLATION
  // =========================================================================
  console.log('\n--- 8. Swagger / API Docs Environment Isolation ---');

  const { getAppConfig } = await import('../config/app.config');
  const devConfig = getAppConfig();
  assert(devConfig.enableSwagger === true, 'Swagger enabled by default in development');

  const origEnv = process.env.NODE_ENV;
  const origEnableSwagger = process.env.ENABLE_SWAGGER;
  process.env.NODE_ENV = 'production';
  delete process.env.ENABLE_SWAGGER;
  const prodConfig = getAppConfig();
  assert(prodConfig.enableSwagger === false, 'Swagger automatically disabled in production (NODE_ENV=production)');
  
  process.env.NODE_ENV = origEnv;
  if (origEnableSwagger !== undefined) {
    process.env.ENABLE_SWAGGER = origEnableSwagger;
  }

  console.log('\n========================================================');
  console.log(`🛡️  SECURITY SUITE SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('========================================================\n');

  if (failed > 0) process.exit(1);
}

runSecurityAuditTests().catch((err) => {
  console.error('Security test suite fatal error:', err);
  process.exit(1);
});
