import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { ResolvedTemplate } from './template-resolver.service';
import { SYSTEM_TEMPLATE_CATALOG, SystemTemplateKey } from '../constants/email-template-keys';

export interface RenderOptions {
  template: ResolvedTemplate;
  payload: Record<string, any>;
  organizationId?: string;
  recipientEmail?: string;
}

export interface RenderedEmailResult {
  subject: string;
  preheader: string;
  html: string;
  plainText: string;
  senderName: string;
  senderEmail: string;
  replyTo?: string;
}

const DEFAULT_BRAND = {
  name: 'PartnerIQ',
  tagline: 'Partner & Affiliate Management Platform',
  signature: 'Built for better partnerships.',
  logoUrl: 'https://res.cloudinary.com/bunny1705/image/upload/v1787584202/partneriq/92977d80-3e51-4a12-a382-64b42fb5466a/organization-logo/rrhwttefwtgrxico2rtv.png',
  primaryColor: '#2563EB',
  supportEmail: 'info@partneriq.in',
  companyLegal: 'PartnerIQ',
  websiteUrl: 'https://partneriq.in',
  docsUrl: 'https://docs.partneriq.in',
  helpCenterUrl: 'https://help.partneriq.in',
  privacyUrl: 'https://partneriq.in/privacy',
  termsUrl: 'https://partneriq.in/terms',
  physicalAddress: '548 Market St, Suite 39201, San Francisco, CA 94104',
};

@Injectable()
export class TemplateRendererService {
  private readonly logger = new Logger(TemplateRendererService.name);

  escapeHtml(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val !== 'string') return String(val);
    return val
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  interpolate(str: string, data: Record<string, any>, escapeValues = true): string {
    if (!str) return '';
    const safeData = data || {};

    return str.replace(/\{\{\{?\s*([a-zA-Z0-9_.$:-]+)(?:\s*\|[^{}]+)?\s*\}?\}\}/g, (_, rawKey) => {
      const key = rawKey?.trim();
      if (!key || key.startsWith('#') || key.startsWith('/') || key.startsWith('^') || key.startsWith('!') || key.startsWith('>')) {
        return '';
      }

      if (key in safeData && safeData[key] !== undefined && safeData[key] !== null) {
        const val = String(safeData[key]);
        return escapeValues ? this.escapeHtml(val) : val;
      }

      const parts = key.split('.');
      let current: any = safeData;
      for (const p of parts) {
        if (current && typeof current === 'object' && p in current) {
          current = current[p];
        } else {
          current = undefined;
          break;
        }
      }

      if (current !== undefined && current !== null) {
        const val = String(current);
        return escapeValues ? this.escapeHtml(val) : val;
      }

      const lastPart = parts[parts.length - 1];
      if (lastPart in safeData && safeData[lastPart] !== undefined && safeData[lastPart] !== null) {
        const val = String(safeData[lastPart]);
        return escapeValues ? this.escapeHtml(val) : val;
      }

      // Case-insensitive fallback
      const normalizedTarget = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [k, v] of Object.entries(safeData)) {
        if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedTarget && v !== undefined && v !== null) {
          const val = String(v);
          return escapeValues ? this.escapeHtml(val) : val;
        }
      }

      return '';
    });
  }

  validatePayload(templateKey: string, payload: Record<string, any>): void {
    const catalogItem = SYSTEM_TEMPLATE_CATALOG[templateKey as SystemTemplateKey];
    if (!catalogItem || !catalogItem.requiredVariables) return;

    const missing: string[] = [];
    for (const varKey of catalogItem.requiredVariables) {
      const parts = varKey.split('.');
      let cur = payload;
      let exists = true;
      for (const p of parts) {
        if (cur && typeof cur === 'object' && p in cur && cur[p] !== undefined && cur[p] !== null) {
          cur = cur[p];
        } else if (p in payload && payload[p] !== undefined && payload[p] !== null) {
          cur = payload[p];
        } else if (varKey === 'organization.name' && (payload.organizationName || payload.organization?.name)) {
          cur = payload.organizationName || payload.organization?.name;
          exists = true;
        } else if (varKey === 'affiliate.firstName' && (payload.affiliateName || payload.partnerName || payload.firstName)) {
          cur = payload.affiliateName || payload.partnerName || payload.firstName;
          exists = true;
        } else if (varKey === 'user.firstName' && (payload.user?.firstName || payload.firstName || payload.userName)) {
          cur = payload.user?.firstName || payload.firstName || payload.userName;
          exists = true;
        } else if (varKey === 'security.deviceName') {
          if (!payload.security) payload.security = {};
          payload.security.deviceName = payload.security.deviceName || payload.deviceName || 'Web Browser / Workstation';
          cur = payload.security.deviceName;
          exists = true;
        } else if (varKey === 'security.location') {
          if (!payload.security) payload.security = {};
          payload.security.location = payload.security.location || payload.location || 'Current Network Location';
          cur = payload.security.location;
          exists = true;
        } else if (varKey === 'security.ipAddress') {
          if (!payload.security) payload.security = {};
          payload.security.ipAddress = payload.security.ipAddress || payload.ipAddress || 'Authorized Network IP';
          cur = payload.security.ipAddress;
          exists = true;
        } else if (varKey === 'security.timestamp') {
          if (!payload.security) payload.security = {};
          payload.security.timestamp = payload.security.timestamp || new Date().toLocaleString();
          cur = payload.security.timestamp;
          exists = true;
        } else {
          exists = false;
          break;
        }
      }
      if (!exists) missing.push(varKey);
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        `Email rendering payload validation failed for [${templateKey}]. Missing required variables: ${missing.join(', ')}`,
      );
    }
  }

  getBranding(organizationId?: string) {
    let brand = { ...DEFAULT_BRAND };

    const settings = dbStore.emailDesignSettings.find((s) => s.settingsKey === 'default');
    if (settings?.payload) {
      brand = { ...brand, ...settings.payload };
    }

    if (organizationId) {
      const org = dbStore.organizations.find((o) => o.id === organizationId);
      if (org) {
        if (org.name) brand.name = org.name;
        const organizationLogoUrl = (org as any).logoUrl;
        if (organizationLogoUrl) brand.logoUrl = organizationLogoUrl;
      }
    }

    return brand;
  }

  render(options: RenderOptions): RenderedEmailResult {
    const { template, payload, organizationId, recipientEmail } = options;
    this.validatePayload(template.templateKey, payload);

    const brand = this.getBranding(organizationId);
    const appBaseUrl = process.env.FRONTEND_URL || 'https://affiliate.partneriq.in';
    const mergedData = {
      ...payload,
      partnerName: payload.partnerName || payload.affiliateName || payload.affiliate?.fullName || payload.affiliate?.firstName || '',
      affiliateName: payload.affiliateName || payload.partnerName || payload.affiliate?.fullName || payload.affiliate?.firstName || '',
      firstName: payload.firstName || payload.user?.firstName || payload.affiliate?.firstName || '',
      lastName: payload.lastName || payload.user?.lastName || payload.affiliate?.lastName || '',
      organizationName: payload.organizationName || payload.organization?.name || brand.name,
      organization: {
        name: brand.name,
        logoUrl: brand.logoUrl,
        supportEmail: brand.supportEmail,
        websiteUrl: brand.websiteUrl,
        ...(payload.organization || {}),
      },
      links: {
        dashboardUrl: `${appBaseUrl}/dashboard`,
        loginUrl: `${appBaseUrl}/login`,
        ...(payload.links || {}),
      },
      recipientEmail: recipientEmail || payload.recipientEmail || payload.email || '',
    };

    const subject = this.interpolate(payload.subject || template.subject, mergedData, false);
    const preheader = this.interpolate(payload.preheader || template.preheader || '', mergedData, false);
    const rawBody = payload.html || payload.bodyHtml || payload.htmlContent || payload.customBody || payload.content || template.bodyTemplate;
    const bodyHtml = this.interpolate(rawBody, mergedData, true);
    const fullHtml = this.wrapInLayout(bodyHtml, subject, preheader, brand, mergedData.recipientEmail, template.templateKey);

    return {
      subject,
      preheader,
      html: fullHtml,
      plainText: this.htmlToPlainText(fullHtml),
      senderName: `${brand.name} via PartnerIQ`,
      senderEmail: process.env.BREVO_SENDER_EMAIL || 'no-reply@partneriq.local',
      replyTo: brand.supportEmail,
    };
  }

  private wrapInLayout(
    bodyContent: string,
    subject: string,
    preheader: string,
    brand: any,
    recipientEmail: string,
    templateKey: string,
  ): string {
    const currentYear = new Date().getFullYear();
    const category = SYSTEM_TEMPLATE_CATALOG[templateKey as SystemTemplateKey]?.category;
    const categoryBadge = category ? `${category}${category === 'AFFILIATE' ? 'S' : ''}` : '';
    const preheaderBuffer = '&zwnj;&nbsp;'.repeat(90);
    const fontFamily = "'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    const websiteUrl = brand.websiteUrl || DEFAULT_BRAND.websiteUrl;
    const logoUrl = brand.logoUrl || DEFAULT_BRAND.logoUrl;

    return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="format-detection" content="telephone=no, address=no, email=no, date=no, url=no" />
  <title>${this.escapeHtml(subject)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style type="text/css">
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap');
    body, table, td, a, p, h1, h2, h3, span, div, li { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; font-family: ${fontFamily}; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    table { border-collapse: collapse !important; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #F8FAFC; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
    @media screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-card { padding: 24px 20px 24px 20px !important; border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; }
      .email-button { width: 100% !important; display: block !important; text-align: center !important; }
      .stat-card { padding: 10px 12px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; min-width: 100%;">
  <div style="display: none; font-size: 1px; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all; font-family: sans-serif;">
    ${this.escapeHtml(preheader)}
    ${preheaderBuffer}
  </div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F8FAFC; table-layout: fixed;">
    <tr>
      <td align="center" style="padding: 32px 16px 40px 16px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="email-container" style="max-width: 620px; margin: 0 auto; text-align: left;">
          <tr>
            <td class="email-card" style="background-color: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 36px 36px 36px 36px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 32px; border-bottom: 1px solid #E2E8F0; padding-bottom: 24px;">
                <tr>
                  <td align="left" valign="middle" style="text-align: left;">
                    <a href="${this.escapeHtml(websiteUrl)}" target="_blank" style="text-decoration: none; display: inline-block;">
                      <img src="${this.escapeHtml(logoUrl)}" alt="${this.escapeHtml(brand.name)}" height="84" style="display: block; height: 84px; max-height: 84px; width: auto; max-width: 360px; border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic;" />
                    </a>
                  </td>
                  ${categoryBadge ? `<td align="right" valign="middle" style="text-align: right; padding-left: 20px;"><span style="font-family: ${fontFamily}; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; background-color: #EFF6FF; color: #1D4ED8; padding: 5px 12px; border-radius: 9999px; border: 1px solid #BFDBFE; display: inline-block; white-space: nowrap; line-height: 1;">${this.escapeHtml(categoryBadge)}</span></td>` : ''}
                </tr>
              </table>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr><td>${bodyContent}</td></tr>
              </table>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 36px; border-top: 1px solid #E2E8F0; padding-top: 24px;">
                <tr>
                  <td align="left" style="padding-bottom: 14px;">
                    <a href="${this.escapeHtml(websiteUrl)}" target="_blank" style="text-decoration: none; display: inline-block;">
                      <img src="${this.escapeHtml(logoUrl)}" alt="${this.escapeHtml(brand.name)}" height="54" style="display: block; height: 54px; max-height: 54px; width: auto; max-width: 260px; border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic;" />
                    </a>
                  </td>
                </tr>
                <tr><td align="left" style="font-family: ${fontFamily}; font-size: 12px; color: #64748B; padding-bottom: 16px; line-height: 1.5;">${this.escapeHtml(brand.tagline || DEFAULT_BRAND.tagline)} &bull; <em>${this.escapeHtml(brand.signature || DEFAULT_BRAND.signature)}</em></td></tr>
                <tr><td align="left" style="font-family: ${fontFamily}; font-size: 12px; color: #64748B; padding-bottom: 14px; line-height: 1.6;"><a href="${this.escapeHtml(brand.helpCenterUrl || DEFAULT_BRAND.helpCenterUrl)}" target="_blank" style="color: #334155; text-decoration: underline; margin-right: 12px;">Help Center</a><a href="${this.escapeHtml(brand.docsUrl || DEFAULT_BRAND.docsUrl)}" target="_blank" style="color: #334155; text-decoration: underline; margin-right: 12px;">Developer Docs</a><a href="${this.escapeHtml(brand.privacyUrl || DEFAULT_BRAND.privacyUrl)}" target="_blank" style="color: #334155; text-decoration: underline; margin-right: 12px;">Privacy Policy</a><a href="${this.escapeHtml(brand.termsUrl || DEFAULT_BRAND.termsUrl)}" target="_blank" style="color: #334155; text-decoration: underline;">Terms of Service</a></td></tr>
                <tr><td align="left" style="font-family: ${fontFamily}; font-size: 11px; color: #64748B; line-height: 1.5;">You received this email because your email address ${recipientEmail ? `(<strong>${this.escapeHtml(recipientEmail)}</strong>)` : ''} is registered with a PartnerIQ organization or partner account.</td></tr>
                <tr><td align="left" style="font-family: ${fontFamily}; font-size: 11px; color: #64748B; padding-top: 10px; line-height: 1.5;">&copy; ${currentYear} ${this.escapeHtml(brand.companyLegal || DEFAULT_BRAND.companyLegal)} &bull; ${this.escapeHtml(brand.physicalAddress || DEFAULT_BRAND.physicalAddress)}</td></tr>
              </table>
            </td>
            
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private htmlToPlainText(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n$1\n' + '='.repeat(20) + '\n')
      .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '$2 ($1)')
      .replace(/<p[^>]*>/gi, '\n\n')
      .replace(/<\/p>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n* ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&bull;/g, '*')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
