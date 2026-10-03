/**
 * Phase 2 — creates the audit's test users and data through the real HTTP API
 * (register → email OTP from the dev email provider → session; org; invites; programs;
 * affiliates; API keys; coupons; one coupon sale). Everything is prefixed e2e-cpn-<ts>.
 * Writes e2e/.fixtures.json (gitignored: contains short-lived test tokens).
 */
import { api } from '../lib/api';
import { registerAffiliateUser, registerWorkspaceUser, Session } from '../lib/actors';
import { closeDb } from '../lib/db';
import { Fixtures, OrgFixture, saveFixtures } from '../lib/fixtures';

const must = (label: string, r: { status: number; body: any }, ok = [200, 201]) => {
  if (!ok.includes(r.status)) throw new Error(`${label}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body?.data;
};

async function makeOrg(owner: Session, name: string, prefix: string, tz: string): Promise<OrgFixture> {
  const org = must('create org', await api('POST', '/organizations', { token: owner.token, body: { name, defaultCurrency: 'INR' } }));
  must('timezone', await api('PATCH', `/organizations/${org.id}/settings/localization`, { token: owner.token, body: { timezone: tz } }));
  const key = must('api key', await api('POST', `/organizations/${org.id}/api-keys`, {
    token: owner.token, body: { name: `${prefix}-key`, preset: 'CONVERSION_TRACKING', environment: 'live' },
  }));
  return { id: org.id, name, apiKey: key.key, programs: [], affiliates: [], coupons: {} };
}

async function addProgram(owner: Session, org: OrgFixture, name: string, bps: number) {
  const p = must('program', await api('POST', `/organizations/${org.id}/programs`, {
    token: owner.token,
    body: { name, slug: name.toLowerCase(), type: 'AFFILIATE', commissionType: 'PERCENTAGE', defaultCommissionValue: bps, attributionModel: 'LAST_CLICK', status: 'ACTIVE', currency: 'INR' },
  }));
  org.programs.push({ id: p.id, name, bps });
  return p.id as string;
}

async function addAffiliate(owner: Session, org: OrgFixture, email: string, displayName: string, programId: string) {
  const a = must('affiliate', await api('POST', `/organizations/${org.id}/affiliates`, {
    token: owner.token, body: { displayName, email, programId },
  }));
  const id = a.affiliate?.id || a.id;
  org.affiliates.push({ id, email, displayName, programId });
  return id as string;
}

async function invite(owner: Session, orgId: string, member: Session, role: string) {
  const inv = must(`invite ${role}`, await api('POST', `/organizations/${orgId}/members`, { token: owner.token, body: { email: member.email, role } }));
  must(`accept ${role}`, await api('POST', `/invitations/${inv.token}/accept`, { token: member.token }));
}

async function coupon(owner: Session, org: OrgFixture, key: string, body: Record<string, unknown>) {
  const c = must(`coupon ${key}`, await api('POST', `/organizations/${org.id}/coupons`, { token: owner.token, body }));
  org.coupons[key] = { id: c.id, code: c.code };
  return c;
}

(async () => {
  const ts = Date.now();
  const run = ts.toString(36).toUpperCase();
  const prefix = `e2e-cpn-${ts}`;
  const mail = (who: string) => `${prefix}-${who}@example.test`;
  const C = (s: string) => `E2E-CPN-${run}-${s}`;
  const day = 86400000;

  const users: Fixtures['users'] = {};
  const ws = async (key: string, role: string) => {
    const s = await registerWorkspaceUser(mail(key.toLowerCase()), key.replace(/_/g, ''));
    users[key] = { ...s, role, kind: 'workspace' };
    return s;
  };

  const ownerA = await ws('ORG_A_OWNER', 'OWNER');
  const ownerB = await ws('ORG_B_OWNER', 'OWNER');
  const orgA = await makeOrg(ownerA, `${prefix}-org-a`, prefix, 'Asia/Kolkata');
  const orgB = await makeOrg(ownerB, `${prefix}-org-b`, prefix, 'UTC');

  for (const [key, role] of [['ORG_A_MANAGER', 'PROGRAM_MANAGER'], ['ORG_A_VIEWER', 'VIEWER'], ['ORG_A_NOPERM', 'ANALYST']] as const) {
    const s = await ws(key, role);
    await invite(ownerA, orgA.id, s, role);
  }

  const pA1 = await addProgram(ownerA, orgA, `${prefix}-prog-a1`, 750); // 7.5 %
  const pA2 = await addProgram(ownerA, orgA, `${prefix}-prog-a2`, 1000); // 10 %
  const pB1 = await addProgram(ownerB, orgB, `${prefix}-prog-b1`, 500);

  const a1 = await addAffiliate(ownerA, orgA, mail('affiliate_1'), `${prefix} Affiliate One`, pA1);
  const a2 = await addAffiliate(ownerA, orgA, mail('affiliate_2'), `${prefix} Affiliate Two`, pA1);
  const a3 = await addAffiliate(ownerA, orgA, mail('affiliate_3'), `${prefix} Affiliate Three`, pA2);
  const b1 = await addAffiliate(ownerB, orgB, mail('affiliate_b1'), `${prefix} Org B Affiliate`, pB1);

  for (const key of ['AFFILIATE_1', 'AFFILIATE_2']) {
    const s = await registerAffiliateUser(mail(key.toLowerCase()), key.replace('_', ''));
    users[key] = { ...s, role: 'AFFILIATE', kind: 'affiliate' };
  }

  // Coupons: every discount type and status, limits, dates near today, one used.
  const now = Date.now();
  await coupon(ownerA, orgA, 'PCT10', { code: C('PCT10'), name: `${prefix} 10% A1`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [a1] });
  await coupon(ownerA, orgA, 'FIX200', { code: C('FIX200'), name: `${prefix} Rs200 A2`, discountType: 'FIXED_AMOUNT', discountValue: 200, affiliateIds: [a2] });
  await coupon(ownerA, orgA, 'LIMIT3', { code: C('LIMIT3'), name: `${prefix} limit 3`, discountType: 'PERCENTAGE', discountValue: 5, maxRedemptions: 3, affiliateIds: [a3] });
  await coupon(ownerA, orgA, 'STARTS', { code: C('STARTS'), name: `${prefix} starts tomorrow`, discountType: 'PERCENTAGE', discountValue: 15, validFrom: new Date(now + day).toISOString(), affiliateIds: [a1] });
  await coupon(ownerA, orgA, 'ENDS', { code: C('ENDS'), name: `${prefix} ends tomorrow`, discountType: 'PERCENTAGE', discountValue: 20, validUntil: new Date(now + day).toISOString(), affiliateIds: [a2] });
  await coupon(ownerA, orgA, 'EXPIRED', { code: C('EXPIRED'), name: `${prefix} expired`, discountType: 'FIXED_AMOUNT', discountValue: 50, validFrom: new Date(now - 10 * day).toISOString(), validUntil: new Date(now - day).toISOString() });
  const paused = await coupon(ownerA, orgA, 'PAUSED', { code: C('PAUSED'), name: `${prefix} paused`, discountType: 'PERCENTAGE', discountValue: 25 });
  must('pause', await api('POST', `/organizations/${orgA.id}/coupons/${paused.id}/status`, { token: ownerA.token, body: { status: 'PAUSED' } }));
  const archived = await coupon(ownerA, orgA, 'ARCHIVED', { code: C('ARCHIVED'), name: `${prefix} archived`, discountType: 'FIXED_AMOUNT', discountValue: 100 });
  must('archive', await api('POST', `/organizations/${orgA.id}/coupons/${archived.id}/status`, { token: ownerA.token, body: { status: 'ARCHIVED' } }));
  await coupon(ownerA, orgA, 'SHARED', { code: C('SHARED'), name: `${prefix} same code as org B`, discountType: 'PERCENTAGE', discountValue: 12 });
  await coupon(ownerA, orgA, 'USED', { code: C('USED'), name: `${prefix} already used`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [a1] });

  await coupon(ownerB, orgB, 'SHARED', { code: C('SHARED'), name: `${prefix} org B same code`, discountType: 'PERCENTAGE', discountValue: 30, affiliateIds: [b1] });
  await coupon(ownerB, orgB, 'BONLY', { code: C('BONLY'), name: `${prefix} org B only`, discountType: 'FIXED_AMOUNT', discountValue: 75, affiliateIds: [b1] });

  // One coupon sale (no click) on USED — paid ₹900.00 after 10 % off ₹1000.00.
  must('used sale', await api('POST', '/conversions', {
    apiKey: orgA.apiKey,
    body: { externalId: `${prefix}-seed-order-1`, customerExternalId: `${prefix}-cust-seed`, amount: 90000, currency: 'INR', metadata: { couponCode: C('USED') } },
  }));

  const f: Fixtures = { ts, run, prefix, users, orgA, orgB };
  saveFixtures(f);
  console.log(JSON.stringify({
    prefix, run,
    orgA: { id: orgA.id, programs: orgA.programs.map((p) => p.id), affiliates: orgA.affiliates.map((a) => `${a.displayName} ${a.id}`), coupons: Object.keys(orgA.coupons) },
    orgB: { id: orgB.id, coupons: Object.keys(orgB.coupons) },
    users: Object.fromEntries(Object.entries(users).map(([k, v]) => [k, `${v.email} (${v.role}) ${v.userId}`])),
  }, null, 2));
  await closeDb();
})().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
