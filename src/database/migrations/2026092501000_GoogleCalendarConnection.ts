import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `google_calendar_connections`: a single platform-wide row tracking
 * whether an admin has connected a Google account for demo-booking Meet
 * links, and its status/metadata. The actual OAuth access/refresh tokens are
 * NOT stored here — they live encrypted in the existing `integration_credentials`
 * table, keyed by the same connection id.
 */
export class GoogleCalendarConnection2026092501000 implements MigrationInterface {
  name = 'GoogleCalendarConnection2026092501000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('google_calendar_connections');
    if (!hasTable) {
      await queryRunner.query(`
        CREATE TABLE google_calendar_connections (
          id varchar(64) NOT NULL,
          status varchar(20) NOT NULL DEFAULT 'DISCONNECTED',
          connectedEmail varchar(255) NULL,
          connectedByUserId varchar(36) NULL,
          connectedByName varchar(255) NULL,
          scope varchar(500) NULL,
          accessTokenExpiresAt timestamp NULL,
          lastError text NULL,
          connectedAt timestamp NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS google_calendar_connections`);
  }
}
