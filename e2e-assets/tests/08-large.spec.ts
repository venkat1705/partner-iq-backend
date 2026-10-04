import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import { api } from '../lib/api';
import { closeDb, sql, sqlOne } from '../lib/db';
import { ENV } from '../lib/env';
import { loadFixtures } from '../lib/fixtures';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';
import { adminLogin, dismissPricing, recoverFromAuthRace } from '../lib/ui';
import { GB, MB, dbStorage, listData, orgPath, proofUpload, setLimit, uploadAsset, usage, wipeOrg } from '../lib/assets';

/**
 * AM. 20,000 assets and 1,000 bundles (5 files each) seeded straight into MySQL for Org B (test organization), then
 * the admin list/search/sort/bundles, the portal lists and the admin page are timed. The rows are removed afterwards.
 * H (3 GB): one real run with the default limit — a 3 GB file is above the 200 MB per-file limit, so the 3 GB is
 * filled with 200 MB files and the next byte is refused.
 */
const f = loadFixtures();
const B = f.orgB.id;
const pB = f.orgB.programs[0]?.id;
const TAG = `${f.prefix}-AM`;
test.afterAll(async () => closeDb());

async function timed<T>(fn: () => Promise<T>) {
  const t0 = performance.now();
  const r = await fn();
  return { r, ms: performance.now() - t0 };
}

test('AM. 20k assets and 1k bundles: lists, search, sort, bundles and portal stay fast', async ({ page }) => {
  test.setTimeout(900_000);
  const proof = new Proof('AM');
  await sql(`DELETE i FROM asset_bundle_items i JOIN asset_bundles b ON b.id = i.assetBundleId WHERE b.name LIKE ?`, [`${TAG}%`]);
  await sql(`DELETE FROM asset_bundles WHERE name LIKE ?`, [`${TAG}%`]);
  await sql(`DELETE FROM assets WHERE name LIKE ?`, [`${TAG}%`]);
  proof.h('AM1 seed (direct SQL, batches of 1000)');
  const t0 = Date.now();
  const assetIds: string[] = [];
  const types = ['SOCIAL_COPY', 'EMAIL_TEMPLATE', 'PROMOTIONAL_COPY', 'CTA', 'PRODUCT_DESCRIPTION'];
  for (let batch = 0; batch < 20; batch++) {
    const rows: unknown[][] = [];
    for (let i = 0; i < 1000; i++) {
      const n = batch * 1000 + i;
      const id = crypto.randomUUID();
      assetIds.push(id);
      rows.push([id, B, pB ?? null, `${TAG} asset ${String(n).padStart(5, '0')} ${n % 7 === 0 ? 'summer' : 'winter'}`, types[n % 5], 'TEXT', n % 3 === 0 ? 'DRAFT' : 'PUBLISHED', `Copy ${n}`, n % 2, 1, 1, 1, JSON.stringify({ folderPath: `Folder ${n % 20}` }), `t${n % 50}`, 'e2e-am', new Date(Date.now() - n * 1000), new Date(Date.now() - n * 1000)]);
    }
    await sql(
      `INSERT INTO assets (id, organizationId, programId, name, assetType, sourceType, status, textContent, isPublicToAffiliates, isDownloadable, isCopyable, version, metadata, tags, createdBy, createdAt, updatedAt) VALUES ?`,
      [rows],
    );
  }
  for (let batch = 0; batch < 10; batch++) {
    const bundles: unknown[][] = [];
    const items: unknown[][] = [];
    for (let i = 0; i < 100; i++) {
      const n = batch * 100 + i;
      const id = crypto.randomUUID();
      bundles.push([id, B, pB ?? null, `${TAG} bundle ${n}`, `${TAG.toLowerCase()}-bundle-${n}`, n % 2 ? 'PUBLISHED' : 'DRAFT', 'ALL_PROGRAM_AFFILIATES', 0, n, 'e2e-am', 'e2e-am', new Date(), new Date()]);
      for (let k = 0; k < 5; k++) items.push([crypto.randomUUID(), id, assetIds[(n * 5 + k) % assetIds.length], k, 0, 'e2e-am']);
    }
    await sql(`INSERT INTO asset_bundles (id, organizationId, programId, name, slug, status, visibility, featured, displayOrder, createdBy, updatedBy, createdAt, updatedAt) VALUES ?`, [bundles]);
    await sql(`INSERT INTO asset_bundle_items (id, assetBundleId, assetId, displayOrder, isFeatured, createdBy) VALUES ?`, [items]);
  }
  const counts = await sqlOne<any>(`SELECT (SELECT COUNT(*) FROM assets WHERE organizationId=?) a, (SELECT COUNT(*) FROM asset_bundles WHERE organizationId=?) b, (SELECT COUNT(*) FROM asset_bundle_items i JOIN asset_bundles b ON b.id=i.assetBundleId WHERE b.organizationId=?) i`, [B, B, B]);
  proof.sql(`counts in Org B after seeding (${((Date.now() - t0) / 1000).toFixed(1)} s)`, counts);
  expect(Number(counts.a)).toBeGreaterThanOrEqual(20_000);
  expect(Number(counts.b)).toBeGreaterThanOrEqual(1_000);

  proof.h('AM2 admin API timings (each call measured end to end, warm)');
  const t = (await as('ORG_B_OWNER')).token;
  const calls: Array<[string, string, number]> = [
    ['first page', '/assets?limit=48&page=1', 1500],
    ['page 400', '/assets?limit=48&page=400', 1500],
    ['search "summer"', '/assets?limit=48&search=summer', 1500],
    ['search that matches nothing', '/assets?limit=48&search=zzzznotthere', 1500],
    ['sort by name', '/assets?limit=48&sortBy=name&sortDir=asc', 1500],
    ['filter type + status + folder', '/assets?limit=48&assetType=CTA&status=PUBLISHED&folderPath=Folder%203', 1500],
    ['tag filter', '/assets?limit=48&tag=t7', 1500],
    ['folders', '/assets/folders', 1500],
    ['bundles list (1k)', '/asset-bundles', 3000],
    ['storage usage', '/storage/usage', 1000],
    ['analytics', '/asset-analytics', 3000],
    ['usage intelligence', '/asset-analytics/usage-intelligence', 3000],
    ['storage analytics', '/asset-analytics/storage', 3000],
  ];
  const slow: string[] = [];
  for (const [label, p, budget] of calls) {
    await api('GET', orgPath(B, p), { token: t }); // warm
    const { r, ms } = await timed(() => api('GET', orgPath(B, p), { token: t, timeoutMs: 60_000 }));
    const size = JSON.stringify(r.body ?? '').length;
    proof.note(`${label.padEnd(32)} HTTP ${r.status} ${ms.toFixed(0).padStart(6)} ms  ${String(Math.round(size / 1024)).padStart(6)} KB  ${r.body?.meta ? `total=${r.body.meta.total}` : Array.isArray(r.data) ? `items=${r.data.length}` : ''}`);
    expect(r.status, label).toBe(200);
    if (ms > budget) slow.push(`${label}: ${ms.toFixed(0)} ms > ${budget} ms`);
  }
  proof.h('AM3 portal (affiliate B1): assets and bundles');
  const bt = (await as('AFFILIATE_B1')).token;
  for (const [label, p] of [['portal assets', `/affiliate/me/assets?organizationId=${B}`], ['portal bundles', `/affiliate/me/asset-bundles?organizationId=${B}`]] as const) {
    await api('GET', p, { token: bt, timeoutMs: 120_000 });
    const { r, ms } = await timed(() => api('GET', p, { token: bt, timeoutMs: 120_000 }));
    const size = JSON.stringify(r.body ?? '').length;
    proof.note(`${label.padEnd(32)} HTTP ${r.status} ${ms.toFixed(0).padStart(6)} ms  ${String(Math.round(size / 1024)).padStart(6)} KB  items=${listData(r).length}`);
    expect(r.status).toBe(200);
    if (ms > 3000) slow.push(`${label}: ${ms.toFixed(0)} ms > 3000 ms`);
  }
  proof.h('AM4 admin page with 20k assets');
  await adminLogin(page, 'ORG_B_OWNER');
  const url = `${ENV.ADMIN_UI}/organizations/${B}/assets?tab=assets`;
  const t1 = Date.now();
  await page.goto(url);
  await page.getByTestId('storage-usage').or(page.locator('input[name=password]')).first().waitFor({ timeout: 60_000 }).catch(() => undefined);
  await recoverFromAuthRace(page, 'open assets (AM)', () => page.goto(url));
  await dismissPricing(page);
  await page.getByTestId('asset-count').waitFor({ timeout: 60_000 });
  const uiMs = Date.now() - t1;
  const countText = await page.getByTestId('asset-count').innerText();
  proof.note(`admin page ready in ${uiMs} ms; "${countText.replace(/\s+/g, ' ')}"`);
  expect(countText).toMatch(/of 2\d,\d{3}|of 2\d\d\d\d/);
  await page.getByTestId('asset-page-next').click();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  proof.note(`after "Next": ${(await page.getByTestId('asset-page').innerText()).trim()}`);
  proof.note(slow.length ? `OVER BUDGET:\n${slow.join('\n')}` : 'all calls within budget');
  // cleanup: test rows only
  await sql(`DELETE i FROM asset_bundle_items i JOIN asset_bundles b ON b.id = i.assetBundleId WHERE b.name LIKE ?`, [`${TAG}%`]);
  await sql(`DELETE FROM asset_bundles WHERE name LIKE ?`, [`${TAG}%`]);
  await sql(`DELETE FROM assets WHERE name LIKE ?`, [`${TAG}%`]);
  proof.note('seeded AM rows deleted again');
  expect(slow).toEqual([]);
});

test('H (3 GB). the real default limit: fill 3 GB with 200 MB files, then one more byte is refused', async () => {
  test.setTimeout(3_600_000);
  const proof = new Proof('H-3GB');
  const org = f.orgEmpty!.id;
  const ROLE = 'ORG_EMPTY_OWNER';
  await wipeOrg(org, ROLE);
  await setLimit(org, 3221225472, proof, 'back to the default for the 3 GB run');
  const per = 200 * MB; // the per-file limit
  const full = Math.floor((3 * GB) / per); // 15 files = 3,145,728,000 bytes
  const rest = 3 * GB - full * per; // 75,497,472 bytes
  proof.note(`plan: ${full} × ${per} + 1 × ${rest} = ${full * per + rest} bytes (= 3 GB), then 1 byte`);
  const t0 = Date.now();
  for (let i = 0; i < full; i++) {
    const r = await uploadAsset(org, ROLE, { fileName: `fill-${i}.txt`, content: { size: per, byte: 0x41 + (i % 20) }, assetType: 'DOCUMENT', name: `${f.prefix}-H3 fill ${i}`, timeoutMs: 600_000 });
    if (r.status !== 201) proofUpload(proof, `fill ${i}`, orgPath(org, '/assets/upload'), r, { size: per });
    expect(r.status, `file ${i}`).toBe(201);
  }
  const last = await uploadAsset(org, ROLE, { fileName: 'fill-last.txt', content: { size: rest }, assetType: 'DOCUMENT', name: `${f.prefix}-H3 last`, timeoutMs: 600_000 });
  proofUpload(proof, 'last piece', orgPath(org, '/assets/upload'), { ...last, body: last.status === 201 ? { fileSize: last.data.fileSize } : last.body }, { size: rest });
  expect(last.status).toBe(201);
  const u = await usage(org, ROLE);
  proof.note(`after ${(Date.now() - t0) / 1000} s: ${JSON.stringify({ usedBytes: u.data.usedBytes, limitBytes: u.data.limitBytes, availableBytes: u.data.availableBytes, percentUsed: u.data.percentUsed })}`);
  expect(u.data.usedBytes).toBe(3221225472);
  expect(u.data.availableBytes).toBe(0);
  const one = await uploadAsset(org, ROLE, { fileName: 'one.txt', content: Buffer.from('x'), assetType: 'DOCUMENT' });
  proofUpload(proof, 'one more byte', orgPath(org, '/assets/upload'), one, { size: 1 });
  expect(one.status).toBe(413);
  expect(one.body.message).toContain('of your 3 GB is left'); // same wording as the storage bar
  const d = await dbStorage(org);
  proof.sql(`SELECT * FROM organization_storage WHERE organizationId='${org}'`, d);
  expect(d).toMatchObject({ usedBytes: 3221225472, limitBytes: 3221225472, reservedBytes: 0 });
  const { listKeys } = await import('../lib/s3');
  const keys = await listKeys(`orgs/${org}/assets/`);
  const s3Bytes = keys.reduce((s, k) => s + k.size, 0);
  proof.note(`S3: ${keys.length} objects, ${s3Bytes} bytes`);
  expect(s3Bytes).toBe(3221225472);
  await wipeOrg(org, ROLE);
  const after = await dbStorage(org);
  proof.sql('after deleting the 3 GB of test files', after);
  expect(after!.usedBytes).toBe(0);
});
