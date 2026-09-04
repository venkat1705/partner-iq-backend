import { Injectable, Logger } from '@nestjs/common';
import { EmailQueueProducer, EmailJobPayload } from '../queue/email-queue.producer';
import { SystemTemplateKey } from '../constants/email-template-keys';

export interface DomainEventPayload {
  eventId: string;
  eventType: string; // e.g. 'commission.approved', 'payout.completed'
  organizationId?: string;
  userId?: string;
  recipientEmail: string;
  data: Record<string, any>;
}

@Injectable()
export class DomainEventEmailListener {
  private readonly logger = new Logger(DomainEventEmailListener.name);

  constructor(private readonly queueProducer: EmailQueueProducer) {}

  /**
   * Handle incoming domain events and map to corresponding email template job
   */
  async handleDomainEvent(event: DomainEventPayload) {
    const templateKey = this.mapEventToTemplateKey(event.eventType);
    if (!templateKey) {
      this.logger.debug(`No email template mapped for event type [${event.eventType}]`);
      return null;
    }

    const jobPayload: EmailJobPayload = {
      templateKey,
      recipientEmail: event.recipientEmail,
      payload: event.data,
      organizationId: event.organizationId,
      userId: event.userId,
      eventId: event.eventId,
      idempotencyKey: `${event.eventId}:${templateKey}:${event.recipientEmail}`,
    };

    const result = await this.queueProducer.enqueue(jobPayload);
    this.logger.log(`Domain event [${event.eventType}] mapped to email template [${templateKey}] (JobId: ${result.jobId})`);
    return result;
  }

  private mapEventToTemplateKey(eventType: string): string | null {
    switch (eventType) {
      case 'security.email_verification':
        return SystemTemplateKey.SECURITY_EMAIL_VERIFICATION;
      case 'security.password_reset':
        return SystemTemplateKey.SECURITY_PASSWORD_RESET;
      case 'security.password_changed':
        return SystemTemplateKey.SECURITY_PASSWORD_CHANGED;
      case 'security.new_login':
        return SystemTemplateKey.SECURITY_NEW_LOGIN;
      case 'security.two_factor_enabled':
        return SystemTemplateKey.SECURITY_TWO_FACTOR_ENABLED;
      case 'security.two_factor_disabled':
        return SystemTemplateKey.SECURITY_TWO_FACTOR_DISABLED;

      case 'affiliate.application_submitted':
        return SystemTemplateKey.AFFILIATE_APPLICATION_RECEIVED;
      case 'affiliate.application_approved':
        return SystemTemplateKey.AFFILIATE_APPLICATION_APPROVED;
      case 'affiliate.application_rejected':
        return SystemTemplateKey.AFFILIATE_APPLICATION_REJECTED;
      case 'affiliate.tier_changed':
        return SystemTemplateKey.AFFILIATE_TIER_CHANGED;

      case 'commission.created':
        return SystemTemplateKey.AFFILIATE_COMMISSION_CREATED;
      case 'commission.approved':
        return SystemTemplateKey.AFFILIATE_COMMISSION_APPROVED;
      case 'commission.payable':
        return SystemTemplateKey.AFFILIATE_COMMISSION_PAYABLE;
      case 'commission.reversed':
        return SystemTemplateKey.AFFILIATE_COMMISSION_REVERSED;

      case 'payout.processing':
        return SystemTemplateKey.AFFILIATE_PAYOUT_PROCESSING;
      case 'payout.completed':
        return SystemTemplateKey.AFFILIATE_PAYOUT_COMPLETED;
      case 'payout.failed':
        return SystemTemplateKey.AFFILIATE_PAYOUT_FAILED;

      case 'organization.invited':
        return SystemTemplateKey.ORGANIZATION_MEMBER_INVITED;

      case 'billing.payment_success':
        return SystemTemplateKey.BILLING_PAYMENT_SUCCESS;
      case 'billing.payment_failed':
        return SystemTemplateKey.BILLING_PAYMENT_FAILED;
      case 'billing.trial_ending':
        return SystemTemplateKey.BILLING_TRIAL_ENDING;

      default:
        return null;
    }
  }
}

