/**
 * Legal document acceptance: that consent is recorded, versioned, and detectable
 * when stale.
 *
 * Runs against the in-memory dbStore with no database connection, the same way
 * the subscription-limits suite does.
 *
 *   npm run test:legal
 */
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../database/store';
import { LegalAcceptanceService } from '../modules/auth/legal-acceptance.service';
import {
  LEGAL_DOCUMENT_VERSIONS,
  LegalAcceptanceContext,
  REQUIRED_SIGNUP_LEGAL_DOCUMENTS,
} from '../common/constants/legal-documents';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${name}`, detail ?? '');
    failed++;
  }
}

const service = new LegalAcceptanceService();

function resetStore() {
  dbStore.userLegalAcceptances.length = 0;
}

async function main() {
  console.log('\n🧪 PartnerIQ Legal Acceptance Suite\n');

  // --- Signup records every required document -----------------------------
  resetStore();
  const userId = uuidv4();
  const written = await service.recordSignupAcceptance({
    userId,
    context: LegalAcceptanceContext.SIGNUP,
    ipAddress: '203.0.113.9',
    userAgent: 'Mozilla/5.0 (Test)',
  });

  assert(
    written.length === REQUIRED_SIGNUP_LEGAL_DOCUMENTS.length,
    `Signup records all ${REQUIRED_SIGNUP_LEGAL_DOCUMENTS.length} required documents`,
    written,
  );
  assert(
    REQUIRED_SIGNUP_LEGAL_DOCUMENTS.every((doc) =>
      written.some((item) => item.documentType === doc),
    ),
    'Terms, Privacy Policy and Anti-Fraud Guidelines are each recorded',
  );
  assert(
    written.every((item) => item.documentVersion === LEGAL_DOCUMENT_VERSIONS[item.documentType]),
    'Each acceptance is stamped with the version currently in force',
  );

  const stored = dbStore.userLegalAcceptances.filter((item) => item.userId === userId);
  assert(
    stored.every((item) => item.ipAddress === '203.0.113.9'),
    'The originating IP address is retained as evidence',
  );
  assert(
    stored.every((item) => item.userAgent === 'Mozilla/5.0 (Test)'),
    'The user agent is retained as evidence',
  );
  assert(
    stored.every((item) => item.acceptanceContext === LegalAcceptanceContext.SIGNUP),
    'The acceptance context is recorded',
  );
  assert(service.hasAcceptedAll(userId), 'The user is reported as having accepted everything');
  assert(
    service.getOutstandingDocuments(userId).length === 0,
    'No documents are outstanding after signup',
  );

  // --- Never double-records the same version ------------------------------
  const firstAcceptedAt = stored[0].acceptedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await service.recordSignupAcceptance({ userId, context: LegalAcceptanceContext.SIGNUP });
  const afterRepeat = dbStore.userLegalAcceptances.filter((item) => item.userId === userId);
  assert(
    afterRepeat.length === REQUIRED_SIGNUP_LEGAL_DOCUMENTS.length,
    'Accepting the same version twice does not create duplicate rows',
    afterRepeat.length,
  );
  assert(
    afterRepeat[0].acceptedAt === firstAcceptedAt,
    'The original acceptance timestamp is preserved — it is the evidence that matters',
  );

  // --- A new document version makes consent stale -------------------------
  const originalTermsVersion = LEGAL_DOCUMENT_VERSIONS.terms;
  try {
    (LEGAL_DOCUMENT_VERSIONS as Record<string, string>).terms = 'draft-2.0';
    const outstanding = service.getOutstandingDocuments(userId);
    assert(
      outstanding.includes('terms'),
      'Bumping a document version marks that document as outstanding again',
      outstanding,
    );
    assert(
      !outstanding.includes('privacy') && !outstanding.includes('anti-fraud'),
      'Unchanged documents stay accepted',
    );
    assert(!service.hasAcceptedAll(userId), 'The user no longer counts as fully accepted');

    await service.recordAcceptance({
      userId,
      documentTypes: ['terms'],
      context: LegalAcceptanceContext.REACCEPTANCE,
    });
    assert(service.hasAcceptedAll(userId), 'Re-accepting the new version clears the outstanding flag');
    assert(
      dbStore.userLegalAcceptances.filter(
        (item) => item.userId === userId && item.documentType === 'terms',
      ).length === 2,
      'Both the old and new version acceptances are kept as an audit trail',
    );
  } finally {
    (LEGAL_DOCUMENT_VERSIONS as Record<string, string>).terms = originalTermsVersion;
  }

  // --- Isolation between users -------------------------------------------
  const otherUserId = uuidv4();
  assert(
    !service.hasAcceptedAll(otherUserId),
    'A user who never accepted anything is reported as not having accepted',
  );
  assert(
    service.getOutstandingDocuments(otherUserId).length === REQUIRED_SIGNUP_LEGAL_DOCUMENTS.length,
    'Every required document is outstanding for a brand-new user',
  );
  assert(service.listForUser(otherUserId).length === 0, 'One user cannot see another user’s acceptances');

  // --- OAuth signups are recorded too, and distinguishable ----------------
  resetStore();
  const oauthUserId = uuidv4();
  await service.recordSignupAcceptance({
    userId: oauthUserId,
    context: LegalAcceptanceContext.OAUTH_SIGNUP,
  });
  assert(
    service.hasAcceptedAll(oauthUserId),
    'A Google signup records acceptance just like the password form',
  );
  assert(
    service
      .listForUser(oauthUserId)
      .every((item) => item.acceptanceContext === LegalAcceptanceContext.OAUTH_SIGNUP),
    'An OAuth acceptance is distinguishable from a form acceptance',
  );

  // --- Oversized evidence is truncated, never dropped ---------------------
  resetStore();
  const longUaUserId = uuidv4();
  await service.recordSignupAcceptance({
    userId: longUaUserId,
    context: LegalAcceptanceContext.SIGNUP,
    userAgent: 'x'.repeat(2000),
  });
  const longUaRows = dbStore.userLegalAcceptances.filter((item) => item.userId === longUaUserId);
  assert(
    longUaRows.length === REQUIRED_SIGNUP_LEGAL_DOCUMENTS.length,
    'An oversized user agent does not prevent the acceptance being recorded',
  );
  assert(
    longUaRows.every((item) => (item.userAgent?.length ?? 0) <= 512),
    'An oversized user agent is truncated to the column width',
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`${'='.repeat(60)}\n`);

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Suite crashed:', error);
  process.exit(1);
});
