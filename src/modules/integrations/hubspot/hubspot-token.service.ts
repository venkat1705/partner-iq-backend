import { BadRequestException, Injectable } from '@nestjs/common';
import { dbStore, awaitPersist } from '../../../database/store';
import { OrganizationIntegrationStatus } from '../../../common/enums';
import { IntegrationCredentialService } from '../integration-credential.service';
import { HUBSPOT_PROVIDER } from './hubspot.constants';
import { NotificationsService } from '../../notifications/notifications.service';
import { SystemEmailDispatchService } from '../../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../../email-design/constants/email-template-keys';
import { getAppConfig } from '../../../config/app.config';

type TokenResponse = {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  expires_in?: number;
  expiresIn?: number;
  hub_id?: number;
  hubId?: number;
  scope?: string;
  scopes?: string[];
};

@Injectable()
export class HubSpotTokenService {
  private readonly refreshLocks = new Map<string, Promise<string>>();

  constructor(
    private readonly credentials: IntegrationCredentialService,
    private readonly notificationsService?: NotificationsService,
    private readonly emailDispatch?: SystemEmailDispatchService,
  ) {}

  async getAccessToken(connectionId: string) {
    const expiresAt = Number(this.safeGet(connectionId, 'access_token_expires_at') || 0);
    if (expiresAt > Date.now() + 120_000) {
      return this.credentials.getCredential(connectionId, 'access_token');
    }

    const locked = this.refreshLocks.get(connectionId);
    if (locked) return locked;

    const promise = this.refreshAccessToken(connectionId).finally(() => this.refreshLocks.delete(connectionId));
    this.refreshLocks.set(connectionId, promise);
    return promise;
  }

  async exchangeAuthorizationCode(connectionId: string, code: string, config: { clientId: string; clientSecret: string; redirectUri: string }) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    });
    const token = await this.postToken(body);
    await this.storeTokenSet(connectionId, token);
    return token;
  }

  async refreshAccessToken(connectionId: string) {
    const connection = dbStore.organizationIntegrations.find((item) => item.id === connectionId);
    const config = dbStore.integrationPlatformConfigs.find((item) => item.provider === HUBSPOT_PROVIDER);
    if (!connection || !config) throw new BadRequestException('HubSpot connection is not configured');

    try {
      const refreshToken = this.credentials.getCredential(connectionId, 'refresh_token');
      const clientId = this.credentials.getCredential(config.id, 'client_id');
      const clientSecret = this.credentials.getCredential(config.id, 'client_secret');
      const token = await this.postToken(new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }));
      await this.storeTokenSet(connectionId, token);
      connection.status = OrganizationIntegrationStatus.CONNECTED;
      connection.lastError = undefined;
      await awaitPersist(connection);
      return this.credentials.getCredential(connectionId, 'access_token');
    } catch {
      // Only notify on the transition into a broken state — not on every retried
      // API call while it stays broken — otherwise this would spam the org.
      const wasAlreadyBroken = connection.status === OrganizationIntegrationStatus.AUTHENTICATION_ERROR;
      connection.status = OrganizationIntegrationStatus.AUTHENTICATION_ERROR;
      connection.lastError = 'HubSpot authentication failed. Reconnect HubSpot.';
      await awaitPersist(connection);
      if (!wasAlreadyBroken) {
        this.notifyIntegrationDisconnected(connection, 'HubSpot access was revoked and the connection could not refresh').catch(() => undefined);
      }
      throw new BadRequestException('HubSpot authentication failed. Reconnect HubSpot.');
    }
  }

  /**
   * Fires both the in-app notification and the "Integration Disconnected" email
   * to every active member of the organization. Called whenever we discover —
   * via a failed token refresh, not an explicit in-app "Disconnect" click — that
   * access was revoked on HubSpot's side.
   */
  async notifyIntegrationDisconnected(
    connection: { id: string; organizationId: string },
    reason: string,
  ) {
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
        title: 'HubSpot integration disconnected',
        body: `${reason}. Reconnect in Integrations to resume sync.`,
        channel: 'in_app',
        priority: 'high',
        actionUrl: '/app/integrations',
        metadata: { provider: 'hubspot', organizationIntegrationId: connection.id },
      }).catch(() => undefined);

      const user = dbStore.users.find((u) => u.id === member.userId);
      if (!user?.email) continue;
      this.emailDispatch
        ?.send(
          SystemTemplateKey.INTEGRATION_DISCONNECTED,
          user.email,
          {
            provider: 'HubSpot',
            organizationName: organization?.name || 'Your organization',
            disconnectedBy: reason,
            reconnectUrl,
          },
          { organizationId: connection.organizationId, userId: user.id },
        )
        .catch(() => undefined);
    }
  }

  async storeTokenSet(connectionId: string, token: TokenResponse) {
    const accessToken = token.access_token || token.accessToken;
    const refreshToken = token.refresh_token || token.refreshToken;
    const expiresIn = Number(token.expires_in || token.expiresIn || 1800);
    if (!accessToken) throw new BadRequestException('HubSpot did not return an access token');

    const pending: Promise<unknown>[] = [];
    const accessEntity = this.credentials.storeCredential(connectionId, 'access_token', accessToken);
    if (accessEntity) pending.push(awaitPersist(accessEntity));
    const expiryEntity = this.credentials.storeCredential(connectionId, 'access_token_expires_at', String(Date.now() + expiresIn * 1000));
    if (expiryEntity) pending.push(awaitPersist(expiryEntity));
    if (refreshToken) {
      const refreshEntity = this.credentials.storeCredential(connectionId, 'refresh_token', refreshToken);
      if (refreshEntity) pending.push(awaitPersist(refreshEntity));
    }
    await Promise.all(pending);
  }

  private async postToken(body: URLSearchParams): Promise<TokenResponse> {
    const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `HubSpot OAuth token exchange failed: ${response.status}`;
      try {
        const parsed = text ? JSON.parse(text) : undefined;
        if (parsed && parsed.error_description) message += ` - ${parsed.error_description}`;
        else if (parsed && parsed.error) message += ` - ${parsed.error}`;
      } catch {
        message += ` - ${text}`;
      }
      throw new BadRequestException(message);
    }
    try {
      return JSON.parse(text) as TokenResponse;
    } catch (err) {
      throw new BadRequestException('Invalid JSON from HubSpot token endpoint');
    }
  }

  private safeGet(connectionId: string, key: string) {
    try {
      return this.credentials.getCredential(connectionId, key);
    } catch {
      return undefined;
    }
  }
}
