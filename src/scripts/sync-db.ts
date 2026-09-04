import { AppDataSource } from '../database/data-source';

async function main() {
  console.log('Connecting to database...');
  await AppDataSource.initialize();
  console.log('Synchronizing schema with database...');
  await AppDataSource.synchronize(false);
  console.log('Database synchronization completed successfully!');
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});

