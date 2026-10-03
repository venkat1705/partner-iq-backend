import { expect, test } from '@playwright/test';
import { F } from '../lib/coupons';
import { closeDb } from '../lib/db';
import { Proof } from '../lib/proof';
import { adminLogin, consoleErrors, openCoupons } from '../lib/ui';

/** A — page load: only GET requests, no duplicate requests, no console errors, no other-org data in responses. */
const proof = new Proof('A');
const f = F();
test.afterAll(async () => closeDb());

for (const role of ['ORG_A_OWNER', 'ORG_A_VIEWER']) {
  test(`A page load as ${role}`, async ({ page }) => {
    await adminLogin(page, role);
    await page.goto('about:blank');
    const reqs: { method: string; url: string; status: number; body: string }[] = [];
    page.on('response', async (res) => {
      const u = res.url();
      if (!u.includes('/api/v1/organizations/') || !u.includes('/coupons')) return;
      let body = '';
      try { body = await res.text(); } catch { /* redirects */ }
      reqs.push({ method: res.request().method(), url: u.replace(/^https?:\/\/[^/]+/, ''), status: res.status(), body });
    });
    const errors = consoleErrors(page);
    await openCoupons(page, f.orgA.id);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    proof.h(`A ${role}: coupon API requests during page load`);
    reqs.forEach((r) => proof.note(`${r.method} ${r.url} -> ${r.status} (${r.body.length} bytes)`));
    const counts = new Map<string, number>();
    reqs.forEach((r) => counts.set(`${r.method} ${r.url}`, (counts.get(`${r.method} ${r.url}`) || 0) + 1));
    const dups = [...counts].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
    const nonGet = reqs.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url}`);
    const leaks = reqs.filter((r) => r.body.includes(f.orgB.id) || r.body.includes(f.orgB.coupons.BONLY.id) || r.body.includes(f.orgB.coupons.SHARED.id));
    // network-level 'Failed to load resource' lines are judged by the coupon response statuses above (the rest is
    // session-restore 401 + proxy certificate noise from fonts); page JS errors and React errors are kept.
    const errs = errors.filter((e) => !/favicon|DevTools|React Router Future Flag|Failed to load resource/i.test(e));
    proof.note(`console errors: ${JSON.stringify(errs)}`);
    proof.check('non-GET requests', nonGet, []);
    proof.check('duplicate requests', dups, []);
    proof.check('responses containing Org B ids', leaks.map((l) => l.url), []);
    proof.check('console errors', errs, []);
    proof.check('all coupon requests 2xx', reqs.filter((r) => r.status >= 400).map((r) => `${r.url} ${r.status}`), []);
    expect(nonGet).toEqual([]);
    expect(leaks.map((l) => l.url)).toEqual([]);
    expect(reqs.filter((r) => r.status >= 400).map((r) => `${r.url} ${r.status}`)).toEqual([]);
    expect(errs).toEqual([]);
    expect(dups).toEqual([]);
  });
}
