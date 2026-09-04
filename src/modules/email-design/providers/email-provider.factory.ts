import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider } from './email-provider.interface';
import { BrevoEmailProvider } from './brevo-email.provider';
import { DevelopmentEmailProvider } from './development-email.provider';

@Injectable()
export class EmailProviderFactory {
  private readonly logger = new Logger(EmailProviderFactory.name);

  constructor(
    private readonly brevoProvider: BrevoEmailProvider,
    private readonly devProvider: DevelopmentEmailProvider,
  ) {}

  getProvider(forcedProvider?: string): EmailProvider {
    const configuredProvider = (
      forcedProvider ||
      process.env.EMAIL_PROVIDER ||
      (process.env.BREVO_API_KEY ? 'brevo' : 'development')
    ).toLowerCase();

    if (configuredProvider === 'brevo' && process.env.BREVO_API_KEY) {
      return this.brevoProvider;
    }

    if (configuredProvider === 'brevo' && !process.env.BREVO_API_KEY) {
      this.logger.warn('BREVO_API_KEY missing. Falling back to Development Email Provider.');
      return this.devProvider;
    }

    return this.devProvider;
  }
}

