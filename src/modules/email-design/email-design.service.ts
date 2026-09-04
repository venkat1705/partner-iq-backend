import { BadGatewayException, BadRequestException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import { EmailDesignSettings, EmailDesignTemplate, EmailTemplateOverride } from '../../database/schema';
import { SYSTEM_TEMPLATE_CATALOG, SYSTEM_SECURITY_TEMPLATE_KEYS, SystemTemplateKey } from './constants/email-template-keys';
import { TemplateResolverService } from './services/template-resolver.service';
import { TemplateRendererService } from './services/template-renderer.service';
import { EmailSuppressionService } from './services/email-suppression.service';
import { EmailQueueProducer } from './queue/email-queue.producer';
import { EmailQueueWorker } from './queue/email-queue.worker';
import { EmailProviderFactory } from './providers/email-provider.factory';

const DEFAULT_BRAND_SETTINGS = {
  name: 'PartnerIQ',
  tagline: 'Partner & Affiliate Management Platform',
  signature: 'Built for better partnerships.',
  companyLegal: 'PartnerIQ Technologies Inc.',
  logoUrl:
    'https://res.cloudinary.com/bunny1705/image/upload/v1787584202/partneriq/92977d80-3e51-4a12-a382-64b42fb5466a/organization-logo/rrhwttefwtgrxico2rtv.png',
  websiteUrl: 'https://partneriq.io',
  docsUrl: 'https://docs.partneriq.io',
  helpCenterUrl: 'https://help.partneriq.io',
  privacyUrl: 'https://partneriq.io/privacy',
  termsUrl: 'https://partneriq.io/terms',
  supportEmail: 'support@partneriq.io',
  physicalAddress: '548 Market St, Suite 39201, San Francisco, CA 94104',
};

@Injectable()
export class EmailDesignService {
  private readonly logger = new Logger(EmailDesignService.name);

  constructor(
    private readonly templateResolver: TemplateResolverService,
    private readonly templateRenderer: TemplateRendererService,
    private readonly suppressionService: EmailSuppressionService,
    private readonly queueProducer: EmailQueueProducer,
    private readonly queueWorker: EmailQueueWorker,
    private readonly providerFactory: EmailProviderFactory,
  ) {}

  getSettings() {
    return this.serializeSettings(this.ensureSettings());
  }

  saveSettings(payload: any) {
    const settings = this.ensureSettings();
    settings.payload = {
      ...DEFAULT_BRAND_SETTINGS,
      ...settings.payload,
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    settings.updatedAt = new Date();
    return this.serializeSettings(settings);
  }

  listTemplates() {
    return dbStore.emailDesignTemplates
      .slice()
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((row) => this.serialize(row));
  }

  getCatalog() {
    return Object.values(SYSTEM_TEMPLATE_CATALOG).map((item) => {
      const isSecurity = SYSTEM_SECURITY_TEMPLATE_KEYS.includes(item.key);
      const dbTemplate = dbStore.emailDesignTemplates.find(
        (t) => t.templateId === item.key || t.templateId === item.key.toLowerCase(),
      );

      return {
        ...item,
        isSecurity,
        isOverridable: !isSecurity,
        hasCustomOverride: Boolean(dbTemplate?.isCustom || dbTemplate?.isEdited),
      };
    });
  }

  saveTemplate(template: any) {
    if (!template?.id) {
      throw new NotFoundException('Template id is required');
    }

    const existing = dbStore.emailDesignTemplates.find((row) => row.templateId === template.id);
    const record = existing || ({
      id: uuidv4(),
      createdAt: new Date(),
    } as EmailDesignTemplate);

    record.templateId = template.id;
    record.name = template.name || template.id;
    record.category = template.category || 'organizations';
    record.isCustom = Boolean(template.isCustom);
    record.isEdited = Boolean(template.isEdited);
    record.payload = {
      ...template,
      updatedAt: new Date().toISOString(),
    };
    record.updatedAt = new Date();

    if (!existing) {
      dbStore.emailDesignTemplates.push(record);
    }

    return this.serialize(record);
  }

  saveTemplates(list: any[]) {
    const saved = list.filter((template) => template?.id).map((template) => this.saveTemplate(template));
    return saved;
  }

  deleteTemplate(templateId: string) {
    const index = dbStore.emailDesignTemplates.findIndex((row) => row.templateId === templateId);
    if (index === -1) {
      return { success: true };
    }

    dbStore.emailDesignTemplates.splice(index, 1);
    return { success: true };
  }

  // Organization Overrides
  saveOrganizationOverride(organizationId: string, templateKey: string, dto: {
    customSubject?: string;
    customPreheader?: string;
    customBody?: string;
    customData?: Record<string, any>;
  }) {
    if (SYSTEM_SECURITY_TEMPLATE_KEYS.includes(templateKey as SystemTemplateKey)) {
      throw new BadRequestException(`Security template [${templateKey}] cannot be overridden by organizations.`);
    }

    let existing = dbStore.emailTemplateOverrides.find(
      (o) => o.organizationId === organizationId && o.templateKey === templateKey,
    );

    if (!existing) {
      existing = {
        id: uuidv4(),
        organizationId,
        templateKey,
        status: 'PUBLISHED',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as EmailTemplateOverride;
      dbStore.emailTemplateOverrides.push(existing);
    }

    existing.customSubject = dto.customSubject;
    existing.customPreheader = dto.customPreheader;
    existing.customBody = dto.customBody;
    existing.customData = dto.customData;
    existing.status = 'PUBLISHED';
    existing.updatedAt = new Date();

    return existing;
  }

  deleteOrganizationOverride(organizationId: string, templateKey: string) {
    const index = dbStore.emailTemplateOverrides.findIndex(
      (o) => o.organizationId === organizationId && o.templateKey === templateKey,
    );
    if (index >= 0) {
      dbStore.emailTemplateOverrides.splice(index, 1);
    }
    return { success: true };
  }

  async sendTestEmail(payload: any) {
    const toEmail = String(payload?.toEmail || '').trim();
    const subject = String(payload?.subject || payload?.defaultSubject || 'PartnerIQ Test Email').trim();
    const templateKey = payload?.templateId || payload?.templateKey || 'AFFILIATE_WELCOME';

    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      throw new BadRequestException('A valid recipient email is required');
    }

    const { jobId } = await this.queueProducer.enqueue({
      templateKey,
      recipientEmail: toEmail,
      payload: {
        subject,
        preheader: payload.defaultPreheader || payload.preheader,
        html: payload.bodyTemplate || payload.html || payload.bodyHtml || payload.htmlContent,
        affiliate: { firstName: 'TestPartner', fullName: 'Test Partner' },
        organization: { name: 'PartnerIQ Test Lab' },
        commission: { amountFormatted: '$125.00', currency: 'USD' },
        payout: { amountFormatted: '$500.00', reference: 'REF-TEST-123' },
        trial: { daysRemaining: 3 },
        billing: { amountFormatted: '$99.00', planName: 'Growth Plan' },
        user: { firstName: 'Admin' },
        security: { deviceName: 'Chrome on macOS', location: 'San Francisco, CA', ipAddress: '127.0.0.1', timestamp: new Date().toLocaleString() },
        links: { dashboardUrl: 'https://affiliate.partneriq.in', verificationUrl: 'https://partneriq.io/verify', resetPasswordUrl: 'https://partneriq.io/reset' },
        ...(payload.sampleData || {}),
      },
      metadata: { isTestEmail: true },
    });

    // Execute worker immediately for test email so user receives instant feedback
    const processed = await this.queueWorker.processJob(jobId);

    return {
      sent: processed.status === 'SENT',
      jobId,
      status: processed.status,
      provider: processed.provider,
      providerMessageId: processed.providerMessageId,
      error: processed.failureMessage,
    };
  }

  // Delivery Logs
  getDeliveryLogs(organizationId?: string, page = 1, limit = 20) {
    const logs = dbStore.emailDeliveryLogs
      .filter((l) => !organizationId || l.organizationId === organizationId)
      .sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime());

    const total = logs.length;
    const pages = Math.ceil(total / limit) || 1;
    const paginated = logs.slice((page - 1) * limit, page * limit);

    return {
      logs: paginated,
      pagination: { page, limit, total, pages },
    };
  }

  // Webhook Receiver (Brevo / SendGrid Delivery Events)
  async handleWebhook(provider: string, payload: any) {
    this.logger.log(`Processing email delivery webhook from [${provider}]`);

    const event = payload?.event || payload?.type;
    const messageId = payload?.['message-id'] || payload?.messageId;
    const email = payload?.email;

    if (!messageId && !email) {
      return { success: true, processed: false };
    }

    const log = dbStore.emailDeliveryLogs.find(
      (l) => l.providerMessageId === messageId || (email && l.recipientEmail.toLowerCase() === email.toLowerCase()),
    );

    if (log) {
      if (['delivered', 'delivery'].includes(String(event).toLowerCase())) {
        log.status = 'DELIVERED';
        log.deliveredAt = new Date();
      } else if (['hard_bounce', 'bounce', 'invalid_email'].includes(String(event).toLowerCase())) {
        log.status = 'BOUNCED';
        log.failureCode = 'HARD_BOUNCE';
        log.failedAt = new Date();
        if (log.recipientEmail) {
          await this.suppressionService.addSuppression({
            email: log.recipientEmail,
            reason: 'HARD_BOUNCE',
            organizationId: log.organizationId,
          });
        }
      } else if (['spam', 'complaint'].includes(String(event).toLowerCase())) {
        log.status = 'COMPLAINED';
        log.failureCode = 'SPAM_COMPLAINT';
        log.failedAt = new Date();
        if (log.recipientEmail) {
          await this.suppressionService.addSuppression({
            email: log.recipientEmail,
            reason: 'COMPLAINT',
            organizationId: log.organizationId,
          });
        }
      }
    }

    return { success: true, processed: Boolean(log) };
  }

  // Health check
  getHealth() {
    const activeProvider = this.providerFactory.getProvider();
    return {
      status: 'ok',
      provider: activeProvider.name,
      queueDepth: dbStore.emailDeliveryLogs.filter((l) => l.status === 'QUEUED').length,
      suppressionsCount: dbStore.emailSuppressions.length,
      timestamp: new Date().toISOString(),
    };
  }

  private serialize(row: EmailDesignTemplate) {
    return {
      ...row.payload,
      id: row.templateId,
      name: row.name,
      category: row.category,
      isCustom: row.isCustom,
      isEdited: row.isEdited,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private ensureSettings() {
    let settings = dbStore.emailDesignSettings.find((row) => row.settingsKey === 'default');
    if (!settings) {
      settings = {
        id: uuidv4(),
        settingsKey: 'default',
        payload: {
          ...DEFAULT_BRAND_SETTINGS,
          updatedAt: new Date().toISOString(),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as EmailDesignSettings;
      dbStore.emailDesignSettings.push(settings);
    }
    return settings;
  }

  private serializeSettings(row: EmailDesignSettings) {
    return {
      ...DEFAULT_BRAND_SETTINGS,
      ...row.payload,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export default EmailDesignService;
