/**
 * Creates the assets audit's test users and data through the real HTTP API (register → email OTP from the dev email
 * provider → session; orgs; member invites; programs; affiliates; affiliate portal users; partner tiers) and one
 * platform super admin (repo script create-super-admin + /auth/set-password). Everything is prefixed e2e-ast-<ts>.
 * Writes e2e-assets/.fixtures.json (gitignored: contains short-lived tokens).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { api } from '../lib/api';
import { loginWorkspaceUser, registerAffiliateUser, registerWorkspaceUser, Session } from '../lib/actors';
import { closeDb, sql } from '../lib/db';
import { ENV } from '../lib/env';
import { Fixtures, OrgFixture, saveFixtures } from '../lib/fixtures';

const must = (label: string, r: { status: number; body: any }, ok = [200, 201]) => {
  if (!ok.includes(r.status)) throw new Error(`${label}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 500)}`);
  return r.body?.data;
};

async function makeOrg(owner: Session, name: string): Promise<OrgFixture> {
  const org = must('create org', await api('POST', '/organizations', { token: owner.token, body: { name, defaultCurrency: 'INR' } }));
  return { id: org.id, name, programs: [], affiliates: [], tiers: {} };
}

async function addProgram(owner: Session, org: OrgFixture, name: string) {
  const p = must('program', await api('POST', `/organizations/${org.id}/programs`, {
    token: owner.token,
    body: { name, slug: name.toLowerCase(), type: 'AFFILIATE', commissionType: 'PERCENTAGE', defaultCommissionValue: 1000, attributionModel: 'LAST_CLICK', status: 'ACTIVE', currency: 'INR' },
  }));
  org.programs.push({ id: p.id, name });
  return p.id as string;
}

async function addAffiliate(owner: Session, org: OrgFixture, email: string, displayName: string, programId: string) {
  const a = must('affiliate', await api('POST', `/organizations/${org.id}/affiliates`, { token: owner.token, body: { displayName, email, programId } }));
  const id = a.affiliate?.id || a.id;
  org.affiliates.push({ id, email, displayName, programId });
  return id as string;
}

async function invite(owner: Session, orgId: string, member: Session, role: string) {
  const inv = must(`invite ${role}`, await api('POST', `/organizations/${orgId}/members`, { token: owner.token, body: { email: member.email, role } }));
  must(`accept ${role}`, await api('POST', `/invitations/${inv.token}/accept`, { token: member.token }));
}

(async () => {
  const ts = Date.now();
  const run = ts.toString(36).toUpperCase();
  const prefix = `e2e-ast-${ts}`;
  const mail = (who: string) => `${prefix}-${who}@example.test`;
  const users: Fixtures['users'] = {};
  const ws = async (key: string, role: string) => {
    const s = await registerWorkspaceUser(mail(key.toLowerCase()), key.replace(/_/g, ''));
    users[key] = { ...s, role, kind: 'workspace' };
    return s;
  };

  const ownerA = await ws('ORG_A_OWNER', 'OWNER');
  const ownerB = await ws('ORG_B_OWNER', 'OWNER');
  const ownerE = await ws('ORG_EMPTY_OWNER', 'OWNER');
  const orgA = await makeOrg(ownerA, `${prefix}-org-a`);
  const orgB = await makeOrg(ownerB, `${prefix}-org-b`);
  const orgEmpty = await makeOrg(ownerE, `${prefix}-org-empty`);

  for (const [key, role] of [['ORG_A_ADMIN', 'ADMIN'], ['ORG_A_MANAGER', 'PROGRAM_MANAGER'], ['ORG_A_VIEWER', 'VIEWER'], ['ORG_A_NOPERM', 'ANALYST']] as const) {
    const s = await ws(key, role);
    await invite(ownerA, orgA.id, s, role);
  }

  const pA1 = await addProgram(ownerA, orgA, `${prefix}-prog-a1`);
  const pA2 = await addProgram(ownerA, orgA, `${prefix}-prog-a2`);
  const pB1 = await addProgram(ownerB, orgB, `${prefix}-prog-b1`);

  // AFFILIATE_1, _2 in program A1; AFFILIATE_3 in program A2; AFFILIATE_B1 in Org B
  await addAffiliate(ownerA, orgA, mail('affiliate_1'), `${prefix} Affiliate One`, pA1);
  await addAffiliate(ownerA, orgA, mail('affiliate_2'), `${prefix} Affiliate Two`, pA1);
  await addAffiliate(ownerA, orgA, mail('affiliate_3'), `${prefix} Affiliate Three`, pA2);
  await addAffiliate(ownerB, orgB, mail('affiliate_b1'), `${prefix} Org B Affiliate`, pB1);
  for (const key of ['AFFILIATE_1', 'AFFILIATE_2', 'AFFILIATE_3', 'AFFILIATE_B1']) {
    const s = await registerAffiliateUser(mail(key.toLowerCase()), key.replace('_', ''));
    users[key] = { ...s, role: 'AFFILIATE', kind: 'affiliate' };
  }

  // Partner tiers in program A1 (Bronze 1 < Silver 2 < Gold 3); a click-based ladder in program A2 with a level-9 tier
  for (const [code, level] of [['BRONZE', 1], ['SILVER', 2], ['GOLD', 3]] as const) {
    const t = must(`tier ${code}`, await api('POST', `/organizations/${orgA.id}/partner-tiers`, {
      token: ownerA.token,
      body: { programId: pA1, name: `${prefix} ${code}`, code: `${prefix}-${code}`.toUpperCase(), level, displayOrder: level, isActive: true, isVisibleToAffiliate: true },
    }));
    orgA.tiers[code] = { id: t.id, level, programId: pA1 };
  }
  const click = must('tier CLICK9', await api('POST', `/organizations/${orgA.id}/partner-tiers`, {
    token: ownerA.token,
    body: { programId: pA2, name: `${prefix} CLICKS-9`, code: `${prefix}-CLICKS9`.toUpperCase(), level: 9, displayOrder: 9, isActive: true, isVisibleToAffiliate: true, conditions: { minimumClicks: 1 } },
  }));
  orgA.tiers.CLICKS9 = { id: click.id, level: 9, programId: pA2 };

  // Platform super admin: repo bootstrap script (forced password change) → set the e2e password
  const adminEmail = mail('platform_admin');
  const tmpPassword = `Tmp!${ts}aA9#x`;
  execFileSync('npx', ['tsx', 'src/database/scripts/create-super-admin.ts', '--email', adminEmail, '--password', tmpPassword, '--force'], {
    cwd: path.resolve(__dirname, '..', '..'), stdio: 'ignore',
  });
  const tmpLogin = await api('POST', '/auth/login', { body: { email: adminEmail, password: tmpPassword } });
  const tmpToken = tmpLogin.body?.data?.accessToken || tmpLogin.body?.data?.tokens?.accessToken;
  must('admin set-password', await api('POST', '/auth/set-password', { token: tmpToken, body: { password: ENV.PASSWORD } }));
  const admin = await loginWorkspaceUser(adminEmail);
  users.PLATFORM_ADMIN = { ...admin, role: 'SUPER_ADMIN', kind: 'platform' };

  const f: Fixtures = { ts, run, prefix, users, orgA, orgB, orgEmpty: { id: orgEmpty.id } };
  saveFixtures(f);
  const counts = await sql(`SELECT (SELECT COUNT(*) FROM organizations WHERE name LIKE ?) orgs, (SELECT COUNT(*) FROM users WHERE email LIKE ?) users`, [`${prefix}%`, `${prefix}%`]);
  console.log(JSON.stringify({
    prefix, run, counts,
    orgA: { id: orgA.id, programs: orgA.programs.map((p) => p.id), affiliates: orgA.affiliates.map((a) => `${a.displayName} ${a.id} (${a.programId})`), tiers: orgA.tiers },
    orgB: { id: orgB.id }, orgEmpty: orgEmpty.id,
    users: Object.fromEntries(Object.entries(users).map(([k, v]) => [k, `${v.email} (${v.role}) ${v.userId}`])),
  }, null, 2));
  await closeDb();
})().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
