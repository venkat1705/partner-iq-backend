import assert from 'node:assert/strict';
import { DemoBookingsService } from '../modules/demo-bookings/demo-bookings.service';

const service = new DemoBookingsService();

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
