import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, sale, usageCount } from '../lib/sales';
import { as } from '../lib/session';

/**
 * Q — refunds of coupon sales. Rules (D7/D11): commission reversed proportionally (existing code), ledger gets
 * COMMISSION_REVERSED entries, the coupon use is NOT given back, the redemption row records the refund.
 * Refund after the commission was paid out: reported (ledger EARNED balance must go negative, not be clamped).
 * Uses AFFILIATE_3 (only this spec pays AFFILIATE_3 out).
 */
const proof = new Proof('Q');
const f = F();
const P = `E2E-CPN-${f.run}-Q`;
const O = `${f.prefix}-Q-`;
const A3 = f.orgA.affiliates[2];
test.afterAll(async () => closeDb());

const ledger = async (affiliateId: string) => {
  const acc = await sql(`SELECT type, balance FROM ledger_accounts WHERE organizationId=? AND affiliateId=? ORDER BY type`, [f.orgA.id, affiliateId]);
  proof.sql(`SELECT type, balance FROM ledger_accounts WHERE affiliateId='${affiliateId}'`, acc);
  return acc;
};

test('Q1 partial then full refund of a coupon sale', async () => {
  proof.h('Q1 partial + full refund');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-R`, name: `${f.prefix} Q r`, discountType: 'PERCENTAGE', discountValue: 10, maxRedemptions: 2, affiliateIds: [A3.id] });
  // program A2 = 10 %: paid ₹900.00 → commission 9000 paise
  const s = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}1`, customerExternalId: `${O}c1`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
  expect(s.commissions.map((x: any) => Number(x.commissionAmount))).toEqual([9000]);
  const r1 = await api('POST', `/conversions/${s.conversion.id}/refund`, { apiKey: f.orgA.apiKey, body: { amount: 30000, refundExternalId: `${O}rf1`, reason: 'partial' } });
  proof.http('POST', `/conversions/${s.conversion.id}/refund`, r1, { amount: 30000 });
  await new Promise((r) => setTimeout(r, 400));
  const comm1 = await sql(`SELECT commissionAmount, reversedAmount, status FROM commissions WHERE conversionId=?`, [s.conversion.id]);
  proof.sql(`SELECT commissionAmount, reversedAmount, status FROM commissions WHERE conversionId='${s.conversion.id}'`, comm1);
  // own math: 9000 × 30000 / 90000 = 3000 reversed
  proof.check('reversed after partial', Number(comm1[0].reversedAmount), 3000);
  expect(Number(comm1[0].reversedAmount)).toBe(3000);
  const entries = await sql(`SELECT t.type, t.description, e.type entryType, e.amount FROM ledger_transactions t JOIN ledger_entries e ON e.transactionId=t.id WHERE t.referenceId IN (SELECT id FROM commissions WHERE conversionId=?) ORDER BY t.createdAt`, [s.conversion.id]);
  proof.sql(`SELECT t.type, e.type, e.amount FROM ledger_transactions t JOIN ledger_entries e ... WHERE referenceId = commission of ${s.conversion.id}`, entries);
  expect(entries.some((e: any) => e.type === 'COMMISSION_REVERSED')).toBe(true);
  const r2 = await api('POST', `/conversions/${s.conversion.id}/refund`, { apiKey: f.orgA.apiKey, body: { refundExternalId: `${O}rf2`, reason: 'rest' } });
  proof.http('POST', `/conversions/${s.conversion.id}/refund (remaining)`, r2);
  await new Promise((r) => setTimeout(r, 400));
  const comm2 = await sql(`SELECT commissionAmount, reversedAmount, status FROM commissions WHERE conversionId=?`, [s.conversion.id]);
  proof.sql(`SELECT commissionAmount, reversedAmount, status FROM commissions WHERE conversionId='${s.conversion.id}'`, comm2);
  const red = await sql(`SELECT status, refundedAmount FROM organization_coupon_redemptions WHERE conversionId=?`, [s.conversion.id]).catch((e) => String(e.message));
  proof.sql(`SELECT status, refundedAmount FROM organization_coupon_redemptions WHERE conversionId='${s.conversion.id}'`, red);
  proof.check('reversed after full', Number(comm2[0].reversedAmount), 9000);
  proof.check('use NOT given back', await usageCount(c.id), 1);
  expect(Number(comm2[0].reversedAmount)).toBe(9000);
  expect(await usageCount(c.id)).toBe(1);
  expect(Array.isArray(red) ? red[0]?.status : red).toBe('REFUNDED');
});

test('Q2 refund after the commission was paid out → negative balance carried', async () => {
  proof.h('Q2 refund after payout');
  const owner = await as('ORG_A_OWNER');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-PAID`, name: `${f.prefix} Q paid`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [A3.id] });
  const s = await sale(proof, f.orgA.apiKey, f.orgA.id, { externalId: `${O}2`, customerExternalId: `${O}c2`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code } }, c.id);
  const before = await ledger(A3.id);
  const batch = await api('POST', `/organizations/${f.orgA.id}/payouts/batches`, { token: owner.token, body: { affiliateIds: [A3.id], gateway: 'DIRECT', notes: `${f.prefix} Q` } });
  proof.http('POST', `/organizations/${f.orgA.id}/payouts/batches`, batch, { affiliateIds: [A3.id], gateway: 'DIRECT' });
  const bid = batch.data?.id || batch.data?.batch?.id;
  const proc = await api('POST', `/organizations/${f.orgA.id}/payouts/batches/${bid}/process`, { token: owner.token, body: { gateway: 'DIRECT' } });
  proof.http('POST', `/organizations/${f.orgA.id}/payouts/batches/${bid}/process`, proc);
  await new Promise((r) => setTimeout(r, 400));
  const paid = await ledger(A3.id);
  const earnedPaid = Number(paid.find((a: any) => a.type === 'EARNED')?.balance ?? NaN);
  proof.check('EARNED balance after payout', earnedPaid, 0);
  const rf = await api('POST', `/conversions/${s.conversion.id}/refund`, { apiKey: f.orgA.apiKey, body: { refundExternalId: `${O}rf3`, reason: 'after payout' } });
  proof.http('POST', `/conversions/${s.conversion.id}/refund`, rf);
  await new Promise((r) => setTimeout(r, 400));
  const after = await ledger(A3.id);
  const earnedAfter = Number(after.find((a: any) => a.type === 'EARNED')?.balance ?? NaN);
  // own math: commission on ₹900 at 10 % = 9000 paise, fully clawed back after being paid → −9000
  proof.check('EARNED balance after refund (negative carried)', earnedAfter, -9000);
  proof.note(`ledger before sale/payout: ${JSON.stringify(before)}`);
  expect(batch.status).toBe(201);
  expect(earnedPaid).toBe(0);
  expect(rf.status).toBe(201);
  expect(earnedAfter).toBe(-9000);
  const list = await api('GET', `/organizations/${f.orgA.id}/coupons/analytics/by-affiliate`, { token: owner.token });
  const row = (list.data as any[]).find((x) => x.affiliateId === A3.id);
  proof.http('GET', `/organizations/${f.orgA.id}/coupons/analytics/by-affiliate (A3 row)`, { ...list, body: row });
  proof.check('admin sees negative balance for A3', row?.ledgerBalance, -90);
  expect(row?.ledgerBalance).toBe(-90);
});
