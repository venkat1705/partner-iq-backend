const { DataSource } = require('typeorm');
const dotenv = require('dotenv');

dotenv.config();

const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '3306', 10),
  username: process.env.DATABASE_USER || 'root',
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME || 'partneriq',
  synchronize: false,
  logging: false,
  entities: ['src/database/schema.ts'],
  migrations: ['src/database/migrations/*.ts'],
  migrationsRun: false,
  subscribers: [],
});

module.exports = AppDataSource;

