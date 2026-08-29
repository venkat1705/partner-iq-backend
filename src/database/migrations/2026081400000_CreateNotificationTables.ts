import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationTables2026081400000 implements MigrationInterface {
  name = 'CreateNotificationTables2026081400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id varchar(36) NOT NULL PRIMARY KEY,
        userId varchar(36) NOT NULL,
        organizationId varchar(36) NULL,
        type varchar(50) NOT NULL DEFAULT 'system',
        title varchar(255) NOT NULL,
        body text NOT NULL,
        channel varchar(50) NOT NULL DEFAULT 'in_app',
        priority varchar(50) NOT NULL DEFAULT 'normal',
        isRead boolean NOT NULL DEFAULT false,
        actionUrl varchar(2000) NULL,
        metadata text NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_notifications_user (userId),
        KEY idx_notifications_org (organizationId),
        KEY idx_notifications_user_created (userId, createdAt)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id varchar(36) NOT NULL PRIMARY KEY,
        userId varchar(36) NOT NULL,
        organizationId varchar(36) NULL,
        enabled boolean NOT NULL DEFAULT true,
        channels text NOT NULL,
        categories text NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_notification_preferences_user_org (userId, organizationId),
        KEY idx_notification_preferences_user (userId),
        KEY idx_notification_preferences_org (organizationId)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS notification_preferences');
    await queryRunner.query('DROP TABLE IF EXISTS notifications');
  }
}
