import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { OrganizationIntegrationStatus } from '../../../common/enums';
import { IntegrationCredentialService } from '../integration-credential.service';
import { RazorpayProvider } from '../providers/razorpay.provider';
import { NotificationsService } from '../../notifications/notifications.service';
import { SystemEmailDispatchService } from '../../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../../email-design/constants/email-template-keys';
import { getAppConfig } from '../../../config/app.config';
import { OAuthTokenResult } from '../providers/provider.interface';

export const RAZORPAY_PROVIDER = 'RAZORPAY';

/** Refresh this far ahead of expiry so an in-flight API call never races the deadline. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Owns the lifecycle of an organization's Razorpay OAuth tokens: transparent
 * refresh before expiry, and revocation on disconnect.
 *
 * Razorpay access tokens are long-lived (90 days) but they DO expire, so a
 * connection made once would silently break without this.
 */
@Injectable()
export class RazorpayTokenService {
  private readonly logger = new Logger(RazorpayTokenService.name);
  private readonly refreshLocks = new Map<string, Promise<string>>();

  constructor(
    private readonly credentials: IntegrationCredentialService,
    private readonly razorpayProvider: RazorpayProvider,
    private readonly notificationsService?: NotificationsService,
    private readonly emailDispatch?: SystemEmailDispatchService,
  ) {}

  /**
   * Returns a valid access token for the connection, refreshing it first if it is
   * expired or about to expire. Concurrent callers share a single refresh.
   */
  async getAccessToken(connectionId: string): Promise<string> {
    const expiresAt = Number(this.safeGet(connectionId, 'access_token_expires_at') || 0);
    const accessToken = this.safeGet(connectionId, 'access_token');

    if (!accessToken) {
      throw new BadRequestException('Razorpay is not connected for this organization.');
    }
    // No recorded expiry means the token came from a response without `expires_in`;
    // use it as-is rather than forcing a refresh that may not be possible.
    if (!expiresAt || expiresAt > Date.now() + REFRESH_SKEW_MS) {
      return accessToken;
    }

    const locked = this.refreshLocks.get(connectionId);
    if (locked) return locked;

    const promise = this.refreshAccessToken(connectionId).finally(() => this.refreshLocks.delete(connectionId));
    this.refreshLocks.set(connectionId, promise);
    return promise;
  }

  async refreshAccessToken(connectionId: string): Promise<string> {
    const connection = dbStore.organizationIntegrations.find((item) => item.id === connectionId);
    const config = this.platformConfig();
    if (!connection || !config) {
      throw new BadRequestException('Razorpay connection is not configured.');
    }

    const refreshToken = this.safeGet(connectionId, 'refresh_token');
    if (!refreshToken) {
      this.markBroken(connection, 'Razorpay did not issue a refresh token. Reconnect Razorpay.');
      throw new BadRequestException('Razorpay did not issue a refresh token. Reconnect Razorpay.');
    }

    try {
      const token = await this.razorpayProvider.refreshOAuthToken({
        refreshToken,
        clientId: this.credentials.getCredential(config.id, 'client_id'),
        clientSecret: this.credentials.getCredential(config.id, 'client_secret'),
        environment: connection.environment as any,
      });

      this.storeTokenSet(connectionId, token);
      connection.status = OrganizationIntegrationStatus.CONNECTED;
      connection.lastError = undefined;
      connection.lastCheckedAt = new Date();
      connection.updatedAt = new Date();
      this.logger.log(`[Razorpay] Refreshed access token for connection ${connectionId}`);
      return token.accessToken;
    } catch (error: any) {
      this.logger.error(`[Razorpay] Token refresh failed for connection ${connectionId}: ${error?.message}`);
      this.markBroken(connection, 'Razorpay authentication failed. Reconnect Razorpay.');
      throw new BadRequestException('Razorpay authentication failed. Reconnect Razorpay.');
    }
  }

  /**
   * Best-effort revocation of both tokens on Razorpay's side when an organization
   * disconnects. Failures are logged and swallowed: a token that Razorpay has
   * already expired or revoked must never block the local disconnect.
   */
  async revokeTokens(connectionId: string): Promise<void> {
    const config = this.platformConfig();
    if (!config) return;

    let clientId: string;
    let clientSecret: string;
    try {
      clientId = this.credentials.getCredential(config.id, 'client_id');
      clientSecret = this.credentials.getCredential(config.id, 'client_secret');
    } catch {
      return;
    }

    const targets: Array<{ token?: string; hint: 'access_token' | 'refresh_token' }> = [
      { token: this.safeGet(connectionId, 'refresh_token'), hint: 'refresh_token' },
      { token: this.safeGet(connectionId, 'access_token'), hint: 'access_token' },
    ];

    for (const target of targets) {
      if (!target.token) continue;
      try {
        await this.razorpayProvider.revokeOAuthToken({
          token: target.token,
          tokenTypeHint: target.hint,
          clientId,
          clientSecret,
        });
        this.logger.log(`[Razorpay] Revoked ${target.hint} for connection ${connectionId}`);
      } catch (error: any) {
        this.logger.warn(`[Razorpay] Could not revoke ${target.hint} for connection ${connectionId}: ${error?.message}`);
      }
    }
  }

  storeTokenSet(connectionId: string, token: OAuthTokenResult) {
    if (!token.accessToken) throw new BadRequestException('Razorpay did not return an access token.');

    this.credentials.storeCredential(connectionId, 'access_token', token.accessToken);
    if (token.refreshToken) {
      this.credentials.storeCredential(connectionId, 'refresh_token', token.refreshToken);
    }
    if (token.expiresIn) {
      this.credentials.storeCredential(
        connectionId,
        'access_token_expires_at',
        String(Date.now() + token.expiresIn * 1000),
      );
    }
    for (const [key, value] of Object.entries(token.extraCredentials || {})) {
      this.credentials.storeCredential(connectionId, key, value);
    }
  }

  private platformConfig() {
    return dbStore.integrationPlatformConfigs.find((item) => item.provider === RAZORPAY_PROVIDER);
  }

  /**
   * Flags the connection as broken and notifies the organization — but only on the
   * transition into that state, so a repeatedly-retried call cannot spam members.
   */
  private markBroken(connection: { id: string; organizationId: string; status: any; lastError?: string }, reason: string) {
    const wasAlreadyBroken = connection.status === OrganizationIntegrationStatus.AUTHENTICATION_ERROR;
    connection.status = OrganizationIntegrationStatus.AUTHENTICATION_ERROR;
    connection.lastError = reason;
    if (!wasAlreadyBroken) {
      this.notifyIntegrationDisconnected(connection, 'Razorpay access was revoked and the connection could not refresh')
        .catch(() => undefined);
    }
  }

  async notifyIntegrationDisconnected(connection: { id: string; organizationId: string }, reason: string) {
    const organization = dbStore.organizations.find((o) => o.id === connection.organizationId);
    const reconnectUrl = `${getAppConfig().frontendUrl.replace(/\/$/, '')}/organizations/${connection.organizationId}/integrations`;
    const members = dbStore.organizationMemberships.filter(
      (m) => m.organizationId === connection.organizationId && m.status === 'ACTIVE',
    );

    for (const member of members) {
      this.notificationsService?.createNotification({
        userId: member.userId,
        organizationId: connection.organizationId,
        type: 'system',
        title: 'Razorpay integration disconnected',
        body: `${reason}. Reconnect in Integrations to resume payment sync.`,
        channel: 'in_app',
        priority: 'high',
        actionUrl: '/app/integrations',
        metadata: { provider: 'razorpay', organizationIntegrationId: connection.id },
      }).catch(() => undefined);

      const user = dbStore.users.find((u) => u.id === member.userId);
      if (!user?.email) continue;
      this.emailDispatch
        ?.send(
          SystemTemplateKey.INTEGRATION_DISCONNECTED,
          user.email,
          {
            provider: 'Razorpay',
            organizationName: organization?.name || 'Your organization',
            disconnectedBy: reason,
            reconnectUrl,
          },
          { organizationId: connection.organizationId, userId: user.id },
        )
        .catch(() => undefined);
    }
  }

  private safeGet(connectionId: string, key: string): string | undefined {
    try {
      return this.credentials.getCredential(connectionId, key);
    } catch {
      return undefined;
    }
  }
}
