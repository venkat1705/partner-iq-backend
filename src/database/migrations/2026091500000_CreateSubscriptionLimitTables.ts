import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Account-level subscription billing: customer accounts, per-plan resource
 * allowances, the add-on catalog, and purchased add-on capacity.
 *
 * Non-destructive by design:
 *  - `organizations.accountId` and `billing_subscriptions.accountId` are added
 *    as NULLable columns, so every existing row stays valid.
 *  - The backfill below groups existing organizations by `createdBy` into one
 *    account per owner, which is exactly what `BillingAccountService` would do
 *    lazily — doing it here just means the first request does not have to.
 *  - Nothing is dropped, and no existing row's data is changed beyond gaining
 *    an `accountId`.
 *
 * `billing_plan_limits.includedLimit` is NULLable and NULL means *unlimited*.
 * A sentinel number was deliberately avoided: any large integer could collide
 * with a legitimate admin-configured allowance, and JavaScript `Infinity` has
 * no SQL representation at all.
 */
export class CreateSubscriptionLimitTables2026091500000 implements MigrationInterface {
  name = 'CreateSubscriptionLimitTables2026091500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // -----------------------------------------------------------------
    // Customer accounts
    // -----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_accounts (
        id varchar(36) NOT NULL PRIMARY KEY,
        name varchar(255) NOT NULL,
        ownerUserId varchar(36) NOT NULL,
        currency varchar(10) NOT NULL DEFAULT 'INR',
        status varchar(20) NOT NULL DEFAULT 'ACTIVE',
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deletedAt timestamp NULL,
        UNIQUE KEY uq_billing_accounts_owner (ownerUserId)
      )
    `);

    await this.addColumnIfMissing(
      queryRunner,
      'organizations',
      'accountId',
      'ALTER TABLE organizations ADD COLUMN accountId varchar(36) NULL',
    );
    await this.addIndexIfMissing(
      queryRunner,
      'organizations',
      'idx_organizations_account',
      'ALTER TABLE organizations ADD INDEX idx_organizations_account (accountId)',
    );

    await this.addColumnIfMissing(
      queryRunner,
      'billing_subscriptions',
      'accountId',
      'ALTER TABLE billing_subscriptions ADD COLUMN accountId varchar(36) NULL',
    );
    await this.addIndexIfMissing(
      queryRunner,
      'billing_subscriptions',
      'idx_billing_subscriptions_account',
      'ALTER TABLE billing_subscriptions ADD INDEX idx_billing_subscriptions_account (accountId)',
    );

    // -----------------------------------------------------------------
    // Plan allowances
    // -----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_plan_limits (
        id varchar(36) NOT NULL PRIMARY KEY,
        planId varchar(36) NOT NULL,
        resourceType varchar(30) NOT NULL,
        includedLimit int NULL COMMENT 'NULL means unlimited',
        addonPurchasable tinyint NOT NULL DEFAULT 1,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_billing_plan_limit (planId, resourceType),
        KEY idx_billing_plan_limits_plan (planId)
      )
    `);

    // -----------------------------------------------------------------
    // Add-on catalog
    // -----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_addons (
        id varchar(36) NOT NULL PRIMARY KEY,
        code varchar(50) NOT NULL,
        name varchar(120) NOT NULL,
        description text NULL,
        resourceType varchar(30) NOT NULL,
        unitPrice int NOT NULL DEFAULT 0 COMMENT 'Minor units (paise for INR)',
        currency varchar(10) NOT NULL DEFAULT 'INR',
        billingInterval varchar(20) NOT NULL DEFAULT 'MONTHLY',
        unitsPerQuantity int NOT NULL DEFAULT 1,
        minQuantity int NOT NULL DEFAULT 1,
        maxQuantity int NULL,
        isActive tinyint NOT NULL DEFAULT 1,
        sortOrder int NOT NULL DEFAULT 0,
        createdBy varchar(36) NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        modifiedBy varchar(36) NULL,
        rowStatus varchar(20) NOT NULL DEFAULT 'ACTIVE',
        UNIQUE KEY uq_billing_addon_code_interval_currency (code, billingInterval, currency),
        KEY idx_billing_addons_resource (resourceType)
      )
    `);

    // -----------------------------------------------------------------
    // Purchased add-on capacity
    // -----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_addon_purchases (
        id varchar(36) NOT NULL PRIMARY KEY,
        accountId varchar(36) NOT NULL,
        subscriptionId varchar(36) NULL,
        addonId varchar(36) NOT NULL,
        resourceType varchar(30) NOT NULL,
        quantity int NOT NULL DEFAULT 0,
        unitPriceSnapshot int NOT NULL DEFAULT 0 COMMENT 'Price at purchase time, minor units',
        currency varchar(10) NOT NULL DEFAULT 'INR',
        billingInterval varchar(20) NOT NULL DEFAULT 'MONTHLY',
        status varchar(30) NOT NULL DEFAULT 'PENDING',
        startDate timestamp NULL,
        endDate timestamp NULL,
        providerPaymentId varchar(255) NULL,
        providerOrderId varchar(255) NULL,
        idempotencyKey varchar(255) NULL,
        metadata json NULL,
        createdBy varchar(36) NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        modifiedBy varchar(36) NULL,
        rowStatus varchar(20) NOT NULL DEFAULT 'ACTIVE',
        KEY idx_billing_addon_purchases_account (accountId),
        KEY idx_billing_addon_purchases_subscription (subscriptionId),
        KEY idx_billing_addon_purchases_addon (addonId),
        KEY idx_billing_addon_purchases_resource (resourceType),
        KEY idx_billing_addon_purchases_status (status),
        KEY idx_billing_addon_purchases_idempotency (idempotencyKey)
      )
    `);

    // -----------------------------------------------------------------
    // Backfill: one account per organization owner
    // -----------------------------------------------------------------
    await queryRunner.query(`
      INSERT INTO billing_accounts (id, name, ownerUserId, currency, status)
      SELECT
        UUID(),
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.firstName, ''), ' ', COALESCE(u.lastName, ''))), ''), u.email, 'PartnerIQ Account'),
        u.id,
        'INR',
        'ACTIVE'
      FROM users u
      WHERE EXISTS (SELECT 1 FROM organizations o WHERE o.createdBy = u.id)
        AND NOT EXISTS (SELECT 1 FROM billing_accounts a WHERE a.ownerUserId = u.id)
    `);

    await queryRunner.query(`
      UPDATE organizations o
      JOIN billing_accounts a ON a.ownerUserId = o.createdBy
      SET o.accountId = a.id
      WHERE o.accountId IS NULL
    `);

    // Existing organization-level subscriptions become account-level, so they
    // now cover every organization the same customer owns.
    await queryRunner.query(`
      UPDATE billing_subscriptions s
      JOIN organizations o ON o.id = s.organizationId
      SET s.accountId = o.accountId
      WHERE s.accountId IS NULL AND o.accountId IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS billing_addon_purchases');
    await queryRunner.query('DROP TABLE IF EXISTS billing_addons');
    await queryRunner.query('DROP TABLE IF EXISTS billing_plan_limits');

    await this.dropColumnIfPresent(queryRunner, 'billing_subscriptions', 'accountId');
    await this.dropColumnIfPresent(queryRunner, 'organizations', 'accountId');

    await queryRunner.query('DROP TABLE IF EXISTS billing_accounts');
  }

  /** MySQL has no `ADD COLUMN IF NOT EXISTS`, so check information_schema. */
  private async addColumnIfMissing(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    ddl: string,
  ) {
    const rows = await queryRunner.query(
      `SELECT COUNT(*) AS found FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    if (Number(rows?.[0]?.found) === 0) {
      await queryRunner.query(ddl);
    }
  }

  private async addIndexIfMissing(
    queryRunner: QueryRunner,
    table: string,
    indexName: string,
    ddl: string,
  ) {
    const rows = await queryRunner.query(
      `SELECT COUNT(*) AS found FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, indexName],
    );
    if (Number(rows?.[0]?.found) === 0) {
      await queryRunner.query(ddl);
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
