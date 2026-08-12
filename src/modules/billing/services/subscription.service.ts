import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { AuditAction } from '../../../common/enums';
import { BillingInterval, PaymentProviderType, SubscriptionStatus } from '../enums/billing.enums';
import { PlanService } from './plan.service';
import { PaymentProviderFactory } from '../providers/payment-provider.factory';

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly plans: PlanService,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  async current(organizationId: string) {
    await this.plans.ensureDefaultPlans();
    this.expireStalePendingCheckouts(organizationId);
    const subscription = dbStore.billingSubscriptions
      .filter((item) =>
        item.organizationId === organizationId &&
        item.rowStatus === 'ACTIVE' &&
        [
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.CANCEL_PENDING,
          SubscriptionStatus.PAUSED,
        ].includes(item.status as SubscriptionStatus),
      )
      .sort((a, b) => {
        const planA = dbStore.billingPlans.find((plan) => plan.id === a.planId);
        const planB = dbStore.billingPlans.find((plan) => plan.id === b.planId);
        const rankDiff = this.plans.rank(planB?.code) - this.plans.rank(planA?.code);
        if (rankDiff !== 0) return rankDiff;
        return b.modifiedDate.getTime() - a.modifiedDate.getTime();
      })[0];
    const plan = subscription
      ? dbStore.billingPlans.find((item) => item.id === subscription.planId)
      : dbStore.billingPlans.find((item) => item.code === 'FREE' && item.billingInterval === 'MONTHLY');
    return {
      subscription: subscription || null,
      plan: plan ? this.plans.canonicalizeBuiltInPlan(plan, (subscription?.billingInterval || plan.billingInterval) as BillingInterval) : plan,
    };
  }

  async upgrade(organizationId: string, userId: string, planId: string, billingInterval: BillingInterval) {
    const plan = await this.plans.getActivePlan(planId, billingInterval);
    const { subscription, plan: currentPlan } = await this.current(organizationId);
    if (currentPlan && this.plans.rank(plan.code) <= this.plans.rank(currentPlan.code)) {
      throw new BadRequestException({ code: 'PLAN_NOT_HIGHER', message: 'Select a higher plan to upgrade.' });
    }
    if (!subscription) {
      throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'No active subscription exists.' });
    }
    subscription.planId = plan.id;
    subscription.status = SubscriptionStatus.ACTIVE;
    subscription.modifiedBy = userId;
    subscription.modifiedDate = new Date();
    this.audit(organizationId, userId, 'SUBSCRIPTION_UPGRADED', subscription.id, { toPlan: plan.code });
    return { subscription, plan };
  }

  async downgrade(organizationId: string, userId: string, planId: string, billingInterval: BillingInterval) {
    const plan = await this.plans.getActivePlan(planId, billingInterval);
    const { subscription, plan: currentPlan } = await this.current(organizationId);
    if (currentPlan && this.plans.rank(plan.code) >= this.plans.rank(currentPlan.code)) {
      throw new BadRequestException({ code: 'PLAN_NOT_LOWER', message: 'Select a lower plan to downgrade.' });
    }
    if (!subscription) {
      throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'No active subscription exists.' });
    }
    subscription.pendingPlanId = plan.id;
    subscription.scheduledChangeDate = subscription.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 3600 * 1000);
    subscription.modifiedBy = userId;
    subscription.modifiedDate = new Date();
    this.audit(organizationId, userId, 'SUBSCRIPTION_DOWNGRADED', subscription.id, {
      pendingPlan: plan.code,
      scheduledChangeDate: subscription.scheduledChangeDate,
    });
    return { subscription, pendingPlan: plan };
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

    dbStore.billingSubscriptions
      .filter((item) =>
        item.organizationId === subscription.organizationId &&
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
