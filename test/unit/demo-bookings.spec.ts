import { describe, it, expect } from '@jest/globals';
import { DemoBookingsService } from '../../src/modules/demo-bookings/demo-bookings.service';

describe('DemoBookingsService', () => {
  it('creates and lists demo bookings', async () => {
    const service = new DemoBookingsService();

    const booking = await service.create({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.test',
      company: 'Analytical Engines',
      partnerCount: '10-100',
      phone: '+1 555 0100',
      website: 'https://analytical-engines.example.test',
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

    expect(booking.status).toBe('new');
    expect(booking.id).toBeTruthy();

    const rows = await service.list();
    expect(rows.some((row) => row.email === 'ada@example.test')).toBe(true);
  });
});

