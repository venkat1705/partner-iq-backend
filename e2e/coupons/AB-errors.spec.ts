import { expect, test } from '@playwright/test';
import { F } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { recordSale } from '../lib/coupons';
import { newCoupon } from '../lib/sales';
import { Proof } from '../lib/proof';
import { adminLogin, openCoupons } from '../lib/ui';

/** AB — faked 500 / 403 / network failure / broken JSON per coupon API: clear error, never fake zeros; slow responses + quick filter changes end on the last filter. */
const proof = new Proof('AB');
const f = F();
test.afterAll(async () => closeDb());

const apis = ['/coupons/analytics/overview', '/coupons?', '/coupons/analytics/performance', '/coupons/analytics/by-affiliate', '/coupons/analytics/by-program', '/coupons/analytics/activity'];
const faults: [string, (route: any) => Promise<void>][] = [
  ['500', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false,"message":"boom"}' })],
  ['403', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: '{"success":false,"message":"Forbidden"}' })],
  ['network', (r) => r.abort('failed')],
  ['broken JSON', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":' })],
];

for (const [fault, handler] of faults) {
  test(`AB1 all coupon APIs fail with ${fault}`, async ({ page }) => {
    await adminLogin(page, 'ORG_A_OWNER');
    await page.route(/\/api\/v1\/organizations\/[^/]+\/coupons(\/analytics\/[a-z-]+)?(\?.*)?$/, handler);
    await openCoupons(page, f.orgA.id);
    await page.waitForTimeout(2000);
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    proof.h(`AB1 ${fault}`);
    proof.note(text.slice(0, 900));
    const hasError = /could not load|failed to load|couldn.t load|error loading|try again/i.test(text);
    const fakeZero = /TOTAL REDEMPTIONS 0|GROSS ATTRIBUTED REVENUE ₹0|ACTIVE COUPONS 0/.test(text);
    proof.check('error message shown', hasError, true);
    proof.check('fake zeros shown', fakeZero, false);
    proof.check('NaN shown', text.includes('NaN'), false);
    expect(hasError).toBe(true);
    expect(fakeZero).toBe(false);
    expect(text.includes('NaN')).toBe(false);
  });
}

test('AB2 3 s delay + rapid filter changes end on the last filter', async ({ page }) => {
  // own data: a coupon sale 40 days ago so 7D and Lifetime differ
  const c = await newCoupon(proof, f.orgA.id, { code: `E2E-CPN-${f.run}-AB-OLD`, name: `${f.prefix} AB old`, discountType: 'PERCENTAGE', discountValue: 10 });
  await recordSale(f.orgA.apiKey, { externalId: `${f.prefix}-AB-old`, customerExternalId: `${f.prefix}-AB-c`, amount: 90000, currency: 'INR', occurredAt: new Date(Date.now() - 40 * 86400000).toISOString(), metadata: { couponCode: c.code } });
  const q = (from?: Date) => sql(`SELECT COUNT(*) n FROM organization_coupon_redemptions r JOIN conversions v ON v.id=r.conversionId WHERE r.organizationId=? ${from ? 'AND v.occurredAt >= ?' : ''}`, from ? [f.orgA.id, from] : [f.orgA.id]);
  const lifetime = Number((await q())[0].n);
  const sevenDays = Number((await q(new Date(Date.now() - 7 * 86400000)))[0].n);
  proof.sql('SELECT COUNT(*) redemptions lifetime / 7D (Org A)', { lifetime, sevenDays });
  expect(lifetime).toBeGreaterThan(sevenDays);
  await adminLogin(page, 'ORG_A_OWNER');
  await openCoupons(page, f.orgA.id);
  const served: string[] = [];
  await page.route(/\/coupons\/analytics\/overview/, async (route) => {
    const url = route.request().url();
    const delay = url.includes('period=7D') ? 3000 : url.includes('period=90D') ? 1500 : 200;
    await new Promise((r) => setTimeout(r, delay));
    served.push(url.replace(/^.*\?/, ''));
    await route.continue();
  });
  await page.getByRole('button', { name: '7D', exact: true }).click();
  await page.getByRole('button', { name: '90D', exact: true }).click();
  await page.getByRole('button', { name: 'Lifetime', exact: true }).click();
  await page.waitForTimeout(4500);
  const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const shown = Number(text.match(/TOTAL REDEMPTIONS (\d+)/)?.[1]);
  proof.h('AB2 race');
  proof.note(`served order (slowest first request finishes last): ${served.join(' | ')}`);
  proof.check('TOTAL REDEMPTIONS shown equals Lifetime SQL (last filter)', shown, lifetime);
  expect(shown).toBe(lifetime);
});
