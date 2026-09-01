import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import { DemoBooking } from '../../database/schema';
import type { CreateDemoBookingDto } from './demo-bookings.dto';

@Injectable()
export class DemoBookingsService {
  async create(dto: CreateDemoBookingDto) {
    const booking: DemoBooking = {
      id: uuidv4(),
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email.toLowerCase().trim(),
      company: dto.company,
      partnerCount: dto.partnerCount,
      phone: dto.phone || 'Not provided',
      website: dto.website || '',
      jobTitle: dto.jobTitle || 'Growth / Partnerships Lead',
      businessModel: dto.businessModel || 'Partner-led SaaS',
      companySize: dto.companySize || 'Not provided',
      programStatus: dto.programStatus || 'Not provided',
      interests: dto.interests || [],
      challenge: dto.challenge,
      scheduledAt: new Date(dto.scheduledAt),
      timezone: dto.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      host: dto.host || 'PartnerIQ Solutions Team',
      status: 'new',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.demoBookings.push(booking);
    return booking;
  }

  async list(status?: string) {
    const rows = dbStore.demoBookings.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (!status) return rows.map(this.serialize);
    return rows.filter((row) => row.status === status).map(this.serialize);
  }

  async updateStatus(id: string, status: DemoBooking['status']) {
    const booking = dbStore.demoBookings.find((row) => row.id === id);
    if (!booking) {
      throw new NotFoundException('Demo booking not found');
    }

    booking.status = status;
    booking.updatedAt = new Date();
    return this.serialize(booking);
  }

  private serialize(bookings: DemoBooking) {
    return {
      id: bookings.id,
      firstName: bookings.firstName,
      lastName: bookings.lastName,
      email: bookings.email,
      company: bookings.company,
      partnerCount: bookings.partnerCount,
      phone: bookings.phone,
      website: bookings.website,
      jobTitle: bookings.jobTitle,
      businessModel: bookings.businessModel,
      companySize: bookings.companySize,
      programStatus: bookings.programStatus,
      interests: bookings.interests || [],
      challenge: bookings.challenge,
      scheduledAt: bookings.scheduledAt.toISOString(),
      timezone: bookings.timezone,
      host: bookings.host,
      status: bookings.status,
      createdAt: bookings.createdAt.toISOString(),
      updatedAt: bookings.updatedAt.toISOString(),
    };
  }
}
