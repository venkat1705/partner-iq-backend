import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { closeDb, sql, sqlOne } from '../lib/db';
import { loadFixtures } from '../lib/fixtures';
import { Proof } from '../lib/proof';
import { listKeys } from '../lib/s3';
import { as } from '../lib/session';

/**
 * BASELINE (original code, before any asset fix): what the existing upload, portal and input paths do.
 * Every expectation below states the CORRECT behaviour, so on the original code these tests fail; the failures are
 * the proof of the bugs. Run once against main + the storage module (not yet wired into features).
 */
const proof = new Proof('baseline/00-baseline');
const f = loadFixtures();
const org = f.orgA.id;
const P = `${f.prefix}-BL`;
test.afterAll(async () => closeDb());

test('BL-T upload through the UI flow stores the file', async () => {
  const owner = await as('ORG_A_OWNER');
  const file = { fileName: 'banner.png', mimeType: 'image/png', fileSize: 1234 };
  const url = await api('POST', `/organizations/${org}/assets/upload-url`, { token: owner.token, body: file });
  proof.h('BL-T step 1: POST /assets/upload-url (what the upload dialog calls)');
  proof.http('POST', `/organizations/${org}/assets/upload-url`, url, file);
  const put = await api('PUT', url.data?.uploadUrl?.replace(/^\/api\/v1/, '') || '/x', { token: owner.token, rawBody: 'PNGDATA', headers: { 'content-type': 'image/png' } });
  proof.h('BL-T step 2: PUT the bytes to the returned uploadUrl');
  proof.http('PUT', url.data?.uploadUrl, put);
  const body = { name: `${P} banner`, assetType: 'BANNER', sourceType: 'FILE', storageUrl: url.data?.uploadUrl, originalFileName: 'banner.png', fileSize: 1234, mimeType: 'image/png', status: 'PUBLISHED', isPublicToAffiliates: true };
  const created = await api('POST', `/organizations/${org}/assets`, { token: owner.token, body });
  proof.h('BL-T step 3: POST /assets (what the dialog does next)');
  proof.http('POST', `/organizations/${org}/assets`, created, body);
  const objects = await listKeys('');
  proof.note(`MinIO objects in the bucket after the "upload": ${JSON.stringify(objects)}`);
  proof.check('the upload route exists (PUT 2xx)', put.status < 300, true);
  proof.check('an object exists in storage', objects.length > 0, true);
  expect.soft(put.status).toBeLessThan(300);
  expect(objects.length).toBeGreaterThan(0);
});

test('BL-AG client-supplied size, key and checksum are not trusted', async () => {
  const owner = await as('ORG_A_OWNER');
  const body = { name: `${P} lie`, assetType: 'BANNER', sourceType: 'FILE', storageKey: `${f.orgB.id}/assets/stolen.png`, storageUrl: 'https://evil.example/x.png', originalFileName: 'x.png', fileSize: 209715199, mimeType: 'image/png', checksum: 'deadbeef', status: 'PUBLISHED', isPublicToAffiliates: true };
  const r = await api('POST', `/organizations/${org}/assets`, { token: owner.token, body });
  proof.h('BL-AG POST /assets with storageKey (Org B path), storageUrl, fileSize 199.99 MB, checksum');
  proof.http('POST', `/organizations/${org}/assets`, r, body);
  const row = r.data?.id ? await sqlOne(`SELECT storageKey, storageUrl, fileSize, checksum FROM assets WHERE id=?`, [r.data.id]) : null;
  proof.sql(`SELECT storageKey, storageUrl, fileSize, checksum FROM assets WHERE id='${r.data?.id}'`, row);
  const storage = await api('GET', `/organizations/${org}/asset-analytics/storage`, { token: owner.token });
  proof.http('GET', `/organizations/${org}/asset-analytics/storage`, { ...storage, body: { totalStorageBytes: storage.data?.totalStorageBytes, storageLimitBytes: storage.data?.storageLimitBytes } });
  proof.check('request rejected (4xx)', r.status >= 400 && r.status < 500, true);
  expect(r.status).toBeGreaterThanOrEqual(400);
});

test('BL-AA portal lists only published, public, in-program, non-deleted assets with working links', async () => {
  const owner = await as('ORG_A_OWNER');
  const pA1 = f.orgA.programs[0].id;
  const pA2 = f.orgA.programs[1].id;
  const mk = async (suffix: string, extra: Record<string, unknown>) => {
    const body = { name: `${P} ${suffix}`, assetType: 'SOCIAL_COPY', sourceType: 'TEXT', textContent: `${suffix} copy`, ...extra };
    const r = await api('POST', `/organizations/${org}/assets`, { token: owner.token, body });
    proof.http('POST', `/organizations/${org}/assets`, r, body);
    return r.data.id as string;
  };
  proof.h('BL-AA setup: draft, private, program-A2-only, deleted, and one correct asset');
  const draft = await mk('draft', { status: 'DRAFT', isPublicToAffiliates: false });
  const priv = await mk('private', { status: 'PUBLISHED', isPublicToAffiliates: false });
  const a2only = await mk('program-a2-only', { status: 'PUBLISHED', isPublicToAffiliates: true, programId: pA2 });
  const deleted = await mk('deleted', { status: 'PUBLISHED', isPublicToAffiliates: true });
  await api('DELETE', `/organizations/${org}/assets/${deleted}`, { token: owner.token });
  const ok = await mk('visible', { status: 'PUBLISHED', isPublicToAffiliates: true, programId: pA1 });
  await new Promise((r) => setTimeout(r, 1500)); // dbStore writes land in MySQL in the background
  const a1 = await as('AFFILIATE_1');
  const list = await api('GET', `/affiliate/me/assets?organizationId=${org}`, { token: a1.token });
  proof.h('BL-AA GET /affiliate/me/assets as AFFILIATE_1 (program A1)');
  proof.http('GET', `/affiliate/me/assets?organizationId=${org}`, list);
  const ids = (list.data || []).map((a: any) => a.id);
  const leaked = { draft: ids.includes(draft), private: ids.includes(priv), programA2Only: ids.includes(a2only), deleted: ids.includes(deleted) };
  proof.check('leaked assets', leaked, { draft: false, private: false, programA2Only: false, deleted: false });
  proof.check('the visible asset is listed', ids.includes(ok), true);
  expect(leaked).toEqual({ draft: false, private: false, programA2Only: false, deleted: false });
});

test('BL-AB portal has a bundle API that hides tier-locked files', async () => {
  const a1 = await as('AFFILIATE_1');
  const r = await api('GET', `/affiliate/me/asset-bundles?organizationId=${org}`, { token: a1.token });
  proof.h('BL-AB GET /affiliate/me/asset-bundles');
  proof.http('GET', `/affiliate/me/asset-bundles?organizationId=${org}`, r);
  const orgScoped = await api('GET', `/organizations/${org}/affiliate/asset-bundles`, { token: a1.token });
  proof.h('BL-AB the org-scoped affiliate bundle route with a portal token');
  proof.http('GET', `/organizations/${org}/affiliate/asset-bundles`, orgScoped);
  proof.check('portal bundle API exists', r.status, 200);
  expect(r.status).toBe(200);
});
