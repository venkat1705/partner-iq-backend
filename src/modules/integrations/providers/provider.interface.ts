export interface IntegrationTestResult {
  success: boolean;
  message: string;
  details?: Record<string, any>;
}

export interface OAuthAuthorizationUrlParams {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  environment?: 'TEST' | 'LIVE';
  /** Provider-specific extras: e.g. Cashfree accepts an optional partner-assigned merchant_id and requires a Partner API Key. */
  merchantId?: string;
  partnerApiKey?: string;
}

export interface OAuthCodeExchangeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment?: 'TEST' | 'LIVE';
  partnerApiKey?: string;
  /** Cashfree echoes merchant_id back on the redirect; the token exchange needs it too. */
  merchantId?: string;
}

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  externalAccountId?: string;
  externalAccountName?: string;
  raw?: Record<string, any>;
}

export interface IntegrationProvider {
  readonly provider: string;
  readonly category: string;
  validateConfiguration(credentials: Record<string, string>, environment?: 'TEST' | 'LIVE'): void;
  testConnection(credentials: Record<string, string>, environment?: 'TEST' | 'LIVE'): Promise<IntegrationTestResult>;
  maskCredentials(credentials: Record<string, string>): Record<string, string>;
  /** Only implemented by providers that support a real OAuth authorization-code flow. */
  getOAuthAuthorizationUrl?(params: OAuthAuthorizationUrlParams): string | Promise<string>;
  exchangeOAuthCode?(params: OAuthCodeExchangeParams): Promise<OAuthTokenResult>;
}

