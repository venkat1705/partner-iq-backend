import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { getAppConfig } from '../../config/app.config';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';

const GOOGLE_CALENDAR_EVENTS_ENDPOINT = (calendarId: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

export interface CreateMeetingEventInput {
  summary: string;
  description?: string;
  startTime: Date;
  durationMinutes: number;
  timezone?: string;
  attendeeEmails: string[];
}

export interface UpdateMeetingEventInput {
  startTime: Date;
  durationMinutes: number;
  timezone?: string;
}

export interface MeetingEventResult {
  eventId: string;
  meetingUrl: string;
  htmlLink?: string;
}

/**
 * Creates real Google Calendar events with a Google Meet conference attached
 * for demo bookings. Access tokens come from GoogleCalendarOAuthService,
 * which sources them from the admin's "Connect Google Calendar" OAuth
 * connection (stored encrypted in the database, refreshed proactively) —
 * see google-calendar-oauth.service.ts for the connect/refresh flow itself.
 *
 * Mirrors the raw-fetch style of GoogleOAuthService rather than pulling in
 * the googleapis SDK, to stay consistent with how the rest of this codebase
 * talks to Google's APIs.
 *
 * Every public method is non-throwing: a booking must never fail just
 * because Calendar API is unreachable or misconfigured/not connected yet.
 * Callers get `null` back and fall back to their own placeholder behavior.
 */
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(private readonly oauth: GoogleCalendarOAuthService) { }

  /**
   * Creates a calendar event with a Google Meet conference and invites the
   * given attendees. Returns the real meet.google.com link, or null if
   * Calendar isn't connected or the API call fails.
   */
  async createMeetingEvent(input: CreateMeetingEventInput): Promise<MeetingEventResult | null> {
    const accessToken = await this.oauth.getValidAccessToken();
    if (!accessToken) {
      this.logger.debug('Google Calendar not connected — skipping real event creation.');
      return null;
    }

    const config = getAppConfig();
    const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60 * 1000);
    const timezone = input.timezone || 'Asia/Kolkata';
    const requestId = randomUUID();

    const eventBody = {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startTime.toISOString(), timeZone: timezone },
      end: { dateTime: endTime.toISOString(), timeZone: timezone },
      attendees: input.attendeeEmails.map((email) => ({ email })),
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: { useDefault: true },
    };

    try {
      const url = `${GOOGLE_CALENDAR_EVENTS_ENDPOINT(config.googleCalendarId)}?conferenceDataVersion=1&sendUpdates=all`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Google Calendar event creation failed (${response.status}): ${errorBody}`);
        return null;
      }

      const data = (await response.json()) as {
        id?: string;
        hangoutLink?: string;
        htmlLink?: string;
        conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
      };

      const meetingUrl =
        data.hangoutLink ||
        data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ||
        null;

      if (!data.id || !meetingUrl) {
        this.logger.warn('Google Calendar event created but no Meet link was returned in the response.');
        return null;
      }

      return { eventId: data.id, meetingUrl, htmlLink: data.htmlLink };
    } catch (err: any) {
      this.logger.error(`Google Calendar event creation network error: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Moves an existing event to a new start/end time (demo rescheduled).
   */
  async updateMeetingEvent(eventId: string, input: UpdateMeetingEventInput): Promise<boolean> {
    if (!eventId) return false;

    const accessToken = await this.oauth.getValidAccessToken();
    if (!accessToken) return false;

    const config = getAppConfig();
    const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60 * 1000);
    const timezone = input.timezone || 'Asia/Kolkata';

    try {
      const url = `${GOOGLE_CALENDAR_EVENTS_ENDPOINT(config.googleCalendarId)}/${encodeURIComponent(eventId)}?sendUpdates=all`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          start: { dateTime: input.startTime.toISOString(), timeZone: timezone },
          end: { dateTime: endTime.toISOString(), timeZone: timezone },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Google Calendar event update failed (${response.status}): ${errorBody}`);
        return false;
      }

      return true;
    } catch (err: any) {
      this.logger.error(`Google Calendar event update network error: ${err?.message || err}`);
      return false;
    }
  }

  /**
   * Cancels/deletes an existing event (demo cancelled).
   */
  async deleteMeetingEvent(eventId: string): Promise<boolean> {
    if (!eventId) return false;

    const accessToken = await this.oauth.getValidAccessToken();
    if (!accessToken) return false;

    const config = getAppConfig();

    try {
      const url = `${GOOGLE_CALENDAR_EVENTS_ENDPOINT(config.googleCalendarId)}/${encodeURIComponent(eventId)}?sendUpdates=all`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      // Google returns 410 Gone if the event was already deleted — treat as success.
      if (!response.ok && response.status !== 410) {
        const errorBody = await response.text();
        this.logger.error(`Google Calendar event deletion failed (${response.status}): ${errorBody}`);
        return false;
      }

      return true;
    } catch (err: any) {
      this.logger.error(`Google Calendar event deletion network error: ${err?.message || err}`);
      return false;
    }
  }
}
