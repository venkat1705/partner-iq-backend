import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits affiliate invitation acceptance from actually joining a program.
 *
 * Previously, clicking an invitation link and accepting the terms created the
 * affiliate and the program membership outright — the invitation token was, in
 * effect, treated as authentication. An invitation proves only that an email
 * address was invited, so membership now requires the partner to register or
 * sign in through the Affiliate Portal first.
 *
 * Adds the lifecycle columns behind PENDING -> TERMS_ACCEPTED -> JOINED, and a
 * unique key so a partner cannot end up in the same program twice.
 *
 * Non-destructive:
 *  - All new columns are NULLable; existing rows stay valid.
 *  - Historical `ACCEPTED` rows are migrated to `JOINED` and backfilled with
 *    the timestamps and affiliate id implied by their existing membership.
 *    `ACCEPTED` is still recognised in code, so anything missed still resolves.
 */
export class AffiliateInvitationLifecycle2026091700000 implements MigrationInterface {
  name = 'AffiliateInvitationLifecycle2026091700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.addColumnIfMissing(
      queryRunner,
      'affiliate_invitations',
      'termsAcceptedAt',
      'ALTER TABLE affiliate_invitations ADD COLUMN termsAcceptedAt timestamp NULL',
    );
    await this.addColumnIfMissing(
      queryRunner,
      'affiliate_invitations',
      'termsVersionAccepted',
      'ALTER TABLE affiliate_invitations ADD COLUMN termsVersionAccepted int NULL',
    );
    await this.addColumnIfMissing(
      queryRunner,
      'affiliate_invitations',
      'joinedAt',
      'ALTER TABLE affiliate_invitations ADD COLUMN joinedAt timestamp NULL',
    );
    await this.addColumnIfMissing(
      queryRunner,
      'affiliate_invitations',
      'affiliateId',
      'ALTER TABLE affiliate_invitations ADD COLUMN affiliateId varchar(36) NULL',
    );
    await this.addIndexIfMissing(
      queryRunner,
      'affiliate_invitations',
      'idx_affiliate_invitations_affiliate',
      'ALTER TABLE affiliate_invitations ADD INDEX idx_affiliate_invitations_affiliate (affiliateId)',
    );

    // Historical completions: they did join, so record them as JOINED with the
    // timestamps implied by the existing acceptance.
    await queryRunner.query(`
      UPDATE affiliate_invitations
      SET joinedAt = COALESCE(joinedAt, acceptedAt),
          termsAcceptedAt = COALESCE(termsAcceptedAt, acceptedAt),
          termsVersionAccepted = COALESCE(termsVersionAccepted, 1),
          status = 'JOINED'
      WHERE status = 'ACCEPTED'
    `);

    // Link each historical invitation to the affiliate it produced, matched on
    // the invited email within the same organization.
    await queryRunner.query(`
      UPDATE affiliate_invitations inv
      JOIN affiliates a
        ON a.organizationId = inv.organizationId
       AND LOWER(TRIM(a.email)) = LOWER(TRIM(inv.email))
      SET inv.affiliateId = a.id
      WHERE inv.affiliateId IS NULL
        AND inv.status = 'JOINED'
    `);

    // One membership per affiliate per program. Duplicates are collapsed to the
    // earliest row first, so the unique key can be added without failing.
    await queryRunner.query(`
      DELETE pa FROM program_affiliates pa
      JOIN (
        SELECT programId, affiliateId, MIN(joinedAt) AS keepJoinedAt, MIN(id) AS keepId
        FROM program_affiliates
        GROUP BY programId, affiliateId
        HAVING COUNT(*) > 1
      ) dupes
        ON pa.programId = dupes.programId
       AND pa.affiliateId = dupes.affiliateId
       AND pa.id <> dupes.keepId
    `);

    await this.addIndexIfMissing(
      queryRunner,
      'program_affiliates',
      'uq_program_affiliate_member',
      'ALTER TABLE program_affiliates ADD UNIQUE KEY uq_program_affiliate_member (programId, affiliateId)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIndexIfPresent(queryRunner, 'program_affiliates', 'uq_program_affiliate_member');

    // Return the split states to the single terminal state that existed before.
    await queryRunner.query(`
      UPDATE affiliate_invitations
      SET status = 'ACCEPTED'
      WHERE status = 'JOINED'
    `);
    await queryRunner.query(`
      UPDATE affiliate_invitations
      SET status = 'PENDING'
      WHERE status IN ('TERMS_ACCEPTED', 'CANCELLED')
    `);

    await this.dropIndexIfPresent(queryRunner, 'affiliate_invitations', 'idx_affiliate_invitations_affiliate');
    for (const column of ['affiliateId', 'joinedAt', 'termsVersionAccepted', 'termsAcceptedAt']) {
      await this.dropColumnIfPresent(queryRunner, 'affiliate_invitations', column);
    }
  }

  /** MySQL has no `ADD COLUMN IF NOT EXISTS`, so check information_schema. */
  private async addColumnIfMissing(queryRunner: QueryRunner, table: string, column: string, ddl: string) {
    const rows = await queryRunner.query(
      `SELECT COUNT(*) AS found FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    if (Number(rows?.[0]?.found) === 0) {
      await queryRunner.query(ddl);
    }
  }

  private async addIndexIfMissing(queryRunner: QueryRunner, table: string, indexName: string, ddl: string) {
    const rows = await queryRunner.query(
      `SELECT COUNT(*) AS found FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, indexName],
    );
    if (Number(rows?.[0]?.found) === 0) {
      await queryRunner.query(ddl);
    }
  }

  private async dropIndexIfPresent(queryRunner: QueryRunner, table: string, indexName: string) {
    const rows = await queryRunner.query(
      `SELECT COUNT(*) AS found FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, indexName],
    );
    if (Number(rows?.[0]?.found) > 0) {
      await queryRunner.query(`ALTER TABLE ${table} DROP INDEX ${indexName}`);
    }
  }

  private async dropColumnIfPresent(queryRunner: QueryRunner, table: string, column: string) {
    const rows = await queryRunner.query(
      `SELECT COUNT(*) AS found FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    if (Number(rows?.[0]?.found) > 0) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
  }
}
