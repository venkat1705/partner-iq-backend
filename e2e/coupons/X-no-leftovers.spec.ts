import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath, recordSale } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, usageCount } from '../lib/sales';
import { as } from '../lib/session';

/**
 * X — rejected requests leave nothing behind (memory = GET, and MySQL). Per-case checks also live in E, H, M, W;
 * this spec repeats one representative 4xx of each kind and checks both layers plus a backend restart is not needed.
 */
const proof = new Proof('X');
const f = F();
const P = `E2E-CPN-${f.run}-X`;
const O = `${f.prefix}-X-`;
test.afterAll(async () => closeDb());

test('X1 create with unknown affiliate (404) leaves no coupon (memory + SQL)', async () => {
  const owner = await as('ORG_A_OWNER');
  const body = { code: `${P}-AFF`, name: `${f.prefix} X aff`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: ['00000000-0000-4000-8000-000000000000'] };
  const r = await api('POST', orgPath(f.orgA.id), { token: owner.token, body });
  proof.http('POST', orgPath(f.orgA.id), r, body);
  await new Promise((res) => setTimeout(res, 500));
  const mem = (await api('GET', orgPath(f.orgA.id), { token: owner.token })).data.filter((c: any) => c.code.toUpperCase() === `${P}-AFF`);
  const db = await sql(`SELECT id FROM organization_coupons WHERE organizationId=? AND normalizedCode=?`, [f.orgA.id, `${P}-AFF`]);
  proof.sql(`SELECT id FROM organization_coupons WHERE normalizedCode='${P}-AFF'`, db);
  const again = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { ...body, affiliateIds: undefined } });
  proof.http('POST (same code, valid) after the rejected one', orgPath(f.orgA.id), again);
  proof.check('status', r.status, 404);
  proof.check('memory rows', mem.length, 0);
  proof.check('SQL rows', db.length, 0);
  proof.check('code still free afterwards', again.status, 201);
  expect(r.status).toBe(404);
  expect(mem.length).toBe(0);
  expect(db.length).toBe(0);
  expect(again.status).toBe(201);
});

test('X2 update rejected (400) changes neither memory nor SQL', async () => {
  const owner = await as('ORG_A_OWNER');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-UPD`, name: `${f.prefix} X upd`, discountType: 'PERCENTAGE', discountValue: 10 });
  const r = await api('PUT', orgPath(f.orgA.id, `/${c.id}`), { token: owner.token, body: { name: 'X SHOULD NOT SAVE', validFrom: '2026-12-10', validUntil: '2026-12-01' } });
  proof.http('PUT', orgPath(f.orgA.id, `/${c.id}`), r);
  await new Promise((res) => setTimeout(res, 500));
  const mem = await api('GET', orgPath(f.orgA.id, `/${c.id}`), { token: owner.token });
  const db = await sql(`SELECT name, validFrom, validUntil FROM organization_coupons WHERE id=?`, [c.id]);
  proof.sql(`SELECT name, validFrom, validUntil FROM organization_coupons WHERE id='${c.id}'`, db);
  expect(r.status).toBe(400);
  expect(mem.data.name).toBe(`${f.prefix} X upd`);
  expect(mem.data.validFrom ?? null).toBe(null);
  expect(db[0].name).toBe(`${f.prefix} X upd`);
  expect(db[0].validFrom).toBe(null);
});

test('X3 refused coupon use (limit reached) leaves no use row and no coupon credit', async () => {
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-LIM`, name: `${f.prefix} X lim`, discountType: 'PERCENTAGE', discountValue: 10, maxRedemptions: 1, affiliateIds: [f.orgA.affiliates[0].id] });
  await recordSale(f.orgA.apiKey, { externalId: `${O}1`, customerExternalId: `${O}a`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } });
  const r = await recordSale(f.orgA.apiKey, { externalId: `${O}2`, customerExternalId: `${O}b`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } });
  proof.http('POST', '/conversions (limit reached)', r);
  await new Promise((res) => setTimeout(res, 400));
  const conv = await sql(`SELECT affiliateId FROM conversions WHERE externalId=?`, [`${O}2`]);
  proof.sql(`SELECT affiliateId FROM conversions WHERE externalId='${O}2'`, conv);
  expect(r.body?.data?.coupon?.applied).toBe(false);
  expect(await usageCount(c.id)).toBe(1);
  expect(conv[0]?.affiliateId ?? null).toBe(null);
});
