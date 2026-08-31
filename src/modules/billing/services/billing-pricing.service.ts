import { BadRequestException, Injectable } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import {
  BillingCouponDiscountType,
  BillingCouponDurationType,
  BillingInterval,
} from '../enums/billing.enums';
import { PlanService } from './plan.service';
import { BillingCouponValidationService } from './billing-coupon-validation.service';

export interface BillingPriceQuoteInput {
  organizationId: string;
  planId: string;
  billingInterval: BillingInterval;
  couponCode?: string;
  currency?: string;
}

@Injectable()
export class BillingPricingService {
  constructor(
    private readonly plans: PlanService,
    private readonly couponValidation: BillingCouponValidationService,
  ) {}

  async quote(input: BillingPriceQuoteInput) {
    const plan = await this.plans.getActivePlan(input.planId, input.billingInterval);
    const currency = (input.currency || plan.currency).toUpperCase();
    if (currency !== plan.currency) {
      throw new BadRequestException({
        code: 'PLAN_CURRENCY_MISMATCH',
        message: 'The selected plan is not available in that currency.',
      });
    }

    const subtotalMinor = plan.price;
    let discountMinor = 0;
    let coupon: any = null;
    let trialExtensionDays = 0;
    let freeMonths = 0;

    if (input.couponCode?.trim()) {
      const validation: any = await this.couponValidation.validate({
        organizationId: input.organizationId,
        plan,
        billingInterval: input.billingInterval,
        currency,
        subtotalMinor,
        couponCode: input.couponCode,
      });
      if (!validation.valid) {
        return {
          valid: false,
          code: validation.code,
          message: validation.message,
          plan,
          billingInterval: input.billingInterval,
          currency,
          subtotalMinor,
          discountMinor: 0,
          discountedSubtotalMinor: subtotalMinor,
          taxMinor: 0,
          totalMinor: subtotalMinor,
        };
      }

      coupon = validation.coupon;
      if (coupon.discountType === BillingCouponDiscountType.PERCENTAGE) {
        discountMinor = Math.floor((subtotalMinor * (coupon.discountValue || 0)) / 100);
      } else if (coupon.discountType === BillingCouponDiscountType.FIXED_AMOUNT) {
        discountMinor = Math.min(subtotalMinor, coupon.discountValue || 0);
      } else if (coupon.discountType === BillingCouponDiscountType.TRIAL_EXTENSION) {
        trialExtensionDays = coupon.trialExtensionDays || 0;
      } else if (coupon.discountType === BillingCouponDiscountType.FREE_MONTHS) {
        freeMonths = coupon.freeMonths || 0;
      }
    }

    const discountedSubtotalMinor = Math.max(0, subtotalMinor - discountMinor);
    const taxMinor = 0;
    const totalMinor = discountedSubtotalMinor + taxMinor;

    return {
      valid: true,
      plan,
      billingInterval: input.billingInterval,
      currency,
      subtotalMinor,
      coupon: coupon
        ? {
            id: coupon.id,
            code: coupon.code,
            name: coupon.name,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            durationType: coupon.durationType,
            durationCycles: coupon.durationCycles,
            trialExtensionDays,
            freeMonths,
            rowVersion: coupon.rowVersion,
          }
        : null,
      discountMinor,
      discountedSubtotalMinor,
      taxMinor,
      totalMinor,
      pricingVersion: 'billing-coupons-v1',
      message: coupon ? this.appliedMessage(coupon) : 'Price calculated.',
    };
  }

  private appliedMessage(coupon: any) {
    if (coupon.discountType === BillingCouponDiscountType.PERCENTAGE) {
      return `${coupon.discountValue}% discount applied.`;
    }
    if (coupon.discountType === BillingCouponDiscountType.FIXED_AMOUNT) {
      return 'Discount applied.';
    }
    if (coupon.discountType === BillingCouponDiscountType.TRIAL_EXTENSION) {
      return `${coupon.trialExtensionDays} trial days added.`;
    }
    if (coupon.discountType === BillingCouponDiscountType.FREE_MONTHS) {
      return `${coupon.freeMonths} free month${coupon.freeMonths === 1 ? '' : 's'} applied after trial.`;
    }
    return 'Coupon applied.';
  }

  remainingCycles(durationType: string, durationCycles?: number) {
    if (durationType === BillingCouponDurationType.FIRST_N_BILLING_CYCLES) return durationCycles || 1;
    if (durationType === BillingCouponDurationType.ONE_TIME) return 1;
    return undefined;
  }
}
