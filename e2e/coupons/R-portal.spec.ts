import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { ENV } from '../lib/env';
import { Proof } from '../lib/proof';
import { newCoupon, sale } from '../lib/sales';
import { as } from '../lib/session';

/**
 * R — affiliate portal. Contract fields the portal reads (inventory §1.2): id, organizationId, code, description,
 * discountType, discountValue, validUntil (+ name, validFrom). Must never include: other affiliates, assignedAffiliates,
 * maxRedemptions, createdBy, internal ids of other rows. New additive fields: status, uses, conversions,
 * revenueGenerated, commissionEarned, currency.
 */
const proof = new Proof('R');
const f = F();
const P = `E2E-CPN-${f.run}-R`;
const O = `${f.prefix}-R-`;
const [A1, A2] = f.orgA.affiliates;
const ALLOWED = new Set(['id', 'organizationId', 'code', 'name', 'description', 'discountType', 'discountValue', 'validFrom', 'validUntil', 'status', 'uses', 'conversions', 'revenueGenerated', 'commissionEarned', 'currency']);
test.afterAll(async () => closeDb());

test('R1 own coupons only, safe fields only, numbers equal admin + SQL', async () => {
  proof.h('R1 setup: R-A1 (A1) used twice, R-A2 (A2) used once');
  const cA1 = await newCoupon(proof, f.orgA.id, { code: `${P}-A1`, name: `${f.prefix} R a1`, discountType: 'PERCENTAGE', discountValue: 10, maxRedemptions: 50, affiliateIds: [A1.id] });
  const cA2 = await newCoupon(proof, f.orgA.id, { code: `${P}-A2`, name: `${f.prefix} R a2`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [A2.id] });
  await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}1`, customerExternalId: `${O}c1`, amount: 90000, currency: 'INR', metadata: { couponCode: cA1.code } }, cA1.id);
  await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}2`, customerExternalId: `${O}c2`, amount: 45000, currency: 'INR', metadata: { couponCode: cA1.code } }, cA1.id);
  await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}3`, customerExternalId: `${O}c3`, amount: 90000, currency: 'INR', metadata: { couponCode: cA2.code } }, cA2.id);
  const s1 = await as('AFFILIATE_1');
  const r = await api('GET', `/affiliate/me/assigned-coupons?organizationId=${f.orgA.id}`, { token: s1.token });
  proof.http('GET', '/affiliate/me/assigned-coupons (AFFILIATE_1)', r);
  const list = r.data as any[];
  const expectedIds = (await sql(`SELECT c.id FROM organization_coupon_assignments a JOIN organization_coupons c ON c.id=a.couponId WHERE a.affiliateId=? AND c.status='ACTIVE' ORDER BY c.id`, [A1.id])).map((x: any) => x.id);
  proof.sql(`SELECT c.id FROM organization_coupon_assignments a JOIN organization_coupons c ... WHERE a.affiliateId='${A1.id}' AND c.status='ACTIVE'`, expectedIds);
  proof.check('ids == SQL', list.map((x) => x.id).sort(), expectedIds.sort());
  expect(list.map((x) => x.id).sort()).toEqual(expectedIds.sort());
  proof.check('A2 coupon absent', list.some((x) => x.id === cA2.id), false);
  expect(list.some((x) => x.id === cA2.id)).toBe(false);
  const extraKeys = [...new Set(list.flatMap((x) => Object.keys(x)).filter((k) => !ALLOWED.has(k)))];
  proof.check('non-contract keys', extraKeys, []);
  expect(extraKeys).toEqual([]);
  const mine = list.find((x) => x.id === cA1.id);
  // own SQL numbers for A1 on R-A1: 2 uses, paid 90000+45000, commission 7.5 % → 6750 + 3375 = 10125 paise
  const sqlNums = (await sql(`SELECT COUNT(*) uses, SUM(cm.commissionAmount - COALESCE(cm.reversedAmount,0)) earned
      FROM organization_coupon_redemptions r JOIN commissions cm ON cm.conversionId=r.conversionId AND cm.affiliateId=r.affiliateId
      WHERE r.couponId=? AND r.affiliateId=?`, [cA1.id, A1.id]))[0];
  proof.sql(`SELECT COUNT(*) uses, SUM(net commission) FROM organization_coupon_redemptions r JOIN commissions ... WHERE couponId='${cA1.id}' AND affiliateId='${A1.id}'`, sqlNums);
  proof.check('portal uses', mine?.uses, 2);
  proof.check('portal commissionEarned (₹)', mine?.commissionEarned, 101.25);
  proof.check('SQL earned (paise)', Number(sqlNums?.earned), 10125);
  expect(mine?.uses).toBe(2);
  expect(mine?.commissionEarned).toBe(101.25);
  expect(Number(sqlNums?.earned)).toBe(10125);
  const owner = await as('ORG_A_OWNER');
  const adm = await api('GET', orgPath(f.orgA.id, `/${cA1.id}/analytics`), { token: owner.token });
  proof.http('GET', orgPath(f.orgA.id, `/${cA1.id}/analytics`), adm);
  proof.check('admin redemptions == portal uses', adm.data?.metrics?.redemptions, mine?.uses);
  proof.check('admin commission == portal earned', adm.data?.metrics?.commission, mine?.commissionEarned);
  expect(adm.data?.metrics?.redemptions).toBe(mine?.uses);
  expect(adm.data?.metrics?.commission).toBe(mine?.commissionEarned);
});

test('R2 tampering: other org id, admin routes with affiliate token, no write route', async () => {
  const s1 = await as('AFFILIATE_1');
  proof.h('R2 tampering');
  const cases: [string, string, number[]][] = [
    ['GET', `/affiliate/me/assigned-coupons?organizationId=${f.orgB.id}`, [200]],
    ['GET', orgPath(f.orgA.id), [401, 403]],
    ['GET', orgPath(f.orgA.id, `/${f.orgA.coupons.FIX200.id}`), [401, 403]],
    ['PUT', orgPath(f.orgA.id, `/${f.orgA.coupons.FIX200.id}`), [401, 403]],
    ['POST', orgPath(f.orgA.id, `/${f.orgA.coupons.FIX200.id}/assign`), [401, 403]],
    ['GET', orgPath(f.orgA.id, `/validate/${f.orgA.coupons.FIX200.code}`), [401, 403]],
    ['POST', `/affiliate/me/assigned-coupons`, [404]],
  ];
  for (const [m, p, ok] of cases) {
    const body = m === 'GET' ? undefined : m === 'PUT' ? { name: 'hijack' } : { affiliateIds: [A1.id] };
    const r = await api(m, p, { token: s1.token, body, headers: { 'x-organization-id': f.orgA.id } });
    proof.http(m, p, r, body);
    proof.check(`${m} ${p}`, ok.includes(r.status), true);
    expect(ok, `${m} ${p} -> ${r.status}`).toContain(r.status);
    if (p.includes(f.orgB.id)) expect(r.data).toEqual([]);
    if (r.status === 200 && typeof r.body === 'object') expect(JSON.stringify(r.body)).not.toContain(f.orgA.coupons.FIX200.id);
  }
  const fix = (await sql(`SELECT name FROM organization_coupons WHERE id=?`, [f.orgA.coupons.FIX200.id]))[0];
  proof.check('A2 coupon name unchanged', fix.name.includes('hijack'), false);
  expect(fix.name.includes('hijack')).toBe(false);
  proof.note('Affiliate-requested codes: N/A — no such flow exists (inventory §1.2).');
});

test('R3 portal UI shows own coupons with real numbers (after refresh)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('partneriq_cookie_consent_v1', JSON.stringify({ hasResponded: true, strictlyNecessary: true, affiliateAttribution: true, analytics: false })));
  await page.goto(`${ENV.PORTAL_UI}/login`);
  await page.locator('input[type=email]').fill(f.users.AFFILIATE_1.email);
  await page.locator('input[type=password]').fill(ENV.PASSWORD);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30000 });
  await page.goto(`${ENV.PORTAL_UI}/coupons`);
  await page.reload();
  const code = `${P}-A1`;
  const card = page.locator('div.rounded-2xl', { hasText: code }).first();
  await expect(card).toBeVisible({ timeout: 20000 });
  const text = (await card.innerText()).replace(/\s+/g, ' ');
  proof.h('R3 portal card');
  proof.note(text);
  proof.check('card shows 2 uses', /USES 2/i.test(text), true);
  proof.check('card shows ₹101.25 earned', text.includes('₹101.25'), true);
  expect(text).toMatch(/USES 2/i);
  expect(text).toContain('₹101.25');
  const body = (await page.locator('body').innerText());
  proof.check('A2 coupon not on page', body.includes(`${P}-A2`), false);
  expect(body.includes(`${P}-A2`)).toBe(false);
});
