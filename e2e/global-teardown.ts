import fs from 'node:fs';
import path from 'node:path';
import { cleanupSpec } from './lib/coupons';
import { closeDb } from './lib/db';
import { loadFixtures } from './lib/fixtures';

/**
 * Deletes everything the specs created in this run (codes E2E-CPN-<run>-<letter>…, orders <prefix>-<letter>-…).
 * Done once at the end (not per spec) because Playwright re-runs afterAll in every restarted worker.
 * Baseline fixtures (Phase 2 data) are removed by `npm run cleanup`. Restart the backend afterwards so its
 * in-memory copy matches MySQL.
 */
export default async function globalTeardown() {
  const f = loadFixtures();
  // Spec data is namespaced by scenario letter (E2E-CPN-<run>-<L>-…, <prefix>-<L>-…); Phase 2 fixtures are not.
  const letters = 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z AA AB AC AD AE AF'.split(' ');
  const res: Record<string, unknown> = {};
  for (const L of letters) {
    const r = await cleanupSpec([f.orgA.id, f.orgB.id], `E2E-CPN-${f.run}-${L}-`, `${f.prefix}-${L}-`, `${f.prefix} ${L} `);
    if (r.coupons || r.conversions) res[L] = r;
  }
  const out = path.resolve(__dirname, '..', 'docs', 'coupons-proof', '_cleanup.txt');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.appendFileSync(out, `${new Date().toISOString()} global teardown removed ${JSON.stringify(res)}\n`);
  await closeDb();
}
