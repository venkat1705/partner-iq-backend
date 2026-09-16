import { BillingInterval, BillingResourceType } from '../enums/billing.enums';

/**
 * PartnerIQ plan & add-on catalog.
 *
 * These are *seed defaults only*. They are written into `billing_plans`,
 * `billing_plan_limits` and `billing_addons` on boot, and everything downstream
 * — pricing page, checkout, limit enforcement — reads the database rows, never
 * this file. Platform admins can change any price or allowance at runtime
 * through the admin billing endpoints and their edits survive restarts: once a
 * plan row exists, `PlanService.ensureDefaultPlans` only refreshes it when
 * `PLAN_CATALOG_SEED_VERSION` has changed.
 *
 * All money is stored in the currency's MINOR unit (paise for INR) as an
 * integer. No floating point ever touches a monetary value.
 */

/** Bump this to force a one-time re-seed of prices/limits over admin edits. */
export const PLAN_CATALOG_SEED_VERSION = 'partneriq-plans-v2';

export const PLAN_CATALOG_CURRENCY = 'INR';

/** 1 rupee = 100 paise. */
const RUPEE = 100;

export interface PlanLimitSeed {
  resourceType: BillingResourceType;
  /** `null` means unlimited. Never `Infinity` — that has no SQL representation. */
  includedLimit: number | null;
  /** Whether extra capacity for this resource may be bought as an add-on. */
  addonPurchasable: boolean;
}

export interface PlanSeed {
  code: string;
  name: string;
  description: string;
  /** Price per month, in paise, when billed monthly. */
  monthlyPrice: number;
  /** Total price charged once per year, in paise, when billed yearly. */
  yearlyPrice: number;
  trialDays: number;
  isPublic: boolean;
  sortOrder: number;
  /** Shown on the pricing page beneath the plan name. */
  targetAudience: string;
  highlight?: boolean;
  limits: PlanLimitSeed[];
  features: Array<[featureKey: string, enabled: boolean, limitValue?: number]>;
}

const UNLIMITED_LIMITS: PlanLimitSeed[] = [
  { resourceType: BillingResourceType.ORGANIZATION, includedLimit: null, addonPurchasable: false },
  { resourceType: BillingResourceType.PROGRAM, includedLimit: null, addonPurchasable: false },
  { resourceType: BillingResourceType.AFFILIATE, includedLimit: null, addonPurchasable: false },
  { resourceType: BillingResourceType.MEMBER, includedLimit: null, addonPurchasable: false },
];

export const PLAN_CATALOG: PlanSeed[] = [
  {
    code: 'FREE',
    name: 'Free',
    description: 'Explore PartnerIQ with a single program and basic reporting.',
    monthlyPrice: 0,
    yearlyPrice: 0,
    trialDays: 0,
    isPublic: false,
    sortOrder: 0,
    targetAudience: 'Evaluating PartnerIQ.',
    limits: [
      { resourceType: BillingResourceType.ORGANIZATION, includedLimit: 1, addonPurchasable: false },
      { resourceType: BillingResourceType.PROGRAM, includedLimit: 1, addonPurchasable: false },
      { resourceType: BillingResourceType.AFFILIATE, includedLimit: 10, addonPurchasable: false },
      { resourceType: BillingResourceType.MEMBER, includedLimit: 2, addonPurchasable: false },
    ],
    features: [
      ['advanced_rbac.enabled', false],
      ['audit_logs.enabled', false],
      ['fraud_detection.enabled', false],
    ],
  },
  {
    code: 'STARTER',
    name: 'Starter',
    description: 'Everything a small business needs to launch its first partner program.',
    monthlyPrice: 5_000 * RUPEE,
    yearlyPrice: 50_000 * RUPEE,
    trialDays: 14,
    isPublic: true,
    sortOrder: 1,
    targetAudience: 'Small businesses and startups.',
    limits: [
      { resourceType: BillingResourceType.ORGANIZATION, includedLimit: 1, addonPurchasable: true },
      { resourceType: BillingResourceType.PROGRAM, includedLimit: 3, addonPurchasable: true },
      { resourceType: BillingResourceType.AFFILIATE, includedLimit: 50, addonPurchasable: true },
      { resourceType: BillingResourceType.MEMBER, includedLimit: 5, addonPurchasable: true },
    ],
    features: [
      ['advanced_rbac.enabled', false],
      ['audit_logs.enabled', true],
      ['fraud_detection.enabled', false],
    ],
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    description: 'Run several brands and partner programs from a single account.',
    monthlyPrice: 10_000 * RUPEE,
    yearlyPrice: 100_000 * RUPEE,
    trialDays: 14,
    isPublic: true,
    sortOrder: 2,
    targetAudience: 'Growing businesses, agencies, and multi-program teams.',
    highlight: true,
    limits: [
      { resourceType: BillingResourceType.ORGANIZATION, includedLimit: 5, addonPurchasable: true },
      { resourceType: BillingResourceType.PROGRAM, includedLimit: 10, addonPurchasable: true },
      { resourceType: BillingResourceType.AFFILIATE, includedLimit: 200, addonPurchasable: true },
      { resourceType: BillingResourceType.MEMBER, includedLimit: 15, addonPurchasable: true },
    ],
    features: [
      ['advanced_rbac.enabled', true],
      ['audit_logs.enabled', true],
      ['fraud_detection.enabled', true],
    ],
  },
  {
    code: 'PRO',
    name: 'Pro',
    description: 'Unlimited organizations, programs, affiliates and members.',
    monthlyPrice: 17_000 * RUPEE,
    yearlyPrice: 170_000 * RUPEE,
    trialDays: 14,
    isPublic: true,
    sortOrder: 3,
    targetAudience: 'Enterprises and agencies scaling partner revenue.',
    limits: UNLIMITED_LIMITS,
    features: [
      ['advanced_rbac.enabled', true],
      ['audit_logs.enabled', true],
      ['fraud_detection.enabled', true],
    ],
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Custom scale, controls, and billing terms.',
    monthlyPrice: 0,
    yearlyPrice: 0,
    trialDays: 0,
    isPublic: false,
    sortOrder: 4,
    targetAudience: 'Custom contracts.',
    limits: UNLIMITED_LIMITS,
    features: [
      ['advanced_rbac.enabled', true],
      ['audit_logs.enabled', true],
      ['fraud_detection.enabled', true],
    ],
  },
];

/**
 * Plans that predate this catalog. Kept only so historical subscriptions and
 * invoices still resolve; hidden from the pricing page.
 */
export const RETIRED_PLAN_CODES = ['BUSINESS'];

/**
 * Upgrade/downgrade ordering — a higher rank is a strictly larger plan.
 * BUSINESS is retired but still ranks so existing subscribers can move off it.
 */
export const PLAN_RANK: Record<string, number> = {
  FREE: 0,
  STARTER: 1,
  GROWTH: 2,
  BUSINESS: 2,
  PRO: 3,
  ENTERPRISE: 4,
};

export interface AddonSeed {
  code: string;
  name: string;
  description: string;
  resourceType: BillingResourceType;
  /** Price per unit per month, in paise. */
  monthlyUnitPrice: number;
  unitsPerQuantity: number;
  minQuantity: number;
  maxQuantity: number | null;
  sortOrder: number;
}

export const ADDON_CATALOG: AddonSeed[] = [
  {
    code: 'ADDON_ORGANIZATION',
    name: 'Additional Organization',
    description: 'Add one more organization (brand or tenant) to your account.',
    resourceType: BillingResourceType.ORGANIZATION,
    monthlyUnitPrice: 2_000 * RUPEE,
    unitsPerQuantity: 1,
    minQuantity: 1,
    maxQuantity: 100,
    sortOrder: 1,
  },
  {
    code: 'ADDON_PROGRAM',
    name: 'Additional Program',
    description: 'Add one more partner or referral program to your account.',
    resourceType: BillingResourceType.PROGRAM,
    monthlyUnitPrice: 500 * RUPEE,
    unitsPerQuantity: 1,
    minQuantity: 1,
    maxQuantity: 500,
    sortOrder: 2,
  },
  {
    code: 'ADDON_AFFILIATE',
    name: 'Additional Affiliate',
    description: 'Add capacity for one more active affiliate across your account.',
    resourceType: BillingResourceType.AFFILIATE,
    monthlyUnitPrice: 50 * RUPEE,
    unitsPerQuantity: 1,
    minQuantity: 1,
    maxQuantity: 10_000,
    sortOrder: 3,
  },
  {
    code: 'ADDON_MEMBER',
    name: 'Additional Member',
    description: 'Add one more internal team seat across your account.',
    resourceType: BillingResourceType.MEMBER,
    monthlyUnitPrice: 200 * RUPEE,
    unitsPerQuantity: 1,
    minQuantity: 1,
    maxQuantity: 1_000,
    sortOrder: 4,
  },
];

/**
 * A yearly add-on bills at 10x the monthly unit price, mirroring the "two
 * months free" discount already built into the yearly plan prices above
 * (₹5,000 x 12 = ₹60,000 monthly vs ₹50,000 yearly).
 */
export const YEARLY_PRICE_MULTIPLIER = 10;

export function addonUnitPriceFor(seed: AddonSeed, interval: BillingInterval): number {
  return interval === BillingInterval.YEARLY
    ? seed.monthlyUnitPrice * YEARLY_PRICE_MULTIPLIER
    : seed.monthlyUnitPrice;
}

export function planPriceFor(seed: PlanSeed, interval: BillingInterval): number {
  return interval === BillingInterval.YEARLY ? seed.yearlyPrice : seed.monthlyPrice;
}

export const ALL_RESOURCE_TYPES: BillingResourceType[] = [
  BillingResourceType.ORGANIZATION,
  BillingResourceType.PROGRAM,
  BillingResourceType.AFFILIATE,
  BillingResourceType.MEMBER,
];
