import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, BillingPlanEntity } from '../../../database/store';
import { AppDataSource } from '../../../database/data-source';
import { BillingPlan } from '../../../database/schema';
import { BillingInterval, PaymentProviderType } from '../enums/billing.enums';
import { CreatePlanDto } from '../dto/billing.dto';

const PLAN_RANK: Record<string, number> = { FREE: 0, STARTER: 1, PRO: 2, BUSINESS: 3, ENTERPRISE: 4 };
const BUILT_IN_PLAN_DEFAULTS = [
  { code: 'FREE', name: 'Free', description: 'Launch with one partner program and basic reporting.', monthlyPrice: 0, yearlyMonthlyPrice: 0, sortOrder: 0 },
  { code: 'STARTER', name: 'Starter', description: 'For early partner teams validating referrals.', monthlyPrice: 472900, yearlyMonthlyPrice: 376400, sortOrder: 1 },
  { code: 'PRO', name: 'Pro', description: 'Advanced partner operations, audit logs, and fraud detection.', monthlyPrice: 1920600, yearlyMonthlyPrice: 1534600, sortOrder: 2 },
  { code: 'BUSINESS', name: 'Business', description: 'Higher limits, deeper automation, and priority workflows.', monthlyPrice: 4816000, yearlyMonthlyPrice: 3841100, sortOrder: 3 },
  { code: 'ENTERPRISE', name: 'Enterprise', description: 'Custom scale, controls, and billing terms.', monthlyPrice: 0, yearlyMonthlyPrice: 0, sortOrder: 4 },
];

@Injectable()
export class PlanService {
  async ensureDefaultPlans() {
    const planRepo = AppDataSource.isInitialized
      ? AppDataSource.getRepository(BillingPlan)
      : null;

    for (const interval of [BillingInterval.MONTHLY, BillingInterval.YEARLY]) {
      for (const item of BUILT_IN_PLAN_DEFAULTS) {
        const price = this.builtInPrice(item.code, interval);
        let plan = dbStore.billingPlans.find(
          (existing) => existing.code === item.code && existing.billingInterval === interval && existing.currency === 'INR',
        );
        if (plan) {
          plan.name = item.name;
          plan.description = item.description;
          plan.price = price;
          plan.billingIntervalCount = interval === BillingInterval.YEARLY ? 12 : 1;
          plan.trialDays = item.code === 'FREE' ? 0 : 14;
          plan.isActive = true;
          plan.isPublic = true;
          plan.sortOrder = item.sortOrder;
          plan.rowStatus = 'ACTIVE';
          plan.modifiedDate = new Date();
        } else {
          plan = {
            id: uuidv4(),
            code: item.code,
            name: item.name,
            description: item.description,
            price,
            currency: 'INR',
            billingInterval: interval,
            billingIntervalCount: interval === BillingInterval.YEARLY ? 12 : 1,
            trialDays: item.code === 'FREE' ? 0 : 14,
            isActive: true,
            isPublic: true,
            sortOrder: item.sortOrder,
            rowStatus: 'ACTIVE',
            createdDate: new Date(),
            modifiedDate: new Date(),
          } as BillingPlanEntity;
          if (planRepo) {
            const existingPlan = await planRepo.findOne({
              where: {
                code: plan.code,
                billingInterval: plan.billingInterval,
                currency: plan.currency,
              } as any,
            });

            if (existingPlan) {
              Object.assign(existingPlan, plan, { id: existingPlan.id });
              plan = await planRepo.save(existingPlan) as BillingPlanEntity;
            } else {
              plan = await planRepo.save(plan as BillingPlan) as BillingPlanEntity;
            }
          }

          if (!dbStore.billingPlans.some((existing) => existing.id === plan.id)) {
            dbStore.billingPlans.push(plan);
          }
        }
        if (item.code !== 'FREE' && item.code !== 'ENTERPRISE') {
          const mapping = dbStore.billingPlanProviderMappings.find(
            (existing) => existing.planId === plan.id && existing.provider === PaymentProviderType.RAZORPAY && existing.currency === plan.currency,
          );
          if (mapping) {
            mapping.providerPlanId = process.env[`RAZORPAY_${item.code}_${interval}_PLAN_ID`] || mapping.providerPlanId;
            mapping.isActive = true;
            mapping.modifiedDate = new Date();
          } else {
            dbStore.billingPlanProviderMappings.push({
              id: uuidv4(),
              planId: plan.id,
              provider: PaymentProviderType.RAZORPAY,
              providerPlanId: process.env[`RAZORPAY_${item.code}_${interval}_PLAN_ID`] || undefined,
              currency: plan.currency,
              isActive: true,
              metadata: { testMode: true },
              createdDate: new Date(),
              modifiedDate: new Date(),
            });
          }
        }
      }
    }

    const featureTemplates: Record<string, Array<[string, boolean, number | undefined]>> = {
      FREE: [['users.max', true, 2], ['programs.max', true, 1], ['advanced_rbac.enabled', false, undefined], ['audit_logs.enabled', false, undefined], ['fraud_detection.enabled', false, undefined]],
      STARTER: [['users.max', true, 5], ['programs.max', true, 3], ['advanced_rbac.enabled', false, undefined], ['audit_logs.enabled', true, undefined], ['fraud_detection.enabled', false, undefined]],
      PRO: [['users.max', true, 15], ['programs.max', true, 10], ['advanced_rbac.enabled', true, undefined], ['audit_logs.enabled', true, undefined], ['fraud_detection.enabled', true, undefined]],
      BUSINESS: [['users.max', true, 50], ['programs.max', true, 50], ['advanced_rbac.enabled', true, undefined], ['audit_logs.enabled', true, undefined], ['fraud_detection.enabled', true, undefined]],
      ENTERPRISE: [['users.max', true, 1000], ['programs.max', true, 1000], ['advanced_rbac.enabled', true, undefined], ['audit_logs.enabled', true, undefined], ['fraud_detection.enabled', true, undefined]],
    };

    for (const plan of dbStore.billingPlans) {
      for (const [featureKey, enabled, limitValue] of featureTemplates[plan.code] || []) {
        const existingFeature = dbStore.billingPlanFeatures.find(
          (feature) => feature.planId === plan.id && feature.featureKey === featureKey,
        );
        if (existingFeature) {
          existingFeature.enabled = enabled;
          existingFeature.limitValue = limitValue;
          existingFeature.modifiedDate = new Date();
        } else {
          dbStore.billingPlanFeatures.push({
            id: uuidv4(),
            planId: plan.id,
            featureKey,
            enabled,
            limitValue,
            createdDate: new Date(),
            modifiedDate: new Date(),
          });
        }
      }
    }
  }

  async listPublicPlans(interval?: BillingInterval) {
    await this.ensureDefaultPlans();
    return dbStore.billingPlans
      .filter((plan) => plan.isActive && plan.isPublic && (!interval || plan.billingInterval === interval))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getActivePlan(planId: string, billingInterval: BillingInterval) {
    await this.ensureDefaultPlans();
    const requestedPlan = dbStore.billingPlans.find(
      (item) => item.id === planId && item.billingInterval === billingInterval && item.isActive && item.rowStatus === 'ACTIVE',
    );
    const plan = requestedPlan
      ? this.canonicalizeBuiltInPlan(requestedPlan, billingInterval)
      : undefined;
    if (!plan) {
      throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'Plan was not found or is inactive.' });
    }
    return plan;
  }

  canonicalizeBuiltInPlan(plan: BillingPlanEntity, interval?: BillingInterval) {
    const billingInterval = (interval || plan.billingInterval) as BillingInterval;
    const defaults = BUILT_IN_PLAN_DEFAULTS.find((item) => item.code === plan.code);
    if (!defaults || plan.currency !== 'INR') return plan;

    return {
      ...plan,
      name: defaults.name,
      description: defaults.description,
      price: this.builtInPrice(defaults.code, billingInterval),
      billingInterval,
      billingIntervalCount: billingInterval === BillingInterval.YEARLY ? 12 : 1,
      trialDays: defaults.code === 'FREE' ? 0 : 14,
      isActive: true,
      isPublic: true,
      sortOrder: defaults.sortOrder,
      rowStatus: 'ACTIVE',
    } as BillingPlanEntity;
  }

  private builtInPrice(code: string, interval: BillingInterval) {
    const defaults = BUILT_IN_PLAN_DEFAULTS.find((item) => item.code === code);
    if (!defaults) return 0;
    return interval === BillingInterval.YEARLY && defaults.yearlyMonthlyPrice > 0
      ? defaults.yearlyMonthlyPrice * 12
      : defaults.monthlyPrice;
  }

  rank(code?: string) {
    return PLAN_RANK[code || 'FREE'] ?? 0;
  }

  async createPlan(dto: CreatePlanDto, actorId: string) {
    const plan: BillingPlanEntity = {
      id: uuidv4(),
      code: dto.code.toUpperCase().trim(),
      name: dto.name,
      description: dto.description,
      price: dto.price,
      currency: dto.currency.toUpperCase(),
      billingInterval: dto.billingInterval,
      billingIntervalCount: dto.billingIntervalCount || 1,
      trialDays: dto.trialDays || 0,
      isActive: true,
      isPublic: dto.isPublic ?? true,
      sortOrder: dbStore.billingPlans.length + 1,
      createdBy: actorId,
      modifiedBy: actorId,
      rowStatus: 'ACTIVE',
      createdDate: new Date(),
      modifiedDate: new Date(),
    };
    dbStore.billingPlans.push(plan);
    if (dto.provider && dto.providerPlanId) {
      dbStore.billingPlanProviderMappings.push({
        id: uuidv4(),
        planId: plan.id,
        provider: dto.provider,
        providerPlanId: dto.providerPlanId,
        currency: plan.currency,
        isActive: true,
        createdDate: new Date(),
        modifiedDate: new Date(),
      });
    }
    return plan;
  }
}
