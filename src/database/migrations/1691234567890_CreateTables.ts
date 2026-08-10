import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTables1691234567890 implements MigrationInterface {
  name = 'CreateTables1691234567890';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`users\` (
        \`id\` varchar(36) PRIMARY KEY,
        \`email\` varchar(255) NOT NULL UNIQUE,
        \`passwordHash\` varchar(255) NOT NULL,
        \`firstName\` varchar(100) NOT NULL,
        \`lastName\` varchar(100) NOT NULL,
        \`status\` varchar(50) DEFAULT 'ACTIVE',
        \`emailVerified\` boolean DEFAULT false,
        \`lastLoginAt\` timestamp NULL,
        \`failedLoginAttempts\` int DEFAULT 0,
        \`lockedUntil\` timestamp NULL,
        \`createdAt\` timestamp DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`deletedAt\` timestamp NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`organizations\` (
        \`id\` varchar(36) PRIMARY KEY,
        \`name\` varchar(255) NOT NULL,
        \`slug\` varchar(255) NOT NULL UNIQUE,
        \`website\` varchar(255) NULL,
        \`industry\` varchar(100) NULL,
        \`companySize\` varchar(50) NULL,
        \`country\` varchar(10) DEFAULT 'US',
        \`defaultCurrency\` varchar(10) DEFAULT 'USD',
        \`status\` varchar(50) DEFAULT 'ACTIVE',
        \`onboardingCompleted\` boolean DEFAULT false,
        \`createdBy\` varchar(36) NOT NULL,
        \`createdAt\` timestamp DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`deletedAt\` timestamp NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`organization_memberships\` (
        \`id\` varchar(36) PRIMARY KEY,
        \`organizationId\` varchar(36) NOT NULL,
        \`userId\` varchar(36) NOT NULL,
        \`role\` varchar(50) NOT NULL,
        \`status\` varchar(50) NOT NULL,
        \`invitedBy\` varchar(36) NULL,
        \`joinedAt\` timestamp NOT NULL,
        \`createdAt\` timestamp DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY \`unique_org_user\` (\`organizationId\`, \`userId\`),
        INDEX \`IDX_organizationId\` (\`organizationId\`),
        INDEX \`IDX_userId\` (\`userId\`)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`auth_sessions\` (
        \`id\` varchar(36) PRIMARY KEY,
        \`userId\` varchar(36) NOT NULL,
        \`refreshTokenHash\` varchar(255) NOT NULL,
        \`tokenFamilyId\` varchar(36) NOT NULL,
        \`userAgent\` text NULL,
        \`ipAddress\` varchar(45) NULL,
        \`deviceName\` varchar(255) NULL,
        \`expiresAt\` timestamp NOT NULL,
        \`lastUsedAt\` timestamp NOT NULL,
        \`revokedAt\` timestamp NULL,
        \`createdAt\` timestamp DEFAULT CURRENT_TIMESTAMP,
        INDEX \`IDX_userId\` (\`userId\`)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`programs\` (
        \`id\` varchar(36) PRIMARY KEY,
        \`organizationId\` varchar(36) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`slug\` varchar(255) NOT NULL,
        \`type\` varchar(50) NOT NULL,
        \`status\` varchar(50) NOT NULL,
        \`currency\` varchar(10) NOT NULL,
        \`commissionType\` varchar(50) NOT NULL,
        \`defaultCommissionValue\` decimal(10,2) NOT NULL,
        \`attributionModel\` varchar(50) NOT NULL,
        \`cookieDurationDays\` int NOT NULL,
        \`affiliateApprovalMode\` varchar(50) NOT NULL,
        \`createdBy\` varchar(36) NOT NULL,
        \`createdAt\` timestamp DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`deletedAt\` timestamp NULL,
        INDEX \`IDX_organizationId\` (\`organizationId\`)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`programs\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`auth_sessions\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`organization_memberships\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`organizations\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`users\``);
  }
}
