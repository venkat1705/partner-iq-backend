import { AffiliatePayoutMethod, AffiliatePortalProfile, User } from '../../database/schema';

/**
 * The single definition of what a complete affiliate profile is.
 *
 * It has to live on the server because the profile serializer fills several
 * fields with defaults on the way out — an unset country is served as "India",
 * an unset classification as "INDIVIDUAL" — so a client inspecting the
 * serialized profile cannot tell a supplied value from a default one. This
 * reads the persisted row directly, which is the only place that distinction
 * survives, and is therefore also the only trustworthy source for gating
 * access to restricted features.
 */

/** Which settings tab supplies the field, so the UI can deep-link to it. */
export type CompletenessTab = 'profile' | 'payouts' | 'tax';

export interface CompletenessRequirement {
  key: string;
  label: string;
  tab: CompletenessTab;
  complete: boolean;
  /** Why the platform needs it, shown in the gate dialog. */
  reason: string;
}

export interface ProfileCompleteness {
  percentage: number;
  isComplete: boolean;
  requirements: CompletenessRequirement[];
  missing: CompletenessRequirement[];
}

const filled = (value: unknown): boolean =>
  value !== null && value !== undefined && String(value).trim() !== '';

/** The minimum bio length that makes a partner listing useful to an organization. */
const MIN_BIO_LENGTH = 30;

export function evaluateProfileCompleteness(
  user: Pick<User, 'firstName' | 'lastName' | 'email' | 'avatarUrl'>,
  profile: Partial<AffiliatePortalProfile> | null | undefined,
  payoutMethods: Pick<AffiliatePayoutMethod, 'id'>[] = [],
): ProfileCompleteness {
  const row = profile || ({} as Partial<AffiliatePortalProfile>);
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();

  const requirements: CompletenessRequirement[] = [
    {
      key: 'fullName',
      label: 'Full name',
      tab: 'profile',
      complete: filled(fullName),
      reason: 'Used on your partner agreement and payout remittance advice.',
    },
    {
      key: 'email',
      label: 'Email address',
      tab: 'profile',
      complete: filled(user?.email),
      reason: 'Where commission, payout and account notices are sent.',
    },
    {
      key: 'avatar',
      label: 'Profile photo',
      tab: 'profile',
      complete: filled(user?.avatarUrl),
      reason: 'Shown to organizations reviewing your partner application.',
    },
    {
      key: 'phone',
      label: 'Contact phone number',
      tab: 'profile',
      complete: filled(row.phone),
      reason: 'Required for payout verification and account recovery.',
    },
    {
      key: 'country',
      label: 'Country of residence',
      tab: 'profile',
      complete: filled(row.country),
      reason: 'Determines which tax and payout rules apply to you.',
    },
    {
      key: 'partnerType',
      label: 'Partner type',
      tab: 'profile',
      complete: filled(row.partnerType),
      reason: 'Determines which programs and commission terms you qualify for.',
    },
    {
      key: 'primaryMarket',
      label: 'Primary market',
      tab: 'profile',
      complete: filled(row.primaryMarket),
      reason: 'Used to match you with programs targeting your audience.',
    },
    {
      key: 'audienceSize',
      label: 'Audience size',
      tab: 'profile',
      complete: filled(row.audienceSize),
      reason: 'Used by organizations when reviewing your application.',
    },
    {
      key: 'website',
      label: 'Website or primary channel',
      tab: 'profile',
      complete: filled(row.website),
      reason: 'The channel your referral traffic is expected to come from.',
    },
    {
      key: 'bio',
      label: `Partner bio (${MIN_BIO_LENGTH}+ characters)`,
      tab: 'profile',
      complete: filled(row.bio) && String(row.bio).trim().length >= MIN_BIO_LENGTH,
      reason: 'How you introduce yourself to organizations you apply to.',
    },
    {
      key: 'social',
      label: 'At least one social channel',
      tab: 'profile',
      complete: Object.values(row.socialProfiles || {}).some(filled),
      reason: 'Used to verify your audience and detect fraudulent applications.',
    },
    {
      key: 'payoutMethod',
      label: 'A payout destination',
      tab: 'payouts',
      complete: (payoutMethods || []).length > 0,
      reason: 'Commissions cannot be disbursed without somewhere to send them.',
    },
    {
      key: 'taxId',
      label: 'Tax identification (PAN / TIN)',
      tab: 'tax',
      complete: filled(row.panOrTaxId),
      reason: 'Required to withhold and report tax on your earnings.',
    },
    {
      key: 'taxClassification',
      label: 'Tax classification',
      tab: 'tax',
      complete: filled(row.taxClassification),
      reason: 'Determines the withholding rate applied to your payouts.',
    },
  ];

  const missing = requirements.filter((requirement) => !requirement.complete);
  const percentage = requirements.length
    ? Math.round(((requirements.length - missing.length) / requirements.length) * 100)
    : 100;

  return {
    percentage,
    isComplete: missing.length === 0,
    requirements,
    missing,
  };
}
