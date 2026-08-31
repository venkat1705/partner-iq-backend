import { Injectable } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { SubscriptionStatus } from '../../../common/enums';
import { PlanService } from './plan.service';

@Injectable()
export class EntitlementService {
  constructor(private readonly planService: PlanService) {}

  /**
   * Evaluates if a feature is unlocked for an organization considering trial/subscription status.
   */
  async canUse(organizationId: string, featureKey: string): Promise<boolean> {
    const sub = this.getActiveSubscription(organizationId);

    // If subscription is in restricted or expired state
    if (sub && [SubscriptionStatus.RESTRICTED, SubscriptionStatus.TRIAL_EXPIRED, SubscriptionStatus.SUSPENDED].includes(sub.status as SubscriptionStatus)) {
      const allowedInRestricted = ['HISTORICAL_REPORTS', 'EXPORT_DATA', 'BILLING_ACCESS'];
      return allowedInRestricted.includes(featureKey);
    }

    const plan = await this.currentPlan(organizationId);
    const feature = dbStore.billingPlanFeatures.find(
      (item) => item.planId === plan.id && item.featureKey === featureKey,
    );

    // If trialing, grant standard feature access
    if (sub?.status === SubscriptionStatus.TRIALING && !feature) {
      return true;
    }

    return feature ? Boolean(feature.enabled) : true;
  }

  /**
   * Alias for canUse
   */
  async can(organizationId: string, featureKey: string): Promise<boolean> {
    return this.canUse(organizationId, featureKey);
  }

  /**
   * Gets configurable plan/trial limits (e.g. PROGRAMS, AFFILIATES, WEBHOOKS)
   */
  async getLimit(organizationId: string, featureKey: string): Promise<number | null> {
    const sub = this.getActiveSubscription(organizationId);

    // If in trial mode, apply generous default trial limits if not specified
    if (sub?.status === SubscriptionStatus.TRIALING) {
      const trialDefaults: Record<string, number> = {
        PROGRAMS: 5,
        AFFILIATES: 50,
        API_EVENTS: 10000,
        WEBHOOKS: 5,
        ADMIN_USERS: 5,
      };
      if (trialDefaults[featureKey] !== undefined) {
        return trialDefaults[featureKey];
      }
    }

    const plan = await this.currentPlan(organizationId);
    const feature = dbStore.billingPlanFeatures.find(
      (item) => item.planId === plan.id && item.featureKey === featureKey,
    );
    return feature?.limitValue ?? null;
  }

  async currentPlan(organizationId: string) {
    await this.planService.ensureDefaultPlans();
    const active = this.getActiveSubscription(organizationId);

    if (active) {
      const plan = dbStore.billingPlans.find((item) => item.id === active.planId);
      if (plan) return plan;
    }

    return dbStore.billingPlans.find((item) => item.code === 'FREE' && item.billingInterval === 'MONTHLY') ||
      dbStore.billingPlans[0];
  }

  private getActiveSubscription(organizationId: string) {
    return dbStore.billingSubscriptions
      .filter(
        (item) =>
          item.organizationId === organizationId &&
          item.rowStatus === 'ACTIVE' &&
          [
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.GRACE_PERIOD,
            SubscriptionStatus.CANCEL_PENDING,
            SubscriptionStatus.RESTRICTED,
            SubscriptionStatus.TRIAL_EXPIRED,
          ].includes(item.status as SubscriptionStatus),
      )
      .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime())[0];
  }
}

