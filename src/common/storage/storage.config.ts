/**
 * The ONE storage configuration. Every storage setting (provider, bucket, region, endpoint, credentials, key prefix,
 * size limits, file types, link expiry, timeouts, encryption, retries, the default organization limit and the upload
 * concurrency) is read and validated here. Change storage behaviour by changing these environment variables; no
 * feature module reads STORAGE_* variables itself.
 */
import { ALLOWED_FILE_TYPES, FileTypeId } from './content-sniffer';

export type StorageProviderName = 's3';
export type StorageEncryption = 'AES256' | 'aws:kms' | 'none';

export interface StorageConfig {
  provider: StorageProviderName;
  bucket: string;
  region: string;
  /** S3-compatible endpoint (MinIO, R2 …); empty for AWS. */
  endpoint?: string;
  forcePathStyle: boolean;
  /** Static credentials, or undefined when the IAM role / instance profile is used. */
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /** Optional prefix in front of every key, e.g. "staging" → "staging/orgs/…". No leading/trailing slash. */
  keyPrefix: string;
  /** Per-file limit for assets and versions (bytes). */
  maxFileBytes: number;
  /** Per-file limit for logos/banners/avatars (bytes). */
  maxImageBytes: number;
  /** File types accepted for assets (detected from the content, not the extension). */
  allowedFileTypes: FileTypeId[];
  /** Lifetime of signed download links (seconds). */
  downloadUrlTtlSeconds: number;
  /** Abort an upload stream that takes longer than this (ms). */
  uploadTimeoutMs: number;
  /** Per-request socket timeout towards the storage service (ms). */
  requestTimeoutMs: number;
  encryption: StorageEncryption;
  kmsKeyId?: string;
  /** Attempts for temporary storage errors (SDK standard retry mode, exponential backoff). */
  retryMaxAttempts: number;
  /** Default per-organization storage limit (bytes) for organizations without their own limit row. */
  defaultOrganizationLimitBytes: number;
  /** Uploads one organization may run at the same time. */
  maxConcurrentUploadsPerOrganization: number;
  /** Reservations older than this are released by the cleanup job (minutes). */
  reservationTtlMinutes: number;
  /** Trashed files are permanently deleted after this many days. */
  trashRetentionDays: number;
  /** Multipart part size used for large uploads (bytes); memory per upload ≈ partSize × queueSize. */
  multipartPartBytes: number;
  multipartQueueSize: number;
}

export class StorageConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid storage configuration — the backend cannot start:\n  - ${problems.join('\n  - ')}\nSee .env.example (STORAGE_* variables) and docs/storage-setup.md.`);
    this.name = 'StorageConfigError';
  }
}

const MB = 1024 * 1024;
const DEFAULTS = {
  maxFileBytes: 200 * MB, // existing per-file limit of the asset library (kept, decision A6)
  maxImageBytes: 5 * MB, // existing limit of the image upload path (kept)
  downloadUrlTtlSeconds: 300,
  uploadTimeoutMs: 30 * 60 * 1000,
  requestTimeoutMs: 120_000,
  retryMaxAttempts: 3,
  defaultOrganizationLimitBytes: 3_221_225_472, // 3 GB
  maxConcurrentUploadsPerOrganization: 5,
  reservationTtlMinutes: 60,
  trashRetentionDays: 30,
  multipartPartBytes: 8 * MB,
  multipartQueueSize: 2,
};

/** AWS region names (us-east-1, eu-west-2, ap-southeast-1, us-gov-west-1, …). */
const REGION_PATTERN = /^[a-z]{2}(-gov|-iso[a-z]?)?-[a-z]+-\d{1,2}$/;
/** S3 bucket naming rules (3–63 chars, lowercase letters, digits, dots, hyphens, starts/ends with letter/digit). */
const BUCKET_PATTERN = /^(?!xn--)(?!.*\.\.)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PREFIX_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,99}$/;

function intVar(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number, problems: string[]) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    problems.push(`${name} must be a whole number (got "${raw}")`);
    return fallback;
  }
  const value = Number(raw.trim());
  if (value < min || value > max) problems.push(`${name} must be between ${min} and ${max} (got ${value})`);
  return value;
}

export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const problems: string[] = [];
  const provider = (env.STORAGE_PROVIDER || 's3').trim().toLowerCase();
  if (provider !== 's3') problems.push(`STORAGE_PROVIDER must be "s3" (got "${env.STORAGE_PROVIDER}")`);

  const bucket = (env.STORAGE_BUCKET || '').trim();
  if (!bucket) problems.push('STORAGE_BUCKET is required (name of the private bucket that holds every uploaded file)');
  else if (!BUCKET_PATTERN.test(bucket)) problems.push(`STORAGE_BUCKET "${bucket}" is not a valid S3 bucket name (3–63 lowercase letters, digits, dots or hyphens)`);

  const region = (env.STORAGE_REGION || '').trim();
  if (!region) problems.push('STORAGE_REGION is required (e.g. ap-south-1; use us-east-1 for MinIO)');
  else if (!REGION_PATTERN.test(region)) problems.push(`STORAGE_REGION "${region}" is not a valid region name (expected e.g. ap-south-1)`);

  const endpoint = (env.STORAGE_ENDPOINT || '').trim() || undefined;
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
    } catch {
      problems.push(`STORAGE_ENDPOINT "${endpoint}" is not a valid http(s) URL`);
    }
  }
  const forcePathStyle = env.STORAGE_FORCE_PATH_STYLE ? env.STORAGE_FORCE_PATH_STYLE === 'true' : Boolean(endpoint);

  const accessKeyId = (env.STORAGE_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (env.STORAGE_SECRET_ACCESS_KEY || '').trim();
  const useIamRole = (env.STORAGE_USE_IAM_ROLE || '').trim() === 'true';
  let credentials: StorageConfig['credentials'];
  if (accessKeyId || secretAccessKey) {
    if (!accessKeyId) problems.push('STORAGE_ACCESS_KEY_ID is missing (STORAGE_SECRET_ACCESS_KEY is set)');
    if (!secretAccessKey) problems.push('STORAGE_SECRET_ACCESS_KEY is missing (STORAGE_ACCESS_KEY_ID is set)');
    if (useIamRole) problems.push('set either STORAGE_USE_IAM_ROLE=true or static keys, not both');
    credentials = { accessKeyId, secretAccessKey };
  } else if (!useIamRole) {
    problems.push('storage credentials are missing: set STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY, or STORAGE_USE_IAM_ROLE=true to use the instance/task role');
  }

  const keyPrefix = (env.STORAGE_KEY_PREFIX || '').trim().replace(/^\/+|\/+$/g, '');
  if (keyPrefix && (!PREFIX_PATTERN.test(keyPrefix) || keyPrefix.includes('..'))) {
    problems.push(`STORAGE_KEY_PREFIX "${env.STORAGE_KEY_PREFIX}" may contain only lowercase letters, digits, "-", "_" and "/"`);
  }

  const allowedRaw = (env.STORAGE_ALLOWED_FILE_TYPES || '').trim();
  let allowedFileTypes = Object.keys(ALLOWED_FILE_TYPES) as FileTypeId[];
  if (allowedRaw) {
    const requested = allowedRaw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    const unknown = requested.filter((t) => !(t in ALLOWED_FILE_TYPES));
    if (unknown.length) problems.push(`STORAGE_ALLOWED_FILE_TYPES contains unsupported types: ${unknown.join(', ')} (supported: ${Object.keys(ALLOWED_FILE_TYPES).join(', ')})`);
    allowedFileTypes = requested.filter((t) => t in ALLOWED_FILE_TYPES) as FileTypeId[];
  }

  const encryptionRaw = (env.STORAGE_ENCRYPTION || 'AES256').trim();
  const encryption = (['AES256', 'aws:kms', 'none'].includes(encryptionRaw) ? encryptionRaw : 'AES256') as StorageEncryption;
  if (!['AES256', 'aws:kms', 'none'].includes(encryptionRaw)) problems.push(`STORAGE_ENCRYPTION must be AES256, aws:kms or none (got "${encryptionRaw}")`);
  const kmsKeyId = (env.STORAGE_KMS_KEY_ID || '').trim() || undefined;
  if (encryption === 'aws:kms' && !kmsKeyId) problems.push('STORAGE_KMS_KEY_ID is required when STORAGE_ENCRYPTION=aws:kms');

  const config: StorageConfig = {
    provider: 's3',
    bucket,
    region,
    endpoint,
    forcePathStyle,
    credentials,
    keyPrefix,
    maxFileBytes: intVar(env, 'STORAGE_MAX_FILE_BYTES', DEFAULTS.maxFileBytes, 1, 5 * 1024 * MB, problems),
    maxImageBytes: intVar(env, 'STORAGE_MAX_IMAGE_BYTES', DEFAULTS.maxImageBytes, 1, 100 * MB, problems),
    allowedFileTypes,
    downloadUrlTtlSeconds: intVar(env, 'STORAGE_DOWNLOAD_URL_TTL_SECONDS', DEFAULTS.downloadUrlTtlSeconds, 1, 3600, problems),
    uploadTimeoutMs: intVar(env, 'STORAGE_UPLOAD_TIMEOUT_MS', DEFAULTS.uploadTimeoutMs, 1000, 6 * 3600 * 1000, problems),
    requestTimeoutMs: intVar(env, 'STORAGE_REQUEST_TIMEOUT_MS', DEFAULTS.requestTimeoutMs, 1000, 3600 * 1000, problems),
    encryption,
    kmsKeyId,
    retryMaxAttempts: intVar(env, 'STORAGE_RETRY_MAX_ATTEMPTS', DEFAULTS.retryMaxAttempts, 1, 10, problems),
    defaultOrganizationLimitBytes: intVar(env, 'STORAGE_DEFAULT_ORG_LIMIT_BYTES', DEFAULTS.defaultOrganizationLimitBytes, 0, Number.MAX_SAFE_INTEGER, problems),
    maxConcurrentUploadsPerOrganization: intVar(env, 'STORAGE_MAX_CONCURRENT_UPLOADS_PER_ORG', DEFAULTS.maxConcurrentUploadsPerOrganization, 1, 100, problems),
    reservationTtlMinutes: intVar(env, 'STORAGE_RESERVATION_TTL_MINUTES', DEFAULTS.reservationTtlMinutes, 1, 24 * 60, problems),
    trashRetentionDays: intVar(env, 'STORAGE_TRASH_RETENTION_DAYS', DEFAULTS.trashRetentionDays, 1, 3650, problems),
    multipartPartBytes: intVar(env, 'STORAGE_MULTIPART_PART_BYTES', DEFAULTS.multipartPartBytes, 5 * MB, 512 * MB, problems),
    multipartQueueSize: intVar(env, 'STORAGE_MULTIPART_QUEUE_SIZE', DEFAULTS.multipartQueueSize, 1, 16, problems),
  };
  if (config.maxImageBytes > config.maxFileBytes) problems.push('STORAGE_MAX_IMAGE_BYTES must not be larger than STORAGE_MAX_FILE_BYTES');

  if (problems.length) throw new StorageConfigError(problems);
  return config;
}

/** The settings features may read (limits, types, expiry). Never contains credentials or the bucket. */
export interface PublicStorageSettings {
  maxFileBytes: number;
  maxImageBytes: number;
  allowedFileTypes: FileTypeId[];
  allowedExtensions: string[];
  downloadUrlTtlSeconds: number;
  defaultOrganizationLimitBytes: number;
  maxConcurrentUploadsPerOrganization: number;
  reservationTtlMinutes: number;
  trashRetentionDays: number;
  uploadTimeoutMs: number;
}

export function publicSettings(config: StorageConfig): PublicStorageSettings {
  return {
    maxFileBytes: config.maxFileBytes,
    maxImageBytes: config.maxImageBytes,
    allowedFileTypes: [...config.allowedFileTypes],
    allowedExtensions: config.allowedFileTypes.flatMap((t) => ALLOWED_FILE_TYPES[t].extensions),
    downloadUrlTtlSeconds: config.downloadUrlTtlSeconds,
    defaultOrganizationLimitBytes: config.defaultOrganizationLimitBytes,
    maxConcurrentUploadsPerOrganization: config.maxConcurrentUploadsPerOrganization,
    reservationTtlMinutes: config.reservationTtlMinutes,
    trashRetentionDays: config.trashRetentionDays,
    uploadTimeoutMs: config.uploadTimeoutMs,
  };
}
