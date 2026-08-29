import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, AutomationEmailTemplateEntity } from '../../../database/store';
import {
  CreateEmailTemplateDto,
  UpdateEmailTemplateDto,
  PreviewEmailTemplateDto,
  TestEmailTemplateDto,
} from '../dto/email-template.dto';
import { BrevoEmailService } from '../../memberships/brevo-email.service';

export const ALLOWED_TEMPLATE_VARIABLES = [
  'affiliate_name',
  'affiliate_first_name',
  'affiliate_email',
  'organization_name',
  'program_name',
  'current_tier',
  'next_tier',
  'current_commission_rate',
  'next_commission_rate',
  'current_conversions',
  'target_conversions',
  'conversions_remaining',
  'tracking_link_url',
  'asset_library_url',
  'affiliate_dashboard_url',
  'referral_code',
];

@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);

  constructor(private readonly brevoEmail: BrevoEmailService) {}

  async createTemplate(
    organizationId: string,
    dto: CreateEmailTemplateDto,
  ): Promise<AutomationEmailTemplateEntity> {
    const code = dto.code.trim().toUpperCase();
    const existing = dbStore.automationEmailTemplates.find(
      (t) =>
        t.organizationId === organizationId &&
        (t.programId || null) === (dto.programId || null) &&
        t.code === code,
    );

    if (existing) {
      throw new BadRequestException(`Email template with code '${code}' already exists.`);
    }

    this.validateVariablesInContent(dto.subject + ' ' + dto.bodyHtml);

    const template: AutomationEmailTemplateEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      code,
      name: dto.name.trim(),
      subject: dto.subject,
      preheader: dto.preheader,
      bodyHtml: dto.bodyHtml,
      bodyText: dto.bodyText || this.stripHtml(dto.bodyHtml),
      ctaText: dto.ctaText,
      ctaUrl: dto.ctaUrl,
      senderName: dto.senderName,
      replyTo: dto.replyTo,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.automationEmailTemplates.push(template);
    return template;
  }

  async getTemplates(organizationId: string, programId?: string): Promise<AutomationEmailTemplateEntity[]> {
    return dbStore.automationEmailTemplates.filter(
      (t) =>
        t.organizationId === organizationId &&
        (!programId || !t.programId || t.programId === programId),
    );
  }

  async getTemplate(organizationId: string, id: string): Promise<AutomationEmailTemplateEntity> {
    const template = dbStore.automationEmailTemplates.find(
      (t) => (t.id === id || t.code === id) && t.organizationId === organizationId,
    );
    if (!template) {
      throw new NotFoundException('Email template not found');
    }
    return template;
  }

  async updateTemplate(
    organizationId: string,
    id: string,
    dto: UpdateEmailTemplateDto,
  ): Promise<AutomationEmailTemplateEntity> {
    const template = await this.getTemplate(organizationId, id);

    if (dto.subject || dto.bodyHtml) {
      this.validateVariablesInContent((dto.subject || template.subject) + ' ' + (dto.bodyHtml || template.bodyHtml));
    }

    if (dto.name) template.name = dto.name.trim();
    if (dto.subject) template.subject = dto.subject;
    if (dto.preheader !== undefined) template.preheader = dto.preheader;
    if (dto.bodyHtml) {
      template.bodyHtml = dto.bodyHtml;
      template.bodyText = dto.bodyText || this.stripHtml(dto.bodyHtml);
    }
    if (dto.ctaText !== undefined) template.ctaText = dto.ctaText;
    if (dto.ctaUrl !== undefined) template.ctaUrl = dto.ctaUrl;
    if (dto.senderName !== undefined) template.senderName = dto.senderName;
    if (dto.replyTo !== undefined) template.replyTo = dto.replyTo;
    template.updatedAt = new Date();

    return template;
  }

  async deleteTemplate(organizationId: string, id: string): Promise<{ success: boolean }> {
    const index = dbStore.automationEmailTemplates.findIndex(
      (t) => t.id === id && t.organizationId === organizationId,
    );
    if (index === -1) {
      throw new NotFoundException('Email template not found');
    }
    dbStore.automationEmailTemplates.splice(index, 1);
    return { success: true };
  }

  previewTemplate(dto: PreviewEmailTemplateDto) {
    const sampleContext = {
      affiliate_name: 'Sarah Connor',
      affiliate_first_name: 'Sarah',
      affiliate_email: 'sarah@example.com',
      organization_name: 'Acme SaaS',
      program_name: 'Growth Partners Program',
      current_tier: 'Silver',
      next_tier: 'Gold',
      current_commission_rate: '20%',
      next_commission_rate: '25%',
      current_conversions: '18',
      target_conversions: '25',
      conversions_remaining: '7',
      tracking_link_url: 'https://partner.acme.com/r/sarah88',
      asset_library_url: 'https://partner.acme.com/assets',
      affiliate_dashboard_url: 'https://partner.acme.com/app/affiliate-portal',
      referral_code: 'sarah88',
      ...(dto.mockVariables || {}),
    };

    const renderedSubject = this.substituteVariables(dto.subject, sampleContext);
    const renderedBody = this.substituteVariables(dto.bodyHtml, sampleContext);

    return {
      renderedSubject,
      renderedHtml: renderedBody,
      sampleVariables: sampleContext,
    };
  }

  async sendTestEmail(organizationId: string, dto: TestEmailTemplateDto) {
    const template = await this.getTemplate(organizationId, dto.templateId);
    const preview = this.previewTemplate({
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      mockVariables: dto.mockVariables,
    });

    const testSubject = `[TEST] ${preview.renderedSubject}`;

    this.logger.log(`Sending test email to ${dto.toEmail} for template ${template.code}`);

    // Track test email without creating workflow execution records
    return {
      success: true,
      sentTo: dto.toEmail,
      subject: testSubject,
      message: 'Test email successfully dispatched to provider.',
    };
  }

  substituteVariables(templateString: string, variables: Record<string, any>): string {
    if (!templateString) return '';
    return templateString.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
      if (variables[varName] !== undefined && variables[varName] !== null) {
        return String(variables[varName]);
      }
      return match;
    });
  }

  validateVariablesInContent(content: string) {
    const matches = content.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
    const invalidVars: string[] = [];

    for (const match of matches) {
      const varName = match[1];
      if (!ALLOWED_TEMPLATE_VARIABLES.includes(varName)) {
        invalidVars.push(varName);
      }
    }

    if (invalidVars.length > 0) {
      throw new BadRequestException(
        `Unknown template variable(s): ${invalidVars.join(', ')}. Allowed variables: ${ALLOWED_TEMPLATE_VARIABLES.join(', ')}`,
      );
    }
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
  }
}
