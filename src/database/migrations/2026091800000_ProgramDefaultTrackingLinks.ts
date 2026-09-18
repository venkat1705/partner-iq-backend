import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a second, auto-generated "program default" tracking link per affiliate,
 * distinct from the free-form custom links (alias/campaign/sub-ID) affiliates
 * already create by hand.
 *
 * `linkKind` tags which kind a row is ('CUSTOM' for everything that already
 * exists, 'PROGRAM_DEFAULT' for the new one-per-program-per-affiliate link).
 * `affiliateProgramDefaultKey` is only ever populated for PROGRAM_DEFAULT rows
 * (application code sets it to `${organizationId}:${environment}:${programId}:${affiliateId}`);
 * custom links leave it NULL. A unique index on that column then prevents two
 * PROGRAM_DEFAULT rows for the same affiliate+program under concurrent
 * requests, while leaving custom links unconstrained — MySQL unique indexes
 * permit unlimited NULLs, since NULL is never equal to NULL.
 *
 * Both columns are plain, entity-mapped columns (not DB-computed) because
 * AppDataSource runs with `synchronize: true`; a column TypeORM doesn't know
 * about from entity metadata risks being fought or dropped on the next sync.
 */
export class ProgramDefaultTrackingLinks2026091800000 implements MigrationInterface {
  name = 'ProgramDefaultTrackingLinks2026091800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const columns = [
      `ALTER TABLE tracking_links ADD COLUMN IF NOT EXISTS linkKind varchar(30) NOT NULL DEFAULT 'CUSTOM'`,
      `ALTER TABLE tracking_links ADD COLUMN IF NOT EXISTS affiliateProgramDefaultKey varchar(160) NULL`,
    ];
    for (const sql of columns) {
      try {
        await queryRunner.query(sql);
      } catch (e) {
        // Column may already exist
      }
    }

    try {
      await queryRunner.query(`
        ALTER TABLE tracking_links
        ADD UNIQUE INDEX uq_tracking_links_program_default (affiliateProgramDefaultKey)
      `);
    } catch (e) {
      // Index may already exist
    }

    try {
      await queryRunner.query(`CREATE INDEX idx_tracking_links_linkkind ON tracking_links (linkKind)`);
    } catch (e) {
      // Index may already exist
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.query(`DROP INDEX idx_tracking_links_linkkind ON tracking_links`);
    } catch (e) {
      // ignore
    }
    try {
      await queryRunner.query(`ALTER TABLE tracking_links DROP INDEX uq_tracking_links_program_default`);
    } catch (e) {
      // ignore
    }
    const columns = ['affiliateProgramDefaultKey', 'linkKind'];
    for (const col of columns) {
      try {
        await queryRunner.query(`ALTER TABLE tracking_links DROP COLUMN ${col}`);
      } catch (e) {
        // ignore
      }
    }
  }
}
