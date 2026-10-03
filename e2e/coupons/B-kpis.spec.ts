import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath, tableExists } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { newCoupon, sale } from '../lib/sales';
import { as } from '../lib/session';
import { adminLogin, openCoupons } from '../lib/ui';

/**
 * B — KPI cards. Expected values are computed here from SQL (definitions D12 in docs/decisions.md):
 *  totalRedemptions   = COUNT(redemptions) of sales in range/filter
 *  attributed         = those whose conversion.status IN (APPROVED, CONFIRMED, PENDING, PARTIALLY_REFUNDED)
 *  gross revenue      = Σ(grossAmount − refundedAmount) of attributed ; discount = Σ discountAmount of attributed
 *  commission         = Σ(commissionAmount − reversedAmount) of attributed conversions
 *  activeCoupons      = status ACTIVE and not past validUntil ; expired = past validUntil and not ARCHIVED
 * Org B is used so other specs' Org A data cannot interfere.
 */
const proof = new Proof('B');
const f = F();
const P = `E2E-CPN-${f.run}-B`;
const O = `${f.prefix}-B-`;
const org = f.orgB;
const B1 = org.affiliates[0];
const day = 86400000;

test.beforeAll(async () => {
  proof.h('B setup (Org B): 2 coupons, 4 sales, 1 old sale (20 days ago), 1 sale without coupon');
  const c1 = await newCoupon(proof, org.id, { code: `${P}-P10`, name: `${f.prefix} B p10`, discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [B1.id] }, 'ORG_B_OWNER');
  const c2 = await newCoupon(proof, org.id, { code: `${P}-F50`, name: `${f.prefix} B f50`, discountType: 'FIXED_AMOUNT', discountValue: 50 }, 'ORG_B_OWNER');
  const sales: [string, number, string | null, number][] = [
    [`${O}1`, 90000, c1.code, 0],
    [`${O}2`, 45000, c1.code, 0],
    [`${O}3`, 25000, c2.code, 0],
    [`${O}4`, 180000, c1.code, 20],
    [`${O}5`, 70000, null, 0],
  ];
  for (const [ext, amount, code, ago] of sales) {
    await sale(proof, org.apiKey, org.id, { externalId: ext, customerExternalId: `${ext}-c`, amount, currency: 'INR', occurredAt: new Date(Date.now() - ago * day).toISOString(), metadata: code ? { couponCode: code } : {} });
  }
});

test.afterAll(async () => {
  await closeDb();
});

async function expectedKpis(from: Date | null, affiliateId: string | null) {
  const where = [`r.organizationId = ?`];
  const params: unknown[] = [org.id];
  if (from) { where.push('v.occurredAt >= ?'); params.push(from); }
  if (affiliateId) { where.push('r.affiliateId = ?'); params.push(affiliateId); }
  const q = `SELECT COUNT(*) total,
      SUM(v.status IN ('APPROVED','CONFIRMED','PENDING','PARTIALLY_REFUNDED')) attributed,
      SUM(IF(v.status IN ('APPROVED','CONFIRMED','PENDING','PARTIALLY_REFUNDED'), r.grossAmount - COALESCE(v.refundedAmount,0), 0)) gross,
      SUM(IF(v.status IN ('APPROVED','CONFIRMED','PENDING','PARTIALLY_REFUNDED'), r.discountAmount, 0)) discount,
      SUM(IF(v.status IN ('APPROVED','CONFIRMED','PENDING','PARTIALLY_REFUNDED'),
        (SELECT COALESCE(SUM(cm.commissionAmount - COALESCE(cm.reversedAmount,0)),0) FROM commissions cm WHERE cm.conversionId = v.id), 0)) commission
    FROM organization_coupon_redemptions r JOIN conversions v ON v.id = r.conversionId WHERE ${where.join(' AND ')}`;
  const [row] = await sql(q, params);
  proof.sql(`${q} -- params ${JSON.stringify(params)}`, row);
  const cnt = await sql(`SELECT SUM(status='ACTIVE' AND (validUntil IS NULL OR validUntil >= NOW())) active, SUM(validUntil < NOW() AND status <> 'ARCHIVED') expired, COUNT(*) total FROM organization_coupons WHERE organizationId=?`, [org.id]);
  proof.sql(`SELECT active/expired/total FROM organization_coupons WHERE organizationId='${org.id}'`, cnt);
  return {
    totalCoupons: Number(cnt[0].total),
    activeCoupons: Number(cnt[0].active),
    expiredCoupons: Number(cnt[0].expired),
    totalRedemptions: Number(row.total),
    attributedConversions: Number(row.attributed || 0),
    couponDrivenRevenue: Number(row.gross || 0) / 100,
    discountGiven: Number(row.discount || 0) / 100,
    commissionGenerated: Number(row.commission || 0) / 100,
  };
}

const combos: [string, string, Date | null, string | null][] = [
  ['7D, all affiliates', 'period=7D', new Date(Date.now() - 7 * day), null],
  ['LIFETIME, all affiliates', 'period=LIFETIME', null, null],
  ['7D, affiliate B1', `period=7D&affiliateId=${B1.id}`, new Date(Date.now() - 7 * day), B1.id],
  ['LIFETIME, program B1', `period=LIFETIME&programId=${org.programs[0].id}`, null, null],
];

for (const [label, qs, from, aff] of combos) {
  test(`B API ${label}`, async () => {
    expect(await tableExists('organization_coupon_redemptions')).toBe(true);
    const owner = await as('ORG_B_OWNER');
    const r = await api('GET', orgPath(org.id, `/analytics/overview?${qs}`), { token: owner.token });
    proof.h(`B ${label}`);
    proof.http('GET', orgPath(org.id, `/analytics/overview?${qs}`), r);
    const exp = await expectedKpis(from, aff);
    const got = Object.fromEntries(Object.keys(exp).map((k) => [k, r.data?.[k]]));
    proof.check('KPIs', got, exp);
    expect(got).toEqual(exp);
  });
}

test('B UI cards equal SQL for 30D and Lifetime (after refresh)', async ({ page }) => {
  await adminLogin(page, 'ORG_B_OWNER');
  for (const [btn, from] of [['30D', new Date(Date.now() - 30 * day)], ['Lifetime', null]] as const) {
    await openCoupons(page, org.id);
    await page.getByRole('button', { name: btn, exact: true }).click();
    await page.waitForTimeout(1200);
    const exp = await expectedKpis(from, null);
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    proof.h(`B UI ${btn}`);
    proof.note(text.slice(0, 1200));
    const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; // money is shown exact to the paisa
    for (const [lbl, want] of [
      ['ACTIVE COUPONS', `ACTIVE COUPONS ${exp.activeCoupons} of ${exp.totalCoupons} total`],
      ['TOTAL REDEMPTIONS', `TOTAL REDEMPTIONS ${exp.totalRedemptions}`],
      ['ATTRIBUTED CONVERSIONS', `ATTRIBUTED CONVERSIONS ${exp.attributedConversions}`],
      ['GROSS ATTRIBUTED REVENUE', `GROSS ATTRIBUTED REVENUE ${fmt(exp.couponDrivenRevenue)}`],
      ['DISCOUNT GIVEN', `DISCOUNT GIVEN ${fmt(exp.discountGiven)}`],
      ['AFFILIATE COMMISSION', `AFFILIATE COMMISSION ${fmt(exp.commissionGenerated)}`],
    ]) {
      proof.check(`UI ${btn} ${lbl}`, text.includes(want), true);
      expect(text, want).toContain(want);
    }
  }
});
