import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, recordSale } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, usageCount } from '../lib/sales';
import { as } from '../lib/session';

/**
 * T — outside integrations. Coupon codes only enter through POST /api/v1/conversions (API key, scope
 * conversions:write). Provider webhooks (Cashfree/Razorpay) never carry coupon data (inventory R15).
 */
const proof = new Proof('T');
const f = F();
const P = `E2E-CPN-${f.run}-T`;
const RUN = Date.now().toString(36); // idempotency keys live 24 h: never reuse one across runs
const O = `${f.prefix}-T-`;
test.afterAll(async () => closeDb());

test('T1 missing / malformed / revoked / wrong-org keys and cross-org coupon', async () => {
  const owner = await as('ORG_A_OWNER');
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-K`, name: `${f.prefix} T k`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [f.orgA.affiliates[0].id] });
  const body = (n: string, code = c.code) => ({ externalId: `${O}${n}`, customerExternalId: `${O}c${n}`, amount: 90000, currency: 'INR', metadata: { couponCode: code } });
  const noKey = await api('POST', '/conversions', { body: body('1') });
  const badKey = await api('POST', '/conversions', { apiKey: 'pi_live_sk_' + 'x'.repeat(43), body: body('2') });
  const notBearer = await api('POST', '/conversions', { headers: { authorization: f.orgA.apiKey }, body: body('3') });
  const k = await api('POST', `/organizations/${f.orgA.id}/api-keys`, { token: owner.token, body: { name: `${f.prefix}-T-revoke`, preset: 'CONVERSION_TRACKING', environment: 'live' } });
  const del = await api('DELETE', `/organizations/${f.orgA.id}/api-keys/${k.data.id}`, { token: owner.token });
  const revoked = await recordSale(k.data.key, body('4'));
  const orgBKeyWithA = await recordSale(f.orgB.apiKey, body('5'));
  for (const [l, r] of [['no key', noKey], ['bad key', badKey], ['not bearer', notBearer], ['revoked key', revoked], ['Org B key + Org A coupon', orgBKeyWithA]] as const) {
    proof.h(`T1 ${l}`);
    proof.http('POST', '/conversions', r);
  }
  proof.http('DELETE', `/organizations/${f.orgA.id}/api-keys/${k.data.id}`, del);
  expect(noKey.status).toBe(401);
  expect(badKey.status).toBe(401);
  expect(notBearer.status).toBe(401);
  expect(revoked.status).toBe(401);
  proof.check('Org B key: sale lands in Org B, Org A coupon not applied', orgBKeyWithA.body?.data?.coupon?.applied, false);
  expect(orgBKeyWithA.body?.data?.coupon?.applied).toBe(false);
  const saved = await sql(`SELECT organizationId, externalId FROM conversions WHERE externalId IN (?)`, [[1, 2, 3, 4].map((n) => `${O}${n}`)]);
  proof.sql(`SELECT organizationId, externalId FROM conversions WHERE externalId IN (T-1..T-4)`, saved);
  expect(saved).toEqual([]);
  proof.check('Org A coupon uses', await usageCount(c.id), 0);
  expect(await usageCount(c.id)).toBe(0);
});

test('T2 replay of an old request (same externalId, same Idempotency-Key, new key)', async () => {
  const c = await newCoupon(proof, f.orgA.id, { code: `${P}-R`, name: `${f.prefix} T r`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [f.orgA.affiliates[0].id] });
  const body = { externalId: `${O}replay`, customerExternalId: `${O}cr`, amount: 90000, currency: 'INR', metadata: { couponCode: c.code }, occurredAt: '2026-01-01T00:00:00Z' };
  const first = await recordSale(f.orgA.apiKey, body, { 'Idempotency-Key': `${O}idem-${RUN}` });
  const replaySameKey = await recordSale(f.orgA.apiKey, body, { 'Idempotency-Key': `${O}idem-${RUN}` });
  const replayNewKey = await recordSale(f.orgA.apiKey, body, { 'Idempotency-Key': `${O}idem2-${RUN}` });
  proof.h('T2 replay');
  proof.http('POST', '/conversions', first, body);
  proof.http('POST', '/conversions (replay same key)', replaySameKey, body);
  proof.http('POST', '/conversions (replay new key)', replayNewKey, body);
  expect(first.status).toBe(201);
  expect(replayNewKey.status).toBe(409);
  const n = await sql(`SELECT COUNT(*) n FROM conversions WHERE externalId=?`, [`${O}replay`]);
  expect(Number(n[0].n)).toBe(1);
  expect(await usageCount(c.id)).toBe(1);
});

test('T3 provider webhook without a connection / with bad signature is refused, nothing saved', async () => {
  const before = await sql(`SELECT COUNT(*) n FROM integration_events`);
  const results: string[] = [];
  for (const provider of ['razorpay', 'cashfree']) {
    for (const [l, headers] of [['no signature', {}], ['wrong signature', { 'x-razorpay-signature': 'deadbeef', 'x-webhook-signature': 'deadbeef', 'x-webhook-timestamp': '1' }]] as const) {
      const r = await api('POST', `/integrations/${provider}/webhooks/00000000-0000-4000-8000-000000000000`, { headers, body: { event: 'payment.captured', payload: { coupon: f.orgA.coupons.PCT10.code } } });
      proof.http('POST', `/integrations/${provider}/webhooks/<unknown connection> (${l})`, r);
      results.push(`${provider} ${l} ${r.status}`);
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
  }
  const after = await sql(`SELECT COUNT(*) n FROM integration_events`);
  expect(Number(after[0].n)).toBe(Number(before[0].n));
  proof.note('BLOCKED (partial): a signed webhook from a *connected* Razorpay/Cashfree account needs provider credentials this environment does not have; and these webhooks never carry coupon codes, so they cannot create coupon uses (inventory R15).');
});
