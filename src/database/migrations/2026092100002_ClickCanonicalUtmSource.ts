import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `clicks.canonicalUtmSource` — the traffic source as configured on the
 * tracking link, recorded at click time.
 *
 * `clicks.utmSource` holds the *effective* source, which an inbound
 * `?utm_source=` on the short link overrides. That override is deliberate (it
 * lets partners tag placements per channel, and it is what gets forwarded to
 * the merchant's own analytics), but it also meant a partner could decide what
 * appeared in the organization's traffic-source breakdown simply by editing the
 * URL they shared. Source reporting now reads this column instead.
 *
 * Backfilled from `utmSource` for existing rows. That is the best available
 * approximation — the original link configuration at the time of those clicks
 * is not recoverable — and it leaves historical reporting exactly as it is
 * today rather than blanking it.
 */
export class ClickCanonicalUtmSource2026092100002 implements MigrationInterface {
  name = 'ClickCanonicalUtmSource2026092100002';

  async up(queryRunner: QueryRunner): Promise<void> {
    const existing: Array<{ COLUMN_NAME: string }> = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clicks' AND COLUMN_NAME = 'canonicalUtmSource'`,
    );
    if (existing.length) return;

    await queryRunner.query(
      `ALTER TABLE clicks ADD COLUMN canonicalUtmSource varchar(255) NULL AFTER utmContent`,
    );
    await queryRunner.query(
      `UPDATE clicks SET canonicalUtmSource = COALESCE(utmSource, 'direct') WHERE canonicalUtmSource IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_clicks_canonical_utm_source ON clicks (canonicalUtmSource)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.query(`DROP INDEX idx_clicks_canonical_utm_source ON clicks`);
    } catch {
      // Index may not exist
    }
    await queryRunner.query(`ALTER TABLE clicks DROP COLUMN canonicalUtmSource`);
  }
}
