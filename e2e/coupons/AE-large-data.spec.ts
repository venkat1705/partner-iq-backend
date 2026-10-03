import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { api } from '../lib/api';
import { registerWorkspaceUser } from '../lib/actors';
import { F, orgPath, recordSale, tableExists } from '../lib/coupons';
import { closeDb, db, sql } from '../lib/db';
import { loadFixtures, saveFixtures } from '../lib/fixtures';
import { Proof } from '../lib/proof';

/**
 * AE — 50,000 coupons and 55,000 uses (200,000 requested — see D17) inserted DIRECTLY into MySQL (bulk INSERT, not via the API) for a dedicated
 * org (e2e-cpn-<ts>-org-perf), then the backend is restarted so dbStore loads them. p50/p95 over 20 runs.
 * Limits (decision D16): list first/late page ≤ 1000 ms p95, search ≤ 1000 ms, filters ≤ 1000 ms,
 * code check (validate) ≤ 300 ms, checkout sale with coupon ≤ 1000 ms, overview ≤ 2000 ms.
 */
const proof = new Proof('AE');
const f = F();
test.afterAll(async () => closeDb());
/** 200,000 requested; the backend cannot boot with >~62,000 rows in one dbStore table (proof in AE.txt, D17). */
const USES = 55_000;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];

test('AE large data timings and memory', async () => {
  test.setTimeout(1_800_000);
  let fx = loadFixtures() as any;
  if (!fx.orgPerf) {
    const s = await registerWorkspaceUser(`${fx.prefix}-org_perf_owner@example.test`, 'PerfOwner');
    const org = await api('POST', '/organizations', { token: s.token, body: { name: `${fx.prefix}-org-perf`, defaultCurrency: 'INR' } });
    const prog = await api('POST', `/organizations/${org.data.id}/programs`, { token: s.token, body: { name: `${fx.prefix}-prog-perf`, slug: `${fx.prefix}-prog-perf`, type: 'AFFILIATE', commissionType: 'PERCENTAGE', defaultCommissionValue: 500, attributionModel: 'LAST_CLICK', status: 'ACTIVE', currency: 'INR' } });
    const aff = await api('POST', `/organizations/${org.data.id}/affiliates`, { token: s.token, body: { displayName: `${fx.prefix} perf aff`, email: `${fx.prefix}-perf-aff@example.test`, programId: prog.data.id } });
    const key = await api('POST', `/organizations/${org.data.id}/api-keys`, { token: s.token, body: { name: 'perf', preset: 'CONVERSION_TRACKING', environment: 'live' } });
    fx.users.ORG_PERF_OWNER = { ...s, role: 'OWNER', kind: 'workspace' };
    fx.orgPerf = { id: org.data.id, programId: prog.data.id, affiliateId: aff.data.affiliate?.id || aff.data.id, apiKey: key.data.key };
    saveFixtures(fx);
  }
  fx = loadFixtures() as any;
  const perf = fx.orgPerf;
  const [{ n: have }] = await sql(`SELECT COUNT(*) n FROM organization_coupons WHERE organizationId=?`, [perf.id]);
  const conn = db();
  const hasRed = await tableExists('organization_coupon_redemptions');
  if (Number(have) < 50000) {
    proof.h('AE direct bulk insert (MySQL, not via API)');
    const t0 = Date.now();
    const couponIds: string[] = [];
    for (let b = 0; b < 50; b++) {
      const rows: unknown[][] = [];
      for (let i = 0; i < 1000; i++) {
        const n = b * 1000 + i;
        const id = randomUUID();
        couponIds.push(id);
        const code = `PERF${String(n).padStart(6, '0')}`;
        rows.push([id, perf.id, code, code, `perf coupon ${n}`, n % 2 ? 'PERCENTAGE' : 'FIXED_AMOUNT', (n % 50) + 1, n % 7 === 0 ? 'PAUSED' : 'ACTIVE', n % 3 === 0 ? 1000 : null, fx.users.ORG_PERF_OWNER.userId]);
      }
      await conn.query(`INSERT INTO organization_coupons (id, organizationId, code, normalizedCode, name, discountType, discountValue, status, maxRedemptions, createdBy) VALUES ?`, [rows]);
    }
    for (let b = 0; b < USES / 1000; b++) {
      const conv: unknown[][] = [];
      const red: unknown[][] = [];
      for (let i = 0; i < 1000; i++) {
        const n = b * 1000 + i;
        const cid = couponIds[n % 50000];
        const vid = randomUUID();
        const code = `PERF${String(n % 50000).padStart(6, '0')}`;
        const at = new Date(Date.now() - (n % 120) * 86400000);
        conv.push([vid, perf.id, 'LIVE', perf.programId, perf.affiliateId, `${fx.prefix}-AE-${n}`, `perf-cust-${n % 9000}`, 90000, 'INR', 'APPROVED', JSON.stringify({ couponCode: code }), at, at]);
        if (hasRed) red.push([randomUUID(), perf.id, cid, code, vid, `${fx.prefix}-AE-${n}`, perf.affiliateId, perf.programId, `id:perf-cust-${n % 9000}`, 90000, 10000, 100000, 'INR', 'PERCENTAGE', 10, 'ACTIVE', at, at]);
      }
      await conn.query(`INSERT INTO conversions (id, organizationId, environment, programId, affiliateId, externalId, customerExternalId, amount, currency, status, metadata, occurredAt, createdAt) VALUES ?`, [conv]);
      if (hasRed) await conn.query(`INSERT INTO organization_coupon_redemptions (id, organizationId, couponId, couponCode, conversionId, orderExternalId, affiliateId, programId, customerKey, orderAmount, discountAmount, grossAmount, currency, discountType, discountValue, status, occurredAt, createdAt) VALUES ?`, [red]);
    }
    if (hasRed) await conn.query(`INSERT INTO organization_coupon_usage (couponId, organizationId, redemptionCount) SELECT couponId, organizationId, COUNT(*) FROM organization_coupon_redemptions WHERE organizationId=? GROUP BY couponId, organizationId ON DUPLICATE KEY UPDATE redemptionCount=VALUES(redemptionCount)`, [perf.id]);
    proof.note(`inserted 50,000 coupons + ${USES} conversions${hasRed ? ` + ${USES} redemption rows` : ''} in ${Date.now() - t0} ms (direct SQL)`);
  }
  if (hasRed) {
    const [{ n: reds }] = await sql(`SELECT COUNT(*) n FROM organization_coupon_redemptions WHERE organizationId=?`, [perf.id]);
    if (Number(reds) < USES) {
      // conversions were inserted before the redemption table existed: derive the use rows directly in SQL
      await conn.query(`INSERT INTO organization_coupon_redemptions (id, organizationId, couponId, couponCode, conversionId, orderExternalId, affiliateId, programId, customerKey, orderAmount, discountAmount, grossAmount, currency, discountType, discountValue, status, occurredAt, createdAt)
        SELECT UUID(), v.organizationId, c.id, c.code, v.id, v.externalId, v.affiliateId, v.programId, CONCAT('id:', v.customerExternalId), v.amount, 10000, 100000, 'INR', 'PERCENTAGE', 10, 'ACTIVE', v.occurredAt, v.occurredAt
        FROM conversions v JOIN organization_coupons c ON c.organizationId = v.organizationId AND c.normalizedCode = JSON_UNQUOTE(JSON_EXTRACT(v.metadata, '$.couponCode'))
        WHERE v.organizationId = ? AND v.externalId LIKE ? AND NOT EXISTS (SELECT 1 FROM organization_coupon_redemptions r WHERE r.conversionId = v.id)`, [perf.id, `${fx.prefix}-AE-%`]);
      await conn.query(`INSERT INTO organization_coupon_usage (couponId, organizationId, redemptionCount) SELECT couponId, organizationId, COUNT(*) FROM organization_coupon_redemptions WHERE organizationId=? GROUP BY couponId, organizationId ON DUPLICATE KEY UPDATE redemptionCount=VALUES(redemptionCount)`, [perf.id]);
      proof.note('derived redemption rows for the directly-inserted conversions (direct SQL)');
    }
  }
  const counts = await sql(`SELECT (SELECT COUNT(*) FROM organization_coupons WHERE organizationId=?) coupons, (SELECT COUNT(*) FROM conversions WHERE organizationId=?) sales`, [perf.id, perf.id]);
  proof.sql('SELECT COUNT(*) coupons, COUNT(*) sales for org-perf', counts);
  const rssBefore = execSync(`ps -o rss= -p $(pgrep -f "^node dist/src/main.js" | head -1)`).toString().trim();
  const t0 = Date.now();
  execSync(`${__dirname}/../scripts/restart-backend.sh`, { stdio: 'ignore' });
  const bootMs = Date.now() - t0;
  const rssAfter = execSync(`ps -o rss= -p $(pgrep -f "^node dist/src/main.js" | head -1)`).toString().trim();
  proof.note(`backend restart (dbStore loads everything into memory): ${bootMs} ms; RSS before ${Number(rssBefore) / 1024 | 0} MB → after ${Number(rssAfter) / 1024 | 0} MB. Reads are served from memory (dbStore), not from MySQL.`);
  const { loginWorkspaceUser } = await import('../lib/actors');
  const tok = (await loginWorkspaceUser(fx.users.ORG_PERF_OWNER.email)).token;
  const measure = async (label: string, run: (i: number) => Promise<{ status: number }>, limit: number) => {
    const ms: number[] = [];
    const st: number[] = [];
    for (let i = 0; i < 20; i++) {
      const s = performance.now();
      const r = await run(i);
      ms.push(performance.now() - s);
      st.push(r.status);
      if (r.status === 0 || ms[ms.length - 1] > 30_000) break; // pathological: record and stop
    }
    const res = { label, runs: ms.length, p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), limit, statuses: [...new Set(st)] };
    proof.note(`| ${label} (${res.runs} runs) | ${res.p50} | ${res.p95} | ${limit} | ${res.statuses.join('/')} |`);
    return res;
  };
  proof.note('| request | p50 ms | p95 ms | limit p95 ms | HTTP |\n|---|---|---|---|---|');
  const results = [
    await measure('list first page (page=1&limit=20)', () => api('GET', orgPath(perf.id, '?page=1&limit=20'), { token: tok }), 1000),
    await measure('list late page (page=2400&limit=20)', () => api('GET', orgPath(perf.id, '?page=2400&limit=20'), { token: tok }), 1000),
    await measure('code search (search=PERF0499)', () => api('GET', orgPath(perf.id, '?page=1&limit=20&search=PERF0499'), { token: tok }), 1000),
    await measure('filter status=PAUSED&discountType=FIXED_AMOUNT', () => api('GET', orgPath(perf.id, '?page=1&limit=20&status=PAUSED&discountType=FIXED_AMOUNT'), { token: tok }), 1000),
    await measure('code check GET /validate/:code', (i) => api('GET', orgPath(perf.id, `/validate/PERF${String(i * 997).padStart(6, '0')}`), { token: tok }), 300),
    await measure('checkout sale with coupon POST /conversions', (i) => recordSale(perf.apiKey, { externalId: `${fx.prefix}-AE-live-${Date.now()}-${i}`, customerExternalId: `perf-live-${i}`, amount: 90000, currency: 'INR', metadata: { couponCode: `PERF${String(1 + i * 13).padStart(6, '0')}` } }), 1000),
    await measure('analytics overview LIFETIME', () => api('GET', orgPath(perf.id, '/analytics/overview?period=LIFETIME'), { token: tok, timeoutMs: 60_000 }), 2000),
  ];
  const slow = results.filter((r) => r.p95 > r.limit || r.statuses.some((s) => s >= 400)).map((r) => `${r.label}: p95 ${r.p95} > ${r.limit} or HTTP ${r.statuses}`);
  proof.check('all within limits and 2xx', slow, []);
  expect(slow).toEqual([]);
});
