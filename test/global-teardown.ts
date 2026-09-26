export default async function globalTeardown() {
  try {
    const { AppDataSource } = await import('../src/database/data-source');
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  } catch {
    // Ignore teardown errors if DataSource was not initialized
  }
}

