import { expect, test } from '@playwright/test';
import { F } from '../lib/coupons';
import { closeDb, sqlOne } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, sale } from '../lib/sales';

/**
 * P — start/end boundaries. Rule (D10): dates are calendar days in the organization's timezone; start = 00:00:00.000,
 * end = 23:59:59.999 of the end day (inclusive). Validity is evaluated at the sale's occurredAt (order time).
 * Org A = Asia/Kolkata (UTC+05:30), Org B = UTC. Coupon window 2026-09-01 .. 2026-09-05.
 */
const proof = new Proof('P');
const f = F();
const P = `E2E-CPN-${f.run}-P`;
const O = `${f.prefix}-P-`;

test.afterAll(async () => {
  await closeDb();
});

const table: [string, string, string, boolean][] = [
  // org, label, occurredAt (UTC instant), expected applied
  ['A', 'just before start (IST 2026-08-31 23:59:59.999)', '2026-08-31T18:29:59.999Z', false],
  ['A', 'exactly at start (IST 2026-09-01 00:00:00.000)', '2026-08-31T18:30:00.000Z', true],
  ['A', 'UTC midnight Sep 1 (IST 05:30) inside', '2026-09-01T00:00:00.000Z', true],
  ['A', 'just before end (IST 2026-09-05 23:59:59.998)', '2026-09-05T18:29:59.998Z', true],
  ['A', 'exactly at end (IST 2026-09-05 23:59:59.999)', '2026-09-05T18:29:59.999Z', true],
  ['A', 'just after end (IST 2026-09-06 00:00:00.000)', '2026-09-05T18:30:00.000Z', false],
  ['A', 'UTC 2026-09-05 23:00 (= IST Sep 6 04:30) outside', '2026-09-05T23:00:00.000Z', false],
  ['B', 'UTC org: just before start', '2026-08-31T23:59:59.999Z', false],
  ['B', 'UTC org: exactly at start', '2026-09-01T00:00:00.000Z', true],
  ['B', 'UTC org: exactly at end', '2026-09-05T23:59:59.999Z', true],
  ['B', 'UTC org: just after end', '2026-09-06T00:00:00.000Z', false],
];

test('P boundaries in org timezone and UTC', async () => {
  const cA = await newCoupon(proof, f.orgA.id, { code: `${P}-WIN`, name: `${f.prefix} P win A`, discountType: 'PERCENTAGE', discountValue: 10, validFrom: '2026-09-01', validUntil: '2026-09-05', affiliateIds: [f.orgA.affiliates[0].id] });
  const cB = await newCoupon(proof, f.orgB.id, { code: `${P}-WIN`, name: `${f.prefix} P win B`, discountType: 'PERCENTAGE', discountValue: 10, validFrom: '2026-09-01', validUntil: '2026-09-05', affiliateIds: [f.orgB.affiliates[0].id] }, 'ORG_B_OWNER');
  const rowA = await sqlOne(`SELECT validFrom, validUntil FROM organization_coupons WHERE id=?`, [cA.id]);
  const rowB = await sqlOne(`SELECT validFrom, validUntil FROM organization_coupons WHERE id=?`, [cB.id]);
  proof.sql(`SELECT validFrom, validUntil FROM organization_coupons WHERE id='${cA.id}' (Org A, Asia/Kolkata)`, rowA);
  proof.sql(`SELECT validFrom, validUntil FROM organization_coupons WHERE id='${cB.id}' (Org B, UTC)`, rowB);
  const results: string[] = ['| org | case | occurredAt (UTC) | expected | actual |', '|---|---|---|---|---|'];
  let i = 0;
  const failures: string[] = [];
  for (const [org, label, at, expected] of table) {
    const o = org === 'A' ? f.orgA : f.orgB;
    const c = org === 'A' ? cA : cB;
    proof.h(`P ${org} ${label}`);
    const s = await sale(proof, o.apiKey, o.id, { externalId: `${O}${org}-${++i}`, customerExternalId: `${O}c${i}`, amount: 90000, currency: 'INR', occurredAt: at, metadata: { couponCode: c.code } }, c.id);
    const actual = s.body?.data?.coupon?.applied;
    results.push(`| ${org} | ${label} | ${at} | ${expected ? 'counts' : 'refused'} | ${actual === true ? 'counts' : actual === false ? 'refused' : String(actual)} |`);
    proof.check(`${org} ${label}`, actual, expected);
    if (actual !== expected) failures.push(label);
  }
  proof.note('\nDATE BOUNDARY TABLE\n' + results.join('\n'));
  expect(failures).toEqual([]);
});
