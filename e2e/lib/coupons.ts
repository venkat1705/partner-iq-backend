import { api, ApiResult } from './api';
import { db, sql, sqlOne } from './db';
import { Fixtures, loadFixtures } from './fixtures';
import { as } from './session';

export const F = (): Fixtures => loadFixtures();
export const orgPath = (orgId: string, rest = '') => `/organizations/${orgId}/coupons${rest}`;

export async function createCoupon(role: string, orgId: string, body: Record<string, unknown>): Promise<ApiResult> {
  const s = await as(role);
  return api('POST', orgPath(orgId), { token: s.token, body });
}

/** Records a sale through the public server-to-server API (API key auth), as a merchant checkout would. */
export async function recordSale(apiKey: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return api('POST', '/conversions', { apiKey, body, headers });
}

export async function couponRow(orgId: string, codeOrId: string) {
  return sqlOne(
    `SELECT * FROM organization_coupons WHERE organizationId = ? AND (id = ? OR normalizedCode = ? OR code = ?)`,
    [orgId, codeOrId, codeOrId.toUpperCase(), codeOrId],
  );
}

export async function countCoupons(orgId: string, normalizedLike: string) {
  const r = await sqlOne<{ n: number }>(
    `SELECT COUNT(*) n FROM organization_coupons WHERE organizationId = ? AND normalizedCode LIKE ?`,
    [orgId, normalizedLike],
  );
  return Number(r?.n ?? 0);
}

export async function tableExists(name: string) {
  const r = await sqlOne<{ n: number }>(
    `SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
    [name],
  );
  return Number(r?.n) > 0;
}

/** Redemptions recorded for a coupon (null when the redemption table does not exist yet). */
export async function redemptions(couponId: string) {
  if (!(await tableExists('organization_coupon_redemptions'))) return null;
  return sql(`SELECT * FROM organization_coupon_redemptions WHERE couponId = ? ORDER BY createdAt`, [couponId]);
}

export async function conversionByExternalId(orgId: string, externalId: string) {
  return sqlOne(`SELECT * FROM conversions WHERE organizationId = ? AND externalId = ?`, [orgId, externalId]);
}

export async function commissionsFor(conversionId: string) {
  return sql(`SELECT * FROM commissions WHERE conversionId = ?`, [conversionId]);
}

/**
 * Deletes rows a spec created (coupons whose code starts with the spec prefix, conversions whose externalId
 * starts with it, and everything hanging off them). Test data only.
 */
export async function cleanupSpec(orgIds: string[], codePrefix: string, orderPrefix: string, namePrefix = '\u0000') {
  const conn = db();
  const coupons = await sql<{ id: string }>(
    `SELECT id FROM organization_coupons WHERE organizationId IN (?) AND (normalizedCode LIKE ? OR name LIKE ?)`,
    [orgIds, `${codePrefix.toUpperCase()}%`, `${namePrefix}%`],
  );
  const convs = await sql<{ id: string }>(
    `SELECT id FROM conversions WHERE organizationId IN (?) AND externalId LIKE ?`,
    [orgIds, `${orderPrefix}%`],
  );
  const cIds = coupons.map((c) => c.id);
  const vIds = convs.map((c) => c.id);
  // idempotency records keyed by the spec's order prefix would replay stale responses in the next run
  await conn.query(`DELETE FROM idempotency_keys WHERE organizationId IN (?) AND \`key\` LIKE ?`, [orgIds, `${orderPrefix}%`]).catch(() => undefined);
  if (vIds.length) {
    const comm = await sql<{ id: string }>(`SELECT id FROM commissions WHERE conversionId IN (?)`, [vIds]);
    if (comm.length) {
      await conn.query(`DELETE FROM ledger_entries WHERE transactionId IN (SELECT id FROM ledger_transactions WHERE referenceId IN (?))`, [comm.map((c) => c.id)]).catch(() => undefined);
      await conn.query(`DELETE FROM ledger_transactions WHERE referenceId IN (?)`, [comm.map((c) => c.id)]).catch(() => undefined);
      await conn.query(`DELETE FROM commissions WHERE id IN (?)`, [comm.map((c) => c.id)]);
    }
    if (await tableExists('organization_coupon_redemptions')) {
      await conn.query(`DELETE FROM organization_coupon_redemptions WHERE conversionId IN (?)`, [vIds]);
    }
    await conn.query(`DELETE FROM conversions WHERE id IN (?)`, [vIds]);
  }
  if (cIds.length) {
    if (await tableExists('organization_coupon_redemptions')) {
      await conn.query(`DELETE FROM organization_coupon_redemptions WHERE couponId IN (?)`, [cIds]);
    }
    if (await tableExists('organization_coupon_usage')) {
      await conn.query(`DELETE FROM organization_coupon_usage WHERE couponId IN (?)`, [cIds]);
    }
    await conn.query(`DELETE FROM organization_coupon_assignments WHERE couponId IN (?)`, [cIds]);
    await conn.query(`DELETE FROM audit_logs WHERE resourceId IN (?)`, [cIds]);
    await conn.query(`DELETE FROM organization_coupons WHERE id IN (?)`, [cIds]);
  }
  return { coupons: cIds.length, conversions: vIds.length };
}

/** Round half away from zero to an integer (paise). Independent of the app's own helpers. */
export const roundHalfUp = (x: number) => Math.sign(x) * Math.floor(Math.abs(x) + 0.5);

/** A real link click through GET /r/:shortCode; returns the click id the backend minted. */
export async function clickLink(affiliateId: string, orgId: string) {
  const link = await sqlOne<{ shortCode: string }>(
    `SELECT shortCode FROM tracking_links WHERE organizationId=? AND affiliateId=? ORDER BY createdAt LIMIT 1`,
    [orgId, affiliateId],
  );
  if (!link) throw new Error(`no tracking link for affiliate ${affiliateId}`);
  const base = (process.env.E2E_API_URL || 'http://localhost:5000/api/v1').replace(/\/api\/v1$/, '');
  const res = await fetch(`${base}/r/${link.shortCode}`, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 e2e-cpn' } });
  const cookies = res.headers.getSetCookie?.() || [];
  const fromCookie = cookies.map((c) => c.match(/pi_click_id=([^;]+)/)?.[1]).find(Boolean);
  const loc = res.headers.get('location') || '';
  const fromLoc = loc.match(/pi_click_id=([^&]+)/)?.[1];
  return { status: res.status, location: loc, clickId: decodeURIComponent(fromCookie || fromLoc || ''), shortCode: link.shortCode };
}
