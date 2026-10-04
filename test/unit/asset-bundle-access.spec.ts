import { describe, expect, it } from '@jest/globals';
import { AffiliateAccessContext, BundleLike, TierInfo, assetAccess, bundleAccess } from '../../src/modules/asset-management/asset-access';
import { AssetBundleStatus, AssetBundleVisibility, AssetStatus } from '../../src/common/enums';

/**
 * AB / AA — who can see a bundle. First written against the original service (see
 * docs/assets-proof/baseline/AB-unit-before-fix.txt: a Bronze affiliate and a level-9 affiliate of another program both
 * got the Gold bundle with its file, and the segment bundle was visible). The access rules now live in the pure
 * functions used by every portal endpoint; the four original cases keep their exact expectations, plus download cases.
 */
const ORG = '0a0a0a0a-0000-4000-8000-000000000001';
const PROG = '0a0a0a0a-0000-4000-8000-000000000002';
const OTHER_PROG = '0a0a0a0a-0000-4000-8000-000000000003';
const tier = (id: string, level: number, programId: string, rewardBundleIds: string[] = []): TierInfo => ({ id, programId, name: id, level, isActive: true, rewardBundleIds });
const BRONZE = tier('bronze', 1, PROG);
const GOLD = tier('gold', 3, PROG);
const CLICK9 = tier('clicks-9', 9, OTHER_PROG);
const tiers = new Map([BRONZE, GOLD, CLICK9].map((t) => [t.id, t]));

const ctx = (affiliateId: string, programIds: string[], tierByProgram: Array<[string, TierInfo]>, active = true): AffiliateAccessContext => ({
  organizationId: ORG, affiliateId, active, programIds, tierByProgram: new Map(tierByProgram), tiers,
});
const AFF_BRONZE = ctx('aff-bronze', [PROG], [[PROG, BRONZE]]);
const AFF_GOLD = ctx('aff-gold', [PROG], [[PROG, GOLD]]);
const AFF_CLICKS = ctx('aff-clicks', [PROG, OTHER_PROG], [[PROG, BRONZE], [OTHER_PROG, CLICK9]]);

const bundle = (id: string, visibility: AssetBundleVisibility, extra: Partial<BundleLike> = {}): BundleLike => ({
  id, organizationId: ORG, programId: PROG, status: AssetBundleStatus.PUBLISHED, visibility, ...extra,
});
const goldBundle = bundle('gold-bundle', AssetBundleVisibility.PARTNER_TIER, { partnerTierId: 'gold' });
const segmentBundle = bundle('segment-bundle', AssetBundleVisibility.AFFILIATE_SEGMENT);
const goldFile = { id: 'gold-file', organizationId: ORG, status: AssetStatus.PUBLISHED, isPublicToAffiliates: false, isDownloadable: true };
const ITEMS: Record<string, number> = { 'gold-bundle': 1, 'segment-bundle': 0 };

/** same shape as the original test: { locked, files } per visible bundle (files = 0 when locked) */
const view = (c: AffiliateAccessContext) => {
  const out: Record<string, { locked: boolean; files: number }> = {};
  for (const b of [goldBundle, segmentBundle]) {
    const a = bundleAccess(b, c);
    if (!a.visible) continue;
    out[b.id] = { locked: a.locked, files: a.locked ? 0 : ITEMS[b.id] };
  }
  return out;
};

describe('asset bundle access (AA/AB)', () => {
  it('a Bronze affiliate sees the Gold bundle only as locked, without any files', () => {
    expect(view(AFF_BRONZE)['gold-bundle']).toEqual({ locked: true, files: 0 });
  });

  it('a Gold affiliate sees the Gold bundle unlocked with its file', () => {
    expect(view(AFF_GOLD)['gold-bundle']).toEqual({ locked: false, files: 1 });
  });

  it('a level-9 tier from another (click-based) program does not unlock the Gold bundle', () => {
    expect(view(AFF_CLICKS)['gold-bundle']).toEqual({ locked: true, files: 0 });
  });

  it('a segment bundle is not shown to affiliates (segments are not implemented)', () => {
    expect(view(AFF_GOLD)['segment-bundle']).toBeUndefined();
  });

  it('the Gold bundle file cannot be downloaded below Gold, can at Gold, and not after demotion', () => {
    expect(assetAccess(goldFile, AFF_BRONZE, [goldBundle], { forDownload: true })).toEqual({ allowed: false, reason: 'restricted bundle' });
    expect(assetAccess(goldFile, AFF_GOLD, [goldBundle], { forDownload: true })).toEqual({ allowed: true });
    const demoted = ctx('aff-gold', [PROG], [[PROG, BRONZE]]);
    expect(assetAccess(goldFile, demoted, [goldBundle], { forDownload: true }).allowed).toBe(false);
  });

  it('a file that is public but also in a locked bundle stays locked (most restrictive wins)', () => {
    expect(assetAccess({ ...goldFile, isPublicToAffiliates: true }, AFF_BRONZE, [goldBundle], { forDownload: true }).allowed).toBe(false);
  });

  it('tier rewards (rewardsConfig.assetBundleIds) unlock only within the same ladder', () => {
    const rewardTiers = new Map(tiers);
    rewardTiers.set('bronze', { ...BRONZE, rewardBundleIds: ['gold-bundle'] });
    const withReward = { ...AFF_BRONZE, tiers: rewardTiers };
    expect(bundleAccess(goldBundle, withReward)).toEqual({ visible: true, locked: false });
    const otherLadder = new Map(tiers);
    otherLadder.set('clicks-9', { ...CLICK9, rewardBundleIds: ['gold-bundle'] });
    expect(bundleAccess(goldBundle, { ...AFF_CLICKS, tiers: otherLadder }).visible && (bundleAccess(goldBundle, { ...AFF_CLICKS, tiers: otherLadder }) as any).locked).toBe(true);
  });

  it('a removed (inactive) affiliate sees nothing', () => {
    const removed = ctx('aff-gold', [PROG], [[PROG, GOLD]], false);
    expect(bundleAccess(goldBundle, removed).visible).toBe(false);
    expect(assetAccess({ ...goldFile, isPublicToAffiliates: true }, removed, [], { forDownload: true }).allowed).toBe(false);
  });
});
