import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `conversions.occurredAt` — when the conversion happened in the merchant's
 * system, as distinct from `createdAt`, when PartnerIQ recorded it.
 *
 * The API has always accepted `occurredAt` on conversion create, application
 * code has always written it, and every analytics bucket, date filter and CSV
 * export reads `occurredAt || createdAt`. It was simply never a column, so the
 * value lived only in the in-memory store and was lost on persist: after a
 * restart every conversion's business date silently collapsed to its recording
 * date, shifting historical revenue and conversion charts.
 *
 * Nullable with no backfill on purpose. The original values are gone, and
 * `occurredAt || createdAt` already yields the correct answer for rows that
 * predate this column — writing `createdAt` into them would only fabricate the
 * appearance of a known business date.
 */
export class ConversionOccurredAt2026092100001 implements MigrationInterface {
  name = 'ConversionOccurredAt2026092100001';

  async up(queryRunner: QueryRunner): Promise<void> {
    const existing: Array<{ COLUMN_NAME: string }> = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversions' AND COLUMN_NAME = 'occurredAt'`,
    );
    if (existing.length) return;

    await queryRunner.query(`ALTER TABLE conversions ADD COLUMN occurredAt datetime NULL AFTER notes`);
    await queryRunner.query(`CREATE INDEX idx_conversions_occurred_at ON conversions (occurredAt)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.query(`DROP INDEX idx_conversions_occurred_at ON conversions`);
    } catch {
      // Index may not exist
    }
    await queryRunner.query(`ALTER TABLE conversions DROP COLUMN occurredAt`);
  }
}
