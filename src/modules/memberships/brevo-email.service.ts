import { Injectable } from '@nestjs/common';

interface SendInvitationEmailInput {
  toEmail: string;
  organizationName: string;
  inviterEmail?: string;
  role: string;
  inviteUrl: string;
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
}
