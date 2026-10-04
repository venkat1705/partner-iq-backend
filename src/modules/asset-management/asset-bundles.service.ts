/**
 * Organization-side bundles: create, edit (incl. visibility), publish, archive, add/remove/reorder files, ZIP.
 * MySQL is the source of truth; every change writes an audit row with before/after in the same transaction.
 * Bundles reference files; they use no storage and deleting a bundle never touches the files.
 */
import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager, In, IsNull } from 'typeorm';
import { AssetBundleStatus, AssetBundleVisibility, AssetSourceType, AssetStatus } from '../../common/enums';
import { StorageService, createZipStream } from '../../common/storage';
import { dbStore } from '../../database/store';
import { AssetBundle, AssetBundleItem } from '../../database/schema';
import { AssetManagementService } from './asset-management.service';
import { BUNDLE_AUDIT_FIELDS, diff, inTx, pick, repos, slugify, writeAudit } from './asset-common';
import { AddBundleAssetDto, CreateAssetBundleDto, ReorderBundleAssetsDto, UpdateAssetBundleDto } from './dto/asset-management.dto';

const TRANSITIONS: Record<string, AssetBundleStatus[]> = {
  [AssetBundleStatus.DRAFT]: [AssetBundleStatus.SCHEDULED, AssetBundleStatus.PUBLISHED, AssetBundleStatus.ARCHIVED],
  [AssetBundleStatus.SCHEDULED]: [AssetBundleStatus.PUBLISHED, AssetBundleStatus.ARCHIVED],
  [AssetBundleStatus.PUBLISHED]: [AssetBundleStatus.EXPIRED, AssetBundleStatus.ARCHIVED],
  [AssetBundleStatus.EXPIRED]: [AssetBundleStatus.ARCHIVED],
  [AssetBundleStatus.ARCHIVED]: [],
};

@Injectable()
export class AssetBundlesService {
  constructor(
    private readonly storage: StorageService,
    private readonly assets: AssetManagementService,
  ) {}

  private async findBundle(organizationId: string, bundleId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(bundleId)) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
    const { bundles } = await repos();
    const bundle = await bundles.findOne({ where: { id: bundleId, organizationId, deletedAt: IsNull() } });
    if (!bundle) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
    return bundle;
  }

  /** Validate references against this organization before anything is written. */
  private async validate(organizationId: string, next: Partial<AssetBundle>) {
    if (next.programId && !dbStore.programs.some((p) => p.id === next.programId && p.organizationId === organizationId && !p.deletedAt)) {
      throw new BadRequestException('Program does not belong to this organization');
    }
    if (next.visibility === AssetBundleVisibility.PARTNER_TIER && !next.partnerTierId) throw new BadRequestException('Choose the minimum partner tier for a tier-locked bundle (partnerTierId).');
    if (next.partnerTierId) {
      const tier = dbStore.partnerTiers.find((t) => t.id === next.partnerTierId && t.organizationId === organizationId && !t.deletedAt);
      if (!tier) throw new BadRequestException('Partner tier does not belong to this organization');
      if (next.programId && tier.programId && tier.programId !== next.programId) throw new BadRequestException('The tier belongs to a different program than the bundle.');
    }
    if (next.visibility === AssetBundleVisibility.SPECIFIC_AFFILIATES && !(next.affiliateIds || []).length) throw new BadRequestException('Choose at least one affiliate for a bundle shared with specific affiliates (affiliateIds).');
    for (const id of next.affiliateIds || []) {
      if (!dbStore.affiliates.some((a) => a.id === id && a.organizationId === organizationId)) throw new BadRequestException(`Affiliate ${id} does not belong to this organization`);
    }
    if (next.visibility === AssetBundleVisibility.AFFILIATE_SEGMENT) throw new BadRequestException('Affiliate segments are not available yet; choose another visibility.');
    if (next.coverImageAssetId) {
      const { assets } = await repos();
      const cover = await assets.findOne({ where: { id: next.coverImageAssetId, organizationId, deletedAt: IsNull() } });
      if (!cover || cover.sourceType !== AssetSourceType.FILE || !String(cover.mimeType || '').startsWith('image/')) throw new BadRequestException('The cover must be an image file of this organization.');
    }
    if (next.startDate && next.endDate && new Date(next.startDate) > new Date(next.endDate)) throw new BadRequestException('End date must be after start date');
  }

  async view(bundle: AssetBundle) {
    const { items, assets } = await repos();
    const rows = await items.find({ where: { assetBundleId: bundle.id }, order: { displayOrder: 'ASC', createdAt: 'ASC' } });
    const assetRows = rows.length ? await assets.find({ where: { id: In(rows.map((r) => r.assetId)), organizationId: bundle.organizationId } }) : [];
    const views = await this.assets.views(assetRows);
    const byId = new Map(views.map((v) => [v.id, v]));
    const itemViews = rows.map((r) => {
      const a = byId.get(r.assetId) as any;
      const unavailableReason = !a ? 'File was permanently deleted' : a.trashedAt ? 'File is in the trash' : a.status !== AssetStatus.PUBLISHED ? 'File is not published' : undefined;
      return { ...r, asset: a, available: !unavailableReason, unavailableReason };
    });
    const totalBytes = itemViews.filter((i) => i.asset && !i.asset.trashedAt).reduce((s, i) => s + Number(i.asset.fileSize || 0), 0);
    const tier = bundle.partnerTierId ? dbStore.partnerTiers.find((t) => t.id === bundle.partnerTierId) : undefined;
    return {
      ...bundle,
      affiliateIds: bundle.affiliateIds || [],
      items: itemViews,
      assetCount: itemViews.length,
      availableAssetCount: itemViews.filter((i) => i.available).length,
      totalBytes,
      partnerTier: tier ? { id: tier.id, name: tier.name, level: tier.level, programId: tier.programId } : undefined,
    };
  }

  /**
   * Summaries for the bundle list (counts and sizes from one aggregate query). Files are loaded by GET
   * /asset-bundles/:id — before, the list built a full view (files + signed thumbnails) per bundle: 1,000 bundles took
   * 4.7 s and 7.7 MB (scenario AM).
   */
  async listBundles(organizationId: string) {
    const { bundles } = await repos();
    const rows = await bundles.find({ where: { organizationId, deletedAt: IsNull() }, order: { featured: 'DESC', displayOrder: 'ASC', createdAt: 'DESC' } });
    if (!rows.length) return [];
    const stats: Array<{ id: string; n: string; available: string; bytes: string }> = await bundles.manager.query(
      `SELECT i.assetBundleId id, COUNT(*) n,
              SUM(a.id IS NOT NULL AND a.deletedAt IS NULL AND a.status = 'PUBLISHED') available,
              COALESCE(SUM(CASE WHEN a.deletedAt IS NULL THEN a.fileSize ELSE 0 END), 0) bytes
         FROM asset_bundle_items i
         JOIN asset_bundles b ON b.id = i.assetBundleId AND b.organizationId = ? AND b.deletedAt IS NULL
         LEFT JOIN assets a ON a.id = i.assetId AND a.organizationId = b.organizationId
        GROUP BY i.assetBundleId`,
      [organizationId],
    );
    const byId = new Map(stats.map((x) => [x.id, x]));
    const tiers = new Map(dbStore.partnerTiers.filter((t) => t.organizationId === organizationId).map((t) => [t.id, t]));
    return rows.map((bundle) => {
      const st = byId.get(bundle.id);
      const tier = bundle.partnerTierId ? tiers.get(bundle.partnerTierId) : undefined;
      return {
        ...bundle,
        affiliateIds: bundle.affiliateIds || [],
        items: [],
        itemsIncluded: false,
        assetCount: Number(st?.n || 0),
        availableAssetCount: Number(st?.available || 0),
        totalBytes: Number(st?.bytes || 0),
        partnerTier: tier ? { id: tier.id, name: tier.name, level: tier.level, programId: tier.programId } : undefined,
      };
    });
  }

  async getBundle(organizationId: string, bundleId: string) {
    return this.view(await this.findBundle(organizationId, bundleId));
  }

  async createBundle(organizationId: string, actorId: string, dto: CreateAssetBundleDto) {
    const now = new Date();
    const bundle: AssetBundle = {
      id: randomUUID(), organizationId, programId: dto.programId ?? undefined, campaignId: dto.campaignId, name: dto.name, slug: slugify(dto.slug || dto.name) || randomUUID().slice(0, 8),
      description: dto.description, coverImageAssetId: dto.coverImageAssetId ?? undefined, status: AssetBundleStatus.DRAFT,
      visibility: dto.visibility || AssetBundleVisibility.ALL_PROGRAM_AFFILIATES, partnerTierId: dto.partnerTierId ?? undefined,
      affiliateIds: dto.affiliateIds && dto.affiliateIds.length ? [...new Set(dto.affiliateIds)] : undefined,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined, endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      language: dto.language, country: dto.country, displayOrder: 1000, featured: dto.featured || false,
      createdBy: actorId, updatedBy: actorId, createdAt: now, updatedAt: now,
    } as AssetBundle;
    await this.validate(organizationId, bundle);
    await inTx(async (m) => {
      const r = await repos(m);
      if (await this.slugTaken(m, organizationId, bundle.slug)) throw new HttpException({ statusCode: 409, code: 'ASSET_BUNDLE_SLUG_EXISTS', message: 'A bundle with this name/slug already exists.' }, 409);
      await r.bundles.insert(bundle);
      await writeAudit(m, { organizationId, actorId, action: 'BUNDLE_CREATED', resourceType: 'asset_bundle', resourceId: bundle.id, targetName: bundle.name, after: pick(bundle, BUNDLE_AUDIT_FIELDS) });
    });
    return this.view(bundle);
  }

  async updateBundle(organizationId: string, bundleId: string, actorId: string, dto: UpdateAssetBundleDto) {
    const current = await this.findBundle(organizationId, bundleId);
    const next: AssetBundle = { ...current } as AssetBundle;
    for (const k of ['name', 'description', 'campaignId', 'visibility', 'language', 'country', 'featured', 'displayOrder'] as const) {
      if (dto[k] !== undefined) (next as any)[k] = dto[k];
    }
    if (dto.slug !== undefined) next.slug = slugify(dto.slug) || current.slug;
    if (dto.programId !== undefined) next.programId = dto.programId ?? (null as any);
    if (dto.coverImageAssetId !== undefined) next.coverImageAssetId = dto.coverImageAssetId ?? (null as any);
    if (dto.partnerTierId !== undefined) next.partnerTierId = dto.partnerTierId ?? (null as any);
    if (dto.affiliateIds !== undefined) next.affiliateIds = [...new Set(dto.affiliateIds)];
    if (dto.startDate !== undefined) next.startDate = dto.startDate ? new Date(dto.startDate) : (null as any);
    if (dto.endDate !== undefined) next.endDate = dto.endDate ? new Date(dto.endDate) : (null as any);
    if (next.visibility !== AssetBundleVisibility.PARTNER_TIER && dto.partnerTierId === undefined) next.partnerTierId = current.visibility === AssetBundleVisibility.PARTNER_TIER ? (null as any) : current.partnerTierId;
    await this.validate(organizationId, next);
    const after = await inTx(async (m) => {
      const r = await repos(m);
      const [lock] = await m.query(`SELECT id FROM asset_bundles WHERE id = ? AND organizationId = ? AND deletedAt IS NULL FOR UPDATE`, [bundleId, organizationId]);
      if (!lock) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
      if (next.slug !== current.slug && (await this.slugTaken(m, organizationId, next.slug))) {
        throw new HttpException({ statusCode: 409, code: 'ASSET_BUNDLE_SLUG_EXISTS', message: 'A bundle with this slug already exists.' }, 409);
      }
      const d = diff(current, next, BUNDLE_AUDIT_FIELDS);
      if (!d.changed.length) return current;
      const changes: Record<string, unknown> = {};
      for (const k of d.changed) changes[k] = (next as any)[k];
      await r.bundles.update({ id: bundleId }, { ...changes, updatedBy: actorId, updatedAt: new Date() } as any);
      const visibilityFields = ['visibility', 'partnerTierId', 'affiliateIds', 'programId', 'startDate', 'endDate'];
      const action = d.changed.some((k) => visibilityFields.includes(k as string)) ? 'BUNDLE_VISIBILITY_CHANGED' : 'BUNDLE_UPDATED';
      await writeAudit(m, { organizationId, actorId, action, resourceType: 'asset_bundle', resourceId: bundleId, targetName: next.name, before: d.before, after: d.after });
      return r.bundles.findOneByOrFail({ id: bundleId });
    });
    return this.view(after);
  }

  /**
   * true when a live bundle uses the slug. A deleted bundle that still holds it (deleted before slugs were released
   * on delete) gives it up here, so a deleted bundle's name can always be reused.
   */
  private async slugTaken(m: EntityManager, organizationId: string, slug: string) {
    const [row] = await m.query(`SELECT id, deletedAt FROM asset_bundles WHERE organizationId = ? AND slug = ? FOR UPDATE`, [organizationId, slug]);
    if (!row) return false;
    if (!row.deletedAt) return true;
    await m.query(`UPDATE asset_bundles SET slug = ? WHERE id = ?`, [`${slug.slice(0, 100)}--deleted-${String(row.id).slice(0, 8)}`, row.id]);
    return false;
  }

  private async transition(organizationId: string, bundleId: string, actorId: string, to: AssetBundleStatus, action: string) {
    const after = await inTx(async (m) => {
      const r = await repos(m);
      const [lock] = await m.query(`SELECT id, status, name, slug, startDate FROM asset_bundles WHERE id = ? AND organizationId = ? AND deletedAt IS NULL FOR UPDATE`, [bundleId, organizationId]);
      if (!lock) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
      let target = to;
      if (to === AssetBundleStatus.PUBLISHED && lock.startDate && new Date(lock.startDate) > new Date()) target = AssetBundleStatus.SCHEDULED;
      if (!TRANSITIONS[lock.status]?.includes(target)) throw new BadRequestException(`A ${lock.status.toLowerCase()} bundle cannot become ${target.toLowerCase()}.`);
      const changes: Record<string, unknown> = { status: target, updatedBy: actorId, updatedAt: new Date() };
      if (target === AssetBundleStatus.ARCHIVED) {
        changes.deletedAt = new Date();
        // (organizationId, slug) is unique and includes deleted rows: release the name so a new bundle can use it
        changes.slug = `${String(lock.slug).slice(0, 100)}--deleted-${bundleId.slice(0, 8)}`;
      }
      await r.bundles.update({ id: bundleId }, changes as any);
      await writeAudit(m, { organizationId, actorId, action, resourceType: 'asset_bundle', resourceId: bundleId, targetName: lock.name, before: { status: lock.status }, after: { status: target, ...(changes.deletedAt ? { deletedAt: changes.deletedAt, slug: changes.slug } : {}) } });
      return r.bundles.findOneByOrFail({ id: bundleId });
    });
    return after;
  }

  async publishBundle(organizationId: string, bundleId: string, actorId: string) {
    return this.view(await this.transition(organizationId, bundleId, actorId, AssetBundleStatus.PUBLISHED, 'BUNDLE_PUBLISHED'));
  }

  /** Delete = archive (soft). The files are untouched and keep their own storage accounting. */
  async archiveBundle(organizationId: string, bundleId: string, actorId: string) {
    await this.transition(organizationId, bundleId, actorId, AssetBundleStatus.ARCHIVED, 'BUNDLE_DELETED');
    return { success: true };
  }

  async addBundleAsset(organizationId: string, bundleId: string, actorId: string, dto: AddBundleAssetDto) {
    await this.findBundle(organizationId, bundleId);
    await inTx(async (m) => {
      const r = await repos(m);
      const asset = await r.assets.findOne({ where: { id: dto.assetId, organizationId } });
      if (!asset || asset.deletedAt) throw new NotFoundException('ASSET_NOT_FOUND');
      const [lock] = await m.query(`SELECT id, name FROM asset_bundles WHERE id = ? AND organizationId = ? AND deletedAt IS NULL FOR UPDATE`, [bundleId, organizationId]);
      if (!lock) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
      if (await r.items.findOne({ where: { assetBundleId: bundleId, assetId: dto.assetId } })) throw new HttpException({ statusCode: 409, code: 'ASSET_ALREADY_IN_BUNDLE', message: 'This file is already in the bundle.' }, 409);
      const count = await r.items.count({ where: { assetBundleId: bundleId } });
      const item: AssetBundleItem = {
        id: randomUUID(), assetBundleId: bundleId, assetId: dto.assetId, displayOrder: dto.displayOrder ?? count + 1, customTitle: dto.customTitle,
        customDescription: dto.customDescription, isFeatured: dto.isFeatured || false, createdAt: new Date(), createdBy: actorId,
      } as AssetBundleItem;
      await r.items.insert(item);
      await writeAudit(m, { organizationId, actorId, action: 'BUNDLE_ASSET_ADDED', resourceType: 'asset_bundle', resourceId: bundleId, targetName: lock.name, before: { assetCount: count }, after: { assetCount: count + 1, assetId: dto.assetId, assetName: asset.name, displayOrder: item.displayOrder } });
    });
    return this.getBundle(organizationId, bundleId);
  }

  async removeBundleAsset(organizationId: string, bundleId: string, assetId: string, actorId: string) {
    await this.findBundle(organizationId, bundleId);
    await inTx(async (m) => {
      const r = await repos(m);
      const [lock] = await m.query(`SELECT id, name FROM asset_bundles WHERE id = ? AND organizationId = ? AND deletedAt IS NULL FOR UPDATE`, [bundleId, organizationId]);
      if (!lock) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
      const item = await r.items.findOne({ where: { assetBundleId: bundleId, assetId } });
      if (!item) throw new NotFoundException('ASSET_NOT_IN_BUNDLE');
      const count = await r.items.count({ where: { assetBundleId: bundleId } });
      await r.items.delete({ id: item.id });
      await writeAudit(m, { organizationId, actorId, action: 'BUNDLE_ASSET_REMOVED', resourceType: 'asset_bundle', resourceId: bundleId, targetName: lock.name, before: { assetCount: count, assetId }, after: { assetCount: count - 1 } });
    });
    return this.getBundle(organizationId, bundleId);
  }

  async reorderBundleAssets(organizationId: string, bundleId: string, actorId: string, dto: ReorderBundleAssetsDto) {
    await this.findBundle(organizationId, bundleId);
    await inTx(async (m) => {
      const r = await repos(m);
      const [lock] = await m.query(`SELECT id, name FROM asset_bundles WHERE id = ? AND organizationId = ? AND deletedAt IS NULL FOR UPDATE`, [bundleId, organizationId]);
      if (!lock) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
      const rows = await r.items.find({ where: { assetBundleId: bundleId }, order: { displayOrder: 'ASC' } });
      const current = rows.map((i) => i.assetId);
      const wanted = dto.assetIds;
      if (wanted.length !== current.length || new Set(wanted).size !== wanted.length || wanted.some((id) => !current.includes(id))) {
        throw new BadRequestException('assetIds must list every file of the bundle exactly once.');
      }
      for (const [index, assetId] of wanted.entries()) await r.items.update({ assetBundleId: bundleId, assetId }, { displayOrder: index + 1 });
      await writeAudit(m, { organizationId, actorId, action: 'BUNDLE_REORDERED', resourceType: 'asset_bundle', resourceId: bundleId, targetName: lock.name, before: { order: current }, after: { order: wanted } });
    });
    return this.getBundle(organizationId, bundleId);
  }

  /** Admin ZIP of the bundle's current, available files (streamed from storage). */
  async zipForOrganization(organizationId: string, bundleId: string) {
    const bundle = await this.getBundle(organizationId, bundleId);
    const files = (bundle.items as any[]).filter((i) => i.asset && !i.asset.trashedAt && i.asset.hasFile);
    const { assets } = await repos();
    const rows = files.length ? await assets.find({ where: { id: In(files.map((f) => f.assetId)), organizationId } }) : [];
    const entries = files.map((f) => {
      const row = rows.find((r) => r.id === f.assetId)!;
      return { name: row.fileName || row.name, key: row.storageKey! };
    });
    return { name: `${bundle.slug || 'bundle'}.zip`, entries, stream: () => createZipStream(entries, this.storage, { organizationId }) };
  }
}
