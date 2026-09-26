import assert from 'node:assert/strict';
import { DemoBookingsService } from '../modules/demo-bookings/demo-bookings.service';
import { GoogleCalendarService } from '../modules/demo-bookings/google-calendar.service';
import { GoogleCalendarOAuthService } from '../modules/demo-bookings/google-calendar-oauth.service';
import { IntegrationCredentialService } from '../modules/integrations/integration-credential.service';
import { SystemEmailDispatchService } from '../modules/email-design/services/system-email-dispatch.service';

// GoogleCalendarOAuthService has no connection stored yet in this test run, so
// getValidAccessToken() naturally returns null and GoogleCalendarService no-ops
// into its placeholder fallback — real IntegrationCredentialService is cheap
// enough (pure crypto + dbStore) to construct directly rather than stub.
// SystemEmailDispatchService's real constructor pulls in the full email queue
// stack, which is unnecessary for this unit test — a minimal stub satisfies
// the one method demo-bookings.service.ts calls.
const emailDispatchStub = { send: async () => undefined } as unknown as SystemEmailDispatchService;
const googleCalendarOAuth = new GoogleCalendarOAuthService(new IntegrationCredentialService());
const service = new DemoBookingsService(new GoogleCalendarService(googleCalendarOAuth), emailDispatchStub);

const booking = await service.create({
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  partnerCount: '10-100',
  phone: '+1 555 0100',
  website: 'https://analytical-engines.example',
  jobTitle: 'VP of Partnerships',
  businessModel: 'B2B SaaS',
  companySize: '11-50 employees',
  programStatus: 'Yes, actively',
  interests: ['Affiliate Management'],
  challenge: 'Need cleaner attribution',
  scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  timezone: 'UTC',
  host: 'PartnerIQ Solutions Team',
});

assert.equal(booking.status, 'new');
assert.ok(booking.id);
assert.equal(await service.list().then((rows) => rows.some((row) => row.email === 'ada@example.com')), true);

console.log('demo-bookings regression test passed');
