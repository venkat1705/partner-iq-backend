import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb, eventually, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';

/** F — 10 concurrent creates with the same code (and 10 with different-case variants): exactly one coupon. */
const proof = new Proof('F');
const f = F();
const P = `E2E-CPN-${f.run}-F`;

test.afterAll(async () => {
  await closeDb();
});

for (const [label, variant] of [['identical code', (i: number) => `${P}-RACE`], ['case/space variants', (i: number) => (i % 2 ? `${P}-race2` : ` ${P}-RACE2 `)]] as const) {
  test(`F ${label}`, async () => {
    const owner = await as('ORG_A_OWNER');
    const norm = variant === undefined ? '' : variant(0).trim().toUpperCase();
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => api('POST', orgPath(f.orgA.id), { token: owner.token, body: { code: variant(i), name: `${f.prefix} F ${label} ${i}`, discountType: 'PERCENTAGE', discountValue: 10 } })),
    );
    proof.h(`F ${label}: 10 parallel POST`);
    rs.forEach((r, i) => proof.http('POST', orgPath(f.orgA.id), r, { code: variant(i) }));
    const statuses = rs.map((r) => r.status).sort();
    const rows = await eventually(async () => {
      const x = await sql(`SELECT id, code FROM organization_coupons WHERE organizationId=? AND normalizedCode=?`, [f.orgA.id, norm]);
      return x.length ? x : null;
    });
    proof.sql(`SELECT id, code FROM organization_coupons WHERE normalizedCode='${norm}'`, rows);
    const list = (await api('GET', orgPath(f.orgA.id), { token: owner.token })).data.filter((c: any) => c.code.trim().toUpperCase() === norm);
    proof.check('201 count', statuses.filter((s) => s === 201).length, 1);
    proof.check('409 count', statuses.filter((s) => s === 409).length, 9);
    proof.check('SQL rows', rows?.length, 1);
    proof.check('GET list rows', list.length, 1);
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(9);
    expect(rows?.length).toBe(1);
    expect(list.length).toBe(1);
  });
}
