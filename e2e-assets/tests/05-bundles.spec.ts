import { expect, test } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { api } from '../lib/api';
import { closeDb, sql, sqlOne } from '../lib/db';
import { loadFixtures } from '../lib/fixtures';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';
import { MB, listData, orgPath, proofUpload, uploadAsset } from '../lib/assets';
import { makePng, makeText } from '../lib/upload';

/** Bundles in Org A: two programs, Bronze/Silver/Gold in program A1, affiliates 1+2 in A1, affiliate 3 in A2. */
const f = loadFixtures();
const org = f.orgA.id;
const [pA1, pA2] = f.orgA.programs.map((p) => p.id);
const T = f.orgA.tiers;
const [aff1, aff2, aff3] = f.orgA.affiliates;
const P = `${f.prefix}-B${Date.now().toString(36)}`;
const SCRATCH = path.resolve(__dirname, '..', 'test-results', 'zips');
test.afterAll(async () => closeDb());

async function owner() {
  return (await as('ORG_A_OWNER')).token;
}
async function file(name: string, opts: { public?: boolean; programId?: string; content?: Buffer; status?: string } = {}) {
  const content = opts.content ?? (name.endsWith('.png') ? await makePng(40, 30, name.length) : makeText(2000, name));
  const r = await uploadAsset(org, 'ORG_A_OWNER', {
    fileName: name, content, assetType: name.endsWith('.png') ? 'IMAGE' : 'DOCUMENT', name: `${P} ${name}`, status: opts.status || 'PUBLISHED',
    fields: { isPublicToAffiliates: String(opts.public ?? false), ...(opts.programId ? { programId: opts.programId } : {}) },
  });
  if (r.status !== 201) throw new Error(`upload ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return { ...r.data, content };
}
async function bundle(name: string, body: Record<string, unknown>, assetIds: string[], publish = true) {
  const tok = await owner();
  const b = await api('POST', orgPath(org, '/asset-bundles'), { token: tok, body: { name: `${P} ${name}`, ...body } });
  if (b.status !== 201) throw new Error(`bundle ${name}: ${b.status} ${JSON.stringify(b.body)}`);
  for (const id of assetIds) {
    const add = await api('POST', orgPath(org, `/asset-bundles/${b.data.id}/assets`), { token: tok, body: { assetId: id } });
    if (add.status >= 300) throw new Error(`add ${id}: ${add.status} ${JSON.stringify(add.body)}`);
  }
  if (publish) {
    const p = await api('POST', orgPath(org, `/asset-bundles/${b.data.id}/publish`), { token: tok });
    if (p.status >= 300) throw new Error(`publish ${name}: ${p.status} ${JSON.stringify(p.body)}`);
  }
  return b.data.id as string;
}
async function portalBundles(role: string, organizationId = org) {
  const s = await as(role);
  const r = await api('GET', `/affiliate/me/asset-bundles?organizationId=${organizationId}`, { token: s.token });
  return { r, list: listData(r) as any[] };
}
async function setTier(affiliateId: string, tierId: string, programId = pA1) {
  const r = await api('POST', orgPath(org, `/affiliate-performance/${affiliateId}/change-tier`), { token: await owner(), body: { newTierId: tierId, programId, reason: 'e2e assets tier test' } });
  if (r.status >= 300) throw new Error(`change-tier: ${r.status} ${JSON.stringify(r.body)}`);
  return r;
}
const mine = (list: any[]) => list.filter((b) => String(b.name).startsWith(P));

test('Z. bundles CRUD: create, edit, add/remove/reorder items, publish, archive, delete — DB, audit', async () => {
  const proof = new Proof('Z');
  const tok = await owner();
  const a = await file('z-a.png');
  const b = await file('z-b.txt');
  const c = await file('z-c.txt');
  proof.h('Z1 create');
  const body = { name: `${P} Launch kit`, description: 'everything for launch', programId: pA1, visibility: 'ALL_PROGRAM_AFFILIATES' };
  const cr = await api('POST', orgPath(org, '/asset-bundles'), { token: tok, body });
  proof.http('POST', orgPath(org, '/asset-bundles'), cr, body);
  expect(cr.status).toBe(201);
  expect(cr.data.status).toBe('DRAFT');
  const id = cr.data.id;
  proof.h('Z2 add three, reorder, remove one');
  for (const x of [a, b, c]) expect((await api('POST', orgPath(org, `/asset-bundles/${id}/assets`), { token: tok, body: { assetId: x.id } })).status).toBeLessThan(300);
  const dup = await api('POST', orgPath(org, `/asset-bundles/${id}/assets`), { token: tok, body: { assetId: a.id } });
  proof.http('POST (same file again)', orgPath(org, `/asset-bundles/${id}/assets`), dup);
  expect(dup.status).toBe(409);
  const ro = await api('PATCH', orgPath(org, `/asset-bundles/${id}/reorder`), { token: tok, body: { assetIds: [c.id, a.id, b.id] } });
  proof.http('PATCH', orgPath(org, `/asset-bundles/${id}/reorder`), { ...ro, body: ro.data?.items?.map((i: any) => i.assetId) }, { assetIds: [c.id, a.id, b.id] });
  expect(ro.data.items.map((i: any) => i.assetId)).toEqual([c.id, a.id, b.id]);
  const badOrder = await api('PATCH', orgPath(org, `/asset-bundles/${id}/reorder`), { token: tok, body: { assetIds: [c.id, a.id] } });
  proof.http('PATCH reorder with a missing item', orgPath(org, `/asset-bundles/${id}/reorder`), badOrder);
  expect(badOrder.status).toBe(400);
  const rm = await api('DELETE', orgPath(org, `/asset-bundles/${id}/assets/${b.id}`), { token: tok });
  expect(rm.data.items.map((i: any) => i.assetId)).toEqual([c.id, a.id]);
  proof.h('Z3 edit');
  const ed = await api('PATCH', orgPath(org, `/asset-bundles/${id}`), { token: tok, body: { name: `${P} Launch kit v2`, description: 'updated' } });
  proof.http('PATCH', orgPath(org, `/asset-bundles/${id}`), { ...ed, body: { name: ed.data?.name, description: ed.data?.description } });
  expect(ed.data.name).toBe(`${P} Launch kit v2`);
  proof.h('Z4 publish, then archive (hidden), then delete');
  const pub = await api('POST', orgPath(org, `/asset-bundles/${id}/publish`), { token: tok });
  expect(pub.data.status).toBe('PUBLISHED');
  const db1 = await sqlOne<any>(`SELECT name, status, visibility, programId, deletedAt FROM asset_bundles WHERE id=?`, [id]);
  const items = await sql<any>(`SELECT assetId, displayOrder FROM asset_bundle_items WHERE assetBundleId=? ORDER BY displayOrder`, [id]);
  proof.sql(`SELECT name, status, visibility, programId, deletedAt FROM asset_bundles WHERE id='${id}'`, db1);
  proof.sql(`SELECT assetId, displayOrder FROM asset_bundle_items WHERE assetBundleId='${id}' ORDER BY displayOrder`, items);
  expect(items.map((i) => i.assetId)).toEqual([c.id, a.id]);
  const del = await api('DELETE', orgPath(org, `/asset-bundles/${id}`), { token: tok });
  proof.http('DELETE', orgPath(org, `/asset-bundles/${id}`), del);
  const after = await api('GET', orgPath(org, `/asset-bundles/${id}`), { token: tok });
  expect(after.status).toBe(404);
  const files = await sql<any>(`SELECT id, deletedAt FROM assets WHERE id IN (?)`, [[a.id, b.id, c.id]]);
  proof.sql(`files of the deleted bundle`, files);
  expect(files.every((x) => x.deletedAt === null)).toBe(true);
  proof.h('Z5 a new bundle may reuse the deleted name');
  const again = await api('POST', orgPath(org, '/asset-bundles'), { token: tok, body: { name: `${P} Launch kit v2`, visibility: 'PRIVATE' } });
  expect(again.status).toBe(201);
  proof.h('Z6 audit trail');
  const audit = await sql<any>(`SELECT action FROM audit_logs WHERE resourceId=? ORDER BY createdAt`, [id]);
  proof.sql(`SELECT action FROM audit_logs WHERE resourceId='${id}' ORDER BY createdAt`, audit.map((x) => x.action));
  expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(['BUNDLE_CREATED', 'BUNDLE_ASSET_ADDED', 'BUNDLE_REORDERED', 'BUNDLE_ASSET_REMOVED', 'BUNDLE_UPDATED', 'BUNDLE_PUBLISHED', 'BUNDLE_DELETED']));
  proof.h('Z7 validation');
  for (const bad of [
    { name: '' },
    { name: 'x', visibility: 'PARTNER_TIER', programId: pA1 },
    { name: 'x', visibility: 'SPECIFIC_AFFILIATES', programId: pA1, affiliateIds: [] },
    { name: 'x', visibility: 'AFFILIATE_SEGMENT' },
    { name: 'x', programId: f.orgB.programs[0]?.id || crypto.randomUUID() },
    { name: 'x', visibility: 'PARTNER_TIER', programId: pA2, partnerTierId: T.GOLD.id },
    { name: 'x', startDate: '2026-12-01', endDate: '2026-11-01' },
    { name: 'x', status: 'PUBLISHED' },
    { name: 'x', organizationId: f.orgB.id },
  ]) {
    const r = await api('POST', orgPath(org, '/asset-bundles'), { token: tok, body: bad });
    proof.http('POST (invalid)', orgPath(org, '/asset-bundles'), r, bad);
    expect(r.status, JSON.stringify(bad)).toBe(400);
  }
});

test('AA. who can see a bundle (program, specific affiliates, private, draft, dates)', async () => {
  const proof = new Proof('AA');
  await setTier(aff1.id, T.GOLD.id);
  await setTier(aff2.id, T.GOLD.id);
  const x = await file('aa-x.png');
  const ids = {
    all: await bundle('AA all A1', { programId: pA1, visibility: 'ALL_PROGRAM_AFFILIATES' }, [x.id]),
    org: await bundle('AA all org', { visibility: 'ALL_PROGRAM_AFFILIATES' }, [x.id]),
    specific: await bundle('AA only aff2', { programId: pA1, visibility: 'SPECIFIC_AFFILIATES', affiliateIds: [aff2.id] }, [x.id]),
    priv: await bundle('AA private', { visibility: 'PRIVATE' }, [x.id]),
    draft: await bundle('AA draft', { programId: pA1, visibility: 'ALL_PROGRAM_AFFILIATES' }, [x.id], false),
    future: await bundle('AA future', { programId: pA1, visibility: 'ALL_PROGRAM_AFFILIATES', startDate: new Date(Date.now() + 86_400_000).toISOString() }, [x.id]),
    ended: await bundle('AA ended', { programId: pA1, visibility: 'ALL_PROGRAM_AFFILIATES', endDate: new Date(Date.now() + 2000).toISOString() }, [x.id]),
  };
  await new Promise((r) => setTimeout(r, 2500)); // let "ended" pass its end date
  const names = (list: any[]) => mine(list).map((b) => b.name.replace(`${P} `, '')).sort();
  const seen: Record<string, string[]> = {};
  for (const role of ['AFFILIATE_1', 'AFFILIATE_2', 'AFFILIATE_3']) {
    const { r, list } = await portalBundles(role);
    seen[role] = names(list);
    proof.http(`GET (as ${role})`, `/affiliate/me/asset-bundles?organizationId=${org}`, { ...r, body: seen[role] });
  }
  const b1 = await portalBundles('AFFILIATE_B1', org);
  proof.http('GET (as AFFILIATE_B1, other organization)', `/affiliate/me/asset-bundles?organizationId=${org}`, { ...b1.r, body: names(b1.list) });
  expect(seen.AFFILIATE_1).toEqual(['AA all A1', 'AA all org']);
  expect(seen.AFFILIATE_2).toEqual(['AA all A1', 'AA all org', 'AA only aff2']);
  expect(seen.AFFILIATE_3).toEqual(['AA all org']);
  expect(names(b1.list)).toEqual([]);
  proof.h('AA2 the admin sees all of them with their status');
  const adm = await api('GET', orgPath(org, '/asset-bundles'), { token: await owner() });
  proof.http('GET (admin)', orgPath(org, '/asset-bundles'), { ...adm, body: mine(listData(adm)).map((b: any) => [b.name.replace(`${P} `, ''), b.status, b.visibility]) });
  expect(mine(listData(adm)).length).toBeGreaterThanOrEqual(7);
  proof.h('AA3 detail of a bundle the affiliate cannot see → 404 (no existence leak)');
  for (const id of [ids.specific, ids.priv, ids.draft]) {
    const r = await api('GET', `/affiliate/me/asset-bundles/${id}`, { token: (await as('AFFILIATE_1')).token });
    proof.http('GET (as AFFILIATE_1)', `/affiliate/me/asset-bundles/${id}`, r);
    expect(r.status).toBe(404);
  }
  proof.h('AA4 a non-public file is downloadable through a visible bundle; private-only file is not');
  const dl = await api('GET', `/affiliate/me/assets/${x.id}/download`, { token: (await as('AFFILIATE_1')).token });
  proof.http('GET (as AFFILIATE_1)', `/affiliate/me/assets/${x.id}/download`, { ...dl, body: { status: dl.status, expiresAt: dl.data?.expiresAt } });
  expect(dl.status).toBe(200);
  const y = await file('aa-y.png');
  await bundle('AA private only', { visibility: 'PRIVATE' }, [y.id]);
  const dly = await api('GET', `/affiliate/me/assets/${y.id}/download`, { token: (await as('AFFILIATE_1')).token });
  proof.http('GET (as AFFILIATE_1)', `/affiliate/me/assets/${y.id}/download`, dly);
  expect(dly.status).toBe(403);
  proof.h('AA5 archive → disappears for affiliates');
  await api('POST', orgPath(org, `/asset-bundles/${ids.all}/archive`), { token: await owner() });
  expect(names((await portalBundles('AFFILIATE_1')).list)).toEqual(['AA all org']);
});

test('AB. tier-locked bundles: locked without files, unlock on promotion, lock again on demotion', async () => {
  const proof = new Proof('AB');
  const gold = await file('ab-gold.png', { public: true });
  const silverId = await bundle('AB silver kit', { programId: pA1, visibility: 'PARTNER_TIER', partnerTierId: T.SILVER.id }, [gold.id]);
  const look = async (role: string) => {
    const { list } = await portalBundles(role);
    const b = list.find((x) => x.id === silverId);
    const detail = await api('GET', `/affiliate/me/asset-bundles/${silverId}`, { token: (await as(role)).token });
    const dl = await api('GET', `/affiliate/me/assets/${gold.id}/download`, { token: (await as(role)).token });
    const assets = listData(await api('GET', `/affiliate/me/assets?organizationId=${org}`, { token: (await as(role)).token })).map((a) => a.id);
    const zip = await fetch(`http://localhost:5000/api/v1/affiliate/me/asset-bundles/${silverId}/zip`, { headers: { authorization: `Bearer ${(await as(role)).token}` } });
    await zip.arrayBuffer();
    return { locked: b?.locked, items: b?.items?.length, requiredTier: b?.requiredTier?.name, lockReason: b?.lockReason, detail: detail.status, detailCode: detail.body?.code, download: dl.status, listsFile: assets.includes(gold.id), zip: zip.status };
  };
  proof.h('AB1 affiliate 1 BRONZE, affiliate 2 GOLD');
  await setTier(aff1.id, T.BRONZE.id);
  await setTier(aff2.id, T.GOLD.id);
  const bronze = await look('AFFILIATE_1');
  const goldView = await look('AFFILIATE_2');
  proof.note(`AFFILIATE_1 (Bronze): ${JSON.stringify(bronze)}`);
  proof.note(`AFFILIATE_2 (Gold):   ${JSON.stringify(goldView)}`);
  const silverName = `${f.prefix} SILVER`; // seeded tier name
  expect(bronze).toEqual({ locked: true, items: 0, requiredTier: silverName, lockReason: `Unlocks at ${silverName}`, detail: 403, detailCode: 'BUNDLE_LOCKED', download: 403, listsFile: false, zip: 403 });
  expect(goldView).toMatchObject({ locked: false, items: 1, detail: 200, download: 200, listsFile: true, zip: 200 });
  proof.h('AB2 promote affiliate 1 to SILVER → unlocked');
  await setTier(aff1.id, T.SILVER.id);
  const promoted = await look('AFFILIATE_1');
  proof.note(`AFFILIATE_1 (Silver): ${JSON.stringify(promoted)}`);
  expect(promoted).toMatchObject({ locked: false, items: 1, detail: 200, download: 200 });
  proof.h('AB3 demote to BRONZE → locked again (an already issued link expires within 5 minutes)');
  await setTier(aff1.id, T.BRONZE.id);
  const demoted = await look('AFFILIATE_1');
  proof.note(`AFFILIATE_1 (Bronze again): ${JSON.stringify(demoted)}`);
  expect(demoted).toMatchObject({ locked: true, items: 0, download: 403 });
  proof.h('AB4 a high tier of another program (CLICKS9, level 9 in A2) never unlocks a Silver (A1) bundle');
  const crossId = await bundle('AB cross-program', { visibility: 'PARTNER_TIER', partnerTierId: T.SILVER.id }, [gold.id]);
  const { list } = await portalBundles('AFFILIATE_3');
  const cross = list.find((b) => b.id === crossId);
  proof.note(`AFFILIATE_3 sees: ${JSON.stringify(cross && { locked: cross.locked, items: cross.items.length, requiredTier: cross.requiredTier })}`);
  expect(cross?.locked).toBe(true);
  proof.h('AB5 tier reward: Bronze tier lists the bundle in rewardsConfig.assetBundleIds → Bronze affiliates unlock it');
  const tok = await owner();
  // the tier update endpoint (gamification) validates the whole tier: send its current name / code / level with the change
  const tiers = listData(await api('GET', `/organizations/${org}/partner-tiers?programId=${pA1}`, { token: tok }));
  const bronzeRow = tiers.find((t: any) => t.id === T.BRONZE.id);
  const tierBody = (ids: string[]) => ({ name: bronzeRow.name, code: bronzeRow.code, level: bronzeRow.level, programId: pA1, rewardsConfig: { ...(bronzeRow.rewardsConfig || {}), assetBundleIds: ids } });
  const tierRow = await api('PATCH', `/organizations/${org}/partner-tiers/${T.BRONZE.id}`, { token: tok, body: tierBody([silverId]) });
  proof.http('PATCH', `/organizations/${org}/partner-tiers/${T.BRONZE.id}`, { ...tierRow, body: { status: tierRow.status, rewardsConfig: tierRow.data?.rewardsConfig } }, tierBody([silverId]));
  expect(tierRow.status).toBe(200);
  const reward = await look('AFFILIATE_1');
  proof.note(`AFFILIATE_1 (Bronze with reward): ${JSON.stringify(reward)}`);
  expect(reward).toMatchObject({ locked: false, items: 1, download: 200 });
  const reset = await api('PATCH', `/organizations/${org}/partner-tiers/${T.BRONZE.id}`, { token: tok, body: tierBody([]) });
  expect(reset.status).toBe(200);
  expect((await look('AFFILIATE_1')).locked).toBe(true);
  await setTier(aff1.id, T.GOLD.id);
});

test('AC. ZIP: streamed, correct content, duplicate names, only allowed files, large bundle memory', async () => {
  test.setTimeout(600_000);
  const proof = new Proof('AC');
  fs.mkdirSync(SCRATCH, { recursive: true });
  const tok = await owner();
  const one = await file('same.txt', { content: makeText(5000, 'one') });
  const two = await file('same.txt', { content: makeText(7000, 'two') });
  const img = await file('pic.png');
  const draft = await file('draft.txt', { status: 'DRAFT' });
  const id = await bundle('AC kit', { programId: pA1, visibility: 'ALL_PROGRAM_AFFILIATES' }, [one.id, two.id, img.id, draft.id]);
  const get = async (url: string, token: string, out: string) => {
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(out, buf);
    return { status: r.status, bytes: buf.length, type: r.headers.get('content-type'), disposition: r.headers.get('content-disposition') };
  };
  proof.h('AC1 admin ZIP');
  const adminZip = path.join(SCRATCH, 'admin.zip');
  const ar = await get(`http://localhost:5000/api/v1${orgPath(org, `/asset-bundles/${id}/zip`)}`, tok, adminZip);
  proof.note(`GET …/asset-bundles/${id}/zip (admin) -> ${JSON.stringify(ar)}`);
  const test1 = execSync(`unzip -t ${adminZip}`).toString();
  const listing = execSync(`zipinfo -1 ${adminZip}`).toString().trim().split('\n');
  proof.note(`$ unzip -t admin.zip\n${test1.trim()}\n$ zipinfo -1 admin.zip\n${listing.join('\n')}`);
  expect(test1).toMatch(/No errors detected/);
  expect(listing.sort()).toEqual(['draft.txt', 'pic.png', 'same (2).txt', 'same.txt']);
  const extracted = execSync(`unzip -p ${adminZip} 'same.txt'`);
  expect(crypto.createHash('sha256').update(extracted).digest('hex')).toBe(crypto.createHash('sha256').update(one.content).digest('hex'));
  proof.h('AC2 affiliate ZIP: only files the affiliate may download (no draft)');
  const affZip = path.join(SCRATCH, 'aff.zip');
  const afr = await get(`http://localhost:5000/api/v1/affiliate/me/asset-bundles/${id}/zip`, (await as('AFFILIATE_1')).token, affZip);
  const affList = execSync(`zipinfo -1 ${affZip}`).toString().trim().split('\n').sort();
  proof.note(`affiliate ZIP -> ${JSON.stringify(afr)}; entries: ${affList.join(', ')}`);
  expect(affList).toEqual(['pic.png', 'same (2).txt', 'same.txt']);
  const outsider = await fetch(`http://localhost:5000/api/v1/affiliate/me/asset-bundles/${id}/zip`, { headers: { authorization: `Bearer ${(await as('AFFILIATE_3')).token}` } });
  proof.note(`AFFILIATE_3 (not in program A1) -> HTTP ${outsider.status}`);
  expect(outsider.status).toBe(404);
  proof.h('AC3 large bundle: 4 × 45 MB, backend memory while streaming');
  const big: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await uploadAsset(org, 'ORG_A_OWNER', { fileName: `big-${i}.txt`, content: { size: 45 * MB, byte: 0x41 + i }, assetType: 'DOCUMENT', name: `${P} big ${i}`, timeoutMs: 300_000 });
    expect(r.status).toBe(201);
    big.push(r.data.id);
  }
  const bigId = await bundle('AC big', { programId: pA1, visibility: 'ALL_PROGRAM_AFFILIATES' }, big);
  const pid = execSync(`pgrep -f "^node dist/src/main.js" | head -1`).toString().trim();
  const rss = () => Number(fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)![1]) / 1024;
  const before = rss();
  const samples: number[] = [];
  const timer = setInterval(() => samples.push(rss()), 100);
  const t0 = Date.now();
  // stream to disk with curl so the test process does not hold 180 MB either
  const bigZip = path.join(SCRATCH, 'big.zip');
  await new Promise<void>((resolve, reject) => {
    const c = spawn('curl', ['-s', '-o', bigZip, '-w', '%{http_code}', '-H', `Authorization: Bearer ${tok}`, `http://localhost:5000/api/v1${orgPath(org, `/asset-bundles/${bigId}/zip`)}`]);
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`curl ${code}`))));
  });
  clearInterval(timer);
  const secs = (Date.now() - t0) / 1000;
  const size = fs.statSync(bigZip).size;
  const peak = Math.max(...samples, before);
  proof.note(`ZIP of 4 × 45 MB: ${size} bytes in ${secs.toFixed(1)} s; backend RSS before=${before.toFixed(0)} MB peak=${peak.toFixed(0)} MB growth=${(peak - before).toFixed(0)} MB`);
  const t2 = execSync(`unzip -t ${bigZip} | tail -1`).toString().trim();
  proof.note(`$ unzip -t big.zip | tail -1\n${t2}`);
  expect(t2).toMatch(/No errors detected/);
  expect(size).toBeGreaterThan(180 * MB);
  expect(peak - before).toBeLessThan(100);
  const usageBefore = await sqlOne<any>(`SELECT usedBytes FROM organization_storage WHERE organizationId=?`, [org]);
  proof.sql(`usedBytes after the ZIPs (ZIPs use no storage)`, usageBefore);
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  // test data: the 180 MB of big files are removed again
  for (const b of big) {
    await api('DELETE', orgPath(org, `/assets/${b}`), { token: tok });
    await api('DELETE', orgPath(org, `/assets/${b}/permanent`), { token: tok });
  }
});

test('AD. download links: short-lived, signed, per organization, checked on every request', async () => {
  test.setTimeout(180_000);
  const proof = new Proof('AD');
  const x = await file('ad-x.txt', { public: true });
  const affTok = (await as('AFFILIATE_1')).token;
  const dl = await api('GET', `/affiliate/me/assets/${x.id}/download`, { token: affTok });
  const u = new URL(dl.data.url);
  proof.note(`affiliate link: host=${u.host} path=${u.pathname} X-Amz-Expires=${u.searchParams.get('X-Amz-Expires')} expiresAt=${dl.data.expiresAt}`);
  expect(u.searchParams.get('X-Amz-Expires')).toBe('300');
  expect(u.pathname).not.toContain('ad-x');
  proof.h('AD1 the link cannot be pointed at another object (signature covers the path)');
  const other = await sqlOne<any>(`SELECT storageKey FROM assets WHERE organizationId=? AND storageKey LIKE 'orgs/%' LIMIT 1`, [f.orgB.id]);
  if (other) {
    const swapped = new URL(dl.data.url);
    swapped.pathname = `/${u.pathname.split('/')[1]}/${other.storageKey}`;
    const r = await fetch(swapped);
    proof.note(`same signature, other org's key -> HTTP ${r.status}`);
    expect(r.status).toBe(403);
  } else proof.note('Org B has no stored file to aim at (skipped sub-check)');
  proof.h('AD2 other organizations / unknown ids → 404, no link');
  for (const role of ['AFFILIATE_B1']) {
    const r = await api('GET', `/affiliate/me/assets/${x.id}/download`, { token: (await as(role)).token });
    proof.http(`GET (as ${role})`, `/affiliate/me/assets/${x.id}/download`, r);
    expect(r.status).toBe(404);
  }
  const rnd = await api('GET', `/affiliate/me/assets/${crypto.randomUUID()}/download`, { token: affTok });
  expect(rnd.status).toBe(404);
  proof.h('AD3 expiry: backend restarted with STORAGE_DOWNLOAD_URL_TTL_SECONDS=2');
  const restart = (env: Record<string, string>) =>
    new Promise<string>((resolve) => {
      const c = spawn(`${__dirname}/../scripts/restart-backend.sh`, [], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.on('close', () => resolve(out.trim()));
    });
  proof.note(await restart({ STORAGE_DOWNLOAD_URL_TTL_SECONDS: '2' }));
  try {
    const short = await api('GET', `/affiliate/me/assets/${x.id}/download`, { token: affTok });
    const first = await fetch(short.data.url);
    await first.arrayBuffer();
    await new Promise((r) => setTimeout(r, 3500));
    const late = await fetch(short.data.url);
    const lateBody = await late.text();
    proof.note(`fresh link -> HTTP ${first.status}; same link after 3.5 s -> HTTP ${late.status} ${lateBody.match(/<Code>([^<]+)/)?.[1] || ''}`);
    expect(first.status).toBe(200);
    expect(late.status).toBe(403);
  } finally {
    proof.note(await restart({}));
  }
  proof.h('AD4 link is refused once the file is trashed (no new link; the old one expires)');
  await api('DELETE', orgPath(org, `/assets/${x.id}`), { token: await owner() });
  const after = await api('GET', `/affiliate/me/assets/${x.id}/download`, { token: (await as('AFFILIATE_1')).token });
  proof.http('GET (trashed file)', `/affiliate/me/assets/${x.id}/download`, after);
  expect(after.status).toBe(404);
  void proofUpload;
});
