import { BadRequestException, Injectable } from '@nestjs/common';
import {
  IntegrationProvider,
  IntegrationTestResult,
  OAuthAuthorizationUrlParams,
  OAuthCodeExchangeParams,
  OAuthTokenResult,
} from './provider.interface';

// Zoho CRM OAuth 2.0: https://www.zoho.com/crm/developer/docs/api/v6/oauth-overview.html
// Zoho has multiple regional data centers; .com covers the default/US DC used by most accounts.
const ZOHO_ACCOUNTS_BASE = 'https://accounts.zoho.com';

@Injectable()
export class ZohoCrmProvider implements IntegrationProvider {
  readonly provider = 'ZOHO_CRM';
  readonly category = 'CRM';

  getOAuthAuthorizationUrl(params: OAuthAuthorizationUrlParams): string {
    const url = new URL(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/auth`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', params.scopes.length ? params.scopes.join(',') : 'ZohoCRM.modules.ALL,ZohoCRM.settings.ALL');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', params.state);
    return url.toString();
  }

  async exchangeOAuthCode(params: OAuthCodeExchangeParams): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      code: params.code,
    });

    const response = await fetch(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const text = await response.text();
    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new BadRequestException('Zoho CRM returned an invalid response during OAuth token exchange.');
    }

    if (!response.ok || payload.error) {
      throw new BadRequestException(payload?.error_description || payload?.error || `Zoho CRM OAuth token exchange failed (${response.status}).`);
    }

    const accessToken = payload.access_token;
    if (!accessToken) {
      throw new BadRequestException('Zoho CRM did not return an access token.');
    }

    let externalAccountName: string | undefined;
    if (payload.api_domain) {
      try {
        const orgResponse = await fetch(`${payload.api_domain}/crm/v3/org`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
        });
        if (orgResponse.ok) {
          const orgPayload = await orgResponse.json();
          externalAccountName = orgPayload?.org?.[0]?.company_name;
        }
      } catch {
        // Non-fatal — account name is cosmetic; the connection still succeeds without it.
      }
    }

    return {
      accessToken,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
      externalAccountId: payload.api_domain,
      externalAccountName: externalAccountName || 'Zoho CRM',
      raw: payload,
    };
  }

  validateConfiguration(credentials: Record<string, string>): void {
    const apiKey = credentials.apiKey || credentials.token || credentials.accessCredential;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new BadRequestException('API Key / Access Credential is required for Zoho CRM integration.');
    }
  }

  async testConnection(credentials: Record<string, string>): Promise<IntegrationTestResult> {
    // An OAuth-connected org stores `access_token`; a manually-connected one stores a
    // pasted credential. Both are presented to Zoho the same way, as a Zoho-oauthtoken.
    const credential = (
      credentials.access_token || credentials.apiKey || credentials.token || credentials.accessCredential || ''
    ).trim();
    if (!credential) {
      return {
        success: false,
        message: 'The API Key / Access Credential was not provided.',
      };
    }

    try {
      const response = await fetch('https://www.zohoapis.com/crm/v3/org', {
        method: 'GET',
        headers: {
          Authorization: `Zoho-oauthtoken ${credential}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: 'The credentials were rejected by Zoho CRM. Please verify your API Key / Access Credential and try again.',
        };
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        return {
          success: false,
          message: `Zoho CRM returned an error (${response.status}): ${errorBody.slice(0, 150) || 'API error'}`,
        };
      }

      return {
        success: true,
        message: 'PartnerIQ successfully connected to Zoho CRM.',
      };
    } catch (error: any) {
      return {
        success: false,
        // A transport failure is not a rejection: never let a blip mark a
        // healthy connection as broken.
        inconclusive: true,
        message: `Unable to reach Zoho CRM: ${error?.message || 'Network error'}`,
      };
    }
  }

  maskCredentials(credentials: Record<string, string>): Record<string, string> {
    const credential = credentials.apiKey || credentials.token || credentials.accessCredential || '';
    const last4 = credential.length > 4 ? credential.slice(-4) : '';
    return {
      apiKey: `••••••••••••${last4}`,
    };
  }
}

