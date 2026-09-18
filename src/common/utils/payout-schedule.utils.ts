/**
 * Resolves when a program's next settlement run falls, from the settlement terms
 * the organization configured on that program.
 *
 * This lives on the server because the date is a statement about the
 * organization's payout calendar, not a client-side presentation detail: the
 * portal, notifications and any future payout worker must all agree on it.
 *
 * There is no per-organization payout timezone in the schema today, so every
 * date is computed in UTC and reported alongside the timezone it was computed
 * in, rather than silently assuming the viewer's local zone.
 */

export const PAYOUT_SCHEDULE_TIMEZONE = 'UTC';

const WEEKDAYS = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

export interface PayoutScheduleTerms {
  payoutSchedule?: string | null;
  payoutDay?: string | null;
}

/**
 * The next run at or after `from`, as an ISO date, or null when the terms do not
 * pin the run to a calendar date — a MANUAL program pays on request, and an
 * unrecognised or absent schedule is reported as unknown rather than guessed.
 */
export function resolveNextPayoutDate(
  terms: PayoutScheduleTerms,
  from: Date = new Date(),
): string | null {
  const schedule = (terms.payoutSchedule || '').toUpperCase().trim();
  const rawDay = (terms.payoutDay || '').trim();

  // Anchor to midnight UTC so the answer does not depend on the time of day the
  // question is asked.
  const today = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );

  switch (schedule) {
    case 'DAILY':
      return toIsoDate(addDays(today, 1));

    case 'WEEKLY': {
      const target = WEEKDAYS.indexOf(rawDay.toUpperCase());
      if (target < 0) return null;
      // Always strictly in the future, so "today is payout day" still points at
      // the run the partner is waiting on rather than one already executed.
      const delta = ((target - today.getUTCDay() + 7) % 7) || 7;
      return toIsoDate(addDays(today, delta));
    }

    case 'BIWEEKLY':
    case 'FORTNIGHTLY':
      return toIsoDate(addDays(today, 14));

    case 'MONTHLY': {
      const day = parseDayOfMonth(rawDay);
      if (day === null) return null;
      return toIsoDate(nextMonthlyOccurrence(today, day, 1));
    }

    case 'QUARTERLY': {
      const day = parseDayOfMonth(rawDay);
      if (day === null) return null;
      return toIsoDate(nextMonthlyOccurrence(today, day, 3));
    }

    case 'MANUAL':
    default:
      return null;
  }
}

/** The sentinel for a schedule that settles on whatever the month's last day is. */
export const LAST_DAY_OF_MONTH = 'LAST';

/**
 * Day-of-month tokens as the organization portal actually stores them: an
 * ordinal string such as "1st" or "15th", a bare number, or "Last day".
 * Anything else does not name a date and is reported as unconfigured.
 */
export function parseDayOfMonth(raw: string): number | typeof LAST_DAY_OF_MONTH | null {
  const token = (raw || '').trim().toLowerCase();
  if (!token) return null;
  if (token === 'last' || token === 'last day') return LAST_DAY_OF_MONTH;

  const ordinal = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(token);
  if (!ordinal) return null;
  const day = Number(ordinal[1]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
}

/**
 * Walks forward in `stepMonths` increments until it finds a month that actually
 * contains the configured day, so a "31st" schedule skips short months instead
 * of silently rolling into the next one.
 */
function nextMonthlyOccurrence(
  today: Date,
  day: number | typeof LAST_DAY_OF_MONTH,
  stepMonths: number,
): Date {
  // 24 steps covers two years of monthly runs and six of quarterly ones, which
  // is far more than enough to find a month long enough to contain the day.
  for (let step = 0; step <= 24; step += 1) {
    const monthIndex = today.getUTCMonth() + step * stepMonths;

    if (day === LAST_DAY_OF_MONTH) {
      // Day 0 of the following month is the last day of this one.
      const candidate = new Date(Date.UTC(today.getUTCFullYear(), monthIndex + 1, 0));
      if (candidate.getTime() > today.getTime()) return candidate;
      continue;
    }

    const candidate = new Date(Date.UTC(today.getUTCFullYear(), monthIndex, day));
    // A short month rolls the date forward, which means this month simply does
    // not contain the configured day; skip it rather than paying early.
    const overflowed = candidate.getUTCDate() !== day;
    if (!overflowed && candidate.getTime() > today.getTime()) {
      return candidate;
    }
  }
  // Unreachable for any valid token, but keeps the return type honest.
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + stepMonths, 1));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
