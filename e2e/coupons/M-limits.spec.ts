import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, sale, usageCount } from '../lib/sales';
import { as } from '../lib/session';
import { adminLogin, openCoupons } from '../lib/ui';

/**
 * M — usage limits. Rules (D7): a use is counted when the sale is recorded with an applicable coupon; with
 * maxRedemptions = N the N+1th sale is still recorded but the coupon is NOT applied (no redemption, no coupon
 * credit, response coupon.applied=false). Per-customer limit keyed by customerExternalId (else normalized email).
 * "Remaining uses" (API + UI) must equal max − COUNT(redemptions) from SQL after each step.
 */
const proof = new Proof('M');
const f = F();
const P = `E2E-CPN-${f.run}-M`;
const O = `${f.prefix}-M-`;
const A3 = f.orgA.affiliates[2];

test.afterAll(async () => {
  await closeDb();
});

async function remainingApi(couponId: string) {
  const owner = await as('ORG_A_OWNER');
  const r = await api('GET', orgPath(f.orgA.id, `/${couponId}/analytics`), { token: owner.token });
  proof.http('GET', orgPath(f.orgA.id, `/${couponId}/analytics`), r);
  return r.data?.metrics?.remainingRedemptions;
}

test('M1 total limit N=3: 3 uses work, 4th refused; remaining matches SQL each step; UI after refresh', async ({ page }) => {
  proof.h('M1 total limit 3');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-N3`, name: `${f.prefix} M n3`, discountType: 'PERCENTAGE', discountValue: 5, maxRedemptions: 3, affiliateIds: [A3.id] });
  for (let i = 1; i <= 4; i++) {
    const s = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}N3-${i}`, customerExternalId: `${O}c${i}`, amount: 95000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
    const used = await usageCount(c.id);
    proof.sql(`SELECT COUNT(*) FROM organization_coupon_redemptions WHERE couponId='${c.id}'`, used);
    const remaining = await remainingApi(c.id);
    const expectedUsed = Math.min(i, 3);
    proof.check(`step ${i} HTTP (sale is always recorded)`, s.status, 201);
    proof.check(`step ${i} coupon.applied`, s.body?.data?.coupon?.applied, i <= 3);
    proof.check(`step ${i} SQL uses`, used, expectedUsed);
    proof.check(`step ${i} API remaining`, remaining, 3 - expectedUsed);
    expect(s.status).toBe(201);
    expect(s.body?.data?.coupon?.applied).toBe(i <= 3);
    expect(used).toBe(expectedUsed);
    expect(remaining).toBe(3 - expectedUsed);
    if (i === 4) {
      proof.check('4th sale: no redemption row', Boolean(s.redemption), false);
      expect(Boolean(s.redemption)).toBe(false);
    }
  }
  // UI: detail drawer quota after a full page refresh
  await adminLogin(page, 'ORG_A_OWNER');
  // the sidebar entry is a button, not a link: open the page by URL, then refresh
  await openCoupons(page, f.orgA.id, '?tab=coupons');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('Search coupons by code or name...').fill(c.code);
  const row = page.locator('tr', { hasText: c.code });
  await expect(row).toBeVisible();
  const usageText = (await row.innerText()).replace(/\s+/g, ' ');
  proof.note(`UI row text: ${usageText}`);
  proof.check('UI "used" text', /3 used \/ 3/.test(usageText), true);
  expect(usageText).toMatch(/3 used \/ 3/);
});

test('M2 per-customer limit 1: same customer refused, different customer works', async () => {
  proof.h('M2 per-customer limit');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-PC1`, name: `${f.prefix} M pc1`, discountType: 'PERCENTAGE', discountValue: 5, maxRedemptionsPerCustomer: 1, affiliateIds: [A3.id] });
  const s1 = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}PC-1`, customerExternalId: `${O}same`, amount: 95000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
  const s2 = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}PC-2`, customerExternalId: `${O}same`, amount: 95000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
  const s3 = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}PC-3`, customerExternalId: `${O}other`, amount: 95000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
  // email fallback: two different customer IDs but metadata.customerEmail equal after normalization is NOT used when IDs exist
  const byCustomer = await sql(`SELECT customerKey, COUNT(*) n FROM organization_coupon_redemptions WHERE couponId=? GROUP BY customerKey ORDER BY customerKey`, [c.id]).catch((e) => String(e.message));
  proof.sql(`SELECT customerKey, COUNT(*) FROM organization_coupon_redemptions WHERE couponId='${c.id}' GROUP BY customerKey`, byCustomer);
  proof.check('same customer 1st', s1.body?.data?.coupon?.applied, true);
  proof.check('same customer 2nd', s2.body?.data?.coupon?.applied, false);
  proof.check('other customer', s3.body?.data?.coupon?.applied, true);
  expect([s1.status, s2.status, s3.status]).toEqual([201, 201, 201]);
  expect(s1.body?.data?.coupon?.applied).toBe(true);
  expect(s2.body?.data?.coupon?.applied).toBe(false);
  expect(s3.body?.data?.coupon?.applied).toBe(true);
  expect(await usageCount(c.id)).toBe(2);
});

test('M3 per-customer limit also matches normalized email (guest checkouts with new customer IDs)', async () => {
  proof.h('M3 per-customer by email');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-PCE`, name: `${f.prefix} M pce`, discountType: 'PERCENTAGE', discountValue: 5, maxRedemptionsPerCustomer: 1, affiliateIds: [A3.id] });
  const s1 = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}PCE-1`, customerExternalId: `${O}guest-1`, amount: 95000, currency: 'INR', metadata: { couponCode: c.code, customerEmail: 'Buyer.One@Example.test' } }, c.id);
  const s2 = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}PCE-2`, customerExternalId: `${O}guest-2`, amount: 95000, currency: 'INR', metadata: { couponCode: c.code, customerEmail: '  buyer.one@example.TEST ' } }, c.id);
  const s3 = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}PCE-3`, customerExternalId: `${O}guest-3`, amount: 95000, currency: 'INR', metadata: { couponCode: c.code, customerEmail: 'buyer.two@example.test' } }, c.id);
  proof.check('1st (email one)', s1.body?.data?.coupon?.applied, true);
  proof.check('2nd (new id, same email after trim+lowercase)', s2.body?.data?.coupon?.applied, false);
  proof.check('3rd (email two)', s3.body?.data?.coupon?.applied, true);
  expect(s1.body?.data?.coupon?.applied).toBe(true);
  expect(s2.body?.data?.coupon?.applied).toBe(false);
  expect(s3.body?.data?.coupon?.applied).toBe(true);
});
