import { BadRequestException, Injectable } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { OrganizationIntegrationStatus } from '../../../common/enums';
import { IntegrationCredentialService } from '../integration-credential.service';
import { HUBSPOT_PROVIDER } from './hubspot.constants';

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

  constructor(private readonly credentials: IntegrationCredentialService) {}

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
    this.storeTokenSet(connectionId, token);
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
      this.storeTokenSet(connectionId, token);
      connection.status = OrganizationIntegrationStatus.CONNECTED;
      connection.lastError = undefined;
      return this.credentials.getCredential(connectionId, 'access_token');
    } catch {
      connection.status = OrganizationIntegrationStatus.AUTHENTICATION_ERROR;
      connection.lastError = 'HubSpot authentication failed. Reconnect HubSpot.';
      throw new BadRequestException('HubSpot authentication failed. Reconnect HubSpot.');
    }
  }

  storeTokenSet(connectionId: string, token: TokenResponse) {
    const accessToken = token.access_token || token.accessToken;
    const refreshToken = token.refresh_token || token.refreshToken;
    const expiresIn = Number(token.expires_in || token.expiresIn || 1800);
    if (!accessToken) throw new BadRequestException('HubSpot did not return an access token');

    this.credentials.storeCredential(connectionId, 'access_token', accessToken);
    this.credentials.storeCredential(connectionId, 'access_token_expires_at', String(Date.now() + expiresIn * 1000));
    if (refreshToken) this.credentials.storeCredential(connectionId, 'refresh_token', refreshToken);
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
