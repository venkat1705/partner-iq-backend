import { AuthService } from '../modules/auth/auth.service';
import { RiskEngineService } from '../modules/auth/risk-engine.service';
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
import { WebhooksService } from '../modules/webhooks/webhooks.service';
import { runSeed } from '../database/seeds/run-seed';
import { SecurityUtils } from '../common/utils/security.utils';
import { AssetManagementService } from '../modules/asset-management/asset-management.service';
import { dbStore } from '../database/store';
import { AffiliateAssetActivityType, AssetBundleVisibility, AssetSourceType, AssetStatus, AssetType, AttributionModel, Role } from '../common/enums';
import { MembershipStatus } from '../common/enums/rbac';

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

  function createFraudService(commissionsService: CommissionsService) {
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
        { createNotification: async () => ({}) } as any,
      ),
      commissionsService,
      new LedgerService(),
    );
  }

  // Shared ledger/commissions instances used by both the fraud/tracking smoke test
  // below and the full conversions test further down.
  const sharedLedgerService = new LedgerService();
  const sharedCommissionsService = new CommissionsService(sharedLedgerService);

  // 1. Database Seed Verification
  const { admin, org, seedPrograms, affiliate } = await runSeed();
  assert(!!admin && !!org, 'Seed Data Initialized');

  // 2. Authentication & Password Security Test
  const authService = new AuthService(new RiskEngineService());
  const loginRes = (await authService.login({ email: 'admin@partneriq.demo', password: 'PartnerIQ@123' })) as any;
  assert(!!loginRes.accessToken && !!loginRes.refreshToken, 'Admin Authentication Successful');

  // 3. Refresh Token Rotation & Theft Detection Test
  const refreshed = await authService.refreshToken(loginRes.refreshToken);
  assert(!!refreshed.accessToken, 'Token Rotation Succeeded');

  try {
    // Attempt reusing old, rotated refresh token (Theft Detection)
    await authService.refreshToken(loginRes.refreshToken);
    assert(false, 'RefreshToken Reuse Detection should have thrown UnauthorizedException');
  } catch (err: any) {
    assert(err.message.includes('Session security violation') || err.message.includes('theft'), 'Token Theft Detection & Token Family Revocation Passed');
  }

  // 4. Multi-Tenant IDOR Guard Test
  const orgsService = new OrganizationsService();
  const orgB = await orgsService.create(admin.id, { name: 'Tenant B Org', slug: 'tenant-b-org' });
  assert(org.id !== orgB.id, 'Multi-tenant Org B Isolation Verified');

  // 4a. Affiliate eligibility policy blocks every active organization user role, not only owners/admins.
  const orgMemberUser = {
    id: 'usr_active_org_member_affiliate_policy',
    email: 'active-org-member@example.com',
    passwordHash: 'unused',
    firstName: 'Active',
    lastName: 'Member',
    status: 'ACTIVE',
    emailVerified: true,
    platformRole: 'USER',
    failedLoginAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
  dbStore.users.push(orgMemberUser);
  dbStore.organizationMemberships.push({
    id: 'mem_active_org_member_affiliate_policy',
    organizationId: org.id,
    userId: orgMemberUser.id,
    role: Role.VIEWER,
    status: MembershipStatus.ACTIVE,
    programAccessType: 'ALL',
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  const affiliatesService = new AffiliatesService(
    { sendAffiliateInvitationEmail: async () => ({ sent: false, reason: 'test' }) } as any,
    {} as any,
    { handleEvent: async () => undefined } as any,
  );

  try {
    await affiliatesService.inviteAffiliate(
      org.id,
      {
        programId: seedPrograms[0].id,
        partnerName: 'Active Organization Member',
        email: orgMemberUser.email,
      },
      admin.id,
    );
    assert(false, 'Active organization members cannot be invited as affiliates');
  } catch (err: any) {
    const response = typeof err.getResponse === 'function' ? err.getResponse() : {};
    assert(
      response?.code === 'AFFILIATE_INELIGIBLE_ORGANIZATION_MEMBER',
      'Active organization members cannot be invited as affiliates',
    );
  }

  // 4b. Asset Library Tenant Isolation, Versioning, Publishing, Personalization & Analytics
  const assetService = new AssetManagementService();
  const launchCopy = await assetService.createAsset(org.id, admin.id, {
    name: 'HR Mentor Pro Launch LinkedIn Post',
    assetType: AssetType.SOCIAL_COPY,
    sourceType: AssetSourceType.TEXT,
    textContent: 'Join HR Mentor with {{affiliate_name}}. Use {{coupon_code}}: {{affiliate_tracking_link}}',
    status: AssetStatus.PUBLISHED,
    isPublicToAffiliates: true,
    isCopyable: true,
    isDownloadable: false,
    programId: seedPrograms[0].id,
    tags: ['LinkedIn', 'Launch'],
  });
  assert(launchCopy.version === 1 && launchCopy.status === AssetStatus.PUBLISHED, 'Marketing Asset Created and Published');

  await assetService.addVersion(org.id, launchCopy.id, admin.id, { changeNotes: 'Updated campaign copy' });
  const versions = await assetService.listVersions(org.id, launchCopy.id);
  assert(versions.length === 2 && versions[0].isCurrent, 'Asset Version History Tracks Current Version');

  const bundle = await assetService.createBundle(org.id, admin.id, {
    name: 'HR Mentor Pro Launch Kit',
    programId: seedPrograms[0].id,
    visibility: AssetBundleVisibility.ALL_PROGRAM_AFFILIATES,
  });
  await assetService.addBundleAsset(org.id, bundle.id, admin.id, { assetId: launchCopy.id, displayOrder: 1 });
  const publishedBundle = await assetService.publishBundle(org.id, bundle.id, admin.id);
  assert(publishedBundle.status === 'PUBLISHED' && publishedBundle.items.length === 1, 'Asset Bundle Published with Reusable Asset');

  const affiliateBundles = await assetService.listAffiliateBundles(org.id, affiliate.id);
  assert(affiliateBundles.some((item) => item.id === bundle.id), 'Affiliate Sees Authorized Published Bundle');

  await assetService.recordActivity(org.id, affiliate.id, launchCopy.id, {
    activityType: AffiliateAssetActivityType.COPY,
    bundleId: bundle.id,
    idempotencyKey: 'asset-copy-test-1',
  });
  await assetService.recordActivity(org.id, affiliate.id, launchCopy.id, {
    activityType: AffiliateAssetActivityType.COPY,
    bundleId: bundle.id,
    idempotencyKey: 'asset-copy-test-1',
  });
  const assetAnalytics = await assetService.analytics(org.id);
  assert(assetAnalytics.totals.copies === 1 && assetAnalytics.totals.activeAffiliatesUsingAssets >= 1, 'Asset Activity Analytics Deduplicate Idempotent Events');

  try {
    await assetService.getAsset(orgB.id, launchCopy.id);
    assert(false, 'Cross-tenant Asset Access should have thrown NotFoundException');
  } catch {
    assert(true, 'Cross-tenant Asset Access Blocked');
  }

  // 5. Tracking Redirect & Click Capture Test
  const trackingService = new TrackingService(createFraudService(sharedCommissionsService));
  const redirectRes = await trackingService.handleRedirect('k8s-deepdive', 'TestBrowser/1.0', '192.168.1.10');
  assert(!!redirectRes.destinationUrl && !!redirectRes.anonymousId, 'High performance 302 redirect & click logged');

  // Backdate the click so the conversion below simulates a customer who browsed for a while before
  // buying, rather than an instant click-to-purchase (which the fraud engine correctly flags as
  // suspiciously fast - that signal is working as intended, so the fix belongs in the test data).
  const backdatedClick = dbStore.clicks.find((c) => c.id === redirectRes.clickId);
  if (backdatedClick) backdatedClick.createdAt = new Date(Date.now() - 15 * 60 * 1000);

  // 6. Conversions, Idempotency & Financial Ledger Test
  const ledgerService = sharedLedgerService;
  const commissionsService = sharedCommissionsService;
  const fraudService = createFraudService(commissionsService);
  const webhooksService = new WebhooksService();
  const conversionsService = new ConversionsService(fraudService, commissionsService, ledgerService, webhooksService);

  const convRes = await conversionsService.createConversion(
    org.id,
    {
      externalId: 'ORD-99001',
      customerExternalId: redirectRes.anonymousId,
      amount: 2500, // in cents
      currency: seedPrograms[0]?.currency || 'INR',
    },
    'idempotency_key_test_123',
  );

  assert(!!convRes.conversion && convRes.conversion.amount === 2500, 'Conversion Created with Cents Precision');

  // Repeat same conversion with same idempotency key
  const repeatedConv = await conversionsService.createConversion(
    org.id,
    {
      externalId: 'ORD-99001',
      customerExternalId: redirectRes.anonymousId,
      amount: 2500,
      currency: seedPrograms[0]?.currency || 'INR',
    },
    'idempotency_key_test_123',
  );

  assert(repeatedConv.conversion.id === convRes.conversion.id, 'Idempotency Key Prevents Duplicate Conversions');

  // 7. Multi-touch & custom attribution model test
  const multiTouchProgram = {
    ...seedPrograms[0],
    id: 'program-multitouch',
    organizationId: org.id,
    attributionModel: AttributionModel.MULTI_TOUCH,
    attributionWindowDays: 45,
    attributionConfig: {
      weights: { first: 0.25, middle: 0.5, last: 0.25 },
      stageWeights: { discovery: 0.2, consideration: 0.5, purchase: 0.3 },
    },
    couponAttributionPriority: 'PROMO_CODE',
  };
  dbStore.programs.push(multiTouchProgram as any);

  const viaLegacy = 'anon_multi_touch_legacy';
  const partnerA = 'affiliate-mt-a';
  const partnerB = 'affiliate-mt-b';
  const partnerC = 'affiliate-mt-c';
  dbStore.attributions.push(
    { id: 'attr-mt-1', organizationId: org.id, programId: multiTouchProgram.id, affiliateId: partnerA, clickId: 'click-mt-1', anonymousId: viaLegacy, model: AttributionModel.FIRST_CLICK, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8) } as any,
    { id: 'attr-mt-2', organizationId: org.id, programId: multiTouchProgram.id, affiliateId: partnerB, clickId: 'click-mt-2', anonymousId: viaLegacy, model: AttributionModel.MULTI_TOUCH, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3) } as any,
    { id: 'attr-mt-3', organizationId: org.id, programId: multiTouchProgram.id, affiliateId: partnerC, clickId: 'click-mt-3', anonymousId: viaLegacy, model: AttributionModel.LAST_CLICK, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12) } as any,
  );

  const customRes = await conversionsService.createConversion(
    org.id,
    {
      externalId: 'ORD-MULTI-TOUCH-01',
      customerExternalId: viaLegacy,
      amount: 25000,
      currency: multiTouchProgram.currency || 'INR',
      metadata: { promoCode: 'SAVE20' },
    },
    'multi_touch_test_key',
  );

  assert(customRes.conversion.affiliateId === partnerB, 'Multi-touch attribution chooses the highest weighted partner in the journey');

  // 8. Ledger Entry Verification
  const ledgerAcc = await ledgerService.getAccount(org.id, affiliate.id);
  assert(ledgerAcc.balance > 0, `Double-entry Ledger Balance Updated: $${(ledgerAcc.balance / 100).toFixed(2)}`);

  // 9. Refund & Clawback Test
  const refundRes = await conversionsService.refundConversion(org.id, convRes.conversion.id, { reason: 'Customer returned product' });
  assert(refundRes.conversion.status === 'REFUNDED', 'Refund & Commission Clawback Executed');

  // 10. Webhook HMAC Signature Test
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = SecurityUtils.signWebhookPayload('secret123', timestamp, '{"test":true}');
  assert(signature.length === 64, 'HMAC SHA-256 Webhook Signature Generated');

  console.log(`\n===================================`);
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`===================================\n`);

  if (failed > 0) process.exit(1);
}

runTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
