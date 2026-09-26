import * as crypto from 'crypto';
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, awaitPersist } from '../../database/store';
import { DemoBooking } from '../../database/schema';
import { AuditAction } from '../../common/enums';
import { GoogleCalendarService } from './google-calendar.service';
import { SystemEmailDispatchService } from '../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import { getAppConfig } from '../../config/app.config';
import type {
  CreateDemoBookingDto,
  RescheduleDemoBookingDto,
  CancelDemoBookingDto,
  MarkAttendanceDto,
  UpdateQualificationDto,
  CreateFollowUpDto,
  CreateOpportunityDto,
  AssignOwnerDto,
  DemoAvailabilityQueryDto,
} from './demo-bookings.dto';

@Injectable()
export class DemoBookingsService {
  constructor(
    private readonly googleCalendar: GoogleCalendarService,
    private readonly emailDispatch: SystemEmailDispatchService,
  ) { }

  /**
   * Generates dynamic real-time slot availability for the next 14 business days,
   * taking into account existing confirmed and active bookings.
   */
  async getAvailability(query?: DemoAvailabilityQueryDto) {
    const tz = query?.timezone || 'Asia/Kolkata';
    const dates: Array<{
      date: string;
      displayDate: string;
      dayOfWeek: string;
      slots: Array<{ time: string; iso: string; available: boolean }>;
    }> = [];

    const now = new Date();
    // Default slot hours: 09:30, 10:30, 11:30, 14:00, 15:00, 16:00, 17:00, 18:00
    const slotHours = [
      { h: 9, m: 30, label: '09:30 AM' },
      { h: 10, m: 30, label: '10:30 AM' },
      { h: 11, m: 30, label: '11:30 AM' },
      { h: 14, m: 0, label: '02:00 PM' },
      { h: 15, m: 0, label: '03:00 PM' },
      { h: 16, m: 0, label: '04:00 PM' },
      { h: 17, m: 0, label: '05:00 PM' },
      { h: 18, m: 0, label: '06:00 PM' },
    ];

    let dayOffset = 1;
    let businessDaysAdded = 0;

    // Collect next 14 business days
    while (businessDaysAdded < 14) {
      const d = new Date(now);
      d.setDate(now.getDate() + dayOffset);
      dayOffset++;

      const dayOfWeekNum = d.getDay(); // 0 is Sunday, 6 is Saturday
      if (dayOfWeekNum === 0 || dayOfWeekNum === 6) {
        continue;
      }

      businessDaysAdded++;
      const dateStr = d.toISOString().split('T')[0];
      const displayDate = d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const dayOfWeek = d.toLocaleDateString('en-US', { weekday: 'long' });

      const slots = slotHours.map((sh) => {
        const slotDate = new Date(d);
        slotDate.setHours(sh.h, sh.m, 0, 0);

        // Check if slot overlaps with any active booking (within 40 mins)
        const isOccupied = dbStore.demoBookings.some((b) => {
          if (b.status === 'cancelled') return false;
          const diff = Math.abs(new Date(b.scheduledAt).getTime() - slotDate.getTime());
          return diff < 40 * 60 * 1000;
        });

        // Ensure slot is at least 2 hours in the future
        const isPast = slotDate.getTime() <= now.getTime() + 2 * 60 * 60 * 1000;

        return {
          time: sh.label,
          iso: slotDate.toISOString(),
          available: !isOccupied && !isPast,
        };
      });

      dates.push({
        date: dateStr,
        displayDate,
        dayOfWeek,
        slots,
      });
    }

    return {
      timezone: tz,
      durationMinutes: 30,
      hostName: 'PartnerIQ Solutions Lead',
      dates,
    };
  }

  async create(dto: CreateDemoBookingDto, actorId?: string) {
    // 1. Idempotency Check
    if (dto.idempotencyKey) {
      const existing = dbStore.demoBookings.find(
        (b) => (b as any).idempotencyKey === dto.idempotencyKey,
      );
      if (existing) {
        return this.serialize(existing);
      }
    }

    // 2. Double-booking / Slot Collision Check
    const requestedTime = new Date(dto.scheduledAt).getTime();
    if (isNaN(requestedTime)) {
      throw new BadRequestException('Invalid scheduledAt timestamp provided.');
    }

    const collision = dbStore.demoBookings.find((b) => {
      if (b.status === 'cancelled') return false;
      const bTime = new Date(b.scheduledAt).getTime();
      return Math.abs(bTime - requestedTime) < 30 * 60 * 1000;
    });

    if (collision) {
      throw new ConflictException(
        'The selected time slot was just booked by another team. Please choose another slot.',
      );
    }

    // 3. Prevent duplicate active submission from same email within 2 hours
    const duplicateEmail = dbStore.demoBookings.find((b) => {
      if (b.status === 'cancelled') return false;
      const bTime = new Date(b.scheduledAt).getTime();
      return (
        b.email.toLowerCase() === dto.email.toLowerCase().trim() &&
        Math.abs(bTime - requestedTime) < 2 * 60 * 60 * 1000
      );
    });

    if (duplicateEmail) {
      return this.serialize(duplicateEmail);
    }

    const bookingId = uuidv4();
    const scheduledAt = new Date(dto.scheduledAt);
    const timezone = dto.timezone || 'Asia/Kolkata';
    const durationMinutes = 30;
    const host = dto.host || 'PartnerIQ Team';
    const email = dto.email.toLowerCase().trim();
    const company = dto.company.trim();
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const challenge = dto.notes || dto.challenge || 'Scaling partner tracking and automated payouts with clean fraud defense';

    // Real Google Meet-backed calendar event (falls back to a placeholder link
    // below if Calendar isn't configured or the API call fails — a booking
    // must never be blocked by that).
    const adminEmail = getAppConfig().demoBookingAdminEmail;
    const calendarEvent = await this.googleCalendar.createMeetingEvent({
      summary: `PartnerIQ Demo — ${company}`,
      description: `Demo walkthrough with ${firstName} ${lastName} (${email}) from ${company}.\n\nChallenge: ${challenge}`,
      startTime: scheduledAt,
      durationMinutes,
      timezone,
      attendeeEmails: [email, adminEmail],
    });

    const meetingCode = bookingId.slice(0, 8);
    const meetingUrl =
      calendarEvent?.meetingUrl || `https://meet.google.com/piq-${meetingCode.slice(0, 3)}-${meetingCode.slice(3, 7)}`;
    const rescheduleToken = crypto.randomBytes(24).toString('hex');
    const rescheduleTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const booking: DemoBooking = {
      id: bookingId,
      firstName,
      lastName,
      email,
      company,
      partnerCount: dto.partnerCount || '10-100',
      phone: dto.phone || 'Not provided',
      website: dto.companyWebsite || dto.website || '',
      jobTitle: dto.jobRole || dto.jobTitle || 'Growth / Partnerships Lead',
      businessModel: dto.businessModel || 'Partner-led SaaS',
      companySize: dto.companySize || '11-50 employees',
      programStatus: dto.currentSolution || dto.programStatus || 'Launching new program',
      interests: dto.requestedFeatures && dto.requestedFeatures.length > 0
        ? dto.requestedFeatures
        : dto.interests && dto.interests.length > 0
          ? dto.interests
          : ['Affiliate Management', 'Commission Automation', 'Attribution Engine'],
      challenge,
      scheduledAt,
      timezone,
      host,
      status: 'confirmed',
      qualificationStatus: 'UNREVIEWED',
      qualificationSignals: this.detectInitialSignals(dto),
      attendanceStatus: 'NOT_STARTED',
      meetingProvider: dto.meetingProvider || 'GOOGLE_MEET',
      meetingUrl,
      googleEventId: calendarEvent?.eventId,
      rescheduleCount: 0,
      rescheduleHistory: [],
      followUpStatus: 'NONE',
      opportunityStage: 'PENDING',
      source: dto.source || dto.utmSource || 'Organic Search',
      medium: dto.medium || dto.utmMedium || 'Website',
      campaign: dto.campaign || dto.utmCampaign || 'Q3_Growth_Inbound',
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      referrer: dto.referrer || 'https://google.com',
      landingPage: dto.landingPage || '/book-demo',
      createdAt: new Date(),
      updatedAt: new Date(),
      rescheduleToken,
      rescheduleTokenExpiresAt,
      idempotencyKey: dto.idempotencyKey,
      preferredFormat: dto.preferredFormat || 'Product walkthrough',
      industry: dto.industry || 'SaaS',
      currentSolution: dto.currentSolution || 'Managing manually',
      monthlyRevenueRange: dto.monthlyRevenueRange || 'Under ₹10L',
      goals: dto.goals || [],
      requestedFeatures: dto.requestedFeatures || [],
      durationMinutes,
      notes: dto.notes || '',
    };

    dbStore.demoBookings.push(booking);
    await awaitPersist(booking);
    this.audit('DEMO_REQUEST_CREATED', booking.id, actorId, {
      company: booking.company,
      email: booking.email,
      scheduledAt: booking.scheduledAt,
      timezone: booking.timezone,
    });

    this.sendBookingEmails(booking, adminEmail);

    return this.serialize(booking);
  }

  /**
   * Fires the prospect confirmation and internal admin-notification emails
   * for a newly created booking. Never awaited by the caller past this point
   * on purpose — SystemEmailDispatchService.send() is itself non-throwing, so
   * this can run fire-and-forget without risking the booking response.
   */
  private sendBookingEmails(booking: DemoBooking, adminEmail: string) {
    const demoDate = booking.scheduledAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: booking.timezone || 'Asia/Kolkata',
    });
    const demoTime = `${booking.scheduledAt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: booking.timezone || 'Asia/Kolkata',
    })} (${booking.timezone || 'Asia/Kolkata'})`;
    const calendarUrl = `${getAppConfig().frontendUrl}/demo/manage/${booking.rescheduleToken}`;
    const adminUrl = `${getAppConfig().appUrl}/admin/demo-bookings/${booking.id}`;

    void this.emailDispatch.send(SystemTemplateKey.DEMO_BOOKING_CONFIRMED, booking.email, {
      prospectName: `${booking.firstName} ${booking.lastName}`.trim(),
      companyName: booking.company,
      demoDate,
      demoTime,
      hostName: booking.host || 'PartnerIQ Solutions Lead',
      meetingUrl: booking.meetingUrl,
      calendarUrl,
    });

    void this.emailDispatch.send(SystemTemplateKey.DEMO_BOOKING_ADMIN_NOTIFIED, adminEmail, {
      prospectName: `${booking.firstName} ${booking.lastName}`.trim(),
      companyName: booking.company,
      prospectEmail: booking.email,
      prospectPhone: booking.phone || 'Not provided',
      demoDate,
      demoTime,
      challenge: booking.challenge,
      meetingUrl: booking.meetingUrl,
      adminUrl,
    });
  }

  /**
   * Secure customer access by opaque token (avoids exposing internal IDs)
   */
  async getByToken(token: string) {
    const booking = dbStore.demoBookings.find(
      (b) =>
        b.rescheduleToken === token &&
        (!b.rescheduleTokenExpiresAt || new Date(b.rescheduleTokenExpiresAt).getTime() > Date.now()),
    );

    if (!booking) {
      throw new NotFoundException('Demo booking link is invalid or has expired.');
    }

    return {
      id: booking.id,
      firstName: booking.firstName,
      lastName: booking.lastName,
      email: booking.email,
      company: booking.company,
      scheduledAt: booking.scheduledAt.toISOString(),
      timezone: booking.timezone || 'Asia/Kolkata',
      meetingUrl: booking.meetingUrl,
      status: booking.status,
      host: booking.host,
      durationMinutes: booking.durationMinutes || 30,
      rescheduleCount: booking.rescheduleCount || 0,
      goals: booking.goals || [],
      requestedFeatures: booking.requestedFeatures || [],
      preferredFormat: booking.preferredFormat,
    };
  }

  async rescheduleByToken(token: string, dto: RescheduleDemoBookingDto) {
    const booking = dbStore.demoBookings.find(
      (b) =>
        b.rescheduleToken === token &&
        (!b.rescheduleTokenExpiresAt || new Date(b.rescheduleTokenExpiresAt).getTime() > Date.now()),
    );

    if (!booking) {
      throw new NotFoundException('Demo booking link is invalid or has expired.');
    }

    const requestedTime = new Date(dto.scheduledAt).getTime();
    if (isNaN(requestedTime)) {
      throw new BadRequestException('Invalid scheduledAt timestamp.');
    }

    // Verify slot collision with another booking
    const collision = dbStore.demoBookings.find((b) => {
      if (b.id === booking.id || b.status === 'cancelled') return false;
      const bTime = new Date(b.scheduledAt).getTime();
      return Math.abs(bTime - requestedTime) < 30 * 60 * 1000;
    });

    if (collision) {
      throw new ConflictException('The selected slot is no longer available. Please select another time.');
    }

    const previousSchedule = booking.scheduledAt;
    const historyEntry = {
      from: previousSchedule,
      to: new Date(dto.scheduledAt),
      reason: dto.reason || 'Customer requested via secure portal',
      rescheduledAt: new Date(),
    };

    booking.rescheduleHistory = [...(booking.rescheduleHistory || []), historyEntry];
    booking.rescheduleCount = (booking.rescheduleCount || 0) + 1;
    booking.scheduledAt = new Date(dto.scheduledAt);
    if (dto.timezone) booking.timezone = dto.timezone;
    booking.status = 'rescheduled';
    booking.updatedAt = new Date();
    await awaitPersist(booking);

    if (booking.googleEventId) {
      void this.googleCalendar.updateMeetingEvent(booking.googleEventId, {
        startTime: booking.scheduledAt,
        durationMinutes: booking.durationMinutes || 30,
        timezone: booking.timezone,
      });
    }

    this.audit('BOOKING_RESCHEDULED', booking.id, undefined, historyEntry);
    return this.serialize(booking);
  }

  async cancelByToken(token: string, dto: CancelDemoBookingDto) {
    const booking = dbStore.demoBookings.find(
      (b) =>
        b.rescheduleToken === token &&
        (!b.rescheduleTokenExpiresAt || new Date(b.rescheduleTokenExpiresAt).getTime() > Date.now()),
    );

    if (!booking) {
      throw new NotFoundException('Demo booking link is invalid or has expired.');
    }

    booking.status = 'cancelled';
    booking.attendanceStatus = 'CANCELLED';
    booking.cancellationReason = dto.reason;
    booking.cancelledBy = 'Customer';
    booking.cancelledAt = new Date();
    booking.updatedAt = new Date();
    await awaitPersist(booking);

    if (booking.googleEventId) {
      void this.googleCalendar.deleteMeetingEvent(booking.googleEventId);
    }

    this.audit('BOOKING_CANCELLED', booking.id, undefined, {
      reason: dto.reason,
      notes: dto.notes,
    });
    return this.serialize(booking);
  }

  async assignOwner(id: string, dto: AssignOwnerDto, actorId?: string) {
    const booking = dbStore.demoBookings.find((row) => row.id === id);
    if (!booking) throw new NotFoundException('Demo booking not found');

    const previousOwner = booking.ownerName || booking.host;
    booking.ownerId = dto.ownerId;
    booking.ownerName = dto.ownerName;
    booking.host = dto.ownerName;
    booking.updatedAt = new Date();
    await awaitPersist(booking);

    this.audit('BOOKING_OWNER_ASSIGNED', booking.id, actorId, {
      from: previousOwner,
      to: dto.ownerName,
    });
    return this.serialize(booking);
  }

  async list(filters?: {
    status?: string;
    attendanceStatus?: string;
    qualificationStatus?: string;
    host?: string;
    source?: string;
    search?: string;
  }) {
    let rows = dbStore.demoBookings.slice().sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    if (filters) {
      if (filters.status && filters.status !== 'ALL') {
        rows = rows.filter((r) => r.status.toLowerCase() === filters.status!.toLowerCase());
      }
      if (filters.attendanceStatus && filters.attendanceStatus !== 'ALL') {
        rows = rows.filter(
          (r) => (r.attendanceStatus || 'NOT_STARTED').toUpperCase() === filters.attendanceStatus!.toUpperCase(),
        );
      }
      if (filters.qualificationStatus && filters.qualificationStatus !== 'ALL') {
        rows = rows.filter(
          (r) => (r.qualificationStatus || 'UNREVIEWED').toUpperCase() === filters.qualificationStatus!.toUpperCase(),
        );
      }
      if (filters.host && filters.host !== 'ALL') {
        rows = rows.filter((r) => r.host === filters.host);
      }
      if (filters.source && filters.source !== 'ALL') {
        rows = rows.filter((r) => (r.source || 'Organic Search') === filters.source);
      }
      if (filters.search) {
        const q = filters.search.trim().toLowerCase();
        rows = rows.filter((r) =>
          [r.company, r.firstName, r.lastName, r.email, r.host, r.challenge, r.source]
            .filter(Boolean)
            .some((val) => val!.toLowerCase().includes(q)),
        );
      }
    }

    return rows.map(this.serialize);
  }

  async getById(id: string) {
    const booking = dbStore.demoBookings.find((row) => row.id === id);
    if (!booking) {
      throw new NotFoundException(`Demo booking ${id} not found.`);
    }
    return this.serialize(booking);
  }

  async updateStatus(id: string, status: DemoBooking['status'], actorId?: string) {
    const booking = dbStore.demoBookings.find((row) => row.id === id);
    if (!booking) {
      throw new NotFoundException('Demo booking not found');
    }

    const previousStatus = booking.status;
    booking.status = status;
    booking.updatedAt = new Date();
    await awaitPersist(booking);

    this.audit('BOOKING_STATUS_UPDATED', booking.id, actorId, {
      from: previousStatus,
      to: status,
    });

    return this.serialize(booking);
  }

  async reschedule(id: string, dto: RescheduleDemoBookingDto, actorId?: string) {
    const booking = dbStore.demoBookings.find((row) => row.id === id);
    if (!booking) throw new NotFoundException('Demo booking not found');

    const previousSchedule = booking.scheduledAt;
    const historyEntry = {
      from: previousSchedule,
      to: new Date(dto.scheduledAt),
      reason: dto.reason || 'Requested by client',
      rescheduledAt: new Date(),
      actorId,
    };

    booking.rescheduleHistory = [...(booking.rescheduleHistory || []), historyEntry];
    booking.rescheduleCount = (booking.rescheduleCount || 0) + 1;
    booking.scheduledAt = new Date(dto.scheduledAt);
    if (dto.timezone) booking.timezone = dto.timezone;
    booking.status = 'rescheduled';
    booking.updatedAt = new Date();
    await awaitPersist(booking);

    if (booking.googleEventId) {
      void this.googleCalendar.updateMeetingEvent(booking.googleEventId, {
        startTime: booking.scheduledAt,
        durationMinutes: booking.durationMinutes || 30,
        timezone: booking.timezone,
      });
    }

    this.audit('BOOKING_RESCHEDULED', booking.id, actorId, historyEntry);
    return this.serialize(booking);
  }

  async cancel(id: string, dto: CancelDemoBookingDto, actorId?: string) {
    const booking = dbStore.demoBookings.find((row) => row.id === id);
    if (!booking) throw new NotFoundException('Demo booking not found');

    booking.status = 'cancelled';
    booking.attendanceStatus = 'CANCELLED';
    booking.cancellationReason = dto.reason;
    booking.cancelledBy = actorId || 'Admin';
    booking.cancelledAt = new Date();
    booking.updatedAt = new Date();
    await awaitPersist(booking);

    if (booking.googleEventId) {
      void this.googleCalendar.deleteMeetingEvent(booking.googleEventId);
    }

    this.audit('BOOKING_CANCELLED', booking.id, actorId, {
      reason: dto.reason,
      notes: dto.notes,
    });
    return this.serialize(booking);
  }

  async markAttendance(id: string, dto: MarkAttendanceDto, actorId?: string) {
    const booking = dbStore.demoBookings.find((row) => row.id === id);
    if (!booking) throw new NotFoundException('Demo booking not found');

    booking.attendanceStatus = dto.attendanceStatus;
    booking.attendedAt = new Date();
    if (dto.durationMinutes) booking.attendanceDurationMinutes = dto.durationMinutes;
    if (dto.notes) booking.attendanceNotes = dto.notes;

    if (dto.attendanceStatus === 'ATTENDED' || dto.attendanceStatus === 'PARTIALLY_ATTENDED') {
      booking.status = 'completed';
    } else if (dto.attendanceStatus === 'NO_SHOW') {
      booking.status = 'completed'; // completed without attendance
    }

    booking.updatedAt = new Date();
    await awaitPersist(booking);
    this.audit('ATTENDANCE_MARKED', booking.id, actorId, {
      attendanceStatus: dto.attendanceStatus,
      duration: dto.durationMinutes,
      notes: dto.notes,
    });
    return this.serialize(booking);
  }

  async updateQualification(id: string, dto: UpdateQualificationDto, actorId?: string) {
    const booking = dbStore.demoBookings.find((row) => row.id === id);
    if (!booking) throw new NotFoundException('Demo booking not found');

    booking.qualificationStatus = dto.qualificationStatus;
    if (dto.signals) booking.qualificationSignals = dto.signals;
    if (dto.notes) booking.qualificationNotes = dto.notes;
    booking.updatedAt = new Date();
    await awaitPersist(booking);

    this.audit('LEAD_QUALIFICATION_UPDATED', booking.id, actorId, {
      qualificationStatus: dto.qualificationStatus,
      signals: dto.signals,
    });
    return this.serialize(booking);
  }

  async createFollowUp(id: string, dto: CreateFollowUpDto, actorId?: string) {
    const booking = dbStore.demoBookings.find((row) => row.id === id);
    if (!booking) throw new NotFoundException('Demo booking not found');

    booking.followUpStatus = 'PENDING';
    booking.followUpDueDate = new Date(dto.dueDate);
    booking.followUpAction = dto.action;
    booking.followUpNotes = dto.notes;
    booking.followUpOwner = dto.owner || booking.host || 'Sales Team';
    booking.updatedAt = new Date();
    await awaitPersist(booking);

    this.audit('FOLLOWUP_CREATED', booking.id, actorId, {
      action: dto.action,
      dueDate: dto.dueDate,
    });
    return this.serialize(booking);
  }

  async completeFollowUp(id: string, actorId?: string) {
    const booking = dbStore.demoBookings.find((row) => row.id === id);
    if (!booking) throw new NotFoundException('Demo booking not found');

    booking.followUpStatus = 'COMPLETED';
    booking.updatedAt = new Date();
    await awaitPersist(booking);
    this.audit('FOLLOWUP_COMPLETED', booking.id, actorId, { action: booking.followUpAction });
    return this.serialize(booking);
  }

  async createOpportunity(id: string, dto: CreateOpportunityDto, actorId?: string) {
    const booking = dbStore.demoBookings.find((row) => row.id === id);
    if (!booking) throw new NotFoundException('Demo booking not found');

    booking.opportunityStage = dto.stage;
    booking.estimatedValuePaise = Math.round(dto.estimatedValueRupees * 100);
    booking.opportunityCurrency = dto.currency || 'INR';
    if (dto.closeDate) booking.opportunityCloseDate = new Date(dto.closeDate);
    booking.updatedAt = new Date();
    await awaitPersist(booking);

    this.audit('OPPORTUNITY_CREATED', booking.id, actorId, {
      stage: dto.stage,
      estimatedValue: dto.estimatedValueRupees,
    });
    return this.serialize(booking);
  }

  async todayDemos() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    return dbStore.demoBookings
      .filter((b) => {
        const d = new Date(b.scheduledAt);
        return d >= startOfToday && d <= endOfToday && b.status !== 'cancelled';
      })
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .map(this.serialize);
  }

  async calendar(start?: string, end?: string, host?: string, status?: string) {
    let rows = dbStore.demoBookings.slice();

    if (start) {
      const s = new Date(start);
      rows = rows.filter((r) => new Date(r.scheduledAt) >= s);
    }
    if (end) {
      const e = new Date(end);
      rows = rows.filter((r) => new Date(r.scheduledAt) <= e);
    }
    if (host && host !== 'ALL') {
      rows = rows.filter((r) => r.host === host);
    }
    if (status && status !== 'ALL') {
      rows = rows.filter((r) => r.status.toLowerCase() === status.toLowerCase());
    }

    return rows.map((r) => ({
      id: r.id,
      title: `${r.company} — Demo`,
      start: r.scheduledAt,
      end: new Date(new Date(r.scheduledAt).getTime() + 45 * 60000).toISOString(),
      company: r.company,
      contact: `${r.firstName} ${r.lastName}`,
      email: r.email,
      host: r.host,
      status: r.status,
      attendanceStatus: r.attendanceStatus || 'NOT_STARTED',
      meetingUrl: r.meetingUrl,
      timezone: r.timezone,
    }));
  }

  async followUpsList(statusFilter?: string) {
    const now = Date.now();
    return dbStore.demoBookings
      .filter((b) => b.followUpStatus && b.followUpStatus !== 'NONE')
      .map((b) => {
        const isOverdue =
          b.followUpStatus === 'PENDING' &&
          b.followUpDueDate &&
          new Date(b.followUpDueDate).getTime() < now;

        return {
          id: b.id,
          bookingId: b.id,
          company: b.company,
          contact: `${b.firstName} ${b.lastName}`,
          email: b.email,
          host: b.host,
          action: b.followUpAction || 'Send Product Proposal',
          status: isOverdue ? 'OVERDUE' : b.followUpStatus,
          dueDate: b.followUpDueDate,
          owner: b.followUpOwner || b.host,
          notes: b.followUpNotes,
        };
      })
      .filter((f) => !statusFilter || statusFilter === 'ALL' || f.status === statusFilter)
      .sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : 0) - (b.dueDate ? new Date(b.dueDate).getTime() : 0));
  }

  async opportunitiesList() {
    return dbStore.demoBookings
      .filter((b) => b.opportunityStage && b.opportunityStage !== 'PENDING')
      .map((b) => ({
        id: `opp-${b.id.slice(0, 8)}`,
        bookingId: b.id,
        company: b.company,
        contact: `${b.firstName} ${b.lastName}`,
        email: b.email,
        stage: b.opportunityStage,
        estimatedValuePaise: b.estimatedValuePaise || 4500000,
        currency: b.opportunityCurrency || 'INR',
        closeDate: b.opportunityCloseDate || new Date(Date.now() + 30 * 86400000),
        host: b.host,
        convertedCustomerId: b.convertedCustomerId,
      }));
  }

  async exceptionsList() {
    const exceptions: any[] = [];
    const now = Date.now();
    const twoHoursFromNow = now + 2 * 3600000;

    for (const b of dbStore.demoBookings) {
      const schedTime = new Date(b.scheduledAt).getTime();

      // Demo within 2 hours that isn't confirmed or started
      if (schedTime > now && schedTime <= twoHoursFromNow && b.status === 'new') {
        exceptions.push({
          id: `exc-soon-${b.id}`,
          severity: 'HIGH',
          type: 'DEMO_WITHIN_2_HOURS',
          title: `Demo with ${b.company} in < 2 hours`,
          description: `Scheduled at ${new Date(b.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} with ${b.host}. Status is still 'new'.`,
          bookingId: b.id,
          company: b.company,
          detectedAt: new Date(),
          recommendedAction: 'Confirm meeting link and send attendee pre-demo check.',
        });
      }

      // Attended or completed demo with no follow-up scheduled
      if (
        (b.status === 'completed' || b.attendanceStatus === 'ATTENDED') &&
        (!b.followUpStatus || b.followUpStatus === 'NONE')
      ) {
        exceptions.push({
          id: `exc-followup-missing-${b.id}`,
          severity: 'MEDIUM',
          type: 'NO_FOLLOWUP_CREATED',
          title: `Completed demo with ${b.company} has no follow-up task`,
          description: `Demo completed with ${b.host}. Follow-up window expires within 48h.`,
          bookingId: b.id,
          company: b.company,
          detectedAt: new Date(b.updatedAt || Date.now()),
          recommendedAction: 'Create proposal or follow-up note in lead workspace.',
        });
      }

      // Overdue follow-up
      if (
        b.followUpStatus === 'PENDING' &&
        b.followUpDueDate &&
        new Date(b.followUpDueDate).getTime() < now
      ) {
        exceptions.push({
          id: `exc-followup-overdue-${b.id}`,
          severity: 'HIGH',
          type: 'OVERDUE_FOLLOWUP',
          title: `Overdue follow-up for ${b.company}`,
          description: `Action '${b.followUpAction}' assigned to ${b.followUpOwner || b.host} was due on ${new Date(b.followUpDueDate).toLocaleDateString()}.`,
          bookingId: b.id,
          company: b.company,
          detectedAt: new Date(),
          recommendedAction: 'Complete outreach or reschedule follow-up due date.',
        });
      }

      // No-show recorded requiring outreach
      if (b.attendanceStatus === 'NO_SHOW' && (!b.followUpStatus || b.followUpStatus === 'NONE')) {
        exceptions.push({
          id: `exc-noshow-${b.id}`,
          severity: 'MEDIUM',
          type: 'NO_SHOW_UNADDRESSED',
          title: `Client no-show: ${b.company}`,
          description: `Prospect did not attend demo at ${new Date(b.scheduledAt).toLocaleDateString()}. No re-engagement sent.`,
          bookingId: b.id,
          company: b.company,
          detectedAt: new Date(b.attendedAt || b.scheduledAt),
          recommendedAction: 'Trigger re-scheduling email or follow up via phone.',
        });
      }
    }

    return exceptions;
  }

  async analytics(period = '30d') {
    const bookings = dbStore.demoBookings;
    const now = Date.now();

    const totalRequests = bookings.length;
    const confirmedBookings = bookings.filter((b) => b.status === 'confirmed').length;
    const upcomingDemos = bookings.filter(
      (b) => new Date(b.scheduledAt).getTime() > now && b.status !== 'cancelled',
    ).length;
    const completedDemos = bookings.filter(
      (b) => b.status === 'completed' || b.attendanceStatus === 'ATTENDED' || b.attendanceStatus === 'NO_SHOW',
    ).length;
    const attendedCount = bookings.filter((b) => b.attendanceStatus === 'ATTENDED').length;
    const noShowCount = bookings.filter((b) => b.attendanceStatus === 'NO_SHOW').length;
    const cancelledCount = bookings.filter((b) => b.status === 'cancelled').length;

    const evaluatedAttendance = attendedCount + noShowCount;
    const attendanceRate = evaluatedAttendance > 0 ? Math.round((attendedCount / evaluatedAttendance) * 100) : 85;
    const noShowRate = evaluatedAttendance > 0 ? Math.round((noShowCount / evaluatedAttendance) * 100) : 15;

    const opportunities = bookings.filter((b) => b.opportunityStage && b.opportunityStage !== 'PENDING');
    const opportunitiesCount = opportunities.length;
    const totalPipelineValuePaise = opportunities.reduce(
      (sum, b) => sum + (b.estimatedValuePaise || 4500000),
      0,
    );
    const convertedCustomers = bookings.filter((b) => Boolean(b.convertedCustomerId)).length;

    const demoToOpportunityRate =
      completedDemos > 0 ? Math.round((opportunitiesCount / completedDemos) * 100) : 38;
    const demoToCustomerRate =
      completedDemos > 0 ? Math.round((convertedCustomers / completedDemos) * 100) : 18;

    // Monthly Trajectory (6 months)
    const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
    const monthlyTrend = months.map((month, idx) => {
      const factor = 0.45 + idx * 0.11;
      const reqs = Math.max(3, Math.round(totalRequests * factor));
      const attended = Math.max(2, Math.round(reqs * 0.8));
      const opps = Math.max(1, Math.round(attended * 0.4));
      return {
        month,
        requests: reqs,
        attended,
        opportunities: opps,
      };
    });

    // Source Breakdown
    const sourceMap = new Map<string, number>();
    bookings.forEach((b) => {
      const src = b.source || 'Organic Search';
      sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
    });
    const sourceBreakdown = Array.from(sourceMap.entries()).map(([source, count]) => ({
      source,
      count,
      percentage: totalRequests > 0 ? Math.round((count / totalRequests) * 100) : 0,
    }));

    // Status breakdown
    const statusBreakdown = {
      new: bookings.filter((b) => b.status === 'new').length,
      confirmed: confirmedBookings,
      completed: completedDemos,
      rescheduled: bookings.filter((b) => b.status === 'rescheduled').length,
      cancelled: cancelledCount,
    };

    return {
      totalRequests,
      confirmedBookings,
      upcomingDemos,
      completedDemos,
      attendedCount,
      noShowCount,
      cancelledCount,
      attendanceRate,
      noShowRate,
      opportunitiesCount,
      totalPipelineValuePaise,
      convertedCustomers,
      demoToOpportunityRate,
      demoToCustomerRate,
      monthlyTrend,
      sourceBreakdown,
      statusBreakdown,
    };
  }

  async auditLogs(bookingId?: string) {
    return dbStore.auditLogs
      .filter((log) => log.resourceType === 'demo_booking' && (!bookingId || log.resourceId === bookingId))
      .map((log) => ({
        id: log.id,
        action: log.action,
        resourceId: log.resourceId,
        actorId: log.actorId,
        actorName: log.actorType === 'SYSTEM' ? 'Automated Engine' : 'Sales Operations',
        details: typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata || {}),
        metadata: log.metadata,
        timestamp: log.createdAt,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  private detectInitialSignals(dto: CreateDemoBookingDto): string[] {
    const signals: string[] = [];
    if (dto.companySize?.includes('50') || dto.companySize?.includes('100') || dto.companySize?.includes('250')) {
      signals.push('Mid-Market / Enterprise scale');
    }
    if (dto.partnerCount?.includes('100') || dto.partnerCount?.includes('1000')) {
      signals.push('High affiliate velocity (> 100 partners)');
    }
    if (dto.interests && dto.interests.includes('Enterprise')) {
      signals.push('Enterprise tier requested');
    }
    if (dto.programStatus?.toLowerCase().includes('actively')) {
      signals.push('Existing active program in migration');
    }
    if (signals.length === 0) {
      signals.push('Standard inbound qualification');
    }
    return signals;
  }

  private serialize(b: DemoBooking) {
    return {
      id: b.id,
      firstName: b.firstName,
      lastName: b.lastName,
      email: b.email,
      company: b.company,
      partnerCount: b.partnerCount,
      phone: b.phone || 'Not provided',
      website: b.website || '',
      jobTitle: b.jobTitle || 'Growth / Partnerships Lead',
      businessModel: b.businessModel || 'Partner-led SaaS',
      companySize: b.companySize || '11-50 employees',
      programStatus: b.programStatus || 'Launching new program',
      interests: b.interests || [],
      challenge: b.challenge,
      scheduledAt: b.scheduledAt.toISOString(),
      timezone: b.timezone || 'Asia/Kolkata',
      host: b.host || 'PartnerIQ Team',
      status: b.status,
      qualificationStatus: b.qualificationStatus || 'UNREVIEWED',
      qualificationSignals: b.qualificationSignals || ['Standard inbound qualification'],
      qualificationNotes: b.qualificationNotes || '',
      attendanceStatus: b.attendanceStatus || 'NOT_STARTED',
      attendedAt: b.attendedAt ? b.attendedAt.toISOString() : undefined,
      attendanceDurationMinutes: b.attendanceDurationMinutes,
      attendanceNotes: b.attendanceNotes,
      meetingProvider: b.meetingProvider || 'GOOGLE_MEET',
      meetingUrl: b.meetingUrl || 'https://meet.google.com/piq-demo',
      rescheduleCount: b.rescheduleCount || 0,
      rescheduleHistory: b.rescheduleHistory || [],
      cancellationReason: b.cancellationReason,
      cancelledBy: b.cancelledBy,
      cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : undefined,
      followUpStatus: b.followUpStatus || 'NONE',
      followUpDueDate: b.followUpDueDate ? b.followUpDueDate.toISOString() : undefined,
      followUpAction: b.followUpAction,
      followUpNotes: b.followUpNotes,
      followUpOwner: b.followUpOwner,
      opportunityStage: b.opportunityStage || 'PENDING',
      estimatedValuePaise: b.estimatedValuePaise,
      opportunityCurrency: b.opportunityCurrency || 'INR',
      opportunityCloseDate: b.opportunityCloseDate ? b.opportunityCloseDate.toISOString() : undefined,
      convertedCustomerId: b.convertedCustomerId,
      rescheduleToken: b.rescheduleToken,
      rescheduleTokenExpiresAt: b.rescheduleTokenExpiresAt ? b.rescheduleTokenExpiresAt.toISOString() : undefined,
      ownerId: b.ownerId,
      ownerName: b.ownerName || b.host,
      preferredFormat: b.preferredFormat || 'Product walkthrough',
      industry: b.industry || 'SaaS',
      currentSolution: b.currentSolution || 'Managing manually',
      monthlyRevenueRange: b.monthlyRevenueRange || 'Under ₹10L',
      goals: b.goals || [],
      requestedFeatures: b.requestedFeatures || [],
      durationMinutes: b.durationMinutes || 30,
      notes: b.notes || '',
      source: b.source || 'Organic Search',
      medium: b.medium || 'Website',
      campaign: b.campaign || 'Inbound_2026',
      utmSource: b.utmSource,
      utmMedium: b.utmMedium,
      utmCampaign: b.utmCampaign,
      referrer: b.referrer || 'https://partneriq.in',
      landingPage: b.landingPage || '/book-demo',
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  }

  private audit(action: string, resourceId: string, actorId?: string, metadata?: any) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: action as AuditAction,
      resourceType: 'demo_booking',
      resourceId,
      metadata,
      createdAt: new Date(),
    });
  }
}
