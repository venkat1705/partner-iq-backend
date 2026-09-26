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
import { netCommissionAmount } from '../../common/utils/commission.utils';

const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');

const formatDiscount = (coupon: { discountType: string; discountValue: number }) =>
  coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}% off` : `$${coupon.discountValue} off`;

@Injectable()
export class CouponsService {
  constructor(private readonly emailDispatch?: SystemEmailDispatchService) { }

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
  // Analytics & Intelligence Aggregations
  // ─────────────────────────────────────────────────────────

  getAnalyticsOverview(
    organizationId: string,
    filter?: { programId?: string; affiliateId?: string; period?: string; dateFrom?: string; dateTo?: string },
  ) {
    this.assertCouponsEnabled(organizationId);

    const coupons = dbStore.organizationCoupons.filter((c) => c.organizationId === organizationId);
    const now = new Date();

    const activeCoupons = coupons.filter((c) => c.status === 'ACTIVE');
    const pausedCoupons = coupons.filter((c) => c.status === 'PAUSED');
    const archivedCoupons = coupons.filter((c) => c.status === 'ARCHIVED');
    const expiredCoupons = coupons.filter((c) => c.validUntil && new Date(c.validUntil) < now && c.status !== 'ARCHIVED');

    // Filter conversions for this organization
    let conversions = dbStore.conversions.filter((c) => c.organizationId === organizationId);
    if (filter?.programId) {
      conversions = conversions.filter((c) => c.programId === filter.programId);
    }
    if (filter?.affiliateId) {
      conversions = conversions.filter((c) => c.affiliateId === filter.affiliateId);
    }

    // Date range filter
    const { startDate, endDate } = this.resolveDateRange(filter?.period, filter?.dateFrom, filter?.dateTo);
    if (startDate) {
      conversions = conversions.filter((c) => new Date(c.occurredAt || c.createdAt) >= startDate);
    }
    if (endDate) {
      conversions = conversions.filter((c) => new Date(c.occurredAt || c.createdAt) <= endDate);
    }

    // Map coupons to their matching conversions
    let totalRedemptions = 0;
    let attributedConversions = 0;
    let couponDrivenRevenue = 0; // in cents
    let discountGiven = 0; // in cents
    let commissionGenerated = 0; // in cents

    // Day bucket map for activity trend
    const dayBucketMap = new Map<string, { redemptions: number; conversions: number; revenue: number; discount: number; commission: number }>();

    for (const coupon of coupons) {
      const couponConvs = this.getConversionsForCoupon(organizationId, coupon, conversions);
      totalRedemptions += couponConvs.length;

      for (const conv of couponConvs) {
        if (conv.status === 'APPROVED' || conv.status === 'CONFIRMED' || conv.status === 'PENDING') {
          attributedConversions += 1;
          couponDrivenRevenue += Number(conv.amount || 0);

          // Calculate discount
          const discount = this.calculateDiscount(coupon, Number(conv.amount || 0));
          discountGiven += discount;

          // Find associated commissions
          const comms = dbStore.commissions.filter((cm: any) => cm.conversionId === conv.id);
          const convComm = comms.reduce((sum: number, cm: any) => sum + netCommissionAmount(cm), 0);
          commissionGenerated += convComm;

          // Date key YYYY-MM-DD
          const d = new Date(conv.occurredAt || conv.createdAt).toISOString().split('T')[0];
          const bucket = dayBucketMap.get(d) || { redemptions: 0, conversions: 0, revenue: 0, discount: 0, commission: 0 };
          bucket.redemptions += 1;
          bucket.conversions += 1;
          bucket.revenue += Number(conv.amount || 0);
          bucket.discount += discount;
          bucket.commission += convComm;
          dayBucketMap.set(d, bucket);
        }
      }
    }

    // Convert map to sorted trend array
    const activityTrend = Array.from(dayBucketMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, data]) => ({
        date,
        redemptions: data.redemptions,
        conversions: data.conversions,
        revenue: data.revenue / 100, // in major currency units
        discount: data.discount / 100,
        commission: data.commission / 100,
      }));

    const averageOrderValue = attributedConversions > 0 ? Math.round(couponDrivenRevenue / attributedConversions) / 100 : 0;
    const netRevenue = Math.max(0, couponDrivenRevenue - discountGiven) / 100;
    const redemptionRate = conversions.length > 0 ? Math.round((totalRedemptions / conversions.length) * 1000) / 10 : 0;

    return {
      totalCoupons: coupons.length,
      activeCoupons: activeCoupons.length,
      pausedCoupons: pausedCoupons.length,
      archivedCoupons: archivedCoupons.length,
      expiredCoupons: expiredCoupons.length,
      totalRedemptions,
      attributedConversions,
      couponDrivenRevenue: couponDrivenRevenue / 100,
      discountGiven: discountGiven / 100,
      commissionGenerated: commissionGenerated / 100,
      netRevenue,
      averageOrderValue,
      redemptionRate,
      statusDistribution: [
        { status: 'ACTIVE', count: activeCoupons.length, label: 'Active' },
        { status: 'PAUSED', count: pausedCoupons.length, label: 'Paused' },
        { status: 'EXPIRED', count: expiredCoupons.length, label: 'Expired' },
        { status: 'ARCHIVED', count: archivedCoupons.length, label: 'Archived' },
      ],
      activityTrend,
    };
  }

  getPerformanceAnalytics(
    organizationId: string,
    filter?: { programId?: string; affiliateId?: string; sortBy?: string },
  ) {
    this.assertCouponsEnabled(organizationId);

    const coupons = dbStore.organizationCoupons.filter((c) => c.organizationId === organizationId);
    let conversions = dbStore.conversions.filter((c) => c.organizationId === organizationId);
    if (filter?.programId) conversions = conversions.filter((c) => c.programId === filter.programId);
    if (filter?.affiliateId) conversions = conversions.filter((c) => c.affiliateId === filter.affiliateId);

    const performance = coupons.map((coupon) => {
      const couponConvs = this.getConversionsForCoupon(organizationId, coupon, conversions);
      const assignments = dbStore.organizationCouponAssignments.filter((a) => a.couponId === coupon.id);

      const redemptions = couponConvs.length;
      let revenue = 0;
      let discount = 0;
      let commission = 0;

      for (const conv of couponConvs) {
        revenue += Number(conv.amount || 0);
        discount += this.calculateDiscount(coupon, Number(conv.amount || 0));
        const comms = dbStore.commissions.filter((cm: any) => cm.conversionId === conv.id);
        commission += comms.reduce((sum: number, cm: any) => sum + netCommissionAmount(cm), 0);
      }

      const aov = redemptions > 0 ? Math.round(revenue / redemptions) / 100 : 0;
      const maxRedemptions = coupon.maxRedemptions || null;
      const remainingRedemptions = maxRedemptions ? Math.max(0, maxRedemptions - redemptions) : null;
      const usagePercentage = maxRedemptions ? Math.min(100, Math.round((redemptions / maxRedemptions) * 100)) : 0;

      return {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        status: coupon.status,
        validFrom: coupon.validFrom,
        validUntil: coupon.validUntil,
        maxRedemptions,
        assignedAffiliatesCount: assignments.length,
        redemptions,
        conversions: redemptions,
        revenue: revenue / 100,
        discount: discount / 100,
        commission: commission / 100,
        aov,
        usagePercentage,
        remainingRedemptions,
      };
    });

    const sortBy = filter?.sortBy || 'revenue';
    return performance.sort((a: any, b: any) => (Number(b[sortBy]) || 0) - (Number(a[sortBy]) || 0));
  }

  getAffiliatePerformance(organizationId: string, filter?: { programId?: string }) {
    this.assertCouponsEnabled(organizationId);

    const affiliates = dbStore.affiliates.filter((a) => a.organizationId === organizationId);
    let conversions = dbStore.conversions.filter((c) => c.organizationId === organizationId);
    if (filter?.programId) conversions = conversions.filter((c) => c.programId === filter.programId);

    return affiliates.map((aff) => {
      const assignments = dbStore.organizationCouponAssignments.filter((a) => a.affiliateId === aff.id);
      const assignedCoupons = assignments
        .map((a) => dbStore.organizationCoupons.find((c) => c.id === a.couponId))
        .filter(Boolean);

      const affConvs = conversions.filter((c) => c.affiliateId === aff.id);
      let redemptions = 0;
      let revenue = 0;
      let discount = 0;
      let commission = 0;

      for (const coupon of assignedCoupons) {
        if (!coupon) continue;
        const couponConvs = this.getConversionsForCoupon(organizationId, coupon, affConvs);
        redemptions += couponConvs.length;

        for (const conv of couponConvs) {
          revenue += Number(conv.amount || 0);
          discount += this.calculateDiscount(coupon, Number(conv.amount || 0));
          const comms = dbStore.commissions.filter((cm: any) => cm.conversionId === conv.id);
          commission += comms.reduce((sum: number, cm: any) => sum + netCommissionAmount(cm), 0);
        }
      }

      const aov = redemptions > 0 ? Math.round(revenue / redemptions) / 100 : 0;

      return {
        affiliateId: aff.id,
        displayName: aff.displayName || 'Unnamed Partner',
        email: aff.email,
        assignedCouponsCount: assignedCoupons.length,
        couponCodes: assignedCoupons.map((c) => c!.code),
        redemptions,
        conversions: redemptions,
        revenue: revenue / 100,
        discount: discount / 100,
        commission: commission / 100,
        aov,
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }

  getProgramPerformance(organizationId: string) {
    this.assertCouponsEnabled(organizationId);

    const programs = dbStore.programs.filter((p) => p.organizationId === organizationId);
    const conversions = dbStore.conversions.filter((c) => c.organizationId === organizationId);
    const coupons = dbStore.organizationCoupons.filter((c) => c.organizationId === organizationId);

    return programs.map((prog) => {
      const progConvs = conversions.filter((c) => c.programId === prog.id);
      let redemptions = 0;
      let revenue = 0;
      let discount = 0;
      let commission = 0;

      for (const coupon of coupons) {
        const couponConvs = this.getConversionsForCoupon(organizationId, coupon, progConvs);
        redemptions += couponConvs.length;

        for (const conv of couponConvs) {
          revenue += Number(conv.amount || 0);
          discount += this.calculateDiscount(coupon, Number(conv.amount || 0));
          const comms = dbStore.commissions.filter((cm: any) => cm.conversionId === conv.id);
          commission += comms.reduce((sum: number, cm: any) => sum + netCommissionAmount(cm), 0);
        }
      }

      return {
        programId: prog.id,
        programName: prog.name,
        activeCouponsCount: coupons.filter((c) => c.status === 'ACTIVE').length,
        redemptions,
        conversions: redemptions,
        revenue: revenue / 100,
        discount: discount / 100,
        commission: commission / 100,
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }

  getActivityLog(organizationId: string, couponId?: string) {
    this.assertCouponsEnabled(organizationId);

    let logs = dbStore.auditLogs.filter(
      (log) => log.organizationId === organizationId && log.resourceType === 'organization_coupon',
    );

    if (couponId) {
      logs = logs.filter((log) => log.resourceId === couponId);
    }

    return logs
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50)
      .map((log) => {
        const coupon = dbStore.organizationCoupons.find((c) => c.id === log.resourceId);
        const user = dbStore.users.find((u) => u.id === log.actorId);
        return {
          id: log.id,
          action: log.action,
          couponId: log.resourceId,
          couponCode: coupon?.code || (log.metadata as any)?.code || 'COUPON',
          actorName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'System',
          metadata: log.metadata,
          createdAt: log.createdAt,
        };
      });
  }

  getCouponDetailAnalytics(organizationId: string, couponId: string) {
    this.assertCouponsEnabled(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);

    const conversions = dbStore.conversions.filter((c) => c.organizationId === organizationId);
    const couponConvs = this.getConversionsForCoupon(organizationId, coupon, conversions);

    let revenue = 0;
    let discount = 0;
    let commission = 0;

    const dayMap = new Map<string, { redemptions: number; revenue: number }>();

    for (const conv of couponConvs) {
      revenue += Number(conv.amount || 0);
      discount += this.calculateDiscount(coupon, Number(conv.amount || 0));
      const comms = dbStore.commissions.filter((cm: any) => cm.conversionId === conv.id);
      commission += comms.reduce((sum: number, cm: any) => sum + netCommissionAmount(cm), 0);

      const d = new Date(conv.occurredAt || conv.createdAt).toISOString().split('T')[0];
      const bucket = dayMap.get(d) || { redemptions: 0, revenue: 0 };
      bucket.redemptions += 1;
      bucket.revenue += Number(conv.amount || 0);
      dayMap.set(d, bucket);
    }

    const redemptions = couponConvs.length;
    const aov = redemptions > 0 ? Math.round(revenue / redemptions) / 100 : 0;
    const netRevenue = Math.max(0, revenue - discount) / 100;
    const maxRedemptions = coupon.maxRedemptions || null;
    const remainingRedemptions = maxRedemptions ? Math.max(0, maxRedemptions - redemptions) : null;
    const usagePercentage = maxRedemptions ? Math.min(100, Math.round((redemptions / maxRedemptions) * 100)) : 0;

    const redemptionsTrend = Array.from(dayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, data]) => ({
        date,
        redemptions: data.redemptions,
        revenue: data.revenue / 100,
      }));

    // Recent 10 conversions
    const recentConversions = couponConvs
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)
      .map((conv) => {
        const affiliate = dbStore.affiliates.find((a) => a.id === conv.affiliateId);
        const program = dbStore.programs.find((p) => p.id === conv.programId);
        const convDiscount = this.calculateDiscount(coupon, Number(conv.amount || 0)) / 100;
        return {
          id: conv.id,
          orderId: conv.externalId || (conv as any).externalOrderId || conv.id.slice(0, 8),
          customerEmail: (conv as any).customerEmail || (conv as any).customerExternalId || 'customer@partneriq.in',
          amount: Number(conv.amount || 0) / 100,
          discountAmount: convDiscount,
          status: conv.status,
          affiliateName: affiliate?.displayName || 'Direct',
          programName: program?.name || 'Program',
          occurredAt: conv.occurredAt || conv.createdAt,
        };
      });

    return {
      coupon: this.decorate(coupon),
      metrics: {
        redemptions,
        conversions: redemptions,
        revenue: revenue / 100,
        discount: discount / 100,
        commission: commission / 100,
        netRevenue,
        aov,
        usagePercentage,
        remainingRedemptions,
        maxRedemptions,
      },
      redemptionsTrend,
      recentConversions,
      activity: this.getActivityLog(organizationId, couponId),
    };
  }

  validateCouponCode(organizationId: string, code: string) {
    this.assertCouponsEnabled(organizationId);

    if (!code?.trim()) {
      return {
        isValid: false,
        reason: 'Coupon code is required.',
        coupon: null,
      };
    }

    const normalized = normalizeCode(code);
    const coupon = dbStore.organizationCoupons.find(
      (c) => c.organizationId === organizationId && c.normalizedCode === normalized,
    );

    if (!coupon) {
      return {
        isValid: false,
        reason: `Coupon code "${code.trim().toUpperCase()}" does not exist.`,
        coupon: null,
      };
    }

    if (coupon.status !== 'ACTIVE') {
      return {
        isValid: false,
        reason: `Coupon "${coupon.code}" is currently ${coupon.status.toLowerCase()}.`,
        coupon: this.decorate(coupon),
      };
    }

    const now = new Date();
    if (coupon.validFrom && new Date(coupon.validFrom) > now) {
      return {
        isValid: false,
        reason: `Coupon "${coupon.code}" is not yet active (scheduled for ${new Date(coupon.validFrom).toLocaleDateString()}).`,
        coupon: this.decorate(coupon),
      };
    }

    if (coupon.validUntil && new Date(coupon.validUntil) < now) {
      return {
        isValid: false,
        reason: `Coupon "${coupon.code}" expired on ${new Date(coupon.validUntil).toLocaleDateString()}.`,
        coupon: this.decorate(coupon),
      };
    }

    // Check redemption count
    const conversions = dbStore.conversions.filter((c) => c.organizationId === organizationId);
    const redemptions = this.getConversionsForCoupon(organizationId, coupon, conversions).length;
    if (coupon.maxRedemptions && redemptions >= coupon.maxRedemptions) {
      return {
        isValid: false,
        reason: `Coupon "${coupon.code}" has reached its maximum redemption limit (${coupon.maxRedemptions}).`,
        coupon: this.decorate(coupon),
      };
    }

    return {
      isValid: true,
      reason: 'Valid and active coupon.',
      coupon: {
        ...this.decorate(coupon),
        currentRedemptions: redemptions,
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  private getConversionsForCoupon(organizationId: string, coupon: any, conversions: any[]): any[] {
    const normalized = coupon.normalizedCode || normalizeCode(coupon.code);
    const assignments = dbStore.organizationCouponAssignments.filter((a) => a.couponId === coupon.id);
    const assignedAffiliateIds = new Set(assignments.map((a) => a.affiliateId));

    return conversions.filter((c) => {
      if (c.organizationId !== organizationId) return false;
      const meta = c.metadata || {};
      const metaCode = meta.couponCode || meta.promoCode || meta.coupon_code || meta.code || meta.coupon;
      if (metaCode && normalizeCode(String(metaCode)) === normalized) {
        return true;
      }
      // If affiliate is assigned to this coupon and metadata doesn't specify another coupon
      if (assignedAffiliateIds.has(c.affiliateId) && !metaCode) {
        return true;
      }
      return false;
    });
  }

  private calculateDiscount(coupon: any, conversionAmountCents: number): number {
    if (coupon.discountType === 'PERCENTAGE') {
      return Math.round(conversionAmountCents * (Number(coupon.discountValue) / 100));
    }
    // FIXED_AMOUNT in major units (e.g. 20 for $20 / ₹20) -> convert to cents
    const fixedCents = Number(coupon.discountValue) * 100;
    return Math.min(conversionAmountCents, fixedCents);
  }

  private resolveDateRange(period?: string, dateFrom?: string, dateTo?: string): { startDate?: Date; endDate?: Date } {
    if (dateFrom || dateTo) {
      return {
        startDate: dateFrom ? new Date(dateFrom) : undefined,
        endDate: dateTo ? new Date(dateTo) : undefined,
      };
    }

    const now = new Date();
    switch (period) {
      case '7D':
        return { startDate: new Date(now.getTime() - 7 * 86400000) };
      case '30D':
        return { startDate: new Date(now.getTime() - 30 * 86400000) };
      case '90D':
        return { startDate: new Date(now.getTime() - 90 * 86400000) };
      case 'LIFETIME':
      default:
        return {};
    }
  }

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

