import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import { EmailDesignSettings, EmailDesignTemplate } from '../../database/schema';

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

  async sendTestEmail(payload: any) {
    const toEmail = String(payload?.toEmail || '').trim();
    const subject = String(payload?.subject || '').trim();
    const html = String(payload?.html || '').trim();
    const plainText = String(payload?.plainText || '').trim();
    const templateId = payload?.templateId ? String(payload.templateId) : undefined;

    if (!this.isValidEmail(toEmail)) {
      throw new BadRequestException('A valid recipient email is required');
    }

    if (!subject) {
      throw new BadRequestException('Email subject is required');
    }

    if (!html) {
      throw new BadRequestException('Rendered email HTML is required');
    }

    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('BREVO_API_KEY is not configured on the backend');
    }

    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@partneriq.local';
    const senderName = process.env.BREVO_SENDER_NAME || 'PartnerIQ';

    let response: Response;
    try {
      response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { email: senderEmail, name: senderName },
          to: [{ email: toEmail }],
          subject,
          htmlContent: html,
          textContent: plainText || this.htmlToPlainText(html),
          tags: ['email-design-test', templateId].filter(Boolean),
        }),
      });
    } catch (error: any) {
      throw new BadGatewayException(`Brevo API is unreachable: ${error?.message || 'network request failed'}`);
    }

    const responseBody = await response.text().catch(() => '');
    const parsedBody = responseBody ? this.safeJsonParse(responseBody) : {};

    if (!response.ok) {
      const providerMessage =
        parsedBody?.message || parsedBody?.error || responseBody || `Brevo returned ${response.status}`;
      throw new BadGatewayException(`Brevo test email failed: ${providerMessage}`);
    }

    return {
      sent: true,
      provider: 'brevo',
      messageId: parsedBody?.messageId || parsedBody?.messageIds?.[0] || null,
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

  private isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private safeJsonParse(value: string) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private htmlToPlainText(html: string) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

export default EmailDesignService;
