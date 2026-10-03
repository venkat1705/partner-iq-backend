import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { EntityManager } from 'typeorm';
import { AppDataSource, initializeDataSource } from '../../database/data-source';
import { dbStore } from '../../database/store';
import { AffiliateStatus } from '../../common/enums';
import {
  couponCodeFromMetadata,
  customerKeys,
  discountBreakdown,
  isWithinWindow,
} from './coupon-rules';

/** Why a coupon was not applied to a sale (returned to the merchant, never to the shopper). */
export type CouponRefusal =
  | 'COUPONS_DISABLED'
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'LIMIT_REACHED'
  | 'CUSTOMER_LIMIT_REACHED'
  | 'DUPLICATE_ORDER';

export interface SaleCouponInput {
  organizationId: string;
  environment: string;
  conversionId: string;
  orderExternalId: string;
  customerExternalId: string;
  metadata?: Record<string, unknown>;
  /** Amount paid after the discount, minor units. */
  amount: number;
  currency: string;
  occurredAt: Date;
  /** Program the sale resolved to before coupon attribution. */
  programId: string;
  /** Affiliate from click/cookie attribution, if any. */
  clickAffiliateId?: string;
}

export interface SaleCouponOutcome {
  code: string;
  applied: boolean;
  reason?: CouponRefusal;
  couponId?: string;
  redemptionId?: string;
  /** Affiliate / program that receive credit for the sale (undefined = keep the caller's own resolution). */
  creditAffiliateId?: string | null;
  creditProgramId?: string;
  discountAmount?: number;
  grossAmount?: number;
}

/** Public, merchant-facing view returned in the POST /conversions response. */
export const couponOutcomeView = (o?: SaleCouponOutcome) =>
  o
    ? {
        code: o.code,
        applied: o.applied,
        ...(o.reason ? { reason: o.reason } : {}),
        ...(o.applied
          ? { couponId: o.couponId, discountAmount: o.discountAmount, grossAmount: o.grossAmount, affiliateId: o.creditAffiliateId ?? null }
          : {}),
      }
    : null;

const LOCK_WAIT_SECONDS = 5;

/**
 * Records organization-coupon uses at sale time (D7). The usage counter row is locked with SELECT … FOR UPDATE
 * inside a MySQL transaction, so total and per-customer limits hold under concurrent requests and across
 * backend instances. Uses are stored through TypeORM repositories (not dbStore): a failed write fails the call.
 */
@Injectable()
export class CouponRedemptionService {
  private readonly logger = new Logger(CouponRedemptionService.name);

  private couponsEnabled(organizationId: string) {
    const settings = dbStore.organizationCouponSettings.find((s) => s.organizationId === organizationId);
    return settings ? settings.couponsEnabled : true;
  }

  /** The single ACTIVE affiliate a coupon is assigned to (coupon attribution needs exactly one). */
  couponAffiliateId(couponId: string, organizationId: string): string | undefined {
    const ids = dbStore.organizationCouponAssignments
      .filter((a) => a.couponId === couponId && a.organizationId === organizationId)
      .map((a) => a.affiliateId)
      .filter((id) => dbStore.affiliates.some((af) => af.id === id && af.organizationId === organizationId && af.status === AffiliateStatus.ACTIVE));
    return ids.length === 1 ? ids[0] : undefined;
  }

  /** Program for the credited affiliate: the sale's program if they are enrolled in it, else their earliest active enrollment. */
  private creditProgram(organizationId: string, affiliateId: string, programId: string) {
    const enrollments = dbStore.programAffiliates
      .filter((pa) => pa.organizationId === organizationId && pa.affiliateId === affiliateId)
      .filter((pa) => !pa.status || String(pa.status).toUpperCase() === 'ACTIVE' || String(pa.status).toUpperCase() === 'APPROVED');
    if (enrollments.some((pa) => pa.programId === programId)) return programId;
    const first = [...enrollments].sort((a, b) => new Date(a.joinedAt as any).getTime() - new Date(b.joinedAt as any).getTime())[0];
    return first?.programId || programId;
  }

  /**
   * Decides whether the sale's coupon applies and, if so, records the use atomically.
   * Returns undefined when the sale carries no coupon code.
   */
  async reserveForSale(input: SaleCouponInput): Promise<SaleCouponOutcome | undefined> {
    const code = couponCodeFromMetadata(input.metadata);
    if (!code) return undefined;
    const refuse = (reason: CouponRefusal, couponId?: string): SaleCouponOutcome => ({ code, applied: false, reason, couponId });

    if (!this.couponsEnabled(input.organizationId)) return refuse('COUPONS_DISABLED');
    const coupon = dbStore.organizationCoupons.find((c) => c.organizationId === input.organizationId && c.normalizedCode === code);
    if (!coupon) return refuse('NOT_FOUND');
    if (coupon.status !== 'ACTIVE') return refuse('INACTIVE', coupon.id);
    const window = isWithinWindow(coupon, input.occurredAt);
    if (window !== 'OK') return refuse(window, coupon.id);

    // Credit (K): program setting "Collision Priority". PROMO_CODE (default) and LAST_CLICK credit the coupon's
    // affiliate (entering the code at checkout is the last touch); AFFILIATE keeps the click affiliate.
    const program = dbStore.programs.find((p) => p.id === input.programId);
    const priority = (program as any)?.couponAttributionPriority || 'PROMO_CODE';
    const couponAffiliate = this.couponAffiliateId(coupon.id, input.organizationId);
    const creditAffiliateId = priority === 'AFFILIATE'
      ? input.clickAffiliateId ?? couponAffiliate ?? null
      : couponAffiliate ?? input.clickAffiliateId ?? null;
    const creditProgramId = creditAffiliateId ? this.creditProgram(input.organizationId, creditAffiliateId, input.programId) : input.programId;

    const subtotal = typeof input.metadata?.orderSubtotal === 'number' ? (input.metadata.orderSubtotal as number) : undefined;
    const money = discountBreakdown(coupon, input.amount, subtotal);
    const keys = customerKeys(input.customerExternalId, input.metadata);

    await initializeDataSource();
    // InnoDB may pick a deadlock victim when many checkouts hit one coupon at once; retry that case only.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.reserveOnce(input, coupon, code, keys, money, creditAffiliateId, creditProgramId);
      } catch (err: any) {
        if (err?.code === 'ER_LOCK_DEADLOCK' && attempt < 5) {
          await new Promise((r) => setTimeout(r, 20 * attempt + Math.floor(Math.random() * 20)));
          continue;
        }
        if (err?.code === 'ER_DUP_ENTRY') return refuse('DUPLICATE_ORDER', coupon.id);
        this.logger.error(`Coupon use for ${input.orderExternalId} could not be recorded: ${err?.code || ''} ${err?.message || err}`);
        throw new ServiceUnavailableException('The coupon use could not be recorded; the sale was not saved. Retry the request.');
      }
    }
  }

  private async reserveOnce(
    input: SaleCouponInput,
    coupon: (typeof dbStore.organizationCoupons)[number],
    code: string,
    keys: ReturnType<typeof customerKeys>,
    money: ReturnType<typeof discountBreakdown>,
    creditAffiliateId: string | null,
    creditProgramId: string,
  ): Promise<SaleCouponOutcome> {
    const refuse = (reason: CouponRefusal): SaleCouponOutcome => ({ code, applied: false, reason, couponId: coupon.id });
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    try {
      await qr.query(`SET SESSION innodb_lock_wait_timeout = ${LOCK_WAIT_SECONDS}, lock_wait_timeout = ${LOCK_WAIT_SECONDS}`);
      await qr.startTransaction();
      const m: EntityManager = qr.manager;
      // exclusive lock on the counter row from the first statement (an INSERT IGNORE would take a shared lock
      // and deadlock against concurrent FOR UPDATE readers)
      await m.query(
        `INSERT INTO organization_coupon_usage (couponId, organizationId, redemptionCount) VALUES (?, ?, 0)
           ON DUPLICATE KEY UPDATE redemptionCount = redemptionCount`,
        [coupon.id, input.organizationId],
      );
      const [usage] = await m.query(`SELECT redemptionCount FROM organization_coupon_usage WHERE couponId = ? FOR UPDATE`, [coupon.id]);
      const used = Number(usage?.redemptionCount ?? 0);
      if (coupon.maxRedemptions && used >= coupon.maxRedemptions) {
        await qr.rollbackTransaction();
        return refuse('LIMIT_REACHED');
      }
      if (coupon.maxRedemptionsPerCustomer) {
        const [row] = await m.query(
          `SELECT COUNT(*) n FROM organization_coupon_redemptions WHERE couponId = ? AND (customerKey = ? OR (? IS NOT NULL AND customerEmailKey = ?))`,
          [coupon.id, keys.customerKey, keys.customerEmailKey, keys.customerEmailKey],
        );
        if (Number(row?.n ?? 0) >= coupon.maxRedemptionsPerCustomer) {
          await qr.rollbackTransaction();
          return refuse('CUSTOMER_LIMIT_REACHED');
        }
      }
      const redemptionId = uuidv4();
      await m.query(
        `INSERT INTO organization_coupon_redemptions
          (id, organizationId, environment, couponId, couponCode, conversionId, orderExternalId, affiliateId, programId,
           customerKey, customerEmailKey, orderAmount, discountAmount, grossAmount, currency, discountType, discountValue, status, occurredAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        [redemptionId, input.organizationId, String(input.environment).toUpperCase(), coupon.id, coupon.code, input.conversionId, input.orderExternalId,
          creditAffiliateId, creditProgramId, keys.customerKey, keys.customerEmailKey, money.orderAmount, money.discountAmount, money.grossAmount,
          input.currency, coupon.discountType, Number(coupon.discountValue), input.occurredAt],
      );
      await m.query(`UPDATE organization_coupon_usage SET redemptionCount = redemptionCount + 1 WHERE couponId = ?`, [coupon.id]);
      await qr.commitTransaction();
      return {
        code,
        applied: true,
        couponId: coupon.id,
        redemptionId,
        creditAffiliateId,
        creditProgramId,
        discountAmount: money.discountAmount,
        grossAmount: money.grossAmount,
      };
    } catch (err) {
      if (qr.isTransactionActive) await qr.rollbackTransaction().catch(() => undefined);
      throw err;
    } finally {
      await qr.query('SET SESSION innodb_lock_wait_timeout = DEFAULT, lock_wait_timeout = DEFAULT').catch(() => undefined);
      await qr.release();
    }
  }

  /** Undo a reservation when the sale itself could not be saved afterwards. */
  async release(outcome: SaleCouponOutcome | undefined) {
    if (!outcome?.applied || !outcome.redemptionId || !outcome.couponId) return;
    await AppDataSource.transaction(async (m) => {
      const res: any = await m.query(`DELETE FROM organization_coupon_redemptions WHERE id = ?`, [outcome.redemptionId]);
      if (Number(res?.affectedRows ?? 0) > 0) {
        await m.query(`UPDATE organization_coupon_usage SET redemptionCount = GREATEST(redemptionCount - 1, 0) WHERE couponId = ?`, [outcome.couponId]);
      }
    });
  }

  /** Refunds never give the use back (D7); the row records how much of the sale was refunded. */
  async recordRefund(conversionId: string, totalRefunded: number, fullyRefunded: boolean) {
    await initializeDataSource();
    await AppDataSource.query(
      `UPDATE organization_coupon_redemptions SET refundedAmount = ?, status = ? WHERE conversionId = ?`,
      [totalRefunded, fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED', conversionId],
    );
  }

  /** Uses recorded per coupon (organization scoped). */
  async usageCounts(organizationId: string, couponIds?: string[]): Promise<Map<string, number>> {
    await initializeDataSource();
    const rows: Array<{ couponId: string; n: number }> = couponIds?.length
      ? await AppDataSource.query(`SELECT couponId, COUNT(*) n FROM organization_coupon_redemptions WHERE organizationId = ? AND couponId IN (?) GROUP BY couponId`, [organizationId, couponIds])
      : await AppDataSource.query(`SELECT couponId, COUNT(*) n FROM organization_coupon_redemptions WHERE organizationId = ? GROUP BY couponId`, [organizationId]);
    return new Map(rows.map((r) => [r.couponId, Number(r.n)]));
  }
}
