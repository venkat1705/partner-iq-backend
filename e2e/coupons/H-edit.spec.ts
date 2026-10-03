import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath, recordSale, redemptions } from '../lib/coupons';
import { closeDb, sql, sqlOne } from '../lib/db';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';

/** H (+X for update) — edit every field; edits on a used coupon; past sales must not change. */
const proof = new Proof('H');
const f = F();
const P = `E2E-CPN-${f.run}-H`;
const order = `${f.prefix}-H-`;

test.afterAll(async () => {
  await closeDb();
});

const row = (id: string) => sqlOne(`SELECT code, normalizedCode, name, description, discountType, discountValue, maxRedemptions, validFrom, validUntil, status FROM organization_coupons WHERE id=?`, [id]);

test('H1 edit every editable field, verify API, SQL and GET after edit', async () => {
  const owner = await as('ORG_A_OWNER');
  const c = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { code: `${P}-ALL`, name: `${f.prefix} H all`, discountType: 'PERCENTAGE', discountValue: 10 } });
  expect(c.status).toBe(201);
  const patch = { name: `${f.prefix} H all renamed`, description: 'edited desc', discountType: 'FIXED_AMOUNT', discountValue: 150, maxRedemptions: 7, validFrom: '2026-11-01', validUntil: '2026-11-30' };
  const u = await api('PUT', orgPath(f.orgA.id, `/${c.data.id}`), { token: owner.token, body: patch });
  proof.h('H1 edit all fields');
  proof.http('PUT', orgPath(f.orgA.id, `/${c.data.id}`), u, patch);
  await new Promise((r) => setTimeout(r, 300));
  const db = await row(c.data.id);
  proof.sql(`SELECT ... FROM organization_coupons WHERE id='${c.data.id}'`, db);
  const g = await api('GET', orgPath(f.orgA.id, `/${c.data.id}`), { token: owner.token });
  proof.http('GET', orgPath(f.orgA.id, `/${c.data.id}`), g);
  expect(u.status).toBe(200);
  expect(db).toMatchObject({ name: patch.name, description: 'edited desc', discountType: 'FIXED_AMOUNT', maxRedemptions: 7 });
  expect(Number(db!.discountValue)).toBe(150);
  // Asia/Kolkata (UTC+5:30): 2026-11-01 00:00 IST = 2026-10-31T18:30Z; end of 2026-11-30 IST = 2026-11-30T18:29:59.999Z
  proof.check('validFrom (org tz start of day, UTC)', new Date(db!.validFrom).toISOString(), '2026-10-31T18:30:00.000Z');
  proof.check('validUntil (org tz end of day, UTC, second precision)', new Date(db!.validUntil).toISOString().slice(0, 19), '2026-11-30T18:29:59');
  expect(new Date(db!.validFrom).toISOString()).toBe('2026-10-31T18:30:00.000Z');
  expect(new Date(db!.validUntil).toISOString().slice(0, 19)).toBe('2026-11-30T18:29:59');
  expect(g.data.name).toBe(patch.name);
});

test('H2 X: invalid edit (end before start) is rejected and changes NOTHING', async () => {
  const owner = await as('ORG_A_OWNER');
  const c = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { code: `${P}-X`, name: `${f.prefix} H x`, discountType: 'PERCENTAGE', discountValue: 10 } });
  const before = await row(c.data.id);
  const patch = { name: `${f.prefix} H x SHOULD-NOT-SAVE`, discountValue: 55, validFrom: '2026-12-10', validUntil: '2026-12-01' };
  const u = await api('PUT', orgPath(f.orgA.id, `/${c.data.id}`), { token: owner.token, body: patch });
  proof.h('H2 rejected edit');
  proof.http('PUT', orgPath(f.orgA.id, `/${c.data.id}`), u, patch);
  await new Promise((r) => setTimeout(r, 300));
  const after = await row(c.data.id);
  const g = await api('GET', orgPath(f.orgA.id, `/${c.data.id}`), { token: owner.token });
  proof.sql(`SELECT ... WHERE id='${c.data.id}' (before)`, before);
  proof.sql(`SELECT ... WHERE id='${c.data.id}' (after)`, after);
  proof.http('GET', orgPath(f.orgA.id, `/${c.data.id}`), g);
  proof.check('status', u.status, 400);
  proof.check('SQL unchanged', after, before);
  proof.check('GET name unchanged', g.data.name, `${f.prefix} H x`);
  proof.check('GET discountValue unchanged', g.data.discountValue, 10);
  expect(u.status).toBe(400);
  expect(after).toEqual(before);
  expect(g.data.name).toBe(`${f.prefix} H x`);
  expect(g.data.discountValue).toBe(10);
});

test('H3 used coupon: code change, limit below usage, end date in past, discount change — past sales unchanged', async () => {
  const owner = await as('ORG_A_OWNER');
  const a1 = f.orgA.affiliates[0];
  const c = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { code: `${P}-USED`, name: `${f.prefix} H used`, discountType: 'PERCENTAGE', discountValue: 10, maxRedemptions: 5, affiliateIds: [a1.id] } });
  expect(c.status).toBe(201);
  // two uses: paid ₹900 and ₹450 after 10 % off (gross ₹1000 / ₹500)
  for (const [i, paid] of [[1, 90000], [2, 45000]] as const) {
    const s = await recordSale(f.orgA.apiKey, { externalId: `${order}${i}`, customerExternalId: `${f.prefix}-H-cust-${i}`, amount: paid, currency: 'INR', metadata: { couponCode: `${P}-USED` } });
    proof.h(`H3 sale ${i}`);
    proof.http('POST', '/conversions', s, { externalId: `${order}${i}`, amount: paid, metadata: { couponCode: `${P}-USED` } });
    expect(s.status).toBe(201);
  }
  const before = await redemptions(c.data.id);
  proof.sql(`SELECT * FROM organization_coupon_redemptions WHERE couponId='${c.data.id}'`, before);
  expect(before?.length).toBe(2);

  const det0 = await api('GET', orgPath(f.orgA.id, `/${c.data.id}/analytics`), { token: owner.token });
  proof.http('GET', orgPath(f.orgA.id, `/${c.data.id}/analytics`), det0);

  // code change: code is immutable once created (UI disables it) — must be rejected.
  const codeChange = await api('PUT', orgPath(f.orgA.id, `/${c.data.id}`), { token: owner.token, body: { code: `${P}-RENAMED` } });
  proof.h('H3 change code of used coupon');
  proof.http('PUT', orgPath(f.orgA.id, `/${c.data.id}`), codeChange, { code: `${P}-RENAMED` });
  proof.check('status', codeChange.status, 400);
  expect(codeChange.status).toBe(400);

  const lower = await api('PUT', orgPath(f.orgA.id, `/${c.data.id}`), { token: owner.token, body: { maxRedemptions: 1 } });
  proof.h('H3 limit below current usage (2 used, set 1)');
  proof.http('PUT', orgPath(f.orgA.id, `/${c.data.id}`), lower, { maxRedemptions: 1 });
  proof.check('status', lower.status, 400);
  expect(lower.status).toBe(400);

  const past = await api('PUT', orgPath(f.orgA.id, `/${c.data.id}`), { token: owner.token, body: { validUntil: '2026-01-31' } });
  proof.h('H3 end date in the past (allowed: coupon simply expires)');
  proof.http('PUT', orgPath(f.orgA.id, `/${c.data.id}`), past, { validUntil: '2026-01-31' });
  expect(past.status).toBe(200);

  const disc = await api('PUT', orgPath(f.orgA.id, `/${c.data.id}`), { token: owner.token, body: { discountValue: 50, validUntil: '2027-01-31' } });
  proof.h('H3 discount 10 → 50 after use');
  proof.http('PUT', orgPath(f.orgA.id, `/${c.data.id}`), disc, { discountValue: 50 });
  expect(disc.status).toBe(200);

  const after = await redemptions(c.data.id);
  proof.sql(`SELECT * FROM organization_coupon_redemptions WHERE couponId='${c.data.id}' (after edits)`, after);
  const det = await api('GET', orgPath(f.orgA.id, `/${c.data.id}/analytics`), { token: owner.token });
  proof.http('GET', orgPath(f.orgA.id, `/${c.data.id}/analytics`), det);
  // own math: discount 10 % on gross 1000 + 500 = ₹150.00 must stay ₹150.00 after the 50 % edit
  proof.check('past discount total (₹)', det.data.metrics.discount, 150);
  proof.check('past redemption rows unchanged', after?.map((r: any) => [r.discountAmount, r.orderAmount]), before?.map((r: any) => [r.discountAmount, r.orderAmount]));
  expect(det.data.metrics.discount).toBe(150);
  expect(after?.map((r: any) => [r.discountAmount, r.orderAmount])).toEqual(before?.map((r: any) => [r.discountAmount, r.orderAmount]));
  const conv = await sql(`SELECT externalId, amount, affiliateId FROM conversions WHERE externalId LIKE ? ORDER BY externalId`, [`${order}%`]);
  proof.sql(`SELECT externalId, amount, affiliateId FROM conversions WHERE externalId LIKE '${order}%'`, conv);
  expect(conv.map((r: any) => Number(r.amount))).toEqual([90000, 45000]);
});
