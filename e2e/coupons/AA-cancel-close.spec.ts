import { expect, Page, test } from '@playwright/test';
import { F } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { adminLogin, openCoupons } from '../lib/ui';

/** AA — every modal/drawer: change fields, then Cancel / X / Escape / click outside → no write request, no change, no leftovers. */
const proof = new Proof('AA');
const f = F();
test.afterAll(async () => closeDb());

function trackWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/coupons') && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
  });
  return writes;
}
const closers: [string, (page: Page) => Promise<void>][] = [
  ['Cancel', async (page) => page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()],
  ['X', async (page) => page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click()],
  ['Escape', async (page) => page.keyboard.press('Escape')],
  ['outside', async (page) => page.mouse.click(5, 5)],
];

test('AA1 create/edit form dialog', async ({ page }) => {
  await adminLogin(page, 'ORG_A_OWNER');
  await openCoupons(page, f.orgA.id, '?tab=coupons');
  const writes = trackWrites(page);
  const before = await sql(`SELECT id, name, discountValue, updatedAt FROM organization_coupons WHERE organizationId=? ORDER BY id`, [f.orgA.id]);
  for (const [label, close] of closers) {
    await page.getByRole('button', { name: 'Create Coupon' }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByPlaceholder('e.g. SUMMER20').fill('AA-LEFTOVER');
    await dlg.getByPlaceholder('e.g. Summer Launch Special').fill('should not persist');
    await close(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Create Coupon' }).first().click();
    const code = await page.getByRole('dialog').getByPlaceholder('e.g. SUMMER20').inputValue();
    proof.check(`create: reopened after ${label} → code field empty`, code, '');
    expect(code, label).toBe('');
    await page.keyboard.press('Escape');
    // edit
    await page.getByPlaceholder('Search coupons by code or name...').fill(f.orgA.coupons.PCT10.code);
    await page.locator('tbody tr').first().getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Edit Coupon' }).click();
    await page.getByRole('dialog').getByPlaceholder('e.g. Summer Launch Special').fill('EDIT SHOULD NOT SAVE');
    await close(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('tbody tr').first().getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Edit Coupon' }).click();
    const name = await page.getByRole('dialog').getByPlaceholder('e.g. Summer Launch Special').inputValue();
    proof.check(`edit: reopened after ${label} → original name`, name.includes('EDIT SHOULD NOT SAVE'), false);
    expect(name.includes('EDIT SHOULD NOT SAVE'), label).toBe(false);
    await page.keyboard.press('Escape');
  }
  const after = await sql(`SELECT id, name, discountValue, updatedAt FROM organization_coupons WHERE organizationId=? ORDER BY id`, [f.orgA.id]);
  proof.check('write requests', writes, []);
  proof.check('SQL unchanged', JSON.stringify(after) === JSON.stringify(before), true);
  expect(writes).toEqual([]);
  expect(after).toEqual(before);
});

test('AA2 detail drawer, assign dialog, validate dialog', async ({ page }) => {
  await adminLogin(page, 'ORG_A_OWNER');
  await openCoupons(page, f.orgA.id, '?tab=coupons');
  const writes = trackWrites(page);
  await page.getByPlaceholder('Search coupons by code or name...').fill(f.orgA.coupons.PCT10.code);
  for (const [label, close] of closers.filter(([l]) => l !== 'Cancel')) {
    // drawer
    await page.locator('tbody tr').first().getByRole('button', { name: /Intel/ }).click();
    await expect(page.getByText('Performance & Financial Yield')).toBeVisible();
    if (label === 'X') await page.getByRole('button', { name: /Close/ }).last().click(); else await close(page);
    await expect(page.getByText('Performance & Financial Yield')).toHaveCount(0);
    // validate dialog: type, close, reopen → empty and no stale result
    await page.getByRole('button', { name: 'Validate Code' }).click();
    const input = page.getByRole('dialog').locator('input').first();
    await input.fill('STALE-CODE');
    await close(page);
    await page.getByRole('button', { name: 'Validate Code' }).click();
    const v = await page.getByRole('dialog').locator('input').first().inputValue();
    proof.check(`validate reopened after ${label}`, v, '');
    expect(v, label).toBe('');
    await page.keyboard.press('Escape');
    // assign dialog: search text must not survive
    await page.locator('tbody tr').first().getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Assign Affiliates' }).click();
    await page.getByPlaceholder('Search affiliates by name or email...').fill('zzz');
    await close(page);
    await page.locator('tbody tr').first().getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Assign Affiliates' }).click();
    const q = await page.getByPlaceholder('Search affiliates by name or email...').inputValue();
    proof.check(`assign search reopened after ${label}`, q, '');
    expect(q, label).toBe('');
    await page.keyboard.press('Escape');
  }
  proof.check('write requests', writes, []);
  expect(writes).toEqual([]);
});
