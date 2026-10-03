import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { countCoupons, F, orgPath } from '../lib/coupons';
import { closeDb, eventually, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';

/** W (+X for create) — bad JSON, wrong types, out-of-range values, injection text, and fields that must not be accepted. */
const proof = new Proof('W');
const f = F();
const P = `E2E-CPN-${f.run}-W`;
const base = (n: number) => ({ code: `${P}-${n}`, name: `${f.prefix} W ${n}`, discountType: 'PERCENTAGE', discountValue: 10 });

test.afterAll(async () => {
  await closeDb();
});

async function expectNothingSaved(owner: { token: string }, name: string, codeLike: string) {
  const rows = await sql(`SELECT id, code FROM organization_coupons WHERE organizationId=? AND (name=? OR normalizedCode LIKE ?)`, [f.orgA.id, name, codeLike]);
  proof.sql(`SELECT id, code FROM organization_coupons WHERE organizationId='${f.orgA.id}' AND (name='${name}' OR normalizedCode LIKE '${codeLike}')`, rows);
  const list = (await api('GET', orgPath(f.orgA.id), { token: owner.token })).data as any[];
  const inList = list.filter((c) => c.name === name || c.code.toUpperCase().startsWith(codeLike.replace('%', '')));
  proof.check('SQL rows', rows.length, 0);
  proof.check('GET list rows', inList.length, 0);
  expect(rows.length).toBe(0);
  expect(inList.length).toBe(0);
}

const cases: [string, (n: number) => unknown, number][] = [
  ['discountValue negative', (n) => ({ ...base(n), discountValue: -5 }), 400],
  ['discountValue zero', (n) => ({ ...base(n), discountValue: 0 }), 400],
  ['percentage over 100', (n) => ({ ...base(n), discountValue: 101 }), 400],
  ['percentage huge', (n) => ({ ...base(n), discountValue: 1e12 }), 400],
  ['fixed amount huge (> ₹1,00,00,000)', (n) => ({ ...base(n), discountType: 'FIXED_AMOUNT', discountValue: 1e9 }), 400],
  ['discountValue string', (n) => ({ ...base(n), discountValue: 'ten' }), 400],
  ['discountValue NaN-ish', (n) => ({ ...base(n), discountValue: 'NaN' }), 400],
  ['discountType unknown', (n) => ({ ...base(n), discountType: 'BOGO' }), 400],
  ['maxRedemptions negative', (n) => ({ ...base(n), maxRedemptions: -1 }), 400],
  ['maxRedemptions zero', (n) => ({ ...base(n), maxRedemptions: 0 }), 400],
  ['maxRedemptions fractional', (n) => ({ ...base(n), maxRedemptions: 1.5 }), 400],
  ['validFrom invalid date', (n) => ({ ...base(n), validFrom: '2026-13-45' }), 400],
  ['validUntil not a date', (n) => ({ ...base(n), validUntil: 'tomorrow' }), 400],
  ['end before start', (n) => ({ ...base(n), validFrom: '2026-11-10', validUntil: '2026-11-01' }), 400],
  ['affiliateIds not uuid', (n) => ({ ...base(n), affiliateIds: ['abc'] }), 400],
  ['affiliateIds unknown uuid (X: coupon must not be left behind)', (n) => ({ ...base(n), affiliateIds: ['00000000-0000-4000-8000-000000000000'] }), 404],
  ['affiliateIds Org B affiliate (X)', (n) => ({ ...base(n), affiliateIds: [f.orgB.affiliates[0].id] }), 404],
  ['name too long (> 160, DB column)', (n) => ({ ...base(n), name: `${f.prefix} W ${n} ` + 'n'.repeat(200) }), 400],
  ['description too long (> 2000)', (n) => ({ ...base(n), description: 'd'.repeat(5000) }), 400],
  ['extra field organizationId', (n) => ({ ...base(n), organizationId: f.orgB.id }), 400],
  ['extra field affiliateId', (n) => ({ ...base(n), affiliateId: f.orgA.affiliates[0].id }), 400],
  ['extra field usageCount', (n) => ({ ...base(n), usageCount: 99 }), 400],
  ['extra field redemptionCount', (n) => ({ ...base(n), redemptionCount: 99 }), 400],
  ['extra field status', (n) => ({ ...base(n), status: 'ARCHIVED' }), 400],
  ['extra field createdAt', (n) => ({ ...base(n), createdAt: '2020-01-01T00:00:00Z' }), 400],
  ['extra field id', (n) => ({ ...base(n), id: '11111111-1111-4111-8111-111111111111' }), 400],
  ['SQL injection in code', (n) => ({ ...base(n), code: `${P}-${n}'; DROP TABLE organization_coupons;--` }), 400],
];

cases.forEach(([label, make, expected], i) => {
  test(`W${i + 1} ${label}`, async () => {
    const owner = await as('ORG_A_OWNER');
    const body = make(100 + i) as any;
    const r = await api('POST', orgPath(f.orgA.id), { token: owner.token, body });
    proof.h(`W${i + 1} ${label}`);
    proof.http('POST', orgPath(f.orgA.id), r, JSON.stringify(body).slice(0, 400));
    proof.check('status', r.status, expected);
    expect(r.status).toBe(expected);
    await expectNothingSaved(owner, body.name, `${P}-${100 + i}%`);
  });
});

test('W-json malformed JSON body', async () => {
  const owner = await as('ORG_A_OWNER');
  const raw = `{"code":"${P}-JSON","name":"${f.prefix} W json",`;
  const r = await api('POST', orgPath(f.orgA.id), { token: owner.token, rawBody: raw });
  proof.h('W malformed JSON');
  proof.http('POST', orgPath(f.orgA.id), r, raw);
  proof.check('status', r.status, 400);
  expect(r.status).toBe(400);
  await expectNothingSaved(owner, `${f.prefix} W json`, `${P}-JSON%`);
});

test('W-sql SQL injection in name/description is stored as plain text, table intact', async () => {
  const owner = await as('ORG_A_OWNER');
  const body = { code: `${P}-INJ`, name: `${f.prefix} W x' OR '1'='1`, description: `"); DELETE FROM organization_coupons; --`, discountType: 'PERCENTAGE', discountValue: 5 };
  const r = await api('POST', orgPath(f.orgA.id), { token: owner.token, body });
  proof.h('W SQL injection text in name/description');
  proof.http('POST', orgPath(f.orgA.id), r, body);
  const row = await eventually(async () => (await sql(`SELECT name, description FROM organization_coupons WHERE organizationId=? AND normalizedCode=?`, [f.orgA.id, `${P}-INJ`]))[0]);
  const total = await countCoupons(f.orgA.id, `E2E-CPN-${f.run}-%`);
  proof.sql(`SELECT name, description FROM organization_coupons WHERE normalizedCode='${P}-INJ'`, row);
  proof.sql(`SELECT COUNT(*) FROM organization_coupons WHERE normalizedCode LIKE 'E2E-CPN-${f.run}-%'`, total);
  expect(r.status).toBe(201);
  expect(row?.name).toBe(body.name);
  expect(row?.description).toBe(body.description);
  expect(total).toBeGreaterThanOrEqual(12);
});

test('W-invalid-id invalid coupon IDs on read/update/status', async () => {
  const owner = await as('ORG_A_OWNER');
  for (const id of ['not-a-uuid', '00000000-0000-4000-8000-000000000000', "1' OR '1'='1"]) {
    const enc = encodeURIComponent(id);
    for (const [m, path, body] of [
      ['GET', orgPath(f.orgA.id, `/${enc}`), undefined],
      ['PUT', orgPath(f.orgA.id, `/${enc}`), { name: 'x-renamed' }],
      ['POST', orgPath(f.orgA.id, `/${enc}/status`), { status: 'PAUSED' }],
    ] as const) {
      const r = await api(m, path, { token: owner.token, body });
      proof.h(`W invalid id ${m} ${id}`);
      proof.http(m, path, r, body);
      proof.check('status', r.status, 404);
      expect(r.status).toBe(404);
    }
  }
});
