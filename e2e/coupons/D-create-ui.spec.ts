import { expect, test } from '@playwright/test';
import { F } from '../lib/coupons';
import { closeDb, sql, sqlOne } from '../lib/db';
import { Proof } from '../lib/proof';
import { adminLogin, openCoupons } from '../lib/ui';

/** D — create one coupon of each discount type through the UI; check request, DB row, UI, refresh, audit log. */
const proof = new Proof('D');
const f = F();
const P = `E2E-CPN-${f.run}-D`;

test.afterAll(async () => {
  await closeDb();
});

const cases = [
  { type: 'PERCENTAGE', label: 'Percentage (%)', value: '15', code: `${P}-PCT` },
  { type: 'FIXED_AMOUNT', label: 'Fixed Amount (INR)', value: '250', code: `${P}-FIX` },
];

for (const c of cases) {
  test(`D create ${c.type} via UI`, async ({ page }) => {
    await adminLogin(page, 'ORG_A_OWNER');
    await openCoupons(page, f.orgA.id);
    await page.getByRole('button', { name: 'Create Coupon' }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByPlaceholder('e.g. SUMMER20').fill(c.code.toLowerCase());
    await dlg.getByPlaceholder('e.g. Summer Launch Special').fill(`${f.prefix} D ${c.type}`);
    await dlg.getByPlaceholder('e.g. 20% discount on all annual subscriptions').fill('created by D');
    if (c.type !== 'PERCENTAGE') {
      await dlg.getByRole('combobox').first().click();
      await page.getByRole('option', { name: c.label }).click();
    }
    await dlg.locator('input[type=number]').first().fill(c.value);
    await dlg.locator('input[type=number]').nth(1).fill('25');
    await dlg.locator('input[type=date]').nth(0).fill('2026-11-01');
    await dlg.locator('input[type=date]').nth(1).fill('2026-11-30');
    await dlg.getByText(f.orgA.affiliates[0].displayName).click();
    const reqP = page.waitForRequest((r) => r.method() === 'POST' && /\/coupons$/.test(r.url()));
    const resP = page.waitForResponse((r) => r.request().method() === 'POST' && /\/coupons$/.test(r.url()));
    await dlg.getByRole('button', { name: 'Create Coupon' }).click();
    const req = await reqP;
    const res = await resP;
    proof.h(`D ${c.type}`);
    proof.note(`> POST ${req.url()}\n> body: ${req.postData()}\n< HTTP ${res.status()}\n< ${(await res.text()).slice(0, 1500)}`);
    expect(res.status()).toBe(201);
    const sent = JSON.parse(req.postData() || '{}');
    proof.check('request code', sent.code, c.code);
    proof.check('request validFrom (date-only, org tz applied server-side)', sent.validFrom, '2026-11-01');
    proof.check('request validUntil', sent.validUntil, '2026-11-30');
    expect(sent.code).toBe(c.code);
    const row = await sqlOne(`SELECT id, code, discountType, discountValue, maxRedemptions, validFrom, validUntil, status, createdBy FROM organization_coupons WHERE organizationId=? AND normalizedCode=?`, [f.orgA.id, c.code]);
    proof.sql(`SELECT ... FROM organization_coupons WHERE normalizedCode='${c.code}'`, row);
    expect(row).toMatchObject({ code: c.code, discountType: c.type, maxRedemptions: 25, status: 'ACTIVE' });
    expect(Number(row!.discountValue)).toBe(Number(c.value));
    proof.check('validFrom UTC (IST 2026-11-01 00:00)', new Date(row!.validFrom).toISOString(), '2026-10-31T18:30:00.000Z');
    proof.check('validUntil UTC second (IST 2026-11-30 23:59:59)', new Date(row!.validUntil).toISOString().slice(0, 19), '2026-11-30T18:29:59');
    expect(new Date(row!.validFrom).toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(new Date(row!.validUntil).toISOString().slice(0, 19)).toBe('2026-11-30T18:29:59');
    const assigned = await sql(`SELECT affiliateId FROM organization_coupon_assignments WHERE couponId=?`, [row!.id]);
    proof.sql(`SELECT affiliateId FROM organization_coupon_assignments WHERE couponId='${row!.id}'`, assigned);
    expect(assigned.map((a: any) => a.affiliateId)).toEqual([f.orgA.affiliates[0].id]);
    const audit = await sql(`SELECT action, actorId, organizationId, resourceId, metadata FROM audit_logs WHERE resourceId=? ORDER BY createdAt`, [row!.id]);
    proof.sql(`SELECT action, actorId, organizationId, resourceId, metadata FROM audit_logs WHERE resourceId='${row!.id}'`, audit);
    expect(audit.map((a: any) => a.action)).toEqual(['COUPON_CREATED', 'COUPON_ASSIGNED']);
    expect(audit[0].actorId).toBe(f.users.ORG_A_OWNER.userId);
    // UI after refresh
    await page.reload();
    await page.getByRole('tab', { name: /All Coupons/ }).click();
    await page.getByPlaceholder('Search coupons by code or name...').fill(c.code);
    const tr = page.locator('tbody tr', { hasText: c.code });
    await expect(tr).toHaveCount(1);
    const text = (await tr.innerText()).replace(/\s+/g, ' ');
    proof.note(`UI row after refresh: ${text}`);
    expect(text).toContain(c.type === 'PERCENTAGE' ? '15% OFF' : '₹250');
    expect(text).toContain('/ 25');
    expect(text).toContain('1 partner');
  });
}
