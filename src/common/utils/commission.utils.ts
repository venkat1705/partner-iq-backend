/**
 * One definition of "how much commission is this worth".
 *
 * A commission row keeps the amount it was created with in `commissionAmount`
 * and records any later clawback in `reversedAmount` rather than mutating the
 * original figure. A refund, partial refund or chargeback therefore leaves
 * `commissionAmount` untouched, so summing it raw counts money that was already
 * taken back as still earned — forever.
 *
 * The affiliate portal already netted reversals out (partners were shown the
 * right number), but every organization-facing surface — the affiliates
 * dashboard, platform analytics, admin reporting and tracking-link revenue —
 * summed the gross figure. The two sides of the same platform disagreed about
 * the same money, and the org side always read high.
 *
 * This is the single implementation all of them use, so they cannot drift apart
 * again.
 */

/** A commission-shaped record. Loose because several call sites hold hydrated DTOs. */
interface CommissionLike {
  commissionAmount?: number | string | null;
  /** Some hydrated payloads expose the figure as `amount`. */
  amount?: number | string | null;
  reversedAmount?: number | string | null;
}

/**
 * Commission actually earned, in cents: the original amount less anything
 * reversed. Clamped at zero — an over-reversal is a data error, and letting it
 * go negative would silently subtract from unrelated rows in a sum.
 */
export function netCommissionAmount(commission: CommissionLike | null | undefined): number {
  if (!commission) return 0;
  const gross = Number(commission.commissionAmount ?? commission.amount ?? 0) || 0;
  const reversed = Number(commission.reversedAmount ?? 0) || 0;
  return Math.max(0, gross - reversed);
}

/** Total net commission across a list, in cents. */
export function sumNetCommissions(commissions: Array<CommissionLike | null | undefined>): number {
  return commissions.reduce<number>((sum, commission) => sum + netCommissionAmount(commission), 0);
}

/** Total reversed (clawed back) across a list, in cents. */
export function sumReversedCommissions(commissions: Array<CommissionLike | null | undefined>): number {
  return commissions.reduce<number>(
    (sum, commission) => sum + (Number(commission?.reversedAmount ?? 0) || 0),
    0,
  );
}
