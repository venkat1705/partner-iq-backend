export interface OAuthAuthorizationInput {
  state: string;
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  redirectUri: string;
  prompt?: string;
  loginHint?: string;
}

export interface OAuthCodeExchangeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface OAuthTokens {
  accessToken?: string;
  idToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  refreshToken?: string;
}

export interface ExternalIdentity {
  provider: string; // e.g. 'GOOGLE'
  providerUserId: string; // Google sub
  email: string;
  emailVerified: boolean;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  metadata?: Record<string, any>;
}

export interface OAuthProvider {
  readonly name: string;
  getAuthorizationUrl(input: OAuthAuthorizationInput): Promise<string>;
  exchangeCode(input: OAuthCodeExchangeInput): Promise<OAuthTokens>;
  verifyAndExtractIdentity(tokens: OAuthTokens, expectedNonce?: string): Promise<ExternalIdentity>;
}
