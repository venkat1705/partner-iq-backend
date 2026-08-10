const { DataSource } = require('typeorm');
const dotenv = require('dotenv');

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const databaseHost = process.env.DATABASE_HOST || process.env.PLANETSCALE_DB_HOST || 'localhost';
const databasePort = parseInt(process.env.DATABASE_PORT || '3306', 10);
const databaseUsername = process.env.DATABASE_USER || process.env.PLANETSCALE_DB_USERNAME || 'root';
const databasePassword = process.env.DATABASE_PASSWORD || process.env.PLANETSCALE_DB_PASSWORD || '';
const databaseName = process.env.DATABASE_NAME || process.env.PLANETSCALE_DB || 'partneriq';
const databaseSsl =
  process.env.DATABASE_SSL === 'true' ||
  Boolean(process.env.DATABASE_URL || process.env.PLANETSCALE_DB_HOST)
    ? { rejectUnauthorized: true }
    : undefined;

const AppDataSource = new DataSource({
  type: 'mysql',
  ...(databaseUrl
    ? { url: databaseUrl }
    : {
        host: databaseHost,
        port: databasePort,
        username: databaseUsername,
        password: databasePassword,
        database: databaseName,
      }),
  ssl: databaseSsl,
  synchronize: false,
  logging: false,
  entities: ['src/database/schema.ts'],
  migrations: ['src/database/migrations/*.ts'],
  migrationsRun: false,
  subscribers: [],
});

module.exports = AppDataSource;

