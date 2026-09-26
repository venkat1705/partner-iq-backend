import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `googleEventId` to `demo_bookings`: the Google Calendar event id
 * backing the real Google Meet link created for a booking, so reschedule/
 * cancel can update or delete the same calendar event instead of leaving it
 * orphaned.
 */
export class DemoBookingGoogleEventId2026092500000 implements MigrationInterface {
  name = 'DemoBookingGoogleEventId2026092500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const hasColumn: Array<{ COLUMN_NAME: string }> = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demo_bookings' AND COLUMN_NAME = 'googleEventId'`,
    );
    if (!hasColumn.length) {
      await queryRunner.query(
        `ALTER TABLE demo_bookings ADD COLUMN googleEventId varchar(255) NULL AFTER meetingUrl`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.query(`ALTER TABLE demo_bookings DROP COLUMN googleEventId`);
    } catch {
      // Column might not exist
    }
  }
}
