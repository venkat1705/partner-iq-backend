import { BadGatewayException, BadRequestException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import { AppDataSource } from '../../database/data-source';
import { EmailDesignSettings, EmailDesignTemplate, EmailTemplateOverride, DocumentDesignTemplate, GeneratedDocument } from '../../database/schema';
import { SYSTEM_TEMPLATE_CATALOG, SYSTEM_SECURITY_TEMPLATE_KEYS, SystemTemplateKey } from './constants/email-template-keys';
import { DEFAULT_DOCUMENT_TEMPLATES } from './constants/document-template-defaults';
import { DocumentType, TemplateStatus, PageSize, PageOrientation } from '../../common/enums';
import { TemplateResolverService } from './services/template-resolver.service';
import { TemplateRendererService } from './services/template-renderer.service';
import { EmailSuppressionService } from './services/email-suppression.service';
import { DocumentRendererService } from './services/document-renderer.service';
import { PdfGeneratorService } from './services/pdf-generator.service';
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
    private readonly documentRenderer: DocumentRendererService,
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly queueProducer: EmailQueueProducer,
    private readonly queueWorker: EmailQueueWorker,
    private readonly providerFactory: EmailProviderFactory,
  ) {
    this.ensureDefaultDocumentTemplates();
  }

  async getSettings() {
    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(EmailDesignSettings);
      let settings = await repo.findOne({ where: { settingsKey: 'default' } });
      if (!settings) {
        settings = repo.create({
          id: uuidv4(),
          settingsKey: 'default',
          payload: {
            ...DEFAULT_BRAND_SETTINGS,
            updatedAt: new Date().toISOString(),
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await repo.save(settings);
      }
      return this.serializeSettings(settings);
    }
    return this.serializeSettings(this.ensureSettings());
  }

  async saveSettings(payload: any) {
    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(EmailDesignSettings);
      let settings = await repo.findOne({ where: { settingsKey: 'default' } });
      if (!settings) {
        settings = repo.create({
          id: uuidv4(),
          settingsKey: 'default',
          createdAt: new Date(),
        });
      }
      settings.payload = {
        ...DEFAULT_BRAND_SETTINGS,
        ...(settings.payload || {}),
        ...payload,
        updatedAt: new Date().toISOString(),
      };
      settings.updatedAt = new Date();
      const saved = await repo.save(settings);

      const memIdx = dbStore.emailDesignSettings.findIndex((row) => row.settingsKey === 'default');
      if (memIdx >= 0) {
        dbStore.emailDesignSettings[memIdx] = saved;
      } else {
        dbStore.emailDesignSettings.push(saved);
      }

      return this.serializeSettings(saved);
    }

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

  async listTemplates() {
    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(EmailDesignTemplate);
      const rows = await repo.find({ order: { updatedAt: 'DESC' } });
      return rows.map((row) => this.serialize(row));
    }
    return dbStore.emailDesignTemplates
      .slice()
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((row) => this.serialize(row));
  }

  async getCatalog() {
    const list = await this.listTemplates();
    return Object.values(SYSTEM_TEMPLATE_CATALOG).map((item) => {
      const isSecurity = SYSTEM_SECURITY_TEMPLATE_KEYS.includes(item.key);
      const dbTemplate = list.find(
        (t) => t.id === item.key || t.id === item.key.toLowerCase(),
      );

      return {
        ...item,
        isSecurity,
        isOverridable: !isSecurity,
        hasCustomOverride: Boolean(dbTemplate?.isCustom || dbTemplate?.isEdited),
      };
    });
  }

  async saveTemplate(template: any) {
    if (!template?.id) {
      throw new NotFoundException('Template id is required');
    }

    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(EmailDesignTemplate);
      let record = await repo.findOne({ where: { templateId: template.id } });
      if (!record) {
        record = repo.create({
          id: uuidv4(),
          templateId: template.id,
          createdAt: new Date(),
        });
      }

      record.templateId = template.id;
      record.name = template.name || template.id;
      record.category = template.category || 'organizations';
      record.isCustom = Boolean(template.isCustom);
      record.isEdited = Boolean(template.isEdited);
      record.payload = {
        ...template,
        id: template.id,
        updatedAt: new Date().toISOString(),
      };
      record.updatedAt = new Date();

      const saved = await repo.save(record);

      const memIdx = dbStore.emailDesignTemplates.findIndex((row) => row.templateId === template.id);
      if (memIdx >= 0) {
        dbStore.emailDesignTemplates[memIdx] = saved;
      } else {
        dbStore.emailDesignTemplates.push(saved);
      }

      return this.serialize(saved);
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
      id: template.id,
      updatedAt: new Date().toISOString(),
    };
    record.updatedAt = new Date();

    if (!existing) {
      dbStore.emailDesignTemplates.push(record);
    }

    return this.serialize(record);
  }

  async saveTemplates(list: any[]) {
    const valid = list.filter((template) => template?.id);
    const saved = [];
    for (const item of valid) {
      saved.push(await this.saveTemplate(item));
    }
    return saved;
  }

  async deleteTemplate(templateId: string) {
    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(EmailDesignTemplate);
      await repo.delete({ templateId });
    }

    const index = dbStore.emailDesignTemplates.findIndex((row) => row.templateId === templateId);
    if (index >= 0) {
      dbStore.emailDesignTemplates.splice(index, 1);
    }
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

  async ensureDefaultDocumentTemplates() {
    if (!AppDataSource.isInitialized) return;
    const repo = AppDataSource.getRepository(DocumentDesignTemplate);
    for (const [key, defaultTpl] of Object.entries(DEFAULT_DOCUMENT_TEMPLATES)) {
      const existingInDb = await repo.findOne({ where: { templateKey: key } });
      if (!existingInDb) {
        const record = repo.create({
          id: uuidv4(),
          templateKey: key,
          name: defaultTpl.name,
          category: defaultTpl.category,
          documentType: defaultTpl.documentType,
          pageSize: defaultTpl.pageSize,
          orientation: defaultTpl.orientation,
          margins: defaultTpl.margins,
          headerSettings: defaultTpl.headerSettings,
          footerSettings: defaultTpl.footerSettings,
          watermarkSettings: defaultTpl.watermarkSettings,
          status: TemplateStatus.PUBLISHED,
          version: 1,
          isCustom: false,
          isEdited: false,
          payload: {
            id: key,
            name: defaultTpl.name,
            category: defaultTpl.category,
            description: defaultTpl.description,
            documentType: defaultTpl.documentType,
            pageSize: defaultTpl.pageSize,
            orientation: defaultTpl.orientation,
            margins: defaultTpl.margins,
            headerSettings: defaultTpl.headerSettings,
            footerSettings: defaultTpl.footerSettings,
            watermarkSettings: defaultTpl.watermarkSettings,
            variables: defaultTpl.variables,
            defaultData: defaultTpl.defaultData,
            bodyTemplate: defaultTpl.bodyTemplate,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const saved = await repo.save(record);
        if (!dbStore.documentDesignTemplates.some((d) => d.templateKey === key)) {
          dbStore.documentDesignTemplates.push(saved);
        }
      }
    }
  }

  async listDocumentTemplates() {
    await this.ensureDefaultDocumentTemplates();
    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(DocumentDesignTemplate);
      const rows = await repo.find({ order: { updatedAt: 'DESC' } });
      return rows.map((row) => this.serializeDocument(row));
    }
    return dbStore.documentDesignTemplates
      .slice()
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((row) => this.serializeDocument(row));
  }

  async getDocumentCatalog() {
    await this.ensureDefaultDocumentTemplates();
    const list = await this.listDocumentTemplates();
    return Object.values(DEFAULT_DOCUMENT_TEMPLATES).map((item) => {
      const dbTemplate = list.find((t) => t.id === item.key || t.templateKey === item.key);
      return {
        ...item,
        isCustom: Boolean(dbTemplate?.isCustom),
        isEdited: Boolean(dbTemplate?.isEdited),
        status: dbTemplate?.status || TemplateStatus.PUBLISHED,
      };
    });
  }

  async saveDocumentTemplate(template: any) {
    if (!template?.id && !template?.templateKey) {
      throw new BadRequestException('Template key or id is required');
    }

    const key = template.templateKey || template.id;

    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(DocumentDesignTemplate);
      let record = await repo.findOne({ where: { templateKey: key } });
      if (!record) {
        record = repo.create({
          id: uuidv4(),
          templateKey: key,
          createdAt: new Date(),
        });
      }

      record.templateKey = key;
      record.name = template.name || key;
      record.category = template.category || 'organizations';
      record.documentType = template.documentType || DocumentType.CUSTOM;
      record.pageSize = template.pageSize || PageSize.A4;
      record.orientation = template.orientation || PageOrientation.PORTRAIT;
      record.margins = template.margins || { top: 20, right: 20, bottom: 20, left: 20, unit: 'mm' };
      record.headerSettings = template.headerSettings;
      record.footerSettings = template.footerSettings;
      record.watermarkSettings = template.watermarkSettings;
      record.status = template.status || TemplateStatus.PUBLISHED;
      record.version = (record.version || 1) + 1;
      record.isCustom = Boolean(template.isCustom);
      record.isEdited = Boolean(template.isEdited);
      record.payload = {
        ...template,
        id: key,
        templateKey: key,
        updatedAt: new Date().toISOString(),
      };
      record.updatedAt = new Date();

      const saved = await repo.save(record);

      const memIdx = dbStore.documentDesignTemplates.findIndex((row) => row.templateKey === key);
      if (memIdx >= 0) {
        dbStore.documentDesignTemplates[memIdx] = saved;
      } else {
        dbStore.documentDesignTemplates.push(saved);
      }

      return this.serializeDocument(saved);
    }

    const existing = dbStore.documentDesignTemplates.find((row) => row.templateKey === key);
    const record = existing || ({
      id: uuidv4(),
      createdAt: new Date(),
    } as DocumentDesignTemplate);

    record.templateKey = key;
    record.name = template.name || key;
    record.category = template.category || 'organizations';
    record.documentType = template.documentType || DocumentType.CUSTOM;
    record.pageSize = template.pageSize || PageSize.A4;
    record.orientation = template.orientation || PageOrientation.PORTRAIT;
    record.margins = template.margins || { top: 20, right: 20, bottom: 20, left: 20, unit: 'mm' };
    record.headerSettings = template.headerSettings;
    record.footerSettings = template.footerSettings;
    record.watermarkSettings = template.watermarkSettings;
    record.status = template.status || TemplateStatus.DRAFT;
    record.version = (record.version || 1) + 1;
    record.isCustom = Boolean(template.isCustom);
    record.isEdited = Boolean(template.isEdited);
    record.payload = {
      ...template,
      id: key,
      templateKey: key,
      updatedAt: new Date().toISOString(),
    };
    record.updatedAt = new Date();

    if (!existing) {
      dbStore.documentDesignTemplates.push(record);
    }

    return this.serializeDocument(record);
  }

  async deleteDocumentTemplate(templateKey: string) {
    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(DocumentDesignTemplate);
      await repo.delete({ templateKey });
    }

    const index = dbStore.documentDesignTemplates.findIndex((row) => row.templateKey === templateKey);
    if (index >= 0) {
      dbStore.documentDesignTemplates.splice(index, 1);
    }
    return { success: true };
  }

  async renderDocument(payload: any) {
    const brandSettings = await this.getSettings();
    return this.documentRenderer.renderDocument({
      pageSize: payload.pageSize,
      orientation: payload.orientation,
      margins: payload.margins,
      headerHtml: payload.headerHtml || payload.headerSettings?.content,
      footerHtml: payload.footerHtml || payload.footerSettings?.content,
      watermark: payload.watermark || payload.watermarkSettings,
      bodyHtml: payload.bodyHtml || payload.bodyTemplate || '',
      data: payload.data || payload.defaultData || {},
      brandSettings,
      isTest: Boolean(payload.isTest),
    });
  }

  async generatePdfDocument(payload: any) {
    const brandSettings = this.getSettings();
    const docRecord = await this.pdfGenerator.generateAndRecordDocument({
      templateKey: payload.templateKey || payload.templateId || 'CUSTOM_DOCUMENT',
      templateVersionId: payload.templateVersionId,
      documentType: payload.documentType || DocumentType.CUSTOM,
      documentNumber: payload.documentNumber,
      referenceId: payload.referenceId,
      organizationId: payload.organizationId,
      recipientName: payload.recipientName,
      recipientEmail: payload.recipientEmail,
      renderOptions: {
        pageSize: payload.pageSize,
        orientation: payload.orientation,
        margins: payload.margins,
        headerHtml: payload.headerHtml || payload.headerSettings?.content,
        footerHtml: payload.footerHtml || payload.footerSettings?.content,
        watermark: payload.watermark || payload.watermarkSettings,
        bodyHtml: payload.bodyHtml || payload.bodyTemplate || '',
        data: payload.data || {},
        brandSettings,
        isTest: false,
      },
      isTest: false,
    });

    return docRecord;
  }

  async generateTestPdf(payload: any) {
    const brandSettings = this.getSettings();
    const docRecord = await this.pdfGenerator.generateAndRecordDocument({
      templateKey: payload.templateKey || payload.templateId || 'TEST_DOCUMENT',
      documentType: payload.documentType || DocumentType.CUSTOM,
      documentNumber: payload.documentNumber || 'TEST-0001',
      recipientName: payload.recipientName || 'Test Recipient',
      recipientEmail: payload.recipientEmail || 'test@partneriq.io',
      renderOptions: {
        pageSize: payload.pageSize,
        orientation: payload.orientation,
        margins: payload.margins,
        headerHtml: payload.headerHtml || payload.headerSettings?.content,
        footerHtml: payload.footerHtml || payload.footerSettings?.content,
        watermark: { enabled: true, text: 'TEST SAMPLE', opacity: 0.12, rotation: -35 },
        bodyHtml: payload.bodyHtml || payload.bodyTemplate || '',
        data: payload.data || payload.defaultData || {},
        brandSettings,
        isTest: true,
      },
      isTest: true,
    });

    return docRecord;
  }

  listGeneratedDocuments(query: {
    search?: string;
    documentType?: string;
    status?: string;
    organizationId?: string;
    page?: string;
    limit?: string;
  }) {
    return this.pdfGenerator.listGeneratedDocuments({
      search: query.search,
      documentType: query.documentType,
      status: query.status,
      organizationId: query.organizationId,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
  }

  getGeneratedDocument(id: string) {
    return this.pdfGenerator.getDocumentById(id);
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

  private serializeDocument(row: DocumentDesignTemplate) {
    return {
      ...row.payload,
      id: row.templateKey,
      templateKey: row.templateKey,
      name: row.name,
      category: row.category,
      documentType: row.documentType,
      pageSize: row.pageSize,
      orientation: row.orientation,
      margins: row.margins,
      headerSettings: row.headerSettings,
      footerSettings: row.footerSettings,
      watermarkSettings: row.watermarkSettings,
      status: row.status,
      version: row.version,
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

