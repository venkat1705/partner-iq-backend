import { BadRequestException, Injectable } from '@nestjs/common';
import {
  IntegrationProvider,
  IntegrationTestResult,
  OAuthAuthorizationUrlParams,
  OAuthCodeExchangeParams,
  OAuthRefreshParams,
  OAuthRevokeParams,
  OAuthTokenResult,
} from './provider.interface';

// Razorpay OAuth: https://razorpay.com/docs/partners/technology-partners/onboard-businesses/integrate-oauth/
const RAZORPAY_AUTHORIZE_URL = 'https://auth.razorpay.com/authorize';
const RAZORPAY_TOKEN_URL = 'https://auth.razorpay.com/token';
const RAZORPAY_REVOKE_URL = 'https://auth.razorpay.com/revoke';

/** Scopes Razorpay accepts on /authorize. Anything else is rejected at the consent screen. */
const RAZORPAY_VALID_SCOPES = ['read_only', 'read_write', 'rx_read_only', 'rx_read_write', 'rx_partner_read_write'];

@Injectable()
export class RazorpayProvider implements IntegrationProvider {
  readonly provider = 'RAZORPAY';
  readonly category = 'PAYMENTS';

  getOAuthAuthorizationUrl(params: OAuthAuthorizationUrlParams): string {
    const requested = params.scopes?.length ? params.scopes : ['read_write'];
    const scopes = requested.filter((scope) => RAZORPAY_VALID_SCOPES.includes(scope));
    if (!scopes.length) {
      throw new BadRequestException(
        `No valid Razorpay scopes configured. Razorpay accepts: ${RAZORPAY_VALID_SCOPES.join(', ')}.`,
      );
    }

    const url = new URL(RAZORPAY_AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    // Razorpay expects `scope` repeated once per scope rather than a delimited list.
    for (const scope of scopes) {
      url.searchParams.append('scope', scope);
    }
    return url.toString();
  }

  async exchangeOAuthCode(params: OAuthCodeExchangeParams): Promise<OAuthTokenResult> {
    return this.postToken(
      {
        grant_type: 'authorization_code',
        code: params.code,
        redirect_uri: params.redirectUri,
        client_id: params.clientId,
        client_secret: params.clientSecret,
        mode: this.mode(params.environment),
      },
      'token exchange',
    );
  }

  async refreshOAuthToken(params: OAuthRefreshParams): Promise<OAuthTokenResult> {
    // Razorpay's refresh grant takes no redirect_uri and no mode — the mode is
    // already bound to the refresh token issued at authorization time.
    return this.postToken(
      {
        grant_type: 'refresh_token',
        refresh_token: params.refreshToken,
        client_id: params.clientId,
        client_secret: params.clientSecret,
      },
      'token refresh',
    );
  }

  async revokeOAuthToken(params: OAuthRevokeParams): Promise<void> {
    const response = await fetch(RAZORPAY_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        token: params.token,
        token_type_hint: params.tokenTypeHint,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new BadRequestException(
        `Razorpay token revocation failed (${response.status}): ${text.slice(0, 200) || 'unknown error'}`,
      );
    }
  }

  /**
   * Razorpay's token endpoint is JSON-only — it rejects the
   * `application/x-www-form-urlencoded` body most OAuth 2.0 providers accept.
   */
  private async postToken(body: Record<string, string>, operation: string): Promise<OAuthTokenResult> {
    const response = await fetch(RAZORPAY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new BadRequestException(`Razorpay returned an invalid response during OAuth ${operation}.`);
    }

    if (!response.ok) {
      const message =
        payload?.error?.description ||
        payload?.error_description ||
        (typeof payload?.error === 'string' ? payload.error : undefined) ||
        `Razorpay OAuth ${operation} failed (${response.status}).`;
      throw new BadRequestException(message);
    }

    const accessToken = payload.access_token;
    if (!accessToken) {
      throw new BadRequestException(`Razorpay did not return an access token during OAuth ${operation}.`);
    }

    const accountId = payload.razorpay_account_id;
    const extraCredentials: Record<string, string> = {};
    // `public_token` is the client-side key used to open Checkout for this merchant.
    if (payload.public_token) extraCredentials.public_token = String(payload.public_token);
    if (accountId) extraCredentials.razorpay_account_id = String(accountId);

    return {
      accessToken,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in ? Number(payload.expires_in) : undefined,
      externalAccountId: accountId,
      externalAccountName: accountId ? `Razorpay ${accountId}` : 'Razorpay Account',
      extraCredentials,
      raw: payload,
    };
  }

  private mode(environment?: 'TEST' | 'LIVE'): 'test' | 'live' {
    return environment === 'TEST' ? 'test' : 'live';
  }

  validateConfiguration(credentials: Record<string, string>, environment?: 'TEST' | 'LIVE'): void {
    if (environment && !['TEST', 'LIVE'].includes(environment)) {
      throw new BadRequestException('Environment must be either TEST or LIVE.');
    }
    // An OAuth-connected account authenticates with a bearer token — it has no
    // Key ID / Key Secret pair to validate.
    if (credentials.access_token) return;

    const keyId = credentials.keyId || credentials.apiKey;
    const keySecret = credentials.keySecret || credentials.apiSecret;
    if (!keyId || keyId.trim().length === 0) {
      throw new BadRequestException('Key ID is required for Razorpay integration.');
    }
    if (!keySecret || keySecret.trim().length === 0) {
      throw new BadRequestException('Key Secret is required for Razorpay integration.');
    }
  }

  async testConnection(
    credentials: Record<string, string>,
    environment: 'TEST' | 'LIVE' = 'TEST',
  ): Promise<IntegrationTestResult> {
    const accessToken = (credentials.access_token || '').trim();
    const keyId = (credentials.keyId || credentials.apiKey || '').trim();
    const keySecret = (credentials.keySecret || credentials.apiSecret || '').trim();

    let authHeader: string;
    let connectedVia: 'OAuth' | 'API Key';

    if (accessToken) {
      authHeader = `Bearer ${accessToken}`;
      connectedVia = 'OAuth';
    } else if (keyId && keySecret) {
      authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
      connectedVia = 'API Key';
    } else {
      return {
        success: false,
        message: 'Connect via Razorpay OAuth, or provide a Key ID and Key Secret, to test this connection.',
      };
    }

    try {
      const response = await fetch('https://api.razorpay.com/v1/payments?count=1', {
        method: 'GET',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      });

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: connectedVia === 'OAuth'
            ? 'Razorpay rejected the access token. The authorization may have been revoked — please reconnect your Razorpay account.'
            : 'The credentials were rejected by Razorpay (unauthorized). Please verify your Key ID and Key Secret and try again.',
        };
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          message: `Razorpay returned an unexpected error (${response.status}): ${errorText.slice(0, 150) || 'API error'}`,
        };
      }

      return {
        success: true,
        message: 'PartnerIQ successfully connected to Razorpay.',
        details: { environment, connectedVia, accountId: credentials.razorpay_account_id },
      };
    } catch (error: any) {
      return {
        success: false,
        // A transport failure is not a rejection: never let a blip mark a
        // healthy connection as broken.
        inconclusive: true,
        message: `Unable to reach Razorpay: ${error?.message || 'Network error'}`,
      };
    }
  }

  maskCredentials(credentials: Record<string, string>): Record<string, string> {
    if (credentials.access_token) {
      return {
        connectedVia: 'OAuth',
        accountId: credentials.razorpay_account_id || '—',
        accessToken: '••••••••••••',
      };
    }
    const keyId = credentials.keyId || credentials.apiKey || '';
    const last4 = keyId.length > 4 ? keyId.slice(-4) : '';
    return {
      keyId: `••••••••••••${last4}`,
      keySecret: '••••••••••••',
    };
  }
}
