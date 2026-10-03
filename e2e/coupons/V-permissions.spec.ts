import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';
import { adminLogin, openCoupons } from '../lib/ui';

/**
 * V — role × API matrix (expected from src/common/constants/permission-catalog.ts):
 *  OWNER *, MANAGER(PROGRAM_MANAGER) view/create/edit/assign, VIEWER view, NOPERM(ANALYST) none.
 * Archive (status ARCHIVED) requires coupons.delete ("Archive organization product coupons") — D14.
 */
const proof = new Proof('V');
const f = F();
const P = `E2E-CPN-${f.run}-V`;
test.afterAll(async () => closeDb());

type Row = { label: string; method: string; path: (id: string) => string; body?: (n: number) => unknown; perm: string };
const A = f.orgA;
const rows: Row[] = [
  { label: 'list', method: 'GET', path: () => orgPath(A.id), perm: 'view' },
  { label: 'get', method: 'GET', path: (id) => orgPath(A.id, `/${id}`), perm: 'view' },
  { label: 'settings get', method: 'GET', path: () => orgPath(A.id, '/settings'), perm: 'view' },
  { label: 'overview', method: 'GET', path: () => orgPath(A.id, '/analytics/overview'), perm: 'view' },
  { label: 'performance', method: 'GET', path: () => orgPath(A.id, '/analytics/performance'), perm: 'view' },
  { label: 'by-affiliate', method: 'GET', path: () => orgPath(A.id, '/analytics/by-affiliate'), perm: 'view' },
  { label: 'by-program', method: 'GET', path: () => orgPath(A.id, '/analytics/by-program'), perm: 'view' },
  { label: 'activity', method: 'GET', path: () => orgPath(A.id, '/analytics/activity'), perm: 'view' },
  { label: 'validate', method: 'GET', path: () => orgPath(A.id, `/validate/${A.coupons.PCT10.code}`), perm: 'view' },
  { label: 'coupon analytics', method: 'GET', path: (id) => orgPath(A.id, `/${id}/analytics`), perm: 'view' },
  { label: 'create', method: 'POST', path: () => orgPath(A.id), body: (n) => ({ code: `${P}-${n}`, name: `${f.prefix} V ${n}`, discountType: 'PERCENTAGE', discountValue: 5 }), perm: 'create' },
  { label: 'update', method: 'PUT', path: (id) => orgPath(A.id, `/${id}`), body: () => ({ description: 'v-edit' }), perm: 'edit' },
  { label: 'pause', method: 'POST', path: (id) => orgPath(A.id, `/${id}/status`), body: () => ({ status: 'PAUSED' }), perm: 'edit' },
  { label: 'assign', method: 'POST', path: (id) => orgPath(A.id, `/${id}/assign`), body: () => ({ affiliateIds: [A.affiliates[1].id] }), perm: 'assign' },
  { label: 'unassign', method: 'DELETE', path: (id) => orgPath(A.id, `/${id}/assign/${A.affiliates[1].id}`), perm: 'assign' },
  { label: 'settings put', method: 'PUT', path: () => orgPath(A.id, '/settings'), body: () => ({ couponsEnabled: true }), perm: 'settings' },
  { label: 'archive', method: 'POST', path: (id) => orgPath(A.id, `/${id}/status`), body: () => ({ status: 'ARCHIVED' }), perm: 'delete' },
];
const grants: Record<string, string[]> = {
  ORG_A_OWNER: ['view', 'create', 'edit', 'delete', 'assign', 'settings'],
  ORG_A_MANAGER: ['view', 'create', 'edit', 'assign'],
  ORG_A_VIEWER: ['view'],
  ORG_A_NOPERM: [],
};

test('V1 role × API matrix', async () => {
  test.setTimeout(150_000);
  // the code-check endpoint allows 30 requests/min per client; scenario U (run just before) spends that budget,
  // so start this matrix in a fresh 60 s window — a 429 here would hide the permission result
  await new Promise((r) => setTimeout(r, 61_000));
  const owner = await as('ORG_A_OWNER');
  const table = ['| role | API | expected | actual |', '|---|---|---|---|'];
  const mismatches: string[] = [];
  let n = 0;
  for (const role of Object.keys(grants)) {
    const s = await as(role);
    // a fresh target per role so state changes (pause/archive) don't affect the next role
    const t = await api('POST', orgPath(A.id), { token: owner.token, body: { code: `${P}-T-${role.slice(6)}`, name: `${f.prefix} V target ${role}`, discountType: 'PERCENTAGE', discountValue: 5 } });
    for (const r of rows) {
      const body = r.body?.(++n);
      if (r.label === 'unassign') await api('POST', orgPath(A.id, `/${t.data.id}/assign`), { token: owner.token, body: { affiliateIds: [A.affiliates[1].id] } });
      const res = await api(r.method, r.path(t.data.id), { token: s.token, body });
      const allowed = grants[role].includes(r.perm);
      const expectedOk = r.method === 'POST' && r.label !== 'pause' && r.label !== 'archive' && r.label !== 'assign' ? [201] : r.method === 'POST' ? [201] : [200];
      const ok = allowed ? expectedOk.includes(res.status) : res.status === 403;
      table.push(`| ${role} | ${r.method} ${r.label} | ${allowed ? expectedOk.join('/') : 403} | ${res.status} |`);
      proof.http(`${role} ${r.method}`, r.path(t.data.id), res, body);
      if (!ok) mismatches.push(`${role} ${r.label}: expected ${allowed ? expectedOk : 403} got ${res.status}`);
    }
  }
  proof.note('\nPERMISSION TABLE\n' + table.join('\n'));
  proof.check('mismatches', mismatches, []);
  expect(mismatches).toEqual([]);
});

for (const role of ['ORG_A_VIEWER', 'ORG_A_NOPERM']) {
  test(`V2 UI controls for ${role}`, async ({ page }) => {
    await adminLogin(page, role);
    if (role === 'ORG_A_NOPERM') {
      await page.goto(`http://localhost:3001/organizations/${A.id}/coupons`);
      await page.waitForTimeout(3000);
      const navCoupons = await page.getByRole('button', { name: 'Coupons', exact: true }).count();
      const onPage = await page.getByText('Coupon Intelligence & Management').count();
      proof.h('V2 NOPERM');
      proof.check('Coupons nav item count', navCoupons, 0);
      proof.check('coupons page rendered', onPage, 0);
      expect(navCoupons).toBe(0);
      expect(onPage).toBe(0);
      return;
    }
    await openCoupons(page, A.id, '?tab=coupons');
    const create = await page.getByRole('button', { name: /Create Coupon|Create First Coupon/ }).count();
    await page.getByPlaceholder('Search coupons by code or name...').fill(A.coupons.PCT10.code);
    await page.locator('tbody tr').first().getByRole('button').last().click();
    const menu = (await page.getByRole('menu').innerText().catch(() => '')).replace(/\s+/g, ' ');
    proof.h('V2 VIEWER');
    proof.check('Create buttons', create, 0);
    proof.note(`row menu: ${menu}`);
    for (const item of ['Edit Coupon', 'Assign Affiliates', 'Pause Coupon', 'Archive Coupon']) {
      proof.check(`menu has "${item}"`, menu.includes(item), false);
      expect(menu.includes(item), item).toBe(false);
    }
    expect(create).toBe(0);
  });
}
