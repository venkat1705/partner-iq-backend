import { expect, test } from '@playwright/test';
import { F, recordSale } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, usageCount } from '../lib/sales';

/** O — same order (externalId) twice, then 10 at once: one sale, one commission, one coupon use. */
const proof = new Proof('O');
const f = F();
const P = `E2E-CPN-${f.run}-O`;
const O = `${f.prefix}-O-`;
test.afterAll(async () => closeDb());

async function counts(ext: string, couponId: string) {
  const conv = await sql(`SELECT id FROM conversions WHERE organizationId=? AND externalId=?`, [f.orgA.id, ext]);
  const comm = conv.length ? await sql(`SELECT id FROM commissions WHERE conversionId IN (?)`, [conv.map((c: any) => c.id)]) : [];
  const res = { conversions: conv.length, commissions: comm.length, uses: await usageCount(couponId) };
  proof.sql(`SELECT conversions/commissions/uses for externalId='${ext}'`, res);
  return res;
}

test('O1 same order twice (sequential), with and without Idempotency-Key', async () => {
  proof.h('O1 sequential duplicate');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-SEQ`, name: `${f.prefix} O seq`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [f.orgA.affiliates[0].id] });
  const body = { externalId: `${O}seq`, customerExternalId: `${O}c`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } };
  const r1 = await recordSale(f.orgA.apiKey, body);
  const r2 = await recordSale(f.orgA.apiKey, body);
  proof.http('POST', '/conversions', r1, body);
  proof.http('POST', '/conversions (again)', r2, body);
  const k1 = await recordSale(f.orgA.apiKey, { ...body, externalId: `${O}idem` }, { 'Idempotency-Key': `${O}key` });
  const k2 = await recordSale(f.orgA.apiKey, { ...body, externalId: `${O}idem` }, { 'Idempotency-Key': `${O}key` });
  proof.http('POST', '/conversions Idempotency-Key', k1);
  proof.http('POST', '/conversions Idempotency-Key (replay)', k2);
  await new Promise((r) => setTimeout(r, 400));
  expect(r1.status).toBe(201);
  expect(r2.status).toBe(409);
  expect(k1.status).toBe(201);
  expect([200, 201]).toContain(k2.status);
  expect(k2.body?.data?.conversion?.id).toBe(k1.body?.data?.conversion?.id);
  expect(await counts(`${O}seq`, c.id)).toEqual({ conversions: 1, commissions: 1, uses: 2 });
  expect((await counts(`${O}idem`, c.id)).conversions).toBe(1);
});

test('O2 same order 10 times at once', async () => {
  proof.h('O2 concurrent duplicate');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-PAR`, name: `${f.prefix} O par`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [f.orgA.affiliates[0].id] });
  const body = { externalId: `${O}par`, customerExternalId: `${O}p`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } };
  const rs = await Promise.all(Array.from({ length: 10 }, () => recordSale(f.orgA.apiKey, body)));
  rs.forEach((r, i) => proof.note(`#${i}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`));
  await new Promise((r) => setTimeout(r, 500));
  const n = await counts(`${O}par`, c.id);
  proof.check('statuses', rs.map((r) => r.status).sort(), [201, ...Array(9).fill(409)]);
  proof.check('rows', n, { conversions: 1, commissions: 1, uses: 1 });
  expect(rs.map((r) => r.status).sort()).toEqual([201, ...Array(9).fill(409)]);
  expect(n).toEqual({ conversions: 1, commissions: 1, uses: 1 });
});
