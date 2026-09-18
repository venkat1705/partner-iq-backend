export interface IntegrationTestResult {
  success: boolean;
  message: string;
  details?: Record<string, any>;
  /**
   * True when the test could not actually reach a verdict — the provider never
   * rejected us (network blip, or we hold a credential type this probe cannot
   * verify). Callers must NOT downgrade a healthy connection on these: only a
   * real rejection from the provider means the connection is broken.
   */
  inconclusive?: boolean;
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

export interface OAuthRefreshParams {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  environment?: 'TEST' | 'LIVE';
  partnerApiKey?: string;
}

export interface OAuthRevokeParams {
  token: string;
  /** Which kind of token is being revoked — providers reject a mismatched hint. */
  tokenTypeHint: 'access_token' | 'refresh_token';
  clientId: string;
  clientSecret: string;
  environment?: 'TEST' | 'LIVE';
}

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  externalAccountId?: string;
  externalAccountName?: string;
  /**
   * Additional provider-issued values that must be persisted alongside the access
   * token (e.g. Razorpay's `public_token`, used for client-side Checkout). Stored
   * as encrypted credentials on the organization's connection.
   */
  extraCredentials?: Record<string, string>;
  raw?: Record<string, any>;
}

/**
 * Platform-level context a health check may need in addition to the organization's
 * own credentials — e.g. Cashfree's partner APIs are called with the PLATFORM's
 * Partner API Key plus the linked merchant's id, never with the org's own keys.
 */
export interface IntegrationTestContext {
  partnerApiKey?: string;
  /** The provider-side account this connection is linked to (Cashfree merchant_id, Razorpay account id). */
  externalAccountId?: string;
}

export interface IntegrationProvider {
  readonly provider: string;
  readonly category: string;
  validateConfiguration(credentials: Record<string, string>, environment?: 'TEST' | 'LIVE'): void;
  testConnection(
    credentials: Record<string, string>,
    environment?: 'TEST' | 'LIVE',
    context?: IntegrationTestContext,
  ): Promise<IntegrationTestResult>;
  maskCredentials(credentials: Record<string, string>): Record<string, string>;
  /** Only implemented by providers that support a real OAuth authorization-code flow. */
  getOAuthAuthorizationUrl?(params: OAuthAuthorizationUrlParams): string | Promise<string>;
  exchangeOAuthCode?(params: OAuthCodeExchangeParams): Promise<OAuthTokenResult>;
  /** Implemented by OAuth providers whose access tokens expire and can be renewed. */
  refreshOAuthToken?(params: OAuthRefreshParams): Promise<OAuthTokenResult>;
  /** Implemented by OAuth providers that expose a token revocation endpoint. */
  revokeOAuthToken?(params: OAuthRevokeParams): Promise<void>;
}
