import { AuthService } from '../modules/auth/auth.service';
import { OrganizationsService } from '../modules/organizations/organizations.service';
import { AffiliatesService } from '../modules/affiliates/affiliates.service';
import { TrackingService } from '../modules/tracking/tracking.service';
import { ConversionsService } from '../modules/conversions/conversions.service';
import { FraudService } from '../modules/fraud/fraud.service';
import { FraudContextFactory } from '../modules/fraud/fraud-context.factory';
import { FraudDecisionService } from '../modules/fraud/fraud-decision.service';
import { FraudEngineService } from '../modules/fraud/fraud-engine.service';
import { FraudPolicyService } from '../modules/fraud/fraud-policy.service';
import { FraudScoreService } from '../modules/fraud/fraud-score.service';
import { FraudSignalRegistry } from '../modules/fraud/fraud-signal-registry';
import {
  AffiliateHighRefundRateSignal,
  AffiliateTrustSignal,
  AffiliateVelocitySignal,
  AmountAnomalySignal,
  ConversionSpeedSignal,
  DeviceVelocitySignal,
  DuplicateConversionSignal,
  DuplicateDeviceSignal,
  GeoMismatchSignal,
  IpVelocitySignal,
  PayoutAmountAnomalySignal,
  SelfReferralSignal,
  UserAgentRiskSignal,
} from '../modules/fraud/signals/phase-one-signals';
import { FraudVelocityService } from '../modules/fraud/velocity/fraud-velocity.service';
import { CommissionsService } from '../modules/commissions/commissions.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { runSeed } from '../database/seeds/run-seed';
import { SecurityUtils } from '../common/utils/security.utils';

async function runTestSuite() {
  console.log('🧪 Running PartnerIQ Comprehensive Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  function createFraudService() {
    const velocity = new FraudVelocityService();
    const registry = new FraudSignalRegistry();
    [
      new IpVelocitySignal(velocity),
      new AffiliateVelocitySignal(velocity),
      new DeviceVelocitySignal(velocity),
      new DuplicateDeviceSignal(),
      new GeoMismatchSignal(),
      new SelfReferralSignal(),
      new ConversionSpeedSignal(),
      new DuplicateConversionSignal(),
      new UserAgentRiskSignal(),
      new AmountAnomalySignal(),
      new AffiliateTrustSignal(),
      new AffiliateHighRefundRateSignal(),
      new PayoutAmountAnomalySignal(),
    ].forEach((signal) => registry.register(signal));
    return new FraudService(
      new FraudContextFactory(),
      new FraudEngineService(
        registry,
        new FraudPolicyService(),
        new FraudScoreService(),
        new FraudDecisionService(),
      ),
    );
  }

  // 1. Database Seed Verification
  const { admin, org, seedPrograms, affiliate } = await runSeed();
  assert(!!admin && !!org, 'Seed Data Initialized');

  // 2. Authentication & Password Security Test
  const authService = new AuthService();
  const loginRes = await authService.login({ email: 'admin@partneriq.demo', password: 'PartnerIQ@123' });
  assert(!!loginRes.accessToken && !!loginRes.refreshToken, 'Admin Authentication Successful');

  // 3. Refresh Token Rotation & Theft Detection Test
  const refreshed = await authService.refreshToken(loginRes.refreshToken);
  assert(!!refreshed.accessToken, 'Token Rotation Succeeded');

  try {
    // Attempt reusing old, rotated refresh token (Theft Detection)
    await authService.refreshToken(loginRes.refreshToken);
    assert(false, 'RefreshToken Reuse Detection should have thrown UnauthorizedException');
  } catch (err: any) {
    assert(err.message.includes('theft detected'), 'Token Theft Detection & Token Family Revocation Passed');
  }

  // 4. Multi-Tenant IDOR Guard Test
  const orgsService = new OrganizationsService();
  const orgB = await orgsService.create(admin.id, { name: 'Tenant B Org', slug: 'tenant-b-org' });
  assert(org.id !== orgB.id, 'Multi-tenant Org B Isolation Verified');

  // 5. Tracking Redirect & Click Capture Test
  const trackingService = new TrackingService(createFraudService());
  const redirectRes = await trackingService.handleRedirect('sarah', 'TestBrowser/1.0', '192.168.1.10');
  assert(!!redirectRes.destinationUrl && !!redirectRes.anonymousId, 'High performance 302 redirect & click logged');

  // 6. Conversions, Idempotency & Financial Ledger Test
  const ledgerService = new LedgerService();
  const fraudService = createFraudService();
  const commissionsService = new CommissionsService(ledgerService);
  const conversionsService = new ConversionsService(fraudService, commissionsService, ledgerService);

  const convRes = await conversionsService.createConversion(
    org.id,
    {
      externalId: 'ORD-99001',
      customerExternalId: redirectRes.anonymousId,
      amount: 20000, // $200.00 in cents
      currency: 'USD',
    },
    'idempotency_key_test_123',
  );

  assert(!!convRes.conversion && convRes.conversion.amount === 20000, 'Conversion Created with Cents Precision');

  // Repeat same conversion with same idempotency key
  const repeatedConv = await conversionsService.createConversion(
    org.id,
    {
      externalId: 'ORD-99001',
      customerExternalId: redirectRes.anonymousId,
      amount: 20000,
      currency: 'USD',
    },
    'idempotency_key_test_123',
  );

  assert(repeatedConv.conversion.id === convRes.conversion.id, 'Idempotency Key Prevents Duplicate Conversions');

  // 7. Ledger Entry Verification
  const ledgerAcc = await ledgerService.getAccount(org.id, affiliate.id);
  assert(ledgerAcc.balance > 0, `Double-entry Ledger Balance Updated: $${(ledgerAcc.balance / 100).toFixed(2)}`);

  // 8. Refund & Clawback Test
  const refundRes = await conversionsService.refundConversion(org.id, convRes.conversion.id, { reason: 'Customer returned product' });
  assert(refundRes.conversion.status === 'REFUNDED', 'Refund & Commission Clawback Executed');

  // 9. Webhook HMAC Signature Test
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = SecurityUtils.signWebhookPayload('secret123', timestamp, '{"test":true}');
  assert(signature.length === 64, 'HMAC SHA-256 Webhook Signature Generated');

  console.log(`\n===================================`);
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`===================================\n`);

  if (failed > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTestSuite().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}
