import { BadRequestException } from '@nestjs/common';
import { GamificationMetric, MilestoneRewardType } from '../enums';

/**
 * PartnerIQ compensation invariant:
 *
 *   CLICK                 -> tracking / attribution signal only
 *   CONVERSION            -> commission eligibility
 *   APPROVED COMMISSION   -> payable balance
 *   PAYOUT                -> actual affiliate payment
 *
 * A click is never, on its own, an earning event. It may be counted, charted,
 * used for attribution and used for fraud detection, but it must not create a
 * commission, a payable balance, a payout or any other financial record.
 *
 * The gamification engine is the one place in the platform where that boundary
 * can realistically be crossed by configuration rather than by code: a milestone
 * or a tier can be gated on TRACKING_LINK_CLICKS while also carrying a FIXED_BONUS
 * (`rewardConfig.bonusAmount`), which the reward executor credits straight to the
 * affiliate ledger as COMMISSION_EARNED. That combination is pay-per-click by
 * another name, so it is rejected at configuration time and again at execution
 * time (existing rows predate the check, so the runtime guard is not redundant).
 *
 * Non-monetary rewards on a click-based milestone/tier stay fully supported —
 * badges, notifications, emails, asset-bundle access. Recognising traffic is fine;
 * paying for it is not.
 */

/** Metrics that measure raw traffic volume rather than qualified conversion outcomes. */
const CLICK_BASED_METRICS: ReadonlySet<string> = new Set<string>([GamificationMetric.TRACKING_LINK_CLICKS]);

export function isClickBasedMetric(metric?: string | GamificationMetric | null): boolean {
  return !!metric && CLICK_BASED_METRICS.has(String(metric));
}

/**
 * A reward is monetary when it credits the affiliate ledger. Only FIXED_BONUS does
 * that (via `bonusAmount`); COMMISSION_RATE_CHANGE only changes the *rate* applied to
 * a future conversion, so money still originates from a conversion and it is allowed.
 */
export function isMonetaryReward(
  rewardType?: string | MilestoneRewardType | null,
  rewardConfig?: { bonusAmount?: number; rewards?: Array<{ type?: string; config?: Record<string, any> }> } | null,
): boolean {
  if (rewardType === MilestoneRewardType.FIXED_BONUS) return true;
  if (Number(rewardConfig?.bonusAmount || 0) > 0) return true;
  // MULTI_REWARD nests its payloads; a bonus hidden one level down is still a bonus.
  if (Array.isArray(rewardConfig?.rewards)) {
    return rewardConfig!.rewards.some(
      (r) => r?.type === MilestoneRewardType.FIXED_BONUS || Number(r?.config?.bonusAmount || 0) > 0,
    );
  }
  return false;
}

export const CLICK_COMPENSATION_MESSAGE =
  'Clicks are a traffic and attribution metric, not an earning event. A cash bonus cannot be awarded for click volume — ' +
  'gate the bonus on a conversion-based metric (approved conversions, attributed revenue, commission earned, closed-won deals), ' +
  'or keep the click target and use a non-monetary reward such as a badge, notification or asset-bundle unlock.';

/**
 * Configuration-time guard for milestones. Throws 400 rather than silently dropping
 * the reward, so the merchant sees why their configuration was refused.
 */
export function assertMilestoneNotClickCompensated(milestone: {
  metric?: string | GamificationMetric | null;
  rewardType?: string | MilestoneRewardType | null;
  rewardConfig?: Record<string, any> | null;
}): void {
  if (isClickBasedMetric(milestone.metric) && isMonetaryReward(milestone.rewardType, milestone.rewardConfig as any)) {
    throw new BadRequestException(CLICK_COMPENSATION_MESSAGE);
  }
}

/** Every metric a tier's conditions are gated on, across both rule shapes. */
export function collectTierConditionMetrics(conditions?: Record<string, any> | null): string[] {
  if (!conditions) return [];
  const metrics: string[] = [];
  if (Array.isArray(conditions.rules)) {
    for (const rule of conditions.rules) {
      if (rule?.metric) metrics.push(String(rule.metric));
    }
  }
  // The `minimum*` shorthands are all conversion-based by construction, so they
  // never contribute a click metric — but they are listed here deliberately so a
  // future `minimumClicks` shorthand has to be considered rather than slipping past.
  return metrics;
}

/**
 * Configuration-time guard for partner tiers. A tier whose promotion is gated on
 * click volume cannot carry a cash bonus.
 */
export function assertTierNotClickCompensated(tier: {
  conditions?: Record<string, any> | null;
  rewardsConfig?: Record<string, any> | null;
}): void {
  const metrics = collectTierConditionMetrics(tier.conditions);
  if (metrics.some(isClickBasedMetric) && isMonetaryReward(null, tier.rewardsConfig as any)) {
    throw new BadRequestException(CLICK_COMPENSATION_MESSAGE);
  }
}

/* ── Automation workflows ───────────────────────────────────────────────────
 * The workflow engine is the third configurable route from a click to a ledger
 * credit: a workflow can be triggered by FIRST_CLICK_RECEIVED, or gated on a
 * CLICKS goal/condition, and then run a GRANT_BONUS action. Same rule applies.
 */

/** Workflow triggers that fire on a click rather than on a conversion. */
const CLICK_BASED_TRIGGERS: ReadonlySet<string> = new Set<string>(['FIRST_CLICK_RECEIVED']);

/** Goal/condition metric names that measure click volume, across both casings in use. */
const CLICK_METRIC_NAMES: ReadonlySet<string> = new Set<string>([
  'CLICKS',
  'clicks',
  'TRACKING_LINK_CLICKS',
  'clickCount',
  'totalClicks',
]);

function isClickMetricName(name?: unknown): boolean {
  return typeof name === 'string' && CLICK_METRIC_NAMES.has(name);
}

/** True when anything upstream of a workflow's actions keys off click volume. */
export function isWorkflowClickGated(workflow: {
  triggerType?: string | null;
  goalConfig?: { metric?: string } | null;
  nodes?: Array<{ type?: string; config?: any }> | null;
}): boolean {
  if (workflow.triggerType && CLICK_BASED_TRIGGERS.has(String(workflow.triggerType))) return true;
  if (isClickMetricName(workflow.goalConfig?.metric)) return true;

  for (const node of workflow.nodes || []) {
    const config = node?.config || {};
    if (CLICK_BASED_TRIGGERS.has(String(config.triggerType || ''))) return true;
    if (isClickMetricName(config.metric) || isClickMetricName(config.goalMetric)) return true;
    for (const condition of config.conditions || []) {
      if (isClickMetricName(condition?.field) || isClickMetricName(condition?.metric)) return true;
    }
  }
  return false;
}

/** True when any node in the workflow credits the affiliate ledger. */
export function workflowGrantsBonus(workflow: { nodes?: Array<{ config?: any }> | null }): boolean {
  return (workflow.nodes || []).some(
    (node) => node?.config?.actionType === 'GRANT_BONUS' && Number(node.config?.bonusAmountCents || 0) > 0,
  );
}

/**
 * Configuration-time guard for automation workflows. A workflow that grants a cash
 * bonus may not be triggered by, or gated on, click volume.
 */
export function assertWorkflowNotClickCompensated(workflow: {
  triggerType?: string | null;
  goalConfig?: { metric?: string } | null;
  nodes?: Array<{ type?: string; config?: any }> | null;
}): void {
  if (workflowGrantsBonus(workflow) && isWorkflowClickGated(workflow)) {
    throw new BadRequestException(CLICK_COMPENSATION_MESSAGE);
  }
}
