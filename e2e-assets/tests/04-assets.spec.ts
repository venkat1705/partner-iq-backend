import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { api } from '../lib/api';
import { closeDb, eventually, sql, sqlOne } from '../lib/db';
import { loadFixtures } from '../lib/fixtures';
import { Proof } from '../lib/proof';
import { head, listKeys, sha256Of } from '../lib/s3';
import { as } from '../lib/session';
import { MB, TEN_MB, listData, orgPath, proofUpload, setLimit, threeViews, uploadAsset, uploadVersion, wipeOrg } from '../lib/assets';
import { makePng, makeText } from '../lib/upload';

const f = loadFixtures();
const org = f.orgEmpty!.id;
const ROLE = 'ORG_EMPTY_OWNER';
const P = `${f.prefix}-S`;
test.afterAll(async () => closeDb());

/** Minimal but real files for every allowed type (magic bytes as the formats define them). */
async function samples(): Promise<Record<string, Buffer>> {
  const sharp = (await import('sharp')).default;
  const base = sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 30, b: 90 } } });
  const ftyp = (brand: string) => {
    const box = Buffer.alloc(24);
    box.writeUInt32BE(24, 0);
    box.write('ftyp', 4, 'latin1');
    box.write(brand, 8, 'latin1');
    box.writeUInt32BE(0x200, 12);
    box.write(brand, 16, 'latin1');
    box.write('isom', 20, 'latin1');
    return Buffer.concat([box, crypto.randomBytes(2000)]);
  };
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), crypto.randomBytes(3000)]);
  return {
    'photo.jpg': await base.clone().jpeg().toBuffer(),
    'photo.jpeg': await base.clone().jpeg({ quality: 50 }).toBuffer(),
    'banner.png': await base.clone().png().toBuffer(),
    'anim.gif': await base.clone().gif().toBuffer(),
    'modern.webp': await base.clone().webp().toBuffer(),
    'clip.mp4': ftyp('mp42'),
    'clip.mov': ftyp('qt  '),
    'clip.webm': Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), crypto.randomBytes(2000)]),
    'guide.pdf': Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(3000), Buffer.from('\n%%EOF')]),
    'legacy.doc': ole,
    'legacy.ppt': ole,
    'modern.docx': ooxml('word/document.xml'),
    'modern.pptx': ooxml('ppt/presentation.xml'),
    'notes.txt': Buffer.from('Hello partners — ünïcödé ✓\n'.repeat(50)),
    'leads.csv': Buffer.from('name,email\nAda,ada@example.com\n'),
  };
}

/** A tiny ZIP with the given entries (stored, no compression) — enough for the OOXML signature. */
function zip(entries: Record<string, Buffer>) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const n = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
/** A valid 1-bit grayscale PNG of w × h pixels, all zero: a few hundred KB that decode to w*h pixels. */
function pngBomb(w: number, h: number) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc(h * (1 + Math.ceil(w / 8))); // filter byte 0 + packed zero pixels per row
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ooxml(main: string) {
  return zip({ '[Content_Types].xml': Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'), [main]: Buffer.from('<x/>') });
}

test('S. the asset list loads with one request and stays fast with many rows (API side)', async () => {
  const proof = new Proof('S');
  const owner = await as('ORG_A_OWNER');
  const r = await api('GET', orgPath(f.orgA.id, '/assets?limit=48&page=1&sortBy=updatedAt&sortDir=desc'), { token: owner.token });
  proof.http('GET', orgPath(f.orgA.id, '/assets?limit=48&page=1'), { ...r, body: { count: listData(r).length, meta: r.body.meta } });
  expect(r.status).toBe(200);
  expect(r.ms).toBeLessThan(1500);
  const one = listData(r)[0];
  proof.note(`fields of one row: ${Object.keys(one).sort().join(', ')}`);
  for (const secret of ['storageKey', 'storageUrl', 'previewUrl']) expect(Object.keys(one)).not.toContain(secret);
  const limit = await api('GET', orgPath(f.orgA.id, '/assets?limit=1000'), { token: owner.token });
  proof.http('GET', orgPath(f.orgA.id, '/assets?limit=1000'), limit);
  expect(limit.status).toBe(400);
  proof.note('UI page load (requests, duplicates, timings) is measured in 07-ui.spec.ts; 20k rows in AM.');
});

test('T. every allowed file type uploads, is detected correctly and downloads byte-identical', async () => {
  test.setTimeout(180_000);
  const proof = new Proof('T');
  await wipeOrg(org, ROLE);
  await setLimit(org, TEN_MB);
  const files = await samples();
  const owner = await as(ROLE);
  for (const [name, buf] of Object.entries(files)) {
    const r = await uploadAsset(org, ROLE, { fileName: name, content: buf, assetType: 'OTHER', name: `${P} ${name}` });
    proofUpload(proof, `T ${name}`, orgPath(org, '/assets/upload'), { ...r, body: r.status === 201 ? { id: r.data.id, mimeType: r.data.mimeType, fileSize: r.data.fileSize, fileName: r.data.fileName } : r.body }, { fileName: name, size: buf.length });
    expect(r.status, name).toBe(201);
    expect(r.data.fileSize).toBe(buf.length);
    const row = await sqlOne<any>(`SELECT storageKey, checksum FROM assets WHERE id = ?`, [r.data.id]);
    expect(row.checksum).toBe(crypto.createHash('sha256').update(buf).digest('hex'));
    expect(await sha256Of(row.storageKey)).toBe(row.checksum);
    expect(row.storageKey).not.toContain(name.split('.')[0]); // the user's file name is never in the key
    const dl = await api('GET', orgPath(org, `/assets/${r.data.id}/download`), { token: owner.token });
    const got = await fetch(dl.data.url);
    const bytes = Buffer.from(await got.arrayBuffer());
    proof.note(`  download: HTTP ${got.status} content-type=${got.headers.get('content-type')} disposition=${got.headers.get('content-disposition')} sameBytes=${bytes.equals(buf)}`);
    expect(bytes.equals(buf)).toBe(true);
    expect(got.headers.get('content-disposition')).toContain(name);
  }
  proof.h('T2 thumbnails for the raster images (not counted toward storage)');
  await eventually(async () => (await sql<any>(`SELECT COUNT(*) n FROM stored_objects WHERE organizationId=? AND kind='THUMBNAIL'`, [org]))[0].n >= 5, 20_000);
  const thumbs = await sql<any>(`SELECT kind, countsTowardQuota, COUNT(*) n, SUM(sizeBytes) b FROM stored_objects WHERE organizationId=? GROUP BY kind, countsTowardQuota`, [org]);
  proof.sql(`SELECT kind, countsTowardQuota, COUNT(*), SUM(sizeBytes) FROM stored_objects WHERE organizationId='${org}' GROUP BY kind, countsTowardQuota`, thumbs);
  const v = await threeViews(proof, org, 'T3 storage after all types', ROLE);
  const total = Object.values(files).reduce((s, b) => s + b.length, 0);
  expect(v.api.usedBytes).toBe(total);
  expect(v.s3.bytes).toBe(total);
  expect(thumbs.find((t: any) => t.kind === 'THUMBNAIL').countsTowardQuota).toBe(0);
});

test('U. file type safety: content must match the extension; executables, markup and archives are refused', async () => {
  const proof = new Proof('U');
  await wipeOrg(org, ROLE);
  await setLimit(org, TEN_MB);
  const png = await makePng(10, 10);
  const cases: Array<[string, Buffer, number]> = [
    ['virus.exe', Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(500)]), 415],
    ['invoice.pdf', Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(500)]), 415],
    ['banner.png', Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), crypto.randomBytes(500)]), 415],
    ['run.txt', Buffer.from('#!/bin/sh\nrm -rf /\n'), 415],
    ['page.html', Buffer.from('<html><script>alert(1)</script></html>'), 415],
    ['logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 415],
    ['notes.txt', Buffer.from('<svg onload=alert(1)>'), 415],
    ['photo.jpg', png, 415],
    ['archive.zip', zip({ 'a.txt': Buffer.from('x') }), 415],
    ['report.docx', zip({ 'payload.exe': Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(100)]) }), 415],
    ['noextension', png, 415],
    ['double.png.exe', png, 415],
    ['binary.csv', Buffer.from([0x00, 0x01, 0x02, 0x03]), 415],
    ['empty.txt', Buffer.alloc(0), 400],
  ];
  for (const [name, buf, expected] of cases) {
    const r = await uploadAsset(org, ROLE, { fileName: name, content: buf, assetType: 'OTHER', name: `${P} ${name}` });
    proofUpload(proof, `U ${name}`, orgPath(org, '/assets/upload'), r, { fileName: name, size: buf.length, expected });
    expect(r.status, name).toBe(expected);
  }
  const v = await threeViews(proof, org, 'U after all refusals', ROLE);
  expect(v.api.usedBytes).toBe(0);
  expect(v.s3.count).toBe(0);
  expect(v.db!.reservedBytes).toBe(0);
  proof.h('U2 inline vs attachment: only raster images may be shown inline; text/PDF always download');
  const owner = await as(ROLE);
  const txt = await uploadAsset(org, ROLE, { fileName: 'x.txt', content: Buffer.from('<b>bold?</b> just text'), assetType: 'DOCUMENT' });
  const inl = await api('GET', orgPath(org, `/assets/${txt.data.id}/download?disposition=inline`), { token: owner.token });
  proof.http('GET', orgPath(org, `/assets/${txt.data.id}/download?disposition=inline`), inl);
  expect(inl.data.disposition).toBe('attachment');
  const served = await fetch(inl.data.url);
  proof.note(`served headers: content-type=${served.headers.get('content-type')} content-disposition=${served.headers.get('content-disposition')}`);
  expect(served.headers.get('content-disposition')).toMatch(/^attachment/);
  const img = await uploadAsset(org, ROLE, { fileName: 'y.png', content: png, assetType: 'IMAGE' });
  const inl2 = await api('GET', orgPath(org, `/assets/${img.data.id}/download?disposition=inline`), { token: owner.token });
  expect(inl2.data.disposition).toBe('inline');
  proof.h('U3 a file name with path and control characters is cleaned, never used in the key');
  const evil = await uploadAsset(org, ROLE, { fileName: '../../etc/pass"wd\r\n.txt', content: Buffer.from('x'), assetType: 'DOCUMENT' });
  proofUpload(proof, 'U3', orgPath(org, '/assets/upload'), evil, { fileName: '../../etc/pass"wd\\r\\n.txt' });
  if (evil.status === 201) {
    const row = await sqlOne<any>(`SELECT fileName, storageKey FROM assets WHERE id=?`, [evil.data.id]);
    proof.sql(`SELECT fileName, storageKey FROM assets WHERE id='${evil.data.id}'`, row);
    expect(row.fileName).not.toMatch(/[\/\\\r\n"]/);
    expect(row.storageKey).toMatch(/^orgs\/[0-9a-f-]+\/assets\/[0-9a-f-]+\/v1\/[0-9a-f]+$/);
  } else expect(evil.status).toBe(400);
});

test('V. dangerous files: decompression bomb, huge dimensions, EXIF GPS', async () => {
  test.setTimeout(180_000);
  const proof = new Proof('V');
  await wipeOrg(org, ROLE);
  await setLimit(org, TEN_MB);
  const sharp = (await import('sharp')).default;
  proof.h('V1 PNG of 30000 × 30000 pixels (900 M pixels) that compresses to a few hundred KB');
  const bomb = pngBomb(30000, 30000);
  proof.note(`bomb size on disk: ${bomb.length} bytes`);
  const pid = execSync(`pgrep -f "^node dist/src/main.js" | head -1`).toString().trim();
  const rss = () => Number(fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)![1]) / 1024;
  const before = rss();
  const r = await uploadAsset(org, ROLE, { fileName: 'bomb.png', content: bomb, assetType: 'IMAGE', name: `${P} bomb` });
  proofUpload(proof, 'V1', orgPath(org, '/assets/upload'), { ...r, body: r.status === 201 ? { id: r.data.id, fileSize: r.data.fileSize } : r.body }, { size: bomb.length });
  const meta = await eventually(async () => {
    const row = await sqlOne<any>(`SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.thumbnailStatus')) s, JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.thumbnailError')) e FROM assets WHERE id=?`, [r.data?.id]);
    return row?.s && row.s !== 'PENDING' ? row : null;
  }, 30_000);
  const after = rss();
  proof.sql(`SELECT metadata->thumbnailStatus, thumbnailError FROM assets WHERE id='${r.data?.id}'`, meta);
  proof.note(`backend RSS before=${before.toFixed(0)} MB after=${after.toFixed(0)} MB`);
  expect(r.status).toBe(201); // a valid PNG may be stored; it is never decoded beyond the pixel limit
  expect(meta?.s).not.toBe('READY');
  expect(after - before).toBeLessThan(200);
  const health = await api('GET', orgPath(org, '/storage/usage'), { token: (await as(ROLE)).token });
  expect(health.status).toBe(200);
  proof.h('V2 JPEG with GPS EXIF: the original is stored byte-exact (decision A16), the thumbnail has no EXIF');
  const withGps = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .jpeg()
    .withExif({ IFD0: { Make: 'E2E Cam', Model: 'GPS test' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' } } as any)
    .toBuffer();
  const origMeta = await sharp(withGps).metadata();
  proof.note(`uploaded JPEG: ${withGps.length} bytes, exif=${origMeta.exif ? origMeta.exif.length + ' bytes' : 'none'} (contains GPS: ${origMeta.exif?.includes(Buffer.from('GPS')) || /GPS/.test(origMeta.exif?.toString('latin1') || '')})`);
  const g = await uploadAsset(org, ROLE, { fileName: 'gps.jpg', content: withGps, assetType: 'IMAGE', name: `${P} gps` });
  expect(g.status).toBe(201);
  const row = await sqlOne<any>(`SELECT storageKey, checksum FROM assets WHERE id=?`, [g.data.id]);
  expect(await sha256Of(row.storageKey)).toBe(crypto.createHash('sha256').update(withGps).digest('hex'));
  const thumb = await eventually(async () => (await sql<any>(`SELECT storageKey FROM stored_objects WHERE assetId=? AND kind='THUMBNAIL'`, [g.data.id]))[0], 20_000);
  proof.sql(`SELECT storageKey FROM stored_objects WHERE assetId='${g.data.id}' AND kind='THUMBNAIL'`, thumb);
  const tu = await api('GET', orgPath(org, `/assets/${g.data.id}/thumbnail`), { token: (await as(ROLE)).token });
  const tb = Buffer.from(await (await fetch(tu.data.url)).arrayBuffer());
  const tm = await sharp(tb).metadata();
  proof.note(`thumbnail: ${tb.length} bytes ${tm.width}x${tm.height} exif=${tm.exif ? 'present' : 'none'}`);
  expect(tm.exif).toBeUndefined();
  expect(Math.max(tm.width!, tm.height!)).toBeLessThanOrEqual(800);
});

test('W. search, filters, sort and pagination run on the server', async () => {
  const proof = new Proof('W');
  await wipeOrg(org, ROLE);
  await setLimit(org, TEN_MB);
  const owner = await as(ROLE);
  const mk = async (name: string, type: string, folder: string, status: string, size: number, tags: string[]) => {
    const r = await uploadAsset(org, ROLE, { fileName: `${name.replace(/\W+/g, '-')}.txt`, content: makeText(size, name), assetType: type, name: `${P} ${name}`, status, fields: { folderPath: folder, tags: JSON.stringify(tags) } });
    if (r.status !== 201) throw new Error(`${name}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.data;
  };
  await mk('Summer banner', 'BANNER', 'Campaigns Summer', 'PUBLISHED', 3000, ['summer', 'sale']);
  await mk('Winter banner', 'BANNER', 'Campaigns Winter', 'DRAFT', 1000, ['winter']);
  await mk('Brand guide 100%', 'BRAND_GUIDELINE', 'Brand', 'PUBLISHED', 5000, ['brand']);
  await mk('under_score file', 'DOCUMENT', 'Brand', 'PUBLISHED', 2000, []);
  proof.h('W0 folders are flat names (decision A23): a "/" is refused with a clear message');
  const nested = await uploadAsset(org, ROLE, { fileName: 'n.txt', content: makeText(10, 'n'), assetType: 'DOCUMENT', fields: { folderPath: 'A/B' } });
  proofUpload(proof, 'W0', orgPath(org, '/assets/upload'), nested, { folderPath: 'A/B' });
  expect(nested.status).toBe(400);
  const q = async (qs: string) => {
    const r = await api('GET', orgPath(org, `/assets?${qs}`), { token: owner.token });
    proof.http('GET', orgPath(org, `/assets?${qs}`), { ...r, body: { names: listData(r).map((a) => a.name.replace(`${P} `, '')), meta: r.body.meta } });
    return { names: listData(r).map((a) => a.name.replace(`${P} `, '')), meta: r.body.meta, status: r.status };
  };
  expect((await q('search=banner')).names.sort()).toEqual(['Summer banner', 'Winter banner']);
  expect((await q('search=100%25')).names).toEqual(['Brand guide 100%']); // % is literal, not a wildcard
  expect((await q('search=under_score')).names).toEqual(['under_score file']); // _ is literal
  expect((await q('search=%25')).names).toEqual(['Brand guide 100%']);
  expect((await q('assetType=BANNER&status=PUBLISHED')).names).toEqual(['Summer banner']);
  expect((await q('folderPath=Brand')).names.sort()).toEqual(['Brand guide 100%', 'under_score file']);
  expect((await q('tag=winter')).names).toEqual(['Winter banner']);
  expect((await q('sortBy=fileSize&sortDir=desc')).names).toEqual(['Brand guide 100%', 'Summer banner', 'under_score file', 'Winter banner']);
  expect((await q('sortBy=name&sortDir=asc')).names).toEqual(['Brand guide 100%', 'Summer banner', 'under_score file', 'Winter banner']);
  const p1 = await q('sortBy=name&sortDir=asc&limit=3&page=1');
  const p2 = await q('sortBy=name&sortDir=asc&limit=3&page=2');
  expect(p1.meta.total).toBe(4);
  expect(p1.names.length).toBe(3);
  expect(p2.names).toEqual(['Winter banner']);
  expect((await q('page=99&limit=3')).names).toEqual([]);
  for (const bad of ['sortBy=storageKey', 'sortDir=sideways', 'limit=0', 'page=-1', 'assetType=NOPE', "search=' OR 1=1 --"]) {
    const r = await q(bad);
    if (bad.startsWith('search')) expect(r.names).toEqual([]);
    else expect(r.status, bad).toBe(400);
  }
  const folders = await api('GET', orgPath(org, '/assets/folders'), { token: owner.token });
  proof.http('GET', orgPath(org, '/assets/folders'), folders);
  const used = folders.data.filter((x: any) => x.assetCount > 0).map((x: any) => [x.folder, x.assetCount]);
  proof.note(`folders with files: ${JSON.stringify(used)}; suggested empty folders: ${folders.data.filter((x: any) => !x.assetCount).map((x: any) => x.folder).join(', ')}`);
  expect(used.sort()).toEqual([['Brand', 2], ['Campaigns Summer', 1], ['Campaigns Winter', 1]]);
});

test('X. edit, rename, move and replace', async () => {
  const proof = new Proof('X');
  await wipeOrg(org, ROLE);
  await setLimit(org, TEN_MB);
  const owner = await as(ROLE);
  const a = await uploadAsset(org, ROLE, { fileName: 'flyer.pdf', content: Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(1000)]), assetType: 'PDF', name: `${P} flyer` });
  const patch = async (body: Record<string, unknown>) => {
    const r = await api('PATCH', orgPath(org, `/assets/${a.data.id}`), { token: owner.token, body });
    proof.http('PATCH', orgPath(org, `/assets/${a.data.id}`), { ...r, body: r.status < 300 ? { name: r.data.name, fileName: r.data.fileName, folder: r.data.folder, description: r.data.description, tags: r.data.tags } : r.body }, body);
    return r;
  };
  proof.h('X1 rename: the extension of the stored file must stay (the content does not change)');
  const noExt = await patch({ fileName: 'Summer flyer FINAL' });
  expect(noExt.status).toBe(400);
  const ren2 = await patch({ fileName: 'trick.exe' });
  expect(ren2.status).toBe(400);
  const ren = await patch({ fileName: 'Summer flyer FINAL.pdf' });
  expect(ren.status).toBe(200);
  expect(ren.data.fileName).toBe('Summer flyer FINAL.pdf');
  proof.h('X2 move to a folder, edit text fields');
  expect((await patch({ folderPath: 'Print 2026' })).status).toBe(200);
  expect((await patch({ description: 'A4 flyer', tags: ['print', 'a4'] })).status).toBe(200);
  proof.h('X3 fields that may not be changed by PATCH');
  for (const body of [{ storageKey: 'orgs/x/y' }, { fileSize: 1 }, { checksum: 'x' }, { organizationId: f.orgA.id }, { version: 9 }, { sourceType: 'URL' }]) {
    const r = await patch(body);
    expect(r.status, JSON.stringify(body)).toBe(400);
  }
  const row = await sqlOne<any>(`SELECT name, fileName, JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.folderPath')) folder, organizationId, storageKey, fileSize FROM assets WHERE id=?`, [a.data.id]);
  proof.sql(`SELECT name, fileName, folder, organizationId, storageKey, fileSize FROM assets WHERE id='${a.data.id}'`, row);
  expect(row.organizationId).toBe(org);
  expect(Number(row.fileSize)).toBe(1009);
  proof.h('X4 replace the file = upload a new version (same type); old version keeps counting until deleted');
  const v2 = await uploadVersion(org, ROLE, a.data.id, { fileName: 'flyer-v2.pdf', content: Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(2000)]) });
  proofUpload(proof, 'X4', orgPath(org, `/assets/${a.data.id}/versions/upload`), { ...v2, body: v2.status === 201 ? { version: v2.data.version, fileSize: v2.data.fileSize, fileName: v2.data.fileName } : v2.body }, { size: 2009 });
  expect(v2.status).toBe(201);
  expect(v2.data.version).toBe(2);
  const v = await threeViews(proof, org, 'X4', ROLE);
  expect(v.api.breakdown).toEqual({ filesBytes: 2009, olderVersionsBytes: 1009, trashBytes: 0 });
  proof.h('X5 audit trail of the changes');
  const audit = await sql<any>(`SELECT action, beforeState, afterState FROM audit_logs WHERE resourceId=? ORDER BY createdAt`, [a.data.id]);
  proof.sql(`SELECT action, beforeState, afterState FROM audit_logs WHERE resourceId='${a.data.id}' ORDER BY createdAt`, audit);
  const actions = audit.map((x) => x.action);
  expect(actions).toEqual(expect.arrayContaining(['ASSET_UPLOADED', 'ASSET_RENAMED', 'ASSET_MOVED', 'ASSET_VERSION_ADDED']));
});

test('Y. deleting an asset that is in bundles', async () => {
  const proof = new Proof('Y');
  await wipeOrg(org, ROLE);
  await setLimit(org, TEN_MB);
  const owner = await as(ROLE);
  const a = await uploadAsset(org, ROLE, { fileName: 'kit.png', content: await makePng(50, 50), assetType: 'IMAGE', name: `${P} kit` });
  const bundleIds: string[] = [];
  for (const n of ['Y one', 'Y two']) {
    const b = await api('POST', orgPath(org, '/asset-bundles'), { token: owner.token, body: { name: `${P} ${n} ${Date.now()}`, visibility: 'PRIVATE' } });
    expect(b.status).toBe(201);
    await api('POST', orgPath(org, `/asset-bundles/${b.data.id}/assets`), { token: owner.token, body: { assetId: a.data.id } });
    bundleIds.push(b.data.id);
  }
  proof.h('Y1 trash: the response names the bundles; the bundles keep the item, shown as unavailable');
  const del = await api('DELETE', orgPath(org, `/assets/${a.data.id}`), { token: owner.token });
  proof.http('DELETE', orgPath(org, `/assets/${a.data.id}`), del);
  const audit = await sqlOne<any>(`SELECT metadata FROM audit_logs WHERE resourceId=? AND action='ASSET_TRASHED' ORDER BY createdAt DESC LIMIT 1`, [a.data.id]);
  proof.sql(`SELECT metadata FROM audit_logs WHERE resourceId='${a.data.id}' AND action='ASSET_TRASHED'`, audit);
  const b1 = await api('GET', orgPath(org, `/asset-bundles/${bundleIds[0]}`), { token: owner.token });
  proof.http('GET', orgPath(org, `/asset-bundles/${bundleIds[0]}`), { ...b1, body: { assetCount: b1.data.assetCount, availableAssetCount: b1.data.availableAssetCount, items: b1.data.items.map((i: any) => ({ assetId: i.assetId, available: i.available, unavailableReason: i.unavailableReason })) } });
  expect(b1.data.items[0]).toMatchObject({ available: false });
  proof.h('Y2 restore → available again');
  await api('POST', orgPath(org, `/assets/${a.data.id}/restore`), { token: owner.token, body: {} });
  const b2 = await api('GET', orgPath(org, `/asset-bundles/${bundleIds[0]}`), { token: owner.token });
  expect(b2.data.items[0]).toMatchObject({ available: true });
  proof.h('Y3 permanent delete removes it from both bundles; the bundles stay');
  await api('DELETE', orgPath(org, `/assets/${a.data.id}`), { token: owner.token });
  const perm = await api('DELETE', orgPath(org, `/assets/${a.data.id}/permanent`), { token: owner.token });
  proof.http('DELETE', orgPath(org, `/assets/${a.data.id}/permanent`), perm);
  for (const id of bundleIds) {
    const b = await api('GET', orgPath(org, `/asset-bundles/${id}`), { token: owner.token });
    proof.http('GET', orgPath(org, `/asset-bundles/${id}`), { ...b, body: { status: b.status, assetCount: b.data?.assetCount, items: b.data?.items?.length } });
    expect(b.status).toBe(200);
    expect(b.data.items.length).toBe(0);
  }
  const items = await sql<any>(`SELECT * FROM asset_bundle_items WHERE assetId=?`, [a.data.id]);
  proof.sql(`SELECT * FROM asset_bundle_items WHERE assetId='${a.data.id}'`, items);
  expect(items).toEqual([]);
  expect((await listKeys(`orgs/${org}/assets/${a.data.id}/`)).length).toBe(0);
  expect((await listKeys(`orgs/${org}/thumbnails/${a.data.id}/`)).length).toBe(0);
  void head;
});
