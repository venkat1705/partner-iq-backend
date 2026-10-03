import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Organization coupons audit (docs/coupons-audit.md, decisions D5–D9):
 * - `organization_coupon_redemptions`: one row per sale on which a coupon was accepted, with the discount,
 *   paid amount, credited affiliate/program and customer keys captured at sale time. Unique per conversion and
 *   per (organization, environment, order id) so the same order can never use a coupon twice.
 * - `organization_coupon_usage`: per-coupon use counter whose row is locked while a use is recorded, so usage
 *   limits are enforced by MySQL under concurrency.
 * - `organization_coupons.discountValue` int → decimal(12,2) (12.5 % or ₹99.50) — widening, lossless.
 * - `organization_coupons.maxRedemptionsPerCustomer` (nullable).
 * - Unique (organizationId, normalizedCode): the entity already declares it, but no migration created it
 *   (the table only ever came from `synchronize`). Added under a known name only when no equivalent unique
 *   index exists; fails loudly (instead of deleting anything) if duplicate codes are present.
 *
 * Column types mirror what TypeORM's schema sync produces for the entities (uuid → varchar(255)) so a later
 * `synchronize` never rebuilds these columns.
 *
 * Every step is idempotent. `down` reverses exactly what `up` can have added and refuses to narrow
 * discountValue back to int while fractional values exist (that would lose data).
 */
export class CouponRedemptionLedger2026100300000 implements MigrationInterface {
  name = 'CouponRedemptionLedger2026100300000';

  private async hasTable(q: QueryRunner, table: string) {
    const rows: unknown[] = await q.query(
      `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return rows.length > 0;
  }

  private async hasColumn(q: QueryRunner, table: string, column: string) {
    const rows: unknown[] = await q.query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return rows.length > 0;
  }

  private async columnType(q: QueryRunner, table: string, column: string): Promise<string | undefined> {
    const rows: Array<{ DATA_TYPE: string }> = await q.query(
      `SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return rows[0]?.DATA_TYPE;
  }

  /** Name of a UNIQUE index on exactly (organizationId, normalizedCode), if any. */
  private async uniqueCodeIndex(q: QueryRunner): Promise<string | undefined> {
    const rows: Array<{ INDEX_NAME: string; cols: string }> = await q.query(
      `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_coupons' AND NON_UNIQUE = 0
        GROUP BY INDEX_NAME`,
    );
    return rows.find((r) => r.cols === 'organizationId,normalizedCode')?.INDEX_NAME;
  }

  async up(q: QueryRunner): Promise<void> {
    if (!(await this.hasTable(q, 'organization_coupons'))) {
      throw new Error('organization_coupons does not exist yet; start the app once (schema sync) before this migration.');
    }

    if (!(await this.uniqueCodeIndex(q))) {
      const dups: Array<{ organizationId: string; normalizedCode: string; n: number }> = await q.query(
        `SELECT organizationId, normalizedCode, COUNT(*) n FROM organization_coupons
          GROUP BY organizationId, normalizedCode HAVING COUNT(*) > 1`,
      );
      if (dups.length) {
        throw new Error(
          `Cannot add UNIQUE (organizationId, normalizedCode): ${dups.length} duplicate code(s) exist, e.g. ` +
            `${dups.slice(0, 5).map((d) => `${d.organizationId}/${d.normalizedCode} x${d.n}`).join(', ')}. ` +
            'Resolve them manually; this migration never deletes coupons.',
        );
      }
      await q.query(`ALTER TABLE organization_coupons ADD CONSTRAINT UQ_org_coupon_org_normcode UNIQUE (organizationId, normalizedCode)`);
    }

    if ((await this.columnType(q, 'organization_coupons', 'discountValue')) !== 'decimal') {
      await q.query(`ALTER TABLE organization_coupons MODIFY discountValue decimal(12,2) NOT NULL`);
    }
    if (!(await this.hasColumn(q, 'organization_coupons', 'maxRedemptionsPerCustomer'))) {
      await q.query(`ALTER TABLE organization_coupons ADD COLUMN maxRedemptionsPerCustomer int NULL`);
    }

    if (!(await this.hasTable(q, 'organization_coupon_redemptions'))) {
      await q.query(`
        CREATE TABLE organization_coupon_redemptions (
          id varchar(36) NOT NULL,
          organizationId varchar(255) NOT NULL,
          environment varchar(10) NOT NULL DEFAULT 'LIVE',
          couponId varchar(255) NOT NULL,
          couponCode varchar(60) NOT NULL,
          conversionId varchar(36) NOT NULL,
          orderExternalId varchar(255) NOT NULL,
          affiliateId varchar(36) NULL,
          programId varchar(36) NULL,
          customerKey varchar(300) NOT NULL,
          customerEmailKey varchar(300) NULL,
          orderAmount int NOT NULL,
          discountAmount int NOT NULL,
          grossAmount int NOT NULL,
          currency varchar(10) NOT NULL,
          discountType varchar(30) NOT NULL,
          discountValue decimal(12,2) NOT NULL,
          refundedAmount int NOT NULL DEFAULT 0,
          status varchar(30) NOT NULL DEFAULT 'ACTIVE',
          occurredAt datetime(3) NOT NULL,
          createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          PRIMARY KEY (id),
          UNIQUE KEY UQ_coupon_redemption_conversion (conversionId),
          UNIQUE KEY UQ_coupon_redemption_order (organizationId, environment, orderExternalId),
          KEY IDX_coupon_redemption_org (organizationId),
          KEY IDX_coupon_redemption_org_created (organizationId, createdAt),
          KEY IDX_coupon_redemption_coupon (couponId),
          KEY IDX_coupon_redemption_coupon_customer (couponId, customerKey),
          KEY IDX_coupon_redemption_coupon_email (couponId, customerEmailKey),
          KEY IDX_coupon_redemption_affiliate (affiliateId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await this.hasTable(q, 'organization_coupon_usage'))) {
      await q.query(`
        CREATE TABLE organization_coupon_usage (
          couponId varchar(36) NOT NULL,
          organizationId varchar(36) NOT NULL,
          redemptionCount int NOT NULL DEFAULT 0,
          updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          PRIMARY KEY (couponId),
          KEY IDX_coupon_usage_org (organizationId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    // All refusal checks run before any change, so a refused revert leaves the schema exactly as it was.
    const hasRedemptions = await this.hasTable(q, 'organization_coupon_redemptions');
    if (hasRedemptions) {
      const [{ n }]: Array<{ n: number }> = await q.query(`SELECT COUNT(*) n FROM organization_coupon_redemptions`);
      if (Number(n) > 0) {
        throw new Error(
          `organization_coupon_redemptions holds ${n} recorded coupon use(s); export or archive them before reverting ` +
            '(dropping the table would lose sale history).',
        );
      }
    }
    const hasPerCustomer = await this.hasColumn(q, 'organization_coupons', 'maxRedemptionsPerCustomer');
    if (hasPerCustomer) {
      const [{ n }]: Array<{ n: number }> = await q.query(
        `SELECT COUNT(*) n FROM organization_coupons WHERE maxRedemptionsPerCustomer IS NOT NULL`,
      );
      if (Number(n) > 0) {
        throw new Error(`${n} coupon(s) use maxRedemptionsPerCustomer; clear them before reverting (would lose limits).`);
      }
    }
    const isDecimal = (await this.columnType(q, 'organization_coupons', 'discountValue')) === 'decimal';
    if (isDecimal) {
      const [{ n }]: Array<{ n: number }> = await q.query(
        `SELECT COUNT(*) n FROM organization_coupons WHERE discountValue <> FLOOR(discountValue)`,
      );
      if (Number(n) > 0) {
        throw new Error(`${n} coupon(s) have fractional discountValue; converting back to int would lose data.`);
      }
    }

    if (await this.hasTable(q, 'organization_coupon_usage')) {
      await q.query(`DROP TABLE organization_coupon_usage`);
    }
    if (hasRedemptions) {
      await q.query(`DROP TABLE organization_coupon_redemptions`);
    }
    if (hasPerCustomer) {
      await q.query(`ALTER TABLE organization_coupons DROP COLUMN maxRedemptionsPerCustomer`);
    }
    if (isDecimal) {
      await q.query(`ALTER TABLE organization_coupons MODIFY discountValue int NOT NULL`);
    }
    if ((await this.uniqueCodeIndex(q)) === 'UQ_org_coupon_org_normcode') {
      await q.query(`ALTER TABLE organization_coupons DROP INDEX UQ_org_coupon_org_normcode`);
    }
  }
}
