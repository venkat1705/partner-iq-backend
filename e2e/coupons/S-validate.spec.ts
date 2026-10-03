import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb } from '../lib/db';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';

/**
 * S — code-checking endpoint. Only one exists: GET /organizations/:id/coupons/validate/:code (JWT + coupons.view,
 * the admin "Validate Code" dialog). No public/checkout code-check endpoint exists. Decision D13: the admin tool keeps
 * its distinct reasons (the same user can already list every coupon), but it must be org-scoped, permission-gated,
 * rate-limited, and must not expose assigned affiliates' emails or internal fields.
 */
const proof = new Proof('S');
const f = F();
test.afterAll(async () => closeDb());

test('S1 responses for missing / expired / paused / valid codes', async () => {
  const owner = await as('ORG_A_OWNER');
  for (const [label, code] of [['missing', 'E2E-CPN-NOPE-404'], ['expired', f.orgA.coupons.EXPIRED.code], ['paused', f.orgA.coupons.PAUSED.code], ['valid', f.orgA.coupons.PCT10.code]]) {
    const r = await api('GET', orgPath(f.orgA.id, `/validate/${encodeURIComponent(code)}`), { token: owner.token });
    proof.h(`S1 ${label}`);
    proof.http('GET', orgPath(f.orgA.id, `/validate/${code}`), r);
    expect(r.status).toBe(200);
    const s = JSON.stringify(r.body);
    proof.check('no affiliate email in response', s.includes('@example.test'), false);
    expect(s.includes('@example.test')).toBe(false);
  }
});

test('S2 other organizations / roles cannot probe Org A codes', async () => {
  for (const [role, expected] of [['ORG_B_OWNER', 403], ['ORG_A_NOPERM', 403]] as const) {
    const s = await as(role);
    const r = await api('GET', orgPath(f.orgA.id, `/validate/${f.orgA.coupons.PCT10.code}`), { token: s.token });
    proof.h(`S2 ${role}`);
    proof.http('GET', orgPath(f.orgA.id, '/validate/<A code>'), r);
    expect(r.status).toBe(expected);
  }
  const b = await as('ORG_B_OWNER');
  const r = await api('GET', orgPath(f.orgB.id, `/validate/${f.orgA.coupons.PCT10.code}`), { token: b.token });
  proof.http('GET', orgPath(f.orgB.id, '/validate/<Org A-only code>'), r);
  proof.check('Org B sees Org A-only code as missing', r.data?.isValid, false);
  expect(r.data?.isValid).toBe(false);
  expect(JSON.stringify(r.body)).not.toContain(f.orgA.coupons.PCT10.id);
});

test('S3 rapid guessing is rate limited', async () => {
  const owner = await as('ORG_A_OWNER');
  const statuses: number[] = [];
  for (let i = 0; i < 70; i++) {
    const r = await api('GET', orgPath(f.orgA.id, `/validate/GUESS${i}`), { token: owner.token });
    statuses.push(r.status);
  }
  proof.h('S3 70 guesses in a row');
  proof.note(`statuses: ${statuses.join(',')}`);
  const limited = statuses.filter((s) => s === 429).length;
  proof.check('some requests got 429', limited > 0, true);
  expect(limited).toBeGreaterThan(0);
});
