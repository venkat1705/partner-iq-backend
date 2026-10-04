# File storage — setup and how to change it

All file storage goes through **one module**: `src/common/storage/` (`StorageModule`, global, exports
`StorageService`). Features (assets, versions, bundles/ZIPs, thumbnails, logos, banners, avatars) call
`StorageService` methods only; they never see the S3 client, the bucket, SDK types or credentials.
ESLint (`npm run lint:architecture`) and `test/unit/storage-architecture.spec.ts` fail when any other file imports the
AWS SDK or writes files to local disk.

## Files of the storage module

| File | What it owns |
|---|---|
| `storage.config.ts` | the one typed config, read from `STORAGE_*` env vars and validated at startup (the backend refuses to start with a clear message) |
| `storage-keys.ts` | the one key builder/parser — key layout lives only here |
| `content-sniffer.ts` | allowed file types and magic-byte detection; which types may be shown inline (raster images only) |
| `storage.service.ts` | the interface features use |
| `providers/s3-storage.provider.ts` | the only file that imports the AWS SDK; S3 client created once; streaming upload, signed URLs, error mapping, retries, logging, bucket settings |
| `zip-stream.ts` | streaming ZIP writer (bundle downloads) |
| `storage.errors.ts` | the app's storage errors (not found, access denied, timeout, too large, wrong type, aborted, unavailable) |
| `cli/setup-bucket.ts` | `npm run storage:setup` / `npm run storage:describe` |

## Key layout (`storage-keys.ts`)

```
{prefix/}orgs/{organizationId}/assets/{assetId}/v{version}/{random}
{prefix/}orgs/{organizationId}/thumbnails/{assetId}/{size}/{random}
{prefix/}orgs/{organizationId}/media/{purpose}/{random}        logos, banners
{prefix/}users/{userId}/avatars/{random}                     user-level (not organization data)
```

The user's file name is never part of a key; it is stored in the database and used only in `Content-Disposition`.

## Bucket settings

Apply with `npm run build && npm run storage:setup` (needs the `STORAGE_*` variables); `npm run storage:describe`
prints what the storage service reports.

| Setting | Value | Applied by |
|---|---|---|
| Block Public Access | all four flags on | `PutPublicAccessBlock` (AWS). MinIO has no such API: the bucket has no bucket policy and no anonymous access, verified by an unsigned request returning 403 (`storage:describe` → `anonymousReadProbe`) |
| Default encryption | SSE-S3 (`AES256`); SSE-KMS with `STORAGE_ENCRYPTION=aws:kms` + `STORAGE_KMS_KEY_ID` | `PutBucketEncryption` + `ServerSideEncryption` on every upload |
| Abort incomplete multipart uploads | after 1 day | lifecycle rule `abort-incomplete-multipart-uploads` (AWS). MinIO rejects this rule without an expiration action, so on MinIO the same is achieved by `MINIO_API_STALE_UPLOADS_EXPIRY=24h` and by the app's cleanup job, which aborts multipart uploads older than 1 day through `StorageService.abortStaleMultipartUploads` |
| Object versioning | off (never enabled) | the app keeps its own versions (`asset_versions`), so S3 versioning would only add hidden, billed copies |

### AWS (equivalent CLI)

```bash
aws s3api create-bucket --bucket $STORAGE_BUCKET --region $STORAGE_REGION --create-bucket-configuration LocationConstraint=$STORAGE_REGION
aws s3api put-public-access-block --bucket $STORAGE_BUCKET --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket $STORAGE_BUCKET --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket $STORAGE_BUCKET --lifecycle-configuration '{"Rules":[{"ID":"abort-incomplete-multipart-uploads","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}'
```

IAM policy for the backend (least privilege): `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`,
`s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts` on `arn:aws:s3:::BUCKET/*`; `s3:ListBucket`,
`s3:ListBucketMultipartUploads`, `s3:GetBucketLocation` on `arn:aws:s3:::BUCKET` (plus the `Get/Put*` bucket-settings
actions only for the role that runs `storage:setup`).

### MinIO (local / test)

MinIO built from source (`go install github.com/minio/minio@…`), started with `MINIO_KMS_SECRET_KEY` (enables SSE-S3)
and `MINIO_API_STALE_UPLOADS_EXPIRY=24h`; the backend uses a separate MinIO user limited to the bucket (policy as above).
`.env`: `STORAGE_ENDPOINT=http://127.0.0.1:9000`, `STORAGE_REGION=us-east-1`, `STORAGE_FORCE_PATH_STYLE=true`.

## Uploads and limits

- Browser → backend (multipart, `X-File-Size` header = file size) → storage. The browser never talks to storage.
- The backend streams with busboy into `@aws-sdk/lib-storage` `Upload` (multipart, part size × queue size of memory);
  nothing is buffered whole or written to disk.
- Request timeout: `STORAGE_UPLOAD_TIMEOUT_MS` (+60 s) on the HTTP server (`src/bootstrap.ts`). JSON body limit stays
  10 MB (uploads do not use the JSON parser).
- There is no reverse proxy config for the API in these repos (the frontend's `docker/nginx.conf` serves static files
  only). If one is added, set `client_max_body_size` to at least `STORAGE_MAX_FILE_BYTES` and `proxy_read_timeout` /
  `proxy_request_buffering off` for `/api/v1/organizations/*/assets/*upload`.
- `api/index.ts` (serverless wrapper) is not suitable for large uploads (serverless request bodies are capped); use the
  container entry point (`node dist/src/main.js`).

## How to change storage in the future

| Change | Edit |
|---|---|
| Bucket, region, endpoint, credentials, key prefix | environment (`STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`/`SECRET`, `STORAGE_KEY_PREFIX`) — no code |
| Per-file limits | `STORAGE_MAX_FILE_BYTES`, `STORAGE_MAX_IMAGE_BYTES` |
| Default organization limit | `STORAGE_DEFAULT_ORG_LIMIT_BYTES` (one organization: platform admin `PATCH /api/v1/admin/storage/organizations/:id/limit`) |
| Allowed file types | `STORAGE_ALLOWED_FILE_TYPES` (subset); a new type: `content-sniffer.ts` (`ALLOWED_FILE_TYPES` + its magic bytes) |
| Link expiry | `STORAGE_DOWNLOAD_URL_TTL_SECONDS` |
| Encryption | `STORAGE_ENCRYPTION`, `STORAGE_KMS_KEY_ID` |
| Retries / timeouts | `STORAGE_RETRY_MAX_ATTEMPTS`, `STORAGE_REQUEST_TIMEOUT_MS`, `STORAGE_UPLOAD_TIMEOUT_MS` |
| Key layout | `storage-keys.ts` (`buildObjectKey` / `parseObjectKey`) |
| A new provider (e.g. Google Cloud Storage) | add `providers/<name>-storage.provider.ts` implementing `StorageService`, add the provider name to `storage.config.ts`, add one `case` in `createStorageService()` (`storage.module.ts`) |
