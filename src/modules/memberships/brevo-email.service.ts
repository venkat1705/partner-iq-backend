import { Injectable } from '@nestjs/common';

interface SendInvitationEmailInput {
  toEmail: string;
  organizationName: string;
  inviterEmail?: string;
  role: string;
  inviteUrl: string;
}

interface SendAffiliateInvitationEmailInput {
  toEmail: string;
  partnerName: string;
  organizationName: string;
  programName: string;
  commissionLabel: string;
  attributionWindowDays: number;
  payoutSchedule: string;
  inviteUrl: string;
  personalMessage?: string;
  inviterEmail?: string;
}

@Injectable()
export class BrevoEmailService {
  async sendInvitationEmail(input: SendInvitationEmailInput) {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@partneriq.local';
    const senderName = process.env.BREVO_SENDER_NAME || 'PartnerIQ';

    if (!apiKey) {
      console.log(`Team invitation email skipped; BREVO_API_KEY is not configured. Invite link: ${input.inviteUrl}`);
      return { sent: false, reason: 'BREVO_API_KEY_NOT_CONFIGURED' };
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: input.toEmail }],
        subject: `You're invited to ${input.organizationName} on PartnerIQ`,
        htmlContent: this.renderHtml(input),
        textContent: this.renderText(input),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Brevo invitation email failed: ${response.status} ${errorText}`);
    }

    return { sent: true };
  }

  async sendAffiliateInvitationEmail(input: SendAffiliateInvitationEmailInput) {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@partneriq.local';
    const senderName = process.env.BREVO_SENDER_NAME || 'PartnerIQ';

    if (!apiKey) {
      console.log(`Affiliate invitation email skipped; BREVO_API_KEY is not configured. Invite link: ${input.inviteUrl}`);
      return { sent: false, reason: 'BREVO_API_KEY_NOT_CONFIGURED' };
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: input.toEmail, name: input.partnerName }],
        subject: `You're invited to join ${input.programName}`,
        htmlContent: this.renderAffiliateHtml(input),
        textContent: this.renderAffiliateText(input),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Brevo affiliate invitation email failed: ${response.status} ${errorText}`);
    }

    return { sent: true };
  }

  private renderText(input: SendInvitationEmailInput) {
    return [
      `You've been invited to ${input.organizationName} on PartnerIQ.`,
      input.inviterEmail ? `${input.inviterEmail} invited you as ${input.role}.` : `Your role will be ${input.role}.`,
      `Accept your invitation: ${input.inviteUrl}`,
      'This invitation link expires in 7 days.',
    ].join('\n\n');
  }

  private renderHtml(input: SendInvitationEmailInput) {
    return `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2 style="margin:0 0 12px">Join ${input.organizationName} on PartnerIQ</h2>
        <p>${input.inviterEmail ? `${input.inviterEmail} invited you` : 'You have been invited'} as <strong>${input.role}</strong>.</p>
        <p>
          <a href="${input.inviteUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">
            Accept invitation
          </a>
        </p>
        <p style="font-size:12px;color:#64748b">This invitation link expires in 7 days.</p>
      </div>
    `;
  }

  private renderAffiliateText(input: SendAffiliateInvitationEmailInput) {
    return [
      `Hi ${input.partnerName},`,
      `You're invited to join ${input.programName} by ${input.organizationName}.`,
      input.personalMessage,
      `Commission: ${input.commissionLabel}`,
      `Attribution window: ${input.attributionWindowDays} days`,
      `Payout schedule: ${input.payoutSchedule}`,
      `Accept your invitation: ${input.inviteUrl}`,
      'This invitation link expires in 7 days.',
    ].filter(Boolean).join('\n\n');
  }

  private renderAffiliateHtml(input: SendAffiliateInvitationEmailInput) {
    const safePartnerName = this.escapeHtml(input.partnerName);
    const safeOrganizationName = this.escapeHtml(input.organizationName);
    const safeProgramName = this.escapeHtml(input.programName);
    const safeCommissionLabel = this.escapeHtml(input.commissionLabel);
    const safePayoutSchedule = this.escapeHtml(input.payoutSchedule);
    const safeInviteUrl = this.escapeHtml(input.inviteUrl);
    const safePersonalMessage = input.personalMessage
      ? this.escapeHtml(input.personalMessage).replace(/\n/g, '<br />')
      : '';

    return `
      <!doctype html>
      <html>
        <body style="margin:0;background:#f8fafc;padding:32px 16px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
          <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;box-shadow:0 20px 45px rgba(15,23,42,0.08)">
            <div style="background:#0f172a;padding:28px 32px;color:#ffffff">
              <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#93c5fd;font-weight:800">PartnerIQ Affiliate Invitation</div>
              <h1 style="margin:10px 0 0;font-size:28px;line-height:1.15;font-weight:900">Join ${safeProgramName}</h1>
              <p style="margin:10px 0 0;color:#cbd5e1;font-size:14px;line-height:1.6">${safeOrganizationName} invited you to become an affiliate partner.</p>
            </div>

            <div style="padding:32px">
              <p style="margin:0 0 18px;font-size:16px;line-height:1.7">Hi <strong>${safePartnerName}</strong>,</p>
              <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#334155">
                You have been invited to promote ${safeProgramName}, track referrals in PartnerIQ, and earn commissions on approved conversions.
              </p>

              ${safePersonalMessage ? `
                <div style="margin:0 0 24px;padding:16px 18px;border-radius:16px;background:#f1f5f9;border:1px solid #e2e8f0;color:#334155;font-size:14px;line-height:1.7">
                  ${safePersonalMessage}
                </div>
              ` : ''}

              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 28px">
                <div style="padding:14px;border-radius:16px;background:#eff6ff;border:1px solid #bfdbfe">
                  <div style="font-size:10px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb">Commission</div>
                  <div style="margin-top:5px;font-size:16px;font-weight:900;color:#1e3a8a">${safeCommissionLabel}</div>
                </div>
                <div style="padding:14px;border-radius:16px;background:#ecfdf5;border:1px solid #bbf7d0">
                  <div style="font-size:10px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#059669">Attribution</div>
                  <div style="margin-top:5px;font-size:16px;font-weight:900;color:#065f46">${input.attributionWindowDays} days</div>
                </div>
                <div style="padding:14px;border-radius:16px;background:#fff7ed;border:1px solid #fed7aa">
                  <div style="font-size:10px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#ea580c">Payouts</div>
                  <div style="margin-top:5px;font-size:16px;font-weight:900;color:#9a3412">${safePayoutSchedule}</div>
                </div>
              </div>

              <a href="${safeInviteUrl}" style="display:block;text-align:center;background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 18px;border-radius:14px;font-weight:900;font-size:14px">
                Accept Affiliate Invitation
              </a>

              <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#64748b">
                This invitation expires in 7 days. If the button does not work, copy and paste this link into your browser:<br />
                <span style="word-break:break-all;color:#2563eb">${safeInviteUrl}</span>
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  private escapeHtml(value: string) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
