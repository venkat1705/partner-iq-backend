import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

export default async function globalSetup() {
  process.env.NODE_ENV = 'test';
  delete process.env.UNIT_TEST;
  delete process.env.TEST_MEMORY_ONLY;

  const cwd = process.cwd();
  const testEnvPath = path.resolve(cwd, '.env.test');
  const fallbackPath = path.resolve(cwd, 'backend', '.env.test');

  if (fs.existsSync(testEnvPath)) {
    dotenv.config({ path: testEnvPath, override: true });
  } else if (fs.existsSync(fallbackPath)) {
    dotenv.config({ path: fallbackPath, override: true });
  }

  const host = process.env.DATABASE_HOST || 'localhost';
  const port = parseInt(process.env.DATABASE_PORT || '3306', 10);
  const user = process.env.DATABASE_USER || 'root';
  const password = process.env.DATABASE_PASSWORD || '';
  const database = process.env.DATABASE_NAME || 'partneriq_test';

  if (!database.endsWith('_test')) {
    throw new Error(`FATAL SAFETY GUARD: Test database name must end in _test. Got: "${database}"`);
  }

  // 1. Create database if not exists
  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
  });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\`;`);
  await connection.end();

  // 2. Initialize AppDataSource against partneriq_test
  const { AppDataSource, initializeDataSource } = await import('../src/database/data-source');
  await initializeDataSource();

  // 3. Run seedSystemDefaults once
  const { seedSystemDefaults } = await import('../src/database/seeds/run-seed');
  await seedSystemDefaults();

  // 4. Close DataSource
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}

