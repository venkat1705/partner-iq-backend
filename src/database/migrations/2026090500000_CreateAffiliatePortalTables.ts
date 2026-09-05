import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAffiliatePortalTables2026090500000 implements MigrationInterface {
  name = 'CreateAffiliatePortalTables2026090500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS affiliate_portal_profiles (
        id varchar(36) NOT NULL PRIMARY KEY,
        userId varchar(36) NOT NULL,
        email varchar(255) NOT NULL,
        fullName varchar(255) NULL,
        website varchar(255) NULL,
        phone varchar(50) NULL,
        country varchar(50) NOT NULL DEFAULT 'India',
        partnerType varchar(50) NOT NULL DEFAULT 'AFFILIATE',
        primaryMarket varchar(255) NOT NULL DEFAULT 'India',
        audienceSize varchar(50) NOT NULL DEFAULT '0-1k',
        socialProfiles json NULL,
        bio text NULL,
        onboardingCompleted tinyint NOT NULL DEFAULT 0,
        taxCountry varchar(50) NOT NULL DEFAULT 'India',
        panOrTaxId varchar(100) NULL,
        taxClassification varchar(50) NOT NULL DEFAULT 'INDIVIDUAL',
        withholdingRate int NOT NULL DEFAULT 0,
        taxVerified tinyint NOT NULL DEFAULT 0,
        taxFormType varchar(50) NOT NULL DEFAULT 'PAN_TDS',
        taxSubmittedAt timestamp NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_affiliate_portal_profiles_user (userId),
        KEY idx_affiliate_portal_profiles_email (email)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS affiliate_payout_methods (
        id varchar(36) NOT NULL PRIMARY KEY,
        userId varchar(36) NOT NULL,
        type varchar(50) NOT NULL,
        isDefault tinyint NOT NULL DEFAULT 0,
        bankName varchar(255) NULL,
        accountNumberMasked varchar(50) NULL,
        ifscCode varchar(20) NULL,
        accountHolderName varchar(255) NULL,
        upiIdMasked varchar(255) NULL,
        paypalEmailMasked varchar(255) NULL,
        authorizedOrgIds json NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_affiliate_payout_methods_user (userId)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS affiliate_support_tickets (
        id varchar(36) NOT NULL PRIMARY KEY,
        userId varchar(36) NOT NULL,
        organizationId varchar(36) NULL,
        organizationName varchar(255) NOT NULL DEFAULT 'Global Partner Support',
        subject varchar(255) NOT NULL,
        category varchar(100) NOT NULL DEFAULT 'General Support',
        priority varchar(50) NOT NULL DEFAULT 'NORMAL',
        status varchar(50) NOT NULL DEFAULT 'OPEN',
        message text NULL,
        lastReply text NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_affiliate_support_tickets_user (userId)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS affiliate_support_tickets');
    await queryRunner.query('DROP TABLE IF EXISTS affiliate_payout_methods');
    await queryRunner.query('DROP TABLE IF EXISTS affiliate_portal_profiles');
  }
}
