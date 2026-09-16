import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Evidence that a user accepted PartnerIQ's legal documents.
 *
 * Before this table, the signup form's consent checkbox was validated in the
 * browser and then discarded — nothing about a user's acceptance was ever
 * persisted, so there was no record that anyone had agreed to anything.
 *
 * Modelled as an append-only audit trail rather than a boolean column on
 * `users`, because consent must survive document revisions: when a policy
 * version changes, the old acceptance stays on record, and the *absence* of a
 * row for the new version is what makes stale consent detectable.
 *
 * Non-destructive: creates one new table and touches nothing else. Accounts
 * that registered before this migration simply have no rows, which is accurate
 * — their acceptance genuinely was not recorded, and they will be reported as
 * having outstanding documents.
 */
export class CreateUserLegalAcceptances2026091600000 implements MigrationInterface {
  name = 'CreateUserLegalAcceptances2026091600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_legal_acceptances (
        id varchar(36) NOT NULL PRIMARY KEY,
        userId varchar(36) NOT NULL,
        documentType varchar(40) NOT NULL COMMENT 'terms | privacy | anti-fraud',
        documentVersion varchar(40) NOT NULL COMMENT 'Version in force when accepted',
        acceptedAt timestamp NOT NULL,
        acceptanceContext varchar(40) NOT NULL DEFAULT 'SIGNUP' COMMENT 'SIGNUP | OAUTH_SIGNUP | REACCEPTANCE',
        ipAddress varchar(64) NULL,
        userAgent varchar(512) NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_user_legal_acceptances_user (userId),
        KEY idx_user_legal_acceptances_user_doc (userId, documentType)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS user_legal_acceptances');
  }
}
