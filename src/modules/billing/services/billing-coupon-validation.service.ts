import { Injectable } from '@nestjs/common';
import { dbStore, BillingPlanEntity } from '../../../database/store';
import {
  BillingCouponCycleEligibility,
  BillingCouponCustomerEligibility,
  BillingCouponDiscountType,
  BillingCouponPlanEligibility,
  BillingCouponRedemptionStatus,
  BillingCouponStatus,
  BillingInterval,
  SubscriptionStatus,
} from '../enums/billing.enums';

export interface BillingCouponValidationInput {
  organizationId: string;
  plan: BillingPlanEntity;
  billingInterval: BillingInterval;
  currency: string;
  subtotalMinor: number;
  couponCode: string;
}

@Injectable()
export class BillingCouponValidationService {
  normalizeCode(code: string) {
    return code.trim().toUpperCase().replace(/\s+/g, '');
  }

  async validate(input: BillingCouponValidationInput) {
    const normalizedCode = this.normalizeCode(input.couponCode);
    const coupon = dbStore.billingCoupons.find((item) => item.normalizedCode === normalizedCode);
    if (!coupon) return this.invalid('COUPON_NOT_FOUND', 'Enter a valid coupon code.');

    const now = Date.now();
    if (coupon.status !== BillingCouponStatus.ACTIVE) {
      return this.invalid('COUPON_NOT_ACTIVE', 'This coupon is not active.');
    }
    if (coupon.validFrom && new Date(coupon.validFrom).getTime() > now) {
      return this.invalid('COUPON_NOT_STARTED', 'This coupon is not available yet.');
    }
    if (coupon.validUntil && new Date(coupon.validUntil).getTime() < now) {
      return this.invalid('COUPON_EXPIRED', 'This coupon has expired.');
    }
    if (coupon.currency && coupon.currency !== input.currency) {
      return this.invalid('COUPON_CURRENCY_NOT_SUPPORTED', 'This coupon is not available for the selected currency.');
    }
    if (coupon.minimumPurchaseAmount && input.subtotalMinor < coupon.minimumPurchaseAmount) {
      return this.invalid('COUPON_MINIMUM_AMOUNT_NOT_MET', 'The selected plan does not meet this coupon minimum.');
    }
    if (!this.isPlanEligible(coupon, input.plan.id)) {
      return this.invalid('COUPON_PLAN_NOT_ELIGIBLE', 'This coupon is not available for the selected plan.');
    }
    if (!this.isBillingCycleEligible(coupon.billingCycleEligibility, input.billingInterval)) {
      return this.invalid('COUPON_BILLING_CYCLE_NOT_ELIGIBLE', 'This coupon is available only for eligible billing cycles.');
    }
    const customerEligibilityError = this.customerEligibilityError(coupon, input.organizationId);
    if (customerEligibilityError) return customerEligibilityError;

    const activeStatuses = [
      BillingCouponRedemptionStatus.RESERVED,
      BillingCouponRedemptionStatus.APPLIED,
      BillingCouponRedemptionStatus.CONSUMED,
    ];
    const redemptions = dbStore.billingCouponRedemptions.filter(
      (item) => item.couponId === coupon.id && activeStatuses.includes(item.status as BillingCouponRedemptionStatus),
    );
    if (coupon.maxRedemptions && redemptions.length >= coupon.maxRedemptions) {
      return this.invalid('COUPON_GLOBAL_LIMIT_REACHED', 'This coupon has reached its redemption limit.');
    }
    const orgRedemptions = redemptions.filter((item) => item.organizationId === input.organizationId);
    if (coupon.maxRedemptionsPerOrganization && orgRedemptions.length >= coupon.maxRedemptionsPerOrganization) {
      return this.invalid('COUPON_ORGANIZATION_LIMIT_REACHED', 'This coupon has already been used for this organization.');
    }
    if (!coupon.isStackable && dbStore.billingCouponRedemptions.some((item) =>
      item.organizationId === input.organizationId &&
      activeStatuses.includes(item.status as BillingCouponRedemptionStatus) &&
      item.couponId !== coupon.id
    )) {
      return this.invalid('COUPON_NOT_STACKABLE', 'Only one billing coupon can be used at checkout.');
    }
    const discountConfigError = this.discountConfigError(coupon);
    if (discountConfigError) return discountConfigError;

    return { valid: true, coupon };
  }

  private isPlanEligible(coupon: any, planId: string) {
    if (coupon.planEligibility !== BillingCouponPlanEligibility.SPECIFIC_PLANS) return true;
    return dbStore.billingCouponPlans.some((item) => item.couponId === coupon.id && item.planId === planId);
  }

  private isBillingCycleEligible(eligibility: string, interval: BillingInterval) {
    if (!eligibility || eligibility === BillingCouponCycleEligibility.ALL) return true;
    return eligibility === interval;
  }

  private customerEligibilityError(coupon: any, organizationId: string) {
    const hadPaidSubscription = dbStore.billingSubscriptions.some((item) =>
      item.organizationId === organizationId &&
      [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED, SubscriptionStatus.COMPLETED].includes(item.status as SubscriptionStatus),
    );
    if ((coupon.firstTimeCustomersOnly || coupon.customerEligibility === BillingCouponCustomerEligibility.NEW_CUSTOMERS_ONLY) && hadPaidSubscription) {
      return this.invalid('COUPON_NEW_CUSTOMERS_ONLY', 'This coupon is only available for new customers.');
    }
    if (coupon.customerEligibility === BillingCouponCustomerEligibility.EXISTING_CUSTOMERS_ONLY && !hadPaidSubscription) {
      return this.invalid('COUPON_ORGANIZATION_NOT_ELIGIBLE', 'This coupon is only available for existing customers.');
    }
    if (coupon.customerEligibility === BillingCouponCustomerEligibility.SPECIFIC_ORGANIZATIONS) {
      const allowed = dbStore.billingCouponOrganizations.some(
        (item) => item.couponId === coupon.id && item.organizationId === organizationId,
      );
      if (!allowed) return this.invalid('COUPON_ORGANIZATION_NOT_ELIGIBLE', 'This coupon is not available for this organization.');
    }
    return null;
  }

  private discountConfigError(coupon: any) {
    if (coupon.discountType === BillingCouponDiscountType.PERCENTAGE && (!coupon.discountValue || coupon.discountValue <= 0 || coupon.discountValue > 100)) {
      return this.invalid('COUPON_INVALID_DISCOUNT', 'This coupon is not configured correctly.');
    }
    if (coupon.discountType === BillingCouponDiscountType.FIXED_AMOUNT && (!coupon.discountValue || coupon.discountValue <= 0)) {
      return this.invalid('COUPON_INVALID_DISCOUNT', 'This coupon is not configured correctly.');
    }
    if (coupon.discountType === BillingCouponDiscountType.TRIAL_EXTENSION && (!coupon.trialExtensionDays || coupon.trialExtensionDays <= 0)) {
      return this.invalid('COUPON_INVALID_DISCOUNT', 'This coupon is not configured correctly.');
    }
    if (coupon.discountType === BillingCouponDiscountType.FREE_MONTHS && (!coupon.freeMonths || coupon.freeMonths <= 0)) {
      return this.invalid('COUPON_INVALID_DISCOUNT', 'This coupon is not configured correctly.');
    }
    return null;
  }

  private invalid(code: string, message: string) {
    return { valid: false, code, message };
  }
}
