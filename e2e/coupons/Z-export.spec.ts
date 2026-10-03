import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';
import { adminLogin, openCoupons } from '../lib/ui';

/**
 * Z — "Export CSV" on the All Coupons table (client-side DataTable export of the filtered rows).
 * Rows must equal SQL for the same filter; cells starting with = + - @ must be neutralised; commas, quotes, line
 * breaks, ₹ é 中文 must survive; only this organization's data.
 */
const proof = new Proof('Z');
const f = F();
const P = `E2E-CPN-${f.run}-Z`;
test.afterAll(async () => closeDb());

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('Z export matches SQL, is formula-safe and keeps special characters', async ({ page }) => {
  const owner = await as('ORG_A_OWNER');
  const evil = [`=HYPERLINK("http://evil","x")`, `+SUM(1,2)`, `-2+3`, `@cmd`, `Plain, "quoted" ₹ é 中文\nnew line`];
  for (let i = 0; i < evil.length; i++) {
    const r = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { code: `${P}-${i}`, name: evil[i], description: evil[i], discountType: 'PERCENTAGE', discountValue: 5 + i } });
    expect(r.status).toBe(201);
  }
  await adminLogin(page, 'ORG_A_OWNER');
  await openCoupons(page, f.orgA.id, '?tab=coupons');
  await page.getByPlaceholder('Search coupons by code or name...').fill(P);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export filtered table rows to CSV' }).click();
  const file = await (await dl).path();
  const raw = fs.readFileSync(file!, 'utf8');
  proof.h('Z exported file (raw)');
  proof.note(raw);
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const rows = parseCsv(raw.replace(/^﻿/, ''));
  const header = rows[0];
  const body = rows.slice(1).filter((r) => r.length > 1);
  const dbRows = await sql(`SELECT code, name, discountValue FROM organization_coupons WHERE organizationId=? AND normalizedCode LIKE ? ORDER BY code`, [f.orgA.id, `${P}-%`]);
  proof.sql(`SELECT code, name, discountValue FROM organization_coupons WHERE normalizedCode LIKE '${P}-%'`, dbRows);
  const codeCol = header.findIndex((h) => /code/i.test(h));
  const nameCol = header.findIndex((h) => /^name$/i.test(h));
  proof.check('UTF-8 BOM present (Excel shows ₹ é 中文)', hasBom, true);
  proof.check('row count == SQL', body.length, dbRows.length);
  proof.check('codes == SQL', body.map((r) => r[codeCol]).sort(), dbRows.map((r: any) => r.code).sort());
  proof.check('has Name column', nameCol >= 0, true);
  const unsafe = body.flatMap((r) => r).filter((cell) => /^[=+\-@\t\r]/.test(cell));
  proof.check('cells starting with = + - @', unsafe, []);
  const special = body.find((r) => r[nameCol]?.includes('中文'));
  proof.check('special characters preserved', special?.[nameCol], evil[4]);
  const other = raw.includes(f.orgB.id) || raw.includes(f.orgB.coupons.BONLY.code);
  proof.check('other org data in file', other, false);
  expect(hasBom).toBe(true);
  expect(body.length).toBe(dbRows.length);
  expect(body.map((r) => r[codeCol]).sort()).toEqual(dbRows.map((r: any) => r.code).sort());
  expect(nameCol).toBeGreaterThanOrEqual(0);
  expect(unsafe).toEqual([]);
  expect(special?.[nameCol]).toBe(evil[4]);
  expect(other).toBe(false);
});
