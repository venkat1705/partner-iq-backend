import { expect, test } from '@playwright/test';
import { F, roundHalfUp } from '../lib/coupons';
import { closeDb } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, sale } from '../lib/sales';

/**
 * L — discount and commission math. Contract (decisions D5/D6): `amount` = what the customer paid after the
 * discount, excl. tax/shipping (= commission base). Optional metadata.orderSubtotal = price before discount.
 * Discounts are stored per sale (paise) in organization_coupon_redemptions. Program A1 = 7.5 % (750 bps).
 * All expected numbers below are computed here by hand, not by the app.
 */
const proof = new Proof('L');
const f = F();
const P = `E2E-CPN-${f.run}-L`;
const O = `${f.prefix}-L-`;
const A1 = f.orgA.affiliates[0];

test.afterAll(async () => {
  await closeDb();
});

interface Case { key: string; type: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: number; subtotal: number; }
const cases: Case[] = [
  { key: 'PCT10', type: 'PERCENTAGE', value: 10, subtotal: 100000 },
  { key: 'FIX200', type: 'FIXED_AMOUNT', value: 200, subtotal: 100000 },
  { key: 'ROUND', type: 'PERCENTAGE', value: 12.5, subtotal: 99999 },
  { key: 'FIXBIG', type: 'FIXED_AMOUNT', value: 1500, subtotal: 100000 },
  { key: 'FREE', type: 'PERCENTAGE', value: 100, subtotal: 49900 },
  { key: 'FIXDEC', type: 'FIXED_AMOUNT', value: 99.5, subtotal: 25000 },
];

for (const c of cases) {
  test(`L ${c.key}: ${c.type} ${c.value} on ₹${(c.subtotal / 100).toFixed(2)}`, async () => {
    proof.h(`L ${c.key}`);
    const discount = c.type === 'PERCENTAGE' ? roundHalfUp((c.subtotal * c.value) / 100) : Math.min(roundHalfUp(c.value * 100), c.subtotal);
    const paid = c.subtotal - discount;
    const commission = roundHalfUp((paid * 750) / 10000);
    proof.note(`hand math: subtotal=${c.subtotal} paise, discount=${discount}, paid=${paid}, commission 7.5%=${(paid * 0.075).toFixed(3)} → ${commission}`);
    const coupon = await newCoupon(proof, f.orgA.id, { code: `${P}-${c.key}`, name: `${f.prefix} L ${c.key}`, discountType: c.type, discountValue: c.value, affiliateIds: [A1.id] });
    const s = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}${c.key}`, customerExternalId: `${O}cust-${c.key}`, amount: paid, currency: 'INR', metadata: { couponCode: coupon.code, orderSubtotal: c.subtotal } }, coupon.id);
    const net = s.commissions.reduce((a: number, x: any) => a + Number(x.commissionAmount) - Number(x.reversedAmount || 0), 0);
    proof.check('HTTP', s.status, 201);
    proof.check('stored discountAmount', Number(s.redemption?.discountAmount), discount);
    proof.check('stored orderAmount (paid)', Number(s.redemption?.orderAmount), paid);
    proof.check('stored grossAmount', Number(s.redemption?.grossAmount), c.subtotal);
    proof.check('conversion.amount', Number(s.conversion?.amount), paid);
    proof.check('net commission', net, commission);
    expect(s.status).toBe(201);
    expect(Number(s.redemption?.discountAmount)).toBe(discount);
    expect(Number(s.redemption?.orderAmount)).toBe(paid);
    expect(Number(s.redemption?.grossAmount)).toBe(c.subtotal);
    expect(Number(s.conversion?.amount)).toBe(paid);
    expect(net).toBe(commission);
  });
}

test('L derived discount when merchant omits orderSubtotal (10 % coupon, paid ₹900.00)', async () => {
  proof.h('L derived');
  const coupon = await newCoupon(proof, f.orgA.id, { code: `${P}-DERIVE`, name: `${f.prefix} L derive`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [A1.id] });
  const s = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}DERIVE`, customerExternalId: `${O}cust-d`, amount: 90000, currency: 'INR', metadata: { couponCode: coupon.code } }, coupon.id);
  // gross = 90000 / 0.9 = 100000 ; discount = 10000
  proof.check('discountAmount', Number(s.redemption?.discountAmount), 10000);
  proof.check('grossAmount', Number(s.redemption?.grossAmount), 100000);
  expect(Number(s.redemption?.discountAmount)).toBe(10000);
  expect(Number(s.redemption?.grossAmount)).toBe(100000);
});
