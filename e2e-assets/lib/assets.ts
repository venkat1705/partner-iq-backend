/** Shared helpers for the asset scenarios: quota setup, uploads, and the three independent views (API, DB, S3). */
import { api, ApiResult } from './api';
import { sql, sqlOne } from './db';
import { Proof } from './proof';
import { listKeys } from './s3';
import { as } from './session';
import { upload, UploadOptions, UploadResult } from './upload';

export const MB = 1024 * 1024;
export const GB = 1024 * MB;
export const TEN_MB = 10 * MB;
export const DEFAULT_LIMIT = 3221225472;

export const orgPath = (org: string, p: string) => `/organizations/${org}${p}`;

export async function setLimit(org: string, limitBytes: number, proof?: Proof, reason = 'e2e test limit') {
  const admin = await as('PLATFORM_ADMIN');
  const r = await api('PATCH', `/admin/storage/organizations/${org}/limit`, { token: admin.token, body: { limitBytes, reason } });
  proof?.http('PATCH', `/admin/storage/organizations/${org}/limit`, r, { limitBytes, reason });
  if (r.status >= 300) throw new Error(`setLimit ${r.status} ${JSON.stringify(r.body)}`);
  return r;
}

export async function runJob(job: 'cleanup-reservations' | 'purge-trash' | 'reconcile' | 'process-deletions', proof?: Proof) {
  const admin = await as('PLATFORM_ADMIN');
  const r = await api('POST', `/admin/storage/jobs/${job}/run`, { token: admin.token, timeoutMs: 600_000 });
  proof?.http('POST', `/admin/storage/jobs/${job}/run`, r);
  return r;
}

export async function usage(org: string, role = 'ORG_A_OWNER'): Promise<ApiResult<any>> {
  const s = await as(role);
  return api('GET', orgPath(org, '/storage/usage'), { token: s.token });
}

export async function dbStorage(org: string) {
  const row = await sqlOne<any>(`SELECT limitBytes, usedBytes, reservedBytes, activeUploads FROM organization_storage WHERE organizationId = ?`, [org]);
  return row ? { limitBytes: Number(row.limitBytes), usedBytes: Number(row.usedBytes), reservedBytes: Number(row.reservedBytes), activeUploads: Number(row.activeUploads) } : null;
}

/** Sum of sizes of the objects that count toward the quota (database view). */
export async function dbCountedBytes(org: string) {
  const row = await sqlOne<any>(`SELECT COALESCE(SUM(sizeBytes),0) b, COUNT(*) n FROM stored_objects WHERE organizationId = ? AND countsTowardQuota = 1`, [org]);
  return { bytes: Number(row.b), count: Number(row.n) };
}

/** Sum of sizes of the original/version objects in the bucket (S3 view, thumbnails excluded). */
export async function s3AssetBytes(org: string) {
  const keys = await listKeys(`orgs/${org}/assets/`);
  return { bytes: keys.reduce((s, k) => s + k.size, 0), count: keys.length, keys };
}

export async function openReservations(org: string) {
  return sql<any>(`SELECT id, bytes, status, purpose, createdAt FROM storage_reservations WHERE organizationId = ? AND status = 'RESERVED'`, [org]);
}

/** Proof block with the three views side by side. */
export async function threeViews(proof: Proof, org: string, label: string, role = 'ORG_A_OWNER') {
  const u = await usage(org, role);
  const d = await dbStorage(org);
  const counted = await dbCountedBytes(org);
  const s3 = await s3AssetBytes(org);
  proof.h(`${label}: API / DB / S3`);
  proof.http('GET', orgPath(org, '/storage/usage'), { ...u, body: u.data ? pickUsage(u.data) : u.body });
  proof.sql(`SELECT limitBytes, usedBytes, reservedBytes, activeUploads FROM organization_storage WHERE organizationId='${org}'`, d);
  proof.sql(`SELECT SUM(sizeBytes), COUNT(*) FROM stored_objects WHERE organizationId='${org}' AND countsTowardQuota=1`, counted);
  proof.note(`S3 (MinIO, independent client) orgs/${org}/assets/: ${s3.count} objects, ${s3.bytes} bytes`);
  return { api: u.data, db: d, counted, s3 };
}

export function pickUsage(u: any) {
  return u && { limitBytes: u.limitBytes, usedBytes: u.usedBytes, reservedBytes: u.reservedBytes, availableBytes: u.availableBytes, percentUsed: u.percentUsed, overLimit: u.overLimit, activeUploads: u.activeUploads, breakdown: u.breakdown, counts: u.counts };
}

export async function uploadAsset(org: string, role: string, opts: Omit<UploadOptions, 'token'> & { name?: string; assetType?: string; status?: string }): Promise<UploadResult> {
  const s = await as(role);
  const fields = { name: opts.name || opts.fileName, assetType: opts.assetType || 'IMAGE', status: opts.status || 'PUBLISHED', ...(opts.fields || {}) };
  return upload(orgPath(org, '/assets/upload'), { ...opts, token: s.token, fields });
}

export async function uploadVersion(org: string, role: string, assetId: string, opts: Omit<UploadOptions, 'token'>): Promise<UploadResult> {
  const s = await as(role);
  return upload(orgPath(org, `/assets/${assetId}/versions/upload`), { ...opts, token: s.token });
}

export function proofUpload(proof: Proof, label: string, path: string, r: UploadResult, meta: Record<string, unknown>) {
  proof.note(`> POST ${path} multipart ${JSON.stringify(meta)}`);
  const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  proof.note(`< HTTP ${r.status} (${r.ms.toFixed(0)} ms, ${r.sentBytes} body bytes sent${r.error ? `, client error: ${r.error}` : ''})\n< ${body && body.length > 1500 ? body.slice(0, 1500) + ' …' : body}`);
}

/** Permanently deletes every asset of an organization through the API (test data only) and checks it is empty. */
export async function wipeOrg(org: string, role = 'ORG_A_OWNER') {
  const s = await as(role);
  for (let i = 0; i < 50; i++) {
    const list = await api('GET', orgPath(org, '/assets?limit=100'), { token: s.token });
    const ids: string[] = listData(list).map((a: any) => a.id);
    if (!ids.length) break;
    for (const id of ids) await api('DELETE', orgPath(org, `/assets/${id}`), { token: s.token });
  }
  await api('POST', orgPath(org, '/assets/trash/empty'), { token: s.token, timeoutMs: 600_000 });
  const bundles = await api('GET', orgPath(org, '/asset-bundles'), { token: s.token });
  for (const b of (bundles.data || []) as any[]) await api('DELETE', orgPath(org, `/asset-bundles/${b.id}`), { token: s.token });
}

export function listData(r: ApiResult<any>): any[] {
  if (Array.isArray(r.data)) return r.data;
  if (Array.isArray(r.body?.data)) return r.body.data;
  if (Array.isArray(r.body)) return r.body;
  return r.data?.data || [];
}
