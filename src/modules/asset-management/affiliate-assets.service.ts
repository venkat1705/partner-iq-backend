/**
 * Affiliate portal side of assets and bundles. Every list, detail, download link and ZIP goes through the same
 * access rules (asset-access.ts). The portal never receives a storage key or a permanent URL; files are fetched with a
 * short-lived signed link created after the permission check.
 */
import { ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { In, IsNull } from 'typeorm';
import { AffiliateAssetActivityType, AssetBundleStatus, AssetSourceType, AssetStatus, TrackingLinkStatus } from '../../common/enums';
import { StorageService, createZipStream } from '../../common/storage';
import { initializeDataSource } from '../../database/data-source';
import { dbStore } from '../../database/store';
import { Affiliate, Asset, AssetBundle } from '../../database/schema';
import { AffiliateAccessContext, TierInfo, assetAccess, bundleAccess } from './asset-access';
import { repos } from './asset-common';
import { RecordAssetActivityDto } from './dto/asset-management.dto';

export interface PortalUser {
  userId?: string;
  email: string;
}

@Injectable()
export class AffiliateAssetsService {
  constructor(private readonly storage: StorageService) {}

  /** The caller's affiliate rows (matched by email or linked user id), optionally limited to one organization. */
  async affiliatesFor(user: PortalUser, organizationId?: string): Promise<Affiliate[]> {
    const ds = await initializeDataSource();
    const qb = ds.getRepository(Affiliate).createQueryBuilder('a');
    if (user.userId) qb.where('(LOWER(a.email) = :email OR a.userId = :userId)', { email: user.email.toLowerCase().trim(), userId: user.userId });
    else qb.where('LOWER(a.email) = :email', { email: user.email.toLowerCase().trim() });
    if (organizationId) qb.andWhere('a.organizationId = :org', { org: organizationId });
    return qb.getMany();
  }

  /** Access context from current memberships and tiers (read from the shared in-memory store, which gamification and
   *  program membership changes update first). */
  context(affiliate: Affiliate): AffiliateAccessContext {
    const organizationId = affiliate.organizationId;
    const rewardIds = (t: any): string[] => (Array.isArray(t?.rewardsConfig?.assetBundleIds) ? t.rewardsConfig.assetBundleIds.map(String) : []);
    const tiers = new Map<string, TierInfo>(
      dbStore.partnerTiers
        .filter((t) => t.organizationId === organizationId && !t.deletedAt)
        .map((t) => [t.id, { id: t.id, programId: t.programId, name: t.name, level: Number(t.level), isActive: Boolean(t.isActive), rewardBundleIds: rewardIds(t) }]),
    );
    const programIds = dbStore.programAffiliates
      .filter((pa) => pa.organizationId === organizationId && pa.affiliateId === affiliate.id && pa.status === 'ACTIVE')
      .map((pa) => pa.programId);
    const tierByProgram = new Map<string, TierInfo>();
    for (const at of dbStore.affiliateTiers.filter((x) => x.organizationId === organizationId && x.affiliateId === affiliate.id)) {
      const tier = tiers.get(at.currentTierId);
      if (tier && programIds.includes(at.programId) && (!at.effectiveTo || new Date(at.effectiveTo) > new Date())) tierByProgram.set(at.programId, tier);
    }
    return {
      organizationId,
      affiliateId: affiliate.id,
      // removed from every program (or the affiliate row is not ACTIVE) = removed: no lists, no new links (decision A11)
      active: String(affiliate.status).toUpperCase() === 'ACTIVE' && !(affiliate as any).deletedAt && programIds.length > 0,
      programIds,
      tierByProgram,
      tiers,
    };
  }

  private async bundlesOf(organizationId: string) {
    const { bundles, items } = await repos();
    const list = await bundles.find({ where: { organizationId, deletedAt: IsNull() } });
    const rows = list.length ? await items.find({ where: { assetBundleId: In(list.map((b) => b.id)) }, order: { displayOrder: 'ASC' } }) : [];
    return { list, items: rows };
  }

  /** Signed thumbnail URLs (5 min) for the given assets. */
  private async thumbnails(assetIds: string[]) {
    const out = new Map<string, string>();
    if (!assetIds.length) return out;
    const { objects } = await repos();
    const rows = await objects.find({ where: { assetId: In(assetIds), kind: 'THUMBNAIL' }, select: { assetId: true, storageKey: true, organizationId: true } });
    for (const t of rows) {
      const signed = await this.storage.getDownloadUrl(t.storageKey, { organizationId: t.organizationId!, fileName: 'thumbnail.jpg', contentType: 'image/jpeg', disposition: 'inline' });
      out.set(t.assetId!, signed.url);
    }
    return out;
  }

  private personalize(asset: Asset, ctx: AffiliateAccessContext, thumbnailUrl?: string) {
    const affiliate = dbStore.affiliates.find((a) => a.id === ctx.affiliateId);
    const membership = asset.programId ? dbStore.programAffiliates.find((pa) => pa.programId === asset.programId && pa.affiliateId === ctx.affiliateId) : undefined;
    const program = asset.programId ? dbStore.programs.find((p) => p.id === asset.programId) : undefined;
    const organization = dbStore.organizations.find((o) => o.id === asset.organizationId);
    const link = asset.programId && membership
      ? dbStore.trackingLinks.find((t) => t.organizationId === asset.organizationId && t.programId === asset.programId && t.affiliateId === ctx.affiliateId && t.status === TrackingLinkStatus.ACTIVE)
      : undefined;
    const replacements: Record<string, string> = {
      affiliate_name: affiliate?.displayName || 'Partner',
      affiliate_code: membership?.referralCode || ctx.affiliateId.slice(0, 8),
      affiliate_tracking_link: link?.destinationUrl || '',
      program_name: program?.name || '',
      organization_name: organization?.name || '',
      campaign_name: String((asset.metadata as any)?.campaignName || ''),
    };
    const apply = (value?: string | null) => value?.replace(/\{\{([a-z_]+)\}\}/g, (_, k) => replacements[k] ?? '');
    return {
      id: asset.id,
      organizationId: asset.organizationId,
      programId: asset.programId,
      name: asset.name,
      title: asset.name,
      description: asset.description,
      assetType: asset.assetType,
      type: asset.assetType,
      sourceType: asset.sourceType,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize !== undefined && asset.fileSize !== null ? Number(asset.fileSize) : undefined,
      width: asset.width,
      height: asset.height,
      dimensions: asset.width && asset.height ? `${asset.width}x${asset.height}` : undefined,
      tags: asset.tags || [],
      textContent: apply(asset.textContent),
      copyContent: apply(asset.textContent || asset.htmlContent),
      htmlContent: apply(asset.htmlContent),
      externalUrl: apply(asset.externalUrl),
      // legacy rows whose "file" was only a client-supplied URL/key have nothing to download until migrated
      isDownloadable: asset.isDownloadable && asset.sourceType === AssetSourceType.FILE && Boolean(asset.storageKey && this.storage.keyBelongsToOrganization(asset.storageKey, asset.organizationId)),
      isCopyable: asset.isCopyable,
      thumbnailUrl,
      updatedAt: asset.updatedAt,
      createdAt: asset.createdAt,
    };
  }

  async listAssets(user: PortalUser, organizationId?: string) {
    const out = [];
    for (const affiliate of await this.affiliatesFor(user, organizationId)) {
      const ctx = this.context(affiliate);
      if (!ctx.active) continue;
      const { assets } = await repos();
      const rows = await assets.find({ where: { organizationId: affiliate.organizationId, status: AssetStatus.PUBLISHED, deletedAt: IsNull() }, order: { updatedAt: 'DESC' } });
      const { list, items } = await this.bundlesOf(affiliate.organizationId);
      const allowed = rows.filter((asset) => {
        const containing = list.filter((b) => items.some((i) => i.assetBundleId === b.id && i.assetId === asset.id));
        return assetAccess(asset, ctx, containing, { forDownload: false }).allowed;
      });
      const thumbs = await this.thumbnails(allowed.map((a) => a.id));
      for (const asset of allowed) out.push(this.personalize(asset, ctx, thumbs.get(asset.id)));
    }
    return out;
  }

  private bundleSummary(bundle: AssetBundle) {
    return {
      id: bundle.id, organizationId: bundle.organizationId, programId: bundle.programId, name: bundle.name, slug: bundle.slug,
      description: bundle.description, visibility: bundle.visibility, status: bundle.status, featured: bundle.featured,
      startDate: bundle.startDate, endDate: bundle.endDate, coverImageAssetId: bundle.coverImageAssetId,
    };
  }

  async listBundles(user: PortalUser, organizationId?: string) {
    const out = [];
    for (const affiliate of await this.affiliatesFor(user, organizationId)) {
      const ctx = this.context(affiliate);
      const { list, items } = await this.bundlesOf(affiliate.organizationId);
      const { assets } = await repos();
      const assetIds = [...new Set(items.map((i) => i.assetId))];
      const assetRows = assetIds.length ? await assets.find({ where: { id: In(assetIds), organizationId: affiliate.organizationId } }) : [];
      const thumbs = await this.thumbnails(assetRows.filter((a) => !a.deletedAt).map((a) => a.id));
      for (const bundle of list.sort((a, b) => Number(b.featured) - Number(a.featured) || a.displayOrder - b.displayOrder)) {
        const access = bundleAccess(bundle, ctx);
        if (!access.visible) continue;
        const bundleItems = items.filter((i) => i.assetBundleId === bundle.id);
        if (access.locked) {
          // locked: show that it exists and how to unlock it — never its files
          out.push({ ...this.bundleSummary(bundle), locked: true, lockReason: access.reason, requiredTier: access.requiredTier, assetCount: bundleItems.length, items: [] });
          continue;
        }
        const visible = bundleItems
          .map((i) => ({ item: i, asset: assetRows.find((a) => a.id === i.assetId) }))
          .filter((x) => x.asset && !x.asset.deletedAt && x.asset.status === AssetStatus.PUBLISHED && (!x.asset.programId || ctx.programIds.includes(x.asset.programId)));
        out.push({
          ...this.bundleSummary(bundle),
          locked: false,
          assetCount: visible.length,
          totalBytes: visible.reduce((s, x) => s + Number(x.asset!.fileSize || 0), 0),
          items: visible.map((x) => ({ id: x.item.id, displayOrder: x.item.displayOrder, customTitle: x.item.customTitle, customDescription: x.item.customDescription, asset: this.personalize(x.asset!, ctx, thumbs.get(x.asset!.id)) })),
        });
      }
    }
    return out;
  }

  private async affiliateForOrganization(user: PortalUser, organizationId: string) {
    const [affiliate] = await this.affiliatesFor(user, organizationId);
    if (!affiliate) throw new NotFoundException('NOT_FOUND');
    return affiliate;
  }

  async getBundle(user: PortalUser, bundleId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(bundleId)) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
    const { bundles } = await repos();
    const bundle = await bundles.findOne({ where: { id: bundleId, deletedAt: IsNull() } });
    if (!bundle) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
    const affiliates = await this.affiliatesFor(user, bundle.organizationId);
    if (!affiliates.length) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
    const [view] = (await this.listBundles(user, bundle.organizationId)).filter((b: any) => b.id === bundleId);
    if (!view) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
    if ((view as any).locked) {
      throw new HttpException({ statusCode: 403, code: 'BUNDLE_LOCKED', message: (view as any).lockReason, requiredTier: (view as any).requiredTier }, 403);
    }
    return view;
  }

  private async accessibleAsset(user: PortalUser, assetId: string, forDownload: boolean) {
    if (!/^[0-9a-f-]{36}$/i.test(assetId)) throw new NotFoundException('ASSET_NOT_FOUND');
    const { assets } = await repos();
    const asset = await assets.findOne({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('ASSET_NOT_FOUND');
    const affiliate = await this.affiliateForOrganization(user, asset.organizationId).catch(() => {
      throw new NotFoundException('ASSET_NOT_FOUND');
    });
    const ctx = this.context(affiliate);
    const { list, items } = await this.bundlesOf(asset.organizationId);
    const containing = list.filter((b) => items.some((i) => i.assetBundleId === b.id && i.assetId === asset.id));
    const access = assetAccess(asset, ctx, containing, { forDownload });
    if (!access.allowed) {
      if (['other organization', 'in trash', 'not published'].includes(access.reason || '')) throw new NotFoundException('ASSET_NOT_FOUND');
      throw new ForbiddenException({ statusCode: 403, code: 'ASSET_ACCESS_DENIED', message: access.reason === 'restricted bundle' ? 'This file is part of a locked bundle.' : 'You do not have access to this file.' });
    }
    return { asset, ctx };
  }

  /**
   * Download counting rule (decision A12): one DOWNLOAD per affiliate, file and minute — repeated link requests for
   * the same file within the same minute are counted once. Implemented with an idempotency key per minute.
   */
  private async countDownload(ctx: AffiliateAccessContext, assetId: string, bundleId?: string) {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `dl:${ctx.affiliateId}:${assetId}:${minute}`;
    const { activities } = await repos();
    await activities.manager.query(
      `INSERT INTO affiliate_asset_activities (id, organizationId, affiliateId, assetId, bundleId, activityType, idempotencyKey, createdAt)
       SELECT ?, ?, ?, ?, ?, 'DOWNLOAD', ?, CURRENT_TIMESTAMP(6) FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM affiliate_asset_activities WHERE organizationId = ? AND idempotencyKey = ?)`,
      [randomUUID(), ctx.organizationId, ctx.affiliateId, assetId, bundleId ?? null, key, ctx.organizationId, key],
    );
  }

  async getDownloadUrl(user: PortalUser, assetId: string, disposition: 'attachment' | 'inline' = 'attachment') {
    const { asset, ctx } = await this.accessibleAsset(user, assetId, true);
    if (asset.sourceType !== AssetSourceType.FILE || !asset.storageKey) throw new NotFoundException('This asset has no file to download.');
    if (!this.storage.keyBelongsToOrganization(asset.storageKey, asset.organizationId)) throw new ForbiddenException('ASSET_ACCESS_DENIED');
    const url = await this.storage.getDownloadUrl(asset.storageKey, { organizationId: asset.organizationId, fileName: asset.fileName || asset.name, contentType: asset.mimeType || 'application/octet-stream', disposition });
    if (disposition === 'attachment') await this.countDownload(ctx, asset.id);
    return { ...url, fileName: asset.fileName, sizeBytes: Number(asset.fileSize || 0) };
  }

  async getThumbnailUrl(user: PortalUser, assetId: string) {
    const { asset } = await this.accessibleAsset(user, assetId, false);
    const { objects } = await repos();
    const thumb = await objects.findOne({ where: { assetId: asset.id, organizationId: asset.organizationId, kind: 'THUMBNAIL' }, order: { createdAt: 'DESC' } });
    if (!thumb) throw new NotFoundException('THUMBNAIL_NOT_AVAILABLE');
    return this.storage.getDownloadUrl(thumb.storageKey, { organizationId: asset.organizationId, fileName: 'thumbnail.jpg', contentType: 'image/jpeg', disposition: 'inline' });
  }

  async recordActivity(user: PortalUser, assetId: string, dto: RecordAssetActivityDto) {
    const { asset, ctx } = await this.accessibleAsset(user, assetId, false);
    const { activities } = await repos();
    if (dto.idempotencyKey && (await activities.count({ where: { organizationId: asset.organizationId, idempotencyKey: dto.idempotencyKey } }))) return { success: true, deduped: true };
    await activities.insert({ id: randomUUID(), organizationId: asset.organizationId, affiliateId: ctx.affiliateId, assetId: asset.id, bundleId: dto.bundleId, activityType: dto.activityType, idempotencyKey: dto.idempotencyKey, createdAt: new Date() } as any);
    return { success: true };
  }

  /** ZIP of an unlocked bundle's downloadable files, streamed from storage. */
  async zip(user: PortalUser, bundleId: string) {
    const view: any = await this.getBundle(user, bundleId);
    const { assets } = await repos();
    const ids = (view.items as any[]).filter((i) => i.asset.isDownloadable).map((i) => i.asset.id);
    const rows = ids.length ? await assets.find({ where: { id: In(ids), organizationId: view.organizationId } }) : [];
    const [affiliate] = await this.affiliatesFor(user, view.organizationId);
    const ctx = this.context(affiliate);
    const entries = ids.map((id) => rows.find((r) => r.id === id)!).filter((r) => r && r.storageKey).map((r) => ({ name: r.fileName || r.name, key: r.storageKey!, assetId: r.id }));
    for (const e of entries) await this.countDownload(ctx, e.assetId, bundleId);
    return { name: `${view.slug || 'bundle'}.zip`, entries, stream: () => createZipStream(entries, this.storage, { organizationId: view.organizationId }) };
  }

  /** Bundle status shown in admin analytics: stays in sync with what affiliates see. */
  static readonly LISTED_STATUSES = [AssetBundleStatus.PUBLISHED, AssetBundleStatus.SCHEDULED];
}
