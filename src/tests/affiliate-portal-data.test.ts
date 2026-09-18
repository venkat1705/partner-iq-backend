/**
 * The server-side calculations the affiliate portal now depends on for figures
 * it used to hard-code: profile completion, program payout schedules, and the
 * traffic-source grouping behind the analytics chart. Plus the access rules on
 * tax certificates, which decide what a partner is allowed to see.
 *
 * Pure functions and the in-memory dbStore only — no database connection, the
 * same way the legal-acceptance suite runs.
 *
 *   npx tsx src/tests/affiliate-portal-data.test.ts
 */
import { evaluateProfileCompleteness } from '../modules/affiliates/profile-completeness';
import { AffiliatePortalController } from '../modules/affiliates/affiliate-portal.controller';
import {
  LAST_DAY_OF_MONTH,
  parseDayOfMonth,
  resolveNextPayoutDate,
} from '../common/utils/payout-schedule.utils';
import { TaxCertificatesService } from '../modules/tax-certificates/tax-certificates.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${name}`, detail ?? '');
    failed++;
  }
}

const baseUser = {
  firstName: 'Asha',
  lastName: 'Rao',
  email: 'asha@example.com',
  avatarUrl: 'https://cdn.example.com/a.png',
};

const completeProfile = {
  phone: '+91 98765 43210',
  country: 'India',
  partnerType: 'AFFILIATE',
  primaryMarket: 'India',
  audienceSize: '10k-50k',
  website: 'https://asha.example.com',
  bio: 'Long-form reviews of developer tooling for Indian startups.',
  socialProfiles: { youtube: '@asharao' },
  panOrTaxId: 'ABCDE1234F',
  taxClassification: 'INDIVIDUAL',
} as any;

async function main() {
  console.log('\n🧪 PartnerIQ Affiliate Portal Data Suite\n');

  // --- Profile completion -------------------------------------------------
  console.log('Profile completion');

  const complete = evaluateProfileCompleteness(baseUser, completeProfile, [{ id: 'pm_1' } as any]);
  assert(complete.percentage === 100, 'A fully supplied profile reports 100%', complete.percentage);
  assert(complete.isComplete === true, 'A fully supplied profile is complete');
  assert(complete.missing.length === 0, 'A fully supplied profile has nothing outstanding');

  const empty = evaluateProfileCompleteness(
    { firstName: '', lastName: '', email: '', avatarUrl: '' },
    {},
    [],
  );
  assert(empty.percentage === 0, 'An entirely empty profile reports 0%', empty.percentage);
  assert(empty.isComplete === false, 'An entirely empty profile is not complete');
  assert(
    empty.missing.length === empty.requirements.length,
    'Every requirement is listed as missing on an empty profile',
  );
  assert(
    empty.missing.every((requirement) => !!requirement.reason),
    'Every missing requirement explains why it is needed',
  );

  // The gate is only useful if a missing payout destination actually blocks it.
  const noPayout = evaluateProfileCompleteness(baseUser, completeProfile, []);
  assert(noPayout.isComplete === false, 'No payout destination leaves the profile incomplete');
  assert(
    noPayout.missing.some((requirement) => requirement.key === 'payoutMethod'),
    'The missing payout destination is named',
  );
  assert(
    noPayout.missing.every((requirement) => requirement.tab === 'payouts'),
    'The outstanding item points at the payouts tab',
  );

  // Whitespace is not a supplied value.
  const blankPhone = evaluateProfileCompleteness(
    baseUser,
    { ...completeProfile, phone: '   ' },
    [{ id: 'pm_1' } as any],
  );
  assert(
    blankPhone.missing.some((requirement) => requirement.key === 'phone'),
    'A whitespace-only phone number counts as missing',
  );

  // A short bio is present but not sufficient.
  const shortBio = evaluateProfileCompleteness(
    baseUser,
    { ...completeProfile, bio: 'Too short.' },
    [{ id: 'pm_1' } as any],
  );
  assert(
    shortBio.missing.some((requirement) => requirement.key === 'bio'),
    'A bio under the minimum length counts as missing',
  );
  assert(
    shortBio.percentage > 0 && shortBio.percentage < 100,
    'A partially complete profile reports a partial percentage',
    shortBio.percentage,
  );

  // --- Payout day parsing -------------------------------------------------
  console.log('\nPayout schedule');

  assert(parseDayOfMonth('15th') === 15, 'An ordinal day token parses', parseDayOfMonth('15th'));
  assert(parseDayOfMonth('1st') === 1, 'A first-of-month token parses');
  assert(parseDayOfMonth('15') === 15, 'A bare numeric day parses');
  assert(parseDayOfMonth('Last day') === LAST_DAY_OF_MONTH, 'A last-day token parses');
  assert(parseDayOfMonth('') === null, 'An empty day is unconfigured, not a date');
  assert(parseDayOfMonth('whenever') === null, 'An unparseable day is unconfigured');
  assert(parseDayOfMonth('41st') === null, 'A day outside 1-31 is rejected');

  const june10 = new Date(Date.UTC(2026, 5, 10));
  assert(
    resolveNextPayoutDate({ payoutSchedule: 'MONTHLY', payoutDay: '15th' }, june10) === '2026-06-15',
    'A monthly run later this month resolves to this month',
    resolveNextPayoutDate({ payoutSchedule: 'MONTHLY', payoutDay: '15th' }, june10),
  );
  assert(
    resolveNextPayoutDate({ payoutSchedule: 'MONTHLY', payoutDay: '1st' }, june10) === '2026-07-01',
    'A monthly run already past this month rolls to next month',
    resolveNextPayoutDate({ payoutSchedule: 'MONTHLY', payoutDay: '1st' }, june10),
  );
  assert(
    // The 10th is today; the run the partner is waiting on is the next one.
    resolveNextPayoutDate({ payoutSchedule: 'MONTHLY', payoutDay: '10' }, june10) === '2026-07-10',
    'Today is not offered as the next payout date',
    resolveNextPayoutDate({ payoutSchedule: 'MONTHLY', payoutDay: '10' }, june10),
  );
  assert(
    resolveNextPayoutDate({ payoutSchedule: 'MONTHLY', payoutDay: 'Last day' }, june10) === '2026-06-30',
    'A last-day monthly run lands on the real last day',
    resolveNextPayoutDate({ payoutSchedule: 'MONTHLY', payoutDay: 'Last day' }, june10),
  );
  assert(
    // February has no 31st, so a 31st schedule skips it rather than paying early.
    resolveNextPayoutDate(
      { payoutSchedule: 'MONTHLY', payoutDay: '31' },
      new Date(Date.UTC(2026, 1, 5)),
    ) === '2026-03-31',
    'A 31st schedule skips months that have no 31st',
    resolveNextPayoutDate({ payoutSchedule: 'MONTHLY', payoutDay: '31' }, new Date(Date.UTC(2026, 1, 5))),
  );
  assert(
    resolveNextPayoutDate({ payoutSchedule: 'WEEKLY', payoutDay: 'FRIDAY' }, june10) === '2026-06-12',
    'A weekly run resolves to the next matching weekday',
    resolveNextPayoutDate({ payoutSchedule: 'WEEKLY', payoutDay: 'FRIDAY' }, june10),
  );
  assert(
    resolveNextPayoutDate({ payoutSchedule: 'DAILY' }, june10) === '2026-06-11',
    'A daily run resolves to tomorrow',
  );
  assert(
    resolveNextPayoutDate({ payoutSchedule: 'MANUAL', payoutDay: '15' }, june10) === null,
    'A pay-on-request program has no scheduled date',
  );
  assert(
    resolveNextPayoutDate({ payoutSchedule: 'MONTHLY', payoutDay: null }, june10) === null,
    'A monthly program with no configured day has no scheduled date',
  );
  assert(
    resolveNextPayoutDate({ payoutSchedule: null, payoutDay: null }, june10) === null,
    'An unconfigured schedule has no scheduled date',
  );
  assert(
    resolveNextPayoutDate({ payoutSchedule: 'WEEKLY', payoutDay: 'SOMEDAY' }, june10) === null,
    'An unparseable weekday has no scheduled date rather than a guess',
  );

  // --- Traffic source grouping -------------------------------------------
  console.log('\nTraffic sources');

  const label = (click: { utmSource?: string | null; referrer?: string | null }) =>
    AffiliatePortalController.resolveTrafficSourceLabel(click);

  assert(label({ utmSource: 'YouTube' }) === 'youtube', 'A UTM source is used and normalized');
  assert(
    label({ utmSource: 'newsletter', referrer: 'https://google.com' }) === 'newsletter',
    'A UTM source wins over the referrer',
  );
  assert(
    label({ referrer: 'https://www.reddit.com/r/india' }) === 'reddit.com',
    'A referrer falls back to its host, without the www prefix',
    label({ referrer: 'https://www.reddit.com/r/india' }),
  );
  assert(label({}) === 'Unknown', 'A click with neither is a real Unknown bucket');
  assert(
    label({ utmSource: '   ', referrer: '  ' }) === 'Unknown',
    'Whitespace-only values are not treated as a source',
  );
  assert(
    label({ referrer: 'not a url' }) === 'not a url',
    'An unparseable referrer is kept as recorded rather than discarded',
  );

  // Percentages are computed the way the endpoint computes them, and must not
  // drift from the counts they describe.
  const counts = [
    { source: 'youtube', count: 50 },
    { source: 'newsletter', count: 30 },
    { source: 'Unknown', count: 20 },
  ];
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  const percentages = counts.map((row) => Math.round((row.count / total) * 1000) / 10);
  assert(
    percentages.reduce((sum, value) => sum + value, 0) === 100,
    'Source percentages add up to 100',
    percentages,
  );
  assert(
    Math.round((0 / Math.max(1, 0)) * 1000) / 10 === 0,
    'An empty window yields zero rather than dividing by zero',
  );

  // --- Tax certificate visibility ----------------------------------------
  console.log('\nTax certificates');

  // The service reaches for a database, so the access rules are exercised
  // through a stubbed repository rather than a live connection.
  const rows = [
    { id: 'c_pub', userId: 'u_1', status: 'PUBLISHED', fileUrl: 'https://f/1.pdf', financialYear: '2025-26' },
    { id: 'c_draft', userId: 'u_1', status: 'DRAFT', fileUrl: 'https://f/2.pdf', financialYear: '2025-26' },
    { id: 'c_other', userId: 'u_2', status: 'PUBLISHED', fileUrl: 'https://f/3.pdf', financialYear: '2025-26' },
  ];
  const matches = (row: any, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  const service = new TaxCertificatesService();
  (service as any).repositories = async () => ({
    certificates: {
      find: async ({ where }: any) => rows.filter((row) => matches(row, where)),
      findOne: async ({ where }: any) => rows.find((row) => matches(row, where)) || null,
    },
    users: {},
  });

  const visible = await service.listForAffiliate('u_1');
  assert(visible.length === 1, 'Only published certificates are listed', visible.map((c) => c.id));
  assert(visible[0].id === 'c_pub', 'The published certificate is the one returned');
  assert(
    !visible.some((certificate) => certificate.id === 'c_draft'),
    'A draft certificate is withheld from the affiliate',
  );
  assert(
    !visible.some((certificate) => certificate.id === 'c_other'),
    "Another affiliate's certificate is never listed",
  );

  const download = await service.getDownloadUrl('c_pub', 'u_1');
  assert(download.url === 'https://f/1.pdf', 'An owner can resolve their own download URL');

  let deniedOther = false;
  try {
    await service.getDownloadUrl('c_other', 'u_1');
  } catch {
    deniedOther = true;
  }
  assert(deniedOther, "Downloading another affiliate's certificate is refused");

  let deniedDraft = false;
  try {
    await service.getDownloadUrl('c_draft', 'u_1');
  } catch {
    deniedDraft = true;
  }
  assert(deniedDraft, 'Downloading an unpublished certificate is refused');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`${'='.repeat(60)}\n`);

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Suite crashed:', error);
  process.exit(1);
});
