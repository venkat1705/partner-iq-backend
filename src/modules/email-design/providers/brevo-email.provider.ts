import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { EmailProvider, SendEmailInput, SendEmailResult } from './email-provider.interface';

@Injectable()
export class BrevoEmailProvider implements EmailProvider {
  name = 'brevo';
  private readonly logger = new Logger(BrevoEmailProvider.name);

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      throw new BadGatewayException('BREVO_API_KEY environment variable is not configured');
    }

    const defaultSenderEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@partneriq.local';
    const defaultSenderName = process.env.BREVO_SENDER_NAME || 'PartnerIQ';

    const sender = {
      email: input.senderEmail || defaultSenderEmail,
      name: input.senderName || defaultSenderName,
    };

    const payload: Record<string, any> = {
      sender,
      to: [{ email: input.to }],
      subject: input.subject,
      htmlContent: input.htmlContent,
      textContent: input.textContent,
      tags: input.tags || [input.templateKey || 'partneriq-email'].filter(Boolean),
    };

    if (input.replyTo) {
      payload.replyTo = { email: input.replyTo };
    }

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text().catch(() => '');
      let parsedBody: any = {};
      try {
        parsedBody = responseText ? JSON.parse(responseText) : {};
      } catch {
        parsedBody = {};
      }

      if (!response.ok) {
        const errorMsg = parsedBody?.message || parsedBody?.error || responseText || `HTTP ${response.status}`;
        this.logger.error(`Brevo email delivery failed for ${input.to}: ${errorMsg}`);
        return {
          sent: false,
          provider: this.name,
          providerMessageId: null,
          error: errorMsg,
        };
      }

      const messageId = parsedBody?.messageId || parsedBody?.messageIds?.[0] || null;
      this.logger.log(`Brevo email sent to ${input.to} (MessageId: ${messageId})`);

      return {
        sent: true,
        provider: this.name,
        providerMessageId: messageId,
      };
    } catch (err: any) {
      this.logger.error(`Brevo API network error: ${err?.message}`);
      return {
        sent: false,
        provider: this.name,
        providerMessageId: null,
        error: err?.message || 'Network error',
      };
    }
  }
}

