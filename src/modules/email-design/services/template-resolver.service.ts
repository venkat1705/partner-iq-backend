import { Injectable, Logger } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import {
  SystemTemplateKey,
  SYSTEM_SECURITY_TEMPLATE_KEYS,
  SYSTEM_TEMPLATE_CATALOG,
  SystemTemplateMetadata,
} from '../constants/email-template-keys';

export interface ResolvedTemplate {
  templateKey: string;
  source: 'SYSTEM_SECURITY' | 'ORGANIZATION_OVERRIDE' | 'PLATFORM_DEFAULT' | 'CODE_REGISTRY_FALLBACK';
  versionId?: string;
  subject: string;
  preheader?: string;
  bodyTemplate: string;
  variablesSchema?: any;
  securityNotice?: string;
}

@Injectable()
export class TemplateResolverService {
  private readonly logger = new Logger(TemplateResolverService.name);

  async resolveTemplate(
    templateKey: string,
    organizationId?: string,
  ): Promise<ResolvedTemplate> {
    const isSecurityTemplate = SYSTEM_SECURITY_TEMPLATE_KEYS.includes(templateKey as SystemTemplateKey);

    const matchDbTemplate = (tKey: string) => {
      const target = (tKey || '').toLowerCase();
      const kebabTarget = target.replace(/_/g, '-');
      const snakeTarget = target.replace(/-/g, '_');
      const strippedTarget = kebabTarget.replace(/^(security|affiliate|organization|billing)-/, '');
      return dbStore.emailDesignTemplates.find((t) => {
        if (!t.templateId) return false;
        const dbId = t.templateId.toLowerCase();
        return (
          dbId === target ||
          dbId === kebabTarget ||
          dbId === snakeTarget ||
          dbId === strippedTarget
        );
      });
    };

    const extractBodyFromRenderBody = (tmpl: any) => {
      let bodyTemplate = tmpl?.payload?.bodyTemplate;
      if (!bodyTemplate && typeof tmpl?.payload?.renderBody === 'function') {
        try {
          bodyTemplate = tmpl.payload.renderBody({
            firstName: '{{user.firstName}}',
            affiliateName: '{{affiliate.firstName}}',
            partnerName: '{{affiliate.firstName}}',
            organizationName: '{{organization.name}}',
            programName: '{{program.name}}',
            commissionLabel: '{{commission.amountFormatted}}',
            commissionAmount: '{{commission.amountFormatted}}',
            payoutAmount: '{{payout.amountFormatted}}',
            resetUrl: '{{links.resetPasswordUrl}}',
            verificationUrl: '{{links.verificationUrl}}',
            dashboardUrl: '{{links.dashboardUrl}}',
            email: '{{recipientEmail}}',
          });
        } catch {
          bodyTemplate = undefined;
        }
      }
      return bodyTemplate;
    };

    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const restorePlaceholdersFromDefaultData = (bodyTemplate: string, defaultData?: Record<string, any>) => {
      if (!bodyTemplate || !defaultData) return bodyTemplate;

      return Object.entries(defaultData).reduce((html, [key, value]) => {
        if (typeof value !== 'string' || value.length < 2) return html;
        return html.replace(new RegExp(escapeRegExp(value), 'g'), `{{${key}}}`);
      }, bodyTemplate);
    };

    // 1. SECURITY TEMPLATES (System Controlled — Org Overrides Prohibited)
    if (isSecurityTemplate) {
      const catalogItem = SYSTEM_TEMPLATE_CATALOG[templateKey as SystemTemplateKey];
      const dbDesignTemplate = matchDbTemplate(templateKey);

      let bodyTemplate = extractBodyFromRenderBody(dbDesignTemplate);
      if (!bodyTemplate) {
        bodyTemplate = `<h2>Security Notice</h2><p>Hi {{user.firstName}},</p><p>${catalogItem?.description || 'Please complete your requested action.'}</p><p style="margin-top:20px;"><a href="{{links.resetPasswordUrl}}" class="btn">Continue Secure Action →</a></p>`;
      }

      return {
        templateKey,
        source: 'SYSTEM_SECURITY',
        subject: catalogItem?.defaultSubject || dbDesignTemplate?.payload?.defaultSubject || 'Security Alert',
        preheader: catalogItem?.defaultPreheader || dbDesignTemplate?.payload?.defaultPreheader,
        bodyTemplate,
        variablesSchema: catalogItem?.variablesSchema,
      };
    }

    // 2. ORGANIZATION PUBLISHED OVERRIDE (if organizationId provided)
    if (organizationId) {
      const override = dbStore.emailTemplateOverrides.find(
        (o) => o.organizationId === organizationId && o.templateKey === templateKey && o.status === 'PUBLISHED',
      );

      if (override && (override.customSubject || override.customBody)) {
        this.logger.debug(`Resolved organization override for template [${templateKey}] org [${organizationId}]`);
        return {
          templateKey,
          source: 'ORGANIZATION_OVERRIDE',
          subject: override.customSubject || '',
          preheader: override.customPreheader,
          bodyTemplate: override.customBody || '',
        };
      }
    }

    // 3. PLATFORM PUBLISHED DEFAULT (Database Template)
    const platformTemplate = matchDbTemplate(templateKey);

    const catalogItem = SYSTEM_TEMPLATE_CATALOG[templateKey as SystemTemplateKey];
    const defaultBodyText = `<p>Hi {{affiliate.firstName}}{{user.firstName}},</p><p>${catalogItem?.description || 'You have a new update from ' + '{{organization.name}}'}.</p><p style="margin-top:16px;"><a href="{{links.dashboardUrl}}" class="btn">View Details →</a></p>`;

    let platformBody = extractBodyFromRenderBody(platformTemplate) || defaultBodyText;
    platformBody = restorePlaceholdersFromDefaultData(platformBody, platformTemplate?.payload?.defaultData);
    if (platformBody) {
      platformBody = platformBody
        .replace(/David Miller/g, '{{affiliate.firstName}}')
        .replace(/Devon/g, '{{user.firstName}}');
    }

    if (platformTemplate && platformTemplate.payload) {
      return {
        templateKey,
        source: 'PLATFORM_DEFAULT',
        subject: platformTemplate.payload.defaultSubject || platformTemplate.name,
        preheader: platformTemplate.payload.defaultPreheader,
        bodyTemplate: platformBody,
        variablesSchema: platformTemplate.payload.variables,
      };
    }

    // 4. FALLBACK TO SYSTEM CATALOG OR CODE REGISTRY
    if (catalogItem) {
      return {
        templateKey,
        source: 'CODE_REGISTRY_FALLBACK',
        subject: catalogItem.defaultSubject,
        preheader: catalogItem.defaultPreheader,
        bodyTemplate: defaultBodyText,
        variablesSchema: catalogItem.variablesSchema,
      };
    }

    // Fallback default
    return {
      templateKey,
      source: 'CODE_REGISTRY_FALLBACK',
      subject: `Notification from PartnerIQ`,
      bodyTemplate: `<p>{{message}}</p>`,
    };
  }
}
