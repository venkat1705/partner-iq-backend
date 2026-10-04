/** Public surface of the storage module. Features import from here only. */
export { StorageModule, createStorageService } from './storage.module';
export { StorageService } from './storage.service';
export type {
  BucketSettingsReport,
  DownloadUrl,
  DownloadUrlOptions,
  ListedObject,
  ObjectHead,
  StorageContext,
  StoredObjectInfo,
  UploadStreamInput,
} from './storage.service';
export type { PublicStorageSettings } from './storage.config';
export { StorageConfigError, loadStorageConfig } from './storage.config';
export type { ObjectKeyRef } from './storage-keys';
export { ALLOWED_FILE_TYPES, IMAGE_FILE_TYPES, extensionOf } from './content-sniffer';
export type { FileTypeId } from './content-sniffer';
export * from './storage.errors';
export { createZipStream, safeZipNames } from './zip-stream';
export type { ZipEntry } from './zip-stream';
