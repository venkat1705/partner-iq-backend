import crypto from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, BillingCouponEntity } from '../../../database/store';
import { AuditAction } from '../../../common/enums';
import {
  BillingCouponCustomerEligibility,
  BillingCouponDiscountType,
  BillingCouponDurationType,
  BillingCouponPlanEligibility,
  BillingCouponRedemptionStatus,
  BillingCouponStatus,
  BillingInterval,
} from '../enums/billing.enums';
import { CreateBillingCouponDto, UpdateBillingCouponDto } from '../dto/billing.dto';
import { BillingCouponValidationService } from './billing-coupon-validation.service';
import { BillingPricingService } from './billing-pricing.service';

const DEFAULT_RESERVATION_MINUTES = 20;
const reservationLocks = new Set<string>();

@Injectable()
export class BillingCouponService {
  constructor(
    private readonly validation: BillingCouponValidationService,
    private readonly pricing: BillingPricingService,
  ) {}

  list(filters: { status?: string; search?: string } = {}) {
    const search = filters.search?.trim().toUpperCase();
    return dbStore.billingCoupons
      .filter((coupon) => !filters.status || coupon.status === filters.status)
      .filter((coupon) => !search || coupon.normalizedCode.includes(search) || coupon.name.toUpperCase().includes(search))
      .map((coupon) => this.withUsage(coupon))
      .sort((a, b) => b.modifiedDate.getTime() - a.modifiedDate.getTime());
  }

  get(id: string) {
    const coupon = dbStore.billingCoupons.find((item) => item.id === id);
    if (!coupon) throw new NotFoundException({ code: 'COUPON_NOT_FOUND', message: 'Coupon not found.' });
    return this.withUsage(coupon);
  }

  create(dto: CreateBillingCouponDto, actorId: string) {
    this.assertCouponConfig(dto);
    const normalizedCode = this.validation.normalizeCode(dto.code);
    if (dbStore.billingCoupons.some((coupon) => coupon.normalizedCode === normalizedCode)) {
      throw new BadRequestException({ code: 'COUPON_CODE_EXISTS', message: 'A billing coupon already uses that code.' });
    }
    const now = new Date();
    const coupon: BillingCouponEntity = {
      id: uuidv4(),
      code: normalizedCode,
      normalizedCode,
      name: dto.name.trim(),
      description: dto.description,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      currency: dto.currency?.toUpperCase(),
      durationType: dto.durationType,
      durationCycles: dto.durationCycles,
      trialExtensionDays: dto.trialExtensionDays,
      freeMonths: dto.freeMonths,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
      validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      maxRedemptions: dto.maxRedemptions,
      maxRedemptionsPerOrganization: dto.maxRedemptionsPerOrganization,
      minimumPurchaseAmount: dto.minimumPurchaseAmount,
      status: BillingCouponStatus.DRAFT,
      isPublic: dto.isPublic ?? false,
      isStackable: dto.isStackable ?? false,
      firstTimeCustomersOnly: dto.firstTimeCustomersOnly ?? false,
      planEligibility: dto.planEligibility || BillingCouponPlanEligibility.ALL_PLANS,
      billingCycleEligibility: dto.billingCycleEligibility || 'ALL',
      customerEligibility: dto.customerEligibility || BillingCouponCustomerEligibility.ANY_ORGANIZATION,
      promotionId: dto.promotionId,
      planChangePolicy: 'PRESERVE_IF_ELIGIBLE',
      createdBy: actorId,
      modifiedBy: actorId,
      createdDate: now,
      modifiedDate: now,
      rowVersion: 1,
    } as BillingCouponEntity;
    dbStore.billingCoupons.push(coupon);
    this.replaceMappings(coupon.id, dto.planIds, dto.organizationIds);
    this.audit('COUPON_CREATED', coupon.id, actorId, { coupon: this.snapshot(coupon) });
    return this.get(coupon.id);
  }

  update(id: string, dto: UpdateBillingCouponDto, actorId: string) {
    const coupon = dbStore.billingCoupons.find((item) => item.id === id);
    if (!coupon) throw new NotFoundException({ code: 'COUPON_NOT_FOUND', message: 'Coupon not found.' });
    const before = this.snapshot(coupon);
    if (dto.code) {
      const normalizedCode = this.validation.normalizeCode(dto.code);
      if (dbStore.billingCoupons.some((item) => item.id !== id && item.normalizedCode === normalizedCode)) {
        throw new BadRequestException({ code: 'COUPON_CODE_EXISTS', message: 'A billing coupon already uses that code.' });
      }
      coupon.code = normalizedCode;
      coupon.normalizedCode = normalizedCode;
    }
    Object.assign(coupon, {
      name: dto.name?.trim() || coupon.name,
      description: dto.description ?? coupon.description,
      discountType: dto.discountType || coupon.discountType,
      discountValue: dto.discountValue ?? coupon.discountValue,
      currency: dto.currency?.toUpperCase() ?? coupon.currency,
      durationType: dto.durationType || coupon.durationType,
      durationCycles: dto.durationCycles ?? coupon.durationCycles,
      trialExtensionDays: dto.trialExtensionDays ?? coupon.trialExtensionDays,
      freeMonths: dto.freeMonths ?? coupon.freeMonths,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : coupon.validFrom,
      validUntil: dto.validUntil ? new Date(dto.validUntil) : coupon.validUntil,
      maxRedemptions: dto.maxRedemptions ?? coupon.maxRedemptions,
      maxRedemptionsPerOrganization: dto.maxRedemptionsPerOrganization ?? coupon.maxRedemptionsPerOrganization,
      minimumPurchaseAmount: dto.minimumPurchaseAmount ?? coupon.minimumPurchaseAmount,
      status: dto.status || coupon.status,
      isPublic: dto.isPublic ?? coupon.isPublic,
      isStackable: dto.isStackable ?? coupon.isStackable,
      firstTimeCustomersOnly: dto.firstTimeCustomersOnly ?? coupon.firstTimeCustomersOnly,
      planEligibility: dto.planEligibility || coupon.planEligibility,
      billingCycleEligibility: dto.billingCycleEligibility || coupon.billingCycleEligibility,
      customerEligibility: dto.customerEligibility || coupon.customerEligibility,
      promotionId: dto.promotionId ?? coupon.promotionId,
      modifiedBy: actorId,
      modifiedDate: new Date(),
      rowVersion: (coupon.rowVersion || 1) + 1,
    });
    this.assertCouponConfig(coupon as any);
    if (dto.planIds || dto.organizationIds) {
      this.replaceMappings(coupon.id, dto.planIds, dto.organizationIds);
    }
    this.audit('COUPON_UPDATED', coupon.id, actorId, { before, after: this.snapshot(coupon) });
    return this.get(coupon.id);
  }

  changeStatus(id: string, status: BillingCouponStatus, actorId: string) {
    const coupon = dbStore.billingCoupons.find((item) => item.id === id);
    if (!coupon) throw new NotFoundException({ code: 'COUPON_NOT_FOUND', message: 'Coupon not found.' });
    if (status === BillingCouponStatus.ACTIVE) this.assertCouponConfig(coupon as any);
    const before = coupon.status;
    coupon.status = status;
    coupon.modifiedBy = actorId;
    coupon.modifiedDate = new Date();
    coupon.rowVersion = (coupon.rowVersion || 1) + 1;
    this.audit(`COUPON_${status}`, coupon.id, actorId, { before, after: status });
    return this.get(coupon.id);
  }

  duplicate(id: string, actorId: string) {
    const source = this.get(id);
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    return this.create({
      ...source,
      code: `${source.code}-${suffix}`,
      name: `${source.name} Copy`,
      planIds: dbStore.billingCouponPlans.filter((item) => item.couponId === id).map((item) => item.planId),
      organizationIds: dbStore.billingCouponOrganizations.filter((item) => item.couponId === id).map((item) => item.organizationId),
      status: undefined,
    } as any, actorId);
  }

  async reserve(input: {
    organizationId: string;
    userId: string;
    planId: string;
    billingInterval: BillingInterval;
    couponCode?: string;
    idempotencyKey: string;
    provider?: string;
    providerSubscriptionId?: string;
  }) {
    if (!input.couponCode?.trim()) return null;
    const existing = dbStore.billingCouponRedemptions.find(
      (item) => item.organizationId === input.organizationId && item.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return existing;

    const normalizedCode = this.validation.normalizeCode(input.couponCode);
    while (reservationLocks.has(normalizedCode)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    reservationLocks.add(normalizedCode);
    try {
      this.releaseExpiredReservations();
      const quote = await this.pricing.quote(input);
      if (!quote.valid || !quote.coupon) {
        throw new BadRequestException({ code: quote.code, message: quote.message });
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.reservationTtlMs());
      const redemption = {
        id: uuidv4(),
        couponId: quote.coupon.id,
        organizationId: input.organizationId,
        planId: quote.plan.id,
        billingCycle: quote.billingInterval,
        currency: quote.currency,
        originalSubtotal: quote.subtotalMinor,
        discountAmount: quote.discountMinor,
        discountedSubtotal: quote.discountedSubtotalMinor,
        taxAmount: quote.taxMinor,
        finalAmount: quote.totalMinor,
        durationType: quote.coupon.durationType,
        remainingCycles: this.pricing.remainingCycles(quote.coupon.durationType, quote.coupon.durationCycles),
        status: BillingCouponRedemptionStatus.RESERVED,
        provider: input.provider,
        providerSubscriptionId: input.providerSubscriptionId,
        idempotencyKey: input.idempotencyKey,
        pricingSnapshot: this.pricingSnapshot(quote),
        reservedAt: now,
        expiresAt,
        createdDate: now,
      };
      dbStore.billingCouponRedemptions.push(redemption as any);
      this.audit('COUPON_REDEMPTION_RESERVED', redemption.id, input.userId, redemption.pricingSnapshot, input.organizationId);
      return redemption;
    } finally {
      reservationLocks.delete(normalizedCode);
    }
  }

  consumeForSubscription(subscriptionId: string, providerPaymentId?: string) {
    const redemption = dbStore.billingCouponRedemptions
      .filter((item) => item.subscriptionId === subscriptionId || (!item.subscriptionId && item.providerPaymentId === providerPaymentId))
      .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime())[0];
    if (!redemption || redemption.status === BillingCouponRedemptionStatus.CONSUMED) return redemption || null;
    redemption.status = BillingCouponRedemptionStatus.CONSUMED;
    redemption.redeemedAt = new Date();
    redemption.providerPaymentId = providerPaymentId || redemption.providerPaymentId;
    const snapshot = redemption.pricingSnapshot || {};
    if (!dbStore.billingSubscriptionDiscounts.some((item) => item.subscriptionId === subscriptionId && item.couponRedemptionId === redemption.id)) {
      dbStore.billingSubscriptionDiscounts.push({
        id: uuidv4(),
        subscriptionId,
        couponRedemptionId: redemption.id,
        discountType: snapshot.coupon?.discountType,
        discountValue: snapshot.coupon?.discountValue,
        startsAt: new Date(),
        totalCycles: snapshot.coupon?.durationType === BillingCouponDurationType.FIRST_N_BILLING_CYCLES
          ? snapshot.coupon?.durationCycles
          : snapshot.coupon?.durationType === BillingCouponDurationType.ONE_TIME ? 1 : undefined,
        cyclesConsumed: 0,
        status: 'ACTIVE',
        snapshot,
        createdDate: new Date(),
        modifiedDate: new Date(),
      } as any);
    }
    this.audit('COUPON_REDEEMED', redemption.id, undefined, snapshot, redemption.organizationId);
    return redemption;
  }

  attachReservation(redemptionId: string | undefined, subscriptionId: string, providerSubscriptionId?: string) {
    if (!redemptionId) return;
    const redemption = dbStore.billingCouponRedemptions.find((item) => item.id === redemptionId);
    if (!redemption) return;
    redemption.subscriptionId = subscriptionId;
    redemption.providerSubscriptionId = providerSubscriptionId || redemption.providerSubscriptionId;
  }

  releaseExpiredReservations() {
    const now = Date.now();
    dbStore.billingCouponRedemptions
      .filter((item) => item.status === BillingCouponRedemptionStatus.RESERVED && new Date(item.expiresAt).getTime() <= now)
      .forEach((item) => {
        item.status = BillingCouponRedemptionStatus.EXPIRED;
        item.cancelledAt = new Date();
      });
  }

  redemptions(couponId: string) {
    return dbStore.billingCouponRedemptions
      .filter((item) => item.couponId === couponId)
      .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime());
  }

  analytics(couponId: string) {
    const redemptions = this.redemptions(couponId);
    const consumed = redemptions.filter((item) => item.status === BillingCouponRedemptionStatus.CONSUMED);
    const revenueBeforeDiscounts = consumed.reduce((sum, item) => sum + item.originalSubtotal, 0);
    const discountGiven = consumed.reduce((sum, item) => sum + item.discountAmount, 0);
    const revenueAfterDiscounts = consumed.reduce((sum, item) => sum + item.finalAmount, 0);
    return {
      totalRedemptions: redemptions.length,
      successfulRedemptions: consumed.length,
      revenueBeforeDiscounts,
      discountGiven,
      revenueAfterDiscounts,
      averageDiscount: consumed.length ? Math.round(discountGiven / consumed.length) : 0,
      couponRevenue: revenueAfterDiscounts,
      mrrInfluenced: Math.round(revenueAfterDiscounts / 12),
      arrInfluenced: revenueAfterDiscounts,
    };
  }

  private replaceMappings(couponId: string, planIds?: string[], organizationIds?: string[]) {
    if (planIds) {
      for (let index = dbStore.billingCouponPlans.length - 1; index >= 0; index -= 1) {
        if (dbStore.billingCouponPlans[index].couponId === couponId) dbStore.billingCouponPlans.splice(index, 1);
      }
      planIds.forEach((planId) => dbStore.billingCouponPlans.push({ id: uuidv4(), couponId, planId } as any));
    }
    if (organizationIds) {
      for (let index = dbStore.billingCouponOrganizations.length - 1; index >= 0; index -= 1) {
        if (dbStore.billingCouponOrganizations[index].couponId === couponId) dbStore.billingCouponOrganizations.splice(index, 1);
      }
      organizationIds.forEach((organizationId) => dbStore.billingCouponOrganizations.push({ id: uuidv4(), couponId, organizationId } as any));
    }
  }

  private assertCouponConfig(dto: Partial<CreateBillingCouponDto>) {
    if (!dto.code?.trim()) throw new BadRequestException({ code: 'COUPON_CODE_REQUIRED', message: 'Coupon code is required.' });
    if (!dto.name?.trim()) throw new BadRequestException({ code: 'COUPON_NAME_REQUIRED', message: 'Coupon name is required.' });
    if (dto.discountType === BillingCouponDiscountType.PERCENTAGE && (!dto.discountValue || dto.discountValue <= 0 || dto.discountValue > 100)) {
      throw new BadRequestException({ code: 'COUPON_INVALID_PERCENTAGE', message: 'Percentage discounts must be between 1 and 100.' });
    }
    if (dto.discountType === BillingCouponDiscountType.FIXED_AMOUNT && (!dto.discountValue || dto.discountValue <= 0)) {
      throw new BadRequestException({ code: 'COUPON_INVALID_FIXED_AMOUNT', message: 'Fixed discounts must be greater than zero minor units.' });
    }
    if (dto.discountType === BillingCouponDiscountType.TRIAL_EXTENSION && (!dto.trialExtensionDays || dto.trialExtensionDays <= 0)) {
      throw new BadRequestException({ code: 'COUPON_INVALID_TRIAL_EXTENSION', message: 'Trial extension coupons require extension days.' });
    }
    if (dto.discountType === BillingCouponDiscountType.FREE_MONTHS && (!dto.freeMonths || dto.freeMonths <= 0)) {
      throw new BadRequestException({ code: 'COUPON_INVALID_FREE_MONTHS', message: 'Free month coupons require a positive month count.' });
    }
    if (dto.planEligibility === BillingCouponPlanEligibility.SPECIFIC_PLANS && (!dto.planIds || dto.planIds.length === 0)) {
      throw new BadRequestException({ code: 'COUPON_PLAN_REQUIRED', message: 'Specific-plan coupons must include at least one plan.' });
    }
    if (dto.customerEligibility === BillingCouponCustomerEligibility.SPECIFIC_ORGANIZATIONS && (!dto.organizationIds || dto.organizationIds.length === 0)) {
      throw new BadRequestException({ code: 'COUPON_ORGANIZATION_REQUIRED', message: 'Private organization coupons must include at least one organization.' });
    }
  }

  private withUsage(coupon: BillingCouponEntity) {
    const redemptions = dbStore.billingCouponRedemptions.filter((item) => item.couponId === coupon.id);
    const consumed = redemptions.filter((item) => item.status === BillingCouponRedemptionStatus.CONSUMED);
    return {
      ...coupon,
      planIds: dbStore.billingCouponPlans.filter((item) => item.couponId === coupon.id).map((item) => item.planId),
      organizationIds: dbStore.billingCouponOrganizations.filter((item) => item.couponId === coupon.id).map((item) => item.organizationId),
      usage: {
        reserved: redemptions.filter((item) => item.status === BillingCouponRedemptionStatus.RESERVED).length,
        consumed: consumed.length,
        limit: coupon.maxRedemptions,
        discountGiven: consumed.reduce((sum, item) => sum + item.discountAmount, 0),
        revenueInfluenced: consumed.reduce((sum, item) => sum + item.finalAmount, 0),
      },
    };
  }

  private pricingSnapshot(quote: any) {
    return {
      couponCode: quote.coupon.code,
      couponName: quote.coupon.name,
      coupon: quote.coupon,
      plan: { id: quote.plan.id, code: quote.plan.code, name: quote.plan.name },
      billingCycle: quote.billingInterval,
      currency: quote.currency,
      subtotal: quote.subtotalMinor,
      discount: quote.discountMinor,
      tax: quote.taxMinor,
      total: quote.totalMinor,
      eligibilityVersion: quote.coupon.rowVersion,
      pricingVersion: quote.pricingVersion,
    };
  }

  private snapshot(coupon: BillingCouponEntity) {
    return JSON.parse(JSON.stringify(coupon));
  }

  private reservationTtlMs() {
    const minutes = Number(process.env.BILLING_COUPON_RESERVATION_MINUTES || DEFAULT_RESERVATION_MINUTES);
    return Math.max(5, Math.min(60, minutes)) * 60 * 1000;
  }

  private audit(action: string, resourceId: string, actorId?: string, metadata?: any, organizationId?: string) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId,
      action: action as AuditAction,
      resourceType: 'billing_coupon',
      resourceId,
      metadata,
      createdAt: new Date(),
    });
  }
}
