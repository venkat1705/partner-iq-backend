import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens `affiliate_performance_summaries.periodStart` / `periodEnd` from
 * TIMESTAMP to DATETIME.
 *
 * LIFETIME summary rows use sentinel bounds of epoch 0 through year 9999, both
 * of which sit outside MySQL's TIMESTAMP range (1970-01-01 00:00:01 UTC to
 * 2038-01-19 03:14:07 UTC). With a non-UTC session timezone epoch 0 serializes
 * to a local wall-clock value below the floor, so every LIFETIME upsert failed
 * with ER_TRUNCATED_WRONG_VALUE and the click/conversion counters silently
 * stopped persisting. DATETIME spans 1000-01-01 to 9999-12-31 and holds both
 * sentinels, and — unlike TIMESTAMP — is not re-interpreted against the session
 * timezone on read.
 *
 * `periodStart` is handled defensively because `synchronize: true` may already
 * have attempted this change and made a mess of it: TypeORM converts the column
 * by dropping and re-adding it, and the re-add (`ADD periodStart datetime NOT
 * NULL` against a non-empty table) is rejected under NO_ZERO_DATE. MySQL DDL is
 * not transactional, so the DROP survives the failure and the column is simply
 * gone. Re-adding it WITH a default gives the surviving rows a legal value; the
 * default is then dropped so the column matches the entity exactly and
 * synchronize has nothing left to change.
 */
export class PerformanceSummaryPeriodDatetime2026092100000 implements MigrationInterface {
  name = 'PerformanceSummaryPeriodDatetime2026092100000';

  private static readonly TABLE = 'affiliate_performance_summaries';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = PerformanceSummaryPeriodDatetime2026092100000.TABLE;

    const present: Array<{ COLUMN_NAME: string }> = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'periodStart'`,
      [table],
    );

    if (present.length === 0) {
      await queryRunner.query(
        `ALTER TABLE ${table}
         ADD COLUMN periodStart datetime NOT NULL DEFAULT '1970-01-01 00:00:00' AFTER periodKey`,
      );
    } else {
      await queryRunner.query(
        `ALTER TABLE ${table}
         MODIFY COLUMN periodStart datetime NOT NULL DEFAULT '1970-01-01 00:00:00'`,
      );
    }

    // LIFETIME rows start at epoch; monthly rows start on the 1st of periodKey.
    await queryRunner.query(`
      UPDATE ${table}
      SET periodStart = CASE
        WHEN periodType = 'LIFETIME' THEN '1970-01-01 00:00:00'
        WHEN periodKey REGEXP '^[0-9]{4}-[0-9]{2}$' THEN CONCAT(periodKey, '-01 00:00:00')
        ELSE '1970-01-01 00:00:00'
      END
      WHERE periodStart IS NULL OR periodStart = '1970-01-01 00:00:00'
    `);

    await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN periodStart DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE ${table} MODIFY COLUMN periodEnd datetime NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = PerformanceSummaryPeriodDatetime2026092100000.TABLE;
    // Rows holding the LIFETIME sentinels cannot be narrowed back into
    // TIMESTAMP, so this is best-effort and will fail if any exist.
    await queryRunner.query(`ALTER TABLE ${table} MODIFY COLUMN periodStart timestamp NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${table} MODIFY COLUMN periodEnd timestamp NOT NULL`);
  }
}
