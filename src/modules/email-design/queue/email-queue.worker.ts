import { Injectable, Logger } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { EmailDeliveryLog } from '../../../database/schema';
import { TemplateResolverService } from '../services/template-resolver.service';
import { TemplateRendererService } from '../services/template-renderer.service';
import { EmailSuppressionService } from '../services/email-suppression.service';
import { EmailProviderFactory } from '../providers/email-provider.factory';
import { SYSTEM_SECURITY_TEMPLATE_KEYS, SystemTemplateKey } from '../constants/email-template-keys';

@Injectable()
export class EmailQueueWorker {
  private readonly logger = new Logger(EmailQueueWorker.name);

  constructor(
    private readonly templateResolver: TemplateResolverService,
    private readonly templateRenderer: TemplateRendererService,
    private readonly suppressionService: EmailSuppressionService,
    private readonly providerFactory: EmailProviderFactory,
  ) {}

  /**
   * Process a single queued email job by ID
   */
  async processJob(jobId: string): Promise<EmailDeliveryLog> {
    const log = dbStore.emailDeliveryLogs.find((l) => l.id === jobId);
    if (!log) {
      throw new Error(`Email job [${jobId}] not found in delivery logs`);
    }

    log.status = 'PROCESSING';
    log.attemptCount = (log.attemptCount || 0) + 1;

    try {
      const payload = log.metadata?.payload || {};
      const isSecurityEmail = SYSTEM_SECURITY_TEMPLATE_KEYS.includes(log.templateKey as SystemTemplateKey);

      // 1. Check Suppression List (unless security email which cannot be unsubscribed)
      if (!isSecurityEmail) {
        const isSuppressed = await this.suppressionService.isSuppressed(log.recipientEmail, log.organizationId);
        if (isSuppressed) {
          log.status = 'SUPPRESSED';
          log.failureCode = 'RECIPIENT_SUPPRESSED';
          log.failureMessage = 'Recipient address is on suppression list (hard bounce or complaint)';
          log.failedAt = new Date();
          this.logger.warn(`Email job [${jobId}] skipped: Recipient [${log.recipientEmailMasked}] is suppressed.`);
          return log;
        }
      }

      // 2. Resolve Template
      const template = await this.templateResolver.resolveTemplate(log.templateKey, log.organizationId);

      // 3. Render Template HTML & PlainText
      const renderResult = this.templateRenderer.render({
        template,
        payload,
        organizationId: log.organizationId,
        recipientEmail: log.recipientEmail,
      });

      // Save rendered snapshot
      log.subject = renderResult.subject;
      log.snapshotHtml = renderResult.html;

      // 4. Resolve Active Provider Driver
      const provider = this.providerFactory.getProvider(log.provider);
      log.provider = provider.name;

      // 5. Execute Provider Delivery
      const sendResult = await provider.send({
        to: log.recipientEmail,
        subject: renderResult.subject,
        htmlContent: renderResult.html,
        textContent: renderResult.plainText,
        senderName: renderResult.senderName,
        senderEmail: renderResult.senderEmail,
        replyTo: renderResult.replyTo,
        templateKey: log.templateKey,
      });

      if (sendResult.sent) {
        log.status = 'SENT';
        log.providerMessageId = sendResult.providerMessageId;
        log.sentAt = new Date();
        this.logger.log(`Email job [${jobId}] successfully sent via ${provider.name} (MsgId: ${sendResult.providerMessageId})`);
      } else {
        log.status = 'FAILED';
        log.failureCode = 'PROVIDER_ERROR';
        log.failureMessage = sendResult.error || 'Provider execution failed';
        log.failedAt = new Date();
        this.logger.error(`Email job [${jobId}] delivery failed: ${sendResult.error}`);
      }

      return log;
    } catch (err: any) {
      log.status = 'FAILED';
      log.failureCode = 'RENDER_OR_DELIVERY_EXCEPTION';
      log.failureMessage = err?.message || 'Unexpected exception during processing';
      log.failedAt = new Date();
      this.logger.error(`Exception processing email job [${jobId}]: ${err?.message}`);
      return log;
    }
  }

  /**
   * Process all pending QUEUED jobs in queue
   */
  async processAllPending(): Promise<number> {
    const pending = dbStore.emailDeliveryLogs.filter((l) => l.status === 'QUEUED');
    for (const job of pending) {
      await this.processJob(job.id);
    }
    return pending.length;
  }
}

