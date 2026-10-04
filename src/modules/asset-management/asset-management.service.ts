/**
 * Organization-side assets: list/search/filter/sort/paginate (SQL, server-side), edit, trash/restore/permanent
 * delete, versions, downloads, analytics. MySQL (TypeORM repositories) is the source of truth for every asset,
 * version, bundle and activity row; dbStore is not used for them (decision A7). Every write and its audit row are in
 * one transaction.
 */
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { In, IsNull } from 'typeorm';
import { AffiliateAssetActivityType, AssetBundleStatus, AssetSourceType, AssetStatus } from '../../common/enums';
import { ALLOWED_FILE_TYPES, StorageService } from '../../common/storage';
import { dbStore } from '../../database/store';
import { Asset, AssetVersion } from '../../database/schema';
import { StorageQuotaService } from '../storage-quota/storage-quota.service';
import { ASSET_AUDIT_FIELDS, diff, displayFileName, escapeLike, folderOf, inTx, pick, repos, slugify, writeAudit } from './asset-common';
import { AddContentVersionDto, BulkAssetActionDto, CreateAssetDto, DownloadQueryDto, ListAssetsQueryDto, UpdateAssetDto } from './dto/asset-management.dto';

const DEFAULT_FOLDERS = ['Brand Assets', 'Ad Creatives', 'Email Copies', 'Product Kits', 'General'];

function sanitizeHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|object|embed|style|link|meta)[\s\S]*?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|data|vbscript):[^"']*\2/gi, '$1="#"');
}

export interface AssetView {
  id: string;
  organizationId: string;
  [key: string]: unknown;
}

@Injectable()
export class AssetManagementService {
  private readonly logger = new Logger('AssetManagement');

  constructor(
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
  ) {}

  // ───────────────────────── views ─────────────────────────

  /** API representation of an asset (no storage key, no permanent URL). */
  async views(assets: Asset[]): Promise<AssetView[]> {
    if (!assets.length) return [];
    const ids = assets.map((a) => a.id);
    const { activities, items, objects } = await repos();
    const usageRows: Array<{ assetId: string; activityType: string; n: string }> = await activities
      .createQueryBuilder('x')
      .select('x.assetId', 'assetId').addSelect('x.activityType', 'activityType').addSelect('COUNT(*)', 'n')
      .where('x.assetId IN (:...ids)', { ids }).groupBy('x.assetId').addGroupBy('x.activityType').getRawMany();
    const uniqueRows: Array<{ assetId: string; u: string }> = await activities
      .createQueryBuilder('x').select('x.assetId', 'assetId').addSelect('COUNT(DISTINCT x.affiliateId)', 'u')
      .where('x.assetId IN (:...ids)', { ids }).groupBy('x.assetId').getRawMany();
    const bundleRows: Array<{ assetId: string; n: string }> = await items
      .createQueryBuilder('i').innerJoin('asset_bundles', 'b', 'b.id = i.assetBundleId AND b.deletedAt IS NULL')
      .select('i.assetId', 'assetId').addSelect('COUNT(*)', 'n').where('i.assetId IN (:...ids)', { ids }).groupBy('i.assetId').getRawMany();
    const thumbs = await objects.find({ where: { assetId: In(ids), kind: 'THUMBNAIL' }, select: { assetId: true, storageKey: true, organizationId: true } });
    const thumbUrls = new Map<string, string>();
    for (const t of thumbs) {
      const signed = await this.storage.getDownloadUrl(t.storageKey, { organizationId: t.organizationId!, fileName: 'thumbnail.jpg', contentType: 'image/jpeg', disposition: 'inline' });
      thumbUrls.set(t.assetId!, signed.url);
    }
    const programs = new Map(dbStore.programs.map((p) => [p.id, p.name]));
    return assets.map((a) => {
      const u = usageRows.filter((r) => r.assetId === a.id);
      const count = (...types: string[]) => u.filter((r) => types.includes(r.activityType)).reduce((s, r) => s + Number(r.n), 0);
      const { storageKey: _k, storageUrl: _u, previewUrl: _p, thumbnailUrl: _t, ...rest } = a as any;
      return {
        ...rest,
        fileSize: a.fileSize !== undefined && a.fileSize !== null ? Number(a.fileSize) : 0,
        folder: folderOf(a),
        programName: a.programId ? programs.get(a.programId) : undefined,
        hasFile: a.sourceType === AssetSourceType.FILE && Boolean(a.storageKey && this.storage.keyBelongsToOrganization(a.storageKey, a.organizationId)),
        legacyFileMissing: a.sourceType === AssetSourceType.FILE && !(a.storageKey && this.storage.keyBelongsToOrganization(a.storageKey, a.organizationId)),
        inline: Boolean(a.mimeType && Object.values(ALLOWED_FILE_TYPES).some((t) => t.contentType === a.mimeType && t.inline)),
        /** short-lived signed URL (an <img> cannot send the bearer token) */
        thumbnailUrl: thumbUrls.get(a.id),
        thumbnailStatus: (a.metadata as any)?.thumbnailStatus,
        trashedAt: a.deletedAt ?? undefined,
        usage: {
          views: count(AffiliateAssetActivityType.VIEW),
          previews: count(AffiliateAssetActivityType.PREVIEW),
          downloads: count(AffiliateAssetActivityType.DOWNLOAD),
          copies: count(AffiliateAssetActivityType.COPY, AffiliateAssetActivityType.LINK_COPY, AffiliateAssetActivityType.COUPON_COPY),
          uniqueAffiliates: Number(uniqueRows.find((r) => r.assetId === a.id)?.u || 0),
        },
        associatedBundleCount: Number(bundleRows.find((r) => r.assetId === a.id)?.n || 0),
      };
    });
  }

  async view(asset: Asset) {
    return (await this.views([asset]))[0];
  }

  async findAsset(organizationId: string, assetId: string, opts: { includeTrashed?: boolean } = {}) {
    if (!/^[0-9a-f-]{36}$/i.test(assetId)) throw new NotFoundException('ASSET_NOT_FOUND');
    const { assets } = await repos();
    const asset = await assets.findOne({ where: { id: assetId, organizationId } });
    if (!asset || (asset.deletedAt && !opts.includeTrashed)) throw new NotFoundException('ASSET_NOT_FOUND');
    return asset;
  }

  private assertProgram(organizationId: string, programId?: string | null) {
    if (programId && !dbStore.programs.some((p) => p.id === programId && p.organizationId === organizationId && !p.deletedAt)) {
      throw new BadRequestException('Program does not belong to this organization');
    }
  }

  // ───────────────────────── list / folders ─────────────────────────

  async listAssets(organizationId: string, query: ListAssetsQueryDto, opts: { trashed?: boolean } = {}) {
    const page = Math.max(Number(query.page || 1), 1);
    const limit = Math.min(Math.max(Number(query.limit || 24), 1), 100);
    const { assets } = await repos();
    const qb = assets.createQueryBuilder('a').where('a.organizationId = :org', { org: organizationId });
    qb.andWhere(opts.trashed ? 'a.deletedAt IS NOT NULL' : 'a.deletedAt IS NULL');
    if (query.programId) qb.andWhere('a.programId = :programId', { programId: query.programId });
    if (query.assetType) qb.andWhere('a.assetType = :assetType', { assetType: query.assetType });
    if (query.status) qb.andWhere('a.status = :status', { status: query.status });
    if (query.language) qb.andWhere('a.language = :language', { language: query.language });
    if (query.country) qb.andWhere('a.country = :country', { country: query.country });
    const folderExpr = `COALESCE(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.folderPath'))), ''), 'General')`;
    if (query.folderPath) qb.andWhere(`LOWER(${folderExpr}) = LOWER(:folder)`, { folder: query.folderPath.trim() });
    if (query.tag) qb.andWhere(`FIND_IN_SET(LOWER(:tag), LOWER(a.tags)) > 0`, { tag: query.tag.trim() });
    const search = query.search?.trim();
    if (search) {
      const like = `%${escapeLike(search.toLowerCase())}%`;
      qb.andWhere(
        `(LOWER(a.name) LIKE :like OR LOWER(COALESCE(a.description, '')) LIKE :like OR LOWER(COALESCE(a.fileName, '')) LIKE :like OR LOWER(a.assetType) LIKE :like OR LOWER(${folderExpr}) LIKE :like OR LOWER(COALESCE(a.tags, '')) LIKE :like)`,
        { like },
      );
    }
    const sortBy = query.sortBy || 'updatedAt';
    const dir = (query.sortDir || (sortBy === 'name' ? 'asc' : 'desc')).toUpperCase() as 'ASC' | 'DESC';
    qb.orderBy(`a.${sortBy}`, dir).addOrderBy('a.id', dir).skip((page - 1) * limit).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return { data: await this.views(rows), meta: { page, limit, total, sortBy, sortDir: dir.toLowerCase() } };
  }

  async listFolders(organizationId: string) {
    const { assets } = await repos();
    const rows: Array<{ folder: string; n: string; bytes: string; last: Date }> = await assets
      .createQueryBuilder('a')
      .select(`COALESCE(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.folderPath'))), ''), 'General')`, 'folder')
      .addSelect('COUNT(*)', 'n').addSelect('COALESCE(SUM(a.fileSize), 0)', 'bytes').addSelect('MAX(a.updatedAt)', 'last')
      .where('a.organizationId = :org AND a.deletedAt IS NULL', { org: organizationId })
      .groupBy('folder').getRawMany();
    const map = new Map<string, { assetCount: number; totalBytes: number; lastModified: string | null }>();
    for (const f of DEFAULT_FOLDERS) map.set(f, { assetCount: 0, totalBytes: 0, lastModified: null });
    for (const r of rows) map.set(r.folder, { assetCount: Number(r.n), totalBytes: Number(r.bytes), lastModified: r.last ? new Date(r.last).toISOString() : null });
    return [...map.entries()].map(([folder, v]) => ({ folder, ...v })).sort((a, b) => b.assetCount - a.assetCount || a.folder.localeCompare(b.folder));
  }

  async getAsset(organizationId: string, assetId: string) {
    return this.view(await this.findAsset(organizationId, assetId, { includeTrashed: true }));
  }

  // ───────────────────────── create (non-file) / update ─────────────────────────

  async createAsset(organizationId: string, actorId: string, dto: CreateAssetDto) {
    this.assertProgram(organizationId, dto.programId);
    const now = new Date();
    const html = dto.htmlContent ? sanitizeHtml(dto.htmlContent) : undefined;
    const asset: Asset = {
      id: randomUUID(), organizationId, programId: dto.programId, name: dto.name, description: dto.description, assetType: dto.assetType,
      sourceType: dto.sourceType, textContent: dto.sourceType === AssetSourceType.TEXT ? dto.textContent : undefined,
      htmlContent: dto.sourceType === AssetSourceType.HTML ? html : undefined, externalUrl: dto.sourceType === AssetSourceType.URL ? dto.externalUrl : undefined,
      language: dto.language, country: dto.country, tags: [...new Set((dto.tags || []).map((t) => t.trim()).filter(Boolean))].slice(0, 20),
      metadata: { folderPath: dto.folderPath || 'General' }, status: dto.status || AssetStatus.DRAFT,
      isPublicToAffiliates: dto.isPublicToAffiliates ?? dto.status === AssetStatus.PUBLISHED, isDownloadable: dto.isDownloadable ?? true,
      isCopyable: dto.isCopyable ?? true, version: 1,
      checksum: createHash('sha256').update(dto.textContent || html || dto.externalUrl || dto.name).digest('hex'),
      createdBy: actorId, updatedBy: actorId, createdAt: now, updatedAt: now,
    } as Asset;
    await inTx(async (m) => {
      const r = await repos(m);
      await r.assets.insert(asset);
      await r.versions.insert({ id: randomUUID(), assetId: asset.id, versionNumber: 1, createdBy: actorId, createdAt: now, changeNotes: 'Initial asset', isCurrent: true } as AssetVersion);
      await writeAudit(m, { organizationId, actorId, action: 'ASSET_CREATED', resourceType: 'asset', resourceId: asset.id, targetName: asset.name, after: pick(asset, ASSET_AUDIT_FIELDS) });
    });
    return this.view(asset);
  }

  async updateAsset(organizationId: string, assetId: string, actorId: string, dto: UpdateAssetDto) {
    this.assertProgram(organizationId, dto.programId);
    const result = await inTx(async (m) => {
      const r = await repos(m);
      const [lock] = await m.query(`SELECT id FROM assets WHERE id = ? AND organizationId = ? AND deletedAt IS NULL FOR UPDATE`, [assetId, organizationId]);
      if (!lock) throw new NotFoundException('ASSET_NOT_FOUND');
      const before = await r.assets.findOneByOrFail({ id: assetId });
      if (dto.fileName !== undefined && before.sourceType !== AssetSourceType.FILE) throw new BadRequestException('Only file assets have a file name.');
      if (dto.fileName !== undefined) {
        const renamed = displayFileName(dto.fileName);
        const oldExt = (before.fileName || '').split('.').pop()?.toLowerCase();
        if (renamed.split('.').pop()?.toLowerCase() !== oldExt) throw new BadRequestException(`The file name must keep the .${oldExt} extension (the file content does not change).`);
        dto.fileName = renamed;
      }
      const changes: Partial<Asset> = {};
      for (const k of ['name', 'description', 'assetType', 'fileName', 'programId', 'externalUrl', 'textContent', 'language', 'country', 'status', 'isPublicToAffiliates', 'isDownloadable', 'isCopyable'] as const) {
        if (dto[k] !== undefined) (changes as any)[k] = dto[k];
      }
      if (dto.htmlContent !== undefined) changes.htmlContent = sanitizeHtml(dto.htmlContent);
      if (dto.tags !== undefined) changes.tags = [...new Set(dto.tags.map((t) => t.trim()).filter(Boolean))].slice(0, 20);
      if (dto.folderPath !== undefined) changes.metadata = { ...(before.metadata || {}), folderPath: dto.folderPath || 'General' };
      if (!Object.keys(changes).length) return before;
      await r.assets.update({ id: assetId }, { ...changes, updatedBy: actorId, updatedAt: new Date() } as any);
      const after = await r.assets.findOneByOrFail({ id: assetId });
      const d = diff(before, after, ASSET_AUDIT_FIELDS);
      if (d.changed.length) {
        const action = d.changed.length === 1 && d.changed[0] === 'fileName' ? 'ASSET_RENAMED' : d.changed.length === 1 && d.changed[0] === 'metadata' ? 'ASSET_MOVED' : 'ASSET_UPDATED';
        await writeAudit(m, { organizationId, actorId, action, resourceType: 'asset', resourceId: assetId, targetName: after.name, before: d.before, after: d.after });
      }
      return after;
    });
    return this.view(result);
  }

  // ───────────────────────── trash ─────────────────────────

  /** Move to trash: the file stays in storage and keeps counting until permanently deleted. */
  async trashAsset(organizationId: string, assetId: string, actorId: string) {
    await inTx(async (m) => {
      const [row] = await m.query(`SELECT id, name, deletedAt FROM assets WHERE id = ? AND organizationId = ? FOR UPDATE`, [assetId, organizationId]);
      if (!row || row.deletedAt) throw new NotFoundException('ASSET_NOT_FOUND');
      const now = new Date();
      await m.query(`UPDATE assets SET deletedAt = ?, updatedBy = ?, updatedAt = ? WHERE id = ?`, [now, actorId, now, assetId]);
      const bundles = await m.query(`SELECT b.id, b.name FROM asset_bundle_items i JOIN asset_bundles b ON b.id = i.assetBundleId AND b.deletedAt IS NULL WHERE i.assetId = ?`, [assetId]);
      await writeAudit(m, {
        organizationId, actorId, action: 'ASSET_TRASHED', resourceType: 'asset', resourceId: assetId, targetName: row.name,
        before: { deletedAt: null }, after: { deletedAt: now }, metadata: { inBundles: bundles, retentionDays: this.storage.settings.trashRetentionDays },
      });
    });
    return { success: true, message: `Moved to trash. It is permanently deleted after ${this.storage.settings.trashRetentionDays} days unless restored.` };
  }

  async restoreAsset(organizationId: string, assetId: string, actorId: string) {
    const after = await inTx(async (m) => {
      const [row] = await m.query(`SELECT id, name, deletedAt FROM assets WHERE id = ? AND organizationId = ? FOR UPDATE`, [assetId, organizationId]);
      if (!row || !row.deletedAt) throw new NotFoundException('ASSET_NOT_IN_TRASH');
      await m.query(`UPDATE assets SET deletedAt = NULL, updatedBy = ?, updatedAt = ? WHERE id = ?`, [actorId, new Date(), assetId]);
      await writeAudit(m, { organizationId, actorId, action: 'ASSET_RESTORED', resourceType: 'asset', resourceId: assetId, targetName: row.name, before: { deletedAt: row.deletedAt }, after: { deletedAt: null } });
      return (await repos(m)).assets.findOneByOrFail({ id: assetId });
    });
    return this.view(after);
  }

  async listTrash(organizationId: string, query: ListAssetsQueryDto) {
    const res = await this.listAssets(organizationId, query, { trashed: true });
    const days = this.storage.settings.trashRetentionDays;
    return {
      ...res,
      data: res.data.map((a: any) => ({ ...a, permanentDeleteAt: new Date(new Date(a.trashedAt).getTime() + days * 86_400_000).toISOString() })),
      retentionDays: days,
    };
  }

  /**
   * Permanent deletion: rows (asset, versions, bundle items, stored objects) are deleted and the space is freed in one
   * transaction that also queues the storage keys; then the objects are deleted from storage (failures stay queued
   * and are retried by the cleanup job). If the transaction fails, nothing changes in MySQL or storage.
   */
  async purgeAssets(organizationId: string, assetIds: string[], actorId: string, reason: 'USER' | 'TRASH_EMPTIED' | 'RETENTION_EXPIRED', opts: { requireTrashed: boolean }) {
    if (!assetIds.length) return { deleted: 0, freedBytes: 0 };
    const queued = await inTx(async (m) => {
      const rows = await m.query(`SELECT id, name, deletedAt, fileSize, version FROM assets WHERE organizationId = ? AND id IN (?) FOR UPDATE`, [organizationId, assetIds]);
      if (opts.requireTrashed) {
        const notTrashed = rows.filter((r: any) => !r.deletedAt).map((r: any) => r.id);
        if (notTrashed.length) throw new BadRequestException('Only files in the trash can be permanently deleted. Move them to the trash first.');
      }
      if (rows.length !== assetIds.length && reason === 'USER') throw new NotFoundException('ASSET_NOT_FOUND');
      const ids = rows.map((r: any) => r.id);
      if (!ids.length) return { keys: [] as string[], freed: 0, ids: [] as string[], rows: [] as any[] };
      const objects = await m.query(`SELECT id, assetId, storageKey, sizeBytes, countsTowardQuota FROM stored_objects WHERE organizationId = ? AND assetId IN (?) FOR UPDATE`, [organizationId, ids]);
      const freed = objects.filter((o: any) => Number(o.countsTowardQuota) === 1).reduce((s: number, o: any) => s + Number(o.sizeBytes), 0);
      const bundles = await m.query(`SELECT i.assetId, b.id, b.name FROM asset_bundle_items i JOIN asset_bundles b ON b.id = i.assetBundleId WHERE i.assetId IN (?)`, [ids]);
      await m.query(`DELETE FROM asset_bundle_items WHERE assetId IN (?)`, [ids]);
      await m.query(`UPDATE asset_bundles SET coverImageAssetId = NULL WHERE organizationId = ? AND coverImageAssetId IN (?)`, [organizationId, ids]);
      await m.query(`DELETE FROM asset_versions WHERE assetId IN (?)`, [ids]);
      if (objects.length) await m.query(`DELETE FROM stored_objects WHERE id IN (?)`, [objects.map((o: any) => o.id)]);
      await m.query(`DELETE FROM assets WHERE id IN (?)`, [ids]);
      await this.quota.free(m, organizationId, freed);
      for (const o of objects) {
        await m.query(`INSERT INTO storage_deletion_queue (id, organizationId, storageKey, attempts) VALUES (?, ?, ?, 0)`, [randomUUID(), organizationId, o.storageKey]);
      }
      for (const r of rows) {
        const own = objects.filter((o: any) => o.assetId === r.id);
        await writeAudit(m, {
          organizationId, actorId, actorType: reason === 'RETENTION_EXPIRED' ? 'SYSTEM' : 'USER',
          action: reason === 'USER' ? 'ASSET_PERMANENTLY_DELETED' : reason === 'TRASH_EMPTIED' ? 'ASSET_PURGED_TRASH_EMPTIED' : 'ASSET_PURGED_RETENTION',
          resourceType: 'asset', resourceId: r.id, targetName: r.name,
          before: { deletedAt: r.deletedAt, fileSize: Number(r.fileSize || 0), versions: Number(r.version) },
          after: null,
          metadata: { removedFromBundles: bundles.filter((b: any) => b.assetId === r.id).map((b: any) => ({ id: b.id, name: b.name })), objectsQueued: own.length },
        });
      }
      return { keys: objects.map((o: any) => o.storageKey) as string[], freed, ids, rows };
    });
    if (reason === 'TRASH_EMPTIED') {
      await inTx((m) => writeAudit(m, { organizationId, actorId, action: 'TRASH_EMPTIED', resourceType: 'organization_storage', resourceId: organizationId, metadata: { assets: queued.ids.length, freedBytes: queued.freed } }));
    }
    await this.processDeletionQueue(organizationId, queued.keys);
    return { deleted: queued.ids.length, freedBytes: queued.freed };
  }

  processDeletionQueue(organizationId?: string, keys?: string[]) {
    return this.quota.processDeletionQueue(organizationId, keys);
  }

  async permanentlyDelete(organizationId: string, assetId: string, actorId: string) {
    await this.findAsset(organizationId, assetId, { includeTrashed: true });
    return this.purgeAssets(organizationId, [assetId], actorId, 'USER', { requireTrashed: true });
  }

  async emptyTrash(organizationId: string, actorId: string) {
    const { assets } = await repos();
    const trashed = await assets.createQueryBuilder('a').select('a.id', 'id').where('a.organizationId = :org AND a.deletedAt IS NOT NULL', { org: organizationId }).getRawMany();
    return this.purgeAssets(organizationId, trashed.map((t: any) => t.id), actorId, 'TRASH_EMPTIED', { requireTrashed: true });
  }

  async bulkAction(organizationId: string, actorId: string, dto: BulkAssetActionDto) {
    // all or nothing: an id that is not a live asset of this organization refuses the whole request (before, such ids
    // were skipped and the request still reported success)
    const ids = [...new Set(dto.assetIds)];
    const { assets } = await repos();
    const found = await assets.find({ where: { id: In(ids), organizationId, deletedAt: IsNull() }, select: { id: true } });
    const missing = ids.filter((id) => !found.some((a) => a.id === id));
    if (missing.length) {
      throw new NotFoundException({ statusCode: 404, code: 'ASSET_NOT_FOUND', message: `${missing.length} of the selected assets were not found in this organization (or are in the trash). Nothing was changed.`, details: { missingIds: missing } });
    }
    if (dto.action === 'MOVE' && !dto.folderPath) throw new BadRequestException('folderPath is required for MOVE');
    if (dto.action === 'TAG' && !dto.tags?.length) throw new BadRequestException('tags are required for TAG');
    const affected: string[] = [];
    for (const assetId of ids) {
      if (dto.action === 'ARCHIVE') await this.trashAsset(organizationId, assetId, actorId);
      else if (dto.action === 'MOVE') await this.updateAsset(organizationId, assetId, actorId, { folderPath: dto.folderPath });
      else if (dto.action === 'TAG') {
        const asset = await this.findAsset(organizationId, assetId);
        await this.updateAsset(organizationId, assetId, actorId, { tags: [...new Set([...(asset.tags || []), ...dto.tags!])] });
      }
      affected.push(assetId);
    }
    return { success: true, count: affected.length, affected };
  }

  // ───────────────────────── versions ─────────────────────────

  async listVersions(organizationId: string, assetId: string) {
    await this.findAsset(organizationId, assetId, { includeTrashed: true });
    const { versions } = await repos();
    const rows = await versions.find({ where: { assetId }, order: { versionNumber: 'DESC' } });
    return rows.map(({ storageKey, storageUrl: _u, ...v }) => ({ ...v, fileSize: v.fileSize !== undefined && v.fileSize !== null ? Number(v.fileSize) : undefined, hasFile: Boolean(storageKey && this.storage.keyBelongsToOrganization(storageKey, organizationId)) }));
  }

  /** New version of a text / HTML / link asset (content + change notes). File assets: upload the new file instead. */
  async addVersion(organizationId: string, assetId: string, actorId: string, dto: AddContentVersionDto) {
    const after = await inTx(async (m) => {
      const r = await repos(m);
      const [lock] = await m.query(`SELECT id FROM assets WHERE id = ? AND organizationId = ? AND deletedAt IS NULL FOR UPDATE`, [assetId, organizationId]);
      if (!lock) throw new NotFoundException('ASSET_NOT_FOUND');
      const before = await r.assets.findOneByOrFail({ id: assetId });
      if (before.sourceType === AssetSourceType.FILE) throw new BadRequestException('Upload the new file to create a new version of a file asset (POST assets/:assetId/versions/upload).');
      const next = before.version + 1;
      const changes: Partial<Asset> = { version: next, updatedBy: actorId, updatedAt: new Date() };
      if (dto.textContent !== undefined) changes.textContent = dto.textContent;
      if (dto.htmlContent !== undefined) changes.htmlContent = sanitizeHtml(dto.htmlContent);
      if (dto.externalUrl !== undefined) changes.externalUrl = dto.externalUrl;
      changes.checksum = createHash('sha256').update(changes.textContent ?? changes.htmlContent ?? changes.externalUrl ?? before.textContent ?? before.htmlContent ?? before.externalUrl ?? before.name).digest('hex');
      await r.versions.update({ assetId }, { isCurrent: false });
      await r.versions.insert({ id: randomUUID(), assetId, versionNumber: next, checksum: changes.checksum, createdBy: actorId, createdAt: new Date(), changeNotes: dto.changeNotes, isCurrent: true } as AssetVersion);
      await r.assets.update({ id: assetId }, changes as any);
      const after = await r.assets.findOneByOrFail({ id: assetId });
      const d = diff(before, after, ASSET_AUDIT_FIELDS);
      await writeAudit(m, { organizationId, actorId, action: 'ASSET_VERSION_ADDED', resourceType: 'asset', resourceId: assetId, targetName: after.name, before: d.before, after: { ...d.after, changeNotes: dto.changeNotes } });
      return after;
    });
    return this.view(after);
  }

  /** Restore = new current version that points at the old version's object (no copy, no double counting). */
  async restoreVersion(organizationId: string, assetId: string, versionId: string, actorId: string) {
    const after = await inTx(async (m) => {
      const r = await repos(m);
      const [lock] = await m.query(`SELECT id FROM assets WHERE id = ? AND organizationId = ? AND deletedAt IS NULL FOR UPDATE`, [assetId, organizationId]);
      if (!lock) throw new NotFoundException('ASSET_NOT_FOUND');
      const before = await r.assets.findOneByOrFail({ id: assetId });
      const source = await r.versions.findOne({ where: { id: versionId, assetId } });
      if (!source) throw new NotFoundException('ASSET_VERSION_NOT_FOUND');
      if (source.isCurrent) throw new BadRequestException('This version is already the current version.');
      const next = before.version + 1;
      await r.versions.update({ assetId }, { isCurrent: false });
      await r.versions.insert({
        id: randomUUID(), assetId, versionNumber: next, storageKey: source.storageKey, fileName: source.fileName, mimeType: source.mimeType,
        fileSize: source.fileSize, checksum: source.checksum, createdBy: actorId, createdAt: new Date(), changeNotes: `Restored from v${source.versionNumber}`, isCurrent: true,
      } as AssetVersion);
      await r.assets.update({ id: assetId }, {
        version: next, storageKey: source.storageKey, fileName: source.fileName, mimeType: source.mimeType, contentType: source.mimeType,
        fileSize: source.fileSize, checksum: source.checksum, updatedBy: actorId, updatedAt: new Date(),
      });
      const after = await r.assets.findOneByOrFail({ id: assetId });
      await writeAudit(m, {
        organizationId, actorId, action: 'ASSET_VERSION_RESTORED', resourceType: 'asset', resourceId: assetId, targetName: after.name,
        before: { version: before.version, checksum: before.checksum, fileSize: before.fileSize }, after: { version: next, checksum: after.checksum, fileSize: after.fileSize, restoredFrom: source.versionNumber },
      });
      return after;
    });
    return this.view(after);
  }

  /** Delete an older (not current) version; its object is deleted and freed unless another version uses it. */
  async deleteVersion(organizationId: string, assetId: string, versionId: string, actorId: string) {
    const out = await inTx(async (m) => {
      const r = await repos(m);
      const [lock] = await m.query(`SELECT id, name FROM assets WHERE id = ? AND organizationId = ? FOR UPDATE`, [assetId, organizationId]);
      if (!lock) throw new NotFoundException('ASSET_NOT_FOUND');
      const version = await r.versions.findOne({ where: { id: versionId, assetId } });
      if (!version) throw new NotFoundException('ASSET_VERSION_NOT_FOUND');
      if (version.isCurrent) throw new BadRequestException('The current version cannot be deleted. Restore another version first, or delete the file.');
      await r.versions.delete({ id: versionId });
      let freed = 0;
      let queuedKey: string | undefined;
      if (version.storageKey) {
        const stillUsed = await r.versions.count({ where: { assetId, storageKey: version.storageKey } });
        if (!stillUsed) {
          const [obj] = await m.query(`SELECT id, sizeBytes, countsTowardQuota FROM stored_objects WHERE storageKey = ? AND organizationId = ? FOR UPDATE`, [version.storageKey, organizationId]);
          if (obj) {
            await m.query(`DELETE FROM stored_objects WHERE id = ?`, [obj.id]);
            freed = Number(obj.countsTowardQuota) === 1 ? Number(obj.sizeBytes) : 0;
            await this.quota.free(m, organizationId, freed);
            await m.query(`INSERT INTO storage_deletion_queue (id, organizationId, storageKey, attempts) VALUES (?, ?, ?, 0)`, [randomUUID(), organizationId, version.storageKey]);
            queuedKey = version.storageKey;
          }
        }
      }
      await writeAudit(m, {
        organizationId, actorId, action: 'ASSET_VERSION_DELETED', resourceType: 'asset', resourceId: assetId, targetName: lock.name,
        before: { versionNumber: version.versionNumber, fileSize: version.fileSize, checksum: version.checksum }, after: null, metadata: { freedBytes: freed },
      });
      return { freed, queuedKey };
    });
    if (out.queuedKey) await this.processDeletionQueue(organizationId, [out.queuedKey]);
    return { success: true, freedBytes: out.freed };
  }

  // ───────────────────────── downloads ─────────────────────────

  async getDownloadUrl(organizationId: string, assetId: string, query: DownloadQueryDto) {
    const asset = await this.findAsset(organizationId, assetId, { includeTrashed: true });
    let key = asset.storageKey;
    let fileName = asset.fileName || asset.name;
    let contentType = asset.mimeType || 'application/octet-stream';
    if (query.versionId) {
      const { versions } = await repos();
      const v = await versions.findOne({ where: { id: query.versionId, assetId } });
      if (!v) throw new NotFoundException('ASSET_VERSION_NOT_FOUND');
      key = v.storageKey;
      fileName = v.fileName || fileName;
      contentType = v.mimeType || contentType;
    }
    if (asset.sourceType !== AssetSourceType.FILE || !key) throw new BadRequestException('This asset has no file to download.');
    if (!this.storage.keyBelongsToOrganization(key, organizationId)) throw new ForbiddenException('ASSET_ACCESS_DENIED');
    return this.storage.getDownloadUrl(key, { organizationId, fileName, contentType, disposition: query.disposition || 'attachment' });
  }

  async getThumbnailUrl(organizationId: string, assetId: string) {
    await this.findAsset(organizationId, assetId, { includeTrashed: true });
    const { objects } = await repos();
    const thumb = await objects.findOne({ where: { assetId, organizationId, kind: 'THUMBNAIL' }, order: { createdAt: 'DESC' } });
    if (!thumb) throw new NotFoundException('THUMBNAIL_NOT_AVAILABLE');
    return this.storage.getDownloadUrl(thumb.storageKey, { organizationId, fileName: 'thumbnail.jpg', contentType: 'image/jpeg', disposition: 'inline' });
  }

  // ───────────────────────── analytics ─────────────────────────

  async getAssetUsageReferences(organizationId: string, assetId: string) {
    const asset = await this.findAsset(organizationId, assetId, { includeTrashed: true });
    const { items, activities } = await repos();
    const bundles = await items.manager.query(
      `SELECT b.id, b.name, b.status, b.visibility, b.programId FROM asset_bundle_items i JOIN asset_bundles b ON b.id = i.assetBundleId AND b.deletedAt IS NULL WHERE i.assetId = ? AND b.organizationId = ?`,
      [assetId, organizationId],
    );
    const recent = await activities.find({ where: { assetId, organizationId }, order: { createdAt: 'DESC' }, take: 20 });
    const names = new Map(dbStore.affiliates.filter((a) => a.organizationId === organizationId).map((a) => [a.id, a.displayName]));
    return {
      asset: await this.view(asset),
      bundles,
      programs: asset.programId ? dbStore.programs.filter((p) => p.id === asset.programId).map((p) => ({ id: p.id, name: p.name, status: p.status })) : [],
      recentActivities: recent.map((a) => ({ id: a.id, activityType: a.activityType, affiliateId: a.affiliateId, affiliateName: names.get(a.affiliateId) || 'Affiliate', createdAt: a.createdAt })),
    };
  }

  async analytics(organizationId: string) {
    const { assets, activities, bundles } = await repos();
    const totalAssets = await assets.count({ where: { organizationId, deletedAt: IsNull() } });
    const publishedBundles = await bundles.count({ where: { organizationId, status: AssetBundleStatus.PUBLISHED, deletedAt: IsNull() } });
    const byType: Array<{ t: string; n: string }> = await activities.createQueryBuilder('x').select('x.activityType', 't').addSelect('COUNT(*)', 'n').where('x.organizationId = :org', { org: organizationId }).groupBy('x.activityType').getRawMany();
    const n = (...types: string[]) => byType.filter((r) => types.includes(r.t)).reduce((s, r) => s + Number(r.n), 0);
    const [{ u }] = await activities.manager.query(`SELECT COUNT(DISTINCT affiliateId) u FROM affiliate_asset_activities WHERE organizationId = ?`, [organizationId]);
    const top: Array<{ assetId: string; score: string }> = await activities.manager.query(
      `SELECT x.assetId, COUNT(*) score FROM affiliate_asset_activities x JOIN assets a ON a.id = x.assetId AND a.deletedAt IS NULL
        WHERE x.organizationId = ? AND x.activityType IN ('DOWNLOAD','COPY','LINK_COPY','COUPON_COPY') GROUP BY x.assetId ORDER BY score DESC LIMIT 10`,
      [organizationId],
    );
    const topAssets = top.length ? await this.views(await assets.find({ where: { id: In(top.map((t) => t.assetId)) } })) : [];
    return {
      totals: {
        totalAssets, publishedBundles,
        assetViews: n(AffiliateAssetActivityType.VIEW),
        downloads: n(AffiliateAssetActivityType.DOWNLOAD),
        copies: n(AffiliateAssetActivityType.COPY, AffiliateAssetActivityType.LINK_COPY, AffiliateAssetActivityType.COUPON_COPY),
        activeAffiliatesUsingAssets: Number(u),
      },
      topAssets: top.map((t) => topAssets.find((a) => a.id === t.assetId)).filter(Boolean),
      downloadCountingRule: 'One DOWNLOAD is counted per affiliate, file and minute: repeated download-link requests for the same file within the same minute count once.',
    };
  }

  async getStorageAnalytics(organizationId: string) {
    const usage = await this.quota.getUsage(organizationId);
    const { assets } = await repos();
    const typeRows: Array<{ type: string; n: string; bytes: string }> = await assets.createQueryBuilder('a')
      .select('a.assetType', 'type').addSelect('COUNT(*)', 'n').addSelect('COALESCE(SUM(a.fileSize), 0)', 'bytes')
      .where('a.organizationId = :org AND a.deletedAt IS NULL', { org: organizationId }).groupBy('a.assetType').getRawMany();
    const currentBytes = typeRows.reduce((s, r) => s + Number(r.bytes), 0);
    const largest = await assets.find({ where: { organizationId, deletedAt: IsNull() }, order: { fileSize: 'DESC' }, take: 10 });
    const history: Array<{ d: string; bytes: string; n: string }> = await assets.manager.query(
      `SELECT DATE(o.createdAt) d, SUM(o.sizeBytes) bytes, COUNT(*) n FROM stored_objects o WHERE o.organizationId = ? AND o.countsTowardQuota = 1 GROUP BY DATE(o.createdAt) ORDER BY d`,
      [organizationId],
    );
    let running = 0;
    let count = 0;
    return {
      ...usage,
      totalStorageBytes: usage.usedBytes,
      storageLimitBytes: usage.limitBytes,
      usagePercentage: usage.percentUsed,
      assetCount: typeRows.reduce((s, r) => s + Number(r.n), 0),
      typeBreakdown: typeRows
        .map((r) => ({ type: r.type, count: Number(r.n), totalBytes: Number(r.bytes), percentage: currentBytes ? Math.round((Number(r.bytes) / currentBytes) * 1000) / 10 : 0 }))
        .sort((a, b) => b.totalBytes - a.totalBytes),
      largestAssets: await this.views(largest),
      history: history.map((h) => {
        running += Number(h.bytes);
        count += Number(h.n);
        return { date: new Date(h.d).toISOString().slice(0, 10), bytesAdded: Number(h.bytes), totalBytes: running, assetCount: count };
      }),
    };
  }

  async getUsageIntelligence(organizationId: string) {
    const { assets } = await repos();
    const all = await assets.find({ where: { organizationId, deletedAt: IsNull() }, order: { updatedAt: 'DESC' }, take: 2000 });
    const views = await this.views(all);
    const total = (a: any) => a.usage.views + a.usage.downloads + a.usage.copies;
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
    const bundled = views.filter((a: any) => a.associatedBundleCount > 0).length;
    const programs = dbStore.programs.filter((p) => p.organizationId === organizationId && !p.deletedAt);
    const dist = programs.map((p) => {
      const list = views.filter((a: any) => a.programId === p.id);
      return { programId: p.id, programName: p.name, assetCount: list.length, totalStorage: list.reduce((s, a: any) => s + a.fileSize, 0) };
    });
    const global = views.filter((a: any) => !a.programId);
    if (global.length) dist.unshift({ programId: 'global', programName: 'Global / All Programs', assetCount: global.length, totalStorage: global.reduce((s, a: any) => s + a.fileSize, 0) });
    return {
      mostUsedAssets: [...views].sort((a, b) => total(b) - total(a)).slice(0, 10),
      unusedAssets: views.filter((a: any) => total(a) === 0 && (a.associatedBundleCount === 0 || new Date(a.createdAt as string).getTime() < thirtyDaysAgo)),
      bundleCoverage: { bundledCount: bundled, orphanCount: views.length - bundled, totalAssets: views.length, bundledPercentage: views.length ? Math.round((bundled / views.length) * 100) : 0 },
      programDistribution: dist,
    };
  }

  async getAssetActivity(organizationId: string) {
    const { audit } = await repos();
    const rows = await audit.createQueryBuilder('l')
      .where('l.organizationId = :org', { org: organizationId })
      .andWhere(`l.resourceType IN ('asset', 'asset_bundle', 'organization_storage')`)
      .orderBy('l.createdAt', 'DESC').take(50).getMany();
    const users = new Map(dbStore.users.map((u) => [u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim()]));
    return rows.map((l: any) => ({
      id: l.id, action: l.action, resourceType: l.resourceType, resourceId: l.resourceId, targetName: l.targetName,
      actorName: users.get(l.actorId) || (l.actorType === 'SYSTEM' ? 'System' : 'User'),
      before: l.beforeState, after: l.afterState, metadata: l.metadata, createdAt: new Date(l.createdAt).toISOString(),
    }));
  }

  /** Used by the bundle and portal services. */
  slug(value: string) {
    return slugify(value);
  }
}
