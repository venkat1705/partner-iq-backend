import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, BillingAddonEntity, BillingPlanEntity } from '../../../database/store';
import { AuditAction } from '../../../common/enums';
import {
  BillingAddonPurchaseStatus,
  BillingInterval,
  BillingResourceType,
  SubscriptionStatus,
} from '../enums/billing.enums';
import { ALL_RESOURCE_TYPES, PLAN_RANK } from '../config/plan-catalog';
import {
  ResourceLimitDetails,
  ResourceLimitReachedException,
} from '../errors/resource-limit.exception';
import { BillingAccountService } from './billing-account.service';
import { SubscriptionUsageService, SubscriptionUsage } from './subscription-usage.service';
import { LimitLockService } from './limit-lock.service';
import { PlanService } from './plan.service';

/** Statuses under which a subscription still grants its plan's allowances. */
const ENTITLING_STATUSES = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.GRACE_PERIOD,
  SubscriptionStatus.CANCEL_PENDING,
  SubscriptionStatus.PAUSED,
];

/**
 * Statuses that still identify "the account's subscription" for reporting, but
 * whose allowances have lapsed. Resolved so the dashboard can explain why.
 */
const LAPSED_STATUSES = [SubscriptionStatus.TRIAL_EXPIRED, SubscriptionStatus.RESTRICTED];

export interface ResourceLimit {
  resourceType: BillingResourceType;
  currentUsage: number;
  /** `null` means unlimited. */
  includedLimit: number | null;
  additionalPurchased: number;
  effectiveLimit: number | null;
  /** `null` means unlimited. */
  remaining: number | null;
  unlimited: boolean;
  atLimit: boolean;
  /** 0-100, or `null` when unlimited. */
  percentUsed: number | null;
  canPurchaseAddon: boolean;
  addon: {
    id: string;
    code: string;
    name: string;
    unitPrice: number;
    currency: string;
    billingInterval: string;
  } | null;
}

export interface EffectiveLimits {
  accountId: string;
  planId: string | null;
  planCode: string;
  planName: string;
  billingInterval: string;
  subscriptionId: string | null;
  subscriptionStatus: string;
  entitled: boolean;
  canUpgradePlan: boolean;
  usage: SubscriptionUsage;
  limits: Record<BillingResourceType, ResourceLimit>;
}

/**
 * The single authority on "may this account create one more X?".
 *
 * Effective limit = the plan's included allowance + every unit of active
 * purchased add-on capacity. A `null` included allowance is unlimited and
 * short-circuits everything, including add-ons.
 *
 * Callers should prefer {@link reserve}, which recounts usage and performs the
 * creation inside a lock, over calling {@link assertCanCreate} and creating
 * afterwards — only the former is safe against concurrent requests.
 */
@Injectable()
export class SubscriptionLimitService {
  private readonly logger = new Logger(SubscriptionLimitService.name);

  constructor(
    private readonly accounts: BillingAccountService,
    private readonly usageService: SubscriptionUsageService,
    private readonly locks: LimitLockService,
    private readonly plans: PlanService,
  ) {}

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  async getEffectiveLimits(accountId: string): Promise<EffectiveLimits> {
    await this.plans.ensureDefaultPlans();

    const { subscription, plan, entitled } = await this.resolveEntitlement(accountId);
    const usage = await this.usageService.getUsage(accountId);
    const addonUnits = this.activeAddonUnits(accountId);
    const addonCatalog = this.addonCatalogByResource(
      (subscription?.billingInterval as BillingInterval) || BillingInterval.MONTHLY,
    );

    const limits = {} as Record<BillingResourceType, ResourceLimit>;
    for (const resourceType of ALL_RESOURCE_TYPES) {
      const planLimit = plan ? this.includedLimitFor(plan.id, resourceType) : { includedLimit: 0, addonPurchasable: false };
      const currentUsage = this.usageFor(usage, resourceType);
      const unlimited = planLimit.includedLimit === null;
      const additionalPurchased = unlimited ? 0 : (addonUnits[resourceType] || 0);
      const effectiveLimit = unlimited
        ? null
        : (planLimit.includedLimit ?? 0) + additionalPurchased;
      const addon = addonCatalog[resourceType] || null;

      limits[resourceType] = {
        resourceType,
        currentUsage,
        includedLimit: planLimit.includedLimit,
        additionalPurchased,
        effectiveLimit,
        remaining: effectiveLimit === null ? null : Math.max(0, effectiveLimit - currentUsage),
        unlimited,
        atLimit: effectiveLimit !== null && currentUsage >= effectiveLimit,
        percentUsed:
          effectiveLimit === null || effectiveLimit === 0
            ? effectiveLimit === null
              ? null
              : 100
            : Math.min(100, Math.round((currentUsage / effectiveLimit) * 100)),
        canPurchaseAddon: !unlimited && planLimit.addonPurchasable && Boolean(addon),
        addon,
      };
    }

    return {
      accountId,
      planId: plan?.id ?? null,
      planCode: plan?.code ?? 'NONE',
      planName: plan?.name ?? 'No plan',
      billingInterval: subscription?.billingInterval || plan?.billingInterval || BillingInterval.MONTHLY,
      subscriptionId: subscription?.id ?? null,
      subscriptionStatus: subscription?.status || 'NONE',
      entitled,
      canUpgradePlan: this.hasHigherPlan(plan?.code),
      usage,
      limits,
    };
  }

  async getEffectiveLimitsForOrganization(organizationId: string): Promise<EffectiveLimits> {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.getEffectiveLimits(account.id);
  }

  async getRemainingCapacity(
    accountId: string,
    resourceType: BillingResourceType,
  ): Promise<number | null> {
    const limits = await this.getEffectiveLimits(accountId);
    return limits.limits[resourceType].remaining;
  }

  /** Non-throwing check. Use {@link reserve} when actually creating something. */
  async canCreate(
    accountId: string,
    resourceType: BillingResourceType,
    quantity = 1,
  ): Promise<{ allowed: boolean; details: ResourceLimitDetails }> {
    const limits = await this.getEffectiveLimits(accountId);
    const details = this.toDetails(limits, resourceType);
    const limit = limits.limits[resourceType];
    const allowed = limit.unlimited || limit.currentUsage + quantity <= (limit.effectiveLimit ?? 0);
    return { allowed, details };
  }

  canCreateOrganization(accountId: string) {
    return this.canCreate(accountId, BillingResourceType.ORGANIZATION);
  }

  canCreateProgram(accountId: string) {
    return this.canCreate(accountId, BillingResourceType.PROGRAM);
  }

  canCreateAffiliate(accountId: string) {
    return this.canCreate(accountId, BillingResourceType.AFFILIATE);
  }

  canCreateMember(accountId: string) {
    return this.canCreate(accountId, BillingResourceType.MEMBER);
  }

  // ---------------------------------------------------------------------
  // Enforcement
  // ---------------------------------------------------------------------

  /**
   * Throws {@link ResourceLimitReachedException} when the account has no room.
   *
   * Only safe on its own for pre-flight checks. Anything that then writes a row
   * must go through {@link reserve} so the check and the write share a lock.
   */
  async assertCanCreate(
    accountId: string,
    resourceType: BillingResourceType,
    quantity = 1,
  ): Promise<void> {
    const { allowed, details } = await this.canCreate(accountId, resourceType, quantity);
    if (!allowed) {
      throw new ResourceLimitReachedException(details);
    }
  }

  /**
   * Re-counts usage, enforces the effective limit, and runs `create` — all
   * while holding the account+resource lock, so two requests racing for the
   * last slot cannot both succeed.
   *
   * @param quantity capacity the operation consumes (bulk invites pass > 1).
   */
  async reserve<T>(
    accountId: string,
    resourceType: BillingResourceType,
    create: () => Promise<T>,
    quantity = 1,
  ): Promise<T> {
    const key = LimitLockService.resourceKey(accountId, resourceType);
    return this.locks.withLock(key, async () => {
      await this.assertCanCreate(accountId, resourceType, quantity);
      return create();
    });
  }

  /**
   * Runs `work` exclusively for this account+resource without asserting the
   * limit itself.
   *
   * For operations that only *sometimes* consume capacity — adding an existing
   * affiliate to a second program, for instance — so the caller can decide
   * inside the lock whether to call {@link assertCanCreate}.
   */
  async runExclusive<T>(
    accountId: string,
    resourceType: BillingResourceType,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.locks.withLock(LimitLockService.resourceKey(accountId, resourceType), work);
  }

  /** As {@link runExclusive}, resolving the account from an organization. */
  async runExclusiveForOrganization<T>(
    organizationId: string,
    resourceType: BillingResourceType,
    work: (accountId: string) => Promise<T>,
  ): Promise<T> {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.runExclusive(account.id, resourceType, () => work(account.id));
  }

  /** As {@link reserve}, resolving the account from an organization. */
  async reserveForOrganization<T>(
    organizationId: string,
    resourceType: BillingResourceType,
    create: () => Promise<T>,
    quantity = 1,
  ): Promise<T> {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.reserve(account.id, resourceType, create, quantity);
  }

  /** As {@link reserve}, resolving the account from the acting user. */
  async reserveForUser<T>(
    userId: string,
    resourceType: BillingResourceType,
    create: () => Promise<T>,
    quantity = 1,
  ): Promise<T> {
    const account = await this.accounts.resolveForUser(userId);
    return this.reserve(account.id, resourceType, create, quantity);
  }

  // ---------------------------------------------------------------------
  // Downgrade support
  // ---------------------------------------------------------------------

  /**
   * Compares current usage against what a target plan would allow, keeping any
   * add-on capacity the account has already bought.
   *
   * Never deletes or disables anything — it only reports which resources would
   * be over the new plan so the customer can decide.
   */
  async previewPlanChange(accountId: string, targetPlanId: string) {
    await this.plans.ensureDefaultPlans();
    const targetPlan = dbStore.billingPlans.find((item) => item.id === targetPlanId);
    const usage = await this.usageService.getUsage(accountId);
    const addonUnits = this.activeAddonUnits(accountId);

    const resources = ALL_RESOURCE_TYPES.map((resourceType) => {
      const planLimit = targetPlan
        ? this.includedLimitFor(targetPlan.id, resourceType)
        : { includedLimit: 0, addonPurchasable: false };
      const unlimited = planLimit.includedLimit === null;
      const additionalPurchased = unlimited ? 0 : (addonUnits[resourceType] || 0);
      const effectiveLimit = unlimited ? null : (planLimit.includedLimit ?? 0) + additionalPurchased;
      const currentUsage = this.usageFor(usage, resourceType);
      return {
        resourceType,
        currentUsage,
        includedLimit: planLimit.includedLimit,
        additionalPurchased,
        effectiveLimit,
        exceedsBy: effectiveLimit === null ? 0 : Math.max(0, currentUsage - effectiveLimit),
        blocking: effectiveLimit !== null && currentUsage > effectiveLimit,
      };
    });

    const blockers = resources.filter((item) => item.blocking);
    return {
      targetPlanId,
      targetPlanCode: targetPlan?.code ?? null,
      targetPlanName: targetPlan?.name ?? null,
      allowed: blockers.length === 0,
      resources,
      blockers,
      message: blockers.length
        ? `Your current usage exceeds the ${targetPlan?.name ?? 'target'} plan for ${blockers
            .map((item) => item.resourceType.toLowerCase())
            .join(', ')}. Reduce usage or keep enough add-on capacity before changing plans. Nothing is deleted.`
        : 'Your current usage fits within the target plan.',
    };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * Finds the subscription that governs an account.
   *
   * Prefers a true account-level subscription. Falls back to the best
   * organization-level subscription on any of the account's organizations, so
   * customers who subscribed before account billing existed are unaffected.
   */
  async resolveEntitlement(accountId: string): Promise<{
    subscription: any | null;
    plan: BillingPlanEntity | null;
    entitled: boolean;
  }> {
    const organizationIds = new Set(await this.accounts.listOrganizationIds(accountId));

    const candidates = dbStore.billingSubscriptions.filter(
      (item) =>
        item.rowStatus === 'ACTIVE' &&
        (item.accountId === accountId || organizationIds.has(item.organizationId)),
    );

    const rankOf = (item: any) => {
      const plan = dbStore.billingPlans.find((p) => p.id === item.planId);
      return PLAN_RANK[plan?.code || 'FREE'] ?? 0;
    };

    const pick = (statuses: SubscriptionStatus[]) =>
      candidates
        .filter((item) => statuses.includes(item.status as SubscriptionStatus))
        .sort((a, b) => {
          // An account-level row always beats a legacy org-level one.
          const scope = Number(b.accountId === accountId) - Number(a.accountId === accountId);
          if (scope !== 0) return scope;
          const rank = rankOf(b) - rankOf(a);
          if (rank !== 0) return rank;
          return new Date(b.modifiedDate).getTime() - new Date(a.modifiedDate).getTime();
        })[0];

    const active = pick(ENTITLING_STATUSES);
    if (active) {
      const plan = dbStore.billingPlans.find((item) => item.id === active.planId) || null;
      return { subscription: active, plan, entitled: true };
    }

    const lapsed = pick(LAPSED_STATUSES);
    if (lapsed) {
      const plan = dbStore.billingPlans.find((item) => item.id === lapsed.planId) || null;
      // A lapsed subscription keeps existing resources visible but grants no new
      // capacity, so limits are reported against the FREE plan.
      return { subscription: lapsed, plan: this.freePlan() || plan, entitled: false };
    }

    return { subscription: null, plan: this.freePlan(), entitled: false };
  }

  private freePlan(): BillingPlanEntity | null {
    return (
      dbStore.billingPlans.find(
        (item) => item.code === 'FREE' && item.billingInterval === BillingInterval.MONTHLY,
      ) || null
    );
  }

  private includedLimitFor(planId: string, resourceType: BillingResourceType) {
    const row = dbStore.billingPlanLimits.find(
      (item) => item.planId === planId && item.resourceType === resourceType,
    );
    if (!row) {
      // A plan with no configured row for this resource is treated as having no
      // allowance, never as unlimited — failing closed is the safe default.
      return { includedLimit: 0 as number | null, addonPurchasable: false };
    }
    return {
      includedLimit: row.includedLimit === undefined ? null : row.includedLimit,
      addonPurchasable: Boolean(row.addonPurchasable),
    };
  }

  /** Units of extra capacity currently granted by paid add-ons, per resource. */
  activeAddonUnits(accountId: string): Record<string, number> {
    const now = Date.now();
    const totals: Record<string, number> = {};
    for (const purchase of dbStore.billingAddonPurchases) {
      if (purchase.accountId !== accountId) continue;
      if (purchase.rowStatus !== 'ACTIVE') continue;
      const grants =
        purchase.status === BillingAddonPurchaseStatus.ACTIVE ||
        purchase.status === BillingAddonPurchaseStatus.CANCEL_PENDING;
      if (!grants) continue;
      if (purchase.endDate && new Date(purchase.endDate).getTime() <= now) continue;
      if (purchase.startDate && new Date(purchase.startDate).getTime() > now) continue;

      const addon = dbStore.billingAddons.find((item) => item.id === purchase.addonId);
      const unitsPer = addon?.unitsPerQuantity ?? 1;
      totals[purchase.resourceType] =
        (totals[purchase.resourceType] || 0) + purchase.quantity * unitsPer;
    }
    return totals;
  }

  private addonCatalogByResource(interval: BillingInterval) {
    const map: Record<string, ResourceLimit['addon']> = {};
    for (const addon of dbStore.billingAddons) {
      if (!addon.isActive || addon.rowStatus !== 'ACTIVE') continue;
      if (addon.billingInterval !== interval) continue;
      map[addon.resourceType] = {
        id: addon.id,
        code: addon.code,
        name: addon.name,
        unitPrice: addon.unitPrice,
        currency: addon.currency,
        billingInterval: addon.billingInterval,
      };
    }
    return map;
  }

  private usageFor(usage: SubscriptionUsage, resourceType: BillingResourceType) {
    switch (resourceType) {
      case BillingResourceType.ORGANIZATION:
        return usage.organizations;
      case BillingResourceType.PROGRAM:
        return usage.programs;
      case BillingResourceType.AFFILIATE:
        return usage.affiliates;
      case BillingResourceType.MEMBER:
        return usage.members;
      default:
        return 0;
    }
  }

  private hasHigherPlan(planCode?: string) {
    const current = PLAN_RANK[planCode || 'FREE'] ?? 0;
    return dbStore.billingPlans.some(
      (item) =>
        item.isActive &&
        item.isPublic &&
        item.rowStatus === 'ACTIVE' &&
        (PLAN_RANK[item.code] ?? 0) > current,
    );
  }

  private toDetails(limits: EffectiveLimits, resourceType: BillingResourceType): ResourceLimitDetails {
    const limit = limits.limits[resourceType];
    return {
      resource: resourceType,
      currentUsage: limit.currentUsage,
      includedLimit: limit.includedLimit,
      additionalPurchased: limit.additionalPurchased,
      effectiveLimit: limit.effectiveLimit,
      remaining: limit.remaining,
      canPurchaseAddon: limit.canPurchaseAddon,
      canUpgradePlan: limits.canUpgradePlan,
      planCode: limits.planCode,
      planName: limits.planName,
      accountId: limits.accountId,
      addon: limit.addon,
    };
  }

  /** Records a rejected creation attempt so admins can see demand for capacity. */
  auditLimitRejection(
    organizationId: string | undefined,
    actorId: string | undefined,
    details: ResourceLimitDetails,
  ) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId: organizationId || undefined,
      actorType: 'USER',
      actorId,
      action: 'SUBSCRIPTION_LIMIT_REACHED' as AuditAction,
      resourceType: 'billing_subscription',
      resourceId: details.accountId,
      metadata: {
        resource: details.resource,
        currentUsage: details.currentUsage,
        effectiveLimit: details.effectiveLimit,
        planCode: details.planCode,
      },
      createdAt: new Date(),
    } as any);
  }
}
