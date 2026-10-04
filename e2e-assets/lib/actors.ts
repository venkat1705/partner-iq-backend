import { api } from './api';
import { ENV } from './env';
import { eventually, sqlOne } from './db';

export interface Session {
  email: string;
  userId: string;
  token: string;
}

async function latestEmailHtml(email: string, subjectLike: string, after: Date) {
  const row = await eventually(
    () =>
      sqlOne<{ snapshotHtml: string }>(
        `SELECT snapshotHtml FROM email_delivery_logs
          WHERE recipientEmail = ? AND subject LIKE ? AND createdAt >= ?
          ORDER BY createdAt DESC LIMIT 1`,
        [email, subjectLike, new Date(after.getTime() - 2000)],
      ),
    8000,
  );
  if (!row) throw new Error(`No "${subjectLike}" email captured for ${email}`);
  return row.snapshotHtml;
}

/** OTP is read from the dev email provider's stored snapshot (email_delivery_logs). */
async function readOtp(email: string, after: Date) {
  const html = await latestEmailHtml(email, '%verification code%', after);
  const m = html.match(/(?<![#\d])(\d{6})(?!\d)/);
  if (!m) throw new Error(`OTP not found in email for ${email}`);
  return m[1];
}

function bearer(data: any): string {
  const t = data?.accessToken || data?.tokens?.accessToken || data?.session?.accessToken;
  if (!t) throw new Error(`No access token in ${JSON.stringify(data).slice(0, 300)}`);
  return t;
}

/** Workspace (admin app) user: register → email OTP → session. */
export async function registerWorkspaceUser(email: string, firstName: string, lastName = 'E2E'): Promise<Session> {
  const started = new Date();
  const reg = await api('POST', '/auth/register', {
    body: { email, password: ENV.PASSWORD, firstName, lastName, acceptedTerms: true },
  });
  if (reg.status !== 201) throw new Error(`register ${email}: ${reg.status} ${JSON.stringify(reg.body)}`);
  const challengeId = reg.data.challengeId;
  const code = await readOtp(email, started);
  const ver = await api('POST', '/auth/verify-email-otp', { body: { challengeId, code } });
  if (ver.status >= 300) throw new Error(`verify ${email}: ${ver.status} ${JSON.stringify(ver.body)}`);
  return { email, userId: reg.data.userId, token: bearer(ver.data) };
}

export async function loginWorkspaceUser(email: string): Promise<Session> {
  const r = await api('POST', '/auth/login', { body: { email, password: ENV.PASSWORD } });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return { email, userId: r.data.user?.id || r.data.userId, token: bearer(r.data) };
}

/** Affiliate portal user: separate auth surface (/affiliate/auth). */
export async function registerAffiliateUser(email: string, firstName: string): Promise<Session> {
  const started = new Date();
  const reg = await api('POST', '/affiliate/auth/register', {
    body: { email, password: ENV.PASSWORD, fullName: `${firstName} E2E`, termsAccepted: true },
  });
  if (reg.status >= 300) throw new Error(`affiliate register ${email}: ${reg.status} ${JSON.stringify(reg.body)}`);
  const data = reg.data;
  if (data?.requiresEmailVerification) {
    const code = await readOtp(email, started);
    const ver = await api('POST', '/affiliate/auth/verify-email-otp', { body: { challengeId: data.challengeId, code } });
    if (ver.status >= 300) throw new Error(`affiliate verify ${email}: ${ver.status} ${JSON.stringify(ver.body)}`);
    return { email, userId: data.userId || ver.data?.user?.id, token: bearer(ver.data) };
  }
  return { email, userId: data.user?.id || data.userId, token: bearer(data) };
}

export async function loginAffiliateUser(email: string): Promise<Session> {
  const r = await api('POST', '/affiliate/auth/login', { body: { email, password: ENV.PASSWORD } });
  if (r.status !== 200) throw new Error(`affiliate login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return { email, userId: r.data.user?.id || r.data.userId, token: bearer(r.data) };
}

export async function invitationTokenFor(email: string, after: Date) {
  const html = await latestEmailHtml(email, '%', after);
  const m = html.match(/invitations?\/([A-Za-z0-9_-]{20,})/) || html.match(/[?&]token=([A-Za-z0-9_-]{20,})/);
  if (!m) throw new Error(`invitation token not found in email for ${email}`);
  return m[1];
}
