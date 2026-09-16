import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { AuditAction } from '../../../common/enums';
import { BillingInterval, PaymentProviderType, SubscriptionStatus } from '../enums/billing.enums';
import { PlanService } from './plan.service';
import { PaymentProviderFactory } from '../providers/payment-provider.factory';
import { BillingAccountService } from './billing-account.service';
import { SubscriptionLimitService } from './subscription-limit.service';

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly plans: PlanService,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly accounts: BillingAccountService,
    private readonly limits: SubscriptionLimitService,
  ) {}

  /**
   * The subscription governing this organization.
   *
   * Resolution is account-wide: one paid subscription covers every organization
   * the customer owns, so a sibling organization's subscription is returned here
   * too. Legacy organization-scoped subscriptions still resolve, because they
   * belong to an organization sitting on the same account.
   */
  async current(organizationId: string) {
    await this.plans.ensureDefaultPlans();
    this.expireStalePendingCheckouts(organizationId);
    this.expireStaleTrials(organizationId);

    const account = await this.accounts.resolveForOrganization(organizationId);
    const organizationIds = new Set(await this.accounts.listOrganizationIds(account.id));

    const subscription = dbStore.billingSubscriptions
      .filter((item) =>
        (item.accountId === account.id || organizationIds.has(item.organizationId)) &&
        item.rowStatus === 'ACTIVE' &&
        [
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.CANCEL_PENDING,
          SubscriptionStatus.PAUSED,
          SubscriptionStatus.TRIAL_EXPIRED,
          SubscriptionStatus.RESTRICTED,
        ].includes(item.status as SubscriptionStatus),
      )
      .sort((a, b) => {
        // An account-level subscription always wins over a legacy org-level one.
        const scope = Number(b.accountId === account.id) - Number(a.accountId === account.id);
        if (scope !== 0) return scope;
        const planA = dbStore.billingPlans.find((plan) => plan.id === a.planId);
        const planB = dbStore.billingPlans.find((plan) => plan.id === b.planId);
        const rankDiff = this.plans.rank(planB?.code) - this.plans.rank(planA?.code);
        if (rankDiff !== 0) return rankDiff;
        return new Date(b.modifiedDate).getTime() - new Date(a.modifiedDate).getTime();
      })[0];

    const plan = subscription
      ? dbStore.billingPlans.find((item) => item.id === subscription.planId)
      : dbStore.billingPlans.find((item) => item.code === 'FREE' && item.billingInterval === 'MONTHLY');

    return {
      accountId: account.id,
      subscription: subscription || null,
      plan: plan ? this.plans.canonicalizeBuiltInPlan(plan, (subscription?.billingInterval || plan.billingInterval) as BillingInterval) : plan,
    };
  }

  /**
   * Moves the account to a larger plan immediately.
   *
   * Existing add-ons are deliberately kept: their capacity stacks on top of the
   * new plan's included allowance, so nothing the customer paid for is silently
   * removed. Included capacity is never double-counted, because the new plan's
   * allowance *replaces* the old one rather than adding to it.
   */
  async upgrade(organizationId: string, userId: string, planId: string, billingInterval: BillingInterval) {
    const plan = await this.plans.getActivePlan(planId, billingInterval);
    const { subscription, plan: currentPlan, accountId } = await this.current(organizationId);
    if (currentPlan && this.plans.rank(plan.code) <= this.plans.rank(currentPlan.code)) {
      throw new BadRequestException({ code: 'PLAN_NOT_HIGHER', message: 'Select a higher plan to upgrade.' });
    }
    if (!subscription) {
      throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'No active subscription exists.' });
    }

    const previousPlanCode = currentPlan?.code;
    subscription.planId = plan.id;
    subscription.billingInterval = billingInterval;
    subscription.status = SubscriptionStatus.ACTIVE;
    // Attach to the account so the subscription now covers every organization
    // the customer owns, not only the one it was originally created under.
    subscription.accountId = subscription.accountId || accountId;
    subscription.modifiedBy = userId;
    subscription.modifiedDate = new Date();

    this.audit(organizationId, userId, 'SUBSCRIPTION_UPGRADED', subscription.id, {
      fromPlan: previousPlanCode,
      toPlan: plan.code,
      billingInterval,
      accountId,
    });

    return { subscription, plan, limits: await this.limits.getEffectiveLimits(accountId) };
  }

  /**
   * Schedules a move to a smaller plan at the end of the current period.
   *
   * Refuses when current usage would not fit the target plan (its allowance plus
   * any retained add-ons), and returns exactly which resources are over. No
   * organization, program, affiliate or member is ever deleted or disabled by a
   * downgrade — the customer either reduces usage or keeps enough add-on
   * capacity to cover it.
   */
  async downgrade(organizationId: string, userId: string, planId: string, billingInterval: BillingInterval) {
    const plan = await this.plans.getActivePlan(planId, billingInterval);
    const { subscription, plan: currentPlan, accountId } = await this.current(organizationId);
    if (currentPlan && this.plans.rank(plan.code) >= this.plans.rank(currentPlan.code)) {
      throw new BadRequestException({ code: 'PLAN_NOT_LOWER', message: 'Select a lower plan to downgrade.' });
    }
    if (!subscription) {
      throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'No active subscription exists.' });
    }

    const preview = await this.limits.previewPlanChange(accountId, plan.id);
    if (!preview.allowed) {
      throw new BadRequestException({
        code: 'DOWNGRADE_USAGE_EXCEEDS_PLAN',
        message: preview.message,
        details: preview,
      });
    }

    subscription.pendingPlanId = plan.id;
    subscription.scheduledChangeDate = subscription.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 3600 * 1000);
    subscription.accountId = subscription.accountId || accountId;
    subscription.modifiedBy = userId;
    subscription.modifiedDate = new Date();

    this.audit(organizationId, userId, 'SUBSCRIPTION_DOWNGRADED', subscription.id, {
      fromPlan: currentPlan?.code,
      pendingPlan: plan.code,
      scheduledChangeDate: subscription.scheduledChangeDate,
      accountId,
    });

    return { subscription, pendingPlan: plan, preview };
  }

  async cancel(organizationId: string, userId: string, immediate = false) {
    const { subscription } = await this.current(organizationId);
    if (!subscription?.providerSubscriptionId) {
      throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'No provider subscription exists.' });
    }
    const provider = this.providerFactory.getProvider(subscription.provider as PaymentProviderType);
    await provider.cancelSubscription(subscription.providerSubscriptionId, { cancelAtCycleEnd: !immediate });
    subscription.cancelAtPeriodEnd = !immediate;
    subscription.cancelledAt = immediate ? new Date() : undefined;
    subscription.status = immediate ? SubscriptionStatus.CANCELLED : SubscriptionStatus.CANCEL_PENDING;
    subscription.modifiedBy = userId;
    subscription.modifiedDate = new Date();
    this.audit(organizationId, userId, 'SUBSCRIPTION_CANCELLED', subscription.id, { immediate });
    return subscription;
  }

  async activateFromProvider(providerSubscriptionId: string, provider: PaymentProviderType) {
    const subscription = dbStore.billingSubscriptions.find((item) => item.provider === provider && item.providerSubscriptionId === providerSubscriptionId);
    if (!subscription) return null;
    return this.activateSubscription(subscription.id);
  }

  activateSubscription(subscriptionId: string) {
    const subscription = dbStore.billingSubscriptions.find((item) => item.id === subscriptionId);
    if (!subscription) return null;

    // Supersede any other live subscription on the same account — not just the
    // same organization — so an account never ends up paying twice.
    dbStore.billingSubscriptions
      .filter((item) =>
        (subscription.accountId
          ? item.accountId === subscription.accountId || item.organizationId === subscription.organizationId
          : item.organizationId === subscription.organizationId) &&
        item.id !== subscription.id &&
        item.rowStatus === 'ACTIVE' &&
        [
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.PAUSED,
          SubscriptionStatus.CANCEL_PENDING,
          SubscriptionStatus.CREATED,
          SubscriptionStatus.AUTHENTICATION_PENDING,
        ].includes(item.status as SubscriptionStatus),
      )
      .forEach((item) => {
        item.status = SubscriptionStatus.EXPIRED;
        item.rowStatus = 'INACTIVE';
        item.modifiedDate = new Date();
      });

    subscription.status = SubscriptionStatus.ACTIVE;
    subscription.rowStatus = 'ACTIVE';
    subscription.currentPeriodStart = subscription.currentPeriodStart || new Date();
    subscription.currentPeriodEnd = subscription.currentPeriodEnd || this.calculatePeriodEnd(subscription.billingInterval as BillingInterval);
    subscription.nextBillingDate = subscription.currentPeriodEnd;
    subscription.modifiedDate = new Date();
    return subscription;
  }

  createPending(input: {
    organizationId: string;
    /** Account the subscription bills. Set so it covers all sibling organizations. */
    accountId?: string;
    planId: string;
    provider: PaymentProviderType;
    providerCustomerId?: string;
    providerSubscriptionId?: string;
    billingInterval: BillingInterval;
    userId: string;
  }) {
    const subscription = {
      id: uuidv4(),
      organizationId: input.organizationId,
      accountId: input.accountId,
      planId: input.planId,
      provider: input.provider,
      providerCustomerId: input.providerCustomerId,
      providerSubscriptionId: input.providerSubscriptionId,
      status: SubscriptionStatus.AUTHENTICATION_PENDING,
      billingInterval: input.billingInterval,
      cancelAtPeriodEnd: false,
      createdBy: input.userId,
      modifiedBy: input.userId,
      rowStatus: 'ACTIVE',
      createdDate: new Date(),
      modifiedDate: new Date(),
    };
    dbStore.billingSubscriptions.push(subscription as any);
    return subscription;
  }

  expireStalePendingCheckouts(organizationId: string) {
    const cutoff = Date.now() - 30 * 60 * 1000;
    dbStore.billingSubscriptions
      .filter((item) =>
        item.organizationId === organizationId &&
        item.rowStatus === 'ACTIVE' &&
        [
          SubscriptionStatus.CREATED,
          SubscriptionStatus.AUTHENTICATION_PENDING,
        ].includes(item.status as SubscriptionStatus) &&
        item.createdDate.getTime() < cutoff,
      )
      .forEach((item) => {
        item.status = SubscriptionStatus.EXPIRED;
        item.rowStatus = 'INACTIVE';
        item.modifiedDate = new Date();
      });
  }

  private expireStaleTrials(organizationId: string) {
    const now = new Date();
    dbStore.billingSubscriptions
      .filter((item) =>
        item.organizationId === organizationId &&
        item.rowStatus === 'ACTIVE' &&
        item.status === SubscriptionStatus.TRIALING,
      )
      .forEach((item) => {
        const trialEnd = item.trialEndsAt || item.trialEnd;
        if (trialEnd && new Date(trialEnd).getTime() <= now.getTime()) {
          item.status = SubscriptionStatus.TRIAL_EXPIRED;
          item.modifiedDate = now;
        }
      });
  }

  private audit(organizationId: string, actorId: string, action: string, resourceId: string, metadata?: any) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: action as AuditAction,
      resourceType: 'billing_subscription',
      resourceId,
      metadata,
      createdAt: new Date(),
    });
  }

  private calculatePeriodEnd(interval: BillingInterval) {
    const end = new Date();
    if (interval === BillingInterval.YEARLY) {
      end.setFullYear(end.getFullYear() + 1);
      return end;
    }
    if (interval === BillingInterval.QUARTERLY) {
      end.setMonth(end.getMonth() + 3);
      return end;
    }
    end.setMonth(end.getMonth() + 1);
    return end;
  }
}
