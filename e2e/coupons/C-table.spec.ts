import { expect, Page, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';
import { adminLogin, openCoupons } from '../lib/ui';

/** C — table columns vs SQL, search, filters, sort, pagination (admin UI "All Coupons" tab). */
const proof = new Proof('C');
const f = F();
const P = `E2E-CPN-${f.run}-C`;
const [A1, A2] = f.orgA.affiliates;
let created: { id: string; code: string }[] = [];

test.beforeAll(async () => {
  const owner = await as('ORG_A_OWNER');
  // 23 coupons: alternating types, values 1..23, some paused, some with limits, A1/A2 assignments
  for (let i = 1; i <= 23; i++) {
    const body: any = {
      code: `${P}-${String(i).padStart(2, '0')}`,
      name: `${f.prefix} C row ${i}`,
      discountType: i % 2 ? 'PERCENTAGE' : 'FIXED_AMOUNT',
      discountValue: i,
      ...(i % 3 === 0 ? { maxRedemptions: i * 10 } : {}),
      ...(i % 4 === 0 ? { validUntil: '2027-01-15' } : {}),
      affiliateIds: i % 2 ? [A1.id] : [A2.id],
    };
    const existing = (await sql(`SELECT id, code FROM organization_coupons WHERE organizationId=? AND normalizedCode=?`, [f.orgA.id, body.code]))[0];
    if (existing) { created.push({ id: existing.id, code: existing.code }); continue; } // worker restarted after a failure
    const r = await api('POST', orgPath(f.orgA.id), { token: owner.token, body });
    expect(r.status).toBe(201);
    created.push({ id: r.data.id, code: r.data.code });
    if (i % 5 === 0) await api('POST', orgPath(f.orgA.id, `/${r.data.id}/status`), { token: owner.token, body: { status: 'PAUSED' } });
  }
});

test.afterAll(async () => {
  await closeDb();
});

async function rows(page: Page) {
  return page.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
}
async function search(page: Page, q: string) {
  const box = page.getByPlaceholder('Search coupons by code or name...');
  await box.fill(q);
  await page.waitForTimeout(400);
}
const codesIn = (texts: string[]) => texts.map((t) => t.match(/E2E-CPN-[A-Z0-9]+-C-\d\d/)?.[0]).filter(Boolean) as string[];

test('C1 five rows: every column against SQL (API + UI)', async ({ page }) => {
  const owner = await as('ORG_A_OWNER');
  const list = (await api('GET', orgPath(f.orgA.id), { token: owner.token })).data as any[];
  await adminLogin(page, 'ORG_A_OWNER');
  await openCoupons(page, f.orgA.id, '?tab=coupons');
  const pick = [created[0], created[3], created[4], created[11], created[22]];
  for (const c of pick) {
    const db = (await sql(`SELECT c.code, c.name, c.discountType, c.discountValue, c.status, c.maxRedemptions, c.validUntil,
        (SELECT COUNT(*) FROM organization_coupon_assignments a WHERE a.couponId=c.id) assigned
        FROM organization_coupons c WHERE c.id=?`, [c.id]))[0];
    proof.h(`C1 ${c.code}`);
    proof.sql(`SELECT code, name, discountType, discountValue, status, maxRedemptions, validUntil, assigned FROM organization_coupons WHERE id='${c.id}'`, db);
    const apiRow = list.find((x) => x.id === c.id);
    proof.check('API code', apiRow?.code, db.code);
    proof.check('API discount', [apiRow?.discountType, Number(apiRow?.discountValue)], [db.discountType, Number(db.discountValue)]);
    proof.check('API status', apiRow?.status, db.status);
    proof.check('API maxRedemptions', apiRow?.maxRedemptions ?? null, db.maxRedemptions);
    proof.check('API assigned', apiRow?.assignedAffiliates?.length, Number(db.assigned));
    expect(apiRow?.code).toBe(db.code);
    expect(apiRow?.status).toBe(db.status);
    await search(page, c.code);
    const [text] = await rows(page);
    proof.note(`UI row: ${text}`);
    const value = Number(db.discountValue);
    const discountText = db.discountType === 'PERCENTAGE' ? `${value}% OFF` : `₹${value} OFF`;
    const statusText = db.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
    const quota = db.maxRedemptions ? `0 used / ${db.maxRedemptions}` : '0 used Unlimited';
    const until = db.validUntil ? `until ${new Date(db.validUntil).toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' })}` : 'Perpetual';
    for (const [label, want] of [['code', db.code], ['name', db.name], ['discount', discountText], ['status', statusText], ['quota', quota], ['assigned', `${db.assigned} partner`], ['validity', until]]) {
      proof.check(`UI ${label}`, text?.toUpperCase().includes(String(want).toUpperCase()), true);
      expect(text?.toUpperCase(), `${label}: ${want}`).toContain(String(want).toUpperCase());
    }
  }
});

test('C2 search: exact, partial, case, special characters; affiliate filter', async ({ page }) => {
  await adminLogin(page, 'ORG_A_OWNER');
  await openCoupons(page, f.orgA.id, '?tab=coupons');
  const cases: [string, string, number][] = [
    ['exact', `${P}-07`, 1],
    ['partial', `${P}-1`, 10], // -10..-19
    ['different case', `${P}-07`.toLowerCase(), 1],
    ['name partial', `${f.prefix} C row 2`, 5], // row 2, 20, 21, 22, 23
    ['percent sign (no wildcard)', `${P}%`, 0],
    ['underscore (no wildcard)', `${P}_0`, 0],
    ['apostrophe', `${P}'`, 0],
  ];
  for (const [label, q, n] of cases) {
    await search(page, q);
    const r = await rows(page);
    const got = codesIn(r).length;
    proof.h(`C2 search ${label}: "${q}"`);
    proof.note(`UI rows: ${JSON.stringify(codesIn(r))}`);
    proof.check('matching rows (page 1, ≤10)', got, Math.min(n, 10));
    expect(got).toBe(Math.min(n, 10));
  }
  // header affiliate filter must narrow the table to coupons assigned to that affiliate
  await search(page, P);
  await page.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: A2.displayName }).click();
  await page.waitForTimeout(800);
  await page.getByRole('tab', { name: /All Coupons/ }).click();
  const shown = await page.getByText(/Showing \d+ coupons/).innerText();
  proof.h('C2 affiliate filter A2');
  proof.note(`UI: ${shown}`);
  const expected = (await sql(`SELECT COUNT(*) n FROM organization_coupon_assignments a JOIN organization_coupons c ON c.id=a.couponId WHERE a.affiliateId=? AND c.organizationId=?`, [A2.id, f.orgA.id]))[0].n;
  proof.sql(`SELECT COUNT(*) FROM organization_coupon_assignments a JOIN organization_coupons c ... WHERE a.affiliateId='${A2.id}'`, expected);
  proof.check('Showing N (affiliate A2)', shown, `Showing ${expected} coupons`);
  expect(shown).toBe(`Showing ${expected} coupons`);
  proof.note('Program filter on the table: N/A — organization coupons are not linked to programs (inventory R12).');
});

test('C3 status + discount filters and 3 combinations vs SQL', async ({ page }) => {
  await adminLogin(page, 'ORG_A_OWNER');
  await openCoupons(page, f.orgA.id, '?tab=coupons');
  const now = new Date();
  const all = await sql(`SELECT code, status, discountType, validUntil FROM organization_coupons WHERE organizationId=?`, [f.orgA.id]);
  const isExpired = (c: any) => c.validUntil && new Date(c.validUntil) < now;
  const effective = (c: any) => (isExpired(c) ? 'EXPIRED' : c.status);
  const combos: [string, string][] = [['ACTIVE', 'ALL'], ['PAUSED', 'ALL'], ['EXPIRED', 'ALL'], ['ARCHIVED', 'ALL'], ['ALL', 'PERCENTAGE'], ['ALL', 'FIXED_AMOUNT'], ['ACTIVE', 'PERCENTAGE'], ['PAUSED', 'FIXED_AMOUNT'], ['ARCHIVED', 'FIXED_AMOUNT']];
  const label: Record<string, string> = { ALL: 'All', ACTIVE: 'Active', PAUSED: 'Paused', EXPIRED: 'Expired', ARCHIVED: 'Archived', PERCENTAGE: 'Percentage (%)', FIXED_AMOUNT: 'Fixed Amount' };
  for (const [st, dt] of combos) {
    await page.getByRole('combobox').nth(2).click();
    await page.getByRole('option', { name: st === 'ALL' ? 'All Statuses' : label[st], exact: true }).click();
    await page.getByRole('combobox').nth(3).click();
    await page.getByRole('option', { name: dt === 'ALL' ? 'All Types' : label[dt], exact: true }).click();
    const shown = await page.getByText(/Showing \d+ coupons/).innerText();
    const expected = all.filter((c: any) => (st === 'ALL' || effective(c) === st) && (dt === 'ALL' || c.discountType === dt)).length;
    proof.h(`C3 status=${st} type=${dt}`);
    proof.check('Showing N', shown, `Showing ${expected} coupons`);
    expect(shown).toBe(`Showing ${expected} coupons`);
  }
});

test('C4 sort both directions + first/partial/last page', async ({ page }) => {
  await adminLogin(page, 'ORG_A_OWNER');
  await openCoupons(page, f.orgA.id, '?tab=coupons');
  await search(page, P);
  const header = (name: string) => page.locator('th', { hasText: name });
  for (const [col, key] of [['Coupon Code & Name', 'code'], ['Discount Concession', 'value']] as const) {
    for (const dir of ['asc', 'desc']) {
      await header(col).click();
      const got = codesIn(await rows(page));
      const sorted = [...created]
        .map((c, i) => ({ code: c.code, value: i + 1 }))
        .sort((a, b) => (key === 'code' ? a.code.localeCompare(b.code) : a.value - b.value) * (dir === 'asc' ? 1 : -1))
        .slice(0, 10)
        .map((x) => x.code);
      proof.h(`C4 sort ${col} ${dir}`);
      proof.check('page 1 order', got, sorted);
      expect(got).toEqual(sorted);
    }
  }
  const pageInfo = async () => (await page.getByText(/Page \d+ of \d+/).innerText()).replace(/\s+/g, ' ');
  proof.h('C4 pagination (23 rows, 10 per page)');
  proof.check('first page rows', codesIn(await rows(page)).length, 10);
  expect(codesIn(await rows(page)).length).toBe(10);
  proof.check('page info', await pageInfo(), 'Page 1 of 3');
  expect(await pageInfo()).toBe('Page 1 of 3');
  await page.getByRole('button', { name: 'Last Page' }).click();
  proof.check('last page rows', codesIn(await rows(page)).length, 3);
  expect(codesIn(await rows(page)).length).toBe(3);
  await page.getByRole('button', { name: 'Previous Page' }).click();
  proof.check('middle page rows', codesIn(await rows(page)).length, 10);
  expect(await pageInfo()).toBe('Page 2 of 3');
});
