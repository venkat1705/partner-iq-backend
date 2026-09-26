import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the columns the program create/edit wizard already collects but the
 * `programs` table had no storage for, so they were being silently dropped
 * instead of persisted:
 * - `termsContent` (text nullable)
 * - `termsUrl` (varchar(1000) nullable)
 * - `privacyPolicyUrl` (varchar(1000) nullable)
 * - `promotionRules` (JSON-as-text nullable — allowPaidAds/allowCouponSites/etc.)
 * - `allowedAffiliateTypes` (JSON-as-text nullable array)
 * - `customRules` (JSON-as-text nullable array — commission engine rules)
 * - `tierOverrides` (JSON-as-text nullable array — per-program tier commission
 *   overrides referencing existing organization-level partner tiers)
 * - `featured` (boolean, default false — org-controlled marketplace badge)
 */
export class ProgramPolicyAndOverrideColumns2026092500000 implements MigrationInterface {
  name = 'ProgramPolicyAndOverrideColumns2026092500000';

  private readonly textColumns: Array<{ name: string; ddl: string }> = [
    { name: 'termsContent', ddl: 'text NULL' },
    { name: 'termsUrl', ddl: 'varchar(1000) NULL' },
    { name: 'privacyPolicyUrl', ddl: 'varchar(1000) NULL' },
    { name: 'promotionRules', ddl: 'text NULL' },
    { name: 'allowedAffiliateTypes', ddl: 'text NULL' },
    { name: 'customRules', ddl: 'text NULL' },
    { name: 'tierOverrides', ddl: 'text NULL' },
  ];

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const col of this.textColumns) {
      const exists: Array<{ COLUMN_NAME: string }> = await queryRunner.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'programs' AND COLUMN_NAME = '${col.name}'`,
      );
      if (!exists.length) {
        await queryRunner.query(`ALTER TABLE programs ADD COLUMN ${col.name} ${col.ddl}`);
      }
    }

    const hasFeatured: Array<{ COLUMN_NAME: string }> = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'programs' AND COLUMN_NAME = 'featured'`,
    );
    if (!hasFeatured.length) {
      await queryRunner.query(
        `ALTER TABLE programs ADD COLUMN featured tinyint(1) NOT NULL DEFAULT 0`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const cols = [...this.textColumns.map((c) => c.name), 'featured'];
    for (const col of cols) {
      try {
        await queryRunner.query(`ALTER TABLE programs DROP COLUMN ${col}`);
      } catch {
        // Column might not exist
      }
    }
  }
}
