import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  IntegrationProvider,
  IntegrationTestContext,
  IntegrationTestResult,
  OAuthAuthorizationUrlParams,
  OAuthCodeExchangeParams,
  OAuthTokenResult,
} from './provider.interface';

// Cashfree Partner Platform OAuth: https://www.cashfree.com/docs/partners/embedded/oauth-flow
const cashfreeApiBase = (environment?: 'TEST' | 'LIVE') =>
  environment === 'LIVE' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';

@Injectable()
export class CashfreeProvider implements IntegrationProvider {
  readonly provider = 'CASHFREE';
  readonly category = 'PAYMENTS';
  private readonly logger = new Logger(CashfreeProvider.name);

  async getOAuthAuthorizationUrl(params: OAuthAuthorizationUrlParams): Promise<string> {
    if (!params.partnerApiKey) {
      this.logger.error('[Cashfree OAuth] Missing partnerApiKey in platform config');
      throw new BadRequestException('Cashfree Partner API Key is not configured. Add it in Admin > Integrations > Cashfree > Configuration.');
    }

    const url = `${cashfreeApiBase(params.environment)}/partners/oauth/auth_link`;

    this.logger.log(url, "url")
    const requestBody = {
      // Cashfree's docs only document "read_write" as a valid scope value for this endpoint —
      // deliberately not forwarding whatever free-text scopes were saved in the generic admin
      // scopes editor (that UI is shared with HubSpot/Zoho's multi-scope OAuth apps).
      response_type: 'code',
      scope: 'read_write',
      state: params.state,
      ...(params.merchantId ? { merchant_id: params.merchantId } : {}),
    };

    this.logger.log(`[Cashfree OAuth] Requesting auth_link from ${url} for clientId=${params.clientId}, environment=${params.environment}, merchantId=${params.merchantId || '(none)'}`);
    console.log('[Cashfree OAuth] auth_link request body:', requestBody);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-partner-apikey': params.partnerApiKey,
        'oauth-client-id': params.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const text = await response.text();
    this.logger.log(`[Cashfree OAuth] auth_link response status: ${response.status}, body: ${text}`);
    console.log('[Cashfree OAuth] auth_link response:', { status: response.status, body: text });

    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      this.logger.error(`[Cashfree OAuth] Failed to parse JSON response from Cashfree: ${text}`);
      throw new BadRequestException('Cashfree returned an invalid response while generating the authorization link.');
    }

    if (!response.ok || !payload.auth_link) {
      const message = payload?.message || payload?.error_description || `Cashfree could not generate an authorization link (${response.status}).`;
      this.logger.error(`[Cashfree OAuth] Error generating auth_link (${response.status}): ${message}`);
      throw new BadRequestException(message);
    }

    return payload.auth_link;
  }

  async exchangeOAuthCode(params: OAuthCodeExchangeParams): Promise<OAuthTokenResult> {
    if (!params.partnerApiKey) {
      this.logger.error('[Cashfree OAuth] Missing partnerApiKey during token exchange');
      throw new BadRequestException('Cashfree Partner API Key is not configured. Add it in Admin > Integrations > Cashfree > Configuration.');
    }

    const url = `${cashfreeApiBase(params.environment)}/partners/oauth/token`;
    // Cashfree Partner OAuth token exchange specification strictly accepts grant_type and code.
    // merchant_id must NOT be sent in the exchange body — Cashfree returns the authorized merchant_id in the response.
    const requestBody: Record<string, string> = {
      grant_type: 'authorization_code',
      code: params.code,
    };

    this.logger.log(`[Cashfree OAuth] Exchanging code for token at ${url} for clientId=${params.clientId}, environment=${params.environment}`);
    console.log('[Cashfree OAuth] token exchange request:', { url, environment: params.environment, body: requestBody });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-partner-apikey': params.partnerApiKey,
        'oauth-client-id': params.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const text = await response.text();
    this.logger.log(`[Cashfree OAuth] Token exchange response status: ${response.status}, body: ${text}`);
    console.log('[Cashfree OAuth] Token exchange response:', { status: response.status, body: text });

    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      this.logger.error(`[Cashfree OAuth] Failed to parse JSON token response: ${text}`);
      throw new BadRequestException('Cashfree returned an invalid response during OAuth token exchange.');
    }

    if (!response.ok) {
      const message = payload?.message || payload?.error_description || `Cashfree OAuth token exchange failed (${response.status}).`;
      this.logger.error(`[Cashfree OAuth] Token exchange rejected (${response.status}): ${message}`);
      throw new BadRequestException(message);
    }

    const accessToken = payload.access_token;
    if (!accessToken) {
      this.logger.error('[Cashfree OAuth] Access token missing in payload');
      throw new BadRequestException('Cashfree did not return an access token.');
    }

    return {
      accessToken,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
      externalAccountId: payload.merchant_id,
      externalAccountName: payload.merchant_id ? `Cashfree ${payload.merchant_id}` : 'Cashfree Account',
      // Persisted so later partner API calls can address this merchant via
      // x-partner-merchantid without re-reading the connection record.
      extraCredentials: payload.merchant_id ? { merchant_id: String(payload.merchant_id) } : undefined,
      raw: payload,
    };
  }

  validateConfiguration(credentials: Record<string, string>, environment?: 'TEST' | 'LIVE'): void {
    const appId = credentials.appId || credentials.clientId || credentials.apiKey;
    const secretKey = credentials.secretKey || credentials.clientSecret || credentials.apiSecret;
    if (!appId || appId.trim().length === 0) {
      throw new BadRequestException('App ID is required for Cashfree integration.');
    }
    if (!secretKey || secretKey.trim().length === 0) {
      throw new BadRequestException('Secret Key is required for Cashfree integration.');
    }
    if (environment && !['TEST', 'LIVE'].includes(environment)) {
      throw new BadRequestException('Environment must be either TEST or LIVE.');
    }
  }

  async testConnection(
    credentials: Record<string, string>,
    environment: 'TEST' | 'LIVE' = 'TEST',
    context: IntegrationTestContext = {},
  ): Promise<IntegrationTestResult> {
    const appId = (credentials.appId || credentials.clientId || credentials.apiKey || '').trim();
    const secretKey = (credentials.secretKey || credentials.clientSecret || credentials.apiSecret || '').trim();

    // A Partner-OAuth connection holds an access token and a linked merchant id rather
    // than the merchant's own App ID / Secret Key. Cashfree's partner APIs are called
    // with the PLATFORM's Partner API Key plus that merchant id — the OAuth access token
    // is not a bearer credential for the PG APIs.
    const isOAuth = Boolean(credentials.access_token) && !(appId && secretKey);
    const merchantId = (credentials.merchant_id || context.externalAccountId || '').trim();
    const partnerApiKey = (context.partnerApiKey || '').trim();

    let headers: Record<string, string>;
    let connectedVia: 'OAuth' | 'API Key';

    if (isOAuth) {
      if (!partnerApiKey) {
        return {
          success: false,
          inconclusive: true,
          message: 'Cashfree Partner API Key is not configured. Add it in Admin > Integrations > Cashfree > Configuration to verify OAuth connections.',
          details: { connectedVia: 'OAuth', environment },
        };
      }
      if (!merchantId) {
        return {
          success: false,
          inconclusive: true,
          message: 'This Cashfree connection is missing its linked merchant ID. Reconnect Cashfree to restore it.',
          details: { connectedVia: 'OAuth', environment },
        };
      }
      headers = {
        'x-partner-apikey': partnerApiKey,
        'x-partner-merchantid': merchantId,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json',
      };
      connectedVia = 'OAuth';
    } else if (appId && secretKey) {
      headers = {
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json',
      };
      connectedVia = 'API Key';
    } else {
      return {
        success: false,
        message: 'App ID and Secret Key are required to test the connection.',
      };
    }

    const baseUrl = environment === 'LIVE' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';

    try {
      const response = await fetch(`${baseUrl}/orders?limit=1`, { method: 'GET', headers });

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: connectedVia === 'OAuth'
            ? 'Cashfree rejected the partner credentials for this merchant. The authorization may have been revoked — please reconnect your Cashfree account.'
            : 'The credentials were rejected by Cashfree (unauthorized). Please verify your App ID and Secret Key and try again.',
        };
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          message: `Cashfree returned an unexpected error (${response.status}): ${errorText.slice(0, 150) || 'API error'}`,
        };
      }

      return {
        success: true,
        message: 'PartnerIQ successfully connected to Cashfree.',
        details: { environment, connectedVia, merchantId: merchantId || undefined },
      };
    } catch (error: any) {
      return {
        success: false,
        // A transport failure is not a rejection: never let a blip mark a
        // healthy connection as broken.
        inconclusive: true,
        message: `Unable to reach Cashfree: ${error?.message || 'Network error'}`,
      };
    }
  }

  maskCredentials(credentials: Record<string, string>): Record<string, string> {
    const appId = credentials.appId || credentials.clientId || credentials.apiKey || '';
    const last4 = appId.length > 4 ? appId.slice(-4) : '';
    return {
      appId: `••••••••••••${last4}`,
      secretKey: '••••••••••••',
    };
  }
}

