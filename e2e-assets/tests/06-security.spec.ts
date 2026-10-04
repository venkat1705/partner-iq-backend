import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import { api } from '../lib/api';
import { closeDb, db, sql, sqlOne } from '../lib/db';
import { loadFixtures } from '../lib/fixtures';
import { Proof } from '../lib/proof';
import { listKeys } from '../lib/s3';
import { as } from '../lib/session';
import { MB, dbStorage, listData, openReservations, orgPath, proofUpload, uploadAsset, uploadVersion } from '../lib/assets';
import { makePng, makeText, upload } from '../lib/upload';

const f = loadFixtures();
const A = f.orgA.id;
const B = f.orgB.id;
const [pA1] = f.orgA.programs.map((p) => p.id);
const P = `${f.prefix}-X${Date.now().toString(36)}`;
test.afterAll(async () => closeDb());

const tok = async (role: string) => (await as(role)).token;
async function fileIn(org: string, role: string, name = 'x.png', extra: Record<string, string> = {}) {
  const r = await uploadAsset(org, role, { fileName: name, content: name.endsWith('.png') ? await makePng(20, 20, name.length) : makeText(500, name), assetType: 'IMAGE', name: `${P} ${name}`, fields: extra });
  if (r.status !== 201) throw new Error(`upload ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.data;
}
async function bundleIn(org: string, role: string, name: string, body: Record<string, unknown> = { visibility: 'PRIVATE' }) {
  const r = await api('POST', orgPath(org, '/asset-bundles'), { token: await tok(role), body: { name: `${P} ${name}`, ...body } });
  if (r.status !== 201) throw new Error(`bundle: ${r.status} ${JSON.stringify(r.body)}`);
  return r.data;
}
/** Row counts that must not change when a request is refused. */
async function footprint(org: string) {
  const one = async (q: string) => Number((await sqlOne<any>(q, [org])).n);
  return {
    assets: await one(`SELECT COUNT(*) n FROM assets WHERE organizationId=?`),
    versions: await one(`SELECT COUNT(*) n FROM asset_versions v JOIN assets a ON a.id=v.assetId WHERE a.organizationId=?`),
    bundles: await one(`SELECT COUNT(*) n FROM asset_bundles WHERE organizationId=?`),
    items: await one(`SELECT COUNT(*) n FROM asset_bundle_items i JOIN asset_bundles b ON b.id=i.assetBundleId WHERE b.organizationId=?`),
    objects: await one(`SELECT COUNT(*) n FROM stored_objects WHERE organizationId=?`),
    openReservations: await one(`SELECT COUNT(*) n FROM storage_reservations WHERE organizationId=? AND status='RESERVED'`),
    usedBytes: (await dbStorage(org))?.usedBytes ?? 0,
    s3: (await listKeys(`orgs/${org}/`)).length,
  };
}

test('AE. organization isolation: Org A staff cannot read, change, download or bundle Org B files', async () => {
  const proof = new Proof('AE');
  const bFile = await fileIn(B, 'ORG_B_OWNER', 'b-secret.png');
  const bBundle = await bundleIn(B, 'ORG_B_OWNER', 'b bundle');
  const aBundle = await bundleIn(A, 'ORG_A_OWNER', 'a bundle');
  const aFile = await fileIn(A, 'ORG_A_OWNER', 'a-own.png');
  const t = await tok('ORG_A_OWNER');
  const before = await footprint(B);
  const calls: Array<[string, string, unknown?]> = [
    ['GET', orgPath(B, '/assets')],
    ['GET', orgPath(B, `/assets/${bFile.id}`)],
    ['GET', orgPath(B, `/assets/${bFile.id}/download`)],
    ['GET', orgPath(B, '/storage/usage')],
    ['GET', orgPath(A, `/assets/${bFile.id}`)],
    ['GET', orgPath(A, `/assets/${bFile.id}/download`)],
    ['GET', orgPath(A, `/assets/${bFile.id}/thumbnail`)],
    ['GET', orgPath(A, `/assets/${bFile.id}/versions`)],
    ['PATCH', orgPath(A, `/assets/${bFile.id}`), { name: 'pwned' }],
    ['DELETE', orgPath(A, `/assets/${bFile.id}`)],
    ['DELETE', orgPath(A, `/assets/${bFile.id}/permanent`)],
    ['POST', orgPath(A, '/assets/bulk-action'), { action: 'ARCHIVE', assetIds: [bFile.id] }],
    ['POST', orgPath(A, '/assets/bulk-action'), { action: 'MOVE', assetIds: [aFile.id, bFile.id], folderPath: 'x' }],
    ['POST', orgPath(A, `/asset-bundles/${aBundle.id}/assets`), { assetId: bFile.id }],
    ['PATCH', orgPath(A, `/asset-bundles/${aBundle.id}`), { coverImageAssetId: bFile.id }],
    ['GET', orgPath(A, `/asset-bundles/${bBundle.id}`)],
    ['GET', orgPath(A, `/asset-bundles/${bBundle.id}/zip`)],
    ['DELETE', orgPath(A, `/asset-bundles/${bBundle.id}`)],
  ];
  proof.h('AE1 (a bulk request mixing an own and a foreign id is refused as a whole: the own file is not moved either)');
  const statuses: string[] = [];
  for (const [m, p, body] of calls) {
    const r = await api(m, p, { token: t, body });
    proof.http(`${m} (as Org A owner)`, p, r, body);
    statuses.push(`${m} ${p} -> ${r.status}`);
    expect([400, 403, 404], `${m} ${p}`).toContain(r.status);
  }
  proof.h('AE2 upload a version onto Org B\'s asset through Org A\'s path');
  const v = await uploadVersion(A, 'ORG_A_OWNER', bFile.id, { fileName: 'v.png', content: await makePng(10, 10) });
  proofUpload(proof, 'AE2', orgPath(A, `/assets/${bFile.id}/versions/upload`), v, {});
  expect([403, 404]).toContain(v.status);
  const after = await footprint(B);
  proof.note(`Org B footprint before=${JSON.stringify(before)}\nOrg B footprint after =${JSON.stringify(after)}`);
  expect(after).toEqual(before);
  const row = await sqlOne<any>(`SELECT name, deletedAt FROM assets WHERE id=?`, [bFile.id]);
  expect(row).toEqual({ name: `${P} b-secret.png`, deletedAt: null });
  const own = await sqlOne<any>(`SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.folderPath')) folder, deletedAt FROM assets WHERE id=?`, [aFile.id]);
  proof.sql(`own file after the refused mixed bulk MOVE`, own);
  expect(own.folder).not.toBe('x');
  const itemsA = await sql<any>(`SELECT assetId FROM asset_bundle_items WHERE assetBundleId=?`, [aBundle.id]);
  expect(itemsA).toEqual([]);
  proof.h('AE3 affiliates of Org B see nothing of Org A, even with ?organizationId=A');
  const bAff = await tok('AFFILIATE_B1');
  for (const p of [`/affiliate/me/assets?organizationId=${A}`, `/affiliate/me/asset-bundles?organizationId=${A}`, `/affiliate/me/assets/${aFile.id}/download`]) {
    const r = await api('GET', p, { token: bAff });
    proof.http('GET (as AFFILIATE_B1)', p, { ...r, body: Array.isArray(r.data) ? `${r.data.length} items` : r.body });
    if (r.status === 200) expect(listData(r).length).toBe(0);
    else expect([403, 404]).toContain(r.status);
  }
});

test('AF. permissions table: every role × every asset action (backend is the source of truth)', async () => {
  test.setTimeout(300_000);
  const proof = new Proof('AF');
  const roles = ['ORG_A_OWNER', 'ORG_A_ADMIN', 'ORG_A_MANAGER', 'ORG_A_VIEWER', 'ORG_A_NOPERM'];
  // expected from hasPermission(): OWNER/ADMIN all; PROGRAM_MANAGER all but delete; VIEWER and ANALYST nothing
  const can = (role: string, perm: string) => {
    if (role === 'ORG_A_OWNER' || role === 'ORG_A_ADMIN') return true;
    if (role === 'ORG_A_MANAGER') return !perm.endsWith('.delete');
    return false;
  };
  type Case = { name: string; perm: string; run: (t: string) => Promise<number> };
  const cases: Case[] = [
    { name: 'list assets', perm: 'assets.view', run: async (t) => (await api('GET', orgPath(A, '/assets'), { token: t })).status },
    { name: 'storage usage', perm: 'assets.view', run: async (t) => (await api('GET', orgPath(A, '/storage/usage'), { token: t })).status },
    { name: 'download', perm: 'assets.view', run: async (t) => (await api('GET', orgPath(A, `/assets/${(await fileIn(A, 'ORG_A_OWNER', 'af-dl.png')).id}/download`), { token: t })).status },
    { name: 'upload', perm: 'assets.create', run: async (t) => (await upload(orgPath(A, '/assets/upload'), { token: t, fileName: 'af.txt', content: makeText(100, 'af'), fields: { name: `${P} af`, assetType: 'DOCUMENT' } })).status },
    { name: 'create text asset', perm: 'assets.create', run: async (t) => (await api('POST', orgPath(A, '/assets'), { token: t, body: { name: `${P} txt`, assetType: 'SOCIAL_COPY', sourceType: 'TEXT', textContent: 'hi' } })).status },
    { name: 'edit', perm: 'assets.edit', run: async (t) => (await api('PATCH', orgPath(A, `/assets/${(await fileIn(A, 'ORG_A_OWNER', 'af-ed.png')).id}`), { token: t, body: { description: 'x' } })).status },
    { name: 'new version', perm: 'assets.edit', run: async (t) => (await upload(orgPath(A, `/assets/${(await fileIn(A, 'ORG_A_OWNER', 'af-v.png')).id}/versions/upload`), { token: t, fileName: 'v.png', content: await makePng(12, 12) })).status },
    { name: 'bulk move', perm: 'assets.edit', run: async (t) => (await api('POST', orgPath(A, '/assets/bulk-action'), { token: t, body: { action: 'MOVE', assetIds: [(await fileIn(A, 'ORG_A_OWNER', 'af-mv.png')).id], folderPath: 'Moved' } })).status },
    { name: 'move to trash', perm: 'assets.delete', run: async (t) => (await api('DELETE', orgPath(A, `/assets/${(await fileIn(A, 'ORG_A_OWNER', 'af-tr.png')).id}`), { token: t })).status },
    { name: 'bulk archive (trash)', perm: 'assets.delete', run: async (t) => (await api('POST', orgPath(A, '/assets/bulk-action'), { token: t, body: { action: 'ARCHIVE', assetIds: [(await fileIn(A, 'ORG_A_OWNER', 'af-ba.png')).id] } })).status },
    { name: 'permanent delete', perm: 'assets.delete', run: async (t) => { const x = await fileIn(A, 'ORG_A_OWNER', 'af-pd.png'); await api('DELETE', orgPath(A, `/assets/${x.id}`), { token: await tok('ORG_A_OWNER') }); return (await api('DELETE', orgPath(A, `/assets/${x.id}/permanent`), { token: t })).status; } },
    { name: 'empty trash', perm: 'assets.delete', run: async (t) => (await api('POST', orgPath(A, '/assets/trash/empty'), { token: t })).status },
    { name: 'list bundles', perm: 'assetBundles.view', run: async (t) => (await api('GET', orgPath(A, '/asset-bundles'), { token: t })).status },
    { name: 'create bundle', perm: 'assetBundles.create', run: async (t) => (await api('POST', orgPath(A, '/asset-bundles'), { token: t, body: { name: `${P} af ${crypto.randomUUID().slice(0, 6)}`, visibility: 'PRIVATE' } })).status },
    { name: 'edit bundle', perm: 'assetBundles.edit', run: async (t) => (await api('PATCH', orgPath(A, `/asset-bundles/${(await bundleIn(A, 'ORG_A_OWNER', `af-e ${crypto.randomUUID().slice(0, 6)}`)).id}`), { token: t, body: { description: 'x' } })).status },
    { name: 'publish bundle', perm: 'assetBundles.publish', run: async (t) => (await api('POST', orgPath(A, `/asset-bundles/${(await bundleIn(A, 'ORG_A_OWNER', `af-p ${crypto.randomUUID().slice(0, 6)}`, { visibility: 'ALL_PROGRAM_AFFILIATES', programId: pA1 })).id}/publish`), { token: t })).status },
    { name: 'archive bundle', perm: 'assetBundles.delete', run: async (t) => (await api('POST', orgPath(A, `/asset-bundles/${(await bundleIn(A, 'ORG_A_OWNER', `af-a ${crypto.randomUUID().slice(0, 6)}`)).id}/archive`), { token: t })).status },
    { name: 'delete bundle', perm: 'assetBundles.delete', run: async (t) => (await api('DELETE', orgPath(A, `/asset-bundles/${(await bundleIn(A, 'ORG_A_OWNER', `af-d ${crypto.randomUUID().slice(0, 6)}`)).id}`), { token: t })).status },
    { name: 'analytics', perm: 'assets.view', run: async (t) => (await api('GET', orgPath(A, '/asset-analytics'), { token: t })).status },
    { name: 'change storage limit', perm: 'platform', run: async (t) => (await api('PATCH', `/admin/storage/organizations/${A}/limit`, { token: t, body: { limitBytes: 1 } })).status },
  ];
  const header = `| action | permission | ${roles.map((r) => r.replace('ORG_A_', '')).join(' | ')} |`;
  const lines = [header, `|---|---|${roles.map(() => '---').join('|')}|`];
  const mismatches: string[] = [];
  for (const c of cases) {
    const cells: string[] = [];
    for (const role of roles) {
      const status = await c.run(await tok(role));
      const expected = c.perm === 'platform' ? false : can(role, c.perm);
      const ok = expected ? status < 300 : status === 403;
      cells.push(`${status}${ok ? '' : ' ✗'}`);
      if (!ok) mismatches.push(`${c.name} as ${role}: got ${status}, expected ${expected ? '2xx' : '403'}`);
    }
    lines.push(`| ${c.name} | ${c.perm} | ${cells.join(' | ')} |`);
  }
  proof.note(lines.join('\n'));
  proof.note(mismatches.length ? `MISMATCHES:\n${mismatches.join('\n')}` : 'all cells match the backend permission catalog');
  expect(mismatches).toEqual([]);
});

test('AG. bad input and extra fields are refused with clear errors', async () => {
  const proof = new Proof('AG');
  const t = await tok('ORG_A_OWNER');
  const x = await fileIn(A, 'ORG_A_OWNER', 'ag.png');
  const cases: Array<[string, string, unknown]> = [
    ['GET', orgPath(A, '/assets/not-a-uuid'), undefined],
    ['GET', orgPath(A, `/assets/${x.id}/download?versionId=nope`), undefined],
    ['GET', orgPath(A, `/assets/${x.id}/download?disposition=evil`), undefined],
    ['PATCH', orgPath(A, `/assets/${x.id}`), { name: 'a'.repeat(300) }],
    ['PATCH', orgPath(A, `/assets/${x.id}`), { tags: 'not-an-array' }],
    ['PATCH', orgPath(A, `/assets/${x.id}`), { tags: Array.from({ length: 200 }, (_, i) => `t${i}`) }],
    ['PATCH', orgPath(A, `/assets/${x.id}`), { status: 'HACKED' }],
    ['PATCH', orgPath(A, `/assets/${x.id}`), { programId: crypto.randomUUID() }],
    ['PATCH', orgPath(A, `/assets/${x.id}`), { isAdmin: true }],
    ['POST', orgPath(A, '/assets'), { name: 'file without upload', assetType: 'IMAGE', sourceType: 'FILE', storageKey: 'orgs/x/y', fileSize: 1 }],
    ['POST', orgPath(A, '/assets'), { name: 'u', assetType: 'LINK', sourceType: 'URL', externalUrl: 'javascript:alert(1)' }],
    ['POST', orgPath(A, '/assets/bulk-action'), { action: 'DESTROY', assetIds: [x.id] }],
    ['POST', orgPath(A, '/assets/bulk-action'), { action: 'MOVE', assetIds: [] }],
    ['POST', orgPath(A, '/assets/bulk-action'), { action: 'MOVE', assetIds: ['x'] }],
  ];
  for (const [m, p, body] of cases) {
    const r = await api(m, p, { token: t, body });
    proof.http(m, p, r, body);
    // a malformed id in the path is "not found" (404); everything else is a validation error (400)
    expect(r.status, `${m} ${p} ${JSON.stringify(body)}`).toBe(p.includes('not-a-uuid') ? 404 : 400);
    expect(typeof r.body?.message).toBe('string');
  }
  proof.h('AG2 multipart: unknown fields, JSON body, two files, huge field');
  const extra = await upload(orgPath(A, '/assets/upload'), { token: t, fileName: 'e.txt', content: makeText(10, 'e'), fields: { name: 'e', assetType: 'DOCUMENT', storageKey: 'orgs/evil', fileSize: '1' } });
  proofUpload(proof, 'AG2a unknown fields', orgPath(A, '/assets/upload'), extra, { fields: ['storageKey', 'fileSize'] });
  expect(extra.status).toBe(400);
  const json = await api('POST', orgPath(A, '/assets/upload'), { token: t, body: { name: 'x' }, headers: { 'x-file-size': '10' } });
  proof.http('POST (JSON instead of multipart)', orgPath(A, '/assets/upload'), json);
  expect(json.status).toBe(415);
  const big = await upload(orgPath(A, '/assets/upload'), { token: t, fileName: 'b.txt', content: makeText(10, 'b'), fields: { name: 'b', assetType: 'DOCUMENT', description: 'x'.repeat(70 * 1024) } });
  proofUpload(proof, 'AG2c 70 KB field', orgPath(A, '/assets/upload'), big, {});
  expect(big.status).toBe(400);
  const noFile = await upload(orgPath(A, '/assets/upload'), { token: t, fileName: '', content: Buffer.alloc(0), fields: { name: 'n', assetType: 'DOCUMENT' } });
  proofUpload(proof, 'AG2d no file name', orgPath(A, '/assets/upload'), noFile, {});
  expect(noFile.status).toBe(400);
});

test('AH. refused requests leave nothing behind (rows, objects, reservations, counter)', async () => {
  const proof = new Proof('AH');
  const t = await tok('ORG_A_OWNER');
  const before = await footprint(A);
  const tries = [
    await upload(orgPath(A, '/assets/upload'), { token: t, fileName: 'x.exe', content: Buffer.from('MZ....'), fields: { name: 'x', assetType: 'DOCUMENT' } }),
    await upload(orgPath(A, '/assets/upload'), { token: t, fileName: 'x.png', content: makeText(3000, 'not png'), fields: { name: 'x', assetType: 'IMAGE' } }),
    await upload(orgPath(A, '/assets/upload'), { token: t, fileName: 'x.txt', content: makeText(3000, 'x'), fields: { name: '', assetType: 'DOCUMENT' } }),
    await upload(orgPath(A, '/assets/upload'), { token: t, fileName: 'x.txt', content: makeText(3000, 'x'), fields: { name: 'x', assetType: 'NOPE' } }),
    await upload(orgPath(A, '/assets/upload'), { token: t, fileName: 'x.txt', content: makeText(3000, 'x'), fields: { name: 'x', assetType: 'DOCUMENT', programId: crypto.randomUUID() } }),
    await upload(orgPath(A, '/assets/upload'), { token: t, fileName: 'x.txt', content: makeText(2 * MB, 'x'), declaredSize: 1000, fields: { name: 'x', assetType: 'DOCUMENT' } }),
    await upload(orgPath(A, '/assets/upload'), { token: await tok('ORG_A_VIEWER'), fileName: 'x.txt', content: makeText(3000, 'x'), fields: { name: 'x', assetType: 'DOCUMENT' } }),
    await upload(orgPath(A, '/assets/upload'), { token: undefined, fileName: 'x.txt', content: makeText(3000, 'x'), fields: { name: 'x', assetType: 'DOCUMENT' } }),
  ];
  tries.forEach((r, i) => proofUpload(proof, `AH try ${i + 1}`, orgPath(A, '/assets/upload'), r, {}));
  for (const r of tries) expect(r.status).toBeGreaterThanOrEqual(400);
  const bad = await api('POST', orgPath(A, '/asset-bundles'), { token: t, body: { name: 'x', visibility: 'PARTNER_TIER', programId: pA1 } });
  expect(bad.status).toBe(400);
  await new Promise((r) => setTimeout(r, 1000));
  const after = await footprint(A);
  proof.note(`Org A footprint before=${JSON.stringify(before)}\nOrg A footprint after =${JSON.stringify(after)}`);
  expect(after).toEqual(before);
});

test('AI. a database write failure changes nothing and says so (tables locked by another session)', async () => {
  test.setTimeout(120_000);
  const proof = new Proof('AI');
  const t = await tok('ORG_A_OWNER');
  const x = await fileIn(A, 'ORG_A_OWNER', 'ai.png');
  const conn = await db().getConnection();
  try {
    await conn.query('LOCK TABLES assets WRITE, asset_bundles WRITE');
    proof.note('mysql(session 2)> LOCK TABLES assets WRITE, asset_bundles WRITE');
    const edit = await api('PATCH', orgPath(A, `/assets/${x.id}`), { token: t, body: { name: `${P} renamed while locked` }, timeoutMs: 30_000 });
    proof.http('PATCH (tables locked)', orgPath(A, `/assets/${x.id}`), edit, { name: 'renamed while locked' });
    const trash = await api('DELETE', orgPath(A, `/assets/${x.id}`), { token: t, timeoutMs: 30_000 });
    proof.http('DELETE (tables locked)', orgPath(A, `/assets/${x.id}`), trash);
    const bundle = await api('POST', orgPath(A, '/asset-bundles'), { token: t, body: { name: `${P} locked bundle`, visibility: 'PRIVATE' }, timeoutMs: 30_000 });
    proof.http('POST bundle (tables locked)', orgPath(A, '/asset-bundles'), bundle);
    for (const r of [edit, trash, bundle]) {
      expect(r.status).toBe(503);
      expect(r.body.message).toMatch(/try again|busy|not saved|nothing/i);
    }
  } finally {
    await conn.query('UNLOCK TABLES');
    conn.release();
  }
  const row = await sqlOne<any>(`SELECT name, deletedAt FROM assets WHERE id=?`, [x.id]);
  proof.sql(`SELECT name, deletedAt FROM assets WHERE id='${x.id}'`, row);
  expect(row).toEqual({ name: `${P} ai.png`, deletedAt: null });
  const b = await sql<any>(`SELECT id FROM asset_bundles WHERE name=?`, [`${P} locked bundle`]);
  expect(b).toEqual([]);
  const ok = await api('PATCH', orgPath(A, `/assets/${x.id}`), { token: t, body: { name: `${P} renamed after unlock` } });
  expect(ok.status).toBe(200);
  expect(await openReservations(A)).toEqual([]);
});

test('AJ. download counts: once per affiliate × file × minute, concurrent clicks included; admin downloads are not counted', async () => {
  const proof = new Proof('AJ');
  const x = await fileIn(A, 'ORG_A_OWNER', 'aj.png', { isPublicToAffiliates: 'true' });
  const count = async () => Number((await sqlOne<any>(`SELECT COUNT(*) n FROM affiliate_asset_activities WHERE assetId=? AND activityType='DOWNLOAD'`, [x.id])).n);
  const before = await (await api('GET', orgPath(A, '/asset-analytics'), { token: await tok('ORG_A_OWNER') })).data.totals.downloads;
  const a1 = await tok('AFFILIATE_1');
  const a2 = await tok('AFFILIATE_2');
  proof.h('AJ1 affiliate 1 clicks download 5 times at once and twice more; affiliate 2 once');
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => api('GET', `/affiliate/me/assets/${x.id}/download`, { token: a1 })));
  await api('GET', `/affiliate/me/assets/${x.id}/download`, { token: a1 });
  await api('GET', `/affiliate/me/assets/${x.id}/download`, { token: a1 });
  await api('GET', `/affiliate/me/assets/${x.id}/download`, { token: a2 });
  proof.note(`burst statuses: ${burst.map((r) => r.status).join(',')}`);
  await api('GET', orgPath(A, `/assets/${x.id}/download`), { token: await tok('ORG_A_OWNER') });
  const rows = await sql<any>(`SELECT affiliateId, idempotencyKey FROM affiliate_asset_activities WHERE assetId=? AND activityType='DOWNLOAD'`, [x.id]);
  proof.sql(`SELECT affiliateId, idempotencyKey FROM affiliate_asset_activities WHERE assetId='${x.id}' AND activityType='DOWNLOAD'`, rows);
  expect(await count()).toBe(2);
  const after = await (await api('GET', orgPath(A, '/asset-analytics'), { token: await tok('ORG_A_OWNER') })).data;
  proof.note(`analytics totals.downloads ${before} -> ${after.totals.downloads}; rule: ${after.downloadCountingRule}`);
  expect(after.totals.downloads - before).toBe(2);
  proof.h('AJ2 copy activity with the same idempotency key twice counts once');
  const key = crypto.randomUUID();
  for (let i = 0; i < 2; i++) {
    const r = await api('POST', `/affiliate/me/assets/${x.id}/activity`, { token: a1, body: { activityType: 'COPY', idempotencyKey: key } });
    proof.http('POST', `/affiliate/me/assets/${x.id}/activity`, r, { activityType: 'COPY', idempotencyKey: key });
  }
  const copies = Number((await sqlOne<any>(`SELECT COUNT(*) n FROM affiliate_asset_activities WHERE assetId=? AND activityType='COPY'`, [x.id])).n);
  expect(copies).toBe(1);
  const forged = await api('POST', `/affiliate/me/assets/${x.id}/activity`, { token: a1, body: { activityType: 'DOWNLOAD' } });
  proof.http('POST (forged DOWNLOAD activity)', `/affiliate/me/assets/${x.id}/activity`, forged, { activityType: 'DOWNLOAD' });
  expect(forged.status).toBe(400);
});

test('AL. audit log: every change has actor, action, target and before/after; shown in the admin activity feed', async () => {
  const proof = new Proof('AL');
  const vis = await bundleIn(A, 'ORG_A_OWNER', 'al visibility');
  const ch = await api('PATCH', orgPath(A, `/asset-bundles/${vis.id}`), { token: await tok('ORG_A_OWNER'), body: { visibility: 'ALL_PROGRAM_AFFILIATES', programId: pA1 } });
  proof.http('PATCH (visibility change)', orgPath(A, `/asset-bundles/${vis.id}`), { ...ch, body: { status: ch.status } });
  const audit = await sqlOne<any>(`SELECT action, beforeState, afterState FROM audit_logs WHERE resourceId=? ORDER BY createdAt DESC LIMIT 1`, [vis.id]);
  proof.sql(`SELECT action, beforeState, afterState FROM audit_logs WHERE resourceId='${vis.id}' ORDER BY createdAt DESC LIMIT 1`, audit);
  expect(audit.action).toBe('BUNDLE_VISIBILITY_CHANGED');
  const rows = await sql<any>(
    `SELECT action, COUNT(*) n, SUM(actorId IS NULL) noActor, SUM(resourceId IS NULL) noTarget, SUM(beforeState IS NULL AND afterState IS NULL) noState
       FROM audit_logs WHERE category IN ('ASSETS','ADMINISTRATION') AND (resourceType IN ('asset','asset_bundle','organization_storage')) AND organizationId IN (?) GROUP BY action ORDER BY action`,
    [[A, f.orgEmpty!.id]],
  );
  proof.sql(`SELECT action, COUNT(*), missing actor/target/state FROM audit_logs WHERE category IN ('ASSETS','ADMINISTRATION') AND resourceType IN (asset, asset_bundle, organization_storage) GROUP BY action`, rows);
  const actions = rows.map((r) => r.action);
  for (const required of ['ASSET_UPLOADED', 'ASSET_VERSION_ADDED', 'ASSET_UPDATED', 'ASSET_RENAMED', 'ASSET_MOVED', 'ASSET_TRASHED', 'ASSET_RESTORED', 'ASSET_PERMANENTLY_DELETED', 'ASSET_VERSION_DELETED', 'ASSET_VERSION_RESTORED', 'TRASH_EMPTIED', 'BUNDLE_CREATED', 'BUNDLE_UPDATED', 'BUNDLE_VISIBILITY_CHANGED', 'BUNDLE_PUBLISHED', 'BUNDLE_DELETED', 'BUNDLE_ASSET_ADDED', 'BUNDLE_ASSET_REMOVED', 'BUNDLE_REORDERED', 'STORAGE_LIMIT_CHANGED', 'STORAGE_USAGE_RECONCILED']) {
    expect(actions, required).toContain(required);
  }
  for (const r of rows) {
    expect(Number(r.noActor), r.action).toBe(0);
    expect(Number(r.noTarget), r.action).toBe(0);
  }
  const feed = await api('GET', orgPath(A, '/asset-activity'), { token: await tok('ORG_A_OWNER') });
  proof.http('GET', orgPath(A, '/asset-activity'), { ...feed, body: (feed.data || []).slice(0, 5) });
  expect(feed.status).toBe(200);
  expect(feed.data[0]).toMatchObject({ action: expect.any(String), actorName: expect.any(String), createdAt: expect.any(String) });
  const leak = await api('GET', orgPath(A, '/asset-activity'), { token: await tok('ORG_B_OWNER') });
  expect([403, 404]).toContain(leak.status);
});
