import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds onboarding state and concurrency lock columns to `organizations`:
 * - `onboardingIdempotencyKey`: varchar(64) nullable (per-form-mount idempotency)
 * - `onboardingStatus`: varchar(20) not null default 'COMPLETED' ('IN_PROGRESS' | 'COMPLETED')
 * - `onboardingStep`: int not null default 1
 * - `onboardingLockKey`: uuid/varchar(36) nullable with unique constraint
 *
 * Backfill guarantee:
 * All existing organizations are backfilled to `onboardingStatus = 'COMPLETED'` and
 * `onboardingLockKey = NULL`. Because MySQL allows multiple NULL values in a unique index,
 * the unique constraint creation will not fail even if users own multiple existing organizations,
 * and no existing active user will be pushed back into onboarding.
 */
export class OnboardingStatusAndLockKey2026092400000 implements MigrationInterface {
  name = 'OnboardingStatusAndLockKey2026092400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add onboardingIdempotencyKey if missing
    const hasIdempotencyKey: Array<{ COLUMN_NAME: string }> = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND COLUMN_NAME = 'onboardingIdempotencyKey'`,
    );
    if (!hasIdempotencyKey.length) {
      await queryRunner.query(
        `ALTER TABLE organizations ADD COLUMN onboardingIdempotencyKey varchar(64) NULL AFTER createdBy`,
      );
    }

    // 2. Add onboardingStatus if missing
    const hasStatus: Array<{ COLUMN_NAME: string }> = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND COLUMN_NAME = 'onboardingStatus'`,
    );
    if (!hasStatus.length) {
      await queryRunner.query(
        `ALTER TABLE organizations ADD COLUMN onboardingStatus varchar(20) NOT NULL DEFAULT 'COMPLETED' AFTER onboardingIdempotencyKey`,
      );
    }

    // 3. Add onboardingStep if missing
    const hasStep: Array<{ COLUMN_NAME: string }> = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND COLUMN_NAME = 'onboardingStep'`,
    );
    if (!hasStep.length) {
      await queryRunner.query(
        `ALTER TABLE organizations ADD COLUMN onboardingStep int NOT NULL DEFAULT 1 AFTER onboardingStatus`,
      );
    }

    // 4. Add onboardingLockKey if missing
    const hasLockKey: Array<{ COLUMN_NAME: string }> = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND COLUMN_NAME = 'onboardingLockKey'`,
    );
    if (!hasLockKey.length) {
      await queryRunner.query(
        `ALTER TABLE organizations ADD COLUMN onboardingLockKey varchar(36) NULL AFTER onboardingStep`,
      );
    }

    // 5. Backfill existing records: All existing organizations are COMPLETED, lockKey NULL
    await queryRunner.query(
      `UPDATE organizations
       SET onboardingStatus = 'COMPLETED',
           onboardingLockKey = NULL
       WHERE onboardingStatus IS NULL
          OR onboardingStatus != 'COMPLETED'
          OR onboardingLockKey IS NOT NULL`,
    );

    // 6. Ensure unique index on onboardingLockKey exists
    const hasIndex: Array<{ INDEX_NAME: string }> = await queryRunner.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND INDEX_NAME = 'IDX_organizations_onboarding_lock_key'`,
    );
    if (!hasIndex.length) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX IDX_organizations_onboarding_lock_key ON organizations (onboardingLockKey)`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.query(`DROP INDEX IDX_organizations_onboarding_lock_key ON organizations`);
    } catch {
      // Index might already be dropped
    }

    const cols = ['onboardingLockKey', 'onboardingStep', 'onboardingStatus', 'onboardingIdempotencyKey'];
    for (const col of cols) {
      try {
        await queryRunner.query(`ALTER TABLE organizations DROP COLUMN ${col}`);
      } catch {
        // Column might not exist
      }
    }
  }
}

