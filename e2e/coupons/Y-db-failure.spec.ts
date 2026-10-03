import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { api } from '../lib/api';
import { F, orgPath } from '../lib/coupons';
import { closeDb, sql } from '../lib/db';
import { ENV } from '../lib/env';
import { Proof } from '../lib/proof';
import { as } from '../lib/session';

/**
 * Y — database write failure. A second MySQL session holds LOCK TABLES organization_coupons READ while the API
 * creates and edits a coupon. (The prompt's "coupons" table is called organization_coupons here.)
 * Report only for store.ts; the coupon service itself must not return success for a write that did not land.
 */
const proof = new Proof('Y');
const f = F();
const P = `E2E-CPN-${f.run}-Y`;
const LOG = '/home/user/backend.log';
test.afterAll(async () => closeDb());

async function timed(method: string, path: string, token: string, body: unknown, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  const t0 = Date.now();
  try {
    const res = await fetch(`${ENV.API}${path}`, { method, signal: ctl.signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.text(), ms: Date.now() - t0 };
  } catch (e: any) {
    return { status: 0, body: `client aborted after ${ms} ms (${e.name})`, ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

test('Y LOCK TABLES organization_coupons READ during create + edit', async () => {
  test.setTimeout(240_000);
  const owner = await as('ORG_A_OWNER');
  const pre = await api('POST', orgPath(f.orgA.id), { token: owner.token, body: { code: `${P}-EDIT`, name: `${f.prefix} Y edit me`, discountType: 'PERCENTAGE', discountValue: 10 } });
  expect(pre.status).toBe(201);
  await new Promise((r) => setTimeout(r, 500));
  const logStart = fs.statSync(LOG).size;
  const locker = await mysql.createConnection({ ...ENV.DB });
  await locker.query('LOCK TABLES organization_coupons READ');
  proof.h('Y second session: LOCK TABLES organization_coupons READ');
  const create = await timed('POST', orgPath(f.orgA.id), owner.token, { code: `${P}-NEW`, name: `${f.prefix} Y new`, discountType: 'PERCENTAGE', discountValue: 10 });
  const edit = await timed('PUT', orgPath(f.orgA.id, `/${pre.data.id}`), owner.token, { name: `${f.prefix} Y edited` });
  proof.note(`> POST create while locked -> HTTP ${create.status} after ${create.ms} ms\n< ${create.body.slice(0, 600)}`);
  proof.note(`> PUT edit while locked -> HTTP ${edit.status} after ${edit.ms} ms\n< ${edit.body.slice(0, 600)}`);
  const listWhileLocked = await api('GET', orgPath(f.orgA.id), { token: owner.token });
  const inMemory = (listWhileLocked.data as any[]).filter((c) => c.code === `${P}-NEW` || c.name === `${f.prefix} Y edited`).map((c) => c.code);
  proof.note(`GET /coupons while locked: in-memory rows for Y = ${JSON.stringify(inMemory)}`);
  const alive1 = execSync(`pgrep -f "^node dist/src/main.js" || true`).toString().trim();
  await locker.query('UNLOCK TABLES');
  await locker.end();
  await new Promise((r) => setTimeout(r, 3000));
  const log = fs.readFileSync(LOG, 'utf8').slice(logStart).split('\n').filter((l) => /dbStore|error|ERROR|Lock|lock|organization_coupons|coupons/.test(l)).slice(0, 40).join('\n');
  proof.note(`backend log during the window:\n${log}`);
  proof.note(`backend process while locked: ${alive1 ? `running (pid ${alive1})` : 'NOT RUNNING'}`);
  const restart = (execSync(`${__dirname}/../scripts/restart-backend.sh`, { stdio: 'ignore' }), `backend restarted, pid ${execSync('pgrep -f "^node dist/src/main.js" | head -1').toString().trim()}`);
  proof.note(`restart: ${restart.trim()}`);
  const rowNew = await sql(`SELECT code FROM organization_coupons WHERE organizationId=? AND normalizedCode=?`, [f.orgA.id, `${P}-NEW`]);
  const rowEdit = await sql(`SELECT name FROM organization_coupons WHERE id=?`, [pre.data.id]);
  proof.sql(`SELECT code FROM organization_coupons WHERE normalizedCode='${P}-NEW'`, rowNew);
  proof.sql(`SELECT name FROM organization_coupons WHERE id='${pre.data.id}'`, rowEdit);
  const createdOk = create.status === 201;
  const editOk = edit.status === 200;
  proof.check('backend alive during lock', Boolean(alive1), true);
  proof.check('create: success reported ⇔ row exists after restart', createdOk === (rowNew.length === 1), true);
  proof.check('edit: success reported ⇔ change exists after restart', editOk === (rowEdit[0]?.name === `${f.prefix} Y edited`), true);
  proof.check('create while locked did not claim success', createdOk, false);
  expect(Boolean(alive1)).toBe(true);
  expect(createdOk === (rowNew.length === 1)).toBe(true);
  expect(editOk === (rowEdit[0]?.name === `${f.prefix} Y edited`)).toBe(true);
  expect(createdOk).toBe(false);
});
