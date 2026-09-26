import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { dbStore, awaitPersist } from '../../database/store';
import { GoogleCalendarConnection } from '../../database/schema';
import { getAppConfig } from '../../config/app.config';
import { IntegrationCredentialService } from '../integrations/integration-credential.service';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
// `email` is required alongside calendar.events so the post-connect userinfo
// call (used to show "Connected as x@gmail.com" in the admin UI) actually
// has permission to succeed — calendar.events alone doesn't grant it.
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events email';

/**
 * This is the fixed lookup key for the single platform-wide connection row
 * and its encrypted credential rows — there is intentionally exactly one
 * Google Calendar connection for the whole platform (PartnerIQ's own sales
 * calendar), not one per organization.
 */
export const GOOGLE_CALENDAR_CONNECTION_ID = 'google-calendar-platform-connection';

interface PendingOAuthState {
  createdAt: number;
  adminUserId: string;
  adminEmail: string;
}

export interface GoogleCalendarConnectionStatus {
  connected: boolean;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  connectedEmail?: string;
  connectedByName?: string;
  connectedAt?: Date;
  lastError?: string;
}

/**
 * Handles the OAuth "Connect Google Calendar" dance an admin performs once
 * from the admin dashboard: builds the consent URL, exchanges the returned
 * code for tokens, and persists them (encrypted, via IntegrationCredentialService)
 * plus connection metadata so google-calendar.service.ts can silently keep
 * using a fresh access token afterwards without anyone re-pasting a refresh
 * token into .env.
 *
 * The refresh token itself is long-lived (it doesn't expire on a timer the
 * way access tokens do) as long as the OAuth consent screen isn't left in
 * Google's "Testing" publishing status — Google auto-expires refresh tokens
 * issued by unverified/testing apps after ~7 days regardless of how well
 * this code refreshes things, so once this is live the app should be moved
 * to "In production" (or made an internal app on a Workspace account) for
 * this connection to stay alive indefinitely.
 */
@Injectable()
export class GoogleCalendarOAuthService {
  private readonly logger = new Logger(GoogleCalendarOAuthService.name);

  // Single-instance in-memory CSRF state store — acceptable here because this
  // is a rare, admin-only, human-driven action (not a high-throughput or
  // multi-instance-sensitive flow), unlike the per-organization OAuth states
  // the tenant-integrations framework persists to the database.
  private readonly pendingStates = new Map<string, PendingOAuthState>();
  private static readonly STATE_TTL_MS = 10 * 60 * 1000;

  constructor(private readonly credentials: IntegrationCredentialService) { }

  buildAuthorizationUrl(adminUserId: string, adminEmail: string): string {
    const config = getAppConfig();
    if (!config.googleCalendarClientId) {
      throw new BadRequestException(
        'GOOGLE_CALENDAR_CLIENT_ID is not configured. Set up an OAuth client in Google Cloud Console first.',
      );
    }

    this.pruneExpiredStates();
    const state = randomBytes(24).toString('hex');
    this.pendingStates.set(state, { createdAt: Date.now(), adminUserId, adminEmail });

    const params = new URLSearchParams({
      client_id: config.googleCalendarClientId,
      redirect_uri: config.googleCalendarRedirectUri,
      response_type: 'code',
      scope: CALENDAR_SCOPE,
      access_type: 'offline',
      // Forces Google to re-issue a refresh_token even if this admin account
      // already granted this app access before (Google only returns a
      // refresh_token on the FIRST consent otherwise).
      prompt: 'consent',
      state,
    });

    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<GoogleCalendarConnectionStatus> {
    const pending = this.pendingStates.get(state);
    this.pendingStates.delete(state);
    if (!pending || Date.now() - pending.createdAt > GoogleCalendarOAuthService.STATE_TTL_MS) {
      throw new BadRequestException('This connection request has expired or is invalid. Please try connecting again.');
    }

    const config = getAppConfig();
    const body = new URLSearchParams({
      client_id: config.googleCalendarClientId,
      client_secret: config.googleCalendarClientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.googleCalendarRedirectUri,
    });

    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      this.logger.error(`Google Calendar token exchange failed (${tokenResponse.status}): ${errorBody}`);
      throw new BadRequestException('Google rejected the connection request. Please try again.');
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };

    if (!tokenData.refresh_token) {
      // Happens if the admin previously connected and `prompt=consent` somehow
      // didn't force reissue — surface this clearly rather than silently
      // leaving the old (possibly revoked) refresh token in place.
      this.logger.warn('Google did not return a refresh_token on this connection attempt.');
    }

    const connectedEmail = await this.fetchConnectedEmail(tokenData.access_token);

    await this.credentials.storeCredentials(GOOGLE_CALENDAR_CONNECTION_ID, {
      access_token: tokenData.access_token,
      ...(tokenData.refresh_token ? { refresh_token: tokenData.refresh_token } : {}),
    });

    const connection = this.upsertConnection({
      status: 'CONNECTED',
      connectedEmail,
      connectedByUserId: pending.adminUserId,
      connectedByName: pending.adminEmail,
      scope: tokenData.scope || CALENDAR_SCOPE,
      accessTokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      lastError: undefined,
      connectedAt: new Date(),
    });
    await awaitPersist(connection);

    return this.toStatus(connection);
  }

  async getStatus(): Promise<GoogleCalendarConnectionStatus> {
    const connection = dbStore.googleCalendarConnections.find((c) => c.id === GOOGLE_CALENDAR_CONNECTION_ID);
    if (!connection) {
      return { connected: false, status: 'DISCONNECTED' };
    }
    return this.toStatus(connection);
  }

  async disconnect(): Promise<void> {
    this.credentials.deleteCredentials(GOOGLE_CALENDAR_CONNECTION_ID);
    const connection = this.upsertConnection({
      status: 'DISCONNECTED',
      connectedEmail: undefined,
      connectedByUserId: undefined,
      connectedByName: undefined,
      scope: undefined,
      accessTokenExpiresAt: undefined,
      lastError: undefined,
      connectedAt: undefined,
    });
    await awaitPersist(connection);
  }

  /**
   * Returns a valid (non-expired) access token, transparently refreshing it
   * via the stored refresh_token when it's within 2 minutes of expiring —
   * proactive, not reactive-on-401, matching HubSpot's integration pattern.
   * Returns null if there's no connection, no refresh token, or the refresh
   * call itself fails (in which case the connection is marked ERROR so the
   * admin UI can prompt a reconnect).
   */
  async getValidAccessToken(): Promise<string | null> {
    const connection = dbStore.googleCalendarConnections.find((c) => c.id === GOOGLE_CALENDAR_CONNECTION_ID);
    if (!connection || connection.status !== 'CONNECTED') return null;

    const expiresAt = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : 0;
    const stillValid = expiresAt > Date.now() + 2 * 60 * 1000;

    if (stillValid) {
      try {
        return this.credentials.getCredential(GOOGLE_CALENDAR_CONNECTION_ID, 'access_token');
      } catch {
        // Fall through to refresh if the cached access token is somehow missing.
      }
    }

    let refreshToken: string;
    try {
      refreshToken = this.credentials.getCredential(GOOGLE_CALENDAR_CONNECTION_ID, 'refresh_token');
    } catch {
      await this.markError('No refresh token on file — please reconnect Google Calendar.');
      return null;
    }

    const config = getAppConfig();
    const body = new URLSearchParams({
      client_id: config.googleCalendarClientId,
      client_secret: config.googleCalendarClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    try {
      const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Google Calendar access token refresh failed (${response.status}): ${errorBody}`);
        await this.markError(`Token refresh failed (${response.status}). Please reconnect Google Calendar.`);
        return null;
      }

      const data = (await response.json()) as { access_token: string; expires_in: number };
      this.credentials.storeCredential(GOOGLE_CALENDAR_CONNECTION_ID, 'access_token', data.access_token);
      const updated = this.upsertConnection({
        accessTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
        lastError: undefined,
      });
      await awaitPersist(updated);

      return data.access_token;
    } catch (err: any) {
      this.logger.error(`Google Calendar access token refresh network error: ${err?.message || err}`);
      await this.markError(`Token refresh network error: ${err?.message || 'unknown'}. Please reconnect Google Calendar.`);
      return null;
    }
  }

  private async markError(message: string) {
    const connection = this.upsertConnection({ status: 'ERROR', lastError: message });
    await awaitPersist(connection);
  }

  private upsertConnection(patch: Partial<GoogleCalendarConnection>): GoogleCalendarConnection {
    const existing = dbStore.googleCalendarConnections.find((c) => c.id === GOOGLE_CALENDAR_CONNECTION_ID);
    if (existing) {
      Object.assign(existing, patch, { updatedAt: new Date() });
      return existing;
    }
    const created: GoogleCalendarConnection = {
      id: GOOGLE_CALENDAR_CONNECTION_ID,
      status: 'DISCONNECTED',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...patch,
    };
    dbStore.googleCalendarConnections.push(created);
    return created;
  }

  private toStatus(connection: GoogleCalendarConnection): GoogleCalendarConnectionStatus {
    return {
      connected: connection.status === 'CONNECTED',
      status: connection.status,
      connectedEmail: connection.connectedEmail,
      connectedByName: connection.connectedByName,
      connectedAt: connection.connectedAt,
      lastError: connection.lastError,
    };
  }

  private async fetchConnectedEmail(accessToken: string): Promise<string | undefined> {
    try {
      const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!response.ok) return undefined;
      const data = (await response.json()) as { email?: string };
      return data.email;
    } catch {
      return undefined;
    }
  }

  private pruneExpiredStates() {
    const now = Date.now();
    for (const [key, value] of this.pendingStates) {
      if (now - value.createdAt > GoogleCalendarOAuthService.STATE_TTL_MS) {
        this.pendingStates.delete(key);
      }
    }
  }
}
