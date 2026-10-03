import { expect, test } from '@playwright/test';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb, eventually, sql } from '../lib/db';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';

/** AD — every create / edit / status change / move / archive writes audit_logs with who, org, coupon, before/after, when. */
const proof = new Proof('AD');
const f = F();
const P = `E2E-CPN-${f.run}-AD`;
const [A1, A2] = f.orgA.affiliates;
test.afterAll(async () => closeDb());

test('AD audit rows', async () => {
  const m = await as('ORG_A_MANAGER');
  const owner = await as('ORG_A_OWNER');
  const t0 = new Date(Date.now() - 1000);
  const c = await api('POST', orgPath(f.orgA.id), { token: m.token, body: { code: `${P}-1`, name: `${f.prefix} AD before`, discountType: 'PERCENTAGE', discountValue: 10, maxRedemptions: 5, affiliateIds: [A1.id] } });
  expect(c.status).toBe(201);
  const id = c.data.id;
  await api('PUT', orgPath(f.orgA.id, `/${id}`), { token: m.token, body: { name: `${f.prefix} AD after`, discountValue: 15 } });
  await api('POST', orgPath(f.orgA.id, `/${id}/status`), { token: m.token, body: { status: 'PAUSED' } });
  await api('DELETE', orgPath(f.orgA.id, `/${id}/assign/${A1.id}`), { token: m.token });
  await api('POST', orgPath(f.orgA.id, `/${id}/assign`), { token: m.token, body: { affiliateIds: [A2.id] } });
  await api('POST', orgPath(f.orgA.id, `/${id}/status`), { token: owner.token, body: { status: 'ARCHIVED' } });
  const rows = await eventually(async () => {
    const r = await sql(`SELECT action, actorId, organizationId, resourceType, resourceId, metadata, createdAt FROM audit_logs WHERE resourceId=? ORDER BY createdAt, action`, [id]);
    return r.length >= 7 ? r : null;
  }, 5000) || await sql(`SELECT action, actorId, organizationId, resourceType, resourceId, metadata, createdAt FROM audit_logs WHERE resourceId=? ORDER BY createdAt`, [id]);
  proof.sql(`SELECT action, actorId, organizationId, resourceType, resourceId, metadata, createdAt FROM audit_logs WHERE resourceId='${id}'`, rows);
  const by = (a: string) => rows.filter((r: any) => r.action === a);
  const meta = (r: any) => (typeof r?.metadata === 'string' ? JSON.parse(r.metadata) : r?.metadata) || {};
  const expectations: [string, boolean][] = [
    ['COUPON_CREATED by manager with code/type/value', by('COUPON_CREATED').length === 1 && by('COUPON_CREATED')[0].actorId === m.userId && meta(by('COUPON_CREATED')[0]).after?.discountValue === 10],
    ['COUPON_UPDATED has before/after name + discountValue', meta(by('COUPON_UPDATED')[0]).before?.discountValue === 10 && meta(by('COUPON_UPDATED')[0]).after?.discountValue === 15 && meta(by('COUPON_UPDATED')[0]).before?.name === `${f.prefix} AD before`],
    ['COUPON_STATUS_CHANGED ACTIVE→PAUSED', by('COUPON_STATUS_CHANGED').some((r: any) => meta(r).before?.status === 'ACTIVE' && meta(r).after?.status === 'PAUSED')],
    ['COUPON_STATUS_CHANGED PAUSED→ARCHIVED by owner', by('COUPON_STATUS_CHANGED').some((r: any) => meta(r).after?.status === 'ARCHIVED' && r.actorId === owner.userId)],
    ['COUPON_UNASSIGNED A1', by('COUPON_UNASSIGNED').some((r: any) => meta(r).affiliateId === A1.id)],
    ['COUPON_ASSIGNED A2', by('COUPON_ASSIGNED').some((r: any) => (meta(r).affiliateIds || []).includes(A2.id))],
    ['all rows: org A, resourceType organization_coupon, createdAt in window', rows.every((r: any) => r.organizationId === f.orgA.id && r.resourceType === 'organization_coupon' && new Date(r.createdAt) >= t0)],
  ];
  for (const [label, ok] of expectations) proof.check(label, ok, true);
  expect(expectations.filter(([, ok]) => !ok).map(([l]) => l)).toEqual([]);
  proof.note('Import: N/A — no bulk import exists (scenario G).');
});
