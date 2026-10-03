import { expect, test } from '@playwright/test';
import { F, recordSale } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, usageCount } from '../lib/sales';

/** N — last-use race: max 5, 4 used, then 10 concurrent sales: exactly 1 applies, count never exceeds 5. */
const proof = new Proof('N');
const f = F();
const P = `E2E-CPN-${f.run}-N`;
const O = `${f.prefix}-N-`;
test.afterAll(async () => closeDb());

test('N 10 concurrent uses with 1 left', async () => {
  proof.h('N setup: maxRedemptions 5, 4 sequential uses');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-LAST`, name: `${f.prefix} N last`, discountType: 'PERCENTAGE', discountValue: 10, maxRedemptions: 5, affiliateIds: [f.orgA.affiliates[0].id] });
  for (let i = 1; i <= 4; i++) {
    const r = await recordSale(f.orgA.apiKey, { externalId: `${O}seq-${i}`, customerExternalId: `${O}s${i}`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } });
    expect(r.status).toBe(201);
  }
  proof.check('uses before race', await usageCount(c.id), 4);
  expect(await usageCount(c.id)).toBe(4);
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    recordSale(f.orgA.apiKey, { externalId: `${O}race-${i}`, customerExternalId: `${O}r${i}`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } })));
  proof.h('N race: 10 parallel POST /conversions');
  rs.forEach((r, i) => proof.note(`race-${i}: HTTP ${r.status} coupon=${JSON.stringify(r.body?.data?.coupon)}`));
  await new Promise((r) => setTimeout(r, 500));
  const applied = rs.filter((r) => r.body?.data?.coupon?.applied === true).length;
  const used = await usageCount(c.id);
  const rows = await sql(`SELECT r.conversionId, v.externalId FROM organization_coupon_redemptions r JOIN conversions v ON v.id=r.conversionId WHERE r.couponId=? ORDER BY r.createdAt`, [c.id]).catch((e) => String(e.message));
  proof.sql(`SELECT r.conversionId, v.externalId FROM organization_coupon_redemptions r JOIN conversions v ... WHERE r.couponId='${c.id}'`, rows);
  const conv = await sql(`SELECT COUNT(*) n FROM conversions WHERE externalId LIKE ?`, [`${O}race-%`]);
  proof.sql(`SELECT COUNT(*) FROM conversions WHERE externalId LIKE '${O}race-%'`, conv);
  proof.check('all 10 sales recorded (HTTP 201)', rs.map((r) => r.status), Array(10).fill(201));
  proof.check('exactly one applied', applied, 1);
  proof.check('uses after race (never above 5)', used, 5);
  expect(rs.map((r) => r.status)).toEqual(Array(10).fill(201));
  expect(applied).toBe(1);
  expect(used).toBe(5);
  const usageRow = await sql(`SELECT redemptionCount FROM organization_coupon_usage WHERE couponId=?`, [c.id]).catch((e) => String(e.message));
  proof.sql(`SELECT redemptionCount FROM organization_coupon_usage WHERE couponId='${c.id}'`, usageRow);
  proof.note('Protection: see docs/coupons-audit.md §N — row lock (SELECT … FOR UPDATE) on organization_coupon_usage inside a MySQL transaction.');
});
