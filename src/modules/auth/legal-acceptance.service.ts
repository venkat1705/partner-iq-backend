import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, UserLegalAcceptanceEntity } from '../../database/store';
import { AppDataSource } from '../../database/data-source';
import { UserLegalAcceptance } from '../../database/schema';
import {
  LEGAL_DOCUMENT_VERSIONS,
  LegalAcceptanceContext,
  LegalDocumentType,
  REQUIRED_SIGNUP_LEGAL_DOCUMENTS,
} from '../../common/constants/legal-documents';

export interface LegalAcceptanceRecord {
  documentType: LegalDocumentType;
  documentVersion: string;
  acceptedAt: Date;
  acceptanceContext: string;
}

/**
 * Records and reads evidence that a user accepted PartnerIQ's legal documents.
 *
 * Writes one append-only row per (user, document, version). Versions come from
 * the server-side registry, never from the request — a client-supplied version
 * could be forged to make stale consent look current.
 */
@Injectable()
export class LegalAcceptanceService {
  private readonly logger = new Logger(LegalAcceptanceService.name);

  /**
   * Records acceptance of every document required at signup.
   *
   * Non-throwing by design: a registration that has already created the user
   * must not fail because the audit write failed. A failure is logged loudly
   * instead, and {@link getOutstandingDocuments} will report the user as not
   * having accepted, so they are prompted again rather than silently passing.
   */
  async recordSignupAcceptance(input: {
    userId: string;
    context: LegalAcceptanceContext;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<LegalAcceptanceRecord[]> {
    return this.recordAcceptance({
      ...input,
      documentTypes: REQUIRED_SIGNUP_LEGAL_DOCUMENTS,
    });
  }

  async recordAcceptance(input: {
    userId: string;
    documentTypes: LegalDocumentType[];
    context: LegalAcceptanceContext;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<LegalAcceptanceRecord[]> {
    const acceptedAt = new Date();
    const written: LegalAcceptanceRecord[] = [];

    for (const documentType of input.documentTypes) {
      const documentVersion = LEGAL_DOCUMENT_VERSIONS[documentType];
      if (!documentVersion) {
        this.logger.warn(`No version configured for legal document '${documentType}'; skipping.`);
        continue;
      }

      // Accepting the same version twice adds nothing; keep the original
      // timestamp, which is the one that matters as evidence.
      const already = dbStore.userLegalAcceptances.find(
        (item) =>
          item.userId === input.userId &&
          item.documentType === documentType &&
          item.documentVersion === documentVersion,
      );
      if (already) {
        written.push({
          documentType,
          documentVersion,
          acceptedAt: already.acceptedAt,
          acceptanceContext: already.acceptanceContext,
        });
        continue;
      }

      const record: UserLegalAcceptanceEntity = {
        id: uuidv4(),
        userId: input.userId,
        documentType,
        documentVersion,
        acceptedAt,
        acceptanceContext: input.context,
        ipAddress: input.ipAddress?.slice(0, 64),
        // Truncated to the column width so an unusually long header cannot
        // fail the insert and lose the acceptance record.
        userAgent: input.userAgent?.slice(0, 512),
        createdAt: acceptedAt,
      } as UserLegalAcceptanceEntity;

      try {
        if (AppDataSource.isInitialized) {
          await AppDataSource.getRepository(UserLegalAcceptance).save(record);
        }
        if (!dbStore.userLegalAcceptances.some((item) => item.id === record.id)) {
          dbStore.userLegalAcceptances.push(record);
        }
        written.push({
          documentType,
          documentVersion,
          acceptedAt,
          acceptanceContext: input.context,
        });
      } catch (error) {
        this.logger.error(
          `Failed to record '${documentType}' acceptance for user ${input.userId}: ${(error as Error).message}`,
        );
      }
    }

    return written;
  }

  /** Every acceptance on record for a user, newest first. */
  listForUser(userId: string): LegalAcceptanceRecord[] {
    return dbStore.userLegalAcceptances
      .filter((item) => item.userId === userId)
      .sort((a, b) => new Date(b.acceptedAt).getTime() - new Date(a.acceptedAt).getTime())
      .map((item) => ({
        documentType: item.documentType as LegalDocumentType,
        documentVersion: item.documentVersion,
        acceptedAt: item.acceptedAt,
        acceptanceContext: item.acceptanceContext,
      }));
  }

  /**
   * Required documents the user has not accepted at the version currently in
   * force. A non-empty result means consent is stale and should be re-collected.
   */
  getOutstandingDocuments(userId: string): LegalDocumentType[] {
    return REQUIRED_SIGNUP_LEGAL_DOCUMENTS.filter((documentType) => {
      const requiredVersion = LEGAL_DOCUMENT_VERSIONS[documentType];
      return !dbStore.userLegalAcceptances.some(
        (item) =>
          item.userId === userId &&
          item.documentType === documentType &&
          item.documentVersion === requiredVersion,
      );
    });
  }

  hasAcceptedAll(userId: string): boolean {
    return this.getOutstandingDocuments(userId).length === 0;
  }
}
