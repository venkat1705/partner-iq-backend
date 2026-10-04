/**
 * S3 implementation of StorageService (AWS S3 and S3-compatible services such as MinIO or Cloudflare R2).
 * This is the only file in the backend that imports the AWS SDK. The S3 client is created once, here.
 */
import {
  AbortMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetPublicAccessBlockCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  PutPublicAccessBlockCommand,
  S3Client,
  type ServerSideEncryption,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Readable, Transform, TransformCallback, pipeline } from 'stream';
import { ALLOWED_FILE_TYPES, FileTypeId, SNIFF_BYTES, sniffFileType } from '../content-sniffer';
import { PublicStorageSettings, StorageConfig, publicSettings } from '../storage.config';
import {
  StorageAccessDeniedError,
  StorageError,
  StorageIntegrityError,
  StorageNotFoundError,
  StorageRejectedTypeError,
  StorageTimeoutError,
  StorageTooLargeError,
  StorageUnavailableError,
  StorageUploadAbortedError,
} from '../storage.errors';
import { ObjectKeyRef, buildObjectKey, keyBelongsToOrganization, organizationPrefix, parseObjectKey, rootPrefix } from '../storage-keys';
import {
  BucketSettingsReport,
  DownloadUrl,
  DownloadUrlOptions,
  ListedObject,
  ObjectHead,
  StorageContext,
  StorageService,
  StoredObjectInfo,
  UploadStreamInput,
} from '../storage.service';

/** Counts bytes, hashes, enforces the byte limit and decides the file type from the first bytes. */
class UploadInspector extends Transform {
  bytes = 0;
  readonly hash = createHash('sha256');
  fileType?: FileTypeId;
  private head: Buffer[] = [];
  private headLength = 0;

  constructor(private readonly opts: { maxBytes: number; fileName: string; allowed: FileTypeId[] }) {
    super();
  }

  private decide(buffer: Buffer, complete: boolean): Error | null {
    const result = sniffFileType(buffer, this.opts.fileName, this.opts.allowed, complete);
    if (result.ok === false) return new StorageRejectedTypeError((result as { reason: string }).reason);
    this.fileType = result.type;
    this.emit('decided', result.type);
    return null;
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.bytes += chunk.length;
    if (this.bytes > this.opts.maxBytes) {
      cb(new StorageTooLargeError(`The file is larger than the ${this.opts.maxBytes} bytes allowed for this upload.`, this.opts.maxBytes));
      return;
    }
    this.hash.update(chunk);
    if (this.fileType) {
      cb(null, chunk);
      return;
    }
    this.head.push(chunk);
    this.headLength += chunk.length;
    if (this.headLength < SNIFF_BYTES) {
      cb();
      return;
    }
    const buffer = Buffer.concat(this.head);
    this.head = [];
    const error = this.decide(buffer, false);
    if (error) cb(error);
    else cb(null, buffer);
  }

  _flush(cb: TransformCallback) {
    if (this.fileType) {
      cb();
      return;
    }
    const buffer = Buffer.concat(this.head);
    this.head = [];
    const error = this.decide(buffer, true);
    if (error) cb(error);
    else cb(null, buffer);
  }
}

function contentDisposition(disposition: 'attachment' | 'inline', fileName: string): string {
  const cleaned = (fileName || 'download').replace(/[\r\n"\\]/g, '').split(/[\\/]/).pop() || 'download';
  const ascii = cleaned.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 150) || 'download';
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned.slice(0, 200))}`;
}

export class S3StorageProvider extends StorageService {
  private readonly logger = new Logger('StorageService');
  private readonly client: S3Client;
  readonly settings: Readonly<PublicStorageSettings>;

  constructor(private readonly config: StorageConfig) {
    super();
    this.settings = Object.freeze(publicSettings(config));
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: config.credentials,
      // temporary errors (throttling, 5xx, connection resets) are retried with exponential backoff — here only
      maxAttempts: config.retryMaxAttempts,
      retryMode: 'standard',
      requestHandler: { requestTimeout: config.requestTimeoutMs, connectionTimeout: 10_000 },
    });
  }

  // ───────────────────────── keys ─────────────────────────

  buildKey(ref: ObjectKeyRef): string {
    return buildObjectKey(ref, this.config.keyPrefix);
  }

  keyBelongsToOrganization(key: string, organizationId: string): boolean {
    return keyBelongsToOrganization(key, organizationId, this.config.keyPrefix);
  }

  private assertOwnKey(key: string) {
    if (!parseObjectKey(key, this.config.keyPrefix)) throw new StorageNotFoundError('Unknown storage key.');
  }

  // ───────────────────────── errors ─────────────────────────

  /** Convert any provider/network error to the application's storage errors. */
  private mapError(err: any): StorageError {
    if (err instanceof StorageError) return err;
    const name = String(err?.name || err?.Code || '');
    const code = String(err?.code || err?.cause?.code || '');
    const status = Number(err?.$metadata?.httpStatusCode || 0);
    if (['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(name) || status === 404) return new StorageNotFoundError();
    if (['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'Forbidden', 'AllAccessDisabled'].includes(name) || status === 403) return new StorageAccessDeniedError();
    if (['EntityTooLarge'].includes(name)) return new StorageTooLargeError('The file is too large for storage.');
    if (['TimeoutError', 'RequestTimeout', 'RequestTimeoutException'].includes(name) || ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code)) return new StorageTimeoutError();
    if (name === 'AbortError') return new StorageUploadAbortedError();
    if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'EPIPE', 'EAI_AGAIN'].includes(code) || status >= 500 || name === 'ServiceUnavailable') return new StorageUnavailableError();
    return new StorageUnavailableError();
  }

  private log(op: string, ctx: StorageContext, key: string, result: string, extra: Record<string, unknown> = {}) {
    // never log credentials or signed URLs
    const details = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ');
    this.logger.log(`op=${op} org=${ctx.organizationId} key=${key} result=${result}${details ? ' ' + details : ''}`);
  }

  private sse() {
    if (this.config.encryption === 'none') return {};
    return {
      ServerSideEncryption: this.config.encryption as ServerSideEncryption,
      ...(this.config.encryption === 'aws:kms' ? { SSEKMSKeyId: this.config.kmsKeyId } : {}),
    };
  }

  // ───────────────────────── uploads ─────────────────────────

  async uploadStream(input: UploadStreamInput): Promise<StoredObjectInfo> {
    const started = Date.now();
    const allowed = input.allowedTypes.filter((t) => this.config.allowedFileTypes.includes(t));
    const maxBytes = Math.min(input.maxBytes, this.config.maxFileBytes);
    const inspector = new UploadInspector({ maxBytes, fileName: input.originalFileName, allowed });
    let upload: Upload | undefined;
    let failure: Error | undefined;
    const fail = (error: Error) => {
      if (!failure) failure = error;
      inspector.destroy(error);
      input.body.destroy();
    };
    const timer = setTimeout(() => fail(new StorageTimeoutError('The upload took too long and was stopped. Nothing was saved.')), this.config.uploadTimeoutMs);
    const onAbort = () => fail(new StorageUploadAbortedError());
    input.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      // body → inspector; errors on either side destroy both
      pipeline(input.body, inspector, (err) => {
        if (err && !failure) failure = err;
      });

      // wait until the type is known from the first bytes (or the stream ends/fails) before anything goes to storage
      const fileType = await new Promise<FileTypeId>((resolve, reject) => {
        inspector.once('decided', resolve);
        inspector.once('error', reject);
        inspector.once('close', () => reject(failure || new StorageUploadAbortedError()));
      });

      upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.config.bucket,
          Key: input.key,
          Body: inspector,
          ContentType: ALLOWED_FILE_TYPES[fileType].contentType,
          ...this.sse(),
        },
        partSize: this.config.multipartPartBytes,
        queueSize: this.config.multipartQueueSize,
        leavePartsOnError: false,
      });
      const uploadRef = upload;
      inspector.once('error', () => void uploadRef.abort().catch(() => undefined));
      await upload.done();
      if (failure) throw failure;

      const head = await this.headObject(input.key, input);
      if (!head || head.sizeBytes !== inspector.bytes) {
        throw new StorageIntegrityError(`Stored size ${head?.sizeBytes ?? 'missing'} does not match the ${inspector.bytes} bytes received.`);
      }
      const info: StoredObjectInfo = {
        key: input.key,
        sizeBytes: inspector.bytes,
        checksumSha256: inspector.hash.digest('hex'),
        contentType: ALLOWED_FILE_TYPES[fileType].contentType,
        fileType,
      };
      this.log('upload', input, input.key, 'ok', { bytes: info.sizeBytes, type: fileType, ms: Date.now() - started });
      return info;
    } catch (err: any) {
      const mapped = this.mapError(failure || err);
      if (upload) await upload.abort().catch(() => undefined);
      // a single-part upload may already have completed — never leave an object behind
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: input.key })).catch(() => undefined);
      this.log('upload', input, input.key, 'failed', { code: mapped.code, bytes: inspector.bytes, ms: Date.now() - started });
      throw mapped;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  async putGeneratedObject(key: string, body: Buffer, contentType: string, ctx: StorageContext): Promise<StoredObjectInfo> {
    this.assertOwnKey(key);
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType, ...this.sse() }));
      this.log('put-generated', ctx, key, 'ok', { bytes: body.length });
      return { key, sizeBytes: body.length, checksumSha256: createHash('sha256').update(body).digest('hex'), contentType, fileType: 'jpeg' };
    } catch (err) {
      const mapped = this.mapError(err);
      this.log('put-generated', ctx, key, 'failed', { code: mapped.code });
      throw mapped;
    }
  }

  // ───────────────────────── downloads ─────────────────────────

  async getDownloadUrl(key: string, options: DownloadUrlOptions): Promise<DownloadUrl> {
    this.assertOwnKey(key);
    const type = (Object.values(ALLOWED_FILE_TYPES) as Array<{ contentType: string; inline: boolean }>).find((t) => t.contentType === options.contentType);
    // only raster images may be shown inline; SVG/HTML/anything else is always a download
    const disposition = options.disposition === 'inline' && type?.inline ? 'inline' : 'attachment';
    const expiresIn = Math.min(options.expiresInSeconds ?? this.config.downloadUrlTtlSeconds, this.config.downloadUrlTtlSeconds);
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(disposition, options.fileName),
        ResponseContentType: type ? options.contentType : 'application/octet-stream',
        ResponseCacheControl: 'private, max-age=0, no-store',
      }),
      { expiresIn },
    );
    this.log('sign-download', options, key, 'ok', { ttl: expiresIn, disposition });
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), disposition };
  }

  async getObjectStream(key: string, ctx: StorageContext): Promise<Readable> {
    this.assertOwnKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      this.log('get', ctx, key, 'ok', { bytes: res.ContentLength });
      return res.Body as Readable;
    } catch (err) {
      const mapped = this.mapError(err);
      this.log('get', ctx, key, 'failed', { code: mapped.code });
      throw mapped;
    }
  }

  async headObject(key: string, ctx: StorageContext): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return { sizeBytes: Number(res.ContentLength ?? 0), contentType: res.ContentType, lastModified: res.LastModified };
    } catch (err) {
      const mapped = this.mapError(err);
      if (mapped instanceof StorageNotFoundError) return null;
      this.log('head', ctx, key, 'failed', { code: mapped.code });
      throw mapped;
    }
  }

  // ───────────────────────── delete / copy / list ─────────────────────────

  async deleteObject(key: string, ctx: StorageContext): Promise<void> {
    this.assertOwnKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
      this.log('delete', ctx, key, 'ok');
    } catch (err) {
      const mapped = this.mapError(err);
      this.log('delete', ctx, key, 'failed', { code: mapped.code });
      throw mapped;
    }
  }

  async deleteObjects(keys: string[], ctx: StorageContext): Promise<{ deleted: number; failed: string[] }> {
    const failed: string[] = [];
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      batch.forEach((k) => this.assertOwnKey(k));
      try {
        const res = await this.client.send(new DeleteObjectsCommand({ Bucket: this.config.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
        const errors = (res.Errors || []).map((e) => e.Key!).filter(Boolean);
        failed.push(...errors);
        deleted += batch.length - errors.length;
      } catch (err) {
        failed.push(...batch);
        this.log('delete-many', ctx, `${batch.length} keys`, 'failed', { code: this.mapError(err).code });
      }
    }
    this.log('delete-many', ctx, `${keys.length} keys`, failed.length ? 'partial' : 'ok', { deleted, failed: failed.length });
    return { deleted, failed };
  }

  async copyObject(fromKey: string, toKey: string, ctx: StorageContext): Promise<void> {
    this.assertOwnKey(fromKey);
    this.assertOwnKey(toKey);
    try {
      await this.client.send(new CopyObjectCommand({ Bucket: this.config.bucket, Key: toKey, CopySource: `${this.config.bucket}/${encodeURIComponent(fromKey).replace(/%2F/g, '/')}`, ...this.sse() }));
      this.log('copy', ctx, toKey, 'ok', { from: fromKey });
    } catch (err) {
      const mapped = this.mapError(err);
      this.log('copy', ctx, toKey, 'failed', { code: mapped.code });
      throw mapped;
    }
  }

  async *listObjects(organizationId?: string): AsyncIterable<ListedObject> {
    const Prefix = organizationId ? organizationPrefix(organizationId, this.config.keyPrefix) : rootPrefix(this.config.keyPrefix);
    let ContinuationToken: string | undefined;
    do {
      let res;
      try {
        res = await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix, ContinuationToken, MaxKeys: 1000 }));
      } catch (err) {
        throw this.mapError(err);
      }
      for (const o of res.Contents || []) yield { key: o.Key!, sizeBytes: Number(o.Size ?? 0), lastModified: o.LastModified };
      ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (ContinuationToken);
  }

  async abortStaleMultipartUploads(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    let aborted = 0;
    let KeyMarker: string | undefined;
    let UploadIdMarker: string | undefined;
    do {
      const res = await this.client
        .send(new ListMultipartUploadsCommand({ Bucket: this.config.bucket, Prefix: rootPrefix(this.config.keyPrefix), KeyMarker, UploadIdMarker }))
        .catch((err) => { throw this.mapError(err); });
      for (const u of res.Uploads || []) {
        if (u.Initiated && u.Initiated.getTime() < cutoff) {
          await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.config.bucket, Key: u.Key!, UploadId: u.UploadId! })).catch(() => undefined);
          aborted += 1;
        }
      }
      KeyMarker = res.IsTruncated ? res.NextKeyMarker : undefined;
      UploadIdMarker = res.IsTruncated ? res.NextUploadIdMarker : undefined;
    } while (KeyMarker);
    this.logger.log(`op=abort-stale-multipart result=ok aborted=${aborted}`);
    return aborted;
  }

  // ───────────────────────── bucket settings ─────────────────────────

  async ensureBucketSettings(): Promise<BucketSettingsReport> {
    const Bucket = this.config.bucket;
    const exists = await this.client.send(new HeadBucketCommand({ Bucket })).then(() => true).catch(() => false);
    if (!exists) await this.client.send(new CreateBucketCommand({ Bucket })).catch((err) => { throw this.mapError(err); });
    const notes: string[] = [];
    await this.client
      .send(new PutPublicAccessBlockCommand({ Bucket, PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }))
      .catch((err) => notes.push(`PutPublicAccessBlock: ${err?.name || err} (S3-compatible services without this API rely on having no bucket policy and no ACL grants)`));
    if (this.config.encryption !== 'none') {
      await this.client
        .send(new PutBucketEncryptionCommand({
          Bucket,
          ServerSideEncryptionConfiguration: {
            Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: this.config.encryption as ServerSideEncryption, ...(this.config.kmsKeyId ? { KMSMasterKeyID: this.config.kmsKeyId } : {}) }, BucketKeyEnabled: this.config.encryption === 'aws:kms' }],
          },
        }))
        .catch((err) => notes.push(`PutBucketEncryption: ${err?.name || err}`));
    }
    await this.client
      .send(new PutBucketLifecycleConfigurationCommand({
        Bucket,
        LifecycleConfiguration: { Rules: [{ ID: 'abort-incomplete-multipart-uploads', Status: 'Enabled', Filter: { Prefix: '' }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] },
      }))
      .catch((err) => notes.push(`PutBucketLifecycleConfiguration: ${err?.name || err}`));
    const report = await this.describeBucketSettings();
    if (notes.length) (report as any).notes = notes;
    return report;
  }

  async describeBucketSettings(): Promise<BucketSettingsReport> {
    const Bucket = this.config.bucket;
    const safe = async <T>(fn: () => Promise<T>) => fn().catch((err: any) => `${err?.name || 'Error'}: ${err?.message || err}`);
    const pab = await safe(async () => (await this.client.send(new GetPublicAccessBlockCommand({ Bucket }))).PublicAccessBlockConfiguration as Record<string, unknown>);
    const policy = await safe(async () => (await this.client.send(new GetBucketPolicyCommand({ Bucket }))).Policy || '(none)');
    const enc = await safe(async () => (await this.client.send(new GetBucketEncryptionCommand({ Bucket }))).ServerSideEncryptionConfiguration as unknown as Record<string, unknown>);
    const lifecycle = await safe(async () => ({ Rules: (await this.client.send(new GetBucketLifecycleConfigurationCommand({ Bucket }))).Rules }) as Record<string, unknown>);
    const versioning = await safe(async () => (await this.client.send(new GetBucketVersioningCommand({ Bucket }))).Status || 'Never enabled');
    let anonymousReadProbe: BucketSettingsReport['anonymousReadProbe'];
    if (this.config.endpoint) {
      const res = await fetch(`${this.config.endpoint.replace(/\/$/, '')}/${Bucket}/`).catch(() => null);
      if (res) anonymousReadProbe = { status: res.status, body: (await res.text()).slice(0, 200) };
    }
    return {
      bucket: Bucket,
      publicAccessBlock: pab,
      bucketPolicy: typeof policy === 'string' ? policy : JSON.stringify(policy),
      encryption: enc,
      lifecycle,
      versioning: String(versioning),
      anonymousReadProbe,
    };
  }
}
