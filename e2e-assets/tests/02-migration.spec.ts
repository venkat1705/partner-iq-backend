import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { api } from '../lib/api';
import { closeDb, sql, sqlOne } from '../lib/db';
import { loadFixtures } from '../lib/fixtures';
import { Proof } from '../lib/proof';
import { sha256Of } from '../lib/s3';
import { as } from '../lib/session';
import { dbStorage, orgPath } from '../lib/assets';
import { makePng } from '../lib/upload';

/**
 * F. Files that existed before the storage service: legacy asset rows (client-supplied URL / key) and a program logo.
 * A local HTTP server plays the old file host (allowlisted); other sources must be refused.
 */
const f = loadFixtures();
const org = f.orgA.id;
const BACKEND = path.resolve(__dirname, '..', '..');
const P = `${f.prefix}-F`;
test.afterAll(async () => closeDb());

/** Async restart (a synchronous one would block this process, which keeps a keep-alive socket to the backend). */
function restartBackend() {
  return new Promise<string>((resolve) => {
    const child = spawn(`${__dirname}/../scripts/restart-backend.sh`, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => resolve(out.trim()));
  });
}

test('F. existing files are copied, verified, originals kept, counts reported', async () => {
  test.setTimeout(300_000);
  const proof = new Proof('F');
  const png = await makePng(400, 300, 7);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(50_000), Buffer.from('\n%%EOF\n')]);
  const logo = await makePng(120, 120, 9);
  const files: Record<string, Buffer> = { '/legacy/banner.png': png, '/legacy/guide.pdf': pdf, '/legacy/logo.png': logo };
  const server = http.createServer((req, res) => {
    const body = files[req.url || ''];
    if (!body) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-length': body.length, 'content-type': 'application/octet-stream' }).end(body);
  });
  await new Promise<void>((r) => server.listen(8899, '127.0.0.1', r));
  const SRC = 'http://127.0.0.1:8899';
  try {
    proof.h('F1 seed legacy rows (test data, prefix ' + P + ')');
    const ids = { ok1: crypto.randomUUID(), ok2: crypto.randomUUID(), foreign: crypto.randomUUID(), keyOnly: crypto.randomUUID(), missing: crypto.randomUUID() };
    const rows: Array<[string, string, string | null, string | null, string]> = [
      [ids.ok1, `${P} legacy banner`, `${SRC}/legacy/banner.png`, null, 'banner.png'],
      [ids.ok2, `${P} legacy guide`, `${SRC}/legacy/guide.pdf`, 'uploads/guide.pdf', 'guide.pdf'],
      [ids.foreign, `${P} legacy foreign host`, 'https://evil.example.com/x.png', null, 'x.png'],
      [ids.keyOnly, `${P} legacy key only`, null, `${f.orgB.id}/assets/stolen.png`, 'stolen.png'],
      [ids.missing, `${P} legacy 404`, `${SRC}/legacy/gone.png`, null, 'gone.png'],
    ];
    for (const [id, name, url, key, fileName] of rows) {
      await sql(
        `INSERT INTO assets (id, organizationId, environment, name, assetType, sourceType, status, fileName, originalFileName, storageUrl, storageKey, fileSize, version, isPublicToAffiliates, isDownloadable, isCopyable, createdBy, createdAt, updatedAt)
         VALUES (?, ?, 'LIVE', ?, 'IMAGE', 'FILE', 'PUBLISHED', ?, ?, ?, ?, 12345, 1, 1, 1, 1, 'e2e-legacy', NOW(6), NOW(6))`,
        [id, org, name, fileName, fileName, url, key],
      );
      await sql(`INSERT INTO asset_versions (id, assetId, versionNumber, storageKey, storageUrl, fileName, fileSize, isCurrent, createdBy, createdAt) VALUES (?, ?, 1, ?, ?, ?, 12345, 1, 'e2e-legacy', NOW(6))`, [crypto.randomUUID(), id, key, url, fileName]);
    }
    const pA2 = f.orgA.programs[1].id;
    const oldLogo = await sqlOne<any>(`SELECT logoUrl FROM programs WHERE id = ?`, [pA2]);
    await sql(`UPDATE programs SET logoUrl = ? WHERE id = ?`, [`${SRC}/legacy/logo.png`, pA2]);
    proof.sql(`SELECT id, name, storageUrl, storageKey FROM assets WHERE name LIKE '${P}%'`, await sql(`SELECT id, name, storageUrl, storageKey FROM assets WHERE name LIKE ?`, [`${P}%`]));
    proof.note(`program ${pA2} logoUrl: ${JSON.stringify(oldLogo?.logoUrl)} -> ${SRC}/legacy/logo.png (test program)`);

    const owner = await as('ORG_A_OWNER');
    const before = await api('GET', orgPath(org, `/assets/${ids.ok1}`), { token: owner.token });
    proof.http('GET', orgPath(org, `/assets/${ids.ok1}`) + ' (before)', { ...before, body: { hasFile: before.data?.hasFile, legacyFileMissing: before.data?.legacyFileMissing } });
    expect(before.data.legacyFileMissing).toBe(true);
    const usageBefore = await dbStorage(org);

    const env = { ...process.env, STORAGE_MIGRATION_ALLOWED_HOSTS: '127.0.0.1:8899', STORAGE_MIGRATION_ALLOW_HTTP: 'true' };
    // async: this process also serves the legacy files, a synchronous spawn would block the server
    const run = (extra: string[]) =>
      new Promise<{ code: number | null; report: any; raw: string }>((resolve, reject) => {
        const child = spawn('node', ['dist/src/modules/storage-quota/cli/migrate-legacy-files.js', `--org=${org}`, '--media', ...extra], { cwd: BACKEND, env });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
        child.on('close', (code) => {
          clearTimeout(timer);
          const marker = '===MIGRATION REPORT===';
          if (!out.includes(marker)) return reject(new Error(`migration did not report (exit ${code}): ${out.slice(-2000)}`));
          resolve({ code, report: JSON.parse(out.slice(out.indexOf(marker) + marker.length)), raw: out });
        });
      });
    proof.h('F2 dry run (changes nothing)');
    const dry = await run([]);
    proof.note(`$ STORAGE_MIGRATION_ALLOWED_HOSTS=127.0.0.1:8899 STORAGE_MIGRATION_ALLOW_HTTP=true node dist/.../migrate-legacy-files.js --org=${org} --media\nexit=${dry.code}\n${JSON.stringify(dry.report.totals)}\n${dry.report.items.map((i: any) => `${i.status} ${i.kind} ${i.id} ${i.reason || ''}`).join('\n')}`);
    const myVersionIds = (await sql<any>(`SELECT id FROM asset_versions WHERE assetId IN (?)`, [Object.values(ids)])).map((v) => v.id);
    const mine = (r: any) => r.items.filter((i: any) => Object.values(ids).includes(i.id) || myVersionIds.includes(i.id) || (i.kind === 'media' && i.source?.startsWith(SRC)));
    // banner, guide, logo and the 404 source (a dry run does not fetch); foreign host and key-only are skipped
    expect(mine(dry.report).filter((i: any) => i.status === 'would-copy').length).toBe(4);
    expect(mine(dry.report).filter((i: any) => i.status === 'skipped').length).toBe(2);
    expect((await sqlOne<any>(`SELECT storageKey FROM assets WHERE id = ?`, [ids.ok1])).storageKey).toBeNull();

    proof.h('F3 apply');
    const applied = await run(['--apply']);
    proof.note(`$ … --apply\nexit=${applied.code}\n${JSON.stringify(applied.report.totals)}\n${applied.report.items.map((i: any) => `${i.status} ${i.kind} ${i.id} ${i.bytes ?? ''} ${i.reason || ''}`).join('\n')}`);
    const items = mine(applied.report);
    const byStatus = (s: string) => items.filter((i: any) => i.status === s).length;
    proof.note(`counts for this test's rows: copied=${byStatus('copied')} skipped=${byStatus('skipped')} failed=${byStatus('failed')}`);
    expect(byStatus('copied')).toBe(3);
    expect(byStatus('skipped')).toBe(2); // foreign host, key with no URL
    expect(byStatus('failed')).toBe(1); // 404 source
    expect(applied.code).toBe(2); // non-zero when anything failed

    proof.h('F4 database after apply');
    const after = await sql<any>(`SELECT a.id, a.name, a.storageUrl, a.storageKey, a.fileSize, a.checksum FROM assets a WHERE a.name LIKE ? ORDER BY a.name`, [`${P}%`]);
    proof.sql(`SELECT id, name, storageUrl, storageKey, fileSize, checksum FROM assets WHERE name LIKE '${P}%'`, after);
    // this run's copies: the two seeded assets plus the logo (earlier attempts of this test seeded other rows)
    const objs = await sql<any>(
      `SELECT storageKey, kind, sizeBytes, checksumSha256, migratedFrom, countsTowardQuota FROM stored_objects
        WHERE migratedFrom LIKE ? AND (assetId IN (?) OR (kind = 'MEDIA' AND createdAt >= NOW() - INTERVAL 5 MINUTE))`,
      [`${SRC}%`, Object.values(ids)],
    );
    proof.sql(`SELECT storageKey, kind, sizeBytes, checksumSha256, migratedFrom, countsTowardQuota FROM stored_objects WHERE migratedFrom LIKE '${SRC}%' AND (assetId IN (<this test's assets>) OR recent MEDIA)`, objs);
    expect(objs.filter((o) => o.kind === 'ASSET_FILE').length).toBe(2);
    expect(objs.filter((o) => o.kind === 'MEDIA').length).toBeGreaterThanOrEqual(1);
    const banner = after.find((a) => a.id === ids.ok1);
    expect(banner.storageUrl).toBe(`${SRC}/legacy/banner.png`); // original reference kept
    expect(banner.storageKey).toMatch(new RegExp(`^orgs/${org}/assets/${ids.ok1}/v1/`));
    expect(Number(banner.fileSize)).toBe(png.length);
    expect(banner.checksum).toBe(crypto.createHash('sha256').update(png).digest('hex'));
    expect(after.find((a) => a.id === ids.foreign).storageKey).toBeNull();
    expect(after.find((a) => a.id === ids.keyOnly).storageKey).toBe(`${f.orgB.id}/assets/stolen.png`); // untouched, still not downloadable

    proof.h('F5 S3 (independent client): checksums of the copies equal the source files');
    for (const o of objs) {
      const sha = await sha256Of(o.storageKey);
      proof.note(`${o.storageKey}: s3 sha256=${sha} db=${o.checksumSha256}`);
      expect(sha).toBe(o.checksumSha256);
    }
    expect(objs.find((o) => o.migratedFrom.endsWith('guide.pdf')).checksumSha256).toBe(crypto.createHash('sha256').update(pdf).digest('hex'));
    const usageAfter = await dbStorage(org);
    proof.sql(`organization_storage before/after`, { before: usageBefore, after: usageAfter });
    // every asset file copied in this run counts (rows left by earlier attempts of this test included); media do not
    const copiedAssetBytes = applied.report.items.filter((i: any) => i.status === 'copied' && i.kind !== 'media').reduce((t: number, i: any) => t + i.bytes, 0);
    proof.note(`asset bytes copied in this run (all legacy rows of the org): ${copiedAssetBytes}; this test's two files: ${png.length + pdf.length}`);
    expect(usageAfter!.usedBytes - usageBefore!.usedBytes).toBe(copiedAssetBytes);
    expect(copiedAssetBytes % (png.length + pdf.length)).toBe(0);

    proof.h('F6 the backend caches programs in memory: restart, then the migrated logo and files are served');
    proof.note(await restartBackend());
    const owner2 = await as('ORG_A_OWNER');
    const dl = await api('GET', orgPath(org, `/assets/${ids.ok1}/download`), { token: owner2.token });
    proof.http('GET', orgPath(org, `/assets/${ids.ok1}/download`), { ...dl, body: { status: dl.status, expiresAt: dl.data?.expiresAt } });
    const bytes = Buffer.from(await (await fetch(dl.data.url)).arrayBuffer());
    proof.note(`downloaded ${bytes.length} bytes, sha256 matches source: ${crypto.createHash('sha256').update(bytes).digest('hex') === crypto.createHash('sha256').update(png).digest('hex')}`);
    expect(bytes.equals(png)).toBe(true);
    const prog = await sqlOne<any>(`SELECT logoUrl FROM programs WHERE id = ?`, [pA2]);
    proof.sql(`SELECT logoUrl FROM programs WHERE id='${pA2}'`, prog);
    expect(prog.logoUrl).toMatch(/\/api\/v1\/media\/[0-9a-f-]{36}$/);
    const media = await fetch(prog.logoUrl.replace(/^https?:\/\/[^/]+/, 'http://localhost:5000'), { redirect: 'manual' });
    proof.note(`GET ${prog.logoUrl} -> HTTP ${media.status} location=${media.headers.get('location') ? '(signed URL)' : 'none'}`);
    expect(media.status).toBe(302);
    const legacyMissing = await api('GET', orgPath(org, `/assets/${ids.keyOnly}/download`), { token: owner2.token });
    proof.http('GET', orgPath(org, `/assets/${ids.keyOnly}/download`) + ' (key from another org, never migrated)', legacyMissing);
    expect(legacyMissing.status).toBeGreaterThanOrEqual(400);
    const versions = await api('GET', orgPath(org, `/assets/${ids.keyOnly}/versions`), { token: owner2.token });
    proof.http('GET', orgPath(org, `/assets/${ids.keyOnly}/versions`) + ' (version whose key points into another org)', versions);
    proof.check('version list does not claim a downloadable file', versions.data?.[0]?.hasFile, false);
    expect(versions.data?.[0]?.hasFile).toBe(false);

    proof.h('F7 re-run is a no-op for migrated rows');
    const again = await run(['--apply']);
    const againMine = mine(again.report);
    proof.note(`$ … --apply (second time)\n${JSON.stringify(again.report.totals)}\n${againMine.map((i: any) => `${i.status} ${i.kind} ${i.id} ${i.reason || ''}`).join('\n')}`);
    expect(againMine.filter((i: any) => i.status === 'copied').length).toBe(0);
    proof.note(`source files untouched: ${Object.keys(files).join(', ')} still served by the old host`);
  } finally {
    server.close();
  }
});
