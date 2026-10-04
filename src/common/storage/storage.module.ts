/**
 * Global storage module. Provides the single StorageService instance (and its validated config) to every feature.
 * The config is loaded and validated when the module is created: a missing or invalid setting stops the backend
 * from starting with a clear message (see storage.config.ts).
 */
import { Global, Module } from '@nestjs/common';
import { loadStorageConfig } from './storage.config';
import { StorageService } from './storage.service';
import { S3StorageProvider } from './providers/s3-storage.provider';

/** Pick the provider implementation. Adding a provider = one new class + one case here. */
export function createStorageService(env: NodeJS.ProcessEnv = process.env): StorageService {
  const config = loadStorageConfig(env);
  switch (config.provider) {
    case 's3':
      return new S3StorageProvider(config);
    default:
      throw new Error(`Unsupported storage provider ${config.provider}`);
  }
}

@Global()
@Module({
  providers: [{ provide: StorageService, useFactory: () => createStorageService() }],
  exports: [StorageService],
})
export class StorageModule {}
