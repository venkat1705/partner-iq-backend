import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';

/** U — ORG_B_OWNER tries every coupon action on Org A coupons, by Org A path and by Org B path with Org A ids/codes. */
const proof = new Proof('U');
const f = F();
test.afterAll(async () => closeDb());

test('U every coupon route', async () => {
  const b = await as('ORG_B_OWNER');
  const A = f.orgA;
  const target = A.coupons.PCT10;
  const snap = async () => sql(`SELECT id, code, name, status, discountValue, updatedAt FROM organization_coupons WHERE organizationId=? ORDER BY id`, [A.id]);
  const snapAssign = async () => sql(`SELECT couponId, affiliateId FROM organization_coupon_assignments WHERE organizationId=? ORDER BY couponId, affiliateId`, [A.id]);
  const before = [await snap(), await snapAssign()];
  const routes: [string, string, unknown][] = [];
  for (const base of [orgPath(A.id), orgPath(f.orgB.id)]) {
    routes.push(
      ['GET', base, undefined],
      ['GET', `${base}/settings`, undefined],
      ['PUT', `${base}/settings`, { couponsEnabled: false }],
      ['GET', `${base}/analytics/overview`, undefined],
      ['GET', `${base}/analytics/performance`, undefined],
      ['GET', `${base}/analytics/by-affiliate`, undefined],
      ['GET', `${base}/analytics/by-program`, undefined],
      ['GET', `${base}/analytics/activity?couponId=${target.id}`, undefined],
      ['GET', `${base}/validate/${target.code}`, undefined],
      ['GET', `${base}/${target.id}`, undefined],
      ['GET', `${base}/${target.id}/analytics`, undefined],
      ['PUT', `${base}/${target.id}`, { name: 'pwned by B' }],
      ['POST', `${base}/${target.id}/status`, { status: 'ARCHIVED' }],
      ['POST', `${base}/${target.id}/assign`, { affiliateIds: [f.orgB.affiliates[0].id] }],
      ['DELETE', `${base}/${target.id}/assign/${A.affiliates[0].id}`, undefined],
      ['POST', base, { code: target.code, name: 'B creates in A', discountType: 'PERCENTAGE', discountValue: 99 }],
    );
  }
  const table: string[] = ['| method | path | status | Org A data in body? |', '|---|---|---|---|'];
  for (const [m, p, body] of routes) {
    const r = await api(m, p, { token: b.token, body });
    const inOrgBPath = p.startsWith(orgPath(f.orgB.id));
    // the error envelope echoes the requested path (which the caller already knows) — not a leak
    const { path: _echo, ...rest } = (r.body && typeof r.body === 'object' ? r.body : { body: r.body }) as any;
    const s = JSON.stringify(rest);
    const leak = s.includes(target.id) || s.includes(A.id) || s.includes(A.affiliates[0].email);
    proof.http(m, p, r, body);
    table.push(`| ${m} | ${p.replace(A.id, '<orgA>').replace(f.orgB.id, '<orgB>').replace(target.id, '<couponA>')} | ${r.status} | ${leak} |`);
    if (!inOrgBPath) {
      // 429 (rate limit on code checks, shared with S in the same run) is also a refusal with no data
      expect([403, 404, 429], `${m} ${p}`).toContain(r.status);
    } else if (p.endsWith('/coupons') && m === 'POST') {
      // creating the same code in Org B is legal (codes are unique per org) — clean it up below
    } else if (p.includes(target.id)) {
      expect([400, 403, 404], `${m} ${p}`).toContain(r.status);
    }
    expect(leak, `${m} ${p} leaks Org A data`).toBe(false);
  }
  proof.note('\nU TABLE\n' + table.join('\n'));
  const after = [await snap(), await snapAssign()];
  proof.check('Org A coupons + assignments unchanged in SQL', after, before);
  expect(after).toEqual(before);
  await api('PUT', `${orgPath(f.orgB.id)}/settings`, { token: b.token, body: { couponsEnabled: true } });
  await sql(`DELETE FROM organization_coupons WHERE organizationId=? AND name='B creates in A'`, [f.orgB.id]);
});
