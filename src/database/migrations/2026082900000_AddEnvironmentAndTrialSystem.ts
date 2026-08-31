import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnvironmentAndTrialSystem2026082900000 implements MigrationInterface {
  name = 'AddEnvironmentAndTrialSystem2026082900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create organization_trials table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS organization_trials (
        id varchar(36) NOT NULL PRIMARY KEY,
        organizationId varchar(36) NOT NULL,
        trialUsed tinyint NOT NULL DEFAULT 0,
        firstTrialStartedAt timestamp NOT NULL,
        firstTrialEndedAt timestamp NOT NULL,
        extendedByAdminDays int NOT NULL DEFAULT 0,
        grantedByAdminAt timestamp NULL,
        grantedByAdminUserId varchar(36) NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_org_trial (organizationId),
        KEY idx_org_trial_org (organizationId)
      )
    `);

    // 2. Add trial columns to billing_subscriptions if missing
    const subColumns = [
      `ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS trialStartedAt timestamp NULL`,
      `ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS trialEndsAt timestamp NULL`,
      `ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS billingCycle varchar(20) NOT NULL DEFAULT 'MONTHLY'`,
    ];
    for (const sql of subColumns) {
      try {
        await queryRunner.query(sql);
      } catch (err) {
        // Table or column might vary by database engine
      }
    }

    // 3. Operational tables to add environment column to
    const tables = [
      'programs',
      'program_affiliates',
      'affiliate_invitations',
      'affiliate_applications',
      'tracking_links',
      'clicks',
      'attributions',
      'api_keys',
      'idempotency_keys',
      'conversions',
      'commission_rules',
      'commissions',
      'ledger_accounts',
      'ledger_transactions',
      'fraud_reviews',
      'fraud_settings',
      'fraud_assessments',
      'fraud_metric_rollups',
      'payout_batches',
      'payout_items',
      'webhook_endpoints',
      'webhook_deliveries',
      'partner_deals',
      'assets',
      'partner_tiers',
      'affiliate_tiers',
      'affiliate_tier_histories',
      'milestones',
      'affiliate_milestone_achievements',
      'affiliate_performance_summaries',
      'automation_workflows',
      'automation_executions',
      'automation_scheduled_steps',
    ];

    for (const table of tables) {
      try {
        await queryRunner.query(`
          ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS environment varchar(20) NOT NULL DEFAULT 'LIVE'
        `);
      } catch (e) {
        // Column may already exist or table may not exist yet
      }

      // Backfill existing rows as LIVE
      try {
        await queryRunner.query(`
          UPDATE ${table} SET environment = 'LIVE' WHERE environment IS NULL OR environment = ''
        `);
      } catch (e) {
        // Ignore
      }

      // Add composite index (organizationId, environment)
      try {
        await queryRunner.query(`
          CREATE INDEX IF NOT EXISTS idx_${table}_org_env ON ${table} (organizationId, environment)
        `);
      } catch (e) {
        // Ignore index duplicate
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS organization_trials');
  }
}
