import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  AffiliateAssetActivityType,
  AssetBundleStatus,
  AssetBundleVisibility,
  AssetSourceType,
  AssetStatus,
  AuditAction,
  TrackingLinkStatus,
} from '../../common/enums';
import {
  dbStore,
  AssetBundleEntity,
  AssetBundleItemEntity,
  AssetEntity,
  AssetVersionEntity,
} from '../../database/store';
import {
  AddAssetVersionDto,
  AddBundleAssetDto,
  BulkAssetActionDto,
  CreateAssetBundleDto,
  CreateAssetDto,
  CreateUploadUrlDto,
  ListAssetsQueryDto,
  RecordAssetActivityDto,
  ReorderBundleAssetsDto,
  UpdateAssetBundleDto,
  UpdateAssetDto,
} from './dto/asset-management.dto';

const ALLOWED_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'mp4',
  'mov',
  'webm',
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'txt',
  'csv',
]);
const BLOCKED_EXTENSIONS = new Set(['exe', 'dll', 'bat', 'cmd', 'com', 'js', 'mjs', 'ps1', 'sh', 'svg', 'html']);
const MAX_FILE_SIZE = 200 * 1024 * 1024;

interface AssetStorageProvider {
  createUploadUrl(input: { organizationId: string; fileName: string; mimeType: string; fileSize: number; checksum?: string }): Promise<{
    uploadUrl: string;
    storageProvider: string;
    storageKey: string;
    expiresAt: string;
    headers: Record<string, string>;
  }>;
  createDownloadUrl(asset: AssetEntity): Promise<{ downloadUrl: string; expiresAt: string; contentDisposition: string }>;
}

@Injectable()
export class AssetManagementService {
  private storage: AssetStorageProvider = new LocalSignedStorageProvider();

  async createUploadUrl(organizationId: string, dto: CreateUploadUrlDto) {
    this.validateFile(dto.fileName, dto.mimeType, dto.fileSize);
    const duplicate = dto.checksum
      ? dbStore.assets.find((asset) => asset.organizationId === organizationId && asset.checksum === dto.checksum && !asset.deletedAt)
      : undefined;

    return {
      ...(await this.storage.createUploadUrl({ organizationId, ...dto })),
      duplicateAssetId: duplicate?.id,
      duplicateDetected: Boolean(duplicate),
    };
  }

  async createAsset(organizationId: string, actorId: string, dto: CreateAssetDto) {
    if (dto.programId) this.assertProgramOwnership(organizationId, dto.programId);
    if (dto.sourceType === AssetSourceType.FILE) {
      this.validateFile(dto.originalFileName || dto.storageKey || dto.name, dto.mimeType || 'application/octet-stream', dto.fileSize || 0);
    }

    const sanitizedHtml = dto.htmlContent ? this.sanitizeHtml(dto.htmlContent) : undefined;
    const fileName = dto.originalFileName ? this.sanitizeFileName(dto.originalFileName) : undefined;
    const asset: AssetEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      name: dto.name.trim(),
      description: dto.description,
      assetType: dto.assetType,
      sourceType: dto.sourceType,
      contentType: dto.mimeType,
      fileName,
      originalFileName: dto.originalFileName,
      fileExtension: fileName?.split('.').pop()?.toLowerCase(),
      mimeType: dto.mimeType,
      fileSize: dto.fileSize,
      storageProvider: dto.storageKey ? 'local-signed' : undefined,
      storageKey: dto.storageKey,
      storageUrl: dto.storageUrl,
      thumbnailUrl: dto.storageUrl,
      previewUrl: dto.storageUrl || dto.externalUrl,
      textContent: dto.textContent,
      htmlContent: sanitizedHtml,
      externalUrl: dto.externalUrl,
      language: dto.language,
      country: dto.country,
      tags: this.normalizeTags(organizationId, dto.tags || []),
      metadata: { folderPath: dto.folderPath?.trim() || 'General' },
      status: dto.status || AssetStatus.DRAFT,
      isPublicToAffiliates: dto.isPublicToAffiliates ?? dto.status === AssetStatus.PUBLISHED,
      isDownloadable: dto.isDownloadable ?? true,
      isCopyable: dto.isCopyable ?? true,
      version: 1,
      checksum: dto.checksum || this.checksumForText(dto.textContent || sanitizedHtml || dto.externalUrl || dto.name),
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.assets.push(asset);
    dbStore.assetVersions.push(this.createVersionRecord(asset, actorId, 'Initial asset'));
    this.audit(organizationId, actorId, AuditAction.ASSET_CREATED, 'asset', asset.id, { name: asset.name, assetType: asset.assetType });
    return this.hydrateAsset(asset);
  }

  async listAssets(organizationId: string, query: ListAssetsQueryDto) {
    this.ensureDefaultAssets(organizationId);
    const page = Math.max(Number(query.page || 1), 1);
    const limit = Math.min(Math.max(Number(query.limit || 24), 1), 100);
    const search = query.search?.trim().toLowerCase();

    let rows = dbStore.assets.filter((asset) => asset.organizationId === organizationId && !asset.deletedAt);
    if (query.programId) rows = rows.filter((asset) => asset.programId === query.programId);
    if (query.assetType) rows = rows.filter((asset) => asset.assetType === query.assetType);
    if (query.status) rows = rows.filter((asset) => asset.status === query.status);
    if (query.language) rows = rows.filter((asset) => asset.language === query.language);
    if (query.country) rows = rows.filter((asset) => asset.country === query.country);
    if (query.folderPath) {
      rows = rows.filter((asset) => {
        const folder = (asset.metadata?.folderPath as string) || (asset.metadata?.folder as string) || 'General';
        return folder.toLowerCase() === query.folderPath!.toLowerCase();
      });
    }
    if (query.tag) {
      rows = rows.filter((asset) => (asset.tags || []).some((t) => t.toLowerCase() === query.tag!.toLowerCase()));
    }
    if (search) {
      rows = rows.filter((asset) =>
        [asset.name, asset.description, asset.fileName, asset.assetType, (asset.metadata?.folderPath as string) || '', ...(asset.tags || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search),
      );
    }

    rows = rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return {
      data: rows.slice((page - 1) * limit, page * limit).map((asset) => this.hydrateAsset(asset)),
      meta: { page, limit, total: rows.length },
    };
  }

  async getAsset(organizationId: string, assetId: string) {
    return this.hydrateAsset(this.findAsset(organizationId, assetId));
  }

  async updateAsset(organizationId: string, assetId: string, actorId: string, dto: UpdateAssetDto) {
    const asset = this.findAsset(organizationId, assetId);
    const previous = { ...asset };
    if (dto.programId) this.assertProgramOwnership(organizationId, dto.programId);

    const metadataUpdates: Record<string, unknown> = {};
    if (dto.folderPath !== undefined) {
      metadataUpdates.folderPath = dto.folderPath.trim() || 'General';
    }

    Object.assign(asset, {
      ...dto,
      metadata: { ...(asset.metadata || {}), ...metadataUpdates },
      htmlContent: dto.htmlContent ? this.sanitizeHtml(dto.htmlContent) : dto.htmlContent,
      tags: dto.tags ? this.normalizeTags(organizationId, dto.tags) : asset.tags,
      updatedBy: actorId,
      updatedAt: new Date(),
    });

    this.audit(organizationId, actorId, AuditAction.ASSET_UPDATED, 'asset', asset.id, { previous, updates: dto });
    return this.hydrateAsset(asset);
  }

  async archiveAsset(organizationId: string, assetId: string, actorId: string) {
    const asset = this.findAsset(organizationId, assetId);
    asset.status = AssetStatus.ARCHIVED;
    asset.deletedAt = new Date();
    asset.updatedBy = actorId;
    asset.updatedAt = new Date();
    this.audit(organizationId, actorId, AuditAction.ASSET_ARCHIVED, 'asset', asset.id);
    return { success: true, message: 'Asset archived' };
  }

  async addVersion(organizationId: string, assetId: string, actorId: string, dto: AddAssetVersionDto) {
    const asset = this.findAsset(organizationId, assetId);
    if (dto.fileName || dto.mimeType || dto.fileSize) {
      this.validateFile(dto.fileName || asset.fileName || asset.name, dto.mimeType || asset.mimeType || 'application/octet-stream', dto.fileSize || asset.fileSize || 0);
    }
    dbStore.assetVersions.filter((version) => version.assetId === asset.id).forEach((version) => (version.isCurrent = false));
    asset.version += 1;
    asset.fileName = dto.fileName ? this.sanitizeFileName(dto.fileName) : asset.fileName;
    asset.mimeType = dto.mimeType || asset.mimeType;
    asset.fileSize = dto.fileSize || asset.fileSize;
    asset.storageKey = dto.storageKey || asset.storageKey;
    asset.storageUrl = dto.storageUrl || asset.storageUrl;
    asset.previewUrl = dto.storageUrl || asset.previewUrl;
    asset.checksum = dto.checksum || asset.checksum;
    asset.updatedBy = actorId;
    asset.updatedAt = new Date();

    const version = this.createVersionRecord(asset, actorId, dto.changeNotes);
    dbStore.assetVersions.push(version);
    this.audit(organizationId, actorId, AuditAction.ASSET_VERSION_ADDED, 'asset', asset.id, { versionNumber: version.versionNumber });
    return version;
  }

  async listVersions(organizationId: string, assetId: string) {
    this.findAsset(organizationId, assetId);
    return dbStore.assetVersions
      .filter((version) => version.assetId === assetId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async restoreVersion(organizationId: string, assetId: string, versionId: string, actorId: string) {
    const asset = this.findAsset(organizationId, assetId);
    const version = dbStore.assetVersions.find((item) => item.id === versionId && item.assetId === assetId);
    if (!version) throw new NotFoundException('ASSET_VERSION_NOT_FOUND');
    return this.addVersion(organizationId, assetId, actorId, {
      fileName: version.fileName,
      mimeType: version.mimeType,
      fileSize: version.fileSize,
      storageKey: version.storageKey,
      storageUrl: version.storageUrl,
      checksum: version.checksum,
      changeNotes: `Restored from v${version.versionNumber}`,
    });
  }

  async createBundle(organizationId: string, actorId: string, dto: CreateAssetBundleDto) {
    if (dto.programId) this.assertProgramOwnership(organizationId, dto.programId);
    if (dto.coverImageAssetId) this.findAsset(organizationId, dto.coverImageAssetId);
    this.validateDateRange(dto.startDate, dto.endDate);
    const slug = this.slugify(dto.slug || dto.name);
    if (dbStore.assetBundles.some((bundle) => bundle.organizationId === organizationId && bundle.slug === slug && !bundle.deletedAt)) {
      throw new BadRequestException('ASSET_BUNDLE_SLUG_EXISTS');
    }

    const bundle: AssetBundleEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      campaignId: dto.campaignId,
      name: dto.name.trim(),
      slug,
      description: dto.description,
      coverImageAssetId: dto.coverImageAssetId,
      status: dto.status || AssetBundleStatus.DRAFT,
      visibility: dto.visibility || AssetBundleVisibility.ALL_PROGRAM_AFFILIATES,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      language: dto.language,
      country: dto.country,
      displayOrder: 1000,
      featured: dto.featured || false,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    dbStore.assetBundles.push(bundle);
    this.audit(organizationId, actorId, AuditAction.BUNDLE_CREATED, 'asset_bundle', bundle.id, { name: bundle.name });
    return this.hydrateBundle(bundle);
  }

  async listBundles(organizationId: string) {
    this.ensureDefaultAssets(organizationId);
    return dbStore.assetBundles
      .filter((bundle) => bundle.organizationId === organizationId && !bundle.deletedAt)
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.displayOrder - b.displayOrder)
      .map((bundle) => this.hydrateBundle(bundle));
  }

  async getBundle(organizationId: string, bundleId: string) {
    return this.hydrateBundle(this.findBundle(organizationId, bundleId));
  }

  async updateBundle(organizationId: string, bundleId: string, actorId: string, dto: UpdateAssetBundleDto) {
    const bundle = this.findBundle(organizationId, bundleId);
    this.validateDateRange(dto.startDate, dto.endDate);
    if (dto.programId) this.assertProgramOwnership(organizationId, dto.programId);
    Object.assign(bundle, {
      ...dto,
      slug: dto.slug ? this.slugify(dto.slug) : bundle.slug,
      startDate: dto.startDate ? new Date(dto.startDate) : bundle.startDate,
      endDate: dto.endDate ? new Date(dto.endDate) : bundle.endDate,
      updatedBy: actorId,
      updatedAt: new Date(),
    });
    this.audit(organizationId, actorId, AuditAction.BUNDLE_UPDATED, 'asset_bundle', bundle.id, { updates: dto });
    return this.hydrateBundle(bundle);
  }

  async addBundleAsset(organizationId: string, bundleId: string, actorId: string, dto: AddBundleAssetDto) {
    const bundle = this.findBundle(organizationId, bundleId);
    this.findAsset(organizationId, dto.assetId);
    if (dbStore.assetBundleItems.some((item) => item.assetBundleId === bundle.id && item.assetId === dto.assetId)) {
      throw new BadRequestException('ASSET_ALREADY_IN_BUNDLE');
    }
    const item: AssetBundleItemEntity = {
      id: uuidv4(),
      assetBundleId: bundle.id,
      assetId: dto.assetId,
      displayOrder: dto.displayOrder ?? dbStore.assetBundleItems.filter((row) => row.assetBundleId === bundle.id).length + 1,
      customTitle: dto.customTitle,
      customDescription: dto.customDescription,
      isFeatured: dto.isFeatured || false,
      createdAt: new Date(),
      createdBy: actorId,
    };
    dbStore.assetBundleItems.push(item);
    return this.hydrateBundle(bundle);
  }

  async removeBundleAsset(organizationId: string, bundleId: string, assetId: string) {
    this.findBundle(organizationId, bundleId);
    this.findAsset(organizationId, assetId);
    const index = dbStore.assetBundleItems.findIndex((item) => item.assetBundleId === bundleId && item.assetId === assetId);
    if (index >= 0) dbStore.assetBundleItems.splice(index, 1);
    return { success: true };
  }

  async reorderBundleAssets(organizationId: string, bundleId: string, dto: ReorderBundleAssetsDto) {
    this.findBundle(organizationId, bundleId);
    dto.assetIds.forEach((assetId, index) => {
      const item = dbStore.assetBundleItems.find((row) => row.assetBundleId === bundleId && row.assetId === assetId);
      if (item) item.displayOrder = index + 1;
    });
    return this.getBundle(organizationId, bundleId);
  }

  async publishBundle(organizationId: string, bundleId: string, actorId: string) {
    const bundle = this.findBundle(organizationId, bundleId);
    this.assertBundleTransition(bundle.status, AssetBundleStatus.PUBLISHED);
    bundle.status = bundle.startDate && bundle.startDate > new Date() ? AssetBundleStatus.SCHEDULED : AssetBundleStatus.PUBLISHED;
    bundle.updatedBy = actorId;
    bundle.updatedAt = new Date();
    this.audit(organizationId, actorId, AuditAction.BUNDLE_PUBLISHED, 'asset_bundle', bundle.id, { status: bundle.status });
    return this.hydrateBundle(bundle);
  }

  async archiveBundle(organizationId: string, bundleId: string, actorId: string) {
    const bundle = this.findBundle(organizationId, bundleId);
    bundle.status = AssetBundleStatus.ARCHIVED;
    bundle.deletedAt = new Date();
    bundle.updatedBy = actorId;
    bundle.updatedAt = new Date();
    this.audit(organizationId, actorId, AuditAction.BUNDLE_ARCHIVED, 'asset_bundle', bundle.id);
    return { success: true };
  }

  async listAffiliateBundles(organizationId: string, affiliateId: string) {
    this.ensureDefaultAssets(organizationId);
    const eligibleProgramIds = this.getAffiliateProgramIds(organizationId, affiliateId);
    return dbStore.assetBundles
      .filter((bundle) => bundle.organizationId === organizationId && this.isBundleVisibleToAffiliate(bundle, affiliateId, eligibleProgramIds))
      .map((bundle) => this.hydrateBundle(bundle, affiliateId));
  }

  async getAffiliateBundle(organizationId: string, bundleId: string, affiliateId: string) {
    const bundle = this.findBundle(organizationId, bundleId);
    if (!this.isBundleVisibleToAffiliate(bundle, affiliateId, this.getAffiliateProgramIds(organizationId, affiliateId))) {
      throw new ForbiddenException('ASSET_BUNDLE_ACCESS_DENIED');
    }
    return this.hydrateBundle(bundle, affiliateId);
  }

  async listAffiliateAssets(organizationId: string, affiliateId: string) {
    this.ensureDefaultAssets(organizationId);
    const programIds = this.getAffiliateProgramIds(organizationId, affiliateId);
    return dbStore.assets
      .filter((asset) =>
        asset.organizationId === organizationId &&
        asset.status === AssetStatus.PUBLISHED &&
        asset.isPublicToAffiliates &&
        !asset.deletedAt &&
        (!asset.programId || programIds.includes(asset.programId)),
      )
      .map((asset) => this.personalizeAsset(asset, affiliateId));
  }

  async recordActivity(organizationId: string, affiliateId: string, assetId: string, dto: RecordAssetActivityDto) {
    const asset = this.findAsset(organizationId, assetId);
    if (dto.idempotencyKey && dbStore.affiliateAssetActivities.some((row) => row.organizationId === organizationId && row.idempotencyKey === dto.idempotencyKey)) {
      return { success: true, deduped: true };
    }
    dbStore.affiliateAssetActivities.push({
      id: uuidv4(),
      organizationId,
      affiliateId,
      assetId: asset.id,
      bundleId: dto.bundleId,
      activityType: dto.activityType,
      idempotencyKey: dto.idempotencyKey,
      metadata: dto.metadata,
      createdAt: new Date(),
    });
    return { success: true };
  }

  async getDownloadUrl(organizationId: string, affiliateId: string, assetId: string) {
    const asset = this.findAsset(organizationId, assetId);
    if (!asset.isDownloadable || asset.status !== AssetStatus.PUBLISHED) throw new ForbiddenException('ASSET_ACCESS_DENIED');
    await this.recordActivity(organizationId, affiliateId, assetId, { activityType: AffiliateAssetActivityType.DOWNLOAD });
    return this.storage.createDownloadUrl(asset);
  }

  async analytics(organizationId: string) {
    this.ensureDefaultAssets(organizationId);
    const assets = dbStore.assets.filter((asset) => asset.organizationId === organizationId && !asset.deletedAt);
    const bundles = dbStore.assetBundles.filter((bundle) => bundle.organizationId === organizationId && !bundle.deletedAt);
    const activities = dbStore.affiliateAssetActivities.filter((activity) => activity.organizationId === organizationId);
    const byAsset = assets.map((asset) => this.assetUsage(asset));
    return {
      totals: {
        totalAssets: assets.length,
        publishedBundles: bundles.filter((bundle) => bundle.status === AssetBundleStatus.PUBLISHED).length,
        assetViews: activities.filter((activity) => activity.activityType === AffiliateAssetActivityType.VIEW).length,
        downloads: activities.filter((activity) => activity.activityType === AffiliateAssetActivityType.DOWNLOAD).length,
        copies: activities.filter((activity) => [AffiliateAssetActivityType.COPY, AffiliateAssetActivityType.LINK_COPY, AffiliateAssetActivityType.COUPON_COPY].includes(activity.activityType)).length,
        activeAffiliatesUsingAssets: new Set(activities.map((activity) => activity.affiliateId)).size,
      },
      topAssets: byAsset.sort((a, b) => b.downloads + b.copies - (a.downloads + a.copies)).slice(0, 10),
      note: 'Revenue and conversion fields are attribution correlations where matching tracking data exists, not proof of causation.',
    };
  }

  async getStorageAnalytics(organizationId: string) {
    this.ensureDefaultAssets(organizationId);
    const assets = dbStore.assets.filter((a) => a.organizationId === organizationId && !a.deletedAt);
    const totalStorageBytes = assets.reduce((sum, a) => sum + (Number(a.fileSize) || 0), 0);
    const storageLimitBytes = 50 * 1024 * 1024 * 1024; // 50 GB default quota
    const usagePercentage = Math.round((totalStorageBytes / storageLimitBytes) * 10000) / 100;

    const typeMap = new Map<string, { count: number; totalBytes: number }>();
    for (const asset of assets) {
      const type = (asset.assetType as string) || (asset as any).type || 'OTHER';
      const entry = typeMap.get(type) || { count: 0, totalBytes: 0 };
      entry.count += 1;
      entry.totalBytes += Number(asset.fileSize) || 0;
      typeMap.set(type, entry);
    }

    const typeBreakdown = Array.from(typeMap.entries())
      .map(([type, stats]) => ({
        type,
        count: stats.count,
        totalBytes: stats.totalBytes,
        percentage: totalStorageBytes > 0 ? Math.round((stats.totalBytes / totalStorageBytes) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.totalBytes - a.totalBytes);

    const largestAssets = [...assets]
      .sort((a, b) => (Number(b.fileSize) || 0) - (Number(a.fileSize) || 0))
      .slice(0, 10)
      .map((asset) => this.hydrateAsset(asset));

    const sortedByDate = [...assets].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const historyMap = new Map<string, { bytesAdded: number; totalBytes: number; assetCount: number }>();
    let runningBytes = 0;
    let runningCount = 0;

    for (const asset of sortedByDate) {
      const dateKey = new Date(asset.createdAt).toISOString().slice(0, 10);
      runningBytes += Number(asset.fileSize) || 0;
      runningCount += 1;
      historyMap.set(dateKey, {
        bytesAdded: (historyMap.get(dateKey)?.bytesAdded || 0) + (Number(asset.fileSize) || 0),
        totalBytes: runningBytes,
        assetCount: runningCount,
      });
    }

    const history = Array.from(historyMap.entries()).map(([date, val]) => ({
      date,
      bytesAdded: val.bytesAdded,
      totalBytes: val.totalBytes,
      assetCount: val.assetCount,
    }));

    return {
      totalStorageBytes,
      storageLimitBytes,
      usagePercentage,
      assetCount: assets.length,
      typeBreakdown,
      largestAssets,
      history,
    };
  }

  async getUsageIntelligence(organizationId: string) {
    this.ensureDefaultAssets(organizationId);
    const assets = dbStore.assets.filter((a) => a.organizationId === organizationId && !a.deletedAt);
    const bundleItems = dbStore.assetBundleItems;
    const programs = dbStore.programs.filter((p) => p.organizationId === organizationId && !p.deletedAt);

    const hydratedAssets = assets.map((a) => this.hydrateAsset(a));

    const mostUsedAssets = [...hydratedAssets]
      .sort((a, b) => (b.usage.views + b.usage.downloads + b.usage.copies) - (a.usage.views + a.usage.downloads + a.usage.copies))
      .slice(0, 10);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const unusedAssets = hydratedAssets.filter((a) => {
      const totalEngagement = a.usage.views + a.usage.downloads + a.usage.copies;
      const inBundle = bundleItems.some((bi) => bi.assetId === a.id);
      if (!inBundle && totalEngagement === 0) return true;
      if (new Date(a.createdAt) < thirtyDaysAgo && totalEngagement === 0) return true;
      return false;
    });

    const bundledAssetIds = new Set(bundleItems.map((bi) => bi.assetId));
    const bundledCount = assets.filter((a) => bundledAssetIds.has(a.id)).length;
    const orphanCount = assets.length - bundledCount;

    const programDistribution = programs.map((p) => {
      const programAssets = assets.filter((a) => a.programId === p.id);
      return {
        programId: p.id,
        programName: p.name,
        assetCount: programAssets.length,
        totalStorage: programAssets.reduce((sum, a) => sum + (Number(a.fileSize) || 0), 0),
      };
    });

    const globalAssets = assets.filter((a) => !a.programId);
    if (globalAssets.length > 0) {
      programDistribution.unshift({
        programId: 'global',
        programName: 'Global / All Programs',
        assetCount: globalAssets.length,
        totalStorage: globalAssets.reduce((sum, a) => sum + (Number(a.fileSize) || 0), 0),
      });
    }

    return {
      mostUsedAssets,
      unusedAssets,
      bundleCoverage: {
        bundledCount,
        orphanCount,
        totalAssets: assets.length,
        bundledPercentage: assets.length > 0 ? Math.round((bundledCount / assets.length) * 100) : 0,
      },
      programDistribution,
    };
  }

  async listFolders(organizationId: string) {
    this.ensureDefaultAssets(organizationId);
    const assets = dbStore.assets.filter((a) => a.organizationId === organizationId && !a.deletedAt);
    const folderMap = new Map<string, { count: number; totalBytes: number; lastModified: Date }>();

    const defaultFolders = ['Brand Assets', 'Ad Creatives', 'Email Copies', 'Product Kits', 'General'];
    for (const df of defaultFolders) {
      folderMap.set(df, { count: 0, totalBytes: 0, lastModified: new Date() });
    }

    for (const asset of assets) {
      const folder = (asset.metadata?.folderPath as string) || (asset.metadata?.folder as string) || 'General';
      const entry = folderMap.get(folder) || { count: 0, totalBytes: 0, lastModified: new Date(asset.updatedAt || asset.createdAt) };
      entry.count += 1;
      entry.totalBytes += Number(asset.fileSize) || 0;
      const updated = new Date(asset.updatedAt || asset.createdAt);
      if (updated > entry.lastModified) {
        entry.lastModified = updated;
      }
      folderMap.set(folder, entry);
    }

    return Array.from(folderMap.entries())
      .map(([folder, stats]) => ({
        folder,
        assetCount: stats.count,
        totalBytes: stats.totalBytes,
        lastModified: stats.lastModified.toISOString(),
      }))
      .sort((a, b) => b.assetCount - a.assetCount);
  }

  async getAssetUsageReferences(organizationId: string, assetId: string) {
    const asset = this.findAsset(organizationId, assetId);
    const bundleItems = dbStore.assetBundleItems.filter((bi) => bi.assetId === asset.id);
    const bundles = bundleItems
      .map((bi) => dbStore.assetBundles.find((b) => b.id === bi.assetBundleId && !b.deletedAt))
      .filter(Boolean);

    const programs = asset.programId
      ? dbStore.programs.filter((p) => p.id === asset.programId && !p.deletedAt)
      : [];

    const activities = dbStore.affiliateAssetActivities
      .filter((a) => a.assetId === asset.id && a.organizationId === organizationId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);

    return {
      asset: this.hydrateAsset(asset),
      bundles: bundles.map((b) => ({
        id: b!.id,
        name: b!.name,
        status: b!.status,
        visibility: b!.visibility,
        programId: b!.programId,
      })),
      programs: programs.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
      })),
      recentActivities: activities.map((act) => {
        const affiliate = dbStore.affiliates.find((aff) => aff.id === act.affiliateId);
        return {
          id: act.id,
          activityType: act.activityType,
          affiliateId: act.affiliateId,
          affiliateName: affiliate?.displayName || 'Affiliate Partner',
          createdAt: new Date(act.createdAt).toISOString(),
        };
      }),
    };
  }

  async getAssetActivity(organizationId: string) {
    const auditLogs = dbStore.auditLogs
      .filter((log) => log.organizationId === organizationId && ['asset', 'asset_bundle'].includes(log.resourceType))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);

    return auditLogs.map((log) => {
      const user = dbStore.users.find((u) => u.id === log.actorId);
      return {
        id: log.id,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        actorName: user ? `${user.firstName} ${user.lastName}`.trim() : 'System User',
        metadata: log.metadata,
        createdAt: new Date(log.createdAt).toISOString(),
      };
    });
  }

  async bulkAction(organizationId: string, actorId: string, dto: BulkAssetActionDto) {
    const affected: string[] = [];
    for (const assetId of dto.assetIds) {
      const asset = dbStore.assets.find((a) => a.id === assetId && a.organizationId === organizationId && !a.deletedAt);
      if (!asset) continue;

      if (dto.action === 'ARCHIVE') {
        asset.status = AssetStatus.ARCHIVED;
        asset.deletedAt = new Date();
        asset.updatedBy = actorId;
        asset.updatedAt = new Date();
        this.audit(organizationId, actorId, AuditAction.ASSET_ARCHIVED, 'asset', asset.id);
      } else if (dto.action === 'MOVE') {
        if (dto.folderPath) {
          asset.metadata = { ...(asset.metadata || {}), folderPath: dto.folderPath.trim() || 'General' };
          asset.updatedBy = actorId;
          asset.updatedAt = new Date();
          this.audit(organizationId, actorId, AuditAction.ASSET_UPDATED, 'asset', asset.id, { movedTo: dto.folderPath });
        }
      } else if (dto.action === 'TAG') {
        if (dto.tags && dto.tags.length > 0) {
          const merged = this.normalizeTags(organizationId, [...(asset.tags || []), ...dto.tags]);
          asset.tags = merged;
          asset.updatedBy = actorId;
          asset.updatedAt = new Date();
          this.audit(organizationId, actorId, AuditAction.ASSET_UPDATED, 'asset', asset.id, { addedTags: dto.tags });
        }
      }
      affected.push(asset.id);
    }
    return { success: true, count: affected.length, affected };
  }

  private hydrateAsset(asset: AssetEntity) {
    const folder = (asset.metadata?.folderPath as string) || (asset.metadata?.folder as string) || 'General';
    const rawSize = asset.fileSize ? Number(asset.fileSize) : ((asset as any).fileSizeBytes ? Number((asset as any).fileSizeBytes) : 0);
    return {
      ...asset,
      name: asset.name || (asset as any).title || 'Untitled Asset',
      assetType: asset.assetType || (asset as any).type || 'BANNER',
      fileSize: rawSize,
      storageUrl: asset.storageUrl || (asset as any).fileUrl || asset.previewUrl,
      folder,
      usage: this.assetUsage(asset),
      associatedBundleCount: dbStore.assetBundleItems.filter((item) => item.assetId === asset.id).length,
    };
  }

  private hydrateBundle(bundle: AssetBundleEntity, affiliateId?: string) {
    const items = dbStore.assetBundleItems
      .filter((item) => item.assetBundleId === bundle.id)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((item) => ({
        ...item,
        asset: affiliateId ? this.personalizeAsset(this.findAsset(bundle.organizationId, item.assetId), affiliateId) : this.hydrateAsset(this.findAsset(bundle.organizationId, item.assetId)),
      }));
    return {
      ...bundle,
      items,
      assetCount: items.length,
      coverImage: bundle.coverImageAssetId ? this.hydrateAsset(this.findAsset(bundle.organizationId, bundle.coverImageAssetId)) : undefined,
      analytics: this.bundleUsage(bundle.id),
    };
  }

  private personalizeAsset(asset: AssetEntity, affiliateId: string) {
    const affiliate = dbStore.affiliates.find((item) => item.id === affiliateId && item.organizationId === asset.organizationId);
    const programAffiliate = asset.programId
      ? dbStore.programAffiliates.find((item) => item.organizationId === asset.organizationId && item.programId === asset.programId && item.affiliateId === affiliateId)
      : undefined;
    const program = asset.programId ? dbStore.programs.find((item) => item.id === asset.programId) : undefined;
    const organization = dbStore.organizations.find((item) => item.id === asset.organizationId);
    const trackingLink =
      asset.programId && programAffiliate
        ? dbStore.trackingLinks.find((item) => item.organizationId === asset.organizationId && item.programId === asset.programId && item.affiliateId === affiliateId && item.status === TrackingLinkStatus.ACTIVE)
        : undefined;
    const couponCode = (affiliate?.displayName || 'PARTNER').replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase() + '20';
    const replacements: Record<string, string> = {
      affiliate_name: affiliate?.displayName || 'Partner',
      affiliate_code: programAffiliate?.referralCode || affiliate?.id.slice(0, 8) || 'partner',
      affiliate_tracking_link: trackingLink?.destinationUrl || (program ? `https://${organization?.slug || 'example'}.com/?ref=${programAffiliate?.referralCode || affiliate?.id.slice(0, 8)}` : ''),
      program_name: program?.name || '',
      organization_name: organization?.name || '',
      campaign_name: String(asset.metadata?.campaignName || ''),
      coupon_code: couponCode,
    };
    const apply = (value?: string) => value?.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => replacements[key] || '');
    return {
      ...this.hydrateAsset(asset),
      textContent: apply(asset.textContent),
      htmlContent: apply(asset.htmlContent),
      externalUrl: apply(asset.externalUrl),
      personalized: { couponCode, trackingLink: replacements.affiliate_tracking_link },
    };
  }

  private assetUsage(asset: AssetEntity) {
    const events = dbStore.affiliateAssetActivities.filter((activity) => activity.assetId === asset.id);
    return {
      views: events.filter((activity) => activity.activityType === AffiliateAssetActivityType.VIEW).length,
      previews: events.filter((activity) => activity.activityType === AffiliateAssetActivityType.PREVIEW).length,
      downloads: events.filter((activity) => activity.activityType === AffiliateAssetActivityType.DOWNLOAD).length,
      copies: events.filter((activity) => [AffiliateAssetActivityType.COPY, AffiliateAssetActivityType.LINK_COPY, AffiliateAssetActivityType.COUPON_COPY].includes(activity.activityType)).length,
      uniqueAffiliates: new Set(events.map((activity) => activity.affiliateId)).size,
      conversionsAssociated: 0,
      revenueAssociated: 0,
    };
  }

  private bundleUsage(bundleId: string) {
    const events = dbStore.affiliateAssetActivities.filter((activity) => activity.bundleId === bundleId);
    return {
      bundleViews: events.filter((activity) => activity.activityType === AffiliateAssetActivityType.VIEW).length,
      uniqueAffiliates: new Set(events.map((activity) => activity.affiliateId)).size,
      assetDownloads: events.filter((activity) => activity.activityType === AffiliateAssetActivityType.DOWNLOAD).length,
      trackingLinkCopies: events.filter((activity) => activity.activityType === AffiliateAssetActivityType.LINK_COPY).length,
      conversions: 0,
      revenue: 0,
      commissionGenerated: 0,
    };
  }

  private findAsset(organizationId: string, assetId: string) {
    const asset = dbStore.assets.find((item) => item.id === assetId && item.organizationId === organizationId && !item.deletedAt);
    if (!asset) throw new NotFoundException('ASSET_NOT_FOUND');
    return asset;
  }

  private findBundle(organizationId: string, bundleId: string) {
    const bundle = dbStore.assetBundles.find((item) => item.id === bundleId && item.organizationId === organizationId && !item.deletedAt);
    if (!bundle) throw new NotFoundException('ASSET_BUNDLE_NOT_FOUND');
    return bundle;
  }

  private assertProgramOwnership(organizationId: string, programId: string) {
    if (!dbStore.programs.some((program) => program.id === programId && program.organizationId === organizationId && !program.deletedAt)) {
      throw new BadRequestException('Program does not belong to this organization');
    }
  }

  private getAffiliateProgramIds(organizationId: string, affiliateId: string) {
    return dbStore.programAffiliates
      .filter((item) => item.organizationId === organizationId && item.affiliateId === affiliateId && item.status === 'ACTIVE')
      .map((item) => item.programId);
  }

  private isBundleVisibleToAffiliate(bundle: AssetBundleEntity, affiliateId: string, programIds: string[]) {
    if (![AssetBundleStatus.PUBLISHED, AssetBundleStatus.SCHEDULED].includes(bundle.status)) return false;
    const now = new Date();
    if (bundle.startDate && bundle.startDate > now) return false;
    if (bundle.endDate && bundle.endDate < now) return false;
    if (bundle.programId && !programIds.includes(bundle.programId)) return false;
    if (bundle.visibility === AssetBundleVisibility.PRIVATE) return false;
    if (bundle.visibility === AssetBundleVisibility.SPECIFIC_AFFILIATES) return bundle.affiliateIds?.includes(affiliateId) || false;
    return true;
  }

  private assertBundleTransition(from: AssetBundleStatus, to: AssetBundleStatus) {
    const allowed: Record<AssetBundleStatus, AssetBundleStatus[]> = {
      [AssetBundleStatus.DRAFT]: [AssetBundleStatus.SCHEDULED, AssetBundleStatus.PUBLISHED, AssetBundleStatus.ARCHIVED],
      [AssetBundleStatus.SCHEDULED]: [AssetBundleStatus.PUBLISHED, AssetBundleStatus.ARCHIVED],
      [AssetBundleStatus.PUBLISHED]: [AssetBundleStatus.EXPIRED, AssetBundleStatus.ARCHIVED],
      [AssetBundleStatus.EXPIRED]: [AssetBundleStatus.ARCHIVED],
      [AssetBundleStatus.ARCHIVED]: [],
    };
    if (!allowed[from].includes(to)) throw new BadRequestException('Invalid asset bundle status transition');
  }

  private validateFile(fileName: string, mimeType: string, fileSize: number) {
    const sanitized = this.sanitizeFileName(fileName);
    const ext = sanitized.split('.').pop()?.toLowerCase() || '';
    if (!ext || BLOCKED_EXTENSIONS.has(ext) || !ALLOWED_EXTENSIONS.has(ext)) throw new BadRequestException('ASSET_FILE_INVALID');
    if (fileSize > MAX_FILE_SIZE) throw new BadRequestException('ASSET_TOO_LARGE');
    if (mimeType.includes('javascript') || mimeType.includes('x-msdownload')) throw new BadRequestException('ASSET_FILE_INVALID');
  }

  private sanitizeFileName(fileName: string) {
    return fileName.replace(/[\\/]/g, '').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180);
  }

  private sanitizeHtml(html: string) {
    return html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/javascript:/gi, '');
  }

  private normalizeTags(organizationId: string, tags: string[]) {
    return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 20))].map((name) => {
      const slug = this.slugify(name);
      if (!dbStore.assetTags.some((tag) => tag.organizationId === organizationId && tag.slug === slug)) {
        dbStore.assetTags.push({ id: uuidv4(), organizationId, name, slug, createdAt: new Date() });
      }
      return name;
    });
  }

  private validateDateRange(startDate?: string, endDate?: string) {
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) throw new BadRequestException('End date must be after start date');
  }

  private createVersionRecord(asset: AssetEntity, actorId: string, changeNotes?: string): AssetVersionEntity {
    return {
      id: uuidv4(),
      assetId: asset.id,
      versionNumber: asset.version,
      storageKey: asset.storageKey,
      storageUrl: asset.storageUrl,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      checksum: asset.checksum,
      createdBy: actorId,
      createdAt: new Date(),
      changeNotes,
      isCurrent: true,
    };
  }

  private checksumForText(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private slugify(value: string) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
  }

  ensureDefaultAssets(organizationId: string) {
    const existing = dbStore.assets.filter((a) => a.organizationId === organizationId && !a.deletedAt);
    if (existing.length > 0) return;

    const program = dbStore.programs.find((p) => p.organizationId === organizationId && !p.deletedAt);
    const programId = program?.id;
    const actorId = dbStore.users.find((u) => u.organizationId === organizationId)?.id || 'system';
    const affiliate = dbStore.affiliates.find((a) => a.organizationId === organizationId);
    const affiliateId = affiliate?.id || uuidv4();

    const asset1Id = uuidv4();
    const asset2Id = uuidv4();
    const asset3Id = uuidv4();
    const asset4Id = uuidv4();
    const asset5Id = uuidv4();
    const asset6Id = uuidv4();
    const asset7Id = uuidv4();

    const now = Date.now();
    const dayMs = 86400000;

    const defaultAssets: AssetEntity[] = [
      {
        id: asset1Id,
        organizationId,
        programId,
        name: 'Dark Mode Product Showcase Banner (1200x630)',
        title: 'Dark Mode Product Showcase Banner (1200x630)',
        description: 'High-converting dark mode banner optimized for Twitter, LinkedIn, and social media cards.',
        assetType: 'BANNER' as any,
        sourceType: 'FILE' as any,
        fileName: 'product-showcase-1200x630.png',
        originalFileName: 'product-showcase-1200x630.png',
        fileExtension: 'png',
        mimeType: 'image/png',
        fileSize: 1845000,
        storageUrl: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1600&auto=format&fit=crop&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=400&auto=format&fit=crop&q=80',
        previewUrl: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1600&auto=format&fit=crop&q=80',
        status: AssetStatus.PUBLISHED,
        isPublicToAffiliates: true,
        isDownloadable: true,
        isCopyable: true,
        version: 2,
        tags: ['Twitter Card', 'Dark Mode', 'Social Banner'],
        metadata: { folderPath: 'Ad Creatives' },
        checksum: this.checksumForText('banner-1200x630'),
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(now - 40 * dayMs),
        updatedAt: new Date(now - 12 * dayMs),
      },
      {
        id: asset2Id,
        organizationId,
        programId,
        name: 'Official Corporate Vector Logo & Icon Kit',
        title: 'Official Corporate Vector Logo & Icon Kit',
        description: 'Official corporate logo variations including light, dark, and monochrome SVG and PNG formats.',
        assetType: 'LOGO' as any,
        sourceType: 'FILE' as any,
        fileName: 'official-brand-logos.zip',
        originalFileName: 'official-brand-logos.zip',
        fileExtension: 'zip',
        mimeType: 'application/zip',
        fileSize: 2450000,
        storageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1600&auto=format&fit=crop&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80',
        previewUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1600&auto=format&fit=crop&q=80',
        status: AssetStatus.PUBLISHED,
        isPublicToAffiliates: true,
        isDownloadable: true,
        isCopyable: true,
        version: 1,
        tags: ['Brand Kit', 'Logos', 'Vectors'],
        metadata: { folderPath: 'Brand Assets' },
        checksum: this.checksumForText('brand-kit'),
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(now - 38 * dayMs),
        updatedAt: new Date(now - 38 * dayMs),
      },
      {
        id: asset3Id,
        organizationId,
        programId,
        name: 'Leaderboard Web Banner (728x90)',
        title: 'Leaderboard Web Banner (728x90)',
        description: 'Standard 728x90 leaderboard ad display creative for tech blogs and developer newsletters.',
        assetType: 'BANNER' as any,
        sourceType: 'FILE' as any,
        fileName: 'leaderboard-728x90.png',
        originalFileName: 'leaderboard-728x90.png',
        fileExtension: 'png',
        mimeType: 'image/png',
        fileSize: 420000,
        storageUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1600&auto=format&fit=crop&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&auto=format&fit=crop&q=80',
        previewUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1600&auto=format&fit=crop&q=80',
        status: AssetStatus.PUBLISHED,
        isPublicToAffiliates: true,
        isDownloadable: true,
        isCopyable: true,
        version: 1,
        tags: ['Display Ad', 'Banner'],
        metadata: { folderPath: 'Ad Creatives' },
        checksum: this.checksumForText('leaderboard-banner'),
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(now - 35 * dayMs),
        updatedAt: new Date(now - 35 * dayMs),
      },
      {
        id: asset4Id,
        organizationId,
        programId,
        name: 'High-Converting Newsletter Email Copy Template',
        title: 'High-Converting Newsletter Email Copy Template',
        description: 'Proven email swipe copy explaining platform advantages with coupon placeholders.',
        assetType: 'EMAIL_TEMPLATE' as any,
        sourceType: 'TEXT' as any,
        textContent: `Subject: Accelerate your partner ROI with modern automation ⚡\n\nHey {{subscriber_name}},\n\nClaim an exclusive discount with code {{coupon_code}}:\n{{affiliate_link}}\n\nCheers,\n{{partner_name}}`,
        fileSize: 48000,
        status: AssetStatus.PUBLISHED,
        isPublicToAffiliates: true,
        isDownloadable: false,
        isCopyable: true,
        version: 1,
        tags: ['Email Template', 'Newsletter', 'Swipe Copy'],
        metadata: { folderPath: 'Email Copies' },
        checksum: this.checksumForText('email-copy-template'),
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(now - 30 * dayMs),
        updatedAt: new Date(now - 30 * dayMs),
      },
      {
        id: asset5Id,
        organizationId,
        programId,
        name: 'Enterprise Platform Architecture & Security Whitepaper',
        title: 'Enterprise Platform Architecture & Security Whitepaper',
        description: 'Detailed enterprise PDF whitepaper on security architecture, SOC-2 readiness, and multi-tenant isolation.',
        assetType: 'PDF' as any,
        sourceType: 'FILE' as any,
        fileName: 'partneriq-enterprise-security.pdf',
        originalFileName: 'partneriq-enterprise-security.pdf',
        fileExtension: 'pdf',
        mimeType: 'application/pdf',
        fileSize: 8540000,
        storageUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        previewUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        status: AssetStatus.PUBLISHED,
        isPublicToAffiliates: true,
        isDownloadable: true,
        isCopyable: true,
        version: 1,
        tags: ['Whitepaper', 'PDF', 'Security'],
        metadata: { folderPath: 'Product Kits' },
        checksum: this.checksumForText('security-whitepaper'),
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(now - 28 * dayMs),
        updatedAt: new Date(now - 28 * dayMs),
      },
      {
        id: asset6Id,
        organizationId,
        programId,
        name: 'PartnerIQ Platform 60s Video Teaser',
        title: 'PartnerIQ Platform 60s Video Teaser',
        description: 'High definition 1080p MP4 walkthrough showing dashboard capabilities and partner rewards.',
        assetType: 'VIDEO' as any,
        sourceType: 'FILE' as any,
        fileName: 'platform-teaser-1080p.mp4',
        originalFileName: 'platform-teaser-1080p.mp4',
        fileExtension: 'mp4',
        mimeType: 'video/mp4',
        fileSize: 45200000,
        storageUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        status: AssetStatus.PUBLISHED,
        isPublicToAffiliates: true,
        isDownloadable: true,
        isCopyable: false,
        version: 1,
        tags: ['Video', 'Demo', 'Teaser'],
        metadata: { folderPath: 'Ad Creatives' },
        checksum: this.checksumForText('video-teaser'),
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(now - 20 * dayMs),
        updatedAt: new Date(now - 20 * dayMs),
      },
      {
        id: asset7Id,
        organizationId,
        programId,
        name: 'Affiliate Social Promo Copy & Swipe Kit',
        title: 'Affiliate Social Promo Copy & Swipe Kit',
        description: 'Draft collection of short-form LinkedIn posts and Twitter threads ready for review.',
        assetType: AssetType.SOCIAL_COPY,
        sourceType: AssetSourceType.TEXT,
        textContent: '🚀 Scaling partner revenue should not take 20 spreadsheets. Here is how we automated tracking, coupons, and payouts.',
        fileSize: 12000,
        status: AssetStatus.DRAFT,
        isPublicToAffiliates: false,
        isDownloadable: false,
        isCopyable: true,
        version: 1,
        tags: ['Swipe Copy', 'Social'],
        metadata: { folderPath: 'Email Copies' },
        checksum: this.checksumForText('swipe-kit'),
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: new Date(now - 5 * dayMs),
        updatedAt: new Date(now - 5 * dayMs),
      },
    ];

    dbStore.assets.push(...defaultAssets);

    defaultAssets.forEach((asset) => {
      dbStore.assetVersions.push(this.createVersionRecord(asset, actorId, 'Initial upload'));
    });

    const bundleId = uuidv4();
    const bundle: AssetBundleEntity = {
      id: bundleId,
      organizationId,
      programId,
      name: 'Q3 High-Converting Partner Launch Kit',
      title: 'Q3 High-Converting Partner Launch Kit',
      description: 'Curated collection of our top-performing banners, official logos, and security whitepaper.',
      bundleType: 'MEDIA_KIT' as any,
      visibility: AssetBundleVisibility.ALL_AFFILIATES,
      status: AssetBundleStatus.PUBLISHED,
      downloadCount: 42,
      viewCount: 180,
      createdAt: new Date(now - 25 * dayMs),
      updatedAt: new Date(now - 10 * dayMs),
    };
    dbStore.assetBundles.push(bundle);

    const bundledAssetIds = [asset1Id, asset2Id, asset3Id, asset5Id];
    bundledAssetIds.forEach((assetId, index) => {
      dbStore.assetBundleItems.push({
        id: uuidv4(),
        assetBundleId: bundleId,
        assetId,
        displayOrder: index + 1,
        isRequired: false,
        createdAt: new Date(now - 25 * dayMs),
      });
    });

    const activitiesToSeed = [
      { assetId: asset1Id, type: AffiliateAssetActivityType.VIEW, count: 68 },
      { assetId: asset1Id, type: AffiliateAssetActivityType.DOWNLOAD, count: 24 },
      { assetId: asset2Id, type: AffiliateAssetActivityType.VIEW, count: 52 },
      { assetId: asset2Id, type: AffiliateAssetActivityType.DOWNLOAD, count: 35 },
      { assetId: asset3Id, type: AffiliateAssetActivityType.VIEW, count: 38 },
      { assetId: asset3Id, type: AffiliateAssetActivityType.DOWNLOAD, count: 18 },
      { assetId: asset4Id, type: AffiliateAssetActivityType.COPY, count: 46 },
      { assetId: asset4Id, type: AffiliateAssetActivityType.VIEW, count: 82 },
      { assetId: asset5Id, type: AffiliateAssetActivityType.DOWNLOAD, count: 29 },
      { assetId: asset5Id, type: AffiliateAssetActivityType.VIEW, count: 74 },
      { assetId: asset6Id, type: AffiliateAssetActivityType.VIEW, count: 110 },
      { assetId: asset6Id, type: AffiliateAssetActivityType.DOWNLOAD, count: 14 },
    ];

    activitiesToSeed.forEach(({ assetId, type, count }) => {
      for (let i = 0; i < count; i++) {
        const daysAgo = Math.floor(Math.random() * 28);
        dbStore.affiliateAssetActivities.push({
          id: uuidv4(),
          organizationId,
          affiliateId,
          assetId,
          bundleId: bundledAssetIds.includes(assetId) ? bundleId : undefined,
          activityType: type,
          createdAt: new Date(now - daysAgo * dayMs),
        });
      }
    });
  }

  private audit(organizationId: string, actorId: string, action: AuditAction, resourceType: string, resourceId: string, metadata?: Record<string, unknown>) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action,
      resourceType,
      resourceId,
      metadata,
      createdAt: new Date(),
    });
  }
}

class LocalSignedStorageProvider implements AssetStorageProvider {
  async createUploadUrl(input: { organizationId: string; fileName: string; mimeType: string }) {
    const sanitized = input.fileName.replace(/[\\/]/g, '').replace(/[^a-zA-Z0-9._ -]/g, '_');
    const storageKey = `${input.organizationId}/assets/${Date.now()}-${sanitized}`;
    return {
      uploadUrl: `/api/v1/storage/local-upload/${encodeURIComponent(storageKey)}`,
      storageProvider: 'local-signed',
      storageKey,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      headers: {
        'Content-Type': input.mimeType,
        'x-partneriq-storage-key': storageKey,
      },
    };
  }

  async createDownloadUrl(asset: AssetEntity) {
    return {
      downloadUrl: asset.storageUrl || asset.externalUrl || `/api/v1/storage/local-download/${encodeURIComponent(asset.storageKey || asset.id)}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      contentDisposition: `attachment; filename="${asset.fileName || asset.name}"`,
    };
  }
}
