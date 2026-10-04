/**
 * Copies files that existed before the storage service into it (scenario F).
 *
 *   npm run storage:migrate-legacy                 dry run: lists what would be copied, changes nothing
 *   npm run storage:migrate-legacy -- --apply      copies, verifies, then points the rows at the new objects
 *   options: --org=<organizationId>  --limit=<n>  --media (also logos, banners and avatars)
 *
 * Rules (docs/decisions.md A25):
 * - Only rows whose file is NOT already in this application's storage are touched (re-running is safe).
 * - Sources are fetched only from hosts in STORAGE_MIGRATION_ALLOWED_HOSTS (default res.cloudinary.com), https only
 *   unless STORAGE_MIGRATION_ALLOW_HTTP=true (test environments). No other URL is ever fetched (SSRF).
 * - Every copy goes through StorageService.uploadStream (type check, size limit, SHA-256), then is verified twice:
 *   headObject size = bytes counted, and a re-read of the stored object has the same SHA-256 (and the same size as the
 *   source's Content-Length when it sent one). A failed check deletes the new object and leaves the row unchanged.
 * - Originals are kept: legacy URL columns are not cleared, nothing is deleted at the source; the old URL is recorded
 *   in stored_objects.migratedFrom.
 * - Run it while the backend is stopped, or restart the backend afterwards: programs / organizations / users are also
 *   cached in the backend's in-memory store, which does not see rows changed by this script until it reloads.
 * - Asset files count toward the organization's storage (they may push it over its limit: uploads are then blocked,
 *   nothing is deleted). Media do not count.
 */
import { createHash, randomUUID } from 'crypto';
import { Readable } from 'stream';
import { IsNull } from 'typeorm';
import { initializeDataSource } from '../../../database/data-source';
import { getAppConfig } from '../../../config/app.config';
import { AssetSourceType } from '../../../common/enums';
import { Asset, AssetVersion, Organization, OrganizationBranding, Program, StoredObject, User } from '../../../database/schema';
import { createStorageService, IMAGE_FILE_TYPES, StorageService } from '../../../common/storage';
import type { ObjectKeyRef as StorageObjectRef } from '../../../common/storage/storage-keys';
import { StorageQuotaService } from '../storage-quota.service';
import { inTx, writeAudit } from '../../asset-management/asset-common';

interface Args {
  apply: boolean;
  org?: string;
  limit: number;
  media: boolean;
}

interface ItemResult {
  kind: 'asset-version' | 'asset' | 'media';
  id: string;
  organizationId?: string;
  source?: string;
  status: 'would-copy' | 'copied' | 'skipped' | 'failed';
  bytes?: number;
  reason?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return { apply: argv.includes('--apply'), org: get('org'), limit: Number(get('limit') || 0) || Number.MAX_SAFE_INTEGER, media: argv.includes('--media') };
}

const allowedHosts = () =>
  (process.env.STORAGE_MIGRATION_ALLOWED_HOSTS || 'res.cloudinary.com')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

/** null = the URL may be fetched; otherwise the reason it may not. */
export function sourceProblem(raw: string | null | undefined): string | null {
  if (!raw) return 'no source URL';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'source is not a URL (client-supplied key with no file behind it)';
  }
  const httpOk = process.env.STORAGE_MIGRATION_ALLOW_HTTP === 'true';
  if (url.protocol !== 'https:' && !(httpOk && url.protocol === 'http:')) return `protocol ${url.protocol} not allowed`;
  if (url.username || url.password) return 'credentials in URL';
  if (!allowedHosts().includes(url.host.toLowerCase())) return `host ${url.host} is not in STORAGE_MIGRATION_ALLOWED_HOSTS`;
  return null;
}

function fileNameFrom(url: string, fallback: string) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return last.includes('.') ? last : fallback;
  } catch {
    return fallback;
  }
}

async function sha256Of(stream: Readable) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { sha: hash.digest('hex'), bytes };
}

/** Fetch → stream to storage → verify. Throws with a clear reason; on any failure the new object is deleted. */
async function copyVerified(storage: StorageService, source: string, ref: StorageObjectRef, ctx: { organizationId: string }, fileName: string, maxBytes: number, allowed: string[]) {
  const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(storage.settings.uploadTimeoutMs) });
  if (!response.ok || !response.body) throw new Error(`source answered HTTP ${response.status}`);
  const declared = response.headers.get('content-length');
  const key = storage.buildKey(ref);
  const info = await storage.uploadStream({ key, body: Readable.fromWeb(response.body as any), originalFileName: fileName, maxBytes, allowedTypes: allowed as any, organizationId: ctx.organizationId });
  try {
    const head = await storage.headObject(key, ctx);
    if (!head || head.sizeBytes !== info.sizeBytes) throw new Error(`stored size ${head?.sizeBytes} differs from counted ${info.sizeBytes}`);
    if (declared !== null && Number(declared) !== info.sizeBytes) throw new Error(`source Content-Length ${declared} differs from copied ${info.sizeBytes}`);
    const reread = await sha256Of(await storage.getObjectStream(key, ctx));
    if (reread.sha !== info.checksumSha256 || reread.bytes !== info.sizeBytes) throw new Error('checksum of the stored copy does not match');
    return { key, info };
  } catch (err) {
    await storage.deleteObject(key, ctx).catch(() => undefined);
    throw err;
  }
}

export async function migrateLegacyFiles(args: Args, storage: StorageService = createStorageService()) {
  const ds = await initializeDataSource();
  const quota = new StorageQuotaService(storage);
  const results: ItemResult[] = [];
  const assetsRepo = ds.getRepository(Asset);
  const versionsRepo = ds.getRepository(AssetVersion);

  const candidates = (
    await assetsRepo.find({ where: { sourceType: AssetSourceType.FILE, deletedAt: IsNull(), ...(args.org ? { organizationId: args.org } : {}) }, order: { createdAt: 'ASC' } })
  ).filter((a) => !(a.storageKey && storage.keyBelongsToOrganization(a.storageKey, a.organizationId)));

  for (const asset of candidates.slice(0, args.limit)) {
    const ctx = { organizationId: asset.organizationId };
    const versions = (await versionsRepo.find({ where: { assetId: asset.id }, order: { versionNumber: 'ASC' } })).filter(
      (v) => !(v.storageKey && storage.keyBelongsToOrganization(v.storageKey, asset.organizationId)),
    );
    // asset rows without version rows: the asset row itself is the only copy
    const units: Array<{ version?: AssetVersion; source?: string; n: number }> = versions.length
      ? versions.map((v) => ({ version: v, source: v.storageUrl || (v.versionNumber === asset.version ? asset.storageUrl : undefined), n: v.versionNumber }))
      : [{ source: asset.storageUrl || undefined, n: asset.version || 1 }];

    for (const unit of units) {
      const kind = unit.version ? 'asset-version' : 'asset';
      const id = unit.version?.id || asset.id;
      const problem = sourceProblem(unit.source);
      if (problem) {
        results.push({ kind, id, organizationId: asset.organizationId, source: unit.source, status: 'skipped', reason: problem });
        continue;
      }
      if (!args.apply) {
        results.push({ kind, id, organizationId: asset.organizationId, source: unit.source, status: 'would-copy' });
        continue;
      }
      try {
        const fileName = unit.version?.fileName || asset.fileName || fileNameFrom(unit.source!, 'file');
        const { key, info } = await copyVerified(storage, unit.source!, { kind: 'asset-file', organizationId: asset.organizationId, assetId: asset.id, version: unit.n }, ctx, fileName, storage.settings.maxFileBytes, storage.settings.allowedFileTypes);
        try {
          await inTx(async (m) => {
            await quota.addUsage(m, asset.organizationId, info.sizeBytes);
            await m.getRepository(StoredObject).insert({
              id: randomUUID(), organizationId: asset.organizationId, storageKey: key, kind: 'ASSET_FILE', countsTowardQuota: true, sizeBytes: info.sizeBytes,
              checksumSha256: info.checksumSha256, contentType: info.contentType, originalFileName: fileName.slice(0, 255), assetId: asset.id,
              migratedFrom: unit.source!.slice(0, 2000), createdBy: 'storage-migration', createdAt: new Date(),
            } as StoredObject);
            if (unit.version) {
              await m.getRepository(AssetVersion).update({ id: unit.version.id }, { storageKey: key, fileSize: info.sizeBytes, checksum: info.checksumSha256, mimeType: info.contentType });
            }
            const isCurrent = unit.version ? unit.version.isCurrent || unit.version.versionNumber === asset.version : true;
            if (isCurrent) {
              await m.getRepository(Asset).update({ id: asset.id }, { storageKey: key, storageProvider: 's3', fileSize: info.sizeBytes, checksum: info.checksumSha256, mimeType: info.contentType });
            }
            await writeAudit(m, {
              organizationId: asset.organizationId, actorType: 'SYSTEM', actorId: 'storage-migration', action: 'ASSET_FILE_MIGRATED', resourceType: 'asset', resourceId: asset.id,
              targetName: asset.name, before: { storageKey: (unit.version || asset).storageKey ?? null, source: unit.source }, after: { storageKey: key, sizeBytes: info.sizeBytes, checksumSha256: info.checksumSha256 },
            });
          });
        } catch (err) {
          // database write failed: the copy must not stay behind without a record
          await storage.deleteObject(key, ctx).catch(() => undefined);
          throw err;
        }
        results.push({ kind, id, organizationId: asset.organizationId, source: unit.source, status: 'copied', bytes: info.sizeBytes });
      } catch (err: any) {
        results.push({ kind, id, organizationId: asset.organizationId, source: unit.source, status: 'failed', reason: err?.message || String(err) });
      }
    }
  }

  if (args.media) {
    const mediaRows: Array<{ table: 'programs' | 'organizations' | 'organization_brandings' | 'users'; id: string; column: string; url: string; organizationId?: string; userId?: string }> = [];
    const mine = (u?: string | null) => Boolean(u && u.includes('/api/v1/media/'));
    for (const p of await ds.getRepository(Program).find(args.org ? { where: { organizationId: args.org } } : {})) {
      for (const c of ['logoUrl', 'bannerUrl'] as const) if ((p as any)[c] && !mine((p as any)[c])) mediaRows.push({ table: 'programs', id: p.id, column: c, url: (p as any)[c], organizationId: p.organizationId });
    }
    for (const o of await ds.getRepository(Organization).find(args.org ? { where: { id: args.org } } : {})) {
      if ((o as any).logoUrl && !mine((o as any).logoUrl)) mediaRows.push({ table: 'organizations', id: o.id, column: 'logoUrl', url: (o as any).logoUrl, organizationId: o.id });
    }
    for (const b of await ds.getRepository(OrganizationBranding).find(args.org ? { where: { organizationId: args.org } as any } : {})) {
      for (const c of ['logoUrl', 'logoDarkUrl', 'faviconUrl'] as const) if ((b as any)[c] && !mine((b as any)[c])) mediaRows.push({ table: 'organization_brandings', id: (b as any).id, column: c, url: (b as any)[c], organizationId: (b as any).organizationId });
    }
    if (!args.org) {
      for (const u of await ds.getRepository(User).find({ select: { id: true, avatarUrl: true } as any })) {
        if (u.avatarUrl && !mine(u.avatarUrl)) mediaRows.push({ table: 'users', id: u.id, column: 'avatarUrl', url: u.avatarUrl, userId: u.id });
      }
    }
    for (const row of mediaRows.slice(0, args.limit)) {
      const problem = sourceProblem(row.url);
      if (problem) {
        results.push({ kind: 'media', id: `${row.table}.${row.column}:${row.id}`, organizationId: row.organizationId, source: row.url, status: 'skipped', reason: problem });
        continue;
      }
      if (!args.apply) {
        results.push({ kind: 'media', id: `${row.table}.${row.column}:${row.id}`, organizationId: row.organizationId, source: row.url, status: 'would-copy' });
        continue;
      }
      const ctx = { organizationId: row.organizationId || `user:${row.userId}` };
      const ref: StorageObjectRef = row.userId ? { kind: 'user-avatar', userId: row.userId } : { kind: 'org-media', organizationId: row.organizationId!, purpose: row.table === 'programs' ? (row.column === 'bannerUrl' ? 'program-banner' : 'program-logo') : 'organization-logo' };
      try {
        const fileName = fileNameFrom(row.url, 'image.png');
        const { key, info } = await copyVerified(storage, row.url, ref, ctx, fileName, storage.settings.maxImageBytes, IMAGE_FILE_TYPES as unknown as string[]);
        const id = randomUUID();
        const newUrl = `${getAppConfig().appUrl.replace(/\/$/, '')}/api/v1/media/${id}`;
        try {
          await inTx(async (m) => {
            await m.getRepository(StoredObject).insert({
              id, organizationId: row.organizationId, ownerUserId: row.userId, storageKey: key, kind: row.userId ? 'AVATAR' : 'MEDIA', countsTowardQuota: false, sizeBytes: info.sizeBytes,
              checksumSha256: info.checksumSha256, contentType: info.contentType, originalFileName: fileName.slice(0, 255), purpose: (ref as any).purpose || 'affiliate-avatar',
              migratedFrom: row.url.slice(0, 2000), createdBy: 'storage-migration', createdAt: new Date(),
            } as StoredObject);
            await m.query(`UPDATE \`${row.table}\` SET \`${row.column}\` = ? WHERE id = ? AND \`${row.column}\` = ?`, [newUrl, row.id, row.url]);
          });
        } catch (err) {
          await storage.deleteObject(key, ctx).catch(() => undefined);
          throw err;
        }
        results.push({ kind: 'media', id: `${row.table}.${row.column}:${row.id}`, organizationId: row.organizationId, source: row.url, status: 'copied', bytes: info.sizeBytes });
      } catch (err: any) {
        results.push({ kind: 'media', id: `${row.table}.${row.column}:${row.id}`, organizationId: row.organizationId, source: row.url, status: 'failed', reason: err?.message || String(err) });
      }
    }
  }

  const count = (s: ItemResult['status']) => results.filter((r) => r.status === s).length;
  return {
    mode: args.apply ? 'apply' : 'dry-run',
    totals: {
      candidates: results.length,
      wouldCopy: count('would-copy'),
      copied: count('copied'),
      copiedBytes: results.filter((r) => r.status === 'copied').reduce((s, r) => s + (r.bytes || 0), 0),
      skipped: count('skipped'),
      failed: count('failed'),
    },
    items: results,
  };
}

if (require.main === module) {
  migrateLegacyFiles(parseArgs(process.argv.slice(2)))
    .then((report) => {
      console.log('===MIGRATION REPORT===');
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.totals.failed > 0 ? 2 : 0);
    })
    .catch((err) => {
      console.error(err?.message || err);
      process.exit(1);
    });
}
