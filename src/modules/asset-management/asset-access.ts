/**
 * Who may see a bundle and who may download a file — pure functions, used by every portal endpoint (list, detail,
 * download link, ZIP) so the rules cannot drift apart. Decisions A8–A11 in docs/decisions.md.
 */
import { AssetBundleStatus, AssetBundleVisibility, AssetStatus } from '../../common/enums';

export interface TierInfo {
  id: string;
  programId?: string | null;
  name: string;
  level: number;
  isActive: boolean;
  /** rewardsConfig.assetBundleIds of the tier */
  rewardBundleIds: string[];
}

export interface AffiliateAccessContext {
  organizationId: string;
  affiliateId: string;
  /** affiliate row ACTIVE and not deleted */
  active: boolean;
  /** programs the affiliate is ACTIVE in */
  programIds: string[];
  /** current tier per program (affiliate_tiers) */
  tierByProgram: Map<string, TierInfo>;
  /** all tiers of the organization by id */
  tiers: Map<string, TierInfo>;
}

export interface BundleLike {
  id: string;
  organizationId: string;
  programId?: string | null;
  status: AssetBundleStatus | string;
  visibility: AssetBundleVisibility | string;
  partnerTierId?: string | null;
  affiliateIds?: string[] | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  deletedAt?: Date | string | null;
}

export type BundleAccess =
  | { visible: false; reason: string }
  | { visible: true; locked: false }
  | { visible: true; locked: true; reason: string; requiredTier?: { id: string; name: string; level: number } };

const RESTRICTED = new Set<string>([
  AssetBundleVisibility.PARTNER_TIER,
  AssetBundleVisibility.SPECIFIC_AFFILIATES,
  AssetBundleVisibility.AFFILIATE_SEGMENT,
  AssetBundleVisibility.PRIVATE,
]);

export function isRestrictedBundle(bundle: BundleLike): boolean {
  return !bundle.deletedAt && bundle.status !== AssetBundleStatus.ARCHIVED && RESTRICTED.has(bundle.visibility);
}

/** Does the affiliate's tier (in the required tier's own program) meet the bundle's tier requirement? */
function tierUnlocks(bundle: BundleLike, ctx: AffiliateAccessContext): { ok: boolean; required?: TierInfo } {
  const required = bundle.partnerTierId ? ctx.tiers.get(bundle.partnerTierId) : undefined;
  const ladderProgram = required?.programId ?? bundle.programId ?? undefined;
  const mine = ladderProgram ? ctx.tierByProgram.get(ladderProgram) : undefined;
  // tiers of other programs (e.g. a click-based ladder) never count: comparison only within the same program
  if (mine && required && mine.isActive && required.isActive && mine.programId === required.programId && mine.level >= required.level) {
    return { ok: true, required };
  }
  // tier rewards: rewardsConfig.assetBundleIds of the affiliate's tier or any lower tier of the same ladder
  if (mine && mine.isActive && ladderProgram) {
    for (const tier of ctx.tiers.values()) {
      if (tier.isActive && tier.programId === ladderProgram && tier.level <= mine.level && tier.rewardBundleIds.includes(bundle.id)) return { ok: true, required };
    }
  }
  return { ok: false, required };
}

export function bundleAccess(bundle: BundleLike, ctx: AffiliateAccessContext, now = new Date()): BundleAccess {
  if (bundle.organizationId !== ctx.organizationId) return { visible: false, reason: 'other organization' };
  if (!ctx.active) return { visible: false, reason: 'affiliate not active' };
  if (bundle.deletedAt) return { visible: false, reason: 'deleted' };
  if (![AssetBundleStatus.PUBLISHED, AssetBundleStatus.SCHEDULED].includes(bundle.status as AssetBundleStatus)) return { visible: false, reason: 'not published' };
  if (bundle.startDate && new Date(bundle.startDate) > now) return { visible: false, reason: 'not started' };
  if (bundle.endDate && new Date(bundle.endDate) < now) return { visible: false, reason: 'ended' };
  if (bundle.programId && !ctx.programIds.includes(bundle.programId)) return { visible: false, reason: 'not in program' };
  switch (bundle.visibility) {
    case AssetBundleVisibility.ALL_PROGRAM_AFFILIATES:
      return { visible: true, locked: false };
    case AssetBundleVisibility.SPECIFIC_AFFILIATES:
      return (bundle.affiliateIds || []).includes(ctx.affiliateId) ? { visible: true, locked: false } : { visible: false, reason: 'not selected' };
    case AssetBundleVisibility.PARTNER_TIER: {
      const t = tierUnlocks(bundle, ctx);
      if (t.ok) return { visible: true, locked: false };
      return {
        visible: true,
        locked: true,
        reason: t.required ? `Unlocks at ${t.required.name}` : 'Unlocks at a higher partner tier',
        requiredTier: t.required ? { id: t.required.id, name: t.required.name, level: t.required.level } : undefined,
      };
    }
    // segments are not implemented (no segment membership exists): never shown (decision A10)
    case AssetBundleVisibility.AFFILIATE_SEGMENT:
    case AssetBundleVisibility.PRIVATE:
    default:
      return { visible: false, reason: 'private' };
  }
}

export interface AssetLike {
  id: string;
  organizationId: string;
  programId?: string | null;
  status: AssetStatus | string;
  isPublicToAffiliates: boolean;
  isDownloadable: boolean;
  deletedAt?: Date | string | null;
}

/**
 * May this affiliate see/download the file?
 * Basic gates: same organization, active affiliate, published, not in the trash, program membership.
 * Then: access through any bundle the affiliate can open (unlocked) → allowed. Otherwise, if the file belongs to any
 * restricted bundle (tier / specific affiliates / segment / private) → denied ("most restrictive wins", decision A9),
 * even when the file itself is marked public. Otherwise the file's own "public to affiliates" flag decides.
 */
export function assetAccess(
  asset: AssetLike,
  ctx: AffiliateAccessContext,
  bundlesContainingAsset: BundleLike[],
  opts: { forDownload: boolean },
  now = new Date(),
): { allowed: boolean; reason?: string } {
  if (asset.organizationId !== ctx.organizationId) return { allowed: false, reason: 'other organization' };
  if (!ctx.active) return { allowed: false, reason: 'affiliate not active' };
  if (asset.deletedAt) return { allowed: false, reason: 'in trash' };
  if (asset.status !== AssetStatus.PUBLISHED) return { allowed: false, reason: 'not published' };
  if (opts.forDownload && !asset.isDownloadable) return { allowed: false, reason: 'download disabled' };
  if (asset.programId && !ctx.programIds.includes(asset.programId)) return { allowed: false, reason: 'not in program' };
  const viaBundle = bundlesContainingAsset.some((b) => {
    const a = bundleAccess(b, ctx, now);
    return a.visible && !a.locked;
  });
  if (viaBundle) return { allowed: true };
  if (bundlesContainingAsset.some(isRestrictedBundle)) return { allowed: false, reason: 'restricted bundle' };
  return asset.isPublicToAffiliates ? { allowed: true } : { allowed: false, reason: 'not shared with affiliates' };
}
