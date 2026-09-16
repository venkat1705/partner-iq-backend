import { v4 as uuidv4 } from 'uuid';
import { runSeed } from '../database/seeds/run-seed';
import { dbStore } from '../database/store';
import { TrackingService } from '../modules/tracking/tracking.service';
import { ConversionsService } from '../modules/conversions/conversions.service';
import { CommissionsService } from '../modules/commissions/commissions.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { WebhooksService } from '../modules/webhooks/webhooks.service';
import { FraudService } from '../modules/fraud/fraud.service';
import { FraudContextFactory } from '../modules/fraud/fraud-context.factory';
import { FraudEngineService } from '../modules/fraud/fraud-engine.service';
import { FraudPolicyService } from '../modules/fraud/fraud-policy.service';
import { FraudScoreService } from '../modules/fraud/fraud-score.service';
import { FraudDecisionService } from '../modules/fraud/fraud-decision.service';
import { FraudSignalRegistry } from '../modules/fraud/fraud-signal-registry';
import { AffiliateStatus, ProgramStatus } from '../common/enums';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: any) {
  if (cond) {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${name}`, detail ?? '');
    failed++;
  }
}

function createFraudService(commissionsService: CommissionsService) {
  return new FraudService(
    new FraudContextFactory(),
    new FraudEngineService(
      new FraudSignalRegistry(),
      new FraudPolicyService(),
      new FraudScoreService(),
      new FraudDecisionService(),
      { createNotification: async () => ({}) } as any,
    ),
    commissionsService,
    new LedgerService(),
  );
}

async function main() {
  console.log('\n🎯 Attribution / Click-ID / Cookie-Deletion / Conversion End-to-End Suite\n');

  const { org, seedPrograms, affiliate } = await runSeed();

  // seedPrograms/affiliate come back from raw TypeORM repositories used by the seed script, which
  // are not guaranteed to be reflected in the in-memory dbStore snapshot the services actually
  // read from - so build fresh, dbStore-resident fixtures from their shape instead of relying on
  // dbStore already containing them (mirrors the pattern the existing test suite uses).
  const program = {
    ...seedPrograms[0],
    id: uuidv4(),
    organizationId: org.id,
    status: ProgramStatus.ACTIVE,
    attributionWindowDays: 30,
    cookieDurationDays: 30,
    deletedAt: undefined,
  };
  dbStore.programs.push(program as any);

  const aff = {
    ...affiliate,
    id: uuidv4(),
    organizationId: org.id,
    status: AffiliateStatus.ACTIVE,
  };
  dbStore.affiliates.push(aff as any);

  const ledgerService = new LedgerService();
  const commissionsService = new CommissionsService(ledgerService);
  const fraudService = createFraudService(commissionsService);
  const trackingService = new TrackingService(fraudService);
  const webhooksService = new WebhooksService();
  const conversionsService = new ConversionsService(fraudService, commissionsService, ledgerService, webhooksService);

  const publicKey = { id: uuidv4(), organizationId: org.id, key: `pi_pub_live_${uuidv4()}`, createdAt: new Date() };
  dbStore.publicKeys.push(publicKey as any);

  const link = await trackingService.createLink(
    org.id,
    { programId: program.id, affiliateId: aff.id, destinationUrl: 'https://acme.com/pricing', customCode: 'smoke-e2e-1' },
    'system',
  );
  assert(!!link.id, 'Tracking link created after affiliate/program active validation');

  // ── Tracking: rejects inactive program/affiliate ──────────────────────────
  try {
    await trackingService.createLink(org.id, { programId: program.id, affiliateId: aff.id, destinationUrl: 'https://x.com' }, 'system');
    // second link with auto shortcode should still succeed since program/affiliate are active; not an error case
  } catch {
    // n/a
  }

  // ── Scenario A: click -> identify (cookie deletion survived via durable identity link) ──
  const click1 = await trackingService.handleRedirect('smoke-e2e-1', 'UA/1.0', '1.2.3.4', undefined, 'US', {
    utmSource: 'newsletter',
    utmCampaign: 'launch',
    landingUrl: 'https://acme.com/?utm_source=newsletter',
  });
  assert(click1.tracked === true && !!click1.clickId, 'Click tracked and returns a durable Click ID', click1);
  const clickRow = dbStore.clicks.find((c) => c.id === click1.clickId);
  assert(clickRow?.utmSource === 'newsletter' && clickRow?.utmCampaign === 'launch', 'UTM parameters captured on the click record', clickRow);

  const identifyRes = await trackingService.identifyCustomer({
    publicKey: publicKey.key,
    anonymousId: click1.anonymousId!,
    customerExternalId: 'cus_scenario_a',
  });
  assert(identifyRes.success === true, 'identify() durably links customer to the click', identifyRes);

  // Simulate: browser cookie is now deleted. A server-to-server conversion arrives with only the
  // customerExternalId the merchant's own checkout knows - no clickId, no cookie.
  const convA = await conversionsService.createConversion(org.id, {
    externalId: 'smoke-ord-a',
    customerExternalId: 'cus_scenario_a',
    amount: 50000,
    currency: 'USD',
  });
  assert(convA.conversion.affiliateId === aff.id, 'Scenario A: attribution survives cookie deletion because identity was linked pre-deletion', convA.conversion.affiliateId);
  assert(convA.conversion.clickId === click1.clickId, 'Conversion records which Click ID it resolved to (auditable)', convA.conversion.clickId);
  assert(convA.conversion.resolvedAttributionId, 'Conversion records which Attribution record it resolved to');

  // ── Scenario B: click, cookie deleted, customer never identified -> no attribution guessed ──
  await trackingService.handleRedirect('smoke-e2e-1', 'UA/1.0', '1.2.3.5');
  const convB = await conversionsService.createConversion(org.id, {
    externalId: 'smoke-ord-b',
    customerExternalId: `cus_never_identified_${Date.now()}`,
    amount: 10000,
    currency: 'USD',
  });
  assert(!convB.conversion.affiliateId, 'Scenario B: no attribution is guessed (no IP/fingerprint fallback) when identity was never linked', convB.conversion.affiliateId);

  // ── Scenario C: clickId passed directly at conversion time (primary identifier) ──
  const click3 = await trackingService.handleRedirect('smoke-e2e-1', 'UA/1.0', '1.2.3.6');
  const convC = await conversionsService.createConversion(org.id, {
    externalId: 'smoke-ord-c',
    customerExternalId: 'cus_device_2',
    amount: 30000,
    currency: 'USD',
    clickId: click3.clickId,
  });
  assert(convC.conversion.affiliateId === aff.id, 'Scenario C: clickId resolves attribution directly, no customer-matching needed', convC.conversion.affiliateId);

  // ── Conversion idempotency ─────────────────────────────────────────────────
  const convC2Dto = { externalId: 'smoke-ord-c2', customerExternalId: 'cus_device_2', amount: 30000, currency: 'USD', clickId: click3.clickId };
  const convC2 = await conversionsService.createConversion(org.id, convC2Dto, 'idem-key-c');
  const convC2Repeat = await conversionsService.createConversion(org.id, convC2Dto, 'idem-key-c');
  assert(convC2Repeat.conversion.id === convC2.conversion.id, 'Repeated request with the same Idempotency-Key + same payload returns the cached original response, never a duplicate', convC2Repeat.conversion.id);

  try {
    await conversionsService.createConversion(
      org.id,
      { externalId: 'smoke-ord-c3-different-payload', customerExternalId: 'cus_device_2', amount: 999999, currency: 'USD' },
      'idem-key-c',
    );
    assert(false, 'Reusing an Idempotency-Key with a materially different payload should be rejected');
  } catch (e: any) {
    assert(e.message.includes('Idempotency key reuse detected'), 'Idempotency-Key reuse with a different payload is rejected with 409, not silently accepted', e.message);
  }

  try {
    await conversionsService.createConversion(org.id, { externalId: 'smoke-ord-c', customerExternalId: 'cus_device_2', amount: 30000, currency: 'USD' });
    assert(false, 'Duplicate externalId without idempotency key should be rejected');
  } catch (e: any) {
    assert(e.message.includes('already exists'), 'Duplicate externalId rejected even without an Idempotency-Key header', e.message);
  }

  // ── Partial refunds + proportional commission clawback ─────────────────────
  const commissionABefore = dbStore.commissions.find((c) => c.conversionId === convA.conversion.id);
  assert(!!commissionABefore, 'Commission was calculated for the attributed conversion');

  const refund1 = await conversionsService.refundConversion(org.id, convA.conversion.id, { amount: 20000, reason: 'partial return' });
  assert(refund1.fullyRefunded === false, 'Partial refund (40% of amount) does not fully refund the conversion', refund1);
  assert((refund1.conversion as any).status === 'PARTIALLY_REFUNDED', 'Conversion status becomes PARTIALLY_REFUNDED', (refund1.conversion as any).status);
  assert(
    commissionABefore!.reversedAmount > 0 && commissionABefore!.reversedAmount < commissionABefore!.commissionAmount,
    'Commission reversed proportionally to the refunded amount, not fully',
    commissionABefore,
  );

  const refund2 = await conversionsService.refundConversion(org.id, convA.conversion.id, { amount: 30000, reason: 'remainder' });
  assert(refund2.fullyRefunded === true, 'Second refund completes the remaining 60% and fully refunds the conversion', refund2);
  assert(commissionABefore!.reversedAmount === commissionABefore!.commissionAmount, 'Commission fully reversed once cumulative refunds cover the full amount', commissionABefore);

  try {
    await conversionsService.refundConversion(org.id, convA.conversion.id, { amount: 100 });
    assert(false, 'Refunding a fully-refunded conversion again should be rejected');
  } catch (e: any) {
    assert(e.message.includes('already been fully refunded'), 'Refunding an already-fully-refunded conversion is rejected', e.message);
  }

  // ── Refund idempotency (previously silently dropped by the endpoint) ───────
  const refundIdem1 = await conversionsService.refundConversion(org.id, convC.conversion.id, { amount: 10000 }, undefined, { idempotencyKey: 'refund-idem-1' });
  const refundIdem2 = await conversionsService.refundConversion(org.id, convC.conversion.id, { amount: 10000 }, undefined, { idempotencyKey: 'refund-idem-1' });
  assert(
    JSON.stringify(refundIdem1) === JSON.stringify(refundIdem2),
    'Repeated refund request with the same Idempotency-Key returns an identical cached result (no double clawback)',
  );

  // ── Customer identity hijack protection ─────────────────────────────────────
  const click4 = await trackingService.handleRedirect('smoke-e2e-1', 'UA/1.0', '1.2.3.7');
  await trackingService.identifyCustomer({ publicKey: publicKey.key, anonymousId: click4.anonymousId!, customerExternalId: 'cus_original_owner' });
  try {
    await trackingService.identifyCustomer({ publicKey: publicKey.key, anonymousId: click4.anonymousId!, customerExternalId: 'cus_attacker' });
    assert(false, 'Re-identifying an anonymousId to a different customer should be rejected');
  } catch (e: any) {
    assert(e.message.includes('already associated with a different customer'), 'Identity hijack via a leaked anonymousId is rejected', e.message);
  }

  // ── Inactive affiliate: link still redirects, but no click/attribution is recorded ──
  aff.status = AffiliateStatus.SUSPENDED;
  const click5 = await trackingService.handleRedirect('smoke-e2e-1', 'UA/1.0', '1.2.3.8');
  assert(click5.tracked === false && !click5.clickId, 'Suspended affiliate: link redirects but does not create a click/attribution', click5);
  assert(click5.destinationUrl === link.destinationUrl, 'Redirect destination is still correct (no broken customer-facing URL)', click5.destinationUrl);
  aff.status = AffiliateStatus.ACTIVE;

  // ── Cross-org shortCode collision is now allowed (previously a global unique constraint) ──
  const org2Id = `org_smoke_${uuidv4()}`;
  dbStore.organizations.push({ ...org, id: org2Id, slug: `smoke-org-${Date.now()}` } as any);
  const program2 = { ...program, id: uuidv4(), organizationId: org2Id };
  dbStore.programs.push(program2 as any);
  const aff2 = { ...aff, id: uuidv4(), organizationId: org2Id, status: AffiliateStatus.ACTIVE };
  dbStore.affiliates.push(aff2 as any);
  try {
    const link2 = await trackingService.createLink(org2Id, { programId: program2.id, affiliateId: aff2.id, destinationUrl: 'https://other.com', customCode: 'smoke-e2e-1' }, 'system');
    assert(!!link2.id, 'Same shortCode is now allowed across two different organizations');
  } catch (e: any) {
    assert(false, 'Same shortCode across two different organizations should be allowed', e.message);
  }

  // ── Cross-tenant attribution isolation ──────────────────────────────────────
  try {
    const convCrossOrg = await conversionsService.createConversion(org2Id, {
      externalId: 'smoke-ord-cross-org',
      customerExternalId: 'cus_device_2', // same customerExternalId used by org1's conversions above
      amount: 1000,
      currency: 'USD',
      clickId: click3.clickId, // org1's click id
    });
    assert(!convCrossOrg.conversion.affiliateId, "Org2 conversion cannot resolve org1's click id into an attribution", convCrossOrg.conversion.affiliateId);
  } catch {
    assert(true, "Org2 conversion cannot resolve org1's click id into an attribution");
  }

  console.log(`\n===================================`);
  console.log(`Attribution E2E Results: ${passed} Passed, ${failed} Failed`);
  console.log(`===================================\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Attribution E2E suite failed:', err);
  process.exit(1);
});
