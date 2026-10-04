import { expect, test } from '@playwright/test';
import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { api } from '../lib/api';
import { closeDb, db, sql, sqlOne } from '../lib/db';
import { loadFixtures } from '../lib/fixtures';
import { Proof } from '../lib/proof';
import { head, listKeys } from '../lib/s3';
import { as } from '../lib/session';
import { MB, dbStorage, openReservations, orgPath, proofUpload, s3AssetBytes, setLimit, uploadAsset, wipeOrg, DEFAULT_LIMIT } from '../lib/assets';
import { makeText } from '../lib/upload';

const f = loadFixtures();
const BACKEND = path.resolve(__dirname, '..', '..');
const ROOTS = { backend: BACKEND, frontend: path.resolve(BACKEND, '..', 'partner-iq-frontend'), portal: path.resolve(BACKEND, '..', 'partner-iq-affiliate-portal') };
const org = f.orgEmpty!.id;
const ROLE = 'ORG_EMPTY_OWNER';
test.afterAll(async () => closeDb());

function sh(cmd: string, cwd = BACKEND) {
  const r = spawnSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8', maxBuffer: 50 * MB });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

test('A. one place only: no SDK, no fs writes, no direct-to-S3 client code outside src/common/storage', async () => {
  const proof = new Proof('A');
  proof.h('A1 architecture lint (ESLint no-restricted-imports / properties / syntax)');
  const lint = sh('npm run -s lint:architecture 2>&1 | tail -20');
  proof.note(`$ npm run lint:architecture\nexit=${lint.code}\n${lint.out || '(no findings)'}`);
  proof.h('A2 architecture unit test');
  const unit = sh('npx jest --forceExit --testPathPatterns storage-architecture 2>&1 | tail -15');
  proof.note(`$ npx jest storage-architecture\nexit=${unit.code}\n${unit.out}`);
  proof.h('A3 grep: AWS SDK imports in backend src (outside src/common/storage)');
  const grepSdk = sh(`grep -rnE "from '@aws-sdk|require\\('@aws-sdk|from '@smithy" src --include=*.ts | grep -v '^src/common/storage/' || true`);
  proof.note(grepSdk.out || '(none)');
  proof.h('A4 grep: fs write calls in backend src (outside src/common/storage)');
  const grepFs = sh(`grep -rnE "\\b(writeFile|writeFileSync|createWriteStream|appendFile|appendFileSync|mkdirSync|copyFile|rename)\\(" src --include=*.ts | grep -v '^src/common/storage/' || true`);
  proof.note(grepFs.out || '(none)');
  proof.h('A5 grep: S3 / Cloudinary / multer in the two frontends and the backend');
  const fe = sh(`grep -rnEi "amazonaws|@aws-sdk|cloudinary|s3\\.|presign" src --include=*.ts --include=*.tsx || true`, ROOTS.frontend);
  const ap = sh(`grep -rnEi "amazonaws|@aws-sdk|cloudinary|s3\\.|presign" src --include=*.ts --include=*.tsx || true`, ROOTS.portal);
  const multer = sh(`grep -rnEi "multer|FileInterceptor|diskStorage" src --include=*.ts || true; grep -n '"multer"' package.json || true`);
  // code that talks to Cloudinary (its upload API or credentials); demo logo URLs in seeds / examples are data, not uploads
  const cloud = sh(`grep -rnE "api\\.cloudinary\\.com|CLOUDINARY_[A-Z_]+|cloudinary\\.v2|from 'cloudinary'" src --include=*.ts | grep -v '^src/modules/storage-quota/cli/' || true`);
  proof.note(`frontend:\n${fe.out || '(none)'}\nportal:\n${ap.out || '(none)'}\nbackend multer:\n${multer.out || '(none)'}\nbackend cloudinary:\n${cloud.out || '(none)'}`);
  proof.check('lint:architecture exit 0', lint.code, 0);
  proof.check('architecture unit test exit 0', unit.code, 0);
  expect(lint.code).toBe(0);
  expect(unit.code).toBe(0);
  // the dev email provider writes rendered e-mails to scratch/ (decision: exempt, not user files) — anything else fails
  const fsHits = grepFs.out.split('\n').filter((l) => l && !l.startsWith('src/modules/notifications/') && !l.includes('development-email.provider.ts'));
  proof.check('no fs writes outside storage (dev email provider exempt)', fsHits, []);
  expect(grepSdk.out).toBe('');
  expect(fsHits).toEqual([]);
  expect(fe.out).toBe('');
  expect(ap.out).toBe('');
  expect(multer.out).toBe('');
  expect(cloud.out).toBe('');
});

test('B. configuration is validated at startup with a clear message', async () => {
  const proof = new Proof('B');
  const base = { STORAGE_PROVIDER: 's3', STORAGE_BUCKET: 'test-bucket', STORAGE_REGION: 'us-east-1', STORAGE_ACCESS_KEY_ID: 'AKIAEXAMPLE', STORAGE_SECRET_ACCESS_KEY: 'example-secret' };
  const cases: Array<[string, Record<string, string | undefined>]> = [
    ['missing bucket', { STORAGE_BUCKET: undefined }],
    ['invalid bucket name', { STORAGE_BUCKET: 'B' }],
    ['bad region', { STORAGE_REGION: 'mars' }],
    ['unknown provider', { STORAGE_PROVIDER: 'ftp' }],
    ['no credentials and no IAM role', { STORAGE_ACCESS_KEY_ID: undefined, STORAGE_SECRET_ACCESS_KEY: undefined }],
    ['only one of the two keys', { STORAGE_SECRET_ACCESS_KEY: undefined }],
    ['KMS without key id', { STORAGE_ENCRYPTION: 'aws:kms' }],
    ['limit not a number', { STORAGE_DEFAULT_ORG_LIMIT_BYTES: '3GB' }],
    ['negative max file size', { STORAGE_MAX_FILE_BYTES: '-1' }],
    ['unknown file type', { STORAGE_ALLOWED_FILE_TYPES: 'png,exe' }],
    ['endpoint not a URL', { STORAGE_ENDPOINT: 'minio:9000' }],
    ['valid', {}],
  ];
  const results: Record<string, string> = {};
  for (const [label, patch] of cases) {
    const env = { ...base, ...patch } as Record<string, string | undefined>;
    const script = `try { const c = require('./dist/src/common/storage/storage.config').loadStorageConfig(${JSON.stringify(env)}); console.log('OK bucket=' + c.bucket + ' limit=' + c.defaultOrganizationLimitBytes); } catch (e) { console.log(e.name + ': ' + e.message); process.exitCode = 3; }`;
    const r = spawnSync('node', ['-e', script], { cwd: BACKEND, encoding: 'utf8' });
    results[label] = `${r.stdout.trim()} (exit ${r.status})`;
    proof.note(`[${label}] env patch ${JSON.stringify(patch)} -> ${results[label]}`);
  }
  for (const [label] of cases.slice(0, -1)) expect(results[label], label).toMatch(/StorageConfigError/);
  expect(results.valid).toMatch(/^OK bucket=test-bucket limit=3221225472/);

  proof.h('B2 the whole application refuses to start without a bucket (port 5099)');
  const child = spawnSync('node', ['dist/src/main.js'], { cwd: BACKEND, encoding: 'utf8', timeout: 60_000, env: { ...process.env, PORT: '5099', STORAGE_BUCKET: '', STORAGE_JOBS_ENABLED: 'false' } });
  const out = `${child.stdout}${child.stderr}`.split('\n').filter((l) => /storage|Storage|STORAGE/.test(l)).slice(0, 5).join('\n');
  proof.note(`$ PORT=5099 STORAGE_BUCKET= node dist/src/main.js\nexit=${child.status} signal=${child.signal}\n${out}`);
  expect(child.status).not.toBe(0);
  expect(out).toMatch(/STORAGE_BUCKET/);
  proof.check('no secret value printed', /example-secret|SECRET_ACCESS_KEY=\S/.test(`${child.stdout}${child.stderr}`), false);
});

test('C. bucket security: private, encrypted, short signed links, no versioning', async () => {
  const proof = new Proof('C');
  const admin = await as('PLATFORM_ADMIN');
  const settings = await api('GET', '/admin/storage/bucket-settings', { token: admin.token });
  proof.h('C1 bucket settings reported by StorageService.describeBucketSettings()');
  proof.http('GET', '/admin/storage/bucket-settings', settings);
  const owner = await as('ORG_A_OWNER');
  const up = await uploadAsset(f.orgA.id, 'ORG_A_OWNER', { fileName: 'c-security.txt', content: makeText(2048, 'C'), assetType: 'DOCUMENT', name: `${f.prefix}-C doc` });
  proofUpload(proof, 'C2', orgPath(f.orgA.id, '/assets/upload'), up, { fileName: 'c-security.txt', size: 2048 });
  expect(up.status).toBe(201);
  const row = await sqlOne<any>(`SELECT storageKey FROM assets WHERE id = ?`, [up.data.id]);
  proof.sql(`SELECT storageKey FROM assets WHERE id='${up.data.id}'`, row);
  const objectUrl = `http://127.0.0.1:9000/${process.env.STORAGE_BUCKET || 'partneriq-assets-test'}/${row.storageKey}`;
  const anon = await fetch(objectUrl);
  proof.note(`anonymous GET ${objectUrl} -> HTTP ${anon.status} ${(await anon.text()).slice(0, 200)}`);
  expect(anon.status).toBe(403);
  const listing = await fetch(`http://127.0.0.1:9000/${process.env.STORAGE_BUCKET || 'partneriq-assets-test'}?list-type=2`);
  proof.note(`anonymous LIST bucket -> HTTP ${listing.status}`);
  expect(listing.status).toBe(403);
  const h = await head(row.storageKey);
  proof.note(`HeadObject (independent client): ${JSON.stringify(h)}`);
  expect(h?.sse).toBe('AES256');
  const dl = await api('GET', orgPath(f.orgA.id, `/assets/${up.data.id}/download`), { token: owner.token });
  const u = new URL(dl.data.url);
  proof.note(`signed URL params: X-Amz-Expires=${u.searchParams.get('X-Amz-Expires')} response-content-disposition=${u.searchParams.get('response-content-disposition')}`);
  expect(u.searchParams.get('X-Amz-Expires')).toBe('300');
  expect(u.searchParams.get('response-content-disposition')).toMatch(/^attachment; filename/);
  const tampered = new URL(dl.data.url);
  tampered.searchParams.set('response-content-disposition', 'inline');
  const bad = await fetch(tampered);
  proof.note(`signed URL with changed disposition -> HTTP ${bad.status}`);
  expect(bad.status).toBe(403);
  const s = settings.data;
  expect(JSON.stringify(s.encryption)).toMatch(/AES256|aws:kms/);
  expect(s.versioning).not.toMatch(/^Enabled$/);
  expect(s.anonymousReadProbe?.status).toBe(403);
  proof.note(`publicAccessBlock: ${JSON.stringify(s.publicAccessBlock)} (MinIO has no PublicAccessBlock API — decision A5; anonymous access proven denied above)`);
  proof.note(`log check: no signed URL or secret in the backend log`);
  const log = fs.existsSync('/home/user/backend-assets.log') ? fs.readFileSync('/home/user/backend-assets.log', 'utf8') : '';
  proof.check('backend log contains no X-Amz-Signature', log.includes('X-Amz-Signature'), false);
  proof.check('backend log contains no secret access key', /secretAccessKey|SECRET_ACCESS_KEY=/.test(log), false);
  expect(log.includes('X-Amz-Signature')).toBe(false);
});

/** Resident memory of the backend process in MB, sampled from /proc. */
function backendRssMb(): number {
  const pid = execSync(`pgrep -f "^node dist/src/main.js" | head -1`).toString().trim();
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  return Number(status.match(/VmRSS:\s+(\d+)/)![1]) / 1024;
}

test('D. a 199 MB upload is streamed: backend memory stays flat', async () => {
  test.setTimeout(600_000);
  const proof = new Proof('D');
  await wipeOrg(org, ROLE);
  await setLimit(org, DEFAULT_LIMIT, proof);
  const size = 199 * MB;
  const samples: number[] = [];
  const before = backendRssMb();
  const timer = setInterval(() => samples.push(backendRssMb()), 200);
  const t0 = Date.now();
  const r = await uploadAsset(org, ROLE, { fileName: 'big-199mb.txt', content: { size, byte: 0x41 }, assetType: 'DOCUMENT', name: `${f.prefix}-D 199MB`, timeoutMs: 600_000 });
  clearInterval(timer);
  const secs = (Date.now() - t0) / 1000;
  proofUpload(proof, 'D1', orgPath(org, '/assets/upload'), r, { size });
  const peak = Math.max(...samples);
  proof.note(`RSS before=${before.toFixed(1)} MB, peak during upload=${peak.toFixed(1)} MB, growth=${(peak - before).toFixed(1)} MB, samples=${samples.length}, duration=${secs.toFixed(1)} s, throughput=${(199 / secs).toFixed(1)} MB/s`);
  proof.note(`RSS samples (MB): ${samples.map((s) => s.toFixed(0)).join(' ')}`);
  expect(r.status).toBe(201);
  expect(r.data.fileSize).toBe(size);
  const s3 = await s3AssetBytes(org);
  proof.note(`S3: ${JSON.stringify(s3.keys)}`);
  expect(s3.bytes).toBe(size);
  const d = await dbStorage(org);
  proof.sql(`SELECT * FROM organization_storage WHERE organizationId='${org}'`, d);
  expect(d!.usedBytes).toBe(size);
  // 8 MB parts × queue 2 + busboy/highWaterMark buffers; anything near the file size would mean buffering
  proof.check('memory growth < 120 MB for a 199 MB file', peak - before < 120, true);
  expect(peak - before).toBeLessThan(120);
  await wipeOrg(org, ROLE);
});

test('E. failures leave nothing behind: killed connection, storage down, database locked', async () => {
  test.setTimeout(600_000);
  const proof = new Proof('E');
  await wipeOrg(org, ROLE);
  await setLimit(org, DEFAULT_LIMIT);
  const objectsBefore = (await listKeys(`orgs/${org}/`)).length;
  const assetsBefore = Number((await sqlOne<any>(`SELECT COUNT(*) n FROM assets WHERE organizationId=?`, [org])).n);

  proof.h('E1 client connection killed after 20 MB of a 60 MB upload');
  const killed = await uploadAsset(org, ROLE, { fileName: 'killed.txt', content: { size: 60 * MB }, killAfterBytes: 20 * MB, assetType: 'DOCUMENT' });
  proofUpload(proof, 'E1', orgPath(org, '/assets/upload'), killed, { size: 60 * MB, killAfterBytes: 20 * MB });
  await new Promise((r) => setTimeout(r, 3000));
  let d = await dbStorage(org);
  proof.sql(`SELECT * FROM organization_storage WHERE organizationId='${org}'`, d);
  proof.sql(`SELECT * FROM storage_reservations WHERE organizationId='${org}' AND status='RESERVED'`, await openReservations(org));
  const last = await sql<any>(`SELECT status, releaseReason, bytes FROM storage_reservations WHERE organizationId=? ORDER BY createdAt DESC LIMIT 1`, [org]);
  proof.sql(`SELECT status, releaseReason, bytes FROM storage_reservations ORDER BY createdAt DESC LIMIT 1`, last);
  const mpu = execSync(`MC_CONFIG_DIR=/opt/minio/etc/mc /opt/minio/gopath/bin/mc ls --incomplete --recursive local/partneriq-assets-test/orgs/${org}/ 2>&1 || true`).toString();
  proof.note(`incomplete multipart uploads under orgs/${org}/: ${mpu.trim() || '(none)'}`);
  expect(d).toMatchObject({ usedBytes: 0, reservedBytes: 0, activeUploads: 0 });
  expect(last[0].status).toBe('RELEASED');
  expect((await listKeys(`orgs/${org}/`)).length).toBe(objectsBefore);
  expect(mpu.trim()).toBe('');

  proof.h('E2 storage (MinIO) stopped during an upload');
  const slow = uploadAsset(org, ROLE, { fileName: 'outage.txt', content: { size: 40 * MB }, throttleMs: 15, assetType: 'DOCUMENT', timeoutMs: 300_000 });
  await new Promise((r) => setTimeout(r, 2500));
  proof.note(`$ scripts/minio.sh stop -> ${execSync(`${__dirname}/../scripts/minio.sh stop`).toString().trim()}`);
  const outage = await slow;
  proofUpload(proof, 'E2', orgPath(org, '/assets/upload'), outage, { size: 40 * MB, throttleMs: 15 });
  proof.note(`$ scripts/minio.sh start -> ${execSync(`${__dirname}/../scripts/minio.sh start`).toString().trim()}`);
  expect([502, 503, 504]).toContain(outage.status);
  expect(outage.body?.message || '').toMatch(/storage/i);
  await new Promise((r) => setTimeout(r, 2000));
  d = await dbStorage(org);
  proof.sql(`SELECT * FROM organization_storage WHERE organizationId='${org}'`, d);
  expect(d).toMatchObject({ usedBytes: 0, reservedBytes: 0, activeUploads: 0 });
  // the abort of the multipart upload could not reach MinIO while it was down: the cleanup job aborts it now
  await (await import('../lib/assets')).runJob('cleanup-reservations', proof);
  const mpu2 = execSync(`MC_CONFIG_DIR=/opt/minio/etc/mc /opt/minio/gopath/bin/mc ls --incomplete --recursive local/partneriq-assets-test/orgs/${org}/ 2>&1 || true`).toString();
  proof.note(`incomplete multipart uploads after the cleanup job: ${mpu2.trim() || '(none)'}`);
  expect((await listKeys(`orgs/${org}/`)).length).toBe(objectsBefore);

  proof.h('E4 the client hangs up after sending the whole body, before the answer (cancel at the last moment)');
  const late = await uploadAsset(org, ROLE, { fileName: 'late-cancel.txt', content: { size: 40 * MB }, destroyAfterBodyMs: 30, assetType: 'DOCUMENT', name: 'late cancel' });
  proofUpload(proof, 'E4', orgPath(org, '/assets/upload'), late, { size: 40 * MB, destroyAfterBodyMs: 30 });
  await new Promise((r) => setTimeout(r, 3000));
  d = await dbStorage(org);
  proof.sql(`SELECT * FROM organization_storage WHERE organizationId='${org}'`, d);
  const lateRow = await sqlOne<any>(`SELECT COUNT(*) n FROM assets WHERE organizationId=? AND fileName='late-cancel.txt'`, [org]);
  proof.sql(`SELECT COUNT(*) FROM assets WHERE fileName='late-cancel.txt'`, lateRow);
  expect(late.status).toBe(0); // no answer reached the client
  expect(d).toMatchObject({ usedBytes: 0, reservedBytes: 0, activeUploads: 0 });
  expect(Number(lateRow.n)).toBe(0);
  expect((await listKeys(`orgs/${org}/`)).length).toBe(objectsBefore);

  proof.h('E3 database write blocked (assets table locked by another session) when the upload commits');
  const conn = await db().getConnection();
  await conn.query('LOCK TABLES assets WRITE');
  proof.note('mysql(session 2)> LOCK TABLES assets WRITE');
  const locked = await uploadAsset(org, ROLE, { fileName: 'locked.txt', content: makeText(3 * MB, 'E3'), assetType: 'DOCUMENT', timeoutMs: 120_000 });
  await conn.query('UNLOCK TABLES');
  conn.release();
  proof.note('mysql(session 2)> UNLOCK TABLES');
  proofUpload(proof, 'E3', orgPath(org, '/assets/upload'), locked, { size: 3 * MB });
  expect(locked.status).toBe(503);
  await new Promise((r) => setTimeout(r, 1500));
  d = await dbStorage(org);
  proof.sql(`SELECT * FROM organization_storage WHERE organizationId='${org}'`, d);
  const assetsAfter = Number((await sqlOne<any>(`SELECT COUNT(*) n FROM assets WHERE organizationId=?`, [org])).n);
  proof.sql(`SELECT COUNT(*) FROM assets WHERE organizationId='${org}'`, { before: assetsBefore, after: assetsAfter });
  const keys = await listKeys(`orgs/${org}/`);
  proof.note(`S3 objects under orgs/${org}/: ${JSON.stringify(keys)}`);
  expect(d).toMatchObject({ usedBytes: 0, reservedBytes: 0, activeUploads: 0 });
  expect(assetsAfter).toBe(assetsBefore);
  expect(keys.length).toBe(objectsBefore);
});
