import { expect, test } from '@playwright/test';
import { F } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { adminLogin, openCoupons } from '../lib/ui';

/**
 * G — code generator (admin form "Auto" button). Bulk import: N/A (no import feature exists in API or UI).
 * Generated codes must use an unambiguous alphabet (no O/0/I/1), be unique, and not clash with existing codes.
 */
const proof = new Proof('G');
const f = F();
test.afterAll(async () => closeDb());

test('G generator: 200 codes, alphabet, uniqueness, no clash with existing', async ({ page }) => {
  await adminLogin(page, 'ORG_A_OWNER');
  await openCoupons(page, f.orgA.id);
  await page.getByRole('button', { name: 'Create Coupon' }).first().click();
  const dlg = page.getByRole('dialog');
  const codes: string[] = [];
  for (let i = 0; i < 200; i++) {
    await dlg.getByRole('button', { name: 'Auto' }).click();
    codes.push(await dlg.getByPlaceholder('e.g. SUMMER20').inputValue());
  }
  const existing = new Set((await sql(`SELECT normalizedCode FROM organization_coupons WHERE organizationId=?`, [f.orgA.id])).map((r: any) => r.normalizedCode));
  const bad = codes.filter((c) => /[O0I1]/.test(c.replace(/^SAVE/, '')) || !/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(c));
  const dupes = codes.length - new Set(codes).size;
  const clash = codes.filter((c) => existing.has(c));
  proof.note(`sample: ${codes.slice(0, 10).join(', ')}`);
  proof.check('ambiguous / invalid generated codes', bad, []);
  proof.check('duplicates among 200', dupes, 0);
  proof.check('clash with existing codes', clash, []);
  expect(bad).toEqual([]);
  expect(dupes).toBe(0);
  expect(clash).toEqual([]);
  proof.note('Bulk import: N/A — no import endpoint or UI (inventory §1.1).');
});

test('G generator never proposes an existing code (forced collision)', async ({ page }) => {
  const { api } = await import('../lib/api');
  const { as } = await import('../lib/session');
  const owner = await as('ORG_A_OWNER');
  // Math.random()=0 makes the generator pick the first alphabet letter six times → SAVEAAAAAA
  const existing = await api('POST', `/organizations/${f.orgA.id}/coupons`, { token: owner.token, body: { code: 'SAVEAAAAAA', name: `${f.prefix} G existing`, discountType: 'PERCENTAGE', discountValue: 5 } });
  proof.http('POST', `/organizations/<orgA>/coupons`, existing, { code: 'SAVEAAAAAA' });
  await adminLogin(page, 'ORG_A_OWNER');
  await openCoupons(page, f.orgA.id);
  await page.getByRole('button', { name: 'Create Coupon' }).first().click();
  const dlg = page.getByRole('dialog');
  // installed right before the click so nothing else consumes the forced values
  await page.evaluate(() => {
    let n = 0;
    const real = Math.random;
    Math.random = () => (n++ < 6 ? 0 : real());
  });
  await dlg.getByRole('button', { name: 'Auto' }).click();
  const generated = await dlg.getByPlaceholder('e.g. SUMMER20').inputValue();
  proof.check('generated code differs from existing SAVEAAAAAA', generated !== 'SAVEAAAAAA', true);
  await sql(`DELETE FROM organization_coupons WHERE organizationId=? AND normalizedCode='SAVEAAAAAA'`, [f.orgA.id]);
  expect(generated).not.toBe('SAVEAAAAAA');
});
