import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBillingCouponTables2026083100000 implements MigrationInterface {
  name = 'CreateBillingCouponTables2026083100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_promotions (
        id varchar(36) NOT NULL PRIMARY KEY,
        name varchar(120) NOT NULL,
        code varchar(80) NOT NULL,
        description text NULL,
        campaignType varchar(80) NULL,
        startsAt timestamp NULL,
        endsAt timestamp NULL,
        status varchar(40) NOT NULL DEFAULT 'DRAFT',
        utmCampaign varchar(120) NULL,
        utmSource varchar(120) NULL,
        utmMedium varchar(120) NULL,
        landingPage varchar(2000) NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_billing_promotion_code (code),
        KEY idx_billing_promotions_status (status)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_coupons (
        id varchar(36) NOT NULL PRIMARY KEY,
        code varchar(120) NOT NULL,
        normalizedCode varchar(120) NOT NULL,
        name varchar(160) NOT NULL,
        description text NULL,
        discountType varchar(40) NOT NULL,
        discountValue int NULL,
        currency varchar(10) NULL,
        durationType varchar(40) NOT NULL DEFAULT 'ONE_TIME',
        durationCycles int NULL,
        trialExtensionDays int NULL,
        freeMonths int NULL,
        validFrom timestamp NULL,
        validUntil timestamp NULL,
        maxRedemptions int NULL,
        maxRedemptionsPerOrganization int NULL,
        minimumPurchaseAmount int NULL,
        status varchar(40) NOT NULL DEFAULT 'DRAFT',
        isPublic tinyint NOT NULL DEFAULT 0,
        isStackable tinyint NOT NULL DEFAULT 0,
        firstTimeCustomersOnly tinyint NOT NULL DEFAULT 0,
        planEligibility varchar(40) NOT NULL DEFAULT 'ALL_PLANS',
        billingCycleEligibility varchar(40) NOT NULL DEFAULT 'ALL',
        customerEligibility varchar(60) NOT NULL DEFAULT 'ANY_ORGANIZATION',
        promotionId varchar(36) NULL,
        planChangePolicy varchar(40) NOT NULL DEFAULT 'PRESERVE_IF_ELIGIBLE',
        advancedRules json NULL,
        createdBy varchar(36) NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedBy varchar(36) NULL,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        rowVersion int NOT NULL DEFAULT 1,
        UNIQUE KEY uq_billing_coupon_normalized_code (normalizedCode),
        KEY idx_billing_coupons_status (status),
        KEY idx_billing_coupons_valid_from (validFrom),
        KEY idx_billing_coupons_valid_until (validUntil),
        KEY idx_billing_coupons_promotion (promotionId)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_coupon_plans (
        id varchar(36) NOT NULL PRIMARY KEY,
        couponId varchar(36) NOT NULL,
        planId varchar(36) NOT NULL,
        UNIQUE KEY uq_billing_coupon_plan (couponId, planId),
        KEY idx_billing_coupon_plans_coupon (couponId),
        KEY idx_billing_coupon_plans_plan (planId)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_coupon_organizations (
        id varchar(36) NOT NULL PRIMARY KEY,
        couponId varchar(36) NOT NULL,
        organizationId varchar(36) NOT NULL,
        UNIQUE KEY uq_billing_coupon_org (couponId, organizationId),
        KEY idx_billing_coupon_orgs_coupon (couponId),
        KEY idx_billing_coupon_orgs_org (organizationId)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_coupon_redemptions (
        id varchar(36) NOT NULL PRIMARY KEY,
        couponId varchar(36) NOT NULL,
        organizationId varchar(36) NOT NULL,
        subscriptionId varchar(36) NULL,
        planId varchar(36) NOT NULL,
        billingCycle varchar(20) NOT NULL,
        currency varchar(10) NOT NULL,
        originalSubtotal int NOT NULL,
        discountAmount int NOT NULL DEFAULT 0,
        discountedSubtotal int NOT NULL,
        taxAmount int NOT NULL DEFAULT 0,
        finalAmount int NOT NULL,
        durationType varchar(40) NOT NULL,
        remainingCycles int NULL,
        status varchar(40) NOT NULL DEFAULT 'RESERVED',
        provider varchar(30) NULL,
        providerPaymentId varchar(255) NULL,
        providerSubscriptionId varchar(255) NULL,
        idempotencyKey varchar(191) NOT NULL,
        pricingSnapshot json NOT NULL,
        reservedAt timestamp NOT NULL,
        expiresAt timestamp NOT NULL,
        redeemedAt timestamp NULL,
        cancelledAt timestamp NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_billing_coupon_redemption_idempotency (organizationId, idempotencyKey),
        KEY idx_billing_coupon_redemptions_coupon_status (couponId, status),
        KEY idx_billing_coupon_redemptions_org_redeemed (organizationId, redeemedAt),
        KEY idx_billing_coupon_redemptions_subscription (subscriptionId)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS billing_subscription_discounts (
        id varchar(36) NOT NULL PRIMARY KEY,
        subscriptionId varchar(36) NOT NULL,
        couponRedemptionId varchar(36) NOT NULL,
        discountType varchar(40) NOT NULL,
        discountValue int NULL,
        startsAt timestamp NOT NULL,
        totalCycles int NULL,
        cyclesConsumed int NOT NULL DEFAULT 0,
        status varchar(40) NOT NULL DEFAULT 'ACTIVE',
        snapshot json NOT NULL,
        createdDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        modifiedDate timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_billing_subscription_discount_redemption (subscriptionId, couponRedemptionId),
        KEY idx_billing_subscription_discounts_subscription (subscriptionId),
        KEY idx_billing_subscription_discounts_redemption (couponRedemptionId)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS billing_subscription_discounts');
    await queryRunner.query('DROP TABLE IF EXISTS billing_coupon_redemptions');
    await queryRunner.query('DROP TABLE IF EXISTS billing_coupon_organizations');
    await queryRunner.query('DROP TABLE IF EXISTS billing_coupon_plans');
    await queryRunner.query('DROP TABLE IF EXISTS billing_coupons');
    await queryRunner.query('DROP TABLE IF EXISTS billing_promotions');
  }
}
