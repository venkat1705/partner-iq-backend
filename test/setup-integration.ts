import { afterEach, afterAll } from '@jest/globals';
import { AppDataSource, initializeDataSource } from '../src/database/data-source';
import { resetDbStore } from '../src/database/store';

const SYSTEM_DEFAULT_TABLES = new Set([
  'migrations',
  'permissions',
  'roles',
  'role_permissions',
  'integrations',
  'organization_brandings',
  'email_design_templates',
  'email_design_settings',
  'document_design_templates',
  'blog_posts',
]);

afterEach(async () => {
  if (AppDataSource.isInitialized) {
    const dbName = String((AppDataSource.options as any).database || '');
    if (!dbName.endsWith('_test')) {
      throw new Error(`FATAL SAFETY GUARD: Refusing to truncate tables on non-test database "${dbName}"!`);
    }

    const queryRunner = AppDataSource.createQueryRunner();
    try {
      await queryRunner.query('SET FOREIGN_KEY_CHECKS = 0;');
      const tables: Array<{ TABLE_NAME: string }> = await queryRunner.query(
        `SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE();`
      );
      for (const { TABLE_NAME } of tables) {
        if (!SYSTEM_DEFAULT_TABLES.has(TABLE_NAME.toLowerCase())) {
          await queryRunner.query(`TRUNCATE TABLE \`${TABLE_NAME}\`;`);
        }
      }
      await queryRunner.query('SET FOREIGN_KEY_CHECKS = 1;');
    } finally {
      await queryRunner.release();
    }
  }

  resetDbStore();
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

