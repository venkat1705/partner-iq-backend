import { Page, Request } from '@playwright/test';
import { ENV } from './env';
import { loadFixtures } from './fixtures';

/** Logs in through the real admin login form and opens the Coupons page for Org A (or given org). */
export async function adminLogin(page: Page, role: string) {
  const f = loadFixtures();
  const u = f.users[role];
  // Pre-answer the cookie banner (it overlays dialog footers otherwise); same shape the app stores.
  await page.addInitScript(() => {
    localStorage.setItem('partneriq_cookie_consent_v1', JSON.stringify({ hasResponded: true, strictlyNecessary: true, affiliateAttribution: true, analytics: false, updatedAt: new Date().toISOString() }));
  });
  await page.goto(`${ENV.ADMIN_UI}/login`);
  const accept = page.getByRole('button', { name: 'Accept All' });
  if (await accept.isVisible().catch(() => false)) await accept.click();
  await page.locator('input[name=email]').fill(u.email);
  await page.locator('input[name=password]').fill(ENV.PASSWORD);
  await page.getByRole('button', { name: 'Sign In to Workspace' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

/** Records every /api request the page makes (for "only GET, no duplicates" checks). */
export function recordApi(page: Page) {
  const reqs: { method: string; url: string; status?: number; body?: string }[] = [];
  page.on('request', (r: Request) => {
    if (r.url().includes('/api/')) reqs.push({ method: r.method(), url: r.url() });
  });
  page.on('response', async (res) => {
    const hit = [...reqs].reverse().find((x) => x.url === res.url() && x.status === undefined);
    if (hit) hit.status = res.status();
  });
  return reqs;
}

export function consoleErrors(page: Page) {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  return errs;
}

/** Opens /organizations/:orgId/coupons and dismisses the trial "choose a plan" dialog if it pops up. */
export async function openCoupons(page: Page, orgId: string, query = '') {
  await page.goto(`${ENV.ADMIN_UI}/organizations/${orgId}/coupons${query}`);
  await dismissPricing(page);
  await acceptCookies(page);
  await page.getByText('Coupon Intelligence & Management').first().waitFor({ timeout: 20_000 });
  // the page fills the table only after all coupon requests settle; read it after the network is idle
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
}

export async function dismissPricing(page: Page) {
  const dlg = page.getByText('Pick the organization plan you want to activate');
  if (await dlg.isVisible({ timeout: 2500 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  }
}

export async function acceptCookies(page: Page) {
  const btn = page.getByRole('button', { name: 'Accept All' });
  if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) await btn.click();
}
