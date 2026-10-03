import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, sale, usageCount } from '../lib/sales';
import { as } from '../lib/session';

/** I — paused / archived / expired coupons are refused at sale time; "delete" = archive; history stays linked. */
const proof = new Proof('I');
const f = F();
const P = `E2E-CPN-${f.run}-I`;
const O = `${f.prefix}-I-`;
const A1 = f.orgA.affiliates[0];

test.afterAll(async () => {
  await closeDb();
});

for (const key of ['PAUSED', 'ARCHIVED', 'EXPIRED'] as const) {
  test(`I1 seeded ${key} coupon is refused when used`, async () => {
    proof.h(`I1 ${key}`);
    const c = f.orgA.coupons[key];
    const before = await usageCount(c.id);
    const s = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}${key}`, customerExternalId: `${O}c-${key}`, amount: 50000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
    proof.check('HTTP (sale recorded)', s.status, 201);
    proof.check('coupon.applied', s.body?.data?.coupon?.applied, false);
    proof.check('redemptions unchanged', await usageCount(c.id), before);
    expect(s.status).toBe(201);
    expect(s.body?.data?.coupon?.applied).toBe(false);
    expect(await usageCount(c.id)).toBe(before);
  });
}

test('I2 pause → refused, reactivate → works again', async () => {
  proof.h('I2 pause/resume');
  const owner = await as('ORG_A_OWNER');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-TOGGLE`, name: `${f.prefix} I toggle`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [A1.id] });
  const p = await api('POST', orgPath(f.orgA.id, `/${c.id}/status`), { token: owner.token, body: { status: 'PAUSED' } });
  proof.http('POST', orgPath(f.orgA.id, `/${c.id}/status`), p, { status: 'PAUSED' });
  const s1 = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}T1`, customerExternalId: `${O}t1`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
  const a = await api('POST', orgPath(f.orgA.id, `/${c.id}/status`), { token: owner.token, body: { status: 'ACTIVE' } });
  proof.http('POST', orgPath(f.orgA.id, `/${c.id}/status`), a, { status: 'ACTIVE' });
  const s2 = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}T2`, customerExternalId: `${O}t2`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
  expect(s1.body?.data?.coupon?.applied).toBe(false);
  expect(s2.body?.data?.coupon?.applied).toBe(true);
  expect(await usageCount(c.id)).toBe(1);
});

test('I3 delete a used coupon: no hard delete; archive keeps sales linked; code not reusable; archived cannot be reactivated', async () => {
  proof.h('I3 delete/archive used coupon');
  const owner = await as('ORG_A_OWNER');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-DEL`, name: `${f.prefix} I del`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [A1.id] });
  await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}D1`, customerExternalId: `${O}d1`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
  const del = await api('DELETE', orgPath(f.orgA.id, `/${c.id}`), { token: owner.token });
  proof.http('DELETE', orgPath(f.orgA.id, `/${c.id}`), del);
  const arch = await api('POST', orgPath(f.orgA.id, `/${c.id}/status`), { token: owner.token, body: { status: 'ARCHIVED' } });
  proof.http('POST', orgPath(f.orgA.id, `/${c.id}/status`), arch, { status: 'ARCHIVED' });
  const linked = await sql(`SELECT r.conversionId, c.status coupon_status, v.externalId FROM organization_coupon_redemptions r JOIN organization_coupons c ON c.id=r.couponId JOIN conversions v ON v.id=r.conversionId WHERE r.couponId=?`, [c.id]).catch((e) => String(e.message));
  proof.sql(`SELECT r.conversionId, c.status, v.externalId FROM organization_coupon_redemptions r JOIN organization_coupons c ... WHERE r.couponId='${c.id}'`, linked);
  const reuse = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { code: c.code, name: `${f.prefix} I reuse`, discountType: 'PERCENTAGE', discountValue: 10 } });
  proof.http('POST', orgPath(f.orgA.id), reuse, { code: c.code });
  const reactivate = await api('POST', orgPath(f.orgA.id, `/${c.id}/status`), { token: owner.token, body: { status: 'ACTIVE' } });
  proof.http('POST', orgPath(f.orgA.id, `/${c.id}/status`), reactivate, { status: 'ACTIVE' });
  proof.check('DELETE route', del.status, 404);
  proof.check('archive', arch.status, 201);
  proof.check('sales still linked', Array.isArray(linked) ? linked.length : linked, 1);
  proof.check('code reuse', reuse.status, 409);
  proof.check('reactivate archived', reactivate.status, 400);
  expect(del.status).toBe(404);
  expect(arch.status).toBe(201);
  expect(Array.isArray(linked) ? linked.length : -1).toBe(1);
  expect(reuse.status).toBe(409);
  expect(reactivate.status).toBe(400);
});
