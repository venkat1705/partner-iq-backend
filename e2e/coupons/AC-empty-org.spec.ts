import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { registerWorkspaceUser } from '../lib/actors';
import { F } from '../lib/coupons';
import { closeDb } from '../lib/db';
import { ENV } from '../lib/env';
import { loadFixtures, saveFixtures } from '../lib/fixtures';
import { Proof } from '../lib/proof';
import { adminLogin, openCoupons } from '../lib/ui';
import { as } from '../lib/session';

/** AC — organization with no coupons: empty messages, zeros, no NaN / fake data. */
const proof = new Proof('AC');
test.afterAll(async () => closeDb());

test('AC empty organization', async ({ page }) => {
  const f = loadFixtures();
  if (!f.users.ORG_C_OWNER) {
    const s = await registerWorkspaceUser(`${f.prefix}-org_c_owner@example.test`, 'OrgCOwner');
    const org = await api('POST', '/organizations', { token: s.token, body: { name: `${f.prefix}-org-c-empty`, defaultCurrency: 'INR' } });
    f.users.ORG_C_OWNER = { ...s, role: 'OWNER', kind: 'workspace' };
    (f as any).orgC = { id: org.data.id };
    saveFixtures(f);
  }
  const orgC = (loadFixtures() as any).orgC.id;
  const ownerC = await as('ORG_C_OWNER');
  const ov = await api('GET', `/organizations/${orgC}/coupons/analytics/overview?period=LIFETIME`, { token: ownerC.token });
  proof.http('GET', `/organizations/<orgC>/coupons/analytics/overview`, ov);
  expect(ov.status).toBe(200);
  for (const k of ['totalCoupons', 'activeCoupons', 'totalRedemptions', 'couponDrivenRevenue', 'discountGiven', 'commissionGenerated', 'averageOrderValue', 'redemptionRate']) {
    expect(ov.data[k], k).toBe(0);
  }
  await adminLogin(page, 'ORG_C_OWNER');
  await openCoupons(page, orgC, '?tab=coupons');
  const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  proof.note(text.slice(0, 800));
  proof.check('empty title', text.includes('No coupons found'), true);
  proof.check('NaN', text.includes('NaN'), false);
  proof.check('Infinity', text.includes('Infinity'), false);
  expect(text).toContain('No coupons found');
  expect(text).not.toContain('NaN');
  expect(text).not.toContain('Infinity');
  await openCoupons(page, orgC);
  const ovText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  proof.note(ovText.slice(0, 1200));
  expect(ovText).not.toContain('NaN');
  expect(ovText).not.toMatch(/\d+\.\dx Revenue Multiple/);
  expect(ovText).toContain('TOTAL REDEMPTIONS 0');
  void ENV;
});
