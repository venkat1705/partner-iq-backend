import { BadRequestException } from '@nestjs/common';
import { dbStore } from '../../database/store';
import { AppDataSource, initializeDataSource } from '../../database/data-source';

/**
 * Pure business rules for organization coupons (decisions in docs/decisions.md):
 * D3 codes, D5/D6 discount math, D8 customer keys, D10 dates in the organization's timezone.
 */

/** Lookup normalisation (checkout input, metadata): trim, uppercase, drop inner whitespace. */
export const normalizeCode = (code: string) => String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');

export const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;

/**
 * Creation rule (D3): trimmed + uppercased; 2–40 chars of ASCII A-Z 0-9 - _; must start with a letter or digit
 * (no spreadsheet-formula prefix, no look-alike Cyrillic/Greek letters, no inner spaces).
 */
export function validateNewCode(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new BadRequestException('Coupon code must be a string.');
  }
  const code = raw.trim().toUpperCase();
  if (!COUPON_CODE_PATTERN.test(code)) {
    throw new BadRequestException(
      'Coupon code must be 2–40 characters: letters A–Z, digits 0–9, "-" or "_", starting with a letter or digit (no spaces or accented/non-Latin letters).',
    );
  }
  return code;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const tzCache = new Map<string, { tz: string; at: number }>();
const TZ_TTL_MS = 30_000;

const validZone = (tz?: string | null) => {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
};

/**
 * Loads organization_settings.timezone from MySQL (cached 30 s). Read from the database rather than dbStore:
 * dbStore.organizationSettings is loaded inside a try/catch in store.ts whose earlier loads throw (unregistered
 * entities), so it is empty after every restart (reported in docs/coupons-audit.md).
 */
export async function loadOrganizationTimezone(organizationId: string): Promise<string> {
  const hit = tzCache.get(organizationId);
  if (hit && Date.now() - hit.at < TZ_TTL_MS) return hit.tz;
  let tz: string | undefined;
  try {
    await initializeDataSource();
    const rows: Array<{ timezone: string | null }> = await AppDataSource.query(
      'SELECT timezone FROM organization_settings WHERE organizationId = ? LIMIT 1',
      [organizationId],
    );
    tz = validZone(rows[0]?.timezone);
  } catch {
    tz = undefined;
  }
  tz = tz || validZone(dbStore.organizationSettings?.find((s) => s.organizationId === organizationId)?.timezone) || 'UTC';
  tzCache.set(organizationId, { tz, at: Date.now() });
  return tz;
}

/** Organization timezone from the cache filled by loadOrganizationTimezone (UTC when not loaded/unset). */
export function organizationTimezone(organizationId: string): string {
  return tzCache.get(organizationId)?.tz || 'UTC';
}

/** Offset (ms) of `timeZone` from UTC at the instant `utcMs`. */
function zoneOffsetMs(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** UTC instant of local midnight (00:00:00.000) of y-m-d in `timeZone` (DST-safe: offset re-evaluated). */
function localMidnightUtc(y: number, m: number, d: number, timeZone: string) {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

/**
 * D10: a date-only value ("2026-11-30") is a calendar day in the organization's timezone — start = 00:00:00,
 * end = 23:59:59. The columns are MySQL `timestamp` (whole seconds), so instants are truncated to the second and
 * an end value is valid through the end of that second (see `isWithinWindow`). A full ISO timestamp is an exact
 * instant and is used as given (truncated to the second).
 */
export function parseCouponBoundary(value: string, organizationId: string, edge: 'start' | 'end'): Date {
  const m = DATE_ONLY.exec(value);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
      throw new BadRequestException(`Invalid date: ${value}`);
    }
    const tz = organizationTimezone(organizationId);
    if (edge === 'start') return new Date(localMidnightUtc(y, mo, d, tz));
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    return new Date(localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz) - 1000);
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new BadRequestException(`Invalid date: ${value}`);
  }
  return new Date(Math.floor(instant.getTime() / 1000) * 1000);
}

/** Validity at an instant: from validFrom (inclusive) through the whole last second of validUntil. */
export function isWithinWindow(coupon: { validFrom?: Date | string | null; validUntil?: Date | string | null }, at: Date) {
  const t = at.getTime();
  if (coupon.validFrom && t < new Date(coupon.validFrom).getTime()) return 'NOT_STARTED' as const;
  if (coupon.validUntil && t >= new Date(coupon.validUntil).getTime() + 1000) return 'EXPIRED' as const;
  return 'OK' as const;
}

/** Calendar day (YYYY-MM-DD) of an instant in the organization's timezone — what the date pickers show. */
export function localDateString(instant: Date | string | null | undefined, organizationId: string): string | null {
  if (!instant) return null;
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: organizationTimezone(organizationId), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Round half away from zero to an integer number of minor units (paise). */
export const roundMinor = (x: number) => Math.sign(x) * Math.floor(Math.abs(x) + 0.5 + 1e-9);

export interface DiscountBreakdown {
  /** Price before discount, minor units. */
  grossAmount: number;
  discountAmount: number;
  /** Amount paid after discount (commission base), minor units. */
  orderAmount: number;
}

/**
 * D5/D6: `paidAmount` is what the customer paid after the discount (excl. tax/shipping). When the merchant also
 * reports the pre-discount subtotal it is authoritative; otherwise the discount is derived from the coupon.
 */
export function discountBreakdown(
  coupon: { discountType: string; discountValue: number },
  paidAmount: number,
  orderSubtotal?: number,
): DiscountBreakdown {
  const value = Number(coupon.discountValue);
  if (orderSubtotal !== undefined && Number.isFinite(orderSubtotal) && orderSubtotal >= paidAmount) {
    const discountAmount = coupon.discountType === 'PERCENTAGE'
      ? Math.min(orderSubtotal, roundMinor((orderSubtotal * value) / 100))
      : Math.min(orderSubtotal, roundMinor(value * 100));
    return { grossAmount: orderSubtotal, discountAmount, orderAmount: paidAmount };
  }
  if (coupon.discountType === 'PERCENTAGE') {
    if (value >= 100) {
      // 100 % off: nothing paid and no subtotal reported → the price is unknown
      return { grossAmount: paidAmount, discountAmount: 0, orderAmount: paidAmount };
    }
    const grossAmount = roundMinor((paidAmount * 100) / (100 - value));
    return { grossAmount, discountAmount: grossAmount - paidAmount, orderAmount: paidAmount };
  }
  const discountAmount = roundMinor(value * 100);
  return { grossAmount: paidAmount + discountAmount, discountAmount, orderAmount: paidAmount };
}

/** D8: per-customer identity keys — the stable customer id, plus the normalized email when one is reported. */
export function customerKeys(customerExternalId: string, metadata?: Record<string, unknown>) {
  const email = typeof metadata?.customerEmail === 'string' ? metadata.customerEmail.trim().toLowerCase() : '';
  return {
    customerKey: `id:${String(customerExternalId).trim()}`.slice(0, 300),
    customerEmailKey: email ? `email:${email}`.slice(0, 300) : null,
  };
}

/** Metadata keys merchants already use for the coupon code (kept identical to the old read-side matcher). */
export function couponCodeFromMetadata(metadata?: Record<string, unknown>): string | undefined {
  if (!metadata) return undefined;
  const raw = metadata.couponCode ?? metadata.promoCode ?? metadata.coupon_code ?? metadata.code ?? metadata.coupon;
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const code = normalizeCode(String(raw));
  return code || undefined;
}
