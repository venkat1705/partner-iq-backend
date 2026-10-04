import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import { api } from '../lib/api';
import { closeDb, sql, sqlOne } from '../lib/db';
import { loadFixtures } from '../lib/fixtures';
import { Proof } from '../lib/proof';
import { head, listKeys, putRaw } from '../lib/s3';
import { as } from '../lib/session';
import {
  DEFAULT_LIMIT, MB, TEN_MB, dbCountedBytes, dbStorage, listData, openReservations, orgPath, pickUsage, proofUpload, runJob, s3AssetBytes,
  setLimit, threeViews, uploadAsset, uploadVersion, usage, wipeOrg,
} from '../lib/assets';
import { makeText, upload } from '../lib/upload';

/** Quota scenarios on the empty test organization with a 10 MB limit (decision: tests mostly use 10 MB). */
const f = loadFixtures();
const org = f.orgEmpty!.id;
const ROLE = 'ORG_EMPTY_OWNER';
const P = `${f.prefix}-Q`;
test.afterAll(async () => closeDb());

async function fresh(proof: Proof, limit = TEN_MB) {
  await wipeOrg(org, ROLE);
  await setLimit(org, limit, proof);
  const d = await dbStorage(org);
  if (d!.usedBytes !== 0 || d!.reservedBytes !== 0) throw new Error(`org not empty: ${JSON.stringify(d)}`);
}
const txt = (size: number, name: string) => ({ fileName: `${name}.txt`, content: makeText(size, name), assetType: 'DOCUMENT', name: `${P} ${name}` });

test('G. usage shown by the API equals the database counter and the bucket', async () => {
  const proof = new Proof('G');
  await fresh(proof);
  const a = await uploadAsset(org, ROLE, txt(1 * MB, 'g1'));
  const b = await uploadAsset(org, ROLE, txt(2 * MB + 123, 'g2'));
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  const v = await threeViews(proof, org, 'G1 after two uploads', ROLE);
  expect(v.api.usedBytes).toBe(3 * MB + 123);
  expect(v.db!.usedBytes).toBe(v.api.usedBytes);
  expect(v.counted.bytes).toBe(v.api.usedBytes);
  expect(v.s3.bytes).toBe(v.api.usedBytes);
  expect(v.api.limitBytes).toBe(TEN_MB);
  expect(v.api.availableBytes).toBe(TEN_MB - (3 * MB + 123));
  expect(v.api.breakdown).toEqual({ filesBytes: 3 * MB + 123, olderVersionsBytes: 0, trashBytes: 0 });
  proof.h('G2 default limit for an organization that never had one');
  const row = await sqlOne<any>(`SELECT limitBytes FROM organization_storage WHERE organizationId = ?`, [f.orgB.id]);
  const ub = await usage(f.orgB.id, 'ORG_B_OWNER');
  proof.http('GET', orgPath(f.orgB.id, '/storage/usage'), { ...ub, body: pickUsage(ub.data) });
  proof.sql(`SELECT limitBytes FROM organization_storage WHERE organizationId='${f.orgB.id}'`, row);
  expect(ub.data.limitBytes).toBe(DEFAULT_LIMIT);
});

test('H. exact boundary: a file that fills the limit to the byte fits, one more byte does not', async () => {
  const proof = new Proof('H');
  await fresh(proof);
  proof.h('H1 one file of exactly the limit (10,485,760 bytes)');
  const full = await uploadAsset(org, ROLE, { ...txt(TEN_MB, 'h-exact') });
  proofUpload(proof, 'H1', orgPath(org, '/assets/upload'), full, { size: TEN_MB });
  expect(full.status).toBe(201);
  let d = await dbStorage(org);
  proof.sql(`SELECT * FROM organization_storage WHERE organizationId='${org}'`, d);
  expect(d!.usedBytes).toBe(TEN_MB);
  proof.h('H2 one more byte');
  const one = await uploadAsset(org, ROLE, { ...txt(1, 'h-one') });
  proofUpload(proof, 'H2', orgPath(org, '/assets/upload'), one, { size: 1 });
  expect(one.status).toBe(413);
  expect(one.body.code).toBe('STORAGE_LIMIT_REACHED');
  expect(one.body.details).toMatchObject({ neededBytes: 1, availableBytes: 0, limitBytes: TEN_MB, usedBytes: TEN_MB });
  expect(one.sentBytes).toBeLessThan(64 * 1024 * 2); // refused before the body was read
  proof.h('H3 delete it, then limit − 1 byte fits and 2 bytes do not');
  const owner = await as(ROLE);
  await api('DELETE', orgPath(org, `/assets/${full.data.id}`), { token: owner.token });
  await api('DELETE', orgPath(org, `/assets/${full.data.id}/permanent`), { token: owner.token });
  const almost = await uploadAsset(org, ROLE, { ...txt(TEN_MB - 1, 'h-almost') });
  proofUpload(proof, 'H3a', orgPath(org, '/assets/upload'), almost, { size: TEN_MB - 1 });
  expect(almost.status).toBe(201);
  const two = await uploadAsset(org, ROLE, { ...txt(2, 'h-two') });
  proofUpload(proof, 'H3b', orgPath(org, '/assets/upload'), two, { size: 2 });
  expect(two.status).toBe(413);
  const last = await uploadAsset(org, ROLE, { ...txt(1, 'h-last') });
  proofUpload(proof, 'H3c', orgPath(org, '/assets/upload'), last, { size: 1 });
  expect(last.status).toBe(201);
  d = await dbStorage(org);
  proof.sql(`SELECT * FROM organization_storage WHERE organizationId='${org}'`, d);
  expect(d).toMatchObject({ usedBytes: TEN_MB, reservedBytes: 0, activeUploads: 0 });
  proof.h('H4 without X-File-Size the request Content-Length (file + multipart framing) is reserved');
  await fresh(proof);
  const noHeader = await uploadAsset(org, ROLE, { ...txt(TEN_MB, 'h-cl'), declaredSize: null });
  proofUpload(proof, 'H4', orgPath(org, '/assets/upload'), noHeader, { size: TEN_MB, declaredSize: 'not sent' });
  proof.note('A file of exactly the limit sent without X-File-Size is refused: the framing bytes (~300) are reserved too. The app always sends X-File-Size (decision A18).');
  expect(noHeader.status).toBe(413);
  proof.h('H5 neither X-File-Size nor Content-Length (chunked) → 411');
  const chunked = await uploadAsset(org, ROLE, { ...txt(1000, 'h-411'), declaredSize: null, contentLength: 'none' });
  proofUpload(proof, 'H5', orgPath(org, '/assets/upload'), chunked, { declaredSize: 'not sent', contentLength: 'not sent' });
  expect(chunked.status).toBe(411);
  expect(await openReservations(org)).toEqual([]);
  const v = await threeViews(proof, org, 'H end', ROLE);
  expect(v.s3.bytes).toBe(v.db!.usedBytes);
});

test('I. concurrent uploads never exceed the limit', async () => {
  test.setTimeout(240_000);
  const proof = new Proof('I');
  await fresh(proof);
  proof.h('I1 four 3 MB uploads at the same time into 10 MB');
  const results = await Promise.all([1, 2, 3, 4].map((i) => uploadAsset(org, ROLE, { ...txt(3 * MB, `i-${i}`), throttleMs: 2 })));
  results.forEach((r, i) => proofUpload(proof, `I1.${i + 1}`, orgPath(org, '/assets/upload'), r, { size: 3 * MB }));
  const ok = results.filter((r) => r.status === 201).length;
  const refused = results.filter((r) => r.status === 413).length;
  proof.note(`201: ${ok}, 413: ${refused}`);
  expect(ok).toBe(3);
  expect(refused).toBe(1);
  let v = await threeViews(proof, org, 'I1 after', ROLE);
  expect(v.db).toMatchObject({ usedBytes: 9 * MB, reservedBytes: 0, activeUploads: 0 });
  expect(v.s3.bytes).toBe(9 * MB);
  proof.h('I2 twenty 1 MB uploads racing for the last 1 MB (limit 10 MB, 9 MB used) — five at a time');
  const race: number[] = [];
  for (let round = 0; round < 4; round++) {
    const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => uploadAsset(org, ROLE, txt(1 * MB, `i2-${round}-${i}`))));
    race.push(...rs.map((r) => r.status));
  }
  proof.note(`statuses: ${race.join(',')}`);
  expect(race.filter((s) => s === 201).length).toBe(1);
  expect(race.filter((s) => s === 413 || s === 429).length).toBe(19);
  v = await threeViews(proof, org, 'I2 after', ROLE);
  expect(v.db).toMatchObject({ usedBytes: TEN_MB, reservedBytes: 0, activeUploads: 0 });
  expect(v.s3.bytes).toBe(TEN_MB);
});

test('J. a wrong declared size cannot use more space than reserved', async () => {
  const proof = new Proof('J');
  await fresh(proof);
  proof.h('J1 declares 1 MB, sends 3 MB → stopped at the reservation, nothing saved');
  const lie = await uploadAsset(org, ROLE, { ...txt(3 * MB, 'j-lie'), declaredSize: 1 * MB });
  proofUpload(proof, 'J1', orgPath(org, '/assets/upload'), lie, { size: 3 * MB, declaredSize: 1 * MB });
  expect(lie.status).toBe(413);
  let v = await threeViews(proof, org, 'J1 after', ROLE);
  expect(v.db).toMatchObject({ usedBytes: 0, reservedBytes: 0, activeUploads: 0 });
  expect(v.s3.count).toBe(0);
  proof.h('J2 declares 5 MB, sends 1 MB → saved with the real size, the rest of the reservation released');
  const small = await uploadAsset(org, ROLE, { ...txt(1 * MB, 'j-small'), declaredSize: 5 * MB });
  proofUpload(proof, 'J2', orgPath(org, '/assets/upload'), small, { size: 1 * MB, declaredSize: 5 * MB });
  expect(small.status).toBe(201);
  expect(small.data.fileSize).toBe(1 * MB);
  v = await threeViews(proof, org, 'J2 after', ROLE);
  expect(v.db).toMatchObject({ usedBytes: 1 * MB, reservedBytes: 0 });
  const r = await sql<any>(`SELECT bytes, status FROM storage_reservations WHERE organizationId = ? ORDER BY createdAt DESC LIMIT 1`, [org]);
  proof.sql(`SELECT bytes, status FROM storage_reservations ORDER BY createdAt DESC LIMIT 1`, r);
  expect(r[0]).toMatchObject({ status: 'COMMITTED' });
  proof.h('J3 declared larger than the per-file limit (200 MB) → 413 before the body is read');
  const huge = await uploadAsset(org, ROLE, { fileName: 'j-huge.txt', content: { size: 300 * MB }, assetType: 'DOCUMENT', name: `${P} j-huge` });
  proofUpload(proof, 'J3', orgPath(org, '/assets/upload'), huge, { size: 300 * MB });
  expect(huge.sentBytes).toBeLessThan(50 * MB); // answered long before the body was sent
  expect(huge.status).toBe(413);
  expect(huge.body.code).toBe('STORAGE_FILE_TOO_LARGE');
  proof.h('J3b a tiny file with an exaggerated X-File-Size is accepted at its real size (reservation = min(header, Content-Length))');
  const exaggerated = await uploadAsset(org, ROLE, { ...txt(1000, 'j-exaggerated'), declaredSize: 300 * MB });
  proofUpload(proof, 'J3b', orgPath(org, '/assets/upload'), exaggerated, { size: 1000, declaredSize: 300 * MB });
  expect(exaggerated.status).toBe(201);
  expect(exaggerated.data.fileSize).toBe(1000);
  proof.h('J4 nonsense sizes');
  for (const bad of ['-5', 'abc', '1e3', '0x10', '9007199254740993']) {
    const r2 = await uploadAsset(org, ROLE, { ...txt(100, 'j-bad'), declaredSize: null, extraHeaders: { 'x-file-size': bad } });
    proofUpload(proof, `J4 ${bad}`, orgPath(org, '/assets/upload'), r2, { 'x-file-size': bad });
    expect(r2.status).toBe(400);
  }
  expect(await openReservations(org)).toEqual([]);
});

test('K. at most 5 uploads per organization at the same time', async () => {
  test.setTimeout(240_000);
  const proof = new Proof('K');
  await fresh(proof);
  const slow = [1, 2, 3, 4, 5].map((i) => uploadAsset(org, ROLE, { ...txt(1 * MB, `k-${i}`), throttleMs: 250 }));
  await new Promise((r) => setTimeout(r, 1500));
  const mid = await dbStorage(org);
  proof.sql(`SELECT activeUploads, reservedBytes FROM organization_storage WHERE organizationId='${org}' (during)`, mid);
  const sixth = await uploadAsset(org, ROLE, txt(1000, 'k-6'));
  proofUpload(proof, 'K sixth', orgPath(org, '/assets/upload'), sixth, { size: 1000 });
  expect(mid!.activeUploads).toBe(5);
  expect(sixth.status).toBe(429);
  expect(sixth.body.code).toBe('TOO_MANY_CONCURRENT_UPLOADS');
  const done = await Promise.all(slow);
  proof.note(`the five slow uploads: ${done.map((r) => r.status).join(',')}`);
  expect(done.every((r) => r.status === 201)).toBe(true);
  const after = await dbStorage(org);
  proof.sql(`SELECT * FROM organization_storage WHERE organizationId='${org}' (after)`, after);
  expect(after).toMatchObject({ activeUploads: 0, reservedBytes: 0, usedBytes: 5 * MB });
  const seventh = await uploadAsset(org, ROLE, txt(1000, 'k-7'));
  expect(seventh.status).toBe(201);
  proof.note('another organization is not affected by this one\'s uploads (R covers the counters)');
});

test('L. trash still counts; restore; permanent delete frees space at once; 30-day purge', async () => {
  const proof = new Proof('L');
  await fresh(proof);
  const owner = await as(ROLE);
  const a = await uploadAsset(org, ROLE, txt(2 * MB, 'l-a'));
  const b = await uploadAsset(org, ROLE, txt(3 * MB, 'l-b'));
  proof.h('L1 move a to the trash');
  const del = await api('DELETE', orgPath(org, `/assets/${a.data.id}`), { token: owner.token });
  proof.http('DELETE', orgPath(org, `/assets/${a.data.id}`), del);
  let v = await threeViews(proof, org, 'L1', ROLE);
  expect(v.api.usedBytes).toBe(5 * MB);
  expect(v.api.breakdown).toEqual({ filesBytes: 3 * MB, olderVersionsBytes: 0, trashBytes: 2 * MB });
  const trash = await api('GET', orgPath(org, '/assets/trash'), { token: owner.token });
  proof.http('GET', orgPath(org, '/assets/trash'), { ...trash, body: listData(trash).map((x) => ({ id: x.id, trashedAt: x.trashedAt, permanentDeleteAt: x.permanentDeleteAt })) });
  const t = listData(trash)[0];
  expect(Math.round((new Date(t.permanentDeleteAt).getTime() - new Date(t.trashedAt).getTime()) / 86_400_000)).toBe(30);
  const list = await api('GET', orgPath(org, '/assets'), { token: owner.token });
  expect(listData(list).map((x) => x.id)).not.toContain(a.data.id);
  proof.h('L2 restore');
  const res = await api('POST', orgPath(org, `/assets/${a.data.id}/restore`), { token: owner.token, body: {} });
  proof.http('POST', orgPath(org, `/assets/${a.data.id}/restore`), { ...res, body: { status: res.status, trashedAt: res.data?.trashedAt } });
  v = await threeViews(proof, org, 'L2', ROLE);
  expect(v.api.breakdown.trashBytes).toBe(0);
  proof.h('L3 trash + permanent delete → space freed immediately, object gone from S3');
  const keyA = (await sqlOne<any>(`SELECT storageKey FROM assets WHERE id=?`, [a.data.id])).storageKey;
  await api('DELETE', orgPath(org, `/assets/${a.data.id}`), { token: owner.token });
  const perm = await api('DELETE', orgPath(org, `/assets/${a.data.id}/permanent`), { token: owner.token });
  proof.http('DELETE', orgPath(org, `/assets/${a.data.id}/permanent`), perm);
  expect(perm.data.freedBytes).toBe(2 * MB);
  v = await threeViews(proof, org, 'L3', ROLE);
  expect(v.api.usedBytes).toBe(3 * MB);
  expect(await head(keyA)).toBeNull();
  proof.h('L4 trashed 31 days ago → purge job deletes it');
  await api('DELETE', orgPath(org, `/assets/${b.data.id}`), { token: owner.token });
  await sql(`UPDATE assets SET deletedAt = NOW(6) - INTERVAL 31 DAY WHERE id = ?`, [b.data.id]);
  proof.note(`mysql> UPDATE assets SET deletedAt = NOW() - INTERVAL 31 DAY WHERE id='${b.data.id}' (test data)`);
  const job = await runJob('purge-trash', proof);
  expect(job.status).toBeLessThan(300);
  v = await threeViews(proof, org, 'L4', ROLE);
  expect(v.api.usedBytes).toBe(0);
  expect(v.s3.count).toBe(0);
  const gone = await sqlOne<any>(`SELECT id, deletedAt FROM assets WHERE id = ?`, [b.data.id]);
  proof.sql(`SELECT id, deletedAt FROM assets WHERE id='${b.data.id}'`, gone ?? '(row removed)');
  expect(gone).toBeUndefined();
  proof.h('L5 a trashed file younger than 30 days is kept by the job');
  const c = await uploadAsset(org, ROLE, txt(1 * MB, 'l-c'));
  await api('DELETE', orgPath(org, `/assets/${c.data.id}`), { token: owner.token });
  await sql(`UPDATE assets SET deletedAt = NOW(6) - INTERVAL 29 DAY WHERE id = ?`, [c.data.id]);
  await runJob('purge-trash', proof);
  v = await threeViews(proof, org, 'L5', ROLE);
  expect(v.api.breakdown.trashBytes).toBe(1 * MB);
});

test('M. versions: older versions count, deleting one frees space, the current one cannot be deleted', async () => {
  const proof = new Proof('M');
  await fresh(proof);
  const owner = await as(ROLE);
  const a = await uploadAsset(org, ROLE, txt(1 * MB, 'm-v1'));
  const v2 = await uploadVersion(org, ROLE, a.data.id, { fileName: 'm-v2.txt', content: makeText(2 * MB, 'v2'), fields: { changeNotes: 'second' } });
  proofUpload(proof, 'M1 version 2', orgPath(org, `/assets/${a.data.id}/versions/upload`), v2, { size: 2 * MB });
  expect(v2.status).toBe(201);
  let v = await threeViews(proof, org, 'M1 after v2', ROLE);
  expect(v.api.usedBytes).toBe(3 * MB);
  expect(v.api.breakdown).toEqual({ filesBytes: 2 * MB, olderVersionsBytes: 1 * MB, trashBytes: 0 });
  expect(v.s3.count).toBe(2);
  const versions = await api('GET', orgPath(org, `/assets/${a.data.id}/versions`), { token: owner.token });
  proof.http('GET', orgPath(org, `/assets/${a.data.id}/versions`), versions);
  const old = versions.data.find((x: any) => x.versionNumber === 1);
  const cur = versions.data.find((x: any) => x.versionNumber === 2);
  expect(cur.isCurrent).toBe(true);
  proof.h('M2 a version with a different file type is refused');
  const wrongType = await uploadVersion(org, ROLE, a.data.id, { fileName: 'm.png', content: await (await import('../lib/upload')).makePng(20, 20) });
  proofUpload(proof, 'M2', orgPath(org, `/assets/${a.data.id}/versions/upload`), wrongType, { fileName: 'm.png' });
  proof.note(`status ${wrongType.status} (a .txt asset getting a .png version)`);
  expect(wrongType.status).toBe(415);
  proof.h('M3 restore v1: a new current version v3 pointing at v1\'s object (no copy, no extra space)');
  const restore = await api('POST', orgPath(org, `/assets/${a.data.id}/restore/${old.id}`), { token: owner.token, body: {} });
  proof.http('POST', orgPath(org, `/assets/${a.data.id}/restore/${old.id}`), { ...restore, body: { status: restore.status, version: restore.data?.version, fileSize: restore.data?.fileSize } });
  expect(restore.data.version).toBe(3);
  v = await threeViews(proof, org, 'M3', ROLE);
  expect(v.api.usedBytes).toBe(3 * MB);
  expect(v.api.breakdown).toEqual({ filesBytes: 1 * MB, olderVersionsBytes: 2 * MB, trashBytes: 0 });
  expect(v.s3.count).toBe(2);
  const versions3 = await api('GET', orgPath(org, `/assets/${a.data.id}/versions`), { token: owner.token });
  proof.http('GET', orgPath(org, `/assets/${a.data.id}/versions`), { ...versions3, body: versions3.data.map((x: any) => ({ v: x.versionNumber, isCurrent: x.isCurrent, fileSize: x.fileSize, notes: x.changeNotes })) });
  const v3 = versions3.data.find((x: any) => x.versionNumber === 3);
  expect(v3.isCurrent).toBe(true);
  proof.h('M4 deleting the current version is refused');
  const delCur = await api('DELETE', orgPath(org, `/assets/${a.data.id}/versions/${v3.id}`), { token: owner.token });
  proof.http('DELETE', orgPath(org, `/assets/${a.data.id}/versions/${v3.id}`), delCur);
  expect(delCur.status).toBe(400);
  proof.h('M5 deleting v1 frees nothing (its object is the current file); deleting v2 frees 2 MB and its object');
  const keyV1 = (await sqlOne<any>(`SELECT storageKey FROM asset_versions WHERE id=?`, [old.id])).storageKey;
  const delV1 = await api('DELETE', orgPath(org, `/assets/${a.data.id}/versions/${old.id}`), { token: owner.token });
  proof.http('DELETE', orgPath(org, `/assets/${a.data.id}/versions/${old.id}`), delV1);
  expect(delV1.data.freedBytes).toBe(0);
  expect(await head(keyV1)).not.toBeNull();
  const keyV2 = (await sqlOne<any>(`SELECT storageKey FROM asset_versions WHERE id=?`, [cur.id])).storageKey;
  const delOld = await api('DELETE', orgPath(org, `/assets/${a.data.id}/versions/${cur.id}`), { token: owner.token });
  proof.http('DELETE', orgPath(org, `/assets/${a.data.id}/versions/${cur.id}`), delOld);
  expect(delOld.data.freedBytes).toBe(2 * MB);
  v = await threeViews(proof, org, 'M5', ROLE);
  expect(v.api.usedBytes).toBe(1 * MB);
  expect(v.api.breakdown).toEqual({ filesBytes: 1 * MB, olderVersionsBytes: 0, trashBytes: 0 });
  expect(await head(keyV2)).toBeNull();
  proof.h('M6 a new version that does not fit is refused, the old file stays');
  await setLimit(org, 2 * MB);
  const tooBig = await uploadVersion(org, ROLE, a.data.id, { fileName: 'm-v3.txt', content: makeText(1 * MB + 1, 'v3') });
  proofUpload(proof, 'M6', orgPath(org, `/assets/${a.data.id}/versions/upload`), tooBig, { size: 1 * MB + 1 });
  expect(tooBig.status).toBe(413);
  v = await threeViews(proof, org, 'M6', ROLE);
  expect(v.api.usedBytes).toBe(1 * MB);
});

test('N. bundles and ZIPs use no storage; a file in two bundles counts once', async () => {
  const proof = new Proof('N');
  await fresh(proof);
  const owner = await as(ROLE);
  const a = await uploadAsset(org, ROLE, txt(2 * MB, 'n-a'));
  const before = await threeViews(proof, org, 'N0', ROLE);
  for (const name of ['N one', 'N two']) {
    const b = await api('POST', orgPath(org, '/asset-bundles'), { token: owner.token, body: { name: `${P} ${name}`, visibility: 'PRIVATE' } });
    proof.http('POST', orgPath(org, '/asset-bundles'), b, { name, visibility: 'PRIVATE' });
    const add = await api('POST', orgPath(org, `/asset-bundles/${b.data.id}/assets`), { token: owner.token, body: { assetId: a.data.id } });
    proof.http('POST', orgPath(org, `/asset-bundles/${b.data.id}/assets`), { ...add, body: { status: add.status, assetCount: add.data?.assetCount } });
    expect(add.status).toBeLessThan(300);
    const zip = await fetch(`http://localhost:5000/api/v1${orgPath(org, `/asset-bundles/${b.data.id}/zip`)}`, { headers: { authorization: `Bearer ${owner.token}` } });
    const bytes = Buffer.from(await zip.arrayBuffer());
    proof.note(`GET …/asset-bundles/${b.data.id}/zip -> HTTP ${zip.status}, ${bytes.length} bytes`);
    expect(zip.status).toBe(200);
  }
  const after = await threeViews(proof, org, 'N1 after two bundles and two ZIPs', ROLE);
  expect(after.api.usedBytes).toBe(before.api.usedBytes);
  expect(after.s3.count).toBe(before.s3.count);
  expect((await listKeys(`orgs/${org}/`)).filter((k) => /\.zip$|zip/.test(k.key))).toEqual([]);
});

test('O. over-limit organization: uploads blocked, nothing deleted, downloads work', async () => {
  const proof = new Proof('O');
  await fresh(proof);
  const owner = await as(ROLE);
  const a = await uploadAsset(org, ROLE, txt(5 * MB, 'o-a'));
  await setLimit(org, 2 * MB, proof, 'downgrade test');
  let v = await threeViews(proof, org, 'O1 limit lowered below usage', ROLE);
  expect(v.api.overLimit).toBe(true);
  expect(v.api.availableBytes).toBe(0);
  const up = await uploadAsset(org, ROLE, txt(10, 'o-b'));
  proofUpload(proof, 'O2 upload while over the limit', orgPath(org, '/assets/upload'), up, { size: 10 });
  expect(up.status).toBe(413);
  const dl = await api('GET', orgPath(org, `/assets/${a.data.id}/download`), { token: owner.token });
  proof.http('GET', orgPath(org, `/assets/${a.data.id}/download`), { ...dl, body: { status: dl.status } });
  expect(dl.status).toBe(200);
  const edit = await api('PATCH', orgPath(org, `/assets/${a.data.id}`), { token: owner.token, body: { description: 'still editable' } });
  proof.http('PATCH', orgPath(org, `/assets/${a.data.id}`), { ...edit, body: { status: edit.status } });
  expect(edit.status).toBe(200);
  await runJob('purge-trash', proof);
  await runJob('reconcile', proof);
  v = await threeViews(proof, org, 'O3 after the jobs ran: nothing deleted automatically', ROLE);
  expect(v.s3.bytes).toBe(5 * MB);
  expect(v.api.usedBytes).toBe(5 * MB);
  proof.h('O4 the owner frees space → uploads work again');
  await api('DELETE', orgPath(org, `/assets/${a.data.id}`), { token: owner.token });
  await api('DELETE', orgPath(org, `/assets/${a.data.id}/permanent`), { token: owner.token });
  const again = await uploadAsset(org, ROLE, txt(1 * MB, 'o-c'));
  proofUpload(proof, 'O4', orgPath(org, '/assets/upload'), again, { size: 1 * MB });
  expect(again.status).toBe(201);
});

test('P. only platform admins change the limit; the change is audited and validated', async () => {
  const proof = new Proof('P');
  await fresh(proof);
  for (const role of ['ORG_EMPTY_OWNER', 'ORG_A_OWNER', 'ORG_A_ADMIN', 'AFFILIATE_1']) {
    const s = await as(role);
    const r = await api('PATCH', `/admin/storage/organizations/${org}/limit`, { token: s.token, body: { limitBytes: 50 * 1024 * MB } });
    proof.http(`PATCH (as ${role})`, `/admin/storage/organizations/${org}/limit`, r, { limitBytes: 50 * 1024 * MB });
    expect([401, 403]).toContain(r.status);
  }
  const owner = await as(ROLE);
  for (const [method, p, body] of [
    ['PATCH', orgPath(org, '/storage/usage'), { limitBytes: 1 }],
    ['PATCH', orgPath(org, '/storage'), { limitBytes: 1 }],
    ['POST', orgPath(org, '/storage/limit'), { limitBytes: 1 }],
  ] as const) {
    const r = await api(method, p, { token: owner.token, body });
    proof.http(`${method} (as owner)`, p, r, body);
    expect(r.status).toBeGreaterThanOrEqual(400);
  }
  const admin = await as('PLATFORM_ADMIN');
  for (const bad of [-1, 'lots', 1.5, null]) {
    const r = await api('PATCH', `/admin/storage/organizations/${org}/limit`, { token: admin.token, body: { limitBytes: bad } });
    proof.http('PATCH (platform admin, invalid)', `/admin/storage/organizations/${org}/limit`, r, { limitBytes: bad });
    expect(r.status).toBe(400);
  }
  const extra = await api('PATCH', `/admin/storage/organizations/${org}/limit`, { token: admin.token, body: { limitBytes: TEN_MB, usedBytes: 0 } });
  proof.http('PATCH (platform admin, extra field)', `/admin/storage/organizations/${org}/limit`, extra, { limitBytes: TEN_MB, usedBytes: 0 });
  expect(extra.status).toBe(400);
  const ok = await setLimit(org, 20 * MB, proof, 'customer bought more');
  expect(ok.data.limitBytes).toBe(20 * MB);
  const audit = await sql<any>(`SELECT action, actorId, beforeState, afterState FROM audit_logs WHERE resourceId = ? AND action = 'STORAGE_LIMIT_CHANGED' ORDER BY createdAt DESC LIMIT 1`, [org]);
  proof.sql(`SELECT action, actorId, beforeState, afterState FROM audit_logs WHERE resourceId='${org}' AND action='STORAGE_LIMIT_CHANGED' ORDER BY createdAt DESC LIMIT 1`, audit);
  expect(audit[0].actorId).toBe(f.users.PLATFORM_ADMIN.userId);
  expect(JSON.stringify(audit[0].afterState)).toContain(String(20 * MB));
  const u = await usage(org, ROLE);
  expect(u.data.limitBytes).toBe(20 * MB);
});

test('Q. reconciliation fixes the counter and reports orphans and missing objects', async () => {
  const proof = new Proof('Q');
  await fresh(proof);
  const a = await uploadAsset(org, ROLE, txt(1 * MB, 'q-a'));
  const b = await uploadAsset(org, ROLE, txt(2 * MB, 'q-b'));
  proof.h('Q1 break things on purpose (test org only)');
  await sql(`UPDATE organization_storage SET usedBytes = 7777777 WHERE organizationId = ?`, [org]);
  proof.note(`mysql> UPDATE organization_storage SET usedBytes = 7777777 WHERE organizationId='${org}'`);
  const orphanKey = `orgs/${org}/assets/${crypto.randomUUID()}/v1/orphan${Date.now()}`;
  await putRaw(orphanKey, Buffer.alloc(4096, 1));
  proof.note(`S3 put (no database record): ${orphanKey} (4096 bytes)`);
  const keyB = (await sqlOne<any>(`SELECT storageKey FROM assets WHERE id=?`, [b.data.id])).storageKey;
  const { execSync } = await import('node:child_process');
  execSync(`MC_CONFIG_DIR=/opt/minio/etc/mc /opt/minio/gopath/bin/mc rm local/partneriq-assets-test/${keyB}`);
  proof.note(`mc rm ${keyB} (record without object)`);
  try {
  const job = await runJob('reconcile', proof);
  const rep = job.data;
  const mine = rep.organizations.find((o: any) => o.organizationId === org);
  proof.note(`organization entry: ${JSON.stringify(mine)}`);
  proof.note(`objectsWithoutRecord (this org): ${JSON.stringify(rep.objectsWithoutRecord.filter((o: any) => o.organizationId === org))}`);
  proof.note(`recordsWithoutObject (this org): ${JSON.stringify(rep.recordsWithoutObject.filter((o: any) => o.organizationId === org))}`);
  expect(mine).toMatchObject({ counterBytes: 7777777, actualBytes: 3 * MB, inStorageBytes: 1 * MB, corrected: true });
  expect(rep.objectsWithoutRecord.map((o: any) => o.key)).toContain(orphanKey);
  expect(rep.recordsWithoutObject.map((o: any) => o.key)).toContain(keyB);
  const d = await dbStorage(org);
  proof.sql(`SELECT * FROM organization_storage WHERE organizationId='${org}'`, d);
  expect(d!.usedBytes).toBe(3 * MB);
  const audit = await sql<any>(`SELECT action, beforeState, afterState FROM audit_logs WHERE resourceId = ? AND action = 'STORAGE_USAGE_RECONCILED' ORDER BY createdAt DESC LIMIT 1`, [org]);
  proof.sql(`SELECT action, beforeState, afterState FROM audit_logs WHERE resourceId='${org}' AND action='STORAGE_USAGE_RECONCILED' …`, audit);
  expect(audit.length).toBe(1);
  proof.note('orphan object is reported, not deleted automatically (never delete data on a guess):');
  expect(await head(orphanKey)).not.toBeNull();
  } finally {
    // clean up the test-made orphan (the asset whose object was removed is wiped with the org)
    execSync(`MC_CONFIG_DIR=/opt/minio/etc/mc /opt/minio/gopath/bin/mc rm local/partneriq-assets-test/${orphanKey} || true`);
  }
  void a;
});

test('R. usage is per organization', async () => {
  const proof = new Proof('R');
  await fresh(proof);
  const aBefore = await usage(f.orgA.id, 'ORG_A_OWNER');
  const bBefore = await usage(f.orgB.id, 'ORG_B_OWNER');
  const up = await uploadAsset(org, ROLE, txt(1 * MB, 'r-a'));
  expect(up.status).toBe(201);
  const aAfter = await usage(f.orgA.id, 'ORG_A_OWNER');
  const bAfter = await usage(f.orgB.id, 'ORG_B_OWNER');
  proof.note(`orgA used ${aBefore.data.usedBytes} -> ${aAfter.data.usedBytes}; orgB used ${bBefore.data.usedBytes} -> ${bAfter.data.usedBytes}`);
  expect(aAfter.data.usedBytes).toBe(aBefore.data.usedBytes);
  expect(bAfter.data.usedBytes).toBe(bBefore.data.usedBytes);
  const cross = await api('GET', orgPath(org, '/storage/usage'), { token: (await as('ORG_B_OWNER')).token });
  proof.http('GET (as Org B owner)', orgPath(org, '/storage/usage'), cross);
  expect([403, 404]).toContain(cross.status);
  const crossUp = await upload(orgPath(org, '/assets/upload'), { token: (await as('ORG_B_OWNER')).token, fileName: 'x.txt', content: makeText(100, 'x'), fields: { name: 'x', assetType: 'DOCUMENT' } });
  proofUpload(proof, 'R upload into another org', orgPath(org, '/assets/upload'), crossUp, { as: 'ORG_B_OWNER' });
  expect([403, 404]).toContain(crossUp.status);
  const d = await dbStorage(org);
  expect(d!.usedBytes).toBe(1 * MB);
  const counted = await dbCountedBytes(org);
  const s3 = await s3AssetBytes(org);
  expect(counted.bytes).toBe(s3.bytes);
});
