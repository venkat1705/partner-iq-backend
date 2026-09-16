import { BadRequestException, Injectable } from '@nestjs/common';
import {
  IntegrationProvider,
  IntegrationTestResult,
  OAuthAuthorizationUrlParams,
  OAuthCodeExchangeParams,
  OAuthTokenResult,
} from './provider.interface';

// Razorpay Partner OAuth: https://razorpay.com/docs/partners/oauth/
const RAZORPAY_AUTHORIZE_URL = 'https://auth.razorpay.com/authorize';
const RAZORPAY_TOKEN_URL = 'https://auth.razorpay.com/token';

@Injectable()
export class RazorpayProvider implements IntegrationProvider {
  readonly provider = 'RAZORPAY';
  readonly category = 'PAYMENTS';

  getOAuthAuthorizationUrl(params: OAuthAuthorizationUrlParams): string {
    const url = new URL(RAZORPAY_AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', params.scopes.length ? params.scopes.join(' ') : 'read_write');
    url.searchParams.set('state', params.state);
    return url.toString();
  }

  async exchangeOAuthCode(params: OAuthCodeExchangeParams): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    });

    const response = await fetch(RAZORPAY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const text = await response.text();
    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new BadRequestException('Razorpay returned an invalid response during OAuth token exchange.');
    }

    if (!response.ok) {
      const message = payload?.error?.description || payload?.error_description || payload?.error || `Razorpay OAuth token exchange failed (${response.status}).`;
      throw new BadRequestException(message);
    }

    const accessToken = payload.access_token;
    if (!accessToken) {
      throw new BadRequestException('Razorpay did not return an access token.');
    }

    return {
      accessToken,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
      externalAccountId: payload.razorpay_account_id,
      externalAccountName: payload.razorpay_account_id ? `Razorpay ${payload.razorpay_account_id}` : 'Razorpay Account',
      raw: payload,
    };
  }

  validateConfiguration(credentials: Record<string, string>, environment?: 'TEST' | 'LIVE'): void {
    const keyId = credentials.keyId || credentials.apiKey;
    const keySecret = credentials.keySecret || credentials.apiSecret;
    if (!keyId || keyId.trim().length === 0) {
      throw new BadRequestException('Key ID is required for Razorpay integration.');
    }
    if (!keySecret || keySecret.trim().length === 0) {
      throw new BadRequestException('Key Secret is required for Razorpay integration.');
    }
    if (environment && !['TEST', 'LIVE'].includes(environment)) {
      throw new BadRequestException('Environment must be either TEST or LIVE.');
    }
  }

  async testConnection(
    credentials: Record<string, string>,
    environment: 'TEST' | 'LIVE' = 'TEST',
  ): Promise<IntegrationTestResult> {
    const keyId = (credentials.keyId || credentials.apiKey || '').trim();
    const keySecret = (credentials.keySecret || credentials.apiSecret || '').trim();

    if (!keyId || !keySecret) {
      return {
        success: false,
        message: 'Key ID and Key Secret are required to test the connection.',
      };
    }

    try {
      const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
      const response = await fetch('https://api.razorpay.com/v1/payments?count=1', {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401) {
        return {
          success: false,
          message: 'The credentials were rejected by Razorpay (unauthorized). Please verify your Key ID and Key Secret and try again.',
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
        details: { environment },
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Unable to reach Razorpay: ${error?.message || 'Network error'}`,
      };
    }
  }

  maskCredentials(credentials: Record<string, string>): Record<string, string> {
    const keyId = credentials.keyId || credentials.apiKey || '';
    const last4 = keyId.length > 4 ? keyId.slice(-4) : '';
    return {
      keyId: `••••••••••••${last4}`,
      keySecret: '••••••••••••',
    };
  }
}

