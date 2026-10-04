import { beforeEach, describe, expect, it } from '@jest/globals';
import { AssetManagementService } from '../../src/modules/asset-management/asset-management.service';
import { dbStore } from '../../src/database/store';
import { AssetBundleStatus, AssetBundleVisibility, AssetSourceType, AssetStatus, AssetType } from '../../src/common/enums';

/**
 * AB / AA — who can see a bundle. Written before the fix: on the original code a PARTNER_TIER bundle is visible
 * (with all its files) to every affiliate of the program, whatever their tier, and AFFILIATE_SEGMENT bundles too.
 */
const ORG = '0a0a0a0a-0000-4000-8000-000000000001';
const PROG = '0a0a0a0a-0000-4000-8000-000000000002';
const OTHER_PROG = '0a0a0a0a-0000-4000-8000-000000000003';
const BRONZE = '0a0a0a0a-0000-4000-8000-0000000000b1';
const GOLD = '0a0a0a0a-0000-4000-8000-0000000000b3';
const CLICK9 = '0a0a0a0a-0000-4000-8000-0000000000c9';
const AFF_BRONZE = '0a0a0a0a-0000-4000-8000-0000000000a1';
const AFF_GOLD = '0a0a0a0a-0000-4000-8000-0000000000a2';
const AFF_CLICKS = '0a0a0a0a-0000-4000-8000-0000000000a3';
const ASSET = '0a0a0a0a-0000-4000-8000-0000000000f1';

function storageStub(): any {
  return { settings: { maxFileBytes: 1, allowedFileTypes: [], allowedExtensions: [], downloadUrlTtlSeconds: 300, defaultOrganizationLimitBytes: 1, maxConcurrentUploadsPerOrganization: 5, reservationTtlMinutes: 60, trashRetentionDays: 30, maxImageBytes: 1, uploadTimeoutMs: 1 } };
}

function seed() {
  const now = new Date();
  const tier = (id: string, level: number, programId: string) => ({ id, organizationId: ORG, programId, name: id, code: id, level, displayOrder: level, icon: '', colorToken: '', evaluationPeriod: 'MONTHLY', downgradeMode: 'IMMEDIATE', gracePeriodDays: 0, commissionRateEffectiveStrategy: 'TIER', isDefault: false, isActive: true, isVisibleToAffiliate: true, createdAt: now, updatedAt: now });
  (dbStore as any).partnerTiers.push(tier(BRONZE, 1, PROG), tier(GOLD, 3, PROG), tier(CLICK9, 9, OTHER_PROG));
  const membership = (affiliateId: string, programId: string) => ({ id: `${affiliateId}-${programId}`, organizationId: ORG, programId, affiliateId, status: 'ACTIVE', referralCode: affiliateId.slice(-4), joinedAt: now, createdAt: now, updatedAt: now });
  (dbStore as any).programAffiliates.push(membership(AFF_BRONZE, PROG), membership(AFF_GOLD, PROG), membership(AFF_CLICKS, PROG), membership(AFF_CLICKS, OTHER_PROG));
  const at = (affiliateId: string, programId: string, currentTierId: string) => ({ id: `${affiliateId}-t-${programId}`, organizationId: ORG, programId, affiliateId, currentTierId, effectiveFrom: now, isLocked: false, createdAt: now, updatedAt: now });
  (dbStore as any).affiliateTiers.push(at(AFF_BRONZE, PROG, BRONZE), at(AFF_GOLD, PROG, GOLD), at(AFF_CLICKS, PROG, BRONZE), at(AFF_CLICKS, OTHER_PROG, CLICK9));
  for (const id of [AFF_BRONZE, AFF_GOLD, AFF_CLICKS]) (dbStore as any).affiliates.push({ id, organizationId: ORG, displayName: id, email: `${id}@x.test`, status: 'ACTIVE', createdAt: now, updatedAt: now });
  (dbStore as any).assets.push({ id: ASSET, organizationId: ORG, name: 'gold file', assetType: AssetType.IMAGE, sourceType: AssetSourceType.FILE, status: AssetStatus.PUBLISHED, isPublicToAffiliates: false, isDownloadable: true, isCopyable: true, version: 1, tags: [], metadata: {}, createdBy: 'x', createdAt: now, updatedAt: now });
  const bundle = (id: string, visibility: AssetBundleVisibility, extra: Record<string, unknown> = {}) => ({ id, organizationId: ORG, programId: PROG, name: id, slug: id, status: AssetBundleStatus.PUBLISHED, visibility, displayOrder: 1, featured: false, createdBy: 'x', createdAt: now, updatedAt: now, ...extra });
  (dbStore as any).assetBundles.push(
    bundle('gold-bundle', AssetBundleVisibility.PARTNER_TIER, { partnerTierId: GOLD }),
    bundle('segment-bundle', AssetBundleVisibility.AFFILIATE_SEGMENT, { affiliateSegmentId: 'seg-1' }),
  );
  (dbStore as any).assetBundleItems.push({ id: 'item-1', assetBundleId: 'gold-bundle', assetId: ASSET, displayOrder: 1, isFeatured: false, createdAt: now, createdBy: 'x' });
}

describe('asset bundle access (AA/AB)', () => {
  let service: AssetManagementService;
  beforeEach(() => {
    seed();
    service = new (AssetManagementService as any)(storageStub(), undefined);
  });

  const view = async (affiliateId: string) => {
    const rows = (await service.listAffiliateBundles(ORG, affiliateId)) as any[];
    return Object.fromEntries(rows.map((b) => [b.id, { locked: Boolean(b.locked), files: (b.items || []).length }]));
  };

  it('a Bronze affiliate sees the Gold bundle only as locked, without any files', async () => {
    const v = await view(AFF_BRONZE);
    expect(v['gold-bundle']).toEqual({ locked: true, files: 0 });
  });

  it('a Gold affiliate sees the Gold bundle unlocked with its file', async () => {
    const v = await view(AFF_GOLD);
    expect(v['gold-bundle']).toEqual({ locked: false, files: 1 });
  });

  it('a level-9 tier from another (click-based) program does not unlock the Gold bundle', async () => {
    const v = await view(AFF_CLICKS);
    expect(v['gold-bundle']).toEqual({ locked: true, files: 0 });
  });

  it('a segment bundle is not shown to affiliates (segments are not implemented)', async () => {
    const v = await view(AFF_GOLD);
    expect(v['segment-bundle']).toBeUndefined();
  });
});
