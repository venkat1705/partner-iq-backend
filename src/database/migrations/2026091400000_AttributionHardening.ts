import { MigrationInterface, QueryRunner } from 'typeorm';

export class AttributionHardening2026091400000 implements MigrationInterface {
  name = 'AttributionHardening2026091400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Click: capture UTM parameters + landing URL (previously not stored at all)
    const clickColumns = [
      `ALTER TABLE clicks ADD COLUMN IF NOT EXISTS landingUrl varchar(2000) NULL`,
      `ALTER TABLE clicks ADD COLUMN IF NOT EXISTS utmSource varchar(255) NULL`,
      `ALTER TABLE clicks ADD COLUMN IF NOT EXISTS utmMedium varchar(255) NULL`,
      `ALTER TABLE clicks ADD COLUMN IF NOT EXISTS utmCampaign varchar(255) NULL`,
      `ALTER TABLE clicks ADD COLUMN IF NOT EXISTS utmTerm varchar(255) NULL`,
      `ALTER TABLE clicks ADD COLUMN IF NOT EXISTS utmContent varchar(255) NULL`,
    ];
    for (const sql of clickColumns) {
      try {
        await queryRunner.query(sql);
      } catch (e) {
        // Column may already exist
      }
    }

    // 2. Attribution: index expiresAt for efficient expiry lookups
    try {
      await queryRunner.query(`CREATE INDEX idx_attributions_expiresAt ON attributions (expiresAt)`);
    } catch (e) {
      // Index may already exist
    }

    // 3. Conversion: click-id-primary attribution fields + partial refund tracking
    const conversionColumns = [
      `ALTER TABLE conversions ADD COLUMN IF NOT EXISTS clickId varchar(36) NULL`,
      `ALTER TABLE conversions ADD COLUMN IF NOT EXISTS resolvedAttributionId varchar(36) NULL`,
      `ALTER TABLE conversions ADD COLUMN IF NOT EXISTS refundedAmount int NOT NULL DEFAULT 0`,
      `ALTER TABLE conversions ADD COLUMN IF NOT EXISTS refundHistory json NULL`,
    ];
    for (const sql of conversionColumns) {
      try {
        await queryRunner.query(sql);
      } catch (e) {
        // Column may already exist
      }
    }
    try {
      await queryRunner.query(`CREATE INDEX idx_conversions_clickId ON conversions (clickId)`);
    } catch (e) {
      // Index may already exist
    }
    try {
      await queryRunner.query(`CREATE INDEX idx_conversions_resolvedAttributionId ON conversions (resolvedAttributionId)`);
    } catch (e) {
      // Index may already exist
    }

    // 3b. Commission: track cumulative reversed amount to support proportional partial refunds
    try {
      await queryRunner.query(`ALTER TABLE commissions ADD COLUMN IF NOT EXISTS reversedAmount int NOT NULL DEFAULT 0`);
    } catch (e) {
      // Column may already exist
    }

    // 4. TrackingLink.shortCode: was globally unique across ALL organizations (a naming-collision
    //    and cross-tenant scalability bug). Re-scope uniqueness to (organizationId, environment, shortCode).
    try {
      const existingIndexes: Array<{ INDEX_NAME: string; NON_UNIQUE: number }> = await queryRunner.query(`
        SELECT DISTINCT INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tracking_links' AND COLUMN_NAME = 'shortCode'
      `);
      for (const idx of existingIndexes) {
        if (idx.INDEX_NAME === 'PRIMARY') continue;
        if (Number(idx.NON_UNIQUE) === 0) {
          try {
            await queryRunner.query(`ALTER TABLE tracking_links DROP INDEX \`${idx.INDEX_NAME}\``);
          } catch (e) {
            // Best-effort; index may be composite/shared or already removed
          }
        }
      }
    } catch (e) {
      // information_schema lookup unsupported on this engine; skip
    }

    try {
      await queryRunner.query(`
        ALTER TABLE tracking_links
        ADD UNIQUE INDEX uq_tracking_links_org_env_shortcode (organizationId, environment, shortCode)
      `);
    } catch (e) {
      // Constraint may already exist, or a duplicate shortCode across orgs still exists
      // (pre-existing data collision) and needs manual remediation before this can apply.
    }

    try {
      await queryRunner.query(`CREATE INDEX idx_tracking_links_shortcode ON tracking_links (shortCode)`);
    } catch (e) {
      // Index may already exist
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.query(`ALTER TABLE commissions DROP COLUMN reversedAmount`);
    } catch (e) {
      // ignore
    }
    try {
      await queryRunner.query(`ALTER TABLE tracking_links DROP INDEX uq_tracking_links_org_env_shortcode`);
    } catch (e) {
      // ignore
    }
    try {
      await queryRunner.query(`DROP INDEX idx_tracking_links_shortcode ON tracking_links`);
    } catch (e) {
      // ignore
    }
    try {
      await queryRunner.query(`DROP INDEX idx_conversions_resolvedAttributionId ON conversions`);
    } catch (e) {
      // ignore
    }
    try {
      await queryRunner.query(`DROP INDEX idx_conversions_clickId ON conversions`);
    } catch (e) {
      // ignore
    }
    const conversionColumns = ['clickId', 'resolvedAttributionId', 'refundedAmount', 'refundHistory'];
    for (const col of conversionColumns) {
      try {
        await queryRunner.query(`ALTER TABLE conversions DROP COLUMN ${col}`);
      } catch (e) {
        // ignore
      }
    }
    try {
      await queryRunner.query(`DROP INDEX idx_attributions_expiresAt ON attributions`);
    } catch (e) {
      // ignore
    }
    const clickColumns = ['landingUrl', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent'];
    for (const col of clickColumns) {
      try {
        await queryRunner.query(`ALTER TABLE clicks DROP COLUMN ${col}`);
      } catch (e) {
        // ignore
      }
    }
  }
}
