/**
 * PartnerIQ compensation invariant suite.
 *
 *   CLICK                 -> tracking / attribution signal only
 *   CONVERSION            -> commission eligibility
 *   APPROVED COMMISSION   -> payable balance
 *   PAYOUT                -> actual affiliate payment
 *
 * These tests pin the boundary that money is only ever created by a qualified
 * conversion. Click-level attribution and analytics are expected to keep working —
 * the suite asserts clicks ARE recorded, just that they never mint a financial record.
 *
 * Attribution mechanics (cookie deletion, identity linking, click-ID resolution) are
 * covered in depth by attribution-e2e.test.ts. This suite covers the compensation
 * boundary, including the three configuration routes — milestone, partner tier and
 * automation workflow — through which a click could otherwise reach the affiliate ledger.
 */
import { v4 as uuidv4 } from 'uuid';
import { runSeed } from './helpers/test-seed';
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
import { MilestoneService } from '../modules/gamification/milestones/milestone.service';
import { TierService } from '../modules/gamification/tiers/tier.service';
import { RewardExecutorService } from '../modules/gamification/rewards/reward-executor.service';
import { WorkflowValidatorService } from '../modules/automations/workflows/workflow-validator.service';
import {
  AffiliateStatus,
  CommissionType,
  GamificationMetric,
  MilestoneRewardType,
  ProgramStatus,
} from '../common/enums';

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

async function assertRejects(fn: () => any, name: string, expectedFragment: string) {
  try {
    await fn();
    assert(false, name, 'expected a rejection, but the call succeeded');
  } catch (e: any) {
    const message = String(e?.message || e);
    assert(message.includes(expectedFragment), name, message);
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

/** Everything this affiliate could ever be paid out of, as one number. */
function payableBalance(organizationId: string, affiliateId: string): number {
  return dbStore.ledgerAccounts
    .filter((a: any) => a.organizationId === organizationId && a.affiliateId === affiliateId)
    .reduce((sum: number, a: any) => sum + (a.balance || 0), 0);
}

function commissionsFor(organizationId: string, affiliateId: string) {
  return dbStore.commissions.filter((c) => c.organizationId === organizationId && c.affiliateId === affiliateId);
}

async function main() {
  console.log('\n💰 Click ≠ Commission — Compensation Invariant Suite\n');

  const { org, seedPrograms, affiliate } = await runSeed();

  // Mirrors attribution-e2e.test.ts: build dbStore-resident fixtures rather than relying on
  // the seed's TypeORM rows being reflected in the in-memory store the services read from.
  const program = {
    ...seedPrograms[0],
    id: uuidv4(),
    organizationId: org.id,
    status: ProgramStatus.ACTIVE,
    attributionWindowDays: 30,
    cookieDurationDays: 30,
    commissionType: CommissionType.PERCENTAGE,
    defaultCommissionValue: 1000, // 10%, in basis points
    deletedAt: undefined,
  };
  dbStore.programs.push(program as any);

  const aff = { ...affiliate, id: uuidv4(), organizationId: org.id, status: AffiliateStatus.ACTIVE };
  dbStore.affiliates.push(aff as any);

  const ledgerService = new LedgerService();
  const commissionsService = new CommissionsService(ledgerService);
  const fraudService = createFraudService(commissionsService);
  const trackingService = new TrackingService(fraudService);
  const webhooksService = new WebhooksService();
  const conversionsService = new ConversionsService(fraudService, commissionsService, ledgerService, webhooksService);

  await trackingService.createLink(
    org.id,
    { programId: program.id, affiliateId: aff.id, destinationUrl: 'https://acme.com/pricing', customCode: 'invariant-1' },
    'system',
  );

  // ── 1. Click test: clicks are recorded, and create no money ────────────────
  console.log('\n── Clicks are tracked but never compensated ──');

  const clicksBefore = dbStore.clicks.length;
  const clickIds: string[] = [];
  for (let i = 0; i < 25; i++) {
    const res = await trackingService.handleRedirect('invariant-1', 'UA/1.0', `9.9.9.${i}`, undefined, 'IN', {
      utmSource: 'newsletter',
    });
    if (res.clickId) clickIds.push(res.clickId);
  }

  assert(dbStore.clicks.length - clicksBefore === 25, 'Click tracking still works — all 25 clicks recorded', {
    recorded: dbStore.clicks.length - clicksBefore,
  });
  assert(clickIds.length === 25, 'Every click returns a durable Click ID for attribution', clickIds.length);
  assert(commissionsFor(org.id, aff.id).length === 0, 'Commission = 0 after 25 clicks');
  assert(payableBalance(org.id, aff.id) === 0, 'Payable balance = 0 after 25 clicks', payableBalance(org.id, aff.id));
  assert(
    !dbStore.payoutItems.some((p: any) => p.affiliateId === aff.id),
    'Payout = 0 after 25 clicks — no payout item exists',
  );
  assert(
    !dbStore.conversions.some((c) => c.affiliateId === aff.id),
    'A click does not create a conversion record',
  );

  // ── 2. Conversion test: money originates from a qualified conversion ───────
  console.log('\n── A qualified conversion creates commission ──');

  const convRes = await conversionsService.createConversion(org.id, {
    externalId: `order-${uuidv4()}`,
    customerExternalId: 'cus_invariant_1',
    amount: 100000, // ₹1,000.00 in the smallest currency unit
    currency: 'INR',
    clickId: clickIds[0],
  } as any);

  assert(convRes.conversion.affiliateId === aff.id, 'Conversion attributed to the affiliate that owned the click');

  const commissions = commissionsFor(org.id, aff.id);
  assert(commissions.length === 1, 'Exactly one commission created for the conversion', commissions.length);
  assert(
    commissions[0]?.conversionId === convRes.conversion.id,
    'Commission is linked to the conversion it came from, not to a click',
    commissions[0]?.conversionId,
  );
  assert(
    commissions[0]?.baseAmount === 100000,
    'Commission is calculated from the conversion value, not from click volume',
    commissions[0]?.baseAmount,
  );
  assert(
    commissions[0]?.commissionAmount === 10000,
    'Percentage commission = conversion value × the program’s configured rate (10% of ₹1,000 = ₹100)',
    commissions[0]?.commissionAmount,
  );
  assert(
    !!commissions[0]?.ruleSnapshot,
    'Commission records the rule it was calculated under — the amount is derived, never hard-coded',
  );

  // ── 3. Duplicate conversion stays idempotent ───────────────────────────────
  console.log('\n── Duplicate conversion creates no duplicate commission ──');

  const dupDto = {
    externalId: `order-${uuidv4()}`,
    customerExternalId: 'cus_invariant_dup',
    amount: 50000,
    currency: 'INR',
    clickId: clickIds[1],
  };
  const first = await conversionsService.createConversion(org.id, dupDto as any, 'idem-invariant-dup');
  const repeat = await conversionsService.createConversion(org.id, dupDto as any, 'idem-invariant-dup');

  const dupConversions = dbStore.conversions.filter((c) => c.externalId === dupDto.externalId);
  const dupCommissions = dbStore.commissions.filter((c) => c.conversionId === first.conversion.id);
  assert(repeat.conversion.id === first.conversion.id, 'Replaying the event returns the original conversion');
  assert(dupConversions.length === 1, 'One conversion event -> one conversion record', dupConversions.length);
  assert(dupCommissions.length === 1, 'One conversion event -> one commission record', dupCommissions.length);

  // ── 4. Refund reverses commission, sized by the conversion ─────────────────
  console.log('\n── Refund reverses commission from the conversion, not from clicks ──');

  const refundCommission = dupCommissions[0]!;
  await conversionsService.refundConversion(org.id, first.conversion.id, {
    amount: 50000,
    reason: 'customer returned',
  } as any);
  assert(
    refundCommission.reversedAmount === refundCommission.commissionAmount,
    'A fully refunded conversion fully reverses its commission',
    { reversed: refundCommission.reversedAmount, original: refundCommission.commissionAmount },
  );
  assert(
    dbStore.clicks.filter((c) => c.affiliateId === aff.id).length === 25,
    'Reversing commission leaves the click records intact — analytics history is not rewritten',
  );

  // ── 5. Cross-program / cross-org ownership ─────────────────────────────────
  console.log('\n── Commission belongs to the right org, program, affiliate and conversion ──');

  const owned = commissionsFor(org.id, aff.id);
  assert(
    owned.every((c) => c.organizationId === org.id && c.programId === program.id && c.affiliateId === aff.id),
    'Every commission carries the correct organization, program and affiliate',
  );
  assert(
    owned.every((c) => !!c.conversionId && dbStore.conversions.some((conv) => conv.id === c.conversionId)),
    'Every commission resolves to a real conversion — no orphaned financial records',
  );

  // ── 6. Milestones cannot pay for clicks ────────────────────────────────────
  console.log('\n── Configuration cannot turn clicks into money ──');

  const milestoneService = new MilestoneService();

  await assertRejects(
    () =>
      milestoneService.createMilestone(org.id, {
        name: 'Traffic bonus',
        code: `CLICK_BONUS_${uuidv4().slice(0, 8)}`,
        metric: GamificationMetric.TRACKING_LINK_CLICKS,
        targetValue: 1000,
        rewardType: MilestoneRewardType.FIXED_BONUS,
        rewardConfig: { bonusAmount: 50000 },
      } as any),
    'A milestone paying a cash bonus for click volume is rejected',
    'not an earning event',
  );

  await assertRejects(
    () =>
      milestoneService.createMilestone(org.id, {
        name: 'Traffic bonus, nested',
        code: `CLICK_MULTI_${uuidv4().slice(0, 8)}`,
        metric: GamificationMetric.TRACKING_LINK_CLICKS,
        targetValue: 1000,
        rewardType: MilestoneRewardType.MULTI_REWARD,
        rewardConfig: { rewards: [{ type: MilestoneRewardType.FIXED_BONUS, config: { bonusAmount: 50000 } }] },
      } as any),
    'A cash bonus nested inside a MULTI_REWARD is caught too',
    'not an earning event',
  );

  const badgeMilestone = await milestoneService.createMilestone(org.id, {
    name: 'Traffic badge',
    code: `CLICK_BADGE_${uuidv4().slice(0, 8)}`,
    metric: GamificationMetric.TRACKING_LINK_CLICKS,
    targetValue: 1000,
    rewardType: MilestoneRewardType.BADGE,
    rewardConfig: { badgeName: 'Traffic Driver' },
  } as any);
  assert(!!badgeMilestone.id, 'A click milestone with a NON-monetary reward is still allowed (recognition is fine)');

  await assertRejects(
    () => milestoneService.updateMilestone(org.id, badgeMilestone.id, { rewardConfig: { bonusAmount: 50000 } } as any),
    'Adding a cash bonus to an existing click milestone is rejected',
    'not an earning event',
  );

  const conversionMilestone = await milestoneService.createMilestone(org.id, {
    name: 'Conversion bonus',
    code: `CONV_BONUS_${uuidv4().slice(0, 8)}`,
    metric: GamificationMetric.APPROVED_CONVERSIONS,
    targetValue: 10,
    rewardType: MilestoneRewardType.FIXED_BONUS,
    rewardConfig: { bonusAmount: 50000 },
  } as any);
  assert(!!conversionMilestone.id, 'A cash bonus gated on APPROVED_CONVERSIONS is allowed');

  await assertRejects(
    () =>
      milestoneService.updateMilestone(org.id, conversionMilestone.id, {
        metric: GamificationMetric.TRACKING_LINK_CLICKS,
      } as any),
    'Switching an existing bonus milestone over to a click metric is rejected',
    'not an earning event',
  );

  // ── 7. Tiers cannot pay for clicks ─────────────────────────────────────────
  const tierService = new TierService({} as any);

  await assertRejects(
    () =>
      tierService.createTier(org.id, {
        name: 'Traffic Tier',
        code: `CLICK_TIER_${uuidv4().slice(0, 8)}`,
        level: 2,
        conditions: {
          matchType: 'ANY',
          rules: [{ metric: GamificationMetric.TRACKING_LINK_CLICKS, operator: 'GREATER_THAN_OR_EQUAL', value: 5000 }],
        },
        rewardsConfig: { bonusAmount: 100000 },
      } as any),
    'A tier paying a cash bonus for click volume is rejected',
    'not an earning event',
  );

  const clickTier = await tierService.createTier(org.id, {
    name: 'Traffic Tier Badge',
    code: `CLICK_TIER_OK_${uuidv4().slice(0, 8)}`,
    level: 2,
    conditions: {
      matchType: 'ANY',
      rules: [{ metric: GamificationMetric.TRACKING_LINK_CLICKS, operator: 'GREATER_THAN_OR_EQUAL', value: 5000 }],
    },
    rewardsConfig: { badgeName: 'High Traffic' },
  } as any);
  assert(!!clickTier.id, 'A click-gated tier with a non-monetary reward is still allowed');

  // ── 8. Runtime guard: pre-existing click-gated bonuses never credit the ledger ──
  console.log('\n── Runtime guard blocks click-sourced ledger credits ──');

  // Simulate a row written before the configuration-time checks existed, by pushing
  // straight to the store rather than going through MilestoneService.
  const legacyMilestone = {
    id: uuidv4(),
    organizationId: org.id,
    programId: program.id,
    name: 'Legacy click bonus',
    code: `LEGACY_${uuidv4().slice(0, 8)}`,
    metric: GamificationMetric.TRACKING_LINK_CLICKS,
    operator: 'GREATER_THAN_OR_EQUAL',
    targetValue: 10,
    period: 'LIFETIME',
    rewardType: MilestoneRewardType.FIXED_BONUS,
    rewardConfig: { bonusAmount: 75000 },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  dbStore.milestones.push(legacyMilestone as any);

  const rewardExecutor = new RewardExecutorService(
    ledgerService,
    { createNotification: async () => ({}) } as any,
    { sendTransactionalEmail: async () => ({}) } as any,
  );

  const balanceBefore = payableBalance(org.id, aff.id);
  const blocked = await rewardExecutor.executeReward({
    organizationId: org.id,
    programId: program.id,
    affiliateId: aff.id,
    rewardType: MilestoneRewardType.FIXED_BONUS,
    rewardConfig: { bonusAmount: 75000 },
    idempotencyKey: uuidv4(),
    milestoneId: legacyMilestone.id,
    source: 'MILESTONE',
  });
  assert(
    blocked.details?.fixedBonus?.status === 'BLOCKED',
    'A legacy click-gated cash bonus is blocked at execution time',
    blocked.details?.fixedBonus,
  );
  assert(
    payableBalance(org.id, aff.id) === balanceBefore,
    'The blocked bonus left the payable balance untouched',
    { before: balanceBefore, after: payableBalance(org.id, aff.id) },
  );

  const allowed = await rewardExecutor.executeReward({
    organizationId: org.id,
    programId: program.id,
    affiliateId: aff.id,
    rewardType: MilestoneRewardType.FIXED_BONUS,
    rewardConfig: { bonusAmount: 25000 },
    idempotencyKey: uuidv4(),
    milestoneId: conversionMilestone.id,
    source: 'MILESTONE',
  });
  assert(
    allowed.details?.fixedBonus?.status === 'CREDITED',
    'A conversion-gated cash bonus still credits normally — the guard is targeted, not a blanket block',
    allowed.details?.fixedBonus,
  );

  // ── 9. Automation workflows cannot pay for clicks ──────────────────────────
  const workflowValidator = new WorkflowValidatorService({} as any);

  await assertRejects(
    () =>
      workflowValidator.validateWorkflow({
        organizationId: org.id,
        triggerType: 'FIRST_CLICK_RECEIVED',
        nodes: [
          { id: 'n1', type: 'TRIGGER', config: { triggerType: 'FIRST_CLICK_RECEIVED' } },
          { id: 'n2', type: 'ACTION', config: { actionType: 'GRANT_BONUS', bonusAmountCents: 20000 } },
        ],
        edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
      } as any),
    'A workflow granting a bonus on FIRST_CLICK_RECEIVED is rejected',
    'not an earning event',
  );

  await assertRejects(
    () =>
      workflowValidator.validateWorkflow({
        organizationId: org.id,
        triggerType: 'AFFILIATE_JOINED_PROGRAM',
        goalConfig: { metric: 'CLICKS', operator: 'GREATER_THAN', value: 500 },
        nodes: [
          { id: 'n1', type: 'TRIGGER', config: { triggerType: 'AFFILIATE_JOINED_PROGRAM' } },
          { id: 'n2', type: 'ACTION', config: { actionType: 'GRANT_BONUS', bonusAmountCents: 20000 } },
        ],
        edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
      } as any),
    'A workflow granting a bonus behind a CLICKS goal is rejected',
    'not an earning event',
  );

  const nudgeOk = workflowValidator.validateWorkflow({
    organizationId: org.id,
    triggerType: 'FIRST_CLICK_RECEIVED',
    nodes: [
      { id: 'n1', type: 'TRIGGER', config: { triggerType: 'FIRST_CLICK_RECEIVED' } },
      { id: 'n2', type: 'ACTION', config: { actionType: 'SEND_NOTIFICATION', notificationTitle: 'Nice, first click!' } },
    ],
    edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
  } as any);
  assert(nudgeOk.valid === true, 'A click-triggered workflow with a non-monetary action is still allowed');

  const convWorkflowOk = workflowValidator.validateWorkflow({
    organizationId: org.id,
    triggerType: 'CONVERSION_APPROVED',
    nodes: [
      { id: 'n1', type: 'TRIGGER', config: { triggerType: 'CONVERSION_APPROVED' } },
      { id: 'n2', type: 'ACTION', config: { actionType: 'GRANT_BONUS', bonusAmountCents: 20000 } },
    ],
    edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
  } as any);
  assert(convWorkflowOk.valid === true, 'A bonus workflow triggered by an approved conversion is allowed');

  console.log('\n===================================');
  console.log(`Compensation Invariant Results: ${passed} Passed, ${failed} Failed`);
  console.log('===================================\n');
  // Exit explicitly: the seed leaves a TypeORM connection pool open, so the process
  // would otherwise idle instead of terminating once the assertions are done.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Compensation invariant suite failed:', err);
  process.exit(1);
});
