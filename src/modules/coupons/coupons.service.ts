import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { EntityManager } from 'typeorm';
import { AppDataSource, initializeDataSource } from '../../database/data-source';
import { dbStore } from '../../database/store';
import { getAppConfig } from '../../config/app.config';
import { AffiliateStatus } from '../../common/enums';
import { SystemEmailDispatchService } from '../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import {
  AssignCouponDto,
  ChangeCouponStatusDto,
  CreateCouponDto,
  ListCouponsQueryDto,
  UpdateCouponDto,
  UpdateCouponSettingsDto,
} from './dto/coupon.dto';
import { loadOrganizationTimezone, localDateString, normalizeCode, parseCouponBoundary, validateNewCode } from './coupon-rules';

const formatMoney = (amountMajor: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amountMajor);
  } catch {
    return `${currency} ${amountMajor}`;
  }
};

/** Conversion statuses whose money counts in coupon revenue/commission KPIs (D12). */
const ATTRIBUTED_STATUSES = ['APPROVED', 'CONFIRMED', 'PENDING', 'PARTIALLY_REFUNDED'];
const MAX_FIXED_DISCOUNT = 10_000_000; // ₹1,00,00,000 in major units
const LOCK_WAIT_SECONDS = 5;

type CouponRow = (typeof dbStore.organizationCoupons)[number];

interface RedemptionAgg {
  key: string | null;
  redemptions: number;
  attributed: number;
  gross: number;
  discount: number;
  paid: number;
  commission: number;
}

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(@Optional() private readonly emailDispatch?: SystemEmailDispatchService) { }

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
    const before = settings ? settings.couponsEnabled : true;
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
      metadata: { before: { couponsEnabled: before }, after: { couponsEnabled: dto.couponsEnabled } },
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
  // Durable writes: MySQL first (transaction, bounded lock wait), memory second.
  // A request that fails here leaves nothing behind in either place (X, Y).
  // ─────────────────────────────────────────────────────────

  private async inTx<T>(work: (m: EntityManager) => Promise<T>): Promise<T> {
    await initializeDataSource();
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    try {
      await qr.query(`SET SESSION innodb_lock_wait_timeout = ${LOCK_WAIT_SECONDS}, lock_wait_timeout = ${LOCK_WAIT_SECONDS}`);
      await qr.startTransaction();
      const result = await work(qr.manager);
      await qr.commitTransaction();
      return result;
    } catch (err: any) {
      if (qr.isTransactionActive) await qr.rollbackTransaction().catch(() => undefined);
      if (err?.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('A coupon with this code already exists for this organization.');
      }
      if (err instanceof BadRequestException || err instanceof ConflictException || err instanceof NotFoundException) throw err;
      this.logger.error(`Coupon write failed: ${err?.code || ''} ${err?.message || err}`);
      throw new ServiceUnavailableException('The coupon change could not be saved. Nothing was changed; please retry.');
    } finally {
      await qr.query('SET SESSION innodb_lock_wait_timeout = DEFAULT, lock_wait_timeout = DEFAULT').catch(() => undefined);
      await qr.release();
    }
  }

  // ─────────────────────────────────────────────────────────
  // Validation helpers (run before anything is written)
  // ─────────────────────────────────────────────────────────

  private assertDiscountValue(discountType: 'PERCENTAGE' | 'FIXED_AMOUNT', discountValue: number) {
    if (!Number.isFinite(discountValue) || Math.round(discountValue * 100) !== Number((discountValue * 100).toFixed(6))) {
      throw new BadRequestException('Discount value must be a number with at most 2 decimal places.');
    }
    if (discountType === 'PERCENTAGE' && (discountValue < 0.01 || discountValue > 100)) {
      throw new BadRequestException('Percentage discount must be between 0.01 and 100.');
    }
    if (discountType === 'FIXED_AMOUNT' && (discountValue < 0.01 || discountValue > MAX_FIXED_DISCOUNT)) {
      throw new BadRequestException(`Fixed amount discount must be between 0.01 and ${MAX_FIXED_DISCOUNT}.`);
    }
  }

  private resolveWindow(organizationId: string, validFrom?: string | null, validUntil?: string | null, current?: { validFrom?: Date | null; validUntil?: Date | null }) {
    const from = validFrom === undefined ? current?.validFrom ?? undefined : validFrom === null ? undefined : parseCouponBoundary(validFrom, organizationId, 'start');
    const until = validUntil === undefined ? current?.validUntil ?? undefined : validUntil === null ? undefined : parseCouponBoundary(validUntil, organizationId, 'end');
    if (from && until && new Date(from) >= new Date(until)) {
      throw new BadRequestException('validUntil must be after validFrom.');
    }
    return { validFrom: from ? new Date(from) : undefined, validUntil: until ? new Date(until) : undefined };
  }

  /** Affiliates must exist, belong to this organization and be ACTIVE (IDOR + "dead" partner guard). */
  private resolveAffiliates(organizationId: string, affiliateIds: string[]) {
    return Array.from(new Set(affiliateIds)).map((affiliateId) => {
      const affiliate = dbStore.affiliates.find((item) => item.id === affiliateId);
      if (!affiliate || affiliate.organizationId !== organizationId) {
        throw new NotFoundException(`Affiliate ${affiliateId} was not found in this organization.`);
      }
      if (affiliate.status !== AffiliateStatus.ACTIVE) {
        throw new BadRequestException(`Affiliate ${affiliate.displayName || affiliateId} is ${String(affiliate.status).toLowerCase()} and cannot receive coupons.`);
      }
      return affiliate;
    });
  }

  // ─────────────────────────────────────────────────────────
  // Coupon CRUD
  // ─────────────────────────────────────────────────────────

  async list(organizationId: string, query: ListCouponsQueryDto = {}) {
    this.assertCouponsEnabled(organizationId);
    await loadOrganizationTimezone(organizationId);
    let rows = dbStore.organizationCoupons.filter((item) => item.organizationId === organizationId);
    const now = Date.now();
    const effective = (c: CouponRow) => (c.status !== 'ARCHIVED' && c.validUntil && new Date(c.validUntil).getTime() + 1000 <= now ? 'EXPIRED' : c.status);
    if (query.search) {
      const q = query.search.trim().toUpperCase();
      rows = rows.filter((c) => c.normalizedCode.includes(normalizeCode(q)) || c.name.toUpperCase().includes(q));
    }
    if (query.status) rows = rows.filter((c) => effective(c) === query.status);
    if (query.discountType) rows = rows.filter((c) => c.discountType === query.discountType);
    if (query.affiliateId) {
      const ids = new Set(dbStore.organizationCouponAssignments.filter((a) => a.organizationId === organizationId && a.affiliateId === query.affiliateId).map((a) => a.couponId));
      rows = rows.filter((c) => ids.has(c.id));
    }
    const dir = query.sortDir === 'asc' ? 1 : -1;
    const sortKey = query.sortBy || 'createdAt';
    rows = [...rows].sort((a, b) => {
      const av = sortKey === 'code' ? a.normalizedCode : sortKey === 'discountValue' ? Number(a.discountValue) : new Date(a.createdAt).getTime();
      const bv = sortKey === 'code' ? b.normalizedCode : sortKey === 'discountValue' ? Number(b.discountValue) : new Date(b.createdAt).getTime();
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });

    if (query.page === undefined) {
      // Legacy shape (array of every coupon) — the admin UI and older clients rely on it.
      const usage = await this.usageMap(organizationId, rows.map((c) => c.id));
      return rows.map((coupon) => this.decorate(coupon, usage));
    }
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const page = Math.max(Number(query.page) || 1, 1);
    const slice = rows.slice((page - 1) * limit, page * limit);
    const usage = await this.usageMap(organizationId, slice.map((c) => c.id));
    return { items: slice.map((coupon) => this.decorate(coupon, usage)), total: rows.length, page, limit };
  }

  async get(organizationId: string, couponId: string) {
    this.assertCouponsEnabled(organizationId);
    await loadOrganizationTimezone(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);
    return this.decorate(coupon, await this.usageMap(organizationId, [coupon.id]));
  }

  async create(organizationId: string, userId: string, dto: CreateCouponDto) {
    this.assertCouponsEnabled(organizationId);
    await loadOrganizationTimezone(organizationId);
    // 1. validate everything first — nothing is written for a 4xx
    const code = validateNewCode(dto.code);
    this.assertDiscountValue(dto.discountType, dto.discountValue);
    const window = this.resolveWindow(organizationId, dto.validFrom, dto.validUntil);
    const affiliates = this.resolveAffiliates(organizationId, dto.affiliateIds || []);
    if (dbStore.organizationCoupons.some((item) => item.organizationId === organizationId && item.normalizedCode === code)) {
      throw new ConflictException(`A coupon with code "${code}" already exists for this organization (archived codes cannot be reused).`);
    }

    const now = new Date();
    const coupon: CouponRow = {
      id: uuidv4(),
      organizationId,
      code,
      normalizedCode: code,
      name: dto.name.trim(),
      description: dto.description?.trim() || undefined,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      discountValueLegacy: Math.round(dto.discountValue),
      status: 'ACTIVE',
      maxRedemptions: dto.maxRedemptions ?? undefined,
      maxRedemptionsPerCustomer: dto.maxRedemptionsPerCustomer ?? undefined,
      validFrom: window.validFrom,
      validUntil: window.validUntil,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    } as CouponRow;
    const assignments = affiliates.map((affiliate) => ({
      id: uuidv4(),
      couponId: coupon.id,
      organizationId,
      affiliateId: affiliate.id,
      assignedBy: userId,
      assignedAt: now,
    }));

    // 2. MySQL first: the unique (organizationId, normalizedCode) constraint decides concurrent duplicates (F)
    await this.inTx(async (m) => {
      await m.query(
        `INSERT INTO organization_coupons (id, organizationId, code, normalizedCode, name, description, discountType, discountValueExact, discountValue, status,
           maxRedemptions, maxRedemptionsPerCustomer, validFrom, validUntil, createdBy, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)`,
        [coupon.id, organizationId, code, code, coupon.name, coupon.description ?? null, coupon.discountType, coupon.discountValue, Math.round(coupon.discountValue),
          coupon.maxRedemptions ?? null, coupon.maxRedemptionsPerCustomer ?? null, coupon.validFrom ?? null, coupon.validUntil ?? null, userId, now, now],
      );
      for (const a of assignments) {
        await m.query(
          `INSERT INTO organization_coupon_assignments (id, couponId, organizationId, affiliateId, assignedBy, assignedAt) VALUES (?, ?, ?, ?, ?, ?)`,
          [a.id, a.couponId, a.organizationId, a.affiliateId, a.assignedBy, a.assignedAt],
        );
      }
      // usage counter row exists from the start, so checkout never has to create it under contention
      await m.query(`INSERT INTO organization_coupon_usage (couponId, organizationId, redemptionCount) VALUES (?, ?, 0)`, [coupon.id, organizationId]);
    });

    // 3. memory mirrors what is now durable
    dbStore.organizationCoupons.push(coupon);
    if (assignments.length) dbStore.organizationCouponAssignments.push(...assignments);

    this.audit(organizationId, userId, 'COUPON_CREATED', coupon.id, { code, after: this.snapshot(coupon) });
    if (assignments.length) {
      this.audit(organizationId, userId, 'COUPON_ASSIGNED', coupon.id, { affiliateIds: assignments.map((a) => a.affiliateId) });
      this.notifyAssigned(organizationId, coupon, affiliates);
    }
    return this.decorate(coupon, new Map());
  }

  async update(organizationId: string, userId: string, couponId: string, dto: UpdateCouponDto) {
    this.assertCouponsEnabled(organizationId);
    await loadOrganizationTimezone(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);
    if (coupon.status === 'ARCHIVED') {
      throw new BadRequestException('Archived coupons cannot be edited.');
    }

    // compute the complete next state and validate it before touching anything
    const nextType = (dto.discountType ?? coupon.discountType) as 'PERCENTAGE' | 'FIXED_AMOUNT';
    const nextValue = dto.discountValue ?? Number(coupon.discountValue);
    this.assertDiscountValue(nextType, nextValue);
    const window = this.resolveWindow(organizationId, dto.validFrom, dto.validUntil, coupon);
    const next = {
      name: dto.name !== undefined ? dto.name.trim() : coupon.name,
      description: dto.description !== undefined ? (dto.description?.trim() || undefined) : coupon.description,
      discountType: nextType,
      discountValue: nextValue,
      maxRedemptions: dto.maxRedemptions !== undefined ? dto.maxRedemptions ?? undefined : coupon.maxRedemptions,
      maxRedemptionsPerCustomer: dto.maxRedemptionsPerCustomer !== undefined ? dto.maxRedemptionsPerCustomer ?? undefined : coupon.maxRedemptionsPerCustomer,
      validFrom: window.validFrom,
      validUntil: window.validUntil,
    };
    if (next.maxRedemptions !== undefined && next.maxRedemptions !== null) {
      const used = (await this.usageMap(organizationId, [coupon.id])).get(coupon.id) ?? 0;
      if (next.maxRedemptions < used) {
        throw new BadRequestException(`Usage limit ${next.maxRedemptions} is below the ${used} use(s) already recorded.`);
      }
    }

    const before = this.snapshot(coupon);
    const now = new Date();
    await this.inTx(async (m) => {
      const res: any = await m.query(
        `UPDATE organization_coupons SET name = ?, description = ?, discountType = ?, discountValueExact = ?, discountValue = ?, maxRedemptions = ?,
           maxRedemptionsPerCustomer = ?, validFrom = ?, validUntil = ?, updatedAt = ? WHERE id = ? AND organizationId = ?`,
        [next.name, next.description ?? null, next.discountType, next.discountValue, Math.round(next.discountValue), next.maxRedemptions ?? null,
          next.maxRedemptionsPerCustomer ?? null, next.validFrom ?? null, next.validUntil ?? null, now, coupon.id, organizationId],
      );
      if (Number(res?.affectedRows ?? 0) !== 1) throw new NotFoundException('Coupon not found.');
    });
    Object.assign(coupon, next, { discountValueLegacy: Math.round(next.discountValue), updatedAt: now });

    const after = this.snapshot(coupon);
    const changed = Object.keys(after).filter((k) => JSON.stringify((before as any)[k]) !== JSON.stringify((after as any)[k]));
    this.audit(organizationId, userId, 'COUPON_UPDATED', coupon.id, {
      fields: changed,
      before: Object.fromEntries(changed.map((k) => [k, (before as any)[k]])),
      after: Object.fromEntries(changed.map((k) => [k, (after as any)[k]])),
    });
    return this.decorate(coupon, await this.usageMap(organizationId, [coupon.id]));
  }

  async changeStatus(organizationId: string, userId: string, couponId: string, dto: ChangeCouponStatusDto) {
    this.assertCouponsEnabled(organizationId);
    await loadOrganizationTimezone(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);
    if (coupon.status === 'ARCHIVED' && dto.status !== 'ARCHIVED') {
      throw new BadRequestException('Archived coupons cannot be reactivated; create a new coupon with a different code.');
    }
    const before = coupon.status;
    if (before !== dto.status) {
      const now = new Date();
      await this.inTx(async (m) => {
        await m.query(`UPDATE organization_coupons SET status = ?, updatedAt = ? WHERE id = ? AND organizationId = ?`, [dto.status, now, coupon.id, organizationId]);
      });
      coupon.status = dto.status;
      coupon.updatedAt = now;
      this.audit(organizationId, userId, 'COUPON_STATUS_CHANGED', coupon.id, { status: dto.status, before: { status: before }, after: { status: dto.status } });
    }
    return this.decorate(coupon, await this.usageMap(organizationId, [coupon.id]));
  }

  // ─────────────────────────────────────────────────────────
  // Affiliate assignment
  // ─────────────────────────────────────────────────────────

  async assign(organizationId: string, userId: string, couponId: string, dto: AssignCouponDto) {
    this.assertCouponsEnabled(organizationId);
    await loadOrganizationTimezone(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);
    if (coupon.status === 'ARCHIVED') {
      throw new BadRequestException('Archived coupons cannot be assigned.');
    }
    const affiliates = this.resolveAffiliates(organizationId, dto.affiliateIds);
    const fresh = affiliates.filter(
      (affiliate) => !dbStore.organizationCouponAssignments.some((item) => item.couponId === coupon.id && item.affiliateId === affiliate.id),
    );
    const now = new Date();
    const rows = fresh.map((affiliate) => ({ id: uuidv4(), couponId: coupon.id, organizationId, affiliateId: affiliate.id, assignedBy: userId, assignedAt: now }));
    if (rows.length) {
      await this.inTx(async (m) => {
        for (const a of rows) {
          await m.query(
            `INSERT INTO organization_coupon_assignments (id, couponId, organizationId, affiliateId, assignedBy, assignedAt) VALUES (?, ?, ?, ?, ?, ?)`,
            [a.id, a.couponId, a.organizationId, a.affiliateId, a.assignedBy, a.assignedAt],
          );
        }
      });
      dbStore.organizationCouponAssignments.push(...rows);
      this.audit(organizationId, userId, 'COUPON_ASSIGNED', coupon.id, { affiliateIds: rows.map((r) => r.affiliateId) });
      this.notifyAssigned(organizationId, coupon, fresh);
    }
    return this.decorate(coupon, await this.usageMap(organizationId, [coupon.id]));
  }

  async unassign(organizationId: string, userId: string, couponId: string, affiliateId: string) {
    this.assertCouponsEnabled(organizationId);
    await loadOrganizationTimezone(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);
    const index = dbStore.organizationCouponAssignments.findIndex(
      (item) => item.couponId === coupon.id && item.affiliateId === affiliateId && item.organizationId === organizationId,
    );
    if (index === -1) {
      throw new NotFoundException('This coupon is not assigned to that affiliate.');
    }
    await this.inTx(async (m) => {
      await m.query(`DELETE FROM organization_coupon_assignments WHERE couponId = ? AND affiliateId = ? AND organizationId = ?`, [coupon.id, affiliateId, organizationId]);
    });
    dbStore.organizationCouponAssignments.splice(index, 1);
    // Past sales keep their own affiliate (conversion + redemption rows); only future sales are affected (J).
    this.audit(organizationId, userId, 'COUPON_UNASSIGNED', coupon.id, { affiliateId });
    return this.decorate(coupon, await this.usageMap(organizationId, [coupon.id]));
  }

  private notifyAssigned(organizationId: string, coupon: CouponRow, affiliates: Array<{ email?: string; displayName?: string }>) {
    const organization = dbStore.organizations.find((item) => item.id === organizationId);
    const currency = (organization as any)?.defaultCurrency || 'INR';
    const portalUrl = `${getAppConfig().affiliateFrontendUrl.replace(/\/$/, '')}/coupons`;
    for (const affiliate of affiliates) {
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
            discount: coupon.discountType === 'PERCENTAGE' ? `${Number(coupon.discountValue)}% off` : `${formatMoney(Number(coupon.discountValue), currency)} off`,
            expiryDate: coupon.validUntil ? localDateString(coupon.validUntil, organizationId) || undefined : undefined,
            portalUrl,
          },
          { organizationId },
        )
        .catch(() => undefined);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Affiliate-facing: coupons assigned to ME (portal contract, see inventory §1.2)
  // ─────────────────────────────────────────────────────────

  async listForAffiliate(organizationId: string, affiliateId: string) {
    if (!this.getSettings(organizationId).couponsEnabled) return [];
    const assignments = dbStore.organizationCouponAssignments.filter(
      (item) => item.organizationId === organizationId && item.affiliateId === affiliateId,
    );
    const coupons = assignments
      .map((assignment) => dbStore.organizationCoupons.find((c) => c.id === assignment.couponId && c.organizationId === organizationId))
      .filter((coupon): coupon is CouponRow => Boolean(coupon) && coupon!.status === 'ACTIVE');
    if (!coupons.length) return [];
    const stats = await this.aggregate(organizationId, 'r.couponId', { affiliateId, couponIds: coupons.map((c) => c.id), commissionAffiliateId: affiliateId });
    const currency = (dbStore.organizations.find((o) => o.id === organizationId) as any)?.defaultCurrency || 'INR';
    const now = Date.now();
    return coupons.map((coupon) => {
      const s = stats.get(coupon.id);
      return {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: Number(coupon.discountValue),
        validFrom: coupon.validFrom,
        validUntil: coupon.validUntil,
        status: coupon.validUntil && new Date(coupon.validUntil).getTime() + 1000 <= now ? 'EXPIRED' : 'ACTIVE',
        uses: s?.redemptions ?? 0,
        conversions: s?.attributed ?? 0,
        revenueGenerated: (s?.paid ?? 0) / 100,
        commissionEarned: (s?.commission ?? 0) / 100,
        currency,
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // Analytics — computed from recorded uses (organization_coupon_redemptions), never re-derived from the
  // coupon's current discount (H) or inferred from affiliate assignments (old behaviour).
  // ─────────────────────────────────────────────────────────

  /**
   * Aggregates recorded uses grouped by `groupBy` (an SQL expression over alias r). Money in minor units.
   * Revenue/discount/commission count only conversions in ATTRIBUTED_STATUSES; gross/paid subtract refunds.
   */
  private async aggregate(
    organizationId: string,
    groupBy: string | null,
    filter: { programId?: string; affiliateId?: string; from?: Date; to?: Date; couponIds?: string[]; commissionAffiliateId?: string } = {},
  ): Promise<Map<string | null, RedemptionAgg>> {
    await initializeDataSource();
    const where = ['r.organizationId = ?'];
    const params: unknown[] = [];
    if (filter.programId) { where.push('r.programId = ?'); params.push(filter.programId); }
    if (filter.affiliateId) { where.push('r.affiliateId = ?'); params.push(filter.affiliateId); }
    if (filter.from) { where.push('v.occurredAt >= ?'); params.push(filter.from); }
    if (filter.to) { where.push('v.occurredAt <= ?'); params.push(filter.to); }
    if (filter.couponIds?.length) { where.push('r.couponId IN (?)'); params.push(filter.couponIds); }
    const attributed = `v.status IN (${ATTRIBUTED_STATUSES.map(() => '?').join(',')})`;
    const commissionScope = filter.commissionAffiliateId ? 'AND cm.affiliateId = ?' : '';
    const sql = `
      SELECT ${groupBy ? `${groupBy} AS k` : 'NULL AS k'},
             COUNT(*) AS redemptions,
             SUM(${attributed}) AS attributed,
             SUM(IF(${attributed}, r.grossAmount - COALESCE(v.refundedAmount, 0), 0)) AS gross,
             SUM(IF(${attributed}, r.discountAmount, 0)) AS discount,
             SUM(IF(${attributed}, r.orderAmount - COALESCE(v.refundedAmount, 0), 0)) AS paid,
             SUM(IF(${attributed}, COALESCE(c.net, 0), 0)) AS commission
        FROM organization_coupon_redemptions r
        JOIN conversions v ON v.id = r.conversionId
        LEFT JOIN (SELECT cm.conversionId, SUM(cm.commissionAmount - COALESCE(cm.reversedAmount, 0)) net
                     FROM commissions cm WHERE cm.organizationId = ? ${commissionScope} GROUP BY cm.conversionId) c ON c.conversionId = r.conversionId
       WHERE ${where.join(' AND ')}
       ${groupBy ? `GROUP BY ${groupBy}` : ''}`;
    const args = [...ATTRIBUTED_STATUSES, ...ATTRIBUTED_STATUSES, ...ATTRIBUTED_STATUSES, ...ATTRIBUTED_STATUSES, ...ATTRIBUTED_STATUSES,
      organizationId, ...(filter.commissionAffiliateId ? [filter.commissionAffiliateId] : []), organizationId, ...params];
    const rows: any[] = await AppDataSource.query(sql, args);
    return new Map(rows.map((r) => [r.k ?? null, {
      key: r.k ?? null,
      redemptions: Number(r.redemptions || 0),
      attributed: Number(r.attributed || 0),
      gross: Number(r.gross || 0),
      discount: Number(r.discount || 0),
      paid: Number(r.paid || 0),
      commission: Number(r.commission || 0),
    }]));
  }

  async getAnalyticsOverview(
    organizationId: string,
    filter?: { programId?: string; affiliateId?: string; period?: string; dateFrom?: string; dateTo?: string },
  ) {
    this.assertCouponsEnabled(organizationId);
    const coupons = dbStore.organizationCoupons.filter((c) => c.organizationId === organizationId);
    const now = Date.now();
    const isExpired = (c: CouponRow) => Boolean(c.validUntil) && new Date(c.validUntil as any).getTime() + 1000 <= now;
    const activeCoupons = coupons.filter((c) => c.status === 'ACTIVE' && !isExpired(c));
    const pausedCoupons = coupons.filter((c) => c.status === 'PAUSED' && !isExpired(c));
    const archivedCoupons = coupons.filter((c) => c.status === 'ARCHIVED');
    const expiredCoupons = coupons.filter((c) => c.status !== 'ARCHIVED' && isExpired(c));

    const { startDate, endDate } = this.resolveDateRange(filter?.period, filter?.dateFrom, filter?.dateTo);
    const scope = { programId: filter?.programId, affiliateId: filter?.affiliateId, from: startDate, to: endDate };
    const total = (await this.aggregate(organizationId, null, scope)).get(null);
    const days = await this.aggregate(organizationId, `DATE_FORMAT(v.occurredAt, '%Y-%m-%d')`, scope);

    let conversions = dbStore.conversions.filter((c) => c.organizationId === organizationId);
    if (filter?.programId) conversions = conversions.filter((c) => c.programId === filter.programId);
    if (filter?.affiliateId) conversions = conversions.filter((c) => c.affiliateId === filter.affiliateId);
    if (startDate) conversions = conversions.filter((c) => new Date(c.occurredAt || c.createdAt) >= startDate);
    if (endDate) conversions = conversions.filter((c) => new Date(c.occurredAt || c.createdAt) <= endDate);

    const totalRedemptions = total?.redemptions ?? 0;
    const attributedConversions = total?.attributed ?? 0;
    const gross = total?.gross ?? 0;
    const discount = total?.discount ?? 0;
    return {
      totalCoupons: coupons.length,
      activeCoupons: activeCoupons.length,
      pausedCoupons: pausedCoupons.length,
      archivedCoupons: archivedCoupons.length,
      expiredCoupons: expiredCoupons.length,
      totalRedemptions,
      attributedConversions,
      couponDrivenRevenue: gross / 100,
      discountGiven: discount / 100,
      commissionGenerated: (total?.commission ?? 0) / 100,
      netRevenue: (total?.paid ?? 0) / 100,
      averageOrderValue: attributedConversions > 0 ? Math.round(gross / attributedConversions) / 100 : 0,
      redemptionRate: conversions.length > 0 ? Math.round((totalRedemptions / conversions.length) * 1000) / 10 : 0,
      statusDistribution: [
        { status: 'ACTIVE', count: activeCoupons.length, label: 'Active' },
        { status: 'PAUSED', count: pausedCoupons.length, label: 'Paused' },
        { status: 'EXPIRED', count: expiredCoupons.length, label: 'Expired' },
        { status: 'ARCHIVED', count: archivedCoupons.length, label: 'Archived' },
      ],
      activityTrend: [...days.values()]
        .sort((a, b) => String(a.key).localeCompare(String(b.key)))
        .map((d) => ({
          date: d.key,
          redemptions: d.redemptions,
          conversions: d.attributed,
          revenue: d.gross / 100,
          discount: d.discount / 100,
          commission: d.commission / 100,
        })),
    };
  }

  async getPerformanceAnalytics(
    organizationId: string,
    filter?: { programId?: string; affiliateId?: string; sortBy?: string; period?: string },
  ) {
    this.assertCouponsEnabled(organizationId);
    const coupons = dbStore.organizationCoupons.filter((c) => c.organizationId === organizationId);
    const { startDate } = this.resolveDateRange(filter?.period);
    const stats = await this.aggregate(organizationId, 'r.couponId', { programId: filter?.programId, affiliateId: filter?.affiliateId, from: startDate });
    const usage = await this.usageMap(organizationId);
    const assignmentCount = new Map<string, number>();
    for (const a of dbStore.organizationCouponAssignments) if (a.organizationId === organizationId) assignmentCount.set(a.couponId, (assignmentCount.get(a.couponId) || 0) + 1);

    const performance = coupons.map((coupon) => {
      const s = stats.get(coupon.id);
      const used = usage.get(coupon.id) ?? 0;
      const maxRedemptions = coupon.maxRedemptions || null;
      return {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: Number(coupon.discountValue),
        status: coupon.status,
        validFrom: coupon.validFrom,
        validUntil: coupon.validUntil,
        maxRedemptions,
        assignedAffiliatesCount: assignmentCount.get(coupon.id) || 0,
        redemptions: s?.redemptions ?? 0,
        conversions: s?.attributed ?? 0,
        revenue: (s?.gross ?? 0) / 100,
        discount: (s?.discount ?? 0) / 100,
        commission: (s?.commission ?? 0) / 100,
        aov: s?.attributed ? Math.round((s.gross ?? 0) / s.attributed) / 100 : 0,
        // quota numbers are lifetime uses, independent of the period/program filter
        totalUses: used,
        usagePercentage: maxRedemptions ? Math.min(100, Math.round((used / maxRedemptions) * 100)) : 0,
        remainingRedemptions: maxRedemptions ? Math.max(0, maxRedemptions - used) : null,
      };
    });

    const sortBy = filter?.sortBy || 'revenue';
    return performance.sort((a: any, b: any) => (Number(b[sortBy]) || 0) - (Number(a[sortBy]) || 0));
  }

  async getAffiliatePerformance(organizationId: string, filter?: { programId?: string }) {
    this.assertCouponsEnabled(organizationId);
    const affiliates = dbStore.affiliates.filter((a) => a.organizationId === organizationId);
    // grouped by the affiliate that received credit at sale time — moving a coupon never moves history (J)
    const stats = await this.aggregate(organizationId, 'r.affiliateId', { programId: filter?.programId });
    return affiliates.map((aff) => {
      const assignedCoupons = dbStore.organizationCouponAssignments
        .filter((a) => a.affiliateId === aff.id && a.organizationId === organizationId)
        .map((a) => dbStore.organizationCoupons.find((c) => c.id === a.couponId))
        .filter((c): c is CouponRow => Boolean(c));
      const s = stats.get(aff.id);
      const earned = dbStore.ledgerAccounts.find((acc) => acc.organizationId === organizationId && acc.affiliateId === aff.id && acc.type === 'EARNED');
      return {
        affiliateId: aff.id,
        displayName: aff.displayName || 'Unnamed Partner',
        email: aff.email,
        assignedCouponsCount: assignedCoupons.length,
        couponCodes: assignedCoupons.map((c) => c.code),
        redemptions: s?.redemptions ?? 0,
        conversions: s?.attributed ?? 0,
        revenue: (s?.gross ?? 0) / 100,
        discount: (s?.discount ?? 0) / 100,
        commission: (s?.commission ?? 0) / 100,
        aov: s?.attributed ? Math.round(s.gross / s.attributed) / 100 : 0,
        // D11: a balance below zero means commissions were clawed back after being paid; offset against future earnings
        ledgerBalance: earned ? Number(earned.balance) / 100 : 0,
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }

  async getProgramPerformance(organizationId: string) {
    this.assertCouponsEnabled(organizationId);
    const programs = dbStore.programs.filter((p) => p.organizationId === organizationId);
    const stats = await this.aggregate(organizationId, 'r.programId');
    const used: Array<{ programId: string; n: number }> = await AppDataSource.query(
      `SELECT r.programId, COUNT(DISTINCT r.couponId) n FROM organization_coupon_redemptions r JOIN organization_coupons c ON c.id = r.couponId
        WHERE r.organizationId = ? AND c.status = 'ACTIVE' GROUP BY r.programId`,
      [organizationId],
    );
    const activeUsed = new Map(used.map((u) => [u.programId, Number(u.n)]));
    return programs.map((prog) => {
      const s = stats.get(prog.id);
      return {
        programId: prog.id,
        programName: prog.name,
        // coupons are organization-wide; this counts ACTIVE coupons that have been used in this program
        activeCouponsCount: activeUsed.get(prog.id) ?? 0,
        redemptions: s?.redemptions ?? 0,
        conversions: s?.attributed ?? 0,
        revenue: (s?.gross ?? 0) / 100,
        discount: (s?.discount ?? 0) / 100,
        commission: (s?.commission ?? 0) / 100,
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
        const coupon = dbStore.organizationCoupons.find((c) => c.id === log.resourceId && c.organizationId === organizationId);
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

  async getCouponDetailAnalytics(organizationId: string, couponId: string) {
    this.assertCouponsEnabled(organizationId);
    await loadOrganizationTimezone(organizationId);
    const coupon = this.requireCoupon(organizationId, couponId);
    const s = (await this.aggregate(organizationId, null, { couponIds: [coupon.id] })).get(null);
    const days = await this.aggregate(organizationId, `DATE_FORMAT(v.occurredAt, '%Y-%m-%d')`, { couponIds: [coupon.id] });
    const usage = await this.usageMap(organizationId, [coupon.id]);
    const used = usage.get(coupon.id) ?? 0;
    const recent: any[] = await AppDataSource.query(
      `SELECT r.conversionId, r.orderExternalId, r.affiliateId, r.programId, r.orderAmount, r.discountAmount, r.occurredAt, v.status, v.metadata
         FROM organization_coupon_redemptions r JOIN conversions v ON v.id = r.conversionId
        WHERE r.organizationId = ? AND r.couponId = ? ORDER BY r.occurredAt DESC LIMIT 10`,
      [organizationId, coupon.id],
    );

    const maxRedemptions = coupon.maxRedemptions || null;
    const attributed = s?.attributed ?? 0;
    return {
      coupon: this.decorate(coupon, usage),
      metrics: {
        redemptions: s?.redemptions ?? 0,
        conversions: attributed,
        revenue: (s?.gross ?? 0) / 100,
        discount: (s?.discount ?? 0) / 100,
        commission: (s?.commission ?? 0) / 100,
        netRevenue: (s?.paid ?? 0) / 100,
        aov: attributed > 0 ? Math.round((s?.gross ?? 0) / attributed) / 100 : 0,
        usagePercentage: maxRedemptions ? Math.min(100, Math.round((used / maxRedemptions) * 100)) : 0,
        remainingRedemptions: maxRedemptions ? Math.max(0, maxRedemptions - used) : null,
        maxRedemptions,
      },
      redemptionsTrend: [...days.values()]
        .sort((a, b) => String(a.key).localeCompare(String(b.key)))
        .map((d) => ({ date: d.key, redemptions: d.redemptions, revenue: d.gross / 100 })),
      recentConversions: recent.map((r) => {
        const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : r.metadata || {};
        const affiliate = dbStore.affiliates.find((a) => a.id === r.affiliateId);
        const program = dbStore.programs.find((p) => p.id === r.programId);
        return {
          id: r.conversionId,
          orderId: r.orderExternalId,
          customerEmail: typeof meta.customerEmail === 'string' ? meta.customerEmail : null,
          amount: Number(r.orderAmount) / 100,
          discountAmount: Number(r.discountAmount) / 100,
          status: r.status,
          affiliateName: affiliate?.displayName || 'No affiliate credited',
          programName: program?.name || null,
          occurredAt: r.occurredAt,
        };
      }),
      activity: this.getActivityLog(organizationId, couponId),
    };
  }

  /**
   * Admin "Validate Code" tool (D13): authenticated, coupons.view, organization-scoped, rate-limited at the
   * controller. It deliberately explains *why* a code is not usable (the same user can list every coupon), but
   * never returns assigned affiliates or their emails.
   */
  async validateCouponCode(organizationId: string, code: string) {
    this.assertCouponsEnabled(organizationId);
    await loadOrganizationTimezone(organizationId);
    if (!code?.trim()) {
      return { isValid: false, reason: 'Coupon code is required.', coupon: null };
    }
    const normalized = normalizeCode(code);
    const coupon = dbStore.organizationCoupons.find((c) => c.organizationId === organizationId && c.normalizedCode === normalized);
    if (!coupon) {
      return { isValid: false, reason: `Coupon code "${normalized}" does not exist.`, coupon: null };
    }
    const used = (await this.usageMap(organizationId, [coupon.id])).get(coupon.id) ?? 0;
    const view = this.validationView(coupon, used);
    if (coupon.status !== 'ACTIVE') {
      return { isValid: false, reason: `Coupon "${coupon.code}" is currently ${coupon.status.toLowerCase()}.`, coupon: view };
    }
    const now = Date.now();
    if (coupon.validFrom && new Date(coupon.validFrom).getTime() > now) {
      return { isValid: false, reason: `Coupon "${coupon.code}" is not yet active (starts ${localDateString(coupon.validFrom, organizationId)}).`, coupon: view };
    }
    if (coupon.validUntil && new Date(coupon.validUntil).getTime() + 1000 <= now) {
      return { isValid: false, reason: `Coupon "${coupon.code}" expired on ${localDateString(coupon.validUntil, organizationId)}.`, coupon: view };
    }
    if (coupon.maxRedemptions && used >= coupon.maxRedemptions) {
      return { isValid: false, reason: `Coupon "${coupon.code}" has reached its maximum redemption limit (${coupon.maxRedemptions}).`, coupon: view };
    }
    return { isValid: true, reason: 'Valid and active coupon.', coupon: view };
  }

  private validationView(coupon: CouponRow, used: number) {
    return {
      id: coupon.id,
      code: coupon.code,
      name: coupon.name,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: Number(coupon.discountValue),
      status: coupon.status,
      maxRedemptions: coupon.maxRedemptions ?? null,
      validFrom: coupon.validFrom,
      validUntil: coupon.validUntil,
      currentRedemptions: used,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  private async usageMap(organizationId: string, couponIds?: string[]): Promise<Map<string, number>> {
    if (couponIds && couponIds.length === 0) return new Map();
    await initializeDataSource();
    const rows: Array<{ couponId: string; n: number }> = couponIds
      ? await AppDataSource.query(`SELECT couponId, COUNT(*) n FROM organization_coupon_redemptions WHERE organizationId = ? AND couponId IN (?) GROUP BY couponId`, [organizationId, couponIds])
      : await AppDataSource.query(`SELECT couponId, COUNT(*) n FROM organization_coupon_redemptions WHERE organizationId = ? GROUP BY couponId`, [organizationId]);
    return new Map(rows.map((r) => [r.couponId, Number(r.n)]));
  }

  private resolveDateRange(period?: string, dateFrom?: string, dateTo?: string): { startDate?: Date; endDate?: Date } {
    if (dateFrom || dateTo) {
      const startDate = dateFrom ? new Date(dateFrom) : undefined;
      const endDate = dateTo ? new Date(dateTo) : undefined;
      if ((startDate && Number.isNaN(startDate.getTime())) || (endDate && Number.isNaN(endDate.getTime()))) {
        throw new BadRequestException('dateFrom/dateTo must be valid dates.');
      }
      return { startDate, endDate };
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

  private snapshot(coupon: CouponRow) {
    return {
      code: coupon.code,
      name: coupon.name,
      description: coupon.description ?? null,
      discountType: coupon.discountType,
      discountValue: Number(coupon.discountValue),
      status: coupon.status,
      maxRedemptions: coupon.maxRedemptions ?? null,
      maxRedemptionsPerCustomer: coupon.maxRedemptionsPerCustomer ?? null,
      validFrom: coupon.validFrom ? new Date(coupon.validFrom).toISOString() : null,
      validUntil: coupon.validUntil ? new Date(coupon.validUntil).toISOString() : null,
    };
  }

  private decorate(coupon: CouponRow, usage: Map<string, number>) {
    const assignments = dbStore.organizationCouponAssignments.filter((item) => item.couponId === coupon.id);
    const used = usage.get(coupon.id) ?? 0;
    const expired = coupon.status !== 'ARCHIVED' && Boolean(coupon.validUntil) && new Date(coupon.validUntil as any).getTime() + 1000 <= Date.now();
    return {
      id: coupon.id,
      organizationId: coupon.organizationId,
      code: coupon.code,
      name: coupon.name,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: Number(coupon.discountValue),
      status: coupon.status,
      effectiveStatus: expired ? 'EXPIRED' : coupon.status,
      maxRedemptions: coupon.maxRedemptions,
      maxRedemptionsPerCustomer: coupon.maxRedemptionsPerCustomer ?? null,
      redemptionsCount: used,
      remainingRedemptions: coupon.maxRedemptions ? Math.max(0, coupon.maxRedemptions - used) : null,
      validFrom: coupon.validFrom,
      validUntil: coupon.validUntil,
      // calendar days in the organization's timezone (what the date pickers edit)
      validFromDate: localDateString(coupon.validFrom, coupon.organizationId),
      validUntilDate: localDateString(coupon.validUntil, coupon.organizationId),
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
