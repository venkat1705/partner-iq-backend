import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { countCoupons, F, orgPath } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';

/**
 * E — code rules and duplicates. Rules (docs/decisions.md D3): trimmed, case-insensitive, stored uppercase,
 * ASCII A-Z 0-9 - _ only, 2..40 chars, unique per organization (archived codes included), duplicate → 409.
 * After every rejected request: nothing in GET /coupons and nothing in SQL.
 */
const proof = new Proof('E');
const f = F();
const P = `E2E-CPN-${f.run}-E`;

async function listCodes(token: string) {
  const r = await api('GET', orgPath(f.orgA.id), { token });
  return (r.data as any[]).map((c) => c.code as string);
}

test.afterAll(async () => {
  proof.flush();
  await closeDb();
});

test('E1 SHOW CREATE TABLE organization_coupons', async () => {
  const [row] = await sql<any>('SHOW CREATE TABLE organization_coupons');
  proof.sql('SHOW CREATE TABLE organization_coupons', row['Create Table']);
  expect(row['Create Table']).toContain('UNIQUE KEY');
  expect(row['Create Table']).toMatch(/UNIQUE KEY `[^`]+` \(`organizationId`,`normalizedCode`\)/);
});

const rejected: [string, unknown, number][] = [
  ['empty code', '', 400],
  ['whitespace only', '   ', 400],
  ['one character', 'A', 400],
  ['41 characters (too long)', `${P}-` + 'X'.repeat(41 - P.length - 1), 400],
  ['61 characters (over DB column)', `${P}-` + 'Y'.repeat(61 - P.length - 1), 400],
  ['invalid characters %', `${P}-50%OFF`, 400],
  ['invalid characters quote', `${P}-O'NEIL`, 400],
  ['inner space', `${P}-SUM 20`, 400],
  ['emoji', `${P}-🎉`, 400],
  ['leading hyphen (spreadsheet formula prefix)', `-${P}`, 400],
  ['leading underscore', `_${P}`, 400],
  ['Cyrillic А look-alike', `${P}-SАVE`, 400],
  ['Greek Ο look-alike', `${P}-SΟLO`, 400],
  ['number instead of string', 12345, 400],
];

for (const [label, codeValue, expected] of rejected) {
  test(`E2 reject ${label}`, async () => {
    const owner = await as('ORG_A_OWNER');
    const before = await countCoupons(f.orgA.id, `${P}%`);
    const body = { code: codeValue, name: `${f.prefix} E ${label}`, discountType: 'PERCENTAGE', discountValue: 10 };
    const r = await api('POST', orgPath(f.orgA.id), { token: owner.token, body });
    proof.h(`E2 ${label}`);
    proof.http('POST', orgPath(f.orgA.id), r, body);
    const after = await countCoupons(f.orgA.id, `${P}%`);
    const rows = await sql(`SELECT id, code FROM organization_coupons WHERE organizationId=? AND name=?`, [f.orgA.id, body.name]);
    proof.sql(`SELECT id, code FROM organization_coupons WHERE organizationId='${f.orgA.id}' AND name='${body.name}'`, rows);
    const inList = (await api('GET', orgPath(f.orgA.id), { token: owner.token })).data.filter((c: any) => c.name === body.name);
    proof.check('status', r.status, expected);
    proof.check('rows saved for this name (SQL)', rows.length, 0);
    proof.check('coupons with spec prefix unchanged (SQL)', after, before);
    proof.check('in GET list', inList.length, 0);
    expect(r.status).toBe(expected);
    expect(rows.length).toBe(0);
    expect(after).toBe(before);
    expect(inList.length).toBe(0);
  });
}

test('E3 trim + uppercase normalisation, then duplicates (same, other case, archived)', async () => {
  const owner = await as('ORG_A_OWNER');
  const raw = `  ${P}-trim-me  `;
  const body = { code: raw, name: `${f.prefix} E trim`, discountType: 'PERCENTAGE', discountValue: 10 };
  const r = await api('POST', orgPath(f.orgA.id), { token: owner.token, body });
  proof.h('E3 create with spaces at ends and lower case');
  proof.http('POST', orgPath(f.orgA.id), r, body);
  const row = (await sql(`SELECT code, normalizedCode FROM organization_coupons WHERE organizationId=? AND name=?`, [f.orgA.id, body.name]))[0];
  proof.sql(`SELECT code, normalizedCode FROM organization_coupons WHERE name='${body.name}'`, row);
  proof.check('status', r.status, 201);
  proof.check('stored code', row?.code, `${P}-TRIM-ME`);
  proof.check('stored normalizedCode', row?.normalizedCode, `${P}-TRIM-ME`);
  expect(r.status).toBe(201);
  expect(row?.code).toBe(`${P}-TRIM-ME`);
  expect(row?.normalizedCode).toBe(`${P}-TRIM-ME`);

  for (const [label, dup] of [['exact duplicate', `${P}-TRIM-ME`], ['duplicate different case', `${P}-trim-ME`.toLowerCase()]] as const) {
    const d = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { ...body, code: dup, name: `${f.prefix} E ${label}` } });
    proof.h(`E3 ${label}`);
    proof.http('POST', orgPath(f.orgA.id), d, { ...body, code: dup });
    const n = await countCoupons(f.orgA.id, `${P}-TRIM-ME`);
    proof.sql(`SELECT COUNT(*) FROM organization_coupons WHERE normalizedCode='${P}-TRIM-ME'`, n);
    proof.check('status', d.status, 409);
    proof.check('rows with that code', n, 1);
    expect(d.status).toBe(409);
    expect(n).toBe(1);
  }

  // archived code cannot be reused (decisions D9)
  const archive = await api('POST', orgPath(f.orgA.id, `/${r.data.id}/status`), { token: owner.token, body: { status: 'ARCHIVED' } });
  expect(archive.status).toBe(201);
  const reuse = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { ...body, name: `${f.prefix} E reuse` } });
  proof.h('E3 reuse archived code');
  proof.http('POST', orgPath(f.orgA.id), reuse, body);
  proof.check('status', reuse.status, 409);
  expect(reuse.status).toBe(409);
  expect(await countCoupons(f.orgA.id, `${P}-TRIM-ME`)).toBe(1);
});

test('E4 same code allowed in another organization', async () => {
  const shared = f.orgA.coupons.SHARED.code;
  const rows = await sql(`SELECT organizationId, code FROM organization_coupons WHERE normalizedCode=?`, [shared]);
  proof.h('E4 same code in Org A and Org B (seeded via API)');
  proof.sql(`SELECT organizationId, code FROM organization_coupons WHERE normalizedCode='${shared}'`, rows);
  proof.check('orgs holding code', rows.map((r: any) => r.organizationId).sort(), [f.orgA.id, f.orgB.id].sort());
  expect(rows.map((r: any) => r.organizationId).sort()).toEqual([f.orgA.id, f.orgB.id].sort());
});

test('E5 look-alike Latin codes (O vs 0, I vs l) are distinct codes and both accepted', async () => {
  const owner = await as('ORG_A_OWNER');
  const a = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { code: `${P}-B0OK`, name: `${f.prefix} E look1`, discountType: 'PERCENTAGE', discountValue: 5 } });
  const b = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { code: `${P}-BOOK`, name: `${f.prefix} E look2`, discountType: 'PERCENTAGE', discountValue: 5 } });
  const c = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { code: `${P}-lIST`, name: `${f.prefix} E look3`, discountType: 'PERCENTAGE', discountValue: 5 } });
  proof.h('E5 O vs 0 and l vs I');
  proof.http('POST', orgPath(f.orgA.id), a, { code: `${P}-B0OK` });
  proof.http('POST', orgPath(f.orgA.id), b, { code: `${P}-BOOK` });
  proof.http('POST', orgPath(f.orgA.id), c, { code: `${P}-lIST` });
  const rows = await sql(`SELECT code FROM organization_coupons WHERE organizationId=? AND name LIKE ? ORDER BY code`, [f.orgA.id, `${f.prefix} E look%`]);
  proof.sql(`SELECT code FROM organization_coupons WHERE name LIKE '${f.prefix} E look%'`, rows);
  proof.note('Note: ASCII look-alikes are legal ASCII; ambiguity is avoided by the generator alphabet (scenario G).');
  expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
  expect(rows.map((r: any) => r.code)).toEqual([`${P}-B0OK`, `${P}-BOOK`, `${P}-LIST`]);
});
