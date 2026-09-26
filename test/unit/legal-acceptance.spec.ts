import { describe, it, expect, beforeEach } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../src/database/store';
import { LegalAcceptanceService } from '../../src/modules/auth/legal-acceptance.service';
import {
  LEGAL_DOCUMENT_VERSIONS,
  LegalAcceptanceContext,
  REQUIRED_SIGNUP_LEGAL_DOCUMENTS,
} from '../../src/common/constants/legal-documents';

describe('LegalAcceptanceService', () => {
  let service: LegalAcceptanceService;

  beforeEach(() => {
    service = new LegalAcceptanceService();
  });

  it('records every required document on signup with metadata', async () => {
    const userId = uuidv4();
    const written = await service.recordSignupAcceptance({
      userId,
      context: LegalAcceptanceContext.SIGNUP,
      ipAddress: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (Test)',
    });

    expect(written.length).toBe(REQUIRED_SIGNUP_LEGAL_DOCUMENTS.length);
    expect(
      REQUIRED_SIGNUP_LEGAL_DOCUMENTS.every((doc) =>
        written.some((item) => item.documentType === doc)
      )
    ).toBe(true);
    expect(
      written.every((item) => item.documentVersion === LEGAL_DOCUMENT_VERSIONS[item.documentType])
    ).toBe(true);

    const stored = dbStore.userLegalAcceptances.filter((item) => item.userId === userId);
    expect(stored.every((item) => item.ipAddress === '203.0.113.9')).toBe(true);
    expect(stored.every((item) => item.userAgent === 'Mozilla/5.0 (Test)')).toBe(true);
    expect(stored.every((item) => item.acceptanceContext === LegalAcceptanceContext.SIGNUP)).toBe(true);
    expect(service.hasAcceptedAll(userId)).toBe(true);
    expect(service.getOutstandingDocuments(userId).length).toBe(0);
  });

  it('never double-records the same document version', async () => {
    const userId = uuidv4();
    await service.recordSignupAcceptance({
      userId,
      context: LegalAcceptanceContext.SIGNUP,
    });
    const stored = dbStore.userLegalAcceptances.filter((item) => item.userId === userId);
    const firstAcceptedAt = stored[0].acceptedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.recordSignupAcceptance({ userId, context: LegalAcceptanceContext.SIGNUP });

    const afterRepeat = dbStore.userLegalAcceptances.filter((item) => item.userId === userId);
    expect(afterRepeat.length).toBe(REQUIRED_SIGNUP_LEGAL_DOCUMENTS.length);
    expect(afterRepeat[0].acceptedAt).toEqual(firstAcceptedAt);
  });

  it('marks consent as stale when a document version is bumped', async () => {
    const userId = uuidv4();
    await service.recordSignupAcceptance({
      userId,
      context: LegalAcceptanceContext.SIGNUP,
    });

    const originalTermsVersion = LEGAL_DOCUMENT_VERSIONS.terms;
    try {
      (LEGAL_DOCUMENT_VERSIONS as Record<string, string>).terms = 'draft-2.0';
      const outstanding = service.getOutstandingDocuments(userId);
      expect(outstanding.includes('terms')).toBe(true);
      expect(!outstanding.includes('privacy') && !outstanding.includes('anti-fraud')).toBe(true);
      expect(service.hasAcceptedAll(userId)).toBe(false);

      await service.recordAcceptance({
        userId,
        documentTypes: ['terms'],
        context: LegalAcceptanceContext.REACCEPTANCE,
      });
      expect(service.hasAcceptedAll(userId)).toBe(true);
      expect(
        dbStore.userLegalAcceptances.filter(
          (item) => item.userId === userId && item.documentType === 'terms',
        ).length
      ).toBe(2);
    } finally {
      (LEGAL_DOCUMENT_VERSIONS as Record<string, string>).terms = originalTermsVersion;
    }
  });

  it('maintains isolation between users', () => {
    const otherUserId = uuidv4();
    expect(service.hasAcceptedAll(otherUserId)).toBe(false);
    expect(service.getOutstandingDocuments(otherUserId).length).toBe(
      REQUIRED_SIGNUP_LEGAL_DOCUMENTS.length
    );
    expect(service.listForUser(otherUserId).length).toBe(0);
  });

  it('records and distinguishes OAuth signups', async () => {
    const oauthUserId = uuidv4();
    await service.recordSignupAcceptance({
      userId: oauthUserId,
      context: LegalAcceptanceContext.OAUTH_SIGNUP,
    });

    expect(service.hasAcceptedAll(oauthUserId)).toBe(true);
    expect(
      service
        .listForUser(oauthUserId)
        .every((item) => item.acceptanceContext === LegalAcceptanceContext.OAUTH_SIGNUP)
    ).toBe(true);
  });

  it('truncates oversized evidence rather than dropping it', async () => {
    const longUaUserId = uuidv4();
    await service.recordSignupAcceptance({
      userId: longUaUserId,
      context: LegalAcceptanceContext.SIGNUP,
      userAgent: 'x'.repeat(2000),
    });
    const longUaRows = dbStore.userLegalAcceptances.filter((item) => item.userId === longUaUserId);
    expect(longUaRows.length).toBe(REQUIRED_SIGNUP_LEGAL_DOCUMENTS.length);
    expect(longUaRows.every((item) => (item.userAgent?.length ?? 0) <= 512)).toBe(true);
  });
});

