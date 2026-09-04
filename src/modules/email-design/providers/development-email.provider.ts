import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { EmailProvider, SendEmailInput, SendEmailResult } from './email-provider.interface';

@Injectable()
export class DevelopmentEmailProvider implements EmailProvider {
  name = 'development';
  private readonly logger = new Logger(DevelopmentEmailProvider.name);

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const fakeMessageId = `dev-msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    this.logger.log(`[DEV EMAIL PROVIDER] Simulated Send to: ${input.to}`);
    this.logger.log(`  Subject: ${input.subject}`);
    this.logger.log(`  TemplateKey: ${input.templateKey || 'N/A'}`);
    this.logger.log(`  Sender: ${input.senderName || 'PartnerIQ'} <${input.senderEmail || 'no-reply@partneriq.local'}>`);

    // Optionally save HTML preview to scratch directory if available
    try {
      const scratchDir = path.join(process.cwd(), 'scratch', 'dev-emails');
      if (!fs.existsSync(scratchDir)) {
        fs.mkdirSync(scratchDir, { recursive: true });
      }
      const filePath = path.join(scratchDir, `${fakeMessageId}.html`);
      fs.writeFileSync(filePath, input.htmlContent, 'utf8');
      this.logger.log(`  Preview Saved: ${filePath}`);
    } catch {
      // Ignore directory creation errors
    }

    return {
      sent: true,
      provider: this.name,
      providerMessageId: fakeMessageId,
    };
  }
}

