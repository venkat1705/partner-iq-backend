/**
 * Legal documents a user must accept to register, and the version currently in
 * force for each.
 *
 * The server is authoritative on versions: the browser tells us *that* the user
 * accepted, never *which version* they accepted. A client-supplied version could
 * be forged to make an old acceptance look current, which would defeat the point
 * of recording it at all.
 *
 * These versions must stay in step with `legalVersions` in
 * `partneriq-landing/src/lib/legal-config.ts`, which is what the published
 * documents display. Bump a version here when the corresponding document's
 * substantive terms change — existing acceptances keep their old version, which
 * is what makes stale consent detectable.
 */

export const LEGAL_DOCUMENT_TYPES = ['terms', 'privacy', 'anti-fraud'] as const;

export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

export const LEGAL_DOCUMENT_VERSIONS: Record<LegalDocumentType, string> = {
  terms: 'draft-1.0',
  privacy: 'draft-1.0',
  'anti-fraud': 'draft-1.0',
};

/** Documents that must be accepted before an organization account is created. */
export const REQUIRED_SIGNUP_LEGAL_DOCUMENTS: LegalDocumentType[] = [
  'terms',
  'privacy',
  'anti-fraud',
];

/** How an acceptance was captured, recorded alongside it for audit purposes. */
export enum LegalAcceptanceContext {
  /** Email + password signup form. */
  SIGNUP = 'SIGNUP',
  /** Google (or other OAuth) signup, where the box was ticked before redirect. */
  OAUTH_SIGNUP = 'OAUTH_SIGNUP',
  /** Re-acceptance after a document version changed. */
  REACCEPTANCE = 'REACCEPTANCE',
}

export const LEGAL_DOCUMENT_LABELS: Record<LegalDocumentType, string> = {
  terms: 'Master Services Agreement',
  privacy: 'Privacy Policy',
  'anti-fraud': 'Anti-Fraud Guidelines',
};
