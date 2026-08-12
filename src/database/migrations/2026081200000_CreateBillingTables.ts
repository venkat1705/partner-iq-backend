import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBillingTables2026081200000 implements MigrationInterface {
  name = 'CreateBillingTables2026081200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_plans (
        id varchar(36) NOT NULL PRIMARY KEY,
        code varchar(50) NOT NULL,
        name varchar(120) NOT NULL,
        description text NULL,
        price int NOT NULL DEFAULT 0,
        currency varchar(10) NOT NULL DEFAULT 'INR',
        billingInterval varchar(20) NOT NULL DEFAULT 'MONTHLY',
        billingIntervalCount int NOT NULL DEFAULT 1,
        trialDays int NOT NULL DEFAULT 0,
        isActive tinyint NOT NULL DEFAULT 1,
        isPublic tinyint NOT NULL DEFAULT 1,
        sortOrder int NOT NULL DEFAULT 0,
        createdBy varchar(36) NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        modifiedBy varchar(36) NULL,
        rowStatus varchar(20) NOT NULL DEFAULT 'ACTIVE',
        UNIQUE KEY uq_billing_plan_code_interval_currency (code, billingInterval, currency)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_plan_provider_mappings (
        id varchar(36) NOT NULL PRIMARY KEY,
        planId varchar(36) NOT NULL,
        provider varchar(30) NOT NULL,
        providerPlanId varchar(255) NULL,
        providerPriceId varchar(255) NULL,
        currency varchar(10) NOT NULL DEFAULT 'INR',
        isActive tinyint NOT NULL DEFAULT 1,
        metadata json NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_billing_plan_provider_currency (planId, provider, currency),
        KEY idx_billing_plan_provider_plan (planId)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_plan_features (
        id varchar(36) NOT NULL PRIMARY KEY,
        planId varchar(36) NOT NULL,
        featureKey varchar(120) NOT NULL,
        enabled tinyint NOT NULL DEFAULT 1,
        limitValue int NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_billing_plan_feature (planId, featureKey),
        KEY idx_billing_plan_features_plan (planId)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_subscriptions (
        id varchar(36) NOT NULL PRIMARY KEY,
        organizationId varchar(36) NOT NULL,
        planId varchar(36) NOT NULL,
        provider varchar(30) NOT NULL,
        providerCustomerId varchar(255) NULL,
        providerSubscriptionId varchar(255) NULL,
        status varchar(50) NOT NULL DEFAULT 'CREATED',
        billingInterval varchar(20) NOT NULL DEFAULT 'MONTHLY',
        currentPeriodStart timestamp NULL,
        currentPeriodEnd timestamp NULL,
        trialStart timestamp NULL,
        trialEnd timestamp NULL,
        cancelAtPeriodEnd tinyint NOT NULL DEFAULT 0,
        cancelledAt timestamp NULL,
        nextBillingDate timestamp NULL,
        pendingPlanId varchar(36) NULL,
        scheduledChangeDate timestamp NULL,
        createdBy varchar(36) NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        modifiedBy varchar(36) NULL,
        rowStatus varchar(20) NOT NULL DEFAULT 'ACTIVE',
        UNIQUE KEY uq_billing_org_provider_subscription (organizationId, providerSubscriptionId),
        KEY idx_billing_subscriptions_org (organizationId),
        KEY idx_billing_subscriptions_plan (planId),
        KEY idx_billing_subscriptions_status (status)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_payments (
        id varchar(36) NOT NULL PRIMARY KEY,
        organizationId varchar(36) NOT NULL,
        subscriptionId varchar(36) NULL,
        provider varchar(30) NOT NULL,
        providerPaymentId varchar(255) NULL UNIQUE,
        providerOrderId varchar(255) NULL,
        providerInvoiceId varchar(255) NULL,
        amount int NOT NULL,
        currency varchar(10) NOT NULL DEFAULT 'INR',
        status varchar(50) NOT NULL DEFAULT 'CREATED',
        paymentMethod varchar(80) NULL,
        failureCode varchar(120) NULL,
        failureReason text NULL,
        paidAt timestamp NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_billing_payments_org (organizationId),
        KEY idx_billing_payments_subscription (subscriptionId),
        KEY idx_billing_payments_order (providerOrderId),
        KEY idx_billing_payments_status (status)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_payment_events (
        id varchar(36) NOT NULL PRIMARY KEY,
        provider varchar(30) NOT NULL,
        providerEventId varchar(255) NOT NULL,
        eventType varchar(120) NOT NULL,
        payloadHash varchar(128) NOT NULL,
        status varchar(50) NOT NULL DEFAULT 'RECEIVED',
        retryCount int NOT NULL DEFAULT 0,
        errorMessage text NULL,
        receivedAt timestamp NOT NULL,
        processedAt timestamp NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_billing_payment_event (provider, providerEventId),
        KEY idx_billing_payment_events_status (status)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_refunds (
        id varchar(36) NOT NULL PRIMARY KEY,
        organizationId varchar(36) NOT NULL,
        paymentId varchar(36) NOT NULL,
        provider varchar(30) NOT NULL,
        providerRefundId varchar(255) NULL UNIQUE,
        amount int NOT NULL,
        currency varchar(10) NOT NULL DEFAULT 'INR',
        status varchar(50) NOT NULL DEFAULT 'CREATED',
        createdBy varchar(36) NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_billing_refunds_org (organizationId),
        KEY idx_billing_refunds_payment (paymentId)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_invoices (
        id varchar(36) NOT NULL PRIMARY KEY,
        organizationId varchar(36) NOT NULL,
        subscriptionId varchar(36) NULL,
        provider varchar(30) NOT NULL,
        providerInvoiceId varchar(255) NULL,
        invoiceNumber varchar(80) NOT NULL,
        amount int NOT NULL,
        tax int NOT NULL DEFAULT 0,
        total int NOT NULL,
        currency varchar(10) NOT NULL DEFAULT 'INR',
        status varchar(50) NOT NULL DEFAULT 'ISSUED',
        invoiceUrl varchar(2000) NULL,
        invoiceDate timestamp NOT NULL,
        dueDate timestamp NULL,
        paidDate timestamp NULL,
        KEY idx_billing_invoices_org (organizationId),
        KEY idx_billing_invoices_subscription (subscriptionId)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS billing_invoices');
    await queryRunner.query('DROP TABLE IF EXISTS billing_refunds');
    await queryRunner.query('DROP TABLE IF EXISTS billing_payment_events');
    await queryRunner.query('DROP TABLE IF EXISTS billing_payments');
    await queryRunner.query('DROP TABLE IF EXISTS billing_subscriptions');
    await queryRunner.query('DROP TABLE IF EXISTS billing_plan_features');
    await queryRunner.query('DROP TABLE IF EXISTS billing_plan_provider_mappings');
    await queryRunner.query('DROP TABLE IF EXISTS billing_plans');
  }
}
