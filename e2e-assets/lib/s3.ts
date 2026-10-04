/**
 * Independent view of the bucket for assertions (tests only — the backend's own storage access is in
 * src/common/storage). Uses the backend's .env credentials; never logs them.
 */
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(path.resolve(__dirname, '..', '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { ...out, ...(process.env as Record<string, string>) };
}
const e = env();
export const BUCKET = () => process.env.STORAGE_BUCKET || e.STORAGE_BUCKET;
export const ENDPOINT = e.STORAGE_ENDPOINT;
let client: S3Client | undefined;
function s3() {
  client ??= new S3Client({ region: e.STORAGE_REGION, endpoint: e.STORAGE_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: e.STORAGE_ACCESS_KEY_ID, secretAccessKey: e.STORAGE_SECRET_ACCESS_KEY } });
  return client;
}
export async function listKeys(prefix: string, bucket = BUCKET()) {
  const out: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const r = await s3().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents || []) out.push({ key: o.Key!, size: Number(o.Size) });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
export async function head(key: string, bucket = BUCKET()) {
  try {
    const r = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: Number(r.ContentLength), contentType: r.ContentType, sse: r.ServerSideEncryption };
  } catch {
    return null;
  }
}
export async function sha256Of(key: string, bucket = BUCKET()) {
  const r = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const h = crypto.createHash('sha256');
  for await (const c of r.Body as any) h.update(c);
  return h.digest('hex');
}
/** Writes an object directly (reconciliation tests: an object with no database record). */
export async function putRaw(key: string, body: Buffer, bucket = BUCKET()) {
  await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
}
export const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
