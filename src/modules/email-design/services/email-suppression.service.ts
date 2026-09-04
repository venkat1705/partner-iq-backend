import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { EmailSuppression } from '../../../database/schema';

@Injectable()
export class EmailSuppressionService {
  private readonly logger = new Logger(EmailSuppressionService.name);

  async isSuppressed(email: string, organizationId?: string): Promise<boolean> {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return true;

    const existing = dbStore.emailSuppressions.find(
      (s) => s.email.toLowerCase() === normalized && (!organizationId || !s.organizationId || s.organizationId === organizationId),
    );

    return Boolean(existing);
  }

  async addSuppression(input: {
    email: string;
    reason: 'HARD_BOUNCE' | 'COMPLAINT' | 'UNSUBSCRIBED' | 'ADMIN_SUPPRESSED' | 'INVALID_ADDRESS';
    organizationId?: string;
    metadata?: Record<string, any>;
  }): Promise<EmailSuppression> {
    const normalized = String(input.email || '').trim().toLowerCase();

    const existing = dbStore.emailSuppressions.find(
      (s) => s.email.toLowerCase() === normalized && s.organizationId === input.organizationId,
    );

    if (existing) {
      existing.reason = input.reason;
      existing.metadata = { ...existing.metadata, ...input.metadata };
      return existing;
    }

    const record: EmailSuppression = {
      id: uuidv4(),
      email: normalized,
      reason: input.reason,
      organizationId: input.organizationId,
      metadata: input.metadata || {},
      createdAt: new Date(),
    };

    dbStore.emailSuppressions.push(record);
    this.logger.warn(`Added email suppression for [${normalized}] Reason: ${input.reason}`);
    return record;
  }

  async removeSuppression(email: string, organizationId?: string): Promise<boolean> {
    const normalized = String(email || '').trim().toLowerCase();
    const index = dbStore.emailSuppressions.findIndex(
      (s) => s.email.toLowerCase() === normalized && (!organizationId || s.organizationId === organizationId),
    );

    if (index >= 0) {
      dbStore.emailSuppressions.splice(index, 1);
      return true;
    }
    return false;
  }

  async listSuppressions(organizationId?: string) {
    return dbStore.emailSuppressions.filter(
      (s) => !organizationId || s.organizationId === organizationId,
    );
  }
}

