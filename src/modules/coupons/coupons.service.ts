import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import { getAppConfig } from '../../config/app.config';
import { SystemEmailDispatchService } from '../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import {
  AssignCouponDto,
  ChangeCouponStatusDto,
  CreateCouponDto,
  UpdateCouponDto,
  UpdateCouponSettingsDto,
} from './dto/coupon.dto';

const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');

const formatDiscount = (coupon: { discountType: string; discountValue: number }) =>
  coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}% off` : `$${coupon.discountValue} off`;

@Injectable()
export class CouponsService {
  constructor(private readonly emailDispatch?: SystemEmailDispatchService) {}

  // ─────────────────────────────────────────────────────────
  // Settings — "does your product support coupons at all?"
  // ─────────────────────────────────────────────────────────

  getSettings(organizationId: string) {
    const settings = dbStore.organizationCouponSettings.find((item) => item.organizationId === organizationId);
    return {
      organizationId,
      // Coupons are enabled by default until an org explicitly opts out.
      couponsEnabled: settings ? settings.couponsEnabled : true,
      updatedAt: settings?.updatedAt,
    };
  }

  upsertSettings(organizationId: string, userId: string, dto: UpdateCouponSettingsDto) {
    let settings = dbStore.organizationCouponSettings.find((item) => item.organizationId === organizationId);
    if (!settings) {
      settings = {
        id: uuidv4(),
        organizationId,
        couponsEnabled: dto.couponsEnabled,
        updatedBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.organizationCouponSettings.push(settings);
    } else {
      settings.couponsEnabled = dto.couponsEnabled;
      settings.updatedBy = userId;
      settings.updatedAt = new Date();
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: 'COUPON_SETTINGS_UPDATED' as any,
      resourceType: 'organization_coupon_settings',
      resourceId: settings.id,
      metadata: { couponsEnabled: dto.couponsEnabled },
      createdAt: new Date(),
    });

    return this.getSettings(organizationId);
  }

  /** Every coupon CRUD/assignment route must call this first — the org opted out, so we don't just hide the UI. */
  assertCouponsEnabled(organizationId: string) {
    if (!this.getSettings(organizationId).couponsEnabled) {
      throw new ForbiddenException('Coupons are not enabled for this organization. Enable "Coupon Accessibility" in Settings to use this feature.');
    }
  }

  // ─────────────────────────────────────────────────────────
  // Coupon CRUD
  // ─────────────────────────────────────────────────────────

  list(organizationId: string) {
    this.assertCouponsEnabled(organizationId);
    return dbStore.organizationCoupons
      .filter((item) => item.organizationId === organizationId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((coupon) => this.decorate(coupon));
  }

  get(organizationId: string, couponId: string) {
    this.assertCouponsEnabled(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);
    return this.decorate(coupon);
  }

  create(organizationId: string, userId: string, dto: CreateCouponDto) {
    this.assertCouponsEnabled(organizationId);
    this.assertDiscountValue(dto.discountType, dto.discountValue);

    const normalizedCode = normalizeCode(dto.code);
    if (!normalizedCode) {
      throw new BadRequestException('A valid coupon code is required.');
    }
    const existing = dbStore.organizationCoupons.find(
      (item) => item.organizationId === organizationId && item.normalizedCode === normalizedCode,
    );
    if (existing) {
      throw new BadRequestException(`A coupon with code "${dto.code}" already exists for this organization.`);
    }

    const validFrom = dto.validFrom ? new Date(dto.validFrom) : undefined;
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : undefined;
    if (validFrom && validUntil && validFrom >= validUntil) {
      throw new BadRequestException('validUntil must be after validFrom.');
    }

    const coupon = {
      id: uuidv4(),
      organizationId,
      code: dto.code.trim(),
      normalizedCode,
      name: dto.name.trim(),
      description: dto.description?.trim(),
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      status: 'ACTIVE',
      maxRedemptions: dto.maxRedemptions,
      validFrom,
      validUntil,
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    dbStore.organizationCoupons.push(coupon);

    this.audit(organizationId, userId, 'COUPON_CREATED', coupon.id, { code: coupon.code });

    if (dto.affiliateIds?.length) {
      this.assign(organizationId, userId, coupon.id, { affiliateIds: dto.affiliateIds });
    }

    return this.decorate(coupon);
  }

  update(organizationId: string, userId: string, couponId: string, dto: UpdateCouponDto) {
    this.assertCouponsEnabled(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);

    const nextType = dto.discountType ?? coupon.discountType;
    const nextValue = dto.discountValue ?? coupon.discountValue;
    this.assertDiscountValue(nextType as 'PERCENTAGE' | 'FIXED_AMOUNT', nextValue);

    if (dto.name !== undefined) coupon.name = dto.name.trim();
    if (dto.description !== undefined) coupon.description = dto.description.trim();
    if (dto.discountType !== undefined) coupon.discountType = dto.discountType;
    if (dto.discountValue !== undefined) coupon.discountValue = dto.discountValue;
    if (dto.maxRedemptions !== undefined) coupon.maxRedemptions = dto.maxRedemptions;
    if (dto.validFrom !== undefined) coupon.validFrom = new Date(dto.validFrom);
    if (dto.validUntil !== undefined) coupon.validUntil = new Date(dto.validUntil);
    if (coupon.validFrom && coupon.validUntil && coupon.validFrom >= coupon.validUntil) {
      throw new BadRequestException('validUntil must be after validFrom.');
    }
    coupon.updatedAt = new Date();

    this.audit(organizationId, userId, 'COUPON_UPDATED', coupon.id, { fields: Object.keys(dto) });

    return this.decorate(coupon);
  }

  changeStatus(organizationId: string, userId: string, couponId: string, dto: ChangeCouponStatusDto) {
    this.assertCouponsEnabled(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);
    coupon.status = dto.status;
    coupon.updatedAt = new Date();
    this.audit(organizationId, userId, 'COUPON_STATUS_CHANGED', coupon.id, { status: dto.status });
    return this.decorate(coupon);
  }

  // ─────────────────────────────────────────────────────────
  // Affiliate assignment
  // ─────────────────────────────────────────────────────────

  assign(organizationId: string, userId: string, couponId: string, dto: AssignCouponDto) {
    this.assertCouponsEnabled(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);

    const uniqueIds = Array.from(new Set(dto.affiliateIds));
    const affiliates = uniqueIds.map((affiliateId) => {
      const affiliate = dbStore.affiliates.find((item) => item.id === affiliateId);
      // IDOR prevention: an affiliate belonging to a different organization can never be assigned.
      if (!affiliate || affiliate.organizationId !== organizationId) {
        throw new NotFoundException(`Affiliate ${affiliateId} was not found in this organization.`);
      }
      return affiliate;
    });

    const created: string[] = [];
    for (const affiliate of affiliates) {
      const already = dbStore.organizationCouponAssignments.find(
        (item) => item.couponId === coupon.id && item.affiliateId === affiliate.id,
      );
      if (already) continue;
      dbStore.organizationCouponAssignments.push({
        id: uuidv4(),
        couponId: coupon.id,
        organizationId,
        affiliateId: affiliate.id,
        assignedBy: userId,
        assignedAt: new Date(),
      });
      created.push(affiliate.id);
    }

    if (created.length) {
      this.audit(organizationId, userId, 'COUPON_ASSIGNED', coupon.id, { affiliateIds: created });
      const organization = dbStore.organizations.find((item) => item.id === organizationId);
      const portalUrl = `${getAppConfig().affiliateFrontendUrl.replace(/\/$/, '')}/coupons`;
      for (const affiliateId of created) {
        const affiliate = affiliates.find((item) => item.id === affiliateId);
        if (!affiliate?.email) continue;
        this.emailDispatch
          ?.send(
            SystemTemplateKey.AFFILIATE_COUPON_ASSIGNED,
            affiliate.email,
            {
              affiliateName: affiliate.displayName,
              organizationName: organization?.name || 'Your organization',
              programName: coupon.name,
              couponCode: coupon.code,
              discount: formatDiscount(coupon),
              expiryDate: coupon.validUntil ? new Date(coupon.validUntil).toLocaleDateString() : undefined,
              portalUrl,
            },
            { organizationId },
          )
          .catch(() => undefined);
      }
    }

    return this.decorate(coupon);
  }

  unassign(organizationId: string, userId: string, couponId: string, affiliateId: string) {
    this.assertCouponsEnabled(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);
    const index = dbStore.organizationCouponAssignments.findIndex(
      (item) => item.couponId === coupon.id && item.affiliateId === affiliateId && item.organizationId === organizationId,
    );
    if (index === -1) {
      throw new NotFoundException('This coupon is not assigned to that affiliate.');
    }
    dbStore.organizationCouponAssignments.splice(index, 1);
    this.audit(organizationId, userId, 'COUPON_UNASSIGNED', coupon.id, { affiliateId });
    return this.decorate(coupon);
  }

  // ─────────────────────────────────────────────────────────
  // Affiliate-facing: coupons assigned to ME
  // ─────────────────────────────────────────────────────────

  listForAffiliate(organizationId: string, affiliateId: string) {
    if (!this.getSettings(organizationId).couponsEnabled) return [];
    const assignments = dbStore.organizationCouponAssignments.filter(
      (item) => item.organizationId === organizationId && item.affiliateId === affiliateId,
    );
    return assignments
      .map((assignment) => dbStore.organizationCoupons.find((c) => c.id === assignment.couponId))
      .filter((coupon): coupon is NonNullable<typeof coupon> => Boolean(coupon) && coupon!.status === 'ACTIVE')
      .map((coupon) => ({
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        validFrom: coupon.validFrom,
        validUntil: coupon.validUntil,
      }));
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  private requireCoupon(organizationId: string, couponId: string) {
    const coupon = dbStore.organizationCoupons.find((item) => item.id === couponId && item.organizationId === organizationId);
    if (!coupon) {
      throw new NotFoundException('Coupon not found.');
    }
    return coupon;
  }

  private assertDiscountValue(discountType: 'PERCENTAGE' | 'FIXED_AMOUNT', discountValue: number) {
    if (discountType === 'PERCENTAGE' && (discountValue < 1 || discountValue > 100)) {
      throw new BadRequestException('Percentage discount must be between 1 and 100.');
    }
    if (discountType === 'FIXED_AMOUNT' && discountValue <= 0) {
      throw new BadRequestException('Fixed amount discount must be greater than 0.');
    }
  }

  private decorate(coupon: any) {
    const assignments = dbStore.organizationCouponAssignments.filter((item) => item.couponId === coupon.id);
    return {
      id: coupon.id,
      organizationId: coupon.organizationId,
      code: coupon.code,
      name: coupon.name,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      status: coupon.status,
      maxRedemptions: coupon.maxRedemptions,
      validFrom: coupon.validFrom,
      validUntil: coupon.validUntil,
      createdAt: coupon.createdAt,
      updatedAt: coupon.updatedAt,
      assignedAffiliates: assignments.map((assignment) => {
        const affiliate = dbStore.affiliates.find((item) => item.id === assignment.affiliateId);
        return {
          affiliateId: assignment.affiliateId,
          displayName: affiliate?.displayName || 'Unknown affiliate',
          email: affiliate?.email,
          assignedAt: assignment.assignedAt,
        };
      }),
    };
  }

  private audit(organizationId: string, userId: string, action: string, resourceId: string, metadata: Record<string, unknown>) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: action as any,
      resourceType: 'organization_coupon',
      resourceId,
      metadata,
      createdAt: new Date(),
    });
  }
}
