import { Injectable } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { SubscriptionStatus } from '../enums/billing.enums';
import { PlanService } from './plan.service';

@Injectable()
export class EntitlementService {
  constructor(private readonly planService: PlanService) {}

  async canUse(organizationId: string, featureKey: string) {
    const plan = await this.currentPlan(organizationId);
    const feature = dbStore.billingPlanFeatures.find((item) => item.planId === plan.id && item.featureKey === featureKey);
    return Boolean(feature?.enabled);
  }

  async getLimit(organizationId: string, featureKey: string) {
    const plan = await this.currentPlan(organizationId);
    const feature = dbStore.billingPlanFeatures.find((item) => item.planId === plan.id && item.featureKey === featureKey);
    return feature?.limitValue ?? null;
  }

  async currentPlan(organizationId: string) {
    await this.planService.ensureDefaultPlans();
    const active = dbStore.billingSubscriptions
      .filter((item) => item.organizationId === organizationId && [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCEL_PENDING].includes(item.status as SubscriptionStatus))
      .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime())[0];
    if (active) {
      const plan = dbStore.billingPlans.find((item) => item.id === active.planId);
      if (plan) return plan;
    }
    return dbStore.billingPlans.find((item) => item.code === 'FREE' && item.billingInterval === 'MONTHLY')!;
  }
}
