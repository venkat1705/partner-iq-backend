import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { AuditAction } from '../../../common/enums';
import { BillingInterval, BillingResourceType } from '../enums/billing.enums';
import {
  UpdateAddonConfigDto,
  UpdateBillingTaxDto,
  UpdatePlanConfigDto,
} from '../dto/addon.dto';
import { PlanService } from './plan.service';
import { AddonService } from './addon.service';
import { BillingTaxService } from './billing-tax.service';

/**
 * Platform-admin configuration for plans, allowances, add-ons and tax.
 *
 * Every value the billing system uses at runtime lives in the database, so an
 * admin can reprice a plan or change an included allowance here without a code
 * change. Edits are audited and are not overwritten by the seed catalog on the
 * next restart.
 */
@Injectable()
export class AdminBillingConfigService {
  constructor(
    private readonly plans: PlanService,
    private readonly addons: AddonService,
    private readonly tax: BillingTaxService,
  ) {}

  async getConfiguration() {
    const plans = await this.plans.listAllPlans();
    const addons = await this.addons.listAddons();
    return {
      plans,
      addons,
      tax: this.tax.getConfig(),
      resourceTypes: Object.values(BillingResourceType),
      billingIntervals: [BillingInterval.MONTHLY, BillingInterval.YEARLY],
    };
  }

  async updatePlan(planId: string, dto: UpdatePlanConfigDto, actorId: string) {
    await this.plans.ensureDefaultPlans();
    const plan = dbStore.billingPlans.find((item) => item.id === planId);
    if (!plan) {
      throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'Plan was not found.' });
    }

    const before = {
      price: plan.price,
      isActive: plan.isActive,
      isPublic: plan.isPublic,
    };

    if (dto.name !== undefined) plan.name = dto.name;
    if (dto.description !== undefined) plan.description = dto.description;
    if (dto.price !== undefined) plan.price = dto.price;
    if (dto.trialDays !== undefined) plan.trialDays = dto.trialDays;
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;
    if (dto.isPublic !== undefined) plan.isPublic = dto.isPublic;
    plan.modifiedBy = actorId;
    plan.modifiedDate = new Date();

    for (const limit of dto.limits || []) {
      // `includedLimit` omitted or explicitly null means unlimited.
      const includedLimit = limit.includedLimit === undefined ? null : limit.includedLimit;
      this.plans.setPlanLimit(
        plan.id,
        limit.resourceType,
        includedLimit,
        limit.addonPurchasable,
      );
    }

    for (const [featureKey, enabled] of Object.entries(dto.features || {})) {
      const feature = dbStore.billingPlanFeatures.find(
        (item) => item.planId === plan.id && item.featureKey === featureKey,
      );
      if (feature) {
        feature.enabled = Boolean(enabled);
        feature.modifiedDate = new Date();
      } else {
        dbStore.billingPlanFeatures.push({
          id: uuidv4(),
          planId: plan.id,
          featureKey,
          enabled: Boolean(enabled),
          createdDate: new Date(),
          modifiedDate: new Date(),
        });
      }
    }

    this.audit(actorId, 'BILLING_PLAN_UPDATED', plan.id, {
      planCode: plan.code,
      billingInterval: plan.billingInterval,
      before,
      after: { price: plan.price, isActive: plan.isActive, isPublic: plan.isPublic },
      limits: dto.limits,
    });

    return this.plans.withLimits(plan);
  }

  async updateAddon(addonId: string, dto: UpdateAddonConfigDto, actorId: string) {
    const addon = await this.addons.getAddon(addonId);
    const before = { unitPrice: addon.unitPrice, isActive: addon.isActive };

    if (dto.name !== undefined) addon.name = dto.name;
    if (dto.description !== undefined) addon.description = dto.description;
    if (dto.unitPrice !== undefined) addon.unitPrice = dto.unitPrice;
    if (dto.unitsPerQuantity !== undefined) addon.unitsPerQuantity = dto.unitsPerQuantity;
    if (dto.minQuantity !== undefined) addon.minQuantity = dto.minQuantity;
    if (dto.maxQuantity !== undefined) addon.maxQuantity = dto.maxQuantity;
    if (dto.isActive !== undefined) addon.isActive = dto.isActive;

    if (addon.maxQuantity !== null && addon.maxQuantity !== undefined && addon.maxQuantity < addon.minQuantity) {
      throw new BadRequestException({
        code: 'INVALID_ADDON_RANGE',
        message: 'Maximum quantity cannot be lower than the minimum.',
      });
    }

    addon.modifiedBy = actorId;
    addon.modifiedDate = new Date();

    this.audit(actorId, 'BILLING_ADDON_UPDATED', addon.id, {
      addonCode: addon.code,
      billingInterval: addon.billingInterval,
      before,
      after: { unitPrice: addon.unitPrice, isActive: addon.isActive },
    });

    return addon;
  }

  updateTax(dto: UpdateBillingTaxDto, actorId: string) {
    const config = this.tax.setConfig(dto, actorId);
    this.audit(actorId, 'BILLING_TAX_UPDATED', 'platform', config);
    return config;
  }

  private audit(actorId: string, action: string, resourceId: string, metadata?: any) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      actorType: 'USER',
      actorId,
      action: action as AuditAction,
      resourceType: 'billing_configuration',
      resourceId,
      metadata,
      createdAt: new Date(),
    } as any);
  }
}
