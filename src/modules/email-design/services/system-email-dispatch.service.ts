import { Injectable, Logger } from '@nestjs/common';
import { EmailQueueProducer } from '../queue/email-queue.producer';
import { EmailQueueWorker } from '../queue/email-queue.worker';
import { SystemTemplateKey } from '../constants/email-template-keys';

export interface SystemEmailDispatchOptions {
  organizationId?: string;
  userId?: string;
  eventId?: string;
  metadata?: Record<string, any>;
}

/**
 * Single shared entrypoint for dispatching any SystemTemplateKey email.
 * EmailQueueProducer.enqueue + EmailQueueWorker.processJob together already
 * resolve the template, render it, and send via the active provider (Brevo or
 * dev-log) — this just wraps that pipeline so every lifecycle event in the app
 * can fire an email with one line, without duplicating that boilerplate.
 *
 * Deliberately "safe": a failed/unavailable email dispatch is logged, never
 * thrown, so it can never block the business transaction that triggered it
 * (same convention as AuthService.sendSecurityNotificationSafe).
 */
@Injectable()
export class SystemEmailDispatchService {
  private readonly logger = new Logger(SystemEmailDispatchService.name);

  constructor(
    private readonly emailQueueProducer: EmailQueueProducer,
    private readonly emailQueueWorker: EmailQueueWorker,
  ) { }

  async send(
    templateKey: SystemTemplateKey | string,
    recipientEmail: string,
    payload: Record<string, any>,
    options: SystemEmailDispatchOptions = {},
  ): Promise<void> {
    if (!recipientEmail) {
      this.logger.warn(`[SystemEmailDispatch] Skipped [${templateKey}] — no recipient email provided.`);
      return;
    }

    try {
      const { jobId } = await this.emailQueueProducer.enqueue({
        templateKey,
        recipientEmail,
        payload,
        organizationId: options.organizationId,
        userId: options.userId,
        eventId: options.eventId,
        metadata: options.metadata,
      });

      const log = await this.emailQueueWorker.processJob(jobId);
      if (log.status === 'SENT') {
        this.logger.log(`[SystemEmailDispatch] [${templateKey}] sent to ${this.emailQueueProducer.maskEmail(recipientEmail)} via ${log.provider}`);
      } else {
        this.logger.warn(`[SystemEmailDispatch] [${templateKey}] to ${this.emailQueueProducer.maskEmail(recipientEmail)} ended with status [${log.status}]: ${log.failureMessage || 'unknown'}`);
      }
    } catch (err: any) {
      this.logger.error(`[SystemEmailDispatch] Exception dispatching [${templateKey}] to ${this.emailQueueProducer.maskEmail(recipientEmail)}: ${err?.message}`);
    }
  }
}
