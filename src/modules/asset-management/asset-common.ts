/** Shared helpers of the asset module: repositories, transactions, audit rows, safe display names. */
import { HttpException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { AppDataSource, initializeDataSource } from '../../database/data-source';
import {
  AffiliateAssetActivity,
  Asset,
  AssetBundle,
  AssetBundleItem,
  AssetTag,
  AssetVersion,
  AuditLog,
  StoredObject,
} from '../../database/schema';

const logger = new Logger('AssetManagement');
const LOCK_WAIT_SECONDS = 5;

export async function repos(m?: EntityManager) {
  const ds = m ?? (await initializeDataSource());
  return {
    assets: ds.getRepository(Asset),
    versions: ds.getRepository(AssetVersion),
    bundles: ds.getRepository(AssetBundle),
    items: ds.getRepository(AssetBundleItem),
    tags: ds.getRepository(AssetTag),
    activities: ds.getRepository(AffiliateAssetActivity),
    objects: ds.getRepository(StoredObject),
    audit: ds.getRepository(AuditLog),
  };
}

/** MySQL transaction with a short lock wait: a locked table gives a clear 503 and changes nothing. */
export async function inTx<T>(work: (m: EntityManager) => Promise<T>): Promise<T> {
  await initializeDataSource();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  try {
    await qr.query(`SET SESSION innodb_lock_wait_timeout = ${LOCK_WAIT_SECONDS}, lock_wait_timeout = ${LOCK_WAIT_SECONDS}`);
    await qr.startTransaction();
    const result = await work(qr.manager);
    await qr.commitTransaction();
    return result;
  } catch (err: any) {
    if (qr.isTransactionActive) await qr.rollbackTransaction().catch(() => undefined);
    if (err instanceof HttpException) throw err;
    if (err?.code === 'ER_DUP_ENTRY') throw new HttpException({ statusCode: 409, code: 'CONFLICT', message: 'An item with the same unique value already exists.' }, 409);
    logger.error(`asset write failed: ${err?.code || ''} ${err?.message || err}`);
    throw new ServiceUnavailableException('The change could not be saved because the database is busy or unavailable. Nothing was changed; please retry.');
  } finally {
    await qr.query('SET SESSION innodb_lock_wait_timeout = DEFAULT, lock_wait_timeout = DEFAULT').catch(() => undefined);
    await qr.release();
  }
}

export interface AuditInput {
  organizationId: string;
  actorId: string;
  actorType?: string;
  action: string;
  resourceType: 'asset' | 'asset_bundle' | 'asset_version' | 'organization_storage';
  resourceId: string;
  targetName?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Audit row in the same transaction as the change it describes (who, organization, what, before/after, when). */
export async function writeAudit(m: EntityManager, a: AuditInput) {
  await m.getRepository(AuditLog).insert({
    id: randomUUID(),
    organizationId: a.organizationId,
    actorType: a.actorType || 'USER',
    actorId: a.actorId,
    action: a.action,
    category: 'ASSETS',
    result: 'SUCCESS',
    resourceType: a.resourceType,
    resourceId: a.resourceId,
    targetName: a.targetName?.slice(0, 255),
    source: 'ADMIN_PORTAL',
    beforeState: a.before === undefined ? undefined : a.before,
    afterState: a.after === undefined ? undefined : a.after,
    metadata: a.metadata,
    createdAt: new Date(),
  } as any);
}

/** Fields compared in before/after audit snapshots. */
export function pick<T extends object>(row: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) out[k] = row[k];
  return out;
}

export function diff<T extends object>(before: T, after: T, keys: (keyof T)[]) {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of keys) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a, changed: Object.keys(a) };
}

/**
 * Name shown to people and used in Content-Disposition. Never used in a storage key.
 * Keeps Unicode letters, removes path parts, control characters and quotes, limits the length (keeping the extension).
 */
export function displayFileName(raw: string): string {
  let name = (raw || 'file').normalize('NFC').split(/[\\/]/).pop() || 'file';
  name = name.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '_').replace(/^\.+/, '').trim().replace(/\s+/g, ' ');
  if (!name) name = 'file';
  if (name.length > 180) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = name.slice(0, 180 - ext.length) + ext;
  }
  return name;
}

export function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

export function folderOf(asset: { metadata?: Record<string, unknown> | null }) {
  return ((asset.metadata?.folderPath as string) || (asset.metadata?.folder as string) || 'General').trim() || 'General';
}

export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const ASSET_AUDIT_FIELDS: (keyof Asset)[] = [
  'name', 'description', 'assetType', 'fileName', 'programId', 'externalUrl', 'textContent', 'htmlContent', 'tags',
  'language', 'country', 'status', 'isPublicToAffiliates', 'isDownloadable', 'isCopyable', 'metadata', 'version', 'fileSize', 'checksum', 'deletedAt',
];
export const BUNDLE_AUDIT_FIELDS: (keyof AssetBundle)[] = [
  'name', 'slug', 'description', 'programId', 'campaignId', 'coverImageAssetId', 'status', 'visibility', 'partnerTierId',
  'affiliateIds', 'startDate', 'endDate', 'language', 'country', 'featured', 'displayOrder', 'deletedAt',
];
