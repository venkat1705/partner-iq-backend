import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, sale } from '../lib/sales';
import { as } from '../lib/session';

/** J — move a coupon from AFFILIATE_1 to AFFILIATE_2: old sales/commissions stay with A1, new ones go to A2. */
const proof = new Proof('J');
const f = F();
const P = `E2E-CPN-${f.run}-J`;
const O = `${f.prefix}-J-`;
const [A1, A2] = f.orgA.affiliates;

test.afterAll(async () => {
  await closeDb();
});

test('J1 use under A1, move to A2, use again; analytics + both portals', async () => {
  const owner = await as('ORG_A_OWNER');
  proof.h('J1 move coupon A1 → A2');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-MOVE`, name: `${f.prefix} J move`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [A1.id] });
  const s1 = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}1`, customerExternalId: `${O}c1`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
  const un = await api('DELETE', orgPath(f.orgA.id, `/${c.id}/assign/${A1.id}`), { token: owner.token });
  proof.http('DELETE', orgPath(f.orgA.id, `/${c.id}/assign/${A1.id}`), un);
  const as2 = await api('POST', orgPath(f.orgA.id, `/${c.id}/assign`), { token: owner.token, body: { affiliateIds: [A2.id] } });
  proof.http('POST', orgPath(f.orgA.id, `/${c.id}/assign`), as2, { affiliateIds: [A2.id] });
  const s2 = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}2`, customerExternalId: `${O}c2`, amount: 45000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
  const again1 = await api('GET', `/organizations/${f.orgA.id}/conversions`, { token: owner.token });
  const s1now = (again1.data.items || again1.data.data || again1.data).find((x: any) => x.externalId === `${O}1`);
  proof.check('sale1 affiliate (after move)', s1now?.affiliateId, A1.id);
  proof.check('sale1 commission to', s1.commissions.map((x: any) => x.affiliateId), [A1.id]);
  proof.check('sale2 affiliate', s2.conversion?.affiliateId, A2.id);
  proof.check('sale2 commission to', s2.commissions.map((x: any) => x.affiliateId), [A2.id]);
  expect(s1now?.affiliateId).toBe(A1.id);
  expect(s1.commissions.map((x: any) => x.affiliateId)).toEqual([A1.id]);
  expect(s2.conversion?.affiliateId).toBe(A2.id);
  expect(s2.commissions.map((x: any) => x.affiliateId)).toEqual([A2.id]);

  const byAff = await api('GET', orgPath(f.orgA.id, '/analytics/by-affiliate'), { token: owner.token });
  proof.http('GET', orgPath(f.orgA.id, '/analytics/by-affiliate'), byAff);
  const row = (id: string) => byAff.data.find((x: any) => x.affiliateId === id);
  // own math: A1 one redemption of ₹900 paid (+₹100 discount) → gross ₹1000; A2 ₹450 paid → gross ₹500
  proof.check('by-affiliate A1 redemptions (history kept)', row(A1.id)?.redemptions, 1);
  proof.check('by-affiliate A2 redemptions', row(A2.id)?.redemptions, 1);
  proof.check('by-affiliate A1 commission ₹', row(A1.id)?.commission, 67.5);
  proof.check('by-affiliate A2 commission ₹', row(A2.id)?.commission, 33.75);
  expect(row(A1.id)?.redemptions).toBe(1);
  expect(row(A2.id)?.redemptions).toBe(1);
  expect(row(A1.id)?.commission).toBe(67.5);
  expect(row(A2.id)?.commission).toBe(33.75);

  for (const [role, expectHas] of [['AFFILIATE_1', false], ['AFFILIATE_2', true]] as const) {
    const s = await as(role);
    const r = await api('GET', `/affiliate/me/assigned-coupons?organizationId=${f.orgA.id}`, { token: s.token });
    proof.http('GET', `/affiliate/me/assigned-coupons (${role})`, r);
    const has = (r.data as any[]).some((x) => x.id === c.id);
    proof.check(`${role} portal lists moved coupon`, has, expectHas);
    expect(has).toBe(expectHas);
  }
});

test('J2 assign to an affiliate of another organization → 404, nothing assigned', async () => {
  const owner = await as('ORG_A_OWNER');
  proof.h('J2 cross-org assignment');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-X`, name: `${f.prefix} J x`, discountType: 'PERCENTAGE', discountValue: 10 });
  const r = await api('POST', orgPath(f.orgA.id, `/${c.id}/assign`), { token: owner.token, body: { affiliateIds: [f.orgB.affiliates[0].id] } });
  proof.http('POST', orgPath(f.orgA.id, `/${c.id}/assign`), r, { affiliateIds: [f.orgB.affiliates[0].id] });
  const g = await api('GET', orgPath(f.orgA.id, `/${c.id}`), { token: owner.token });
  expect(r.status).toBe(404);
  expect(g.data.assignedAffiliates.length).toBe(0);
  proof.note('N/A: "affiliate not in the coupon\'s program" — organization coupons have no program (inventory R12); the only membership boundary is the organization.');
});
