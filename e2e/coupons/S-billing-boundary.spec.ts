import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { api } from '../lib/api';
import { F, recordSale } from '../lib/coupons';
import { closeDb, sql, sqlOne } from '../lib/db';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';

/**
 * S4 — boundary between organization coupons and PartnerIQ's own SaaS billing coupons (billing coupons are out of
 * scope: report only, no billing code changed). One ACTIVE billing coupon is inserted DIRECTLY in MySQL as test
 * data (creating one through the API needs a platform super-admin with a forced password change), the backend is
 * restarted so dbStore loads it, and both directions are tested with a positive control.
 */
const proof = new Proof('S-billing');
const f = F();
const BILL = `E2E-CPN-${f.run}-SB-BILL`;
let billId = '';

test.afterAll(async () => {
  if (billId) await sql(`DELETE FROM billing_coupons WHERE id=?`, [billId]);
  await closeDb();
});

test('S4 org coupon code at SaaS billing checkout, and billing coupon code on an affiliate sale', async () => {
  test.setTimeout(180_000);
  const existing = await sqlOne<{ id: string }>(`SELECT id FROM billing_coupons WHERE normalizedCode=?`, [BILL]);
  if (existing) billId = existing.id;
  else {
    billId = randomUUID();
    await sql(
      `INSERT INTO billing_coupons (id, code, normalizedCode, name, discountType, discountValue, durationType, status, isPublic)
       VALUES (?, ?, ?, ?, 'PERCENTAGE', 10, 'ONE_TIME', 'ACTIVE', 1)`,
      [billId, BILL, BILL, `${f.prefix} billing boundary`],
    );
  }
  proof.sql(`SELECT id, code, status FROM billing_coupons WHERE id='${billId}' (inserted directly as test data)`, await sqlOne(`SELECT id, code, status FROM billing_coupons WHERE id=?`, [billId]));
  execSync(`${__dirname}/../scripts/restart-backend.sh`, { stdio: 'ignore' });

  const owner = await as('ORG_A_OWNER');
  const plan = await sqlOne<{ id: string }>(`SELECT id FROM billing_plans WHERE code='GROWTH' AND billingInterval='MONTHLY' LIMIT 1`);
  const path = `/organizations/${f.orgA.id}/billing/coupons/validate`;
  const quote = async (couponCode: string) => {
    const body = { planId: plan!.id, billingInterval: 'MONTHLY', couponCode };
    const r = await api('POST', path, { token: owner.token, body });
    proof.http('POST', path, r, body);
    return r;
  };

  proof.h('S4a positive control: the billing coupon is valid at billing checkout');
  const control = await quote(BILL);
  proof.h('S4b organization coupon code at billing checkout');
  const orgCode = await quote(f.orgA.coupons.PCT10.code);
  const discountOf = (r: any) => Number(r.data?.discountMinor ?? 0);
  proof.check('control: billing quote valid', control.data?.valid, true);
  proof.check('org coupon code: billing quote valid', orgCode.data?.valid, false);
  proof.check('control: billing coupon gives a discount', discountOf(control) > 0, true);
  proof.check('org coupon code gives no billing discount', discountOf(orgCode), 0);
  expect(control.data?.valid).toBe(true);
  expect(orgCode.data?.valid).toBe(false);
  expect(discountOf(control)).toBeGreaterThan(0);
  expect(discountOf(orgCode)).toBe(0);

  proof.h('S4c billing coupon code on an affiliate sale (POST /conversions)');
  const ext = `${f.prefix}-SB-sale-${Date.now()}`;
  const sale = await recordSale(f.orgA.apiKey, { externalId: ext, customerExternalId: `${ext}-c`, amount: 90000, currency: 'INR', metadata: { couponCode: BILL } });
  proof.http('POST', '/conversions', sale, { externalId: ext, metadata: { couponCode: BILL } });
  const reds = await sql(`SELECT r.id FROM organization_coupon_redemptions r JOIN conversions v ON v.id=r.conversionId WHERE v.externalId=?`, [ext]);
  proof.sql(`SELECT id FROM organization_coupon_redemptions JOIN conversions WHERE externalId='${ext}'`, reds);
  proof.check('billing code on a sale: coupon.applied', sale.data?.coupon?.applied, false);
  proof.check('billing code on a sale: reason', sale.data?.coupon?.reason, 'NOT_FOUND');
  proof.check('no organization-coupon use recorded', reds.length, 0);
  expect(sale.data?.coupon?.applied).toBe(false);
  expect(sale.data?.coupon?.reason).toBe('NOT_FOUND');
  expect(reds.length).toBe(0);
  await sql(`DELETE FROM conversions WHERE externalId=?`, [ext]);
});
