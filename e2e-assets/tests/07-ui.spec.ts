import { expect, Page, test } from '@playwright/test';
import { api } from '../lib/api';
import { closeDb, sqlOne } from '../lib/db';
import { ENV } from '../lib/env';
import { loadFixtures } from '../lib/fixtures';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';
import { adminLogin, consoleErrors, dismissPricing, acceptCookies, recordApi, recoverFromAuthRace, refreshPage } from '../lib/ui';
import { MB, dbStorage, listData, openReservations, orgPath, setLimit, uploadAsset, usage, wipeOrg } from '../lib/assets';
import { makePng, makeText, upload } from '../lib/upload';

/**
 * UI scenarios against production builds: admin app (vite preview :3001, /api proxied to the backend) and the
 * affiliate portal (:3005). Numbers on screen are compared with the API and the database.
 */
const f = loadFixtures();
const org = f.orgEmpty!.id;
const ROLE = 'ORG_EMPTY_OWNER';
const P = `${f.prefix}-UI`;
test.afterAll(async () => closeDb());

const fmt = (bytes: number) => {
  // same rule as src/lib/format/storage.ts (binary units, one decimal, trailing .0 dropped)
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  if (bytes <= 0) return '0 B';
  if (i === 0) return `${Math.round(v)} B`;
  const r = Math.round(v * 10) / 10;
  return `${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)} ${u[i]}`;
};

async function openAssets(page: Page, orgId = org, tab = '') {
  const url = `${ENV.ADMIN_UI}/organizations/${orgId}/assets${tab ? `?tab=${tab}` : ''}`;
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  await page.getByTestId('storage-usage').or(page.locator('input[name=password]')).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  await recoverFromAuthRace(page, `open ${new URL(url).pathname}`, () => page.goto(url));
  await dismissPricing(page);
  await acceptCookies(page);
  await page.getByTestId('storage-usage').or(page.getByTestId('storage-usage-error')).first().waitFor({ timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
}
async function storageText(page: Page) {
  return (await page.getByTestId('storage-usage-text').innerText()).trim();
}

test('G/S (UI). storage bar matches the database; one request per resource on page load', async ({ page }) => {
  const proof = new Proof('G-ui');
  await wipeOrg(org, ROLE);
  await setLimit(org, 10 * MB);
  await uploadAsset(org, ROLE, { fileName: 'g1.txt', content: makeText(3 * MB + 512 * 1024, 'g1'), assetType: 'DOCUMENT', name: `${P} g1` });
  await adminLogin(page, ROLE);
  const reqs = recordApi(page);
  const errors = consoleErrors(page);
  const t0 = Date.now();
  await openAssets(page);
  const loadMs = Date.now() - t0;
  const d = await dbStorage(org);
  const text = await storageText(page);
  proof.note(`UI: "${text}" | DB usedBytes=${d!.usedBytes} limitBytes=${d!.limitBytes} → expected "${fmt(d!.usedBytes)} of ${fmt(d!.limitBytes)} used"`);
  expect(text).toBe(`${fmt(d!.usedBytes)} of ${fmt(d!.limitBytes)} used`);
  expect(await page.getByTestId('storage-files').innerText()).toBe(fmt(d!.usedBytes));
  const api1 = reqs.filter((r) => r.url.includes('/api/v1/organizations/'));
  const counts = new Map<string, number>();
  for (const r of api1) counts.set(`${r.method} ${new URL(r.url).pathname}`, (counts.get(`${r.method} ${new URL(r.url).pathname}`) || 0) + 1);
  proof.note(`page ready in ${loadMs} ms; organization API requests:\n${[...counts.entries()].map(([k, n]) => `${n}× ${k}`).join('\n')}`);
  proof.note(`console errors: ${JSON.stringify(errors)}`);
  expect(api1.every((r) => r.method === 'GET')).toBe(true);
  // asset requests: exactly one each. The app shell (members, programs, …) loads twice on every page — outside this
  // audit, reported in assets-audit.md §9.
  const assetCalls = [...counts.entries()].filter(([k]) => /\/(assets|asset-|storage)/.test(k));
  proof.note(`asset requests: ${assetCalls.map(([k, n]) => `${n}× ${k.split('/').slice(-2).join('/')}`).join(', ')}`);
  expect(assetCalls.length).toBeGreaterThanOrEqual(7);
  expect(assetCalls.every(([, n]) => n === 1)).toBe(true);
  proof.h('refresh: same numbers');
  await refreshPage(page);
  await page.getByTestId('storage-usage-text').waitFor();
  expect(await storageText(page)).toBe(text);
  proof.h('the 3 GB default is displayed as "3 GB"');
  await setLimit(org, 3221225472);
  await refreshPage(page);
  await page.getByTestId('storage-usage-text').waitFor();
  const t3 = await storageText(page);
  proof.note(`UI with the default limit: "${t3}"`);
  expect(t3).toMatch(/ of 3 GB used$/);
  await page.screenshot({ path: `${__dirname}/../../docs/assets-proof/G-ui-storage-bar.png` });
});

test('G/O (UI). warnings at 80 % and 95 %, storage-full state disables uploads; 413 message has the numbers', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = new Proof('O-ui');
  await wipeOrg(org, ROLE);
  await setLimit(org, 10 * MB);
  await adminLogin(page, ROLE);
  await uploadAsset(org, ROLE, { fileName: 'w80.txt', content: makeText(8 * MB + 200 * 1024, 'w80'), assetType: 'DOCUMENT', name: `${P} w80` });
  await openAssets(page);
  proof.note(`at ${(await usage(org, ROLE)).data.percentUsed}%: ${await storageText(page)}`);
  await expect(page.getByTestId('storage-warning-80')).toBeVisible();
  await uploadAsset(org, ROLE, { fileName: 'w95.txt', content: makeText(1 * MB + 500 * 1024, 'w95'), assetType: 'DOCUMENT', name: `${P} w95` });
  await refreshPage(page);
  await expect(page.getByTestId('storage-warning-95')).toBeVisible();
  proof.note(`95 % warning: ${await page.getByTestId('storage-warning-95').innerText()}`);
  proof.h('pre-check in the upload dialog: a file larger than what is left is refused before uploading');
  await page.getByTestId('open-upload').click();
  await page.getByTestId('asset-file-input').setInputFiles({ name: 'big.txt', mimeType: 'text/plain', buffer: makeText(1 * MB, 'big') });
  await expect(page.getByTestId('upload-problem')).toBeVisible();
  const pre = await page.getByTestId('upload-problem').innerText();
  proof.note(`pre-check message: ${pre}`);
  expect(pre).toMatch(/needs 1 MB/);
  await expect(page.getByTestId('upload-submit')).toBeDisabled();
  await page.keyboard.press('Escape');
  proof.h('server 413 (usage changed after the page loaded): the message shows needed / left / how to free space');
  await refreshPage(page);
  await page.getByTestId('open-upload').click();
  await page.getByTestId('asset-file-input').setInputFiles({ name: 'mid.txt', mimeType: 'text/plain', buffer: makeText(200 * 1024, 'mid') });
  await uploadAsset(org, ROLE, { fileName: 'filler.txt', content: makeText(10 * MB - (await dbStorage(org))!.usedBytes - 100 * 1024, 'filler'), assetType: 'DOCUMENT', name: `${P} filler` });
  await page.getByTestId('upload-submit').click();
  await expect(page.getByTestId('upload-problem-numbers')).toBeVisible({ timeout: 20_000 });
  const msg = await page.getByTestId('upload-problem').innerText();
  proof.note(`413 shown in the dialog: ${msg}`);
  expect(msg).toMatch(/200 KB/);
  expect(msg).toMatch(/100 KB/);
  expect(msg).toMatch(/trash|older versions/i);
  await page.keyboard.press('Escape');
  proof.h('full: upload button disabled, storage-full banner, nothing deleted');
  await uploadAsset(org, ROLE, { fileName: 'last.txt', content: makeText(100 * 1024, 'last'), assetType: 'DOCUMENT', name: `${P} last` });
  await refreshPage(page);
  await expect(page.getByTestId('storage-full')).toBeVisible();
  await expect(page.getByTestId('open-upload')).toBeDisabled();
  proof.note(`full state: ${await page.getByTestId('storage-full').innerText()}`);
  await page.screenshot({ path: `${__dirname}/../../docs/assets-proof/O-ui-storage-full.png` });
  const d = await dbStorage(org);
  expect(d!.usedBytes).toBe(10 * MB);
});

test('T/K/AK (UI). upload through the dialog, progress, cancel mid-way leaves nothing, empty and error states', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = new Proof('AK');
  await wipeOrg(org, ROLE);
  await setLimit(org, 100 * MB);
  await adminLogin(page, ROLE);
  await openAssets(page, org, 'assets');
  proof.h('AK1 empty state');
  await expect(page.getByText('No assets found')).toBeVisible();
  proof.h('T-ui upload a PNG through the dialog');
  await page.getByTestId('open-upload').click();
  const png = await makePng(300, 200, 3);
  await page.getByTestId('asset-file-input').setInputFiles({ name: 'ui-banner.png', mimeType: 'image/png', buffer: png });
  await page.getByTestId('upload-submit').click();
  await expect(page.getByTestId('asset-upload-form')).toBeHidden({ timeout: 30_000 });
  const row = await sqlOne<any>(`SELECT id, fileSize, fileName FROM assets WHERE organizationId=? AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT 1`, [org]);
  proof.sql(`newest asset`, row);
  expect(Number(row.fileSize)).toBe(png.length);
  await page.getByTestId('storage-usage-text').waitFor();
  expect(await storageText(page)).toBe(`${fmt(png.length)} of 100 MB used`);
  await refreshPage(page);
  await expect(page.getByText('Ui banner').first()).toBeVisible();
  proof.h('AK2 cancel a slow upload: CDP throttles the upload to 1 MB/s, cancel after the progress bar appears');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 1024 * 1024 });
  await page.getByTestId('open-upload').click();
  await page.getByTestId('asset-file-input').setInputFiles({ name: 'slow.txt', mimeType: 'text/plain', buffer: makeText(20 * MB, 'slow') });
  await page.getByTestId('upload-submit').click();
  await expect(page.getByTestId('upload-progress')).toBeVisible();
  await page.waitForTimeout(2500);
  const mid = await dbStorage(org);
  proof.sql('during the upload', mid);
  await page.getByTestId('upload-cancel').click();
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.waitForTimeout(3000);
  const after = await dbStorage(org);
  proof.sql('after cancel', after);
  proof.sql('open reservations', await openReservations(org));
  expect(mid!.activeUploads).toBe(1);
  expect(after).toMatchObject({ usedBytes: png.length, reservedBytes: 0, activeUploads: 0 });
  const slow = await sqlOne<any>(`SELECT COUNT(*) n FROM assets WHERE organizationId=? AND fileName='slow.txt'`, [org]);
  expect(Number(slow.n)).toBe(0);
  proof.h('AK3 Escape closes the dialog; reopening starts clean');
  if (await page.getByTestId('asset-upload-form').isVisible()) await page.keyboard.press('Escape');
  await page.getByTestId('open-upload').click();
  await expect(page.getByTestId('upload-problem')).toHaveCount(0);
  await expect(page.getByTestId('upload-progress')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('asset-upload-form')).toBeHidden();
  proof.h('AK4 a failing list request shows an error with "Try again" (no silent empty list)');
  await page.route('**/api/v1/organizations/*/assets?**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Simulated failure' }) }));
  await page.getByRole('combobox').filter({ hasText: /Recently updated/ }).first().click().catch(() => undefined);
  await page.getByRole('option', { name: 'Name A–Z' }).click().catch(() => undefined);
  await expect(page.getByTestId('asset-list-error')).toBeVisible({ timeout: 15_000 });
  proof.note(`error state: ${await page.getByTestId('asset-list-error').innerText()}`);
  await page.unroute('**/api/v1/organizations/*/assets?**');
  await page.getByTestId('asset-list-error').getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('asset-list-error')).toBeHidden({ timeout: 15_000 });
});

test('L/Z (UI). trash and bundles from the admin screens, then refresh', async ({ page }) => {
  test.setTimeout(180_000);
  const proof = new Proof('Z-ui');
  await wipeOrg(org, ROLE);
  await setLimit(org, 100 * MB);
  const a = await uploadAsset(org, ROLE, { fileName: 'z-ui.png', content: await makePng(60, 40, 5), assetType: 'IMAGE', name: `${P} zui` });
  await adminLogin(page, ROLE);
  proof.h('Z-ui create a bundle and add the file');
  await openAssets(page, org, 'bundles');
  await page.getByTestId('bundle-new').click();
  await page.getByTestId('bundle-name').fill(`${P} UI bundle`);
  await page.getByTestId('bundle-visibility').selectOption('PRIVATE');
  await page.getByTestId('bundle-save').click();
  await expect(page.getByTestId('bundle-detail-name')).toHaveText(`${P} UI bundle`);
  await page.getByTestId('bundle-add-select').selectOption(a.data.id);
  await page.getByTestId('bundle-add').click();
  await expect(page.getByTestId(`bundle-item-${a.data.id}`)).toBeVisible();
  const db1 = await sqlOne<any>(`SELECT b.name, b.visibility, COUNT(i.id) n FROM asset_bundles b LEFT JOIN asset_bundle_items i ON i.assetBundleId=b.id WHERE b.organizationId=? AND b.deletedAt IS NULL GROUP BY b.id`, [org]);
  proof.sql('bundle in the database', db1);
  expect(db1).toMatchObject({ name: `${P} UI bundle`, visibility: 'PRIVATE', n: 1 });
  await refreshPage(page);
  await expect(page.getByText(`${P} UI bundle`).first()).toBeVisible();
  proof.h('L-ui move to trash from the library, see it in Trash (still counted), restore');
  await openAssets(page, org, 'trash');
  await expect(page.getByTestId('trash-empty')).toBeVisible();
  await api('DELETE', orgPath(org, `/assets/${a.data.id}`), { token: (await as(ROLE)).token });
  await refreshPage(page);
  await expect(page.getByTestId(`trash-row-${a.data.id}`)).toBeVisible();
  proof.note(`trash header: ${await page.getByTestId('trash-total').innerText()} | storage bar trash: ${await page.getByTestId('storage-trash').innerText()}`);
  expect(await page.getByTestId('storage-trash').innerText()).toBe(fmt(Number(a.data.fileSize)));
  await page.getByTestId(`restore-${a.data.id}`).click();
  await expect(page.getByTestId('trash-empty')).toBeVisible();
  const r = await sqlOne<any>(`SELECT deletedAt FROM assets WHERE id=?`, [a.data.id]);
  expect(r.deletedAt).toBeNull();
  proof.h('delete forever with confirmation frees the space');
  await api('DELETE', orgPath(org, `/assets/${a.data.id}`), { token: (await as(ROLE)).token });
  await refreshPage(page);
  await page.getByTestId(`purge-${a.data.id}`).click();
  await page.getByRole('button', { name: 'Delete forever' }).last().click();
  await expect(page.getByTestId('trash-empty')).toBeVisible();
  const d = await dbStorage(org);
  proof.sql('after delete forever', d);
  expect(d!.usedBytes).toBe(0);
  await refreshPage(page);
  expect(await storageText(page)).toBe('0 B of 100 MB used');
});

test('AN (UI). no fake claims; VIEWER has no Assets page; the portal downloads, locks and zips for real', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const proof = new Proof('AN');
  await adminLogin(page, 'ORG_A_OWNER');
  for (const tab of ['overview', 'storage']) {
    await openAssets(page, f.orgA.id, tab);
    const body = await page.locator('body').innerText();
    for (const claim of ['Managed CDN', 'Enterprise Plan', '50 GB', 'Intelligent Library']) {
      proof.check(`admin "${tab}" tab does not claim "${claim}"`, body.includes(claim), false);
    }
    expect(body).not.toContain('Managed CDN');
    expect(body).not.toContain('Enterprise Plan');
    expect(body).not.toContain('50 GB');
  }
  proof.h('AN2 VIEWER: no Assets entry in the navigation (the backend gives VIEWER no asset permission)');
  const viewerCtx = await browser.newContext();
  const vp = await viewerCtx.newPage();
  await adminLogin(vp, 'ORG_A_VIEWER');
  await vp.goto(`${ENV.ADMIN_UI}/organizations/${f.orgA.id}/dashboard`);
  await dismissPricing(vp);
  await vp.waitForLoadState('networkidle').catch(() => undefined);
  const nav = await vp.locator('nav').allInnerTexts();
  proof.note(`VIEWER navigation: ${nav.join(' | ').replace(/\s+/g, ' ').slice(0, 400)}`);
  expect(nav.join(' ')).not.toMatch(/\bAssets\b/);
  await viewerCtx.close();
  proof.h('AN3 portal: real download, locked bundle text, real ZIP; no fake "brand kit" toast, no "Copy Asset URL"');
  // the portal blocks every page until payout destination + tax details exist: complete them for the test affiliate
  const affTok = (await as('AFFILIATE_2')).token;
  const methods = await api('GET', '/affiliate/me/payout-methods', { token: affTok });
  if (!listData(methods).length) {
    const pm = await api('POST', '/affiliate/me/payout-methods', { token: affTok, body: { type: 'UPI', details: { upiId: 'e2e-affiliate2@upi' } } });
    proof.http('POST (test affiliate profile)', '/affiliate/me/payout-methods', { ...pm, body: { status: pm.status } });
  }
  const tax = await api('PATCH', '/affiliate/me/tax-profile', { token: affTok, body: { panOrTaxId: 'ABCDE1234F', taxClassification: 'INDIVIDUAL' } });
  const profileBody = { phone: '+919800000002', country: 'India', partnerType: 'CONTENT_CREATOR', primaryMarket: 'India', audienceSize: '10K-50K', website: 'https://example.com/e2e-affiliate-2', bio: 'E2E test affiliate used by the assets audit UI scenarios.', socialProfiles: { instagram: 'https://instagram.com/e2e_affiliate_2' } };
  const prof = await api('PATCH', '/affiliate/me/profile', { token: affTok, body: profileBody });
  proof.http('PATCH (test affiliate profile)', '/affiliate/me/profile', { ...prof, body: { status: prof.status } });
  const av = await upload('/affiliate/me/avatar', { token: affTok, fileName: 'avatar.png', content: await makePng(64, 64, 2) });
  proof.note(`avatar upload (multipart → storage): HTTP ${av.status}`);
  proof.http('PATCH (test affiliate profile)', '/affiliate/me/tax-profile', { ...tax, body: { status: tax.status } });
  // Bronze for the duration of the portal check, so the Silver bundle of scenario AB is shown locked
  const changeTier = (tierId: string) =>
    api('POST', orgPath(f.orgA.id, `/affiliate-performance/${f.orgA.affiliates[1].id}/change-tier`), { token: ownerTok, body: { newTierId: tierId, programId: f.orgA.programs[0].id, reason: 'e2e assets UI lock check' } });
  const ownerTok = (await as('ORG_A_OWNER')).token;
  expect((await changeTier(f.orgA.tiers.BRONZE.id)).status).toBeLessThan(300);
  const portal = await browser.newContext({ acceptDownloads: true });
  const pp = await portal.newPage();
  await pp.addInitScript(([orgId]) => sessionStorage.setItem('partneriq_current_org_id', orgId), [f.orgA.id]);
  await pp.goto(`${ENV.PORTAL_UI}/login`);
  const cookie = pp.getByRole('button', { name: /Accept/i });
  if (await cookie.first().isVisible({ timeout: 2000 }).catch(() => false)) await cookie.first().click();
  await pp.locator('input[type=email]').first().fill(f.users.AFFILIATE_2.email);
  await pp.locator('input[type=password]').first().fill(ENV.PASSWORD);
  await pp.locator('form button[type=submit]').first().click();
  await pp.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await pp.goto(`${ENV.PORTAL_UI}/assets`);
  await pp.waitForLoadState('networkidle').catch(() => undefined);
  // the portal opens a welcome / onboarding dialog for new partners: close it first
  for (let i = 0; i < 3; i++) {
    const overlay = pp.locator('div.fixed.inset-0.z-50');
    if (!(await overlay.first().isVisible().catch(() => false))) break;
    await pp.keyboard.press('Escape');
    await pp.waitForTimeout(300);
  }
  const portalText = await pp.locator('body').innerText();
  proof.check('portal has no "Download Brand Kit (.ZIP)" button', portalText.includes('Download Brand Kit'), false);
  proof.check('portal has no "Copy Asset URL"', portalText.includes('Copy Asset URL'), false);
  expect(portalText).not.toContain('Download Brand Kit');
  const dlButton = pp.locator('[data-testid^="portal-download-"]').first();
  if (await dlButton.count()) {
    const [download] = await Promise.all([pp.waitForEvent('download', { timeout: 20_000 }), dlButton.click()]);
    proof.note(`portal download started: suggested file name "${download.suggestedFilename()}"`);
    expect(download.suggestedFilename()).not.toBe('');
  } else proof.note('no downloadable file listed for AFFILIATE_2 in Org A (nothing to click)');
  const zipButton = pp.locator('[data-testid^="portal-bundle-zip-"]').first();
  if (await zipButton.count()) {
    const [zip] = await Promise.all([pp.waitForEvent('download', { timeout: 60_000 }), zipButton.click()]);
    proof.note(`portal ZIP download: "${zip.suggestedFilename()}"`);
    expect(zip.suggestedFilename()).toMatch(/\.zip$/);
  }
  const locked = pp.locator('[data-testid^="portal-bundle-lock-"]');
  const lockedTexts = await locked.allInnerTexts();
  proof.note(`locked bundle texts (AFFILIATE_2 at Bronze): ${JSON.stringify(lockedTexts)}`);
  expect(lockedTexts.some((t) => /^Unlocks at .*SILVER/.test(t))).toBe(true);
  await pp.screenshot({ path: `${__dirname}/../../docs/assets-proof/AN-portal-assets.png`, fullPage: true });
  await portal.close();
  expect((await changeTier(f.orgA.tiers.GOLD.id)).status).toBeLessThan(300);
  void listData;
});
