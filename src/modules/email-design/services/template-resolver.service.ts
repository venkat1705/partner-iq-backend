import { Injectable, Logger } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { AppDataSource } from '../../../database/data-source';
import { EmailDesignTemplate } from '../../../database/schema';
import {
  SystemTemplateKey,
  SYSTEM_SECURITY_TEMPLATE_KEYS,
  SYSTEM_TEMPLATE_CATALOG,
  SystemTemplateMetadata,
} from '../constants/email-template-keys';
import { AUTH_EMAIL_TEMPLATES } from '../../../config/auth-email-templates.config';

// Explicit key -> template id aliases for SystemTemplateKeys whose natural
// prefix-stripped form doesn't match the id of the dedicated template meant
// for them (e.g. ORGANIZATION_MEMBER_INVITED strips to "member-invited",
// but the designed template for it is "org-invitation").
const TEMPLATE_KEY_ID_ALIASES: Record<string, string> = {
  ORGANIZATION_MEMBER_INVITED: 'org-invitation',
};

export interface ResolvedTemplate {
  templateKey: string;
  source: 'SYSTEM_SECURITY' | 'ORGANIZATION_OVERRIDE' | 'PLATFORM_DEFAULT' | 'CODE_REGISTRY_FALLBACK' | 'CUSTOM_TEMPLATE';
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

    const matchDbTemplate = async (tKey: string) => {
      const target = (tKey || '').toLowerCase();
      const kebabTarget = target.replace(/_/g, '-');
      const snakeTarget = target.replace(/-/g, '_');
      const strippedTarget = kebabTarget.replace(/^(security|affiliate|organization|billing)-/, '');
      const aliasTarget = TEMPLATE_KEY_ID_ALIASES[(tKey || '').toUpperCase()];

      if (aliasTarget) {
        const aliasMatch = dbStore.emailDesignTemplates.find(
          (t) => t.templateId && t.templateId.toLowerCase() === aliasTarget,
        );
        if (aliasMatch) return aliasMatch;
      }

      // Check in-memory store — prefer an exact (unstripped) id match over the
      // looser prefix-stripped fallback, so a dedicated template (e.g. 'affiliate-welcome')
      // always wins over an unrelated generic template that happens to share the
      // stripped name (e.g. 'welcome').
      const exactMatch = dbStore.emailDesignTemplates.find((t) => {
        if (!t.templateId) return false;
        const dbId = t.templateId.toLowerCase();
        return dbId === target || dbId === kebabTarget || dbId === snakeTarget;
      });
      if (exactMatch) return exactMatch;

      const strippedMatch = dbStore.emailDesignTemplates.find((t) => {
        if (!t.templateId) return false;
        return t.templateId.toLowerCase() === strippedTarget;
      });
      if (strippedMatch) return strippedMatch;

      // Check PostgreSQL repository
      if (AppDataSource.isInitialized) {
        try {
          const repo = AppDataSource.getRepository(EmailDesignTemplate);
          const row = await repo.findOne({ where: { templateId: tKey } });
          if (row) {
            return {
              templateId: row.templateId,
              name: row.name,
              category: row.category,
              payload: row.payload,
            };
          }
        } catch {
          // ignore
        }
      }
      return undefined;
    };

    const extractBodyFromRenderBody = (tmpl: any) => {
      let bodyTemplate = tmpl?.payload?.bodyTemplate;
      if (!bodyTemplate && typeof tmpl?.payload?.renderBody === 'function') {
        try {
          bodyTemplate = tmpl.payload.renderBody({
            firstName: '{{user.firstName}}',
            name: '{{user.firstName}}',
            userName: '{{user.firstName}}',
            affiliateName: '{{affiliate.firstName}}',
            partnerName: '{{affiliate.firstName}}',
            organizationName: '{{organization.name}}',
            programName: '{{program.name}}',
            commissionLabel: '{{commission.amountFormatted}}',
            commissionAmount: '{{commission.amountFormatted}}',
            payoutAmount: '{{payout.amountFormatted}}',
            resetUrl: '{{links.resetPasswordUrl}}',
            resetPasswordUrl: '{{links.resetPasswordUrl}}',
            actionUrl: '{{links.resetPasswordUrl}}',
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
    // Mirrors email-design's escapeHtml() — the same function template authors call on
    // every interpolated value (e.g. renderDetailCard). Sample defaultData baked into the
    // seeded bodyTemplate at seed time is escaped, so restoring {{placeholders}} by searching
    // for the RAW default value only works when it contains no HTML-special characters
    // (e.g. "Sarah Jenkins" matches, but "Creator & Agency Partner Program" never does,
    // because the baked HTML actually contains "Creator &amp; Agency Partner Program").
    const escapeHtmlLike = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    const restorePlaceholdersFromDefaultData = (bodyTemplate: string, defaultData?: Record<string, any>) => {
      if (!bodyTemplate || !defaultData) return bodyTemplate;

      return Object.entries(defaultData).reduce((html, [key, value]) => {
        if (typeof value !== 'string' || value.length < 2) return html;
        html = html.replace(new RegExp(escapeRegExp(value), 'g'), `{{${key}}}`);
        const escaped = escapeHtmlLike(value);
        if (escaped !== value) {
          html = html.replace(new RegExp(escapeRegExp(escaped), 'g'), `{{${key}}}`);
        }
        return html;
      }, bodyTemplate);
    };

    // Check if mapping to single-source auth template (e.g. custom-template-mtp9u865 for PASSWORD_RESET)
    const customAuthTemplateKey =
      templateKey === SystemTemplateKey.SECURITY_PASSWORD_RESET || templateKey === 'PASSWORD_RESET' || templateKey === AUTH_EMAIL_TEMPLATES.PASSWORD_RESET
        ? AUTH_EMAIL_TEMPLATES.PASSWORD_RESET
        : templateKey;

    const isPasswordResetTemplate =
      customAuthTemplateKey === AUTH_EMAIL_TEMPLATES.PASSWORD_RESET ||
      templateKey === SystemTemplateKey.SECURITY_PASSWORD_RESET ||
      templateKey === 'PASSWORD_RESET' ||
      templateKey === 'custom-template-mtp9u865';

    const matchedCustomTemplate = await matchDbTemplate(customAuthTemplateKey);
    if (matchedCustomTemplate && matchedCustomTemplate.payload) {
      let bodyTemplate = extractBodyFromRenderBody(matchedCustomTemplate);
      bodyTemplate = restorePlaceholdersFromDefaultData(bodyTemplate, matchedCustomTemplate.payload.defaultData);

      return {
        templateKey: customAuthTemplateKey,
        source: 'CUSTOM_TEMPLATE',
        subject: matchedCustomTemplate.payload.defaultSubject || matchedCustomTemplate.name || 'Reset your PartnerIQ password',
        preheader: matchedCustomTemplate.payload.defaultPreheader || 'Click the secure link below to choose a new password.',
        bodyTemplate: bodyTemplate || matchedCustomTemplate.payload.bodyTemplate || '',
        variablesSchema: matchedCustomTemplate.payload.variables,
      };
    }

    // Default template for Password Reset (custom-template-mtp9u865)
    if (isPasswordResetTemplate) {
      const defaultPasswordResetBody = `
<!-- Forgot Password Content -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
  <tr>
    <td style="padding: 10px 0;">
      <h1 style="font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:24px;font-weight:800;color:#0F172A;margin:0 0 16px 0;letter-spacing:-0.5px;line-height:1.3;">
        Reset your password
      </h1>
      <p style="font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.6;color:#334155;margin:0 0 16px 0;">
        Hi {{userName}},
      </p>
      <p style="font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.6;color:#334155;margin:0 0 24px 0;">
        We received a request to reset the password for your PartnerIQ account. Click the button below to choose a new secure password:
      </p>
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;">
        <tr>
          <td align="center" style="border-radius: 8px; background-color: #2563EB;">
            <a href="{{resetPasswordUrl}}" target="_blank" style="font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;padding:14px 28px;display:inline-block;border-radius:8px;background-color:#2563EB;letter-spacing:0.2px;">
              Reset Password &rarr;
            </a>
          </td>
        </tr>
      </table>
      <p style="font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:13px;line-height:1.6;color:#64748B;margin:0 0 16px 0;">
        This password reset link is valid for <strong>60 minutes</strong>. If you did not make this request, you can safely ignore this email &mdash; your account remains secure.
      </p>
      <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 24px 0;" />
      <p style="font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:12px;line-height:1.5;color:#94A3B8;margin:0;">
        If you're having trouble clicking the button, copy and paste this URL into your browser:<br />
        <a href="{{resetPasswordUrl}}" style="color: #2563EB; word-break: break-all;">{{resetPasswordUrl}}</a>
      </p>
    </td>
  </tr>
</table>`;

      return {
        templateKey: customAuthTemplateKey,
        source: 'CUSTOM_TEMPLATE',
        subject: 'Reset your PartnerIQ password',
        preheader: 'Click the secure link below to choose a new password.',
        bodyTemplate: defaultPasswordResetBody,
        variablesSchema: [
          { key: 'userName', required: true, type: 'string', description: 'User first name' },
          { key: 'resetPasswordUrl', required: true, type: 'url', description: 'Password reset link' },
        ],
      };
    }

    // 1. SECURITY TEMPLATES (System Controlled — Org Overrides Prohibited)
    if (isSecurityTemplate) {
      const catalogItem = SYSTEM_TEMPLATE_CATALOG[templateKey as SystemTemplateKey];
      const dbDesignTemplate = await matchDbTemplate(templateKey);

      let bodyTemplate = extractBodyFromRenderBody(dbDesignTemplate);
      if (!bodyTemplate) {
        const isEmailOtpTemplate =
          templateKey === SystemTemplateKey.SECURITY_EMAIL_VERIFICATION ||
          templateKey === 'EMAIL_VERIFICATION' ||
          templateKey === AUTH_EMAIL_TEMPLATES.EMAIL_VERIFICATION;

        if (isEmailOtpTemplate) {
          bodyTemplate = `
<h1 style="font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:22px;font-weight:800;color:#0F172A;margin:0 0 16px 0;letter-spacing:-0.5px;">Verify your email</h1>
<p style="font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.6;color:#334155;margin:0 0 24px 0;">Hi {{user.firstName}}, use the code below to verify your email address and finish setting up your PartnerIQ account:</p>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:8px 0 20px 0;">
  <span style="display:inline-block;padding:16px 28px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;font-family:'JetBrains Mono',Consolas,Monaco,'Courier New',Courier,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#0F172A;">{{security.otpCode}}</span>
</td></tr></table>
<p style="font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:13px;line-height:1.6;color:#64748B;text-align:center;margin:0 0 20px 0;">This code expires in <strong>{{security.expiryMinutes}} minutes</strong>.</p>
<hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0;"/>
<p style="font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:12px;line-height:1.5;color:#94A3B8;margin:0;">If you didn't request this code, you can safely ignore this email — your account remains secure.</p>`;
        } else {
          bodyTemplate = `<h2>Security Notice</h2><p>Hi {{user.firstName}},</p><p>${catalogItem?.description || 'Please complete your requested action.'}</p><p style="margin-top:20px;"><a href="{{links.resetPasswordUrl}}" class="btn">Continue Secure Action →</a></p>`;
        }
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
    const platformTemplate = await matchDbTemplate(templateKey);

    const catalogItem = SYSTEM_TEMPLATE_CATALOG[templateKey as SystemTemplateKey];
    const fontFamily = "'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
    const defaultBodyText = `
<h1 style="font-family:${fontFamily};font-size:22px;font-weight:800;color:#0F172A;margin:0 0 16px 0;letter-spacing:-0.5px;">${catalogItem?.name || 'Update from PartnerIQ'}</h1>
<p style="font-family:${fontFamily};font-size:15px;line-height:1.6;color:#334155;margin:0 0 16px 0;">Hi {{affiliate.firstName}}{{user.firstName}},</p>
<p style="font-family:${fontFamily};font-size:15px;line-height:1.6;color:#334155;margin:0 0 24px 0;">${catalogItem?.description || 'You have a new update from {{organization.name}}.'}</p>
<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td align="center" style="border-radius:8px;background-color:#2563EB;">
  <a href="{{links.dashboardUrl}}" target="_blank" style="font-family:${fontFamily};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;padding:12px 24px;display:inline-block;border-radius:8px;background-color:#2563EB;">View in Dashboard &rarr;</a>
</td></tr></table>`;

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
