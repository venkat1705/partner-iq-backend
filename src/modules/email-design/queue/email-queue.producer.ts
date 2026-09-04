import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { EmailDeliveryLog } from '../../../database/schema';

export interface EmailJobPayload {
  templateKey: string;
  recipientEmail: string;
  payload: Record<string, any>;
  organizationId?: string;
  userId?: string;
  eventId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class EmailQueueProducer {
  private readonly logger = new Logger(EmailQueueProducer.name);

  /**
   * Mask email recipient for privacy in delivery logs (e.g., j***e@example.com)
   */
  maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return '***@***.com';
    const name = parts[0];
    const domain = parts[1];
    const maskedName = name.length <= 2 ? name[0] + '*' : name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
    return `${maskedName}@${domain}`;
  }

  /**
   * Enqueue email job into memory / BullMQ queue with idempotency check
   */
  async enqueue(job: EmailJobPayload): Promise<{ jobId: string; isDuplicate: boolean }> {
    const idempotencyKey = job.idempotencyKey || (job.eventId ? `${job.eventId}:${job.templateKey}:${job.recipientEmail}` : undefined);

    // 1. Idempotency Check — if job with same idempotencyKey already queued or sent, return existing
    if (idempotencyKey) {
      const existingLog = dbStore.emailDeliveryLogs.find((log) => log.idempotencyKey === idempotencyKey);
      if (existingLog) {
        this.logger.warn(`[IDEMPOTENCY] Duplicate email job suppressed for key [${idempotencyKey}]`);
        return { jobId: existingLog.id, isDuplicate: true };
      }
    }

    const jobId = uuidv4();
    const maskedEmail = this.maskEmail(job.recipientEmail);

    // Create initial QUEUED log entry with snapshot payload
    const logRecord: EmailDeliveryLog = {
      id: jobId,
      messageId: jobId,
      templateKey: job.templateKey,
      organizationId: job.organizationId,
      recipientEmail: job.recipientEmail,
      recipientEmailMasked: maskedEmail,
      subject: job.payload?.subject || `Email Notification (${job.templateKey})`,
      provider: process.env.BREVO_API_KEY ? 'brevo' : 'development',
      status: 'QUEUED',
      attemptCount: 0,
      eventId: job.eventId,
      idempotencyKey,
      metadata: {
        payload: job.payload,
        userId: job.userId,
        ...job.metadata,
      },
      queuedAt: new Date(),
      createdAt: new Date(),
    };

    dbStore.emailDeliveryLogs.unshift(logRecord);
    this.logger.log(`Enqueued email job [${jobId}] for template [${job.templateKey}] to ${maskedEmail}`);

    return { jobId, isDuplicate: false };
  }
}

