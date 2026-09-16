import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  dbStore,
  BillingPlanEntity,
  BillingPlanLimitEntity,
} from '../../../database/store';
import { AppDataSource } from '../../../database/data-source';
import { BillingPlan } from '../../../database/schema';
import { BillingInterval, BillingResourceType, PaymentProviderType } from '../enums/billing.enums';
import { CreatePlanDto } from '../dto/billing.dto';
import {
  ALL_RESOURCE_TYPES,
  PLAN_CATALOG,
  PLAN_CATALOG_CURRENCY,
  PLAN_CATALOG_SEED_VERSION,
  PLAN_RANK,
  PlanSeed,
  RETIRED_PLAN_CODES,
  planPriceFor,
} from '../config/plan-catalog';

const PLAN_SEED_SETTING_KEY = 'billing.planCatalog.seedVersion';

export interface PlanWithLimits extends BillingPlanEntity {
  targetAudience?: string;
  highlight?: boolean;
  limits: Array<{
    resourceType: BillingResourceType;
    /** `null` means unlimited. */
    includedLimit: number | null;
    addonPurchasable: boolean;
  }>;
  features: Array<{ featureKey: string; enabled: boolean; limitValue?: number }>;
}

/**
 * Owns the plan catalog in the database.
 *
 * Defaults come from `config/plan-catalog.ts` and are written once. After that
 * the database is authoritative: an admin who edits a price or an allowance
 * keeps that edit across restarts, because seeding only rewrites existing rows
 * when `PLAN_CATALOG_SEED_VERSION` has changed.
 */
@Injectable()
export class PlanService {
  private seedVersionApplied: string | null = null;

  async ensureDefaultPlans() {
    const setting = dbStore.platformSettings.find((item) => item.key === PLAN_SEED_SETTING_KEY);
    const storedVersion = typeof setting?.value === 'string' ? setting.value : null;
    const seedVersionMatches = storedVersion === PLAN_CATALOG_SEED_VERSION;

    if (this.seedVersionApplied === PLAN_CATALOG_SEED_VERSION && seedVersionMatches) {
      // Still cheap enough to keep rows present if something cleared the store.
      if (dbStore.billingPlans.length >= PLAN_CATALOG.length) return;
    }

    const planRepo = AppDataSource.isInitialized ? AppDataSource.getRepository(BillingPlan) : null;

    for (const interval of [BillingInterval.MONTHLY, BillingInterval.YEARLY]) {
      for (const seed of PLAN_CATALOG) {
        const price = planPriceFor(seed, interval);
        let plan = dbStore.billingPlans.find(
          (existing) =>
            existing.code === seed.code &&
            existing.billingInterval === interval &&
            existing.currency === PLAN_CATALOG_CURRENCY,
        );

        if (plan) {
          // Only overwrite admin-editable fields when the catalog version moved.
          if (!seedVersionMatches) {
            plan.name = seed.name;
            plan.description = seed.description;
            plan.price = price;
            plan.billingIntervalCount = interval === BillingInterval.YEARLY ? 12 : 1;
            plan.trialDays = seed.trialDays;
            plan.isActive = true;
            plan.isPublic = seed.isPublic;
            plan.sortOrder = seed.sortOrder;
            plan.rowStatus = 'ACTIVE';
            plan.modifiedDate = new Date();
          }
        } else {
          plan = {
            id: uuidv4(),
            code: seed.code,
            name: seed.name,
            description: seed.description,
            price,
            currency: PLAN_CATALOG_CURRENCY,
            billingInterval: interval,
            billingIntervalCount: interval === BillingInterval.YEARLY ? 12 : 1,
            trialDays: seed.trialDays,
            isActive: true,
            isPublic: seed.isPublic,
            sortOrder: seed.sortOrder,
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
              plan = (await planRepo.save(existingPlan)) as BillingPlanEntity;
            } else {
              plan = (await planRepo.save(plan as BillingPlan)) as BillingPlanEntity;
            }
          }

          if (!dbStore.billingPlans.some((existing) => existing.id === plan!.id)) {
            dbStore.billingPlans.push(plan);
          }
        }

        this.ensurePlanLimits(plan, seed, seedVersionMatches);
        this.ensurePlanFeatures(plan, seed, seedVersionMatches);
        this.ensureProviderMapping(plan, seed, interval);
      }
    }

    // Plans that were removed from the catalog stay in the database so old
    // subscriptions resolve, but disappear from the pricing page.
    for (const plan of dbStore.billingPlans) {
      if (RETIRED_PLAN_CODES.includes(plan.code) && plan.isPublic) {
        plan.isPublic = false;
        plan.modifiedDate = new Date();
      }
    }

    this.recordSeedVersion(setting);
    this.seedVersionApplied = PLAN_CATALOG_SEED_VERSION;
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  async listPublicPlans(interval?: BillingInterval): Promise<PlanWithLimits[]> {
    await this.ensureDefaultPlans();
    return dbStore.billingPlans
      .filter(
        (plan) =>
          plan.isActive &&
          plan.isPublic &&
          plan.rowStatus === 'ACTIVE' &&
          (!interval || plan.billingInterval === interval),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((plan) => this.withLimits(plan));
  }

  /** Every plan including private/retired ones — admin surfaces only. */
  async listAllPlans(): Promise<PlanWithLimits[]> {
    await this.ensureDefaultPlans();
    return dbStore.billingPlans
      .filter((plan) => plan.rowStatus === 'ACTIVE')
      .sort((a, b) => a.sortOrder - b.sortOrder || a.billingInterval.localeCompare(b.billingInterval))
      .map((plan) => this.withLimits(plan));
  }

  async getActivePlan(planId: string, billingInterval: BillingInterval) {
    await this.ensureDefaultPlans();
    const plan = dbStore.billingPlans.find(
      (item) =>
        item.id === planId &&
        item.billingInterval === billingInterval &&
        item.isActive &&
        item.rowStatus === 'ACTIVE',
    );
    if (!plan) {
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: 'Plan was not found or is inactive.',
      });
    }
    return plan;
  }

  /**
   * Retained for callers that predate database-authoritative pricing. The
   * database row is now the source of truth, so this is an identity function
   * kept so admin price edits are never silently overwritten at read time.
   */
  canonicalizeBuiltInPlan(plan: BillingPlanEntity, interval?: BillingInterval): BillingPlanEntity {
    if (!interval || plan.billingInterval === interval) return plan;
    const sibling = dbStore.billingPlans.find(
      (item) =>
        item.code === plan.code &&
        item.billingInterval === interval &&
        item.currency === plan.currency,
    );
    return sibling || plan;
  }

  withLimits(plan: BillingPlanEntity): PlanWithLimits {
    const seed = PLAN_CATALOG.find((item) => item.code === plan.code);
    return {
      ...plan,
      targetAudience: seed?.targetAudience,
      highlight: seed?.highlight,
      limits: ALL_RESOURCE_TYPES.map((resourceType) => {
        const row = dbStore.billingPlanLimits.find(
          (item) => item.planId === plan.id && item.resourceType === resourceType,
        );
        return {
          resourceType,
          includedLimit: row ? (row.includedLimit ?? null) : 0,
          addonPurchasable: row ? Boolean(row.addonPurchasable) : false,
        };
      }),
      features: dbStore.billingPlanFeatures
        .filter((item) => item.planId === plan.id)
        .map((item) => ({
          featureKey: item.featureKey,
          enabled: Boolean(item.enabled),
          limitValue: item.limitValue,
        })),
    };
  }

  rank(code?: string) {
    return PLAN_RANK[code || 'FREE'] ?? 0;
  }

  /** Resolves a plan by code at an interval — used by trials and tests. */
  async findByCode(code: string, interval: BillingInterval = BillingInterval.MONTHLY) {
    await this.ensureDefaultPlans();
    return dbStore.billingPlans.find(
      (item) =>
        item.code === code &&
        item.billingInterval === interval &&
        item.currency === PLAN_CATALOG_CURRENCY,
    );
  }

  // ---------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------

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

    // A new plan starts with no allowance for anything; an admin sets the
    // limits explicitly. Failing closed is safer than defaulting to unlimited.
    for (const resourceType of ALL_RESOURCE_TYPES) {
      dbStore.billingPlanLimits.push({
        id: uuidv4(),
        planId: plan.id,
        resourceType,
        includedLimit: 0,
        addonPurchasable: false,
        createdDate: new Date(),
        modifiedDate: new Date(),
      } as BillingPlanLimitEntity);
    }

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
    return this.withLimits(plan);
  }

  /** Sets one plan's included allowance for one resource. `null` = unlimited. */
  setPlanLimit(
    planId: string,
    resourceType: BillingResourceType,
    includedLimit: number | null,
    addonPurchasable?: boolean,
  ) {
    let row = dbStore.billingPlanLimits.find(
      (item) => item.planId === planId && item.resourceType === resourceType,
    );
    if (!row) {
      row = {
        id: uuidv4(),
        planId,
        resourceType,
        includedLimit,
        addonPurchasable: addonPurchasable ?? includedLimit !== null,
        createdDate: new Date(),
        modifiedDate: new Date(),
      } as BillingPlanLimitEntity;
      dbStore.billingPlanLimits.push(row);
      return row;
    }
    row.includedLimit = includedLimit;
    if (addonPurchasable !== undefined) row.addonPurchasable = addonPurchasable;
    // Unlimited capacity can never need an add-on.
    if (includedLimit === null) row.addonPurchasable = false;
    row.modifiedDate = new Date();
    return row;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private ensurePlanLimits(plan: BillingPlanEntity, seed: PlanSeed, seedVersionMatches: boolean) {
    for (const limitSeed of seed.limits) {
      const existing = dbStore.billingPlanLimits.find(
        (item) => item.planId === plan.id && item.resourceType === limitSeed.resourceType,
      );
      if (existing) {
        if (!seedVersionMatches) {
          existing.includedLimit = limitSeed.includedLimit;
          existing.addonPurchasable = limitSeed.addonPurchasable;
          existing.modifiedDate = new Date();
        }
        continue;
      }
      dbStore.billingPlanLimits.push({
        id: uuidv4(),
        planId: plan.id,
        resourceType: limitSeed.resourceType,
        includedLimit: limitSeed.includedLimit,
        addonPurchasable: limitSeed.addonPurchasable,
        createdDate: new Date(),
        modifiedDate: new Date(),
      } as BillingPlanLimitEntity);
    }
  }

  private ensurePlanFeatures(plan: BillingPlanEntity, seed: PlanSeed, seedVersionMatches: boolean) {
    for (const [featureKey, enabled, limitValue] of seed.features) {
      const existing = dbStore.billingPlanFeatures.find(
        (item) => item.planId === plan.id && item.featureKey === featureKey,
      );
      if (existing) {
        if (!seedVersionMatches) {
          existing.enabled = enabled;
          existing.limitValue = limitValue;
          existing.modifiedDate = new Date();
        }
        continue;
      }
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

  private ensureProviderMapping(plan: BillingPlanEntity, seed: PlanSeed, interval: BillingInterval) {
    if (seed.monthlyPrice === 0 && seed.yearlyPrice === 0) return;

    const envPlanId = process.env[`RAZORPAY_${seed.code}_${interval}_PLAN_ID`];
    const mapping = dbStore.billingPlanProviderMappings.find(
      (item) =>
        item.planId === plan.id &&
        item.provider === PaymentProviderType.RAZORPAY &&
        item.currency === plan.currency,
    );

    if (mapping) {
      if (envPlanId) mapping.providerPlanId = envPlanId;
      mapping.isActive = true;
      mapping.modifiedDate = new Date();
      return;
    }

    dbStore.billingPlanProviderMappings.push({
      id: uuidv4(),
      planId: plan.id,
      provider: PaymentProviderType.RAZORPAY,
      providerPlanId: envPlanId || undefined,
      currency: plan.currency,
      isActive: true,
      metadata: { seededFrom: PLAN_CATALOG_SEED_VERSION },
      createdDate: new Date(),
      modifiedDate: new Date(),
    });
  }

  private recordSeedVersion(existing?: { value: any; updatedAt?: Date }) {
    if (existing) {
      if (existing.value !== PLAN_CATALOG_SEED_VERSION) {
        existing.value = PLAN_CATALOG_SEED_VERSION;
        existing.updatedAt = new Date();
      }
      return;
    }
    dbStore.platformSettings.push({
      id: uuidv4(),
      key: PLAN_SEED_SETTING_KEY,
      value: PLAN_CATALOG_SEED_VERSION,
      description: 'Seed version of the PartnerIQ plan catalog',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  }
}
