/**
 * Re-creates Phase 2 fixture coupons that are missing in MySQL (through the API, same definitions as
 * seed-fixtures.ts) and updates .fixtures.json. Needed once: an early per-spec cleanup used a code prefix
 * without the trailing "-" and removed fixture coupons whose codes start with the same letter.
 */
import { api } from '../lib/api';
import { closeDb, sqlOne } from '../lib/db';
import { loadFixtures, saveFixtures } from '../lib/fixtures';
import { as } from '../lib/session';

(async () => {
  const f = loadFixtures();
  const C = (s: string) => `E2E-CPN-${f.run}-${s}`;
  const day = 86400000;
  const now = Date.now();
  const [a1, a2, a3] = f.orgA.affiliates.map((a) => a.id);
  const defs: Record<string, [string, Record<string, unknown>, string?]> = {
    PCT10: ['A', { discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [a1] }],
    FIX200: ['A', { discountType: 'FIXED_AMOUNT', discountValue: 200, affiliateIds: [a2] }],
    LIMIT3: ['A', { discountType: 'PERCENTAGE', discountValue: 5, maxRedemptions: 3, affiliateIds: [a3] }],
    STARTS: ['A', { discountType: 'PERCENTAGE', discountValue: 15, validFrom: new Date(now + day).toISOString(), affiliateIds: [a1] }],
    ENDS: ['A', { discountType: 'PERCENTAGE', discountValue: 20, validUntil: new Date(now + day).toISOString(), affiliateIds: [a2] }],
    EXPIRED: ['A', { discountType: 'FIXED_AMOUNT', discountValue: 50, validFrom: new Date(now - 10 * day).toISOString(), validUntil: new Date(now - day).toISOString() }],
    PAUSED: ['A', { discountType: 'PERCENTAGE', discountValue: 25 }, 'PAUSED'],
    ARCHIVED: ['A', { discountType: 'FIXED_AMOUNT', discountValue: 100 }, 'ARCHIVED'],
    SHARED: ['A', { discountType: 'PERCENTAGE', discountValue: 12 }],
    USED: ['A', { discountType: 'PERCENTAGE', discountValue: 10, affiliateIds: [a1] }],
    'B:SHARED': ['B', { discountType: 'PERCENTAGE', discountValue: 30, affiliateIds: [f.orgB.affiliates[0].id] }],
    'B:BONLY': ['B', { discountType: 'FIXED_AMOUNT', discountValue: 75, affiliateIds: [f.orgB.affiliates[0].id] }],
  };
  for (const [key, [orgKey, body, status]] of Object.entries(defs)) {
    const org = orgKey === 'A' ? f.orgA : f.orgB;
    const short = key.replace('B:', '');
    const code = C(short);
    const row = await sqlOne<{ id: string }>(`SELECT id FROM organization_coupons WHERE organizationId=? AND normalizedCode=?`, [org.id, code]);
    if (row) {
      org.coupons[short] = { id: row.id, code };
      continue;
    }
    const owner = await as(orgKey === 'A' ? 'ORG_A_OWNER' : 'ORG_B_OWNER');
    const r = await api('POST', `/organizations/${org.id}/coupons`, { token: owner.token, body: { code, name: `${f.prefix} fixture ${short.toLowerCase()}`, ...body } });
    if (r.status !== 201) throw new Error(`${key}: ${r.status} ${JSON.stringify(r.body)}`);
    if (status) await api('POST', `/organizations/${org.id}/coupons/${r.data.id}/status`, { token: owner.token, body: { status } });
    org.coupons[short] = { id: r.data.id, code };
    console.log(`re-created ${orgKey} ${code} (${r.data.id})${status ? ` -> ${status}` : ''}`);
  }
  saveFixtures(f);
  await closeDb();
})().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
