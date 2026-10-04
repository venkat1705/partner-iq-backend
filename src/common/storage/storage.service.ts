/**
 * StorageService — the interface every feature uses for files. Features never see the S3 client, the bucket name,
 * SDK types or credentials. Implementations live in ./providers (one class per provider).
 */
import type { Readable } from 'stream';
import type { PublicStorageSettings } from './storage.config';
import type { FileTypeId } from './content-sniffer';
import type { ObjectKeyRef } from './storage-keys';

export interface StorageContext {
  /** For logging/isolation checks; "platform" for user-level objects. */
  organizationId: string;
}

export interface UploadStreamInput extends StorageContext {
  /** Built with StorageService.buildKey(). */
  key: string;
  body: Readable;
  /** Original file name — used ONLY for type detection (extension family) and never stored in the key. */
  originalFileName: string;
  /** The stream is aborted as soon as more than this many bytes arrive. */
  maxBytes: number;
  /** File types accepted for this upload (subset of the configured allowed types). */
  allowedTypes: FileTypeId[];
  /** Optional cancellation (client disconnected, timeout). */
  signal?: AbortSignal;
}

export interface StoredObjectInfo {
  key: string;
  sizeBytes: number;
  checksumSha256: string;
  contentType: string;
  fileType: FileTypeId;
}

export interface DownloadUrlOptions extends StorageContext {
  /** Original file name for the Content-Disposition header. */
  fileName: string;
  contentType: string;
  /** "inline" is honoured only for raster images; every other type is always served as an attachment. */
  disposition?: 'attachment' | 'inline';
  expiresInSeconds?: number;
}

export interface DownloadUrl {
  url: string;
  expiresAt: string;
  disposition: 'attachment' | 'inline';
}

export interface ObjectHead {
  sizeBytes: number;
  contentType?: string;
  lastModified?: Date;
}

export interface ListedObject {
  key: string;
  sizeBytes: number;
  lastModified?: Date;
}

export interface BucketSettingsReport {
  bucket: string;
  publicAccessBlock: Record<string, unknown> | string;
  bucketPolicy: string;
  encryption: Record<string, unknown> | string;
  lifecycle: Record<string, unknown> | string;
  versioning: string;
  anonymousReadProbe?: { status: number; body: string };
}

export abstract class StorageService {
  /** Limits, types and expiry features may read (no credentials, no bucket). */
  abstract readonly settings: Readonly<PublicStorageSettings>;
  /** Build an object key. Key layout is defined only in storage-keys.ts. */
  abstract buildKey(ref: ObjectKeyRef): string;
  abstract keyBelongsToOrganization(key: string, organizationId: string): boolean;
  /** Stream a file to storage: magic-byte type check, byte counting with abort, SHA-256, size verified with HEAD. */
  abstract uploadStream(input: UploadStreamInput): Promise<StoredObjectInfo>;
  /** Short-lived signed download URL (default lifetime from config). */
  abstract getDownloadUrl(key: string, options: DownloadUrlOptions): Promise<DownloadUrl>;
  abstract getObjectStream(key: string, ctx: StorageContext): Promise<Readable>;
  /** null when the object does not exist. */
  abstract headObject(key: string, ctx: StorageContext): Promise<ObjectHead | null>;
  abstract deleteObject(key: string, ctx: StorageContext): Promise<void>;
  abstract deleteObjects(keys: string[], ctx: StorageContext): Promise<{ deleted: number; failed: string[] }>;
  abstract copyObject(fromKey: string, toKey: string, ctx: StorageContext): Promise<void>;
  /** Upload a small in-memory buffer (generated thumbnails only). */
  abstract putGeneratedObject(key: string, body: Buffer, contentType: string, ctx: StorageContext): Promise<StoredObjectInfo>;
  /** Iterate every object under a prefix; organizationId undefined = whole application prefix. */
  abstract listObjects(organizationId?: string): AsyncIterable<ListedObject>;
  /** Apply and/or report the bucket's security settings (Block Public Access, encryption, lifecycle, versioning). */
  abstract ensureBucketSettings(): Promise<BucketSettingsReport>;
  abstract describeBucketSettings(): Promise<BucketSettingsReport>;
  /** Abort multipart uploads that were started and never completed (older than `olderThanMs`). */
  abstract abortStaleMultipartUploads(olderThanMs: number): Promise<number>;
}
