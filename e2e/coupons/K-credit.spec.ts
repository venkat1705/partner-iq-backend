import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { clickLink, F } from '../lib/coupons';
import { closeDb } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, sale } from '../lib/sales';
import { as } from '../lib/session';

/**
 * K — who gets credit. Rule (existing code + UI "Collision Priority", default PROMO_CODE = "Promo Code Wins
 * (Coupon Affiliate)"): a valid coupon assigned to exactly one affiliate credits that affiliate even if another
 * affiliate's link was clicked; program setting AFFILIATE ("Tracking Link Wins") credits the click affiliate.
 */
const proof = new Proof('K');
const f = F();
const P = `E2E-CPN-${f.run}-K`;
const O = `${f.prefix}-K-`;
const [A1, A2] = f.orgA.affiliates;
const pA1 = f.orgA.programs[0];

test.afterAll(async () => {
  await closeDb();
});

test('K1 coupon sale with no click → coupon, affiliate and program linked; commission to coupon affiliate', async () => {
  proof.h('K1 coupon only, no click');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-A1`, name: `${f.prefix} K a1`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [A1.id] });
  const s = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}1`, customerExternalId: `${O}cust1`, amount: 90000, currency: 'INR', metadata: { couponCode: `${P}-A1`.toLowerCase() } }, c.id);
  // own math: 7.5 % of ₹900.00 paid = 6750 paise
  proof.check('HTTP', s.status, 201);
  proof.check('conversion.affiliateId', s.conversion?.affiliateId, A1.id);
  proof.check('conversion.programId', s.conversion?.programId, pA1.id);
  proof.check('redemption.couponId', s.redemption?.couponId, c.id);
  proof.check('redemption.affiliateId', s.redemption?.affiliateId, A1.id);
  proof.check('commission rows', s.commissions.map((x: any) => [x.affiliateId, Number(x.commissionAmount)]), [[A1.id, 6750]]);
  proof.check('response coupon.applied', s.body?.data?.coupon?.applied, true);
  expect(s.status).toBe(201);
  expect(s.conversion?.affiliateId).toBe(A1.id);
  expect(s.conversion?.programId).toBe(pA1.id);
  expect(s.redemption?.couponId).toBe(c.id);
  expect(s.redemption?.affiliateId).toBe(A1.id);
  expect(s.commissions.map((x: any) => [x.affiliateId, Number(x.commissionAmount)])).toEqual([[A1.id, 6750]]);
  expect(s.body?.data?.coupon?.applied).toBe(true);
});

test('K2 AFFILIATE_1 link clicked, AFFILIATE_2 coupon used → PROMO_CODE (default) credits AFFILIATE_2', async () => {
  proof.h('K2 click A1 + coupon A2 (priority PROMO_CODE)');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-A2`, name: `${f.prefix} K a2`, discountType: 'FIXED_AMOUNT', discountValue: 200, affiliateIds: [A2.id] });
  const click = await clickLink(A1.id, f.orgA.id);
  proof.note(`GET /r/${click.shortCode} -> HTTP ${click.status} Location: ${click.location}`);
  expect(click.clickId).not.toBe('');
  const s = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}2`, customerExternalId: `${O}cust2`, clickId: click.clickId, amount: 80000, currency: 'INR', metadata: { couponCode: `${P}-A2` } }, c.id);
  proof.check('conversion.affiliateId', s.conversion?.affiliateId, A2.id);
  proof.check('commission to', s.commissions.map((x: any) => x.affiliateId), [A2.id]);
  proof.check('redemption.affiliateId', s.redemption?.affiliateId, A2.id);
  expect(s.conversion?.affiliateId).toBe(A2.id);
  expect(s.commissions.map((x: any) => x.affiliateId)).toEqual([A2.id]);
  expect(s.redemption?.affiliateId).toBe(A2.id);
});

test('K3 program priority AFFILIATE ("Tracking Link Wins") → click affiliate credited, coupon still counted', async () => {
  proof.h('K3 click K-A + coupon K-B in a program created with priority AFFILIATE');
  // Attribution settings are locked once affiliates join a program (existing rule), so K3 uses its own program.
  const owner = await as('ORG_A_OWNER');
  const stamp = Date.now().toString(36);
  const prog = await api('POST', `/organizations/${f.orgA.id}/programs`, { token: owner.token, body: { name: `${f.prefix}-K-prog-${stamp}`, slug: `${f.prefix}-k-prog-${stamp}`, type: 'AFFILIATE', commissionType: 'PERCENTAGE', defaultCommissionValue: 750, attributionModel: 'LAST_CLICK', status: 'ACTIVE', currency: 'INR', couponAttributionPriority: 'AFFILIATE' } });
  proof.http('POST', `/organizations/${f.orgA.id}/programs`, prog, { couponAttributionPriority: 'AFFILIATE' });
  expect(prog.status).toBe(201);
  expect(prog.data.couponAttributionPriority).toBe('AFFILIATE');
  const mk = async (who: string) => {
    const r = await api('POST', `/organizations/${f.orgA.id}/affiliates`, { token: owner.token, body: { displayName: `${f.prefix} K ${who} ${stamp}`, email: `${f.prefix}-k-${who.toLowerCase()}-${stamp}@example.test`, programId: prog.data.id } });
    expect(r.status).toBe(201);
    return (r.data.affiliate?.id || r.data.id) as string;
  };
  const kA = await mk('A');
  const kB = await mk('B');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-PRIO-${stamp}`.toUpperCase(), name: `${f.prefix} K prio`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [kB] });
  const click = await clickLink(kA, f.orgA.id);
  const s = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}3-${stamp}`, customerExternalId: `${O}cust3-${stamp}`, clickId: click.clickId, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
  proof.check('conversion.affiliateId (click affiliate K-A)', s.conversion?.affiliateId, kA);
  proof.check('redemption exists (coupon use counted)', Boolean(s.redemption), true);
  proof.check('redemption.affiliateId (who got credit)', s.redemption?.affiliateId, kA);
  expect(s.conversion?.affiliateId).toBe(kA);
  expect(s.redemption?.affiliateId).toBe(kA);
});

test('K4 unassigned coupon, no click → coupon counted, nobody credited (no fallback affiliate)', async () => {
  proof.h('K4 unassigned coupon');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-NONE`, name: `${f.prefix} K none`, discountType: 'PERCENTAGE', discountValue: 10 });
  const s = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}4`, customerExternalId: `${O}cust4`, amount: 90000, currency: 'INR', metadata: { couponCode: `${P}-NONE` } }, c.id);
  proof.check('conversion.affiliateId', s.conversion?.affiliateId ?? null, null);
  proof.check('commissions', s.commissions.length, 0);
  proof.check('redemption exists', Boolean(s.redemption), true);
  expect(s.conversion?.affiliateId ?? null).toBe(null);
  expect(s.commissions.length).toBe(0);
  expect(Boolean(s.redemption)).toBe(true);
});

test('K5 Org B coupon code sent with Org A key → not applied in Org A, Org B untouched', async () => {
  proof.h('K5 foreign code');
  const s = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}5`, customerExternalId: `${O}cust5`, amount: 50000, currency: 'INR', metadata: { couponCode: f.orgB.coupons.BONLY.code } }, f.orgB.coupons.BONLY.id);
  proof.check('response coupon.applied', s.body?.data?.coupon?.applied, false);
  proof.check('Org B redemption created', Boolean(s.redemption), false);
  expect(s.body?.data?.coupon?.applied).toBe(false);
  expect(Boolean(s.redemption)).toBe(false);
});
