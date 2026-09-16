import { HttpException, HttpStatus } from '@nestjs/common';
import { BillingResourceType } from '../enums/billing.enums';

export const RESOURCE_LIMIT_REACHED = 'RESOURCE_LIMIT_REACHED';

export interface ResourceLimitDetails {
  resource: BillingResourceType;
  currentUsage: number;
  /** `null` when the plan includes unlimited capacity for this resource. */
  includedLimit: number | null;
  additionalPurchased: number;
  effectiveLimit: number | null;
  /** `null` when unlimited. */
  remaining: number | null;
  /** True when the plan sells add-on capacity for this resource. */
  canPurchaseAddon: boolean;
  /** True when a larger plan exists to upgrade to. */
  canUpgradePlan: boolean;
  planCode: string;
  planName: string;
  accountId: string;
  /** Add-on catalog entry the frontend should open for this resource, if any. */
  addon?: {
    id: string;
    code: string;
    name: string;
    unitPrice: number;
    currency: string;
    billingInterval: string;
  } | null;
}

const RESOURCE_COPY: Record<BillingResourceType, { singular: string; plural: string }> = {
  [BillingResourceType.ORGANIZATION]: { singular: 'organization', plural: 'organizations' },
  [BillingResourceType.PROGRAM]: { singular: 'program', plural: 'programs' },
  [BillingResourceType.AFFILIATE]: { singular: 'affiliate', plural: 'affiliates' },
  [BillingResourceType.MEMBER]: { singular: 'member', plural: 'members' },
};

export function resourceLimitMessage(details: ResourceLimitDetails): string {
  const copy = RESOURCE_COPY[details.resource];
  const remedy = details.canPurchaseAddon && details.canUpgradePlan
    ? `Purchase additional ${copy.singular} capacity or upgrade your plan.`
    : details.canPurchaseAddon
      ? `Purchase additional ${copy.singular} capacity to continue.`
      : details.canUpgradePlan
        ? 'Upgrade your plan to continue.'
        : 'Contact PartnerIQ support to raise this limit.';
  return `You have reached your ${copy.singular} limit (${details.currentUsage}/${details.effectiveLimit}). ${remedy}`;
}

/**
 * Thrown whenever a create/invite would push account-wide usage past the
 * effective subscription limit.
 *
 * Deliberately a 402 Payment Required rather than 403: the caller is
 * authorized, the account simply has no capacity left, and the remedy is a
 * purchase. The frontend keys off `code === 'RESOURCE_LIMIT_REACHED'` and
 * renders the add-on/upgrade dialog straight from `details`.
 */
export class ResourceLimitReachedException extends HttpException {
  constructor(public readonly details: ResourceLimitDetails, message?: string) {
    super(
      {
        success: false,
        code: RESOURCE_LIMIT_REACHED,
        message: message || resourceLimitMessage(details),
        details,
        // Mirrored at the top level so older clients that only read the flat
        // body keep working.
        resource: details.resource,
        currentUsage: details.currentUsage,
        includedLimit: details.includedLimit,
        additionalPurchased: details.additionalPurchased,
        effectiveLimit: details.effectiveLimit,
        remaining: details.remaining,
        canPurchaseAddon: details.canPurchaseAddon,
        canUpgradePlan: details.canUpgradePlan,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
