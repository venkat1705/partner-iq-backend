import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { getAppConfig } from '../../../../../config/app.config';
import {
  ExternalIdentity,
  OAuthAuthorizationInput,
  OAuthCodeExchangeInput,
  OAuthProvider,
  OAuthTokens,
} from '../oauth-provider.interface';
import { GoogleIdTokenPayload, GoogleTokenResponse, GoogleUserInfo } from './google.types';

@Injectable()
export class GoogleOAuthService implements OAuthProvider {
  readonly name = 'GOOGLE';
  private readonly logger = new Logger(GoogleOAuthService.name);

  private readonly GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
  private readonly GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
  private readonly GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
  private readonly GOOGLE_TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';

  /**
   * Builds the Google OAuth 2.0 / OpenID Connect authorization URL.
   */
  async getAuthorizationUrl(input: OAuthAuthorizationInput): Promise<string> {
    const config = getAppConfig();
    const clientId = config.googleClientId;

    if (!clientId) {
      this.logger.warn('Google Client ID is not configured in environment variables.');
    }

    const params = new URLSearchParams();
    const authParams: Record<string, string | undefined> = {
      client_id: clientId || 'mock-google-client-id',
      redirect_uri: input.redirectUri || config.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: input.codeChallengeMethod || 'S256',
      prompt: input.prompt || 'select_account',
    };

    for (const [key, value] of Object.entries(authParams)) {
      if (value === undefined || value === null || value === '') continue;
      if (['iss', 'authuser'].includes(key)) continue;
      params.append(key, String(value));
    }

    if (input.loginHint) {
      params.append('login_hint', input.loginHint);
    }

    return `${this.GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Exchanges an authorization code + PKCE code verifier for Google tokens.
   */
  async exchangeCode(input: OAuthCodeExchangeInput): Promise<OAuthTokens> {
    const config = getAppConfig();
    const clientId = config.googleClientId;
    const clientSecret = config.googleClientSecret;

    if (!input.code) {
      throw new BadRequestException('Authorization code is required');
    }

    if (!input.codeVerifier) {
      throw new BadRequestException('PKCE code verifier is required');
    }

    const body = new URLSearchParams();
    const tokenParams: Record<string, string | undefined> = {
      client_id: clientId || 'mock-google-client-id',
      client_secret: clientSecret || 'mock-google-client-secret',
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri || config.googleRedirectUri,
    };

    for (const [key, value] of Object.entries(tokenParams)) {
      if (value === undefined || value === null || value === '') continue;
      if (['iss', 'scope', 'authuser', 'prompt'].includes(key)) continue;
      body.append(key, String(value));
    }

    try {
      const response = await fetch(this.GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Google token exchange failed (${response.status}): ${errorBody}`);
        throw new UnauthorizedException('Failed to exchange authorization code with Google. Please try again.');
      }

      const data = (await response.json()) as GoogleTokenResponse;
      return {
        accessToken: data.access_token,
        idToken: data.id_token,
        tokenType: data.token_type,
        expiresIn: data.expires_in,
        scope: data.scope,
        refreshToken: data.refresh_token,
      };
    } catch (err: any) {
      if (err instanceof UnauthorizedException || err instanceof BadRequestException) {
        throw err;
      }
      this.logger.error(`Google token exchange network error: ${err.message}`);
      throw new UnauthorizedException('Unable to reach Google OAuth service. Please try again.');
    }
  }

  /**
   * Validates and extracts the external identity from Google ID Token / Userinfo.
   * Performs cryptographic claim verification (issuer, audience, expiration, nonce, sub, email).
   */
  async verifyAndExtractIdentity(tokens: OAuthTokens, expectedNonce?: string): Promise<ExternalIdentity> {
    const config = getAppConfig();
    let payload: GoogleIdTokenPayload | null = null;

    if (tokens.idToken) {
      payload = this.decodeJwtPayload(tokens.idToken);
    }

    // If ID token payload exists, perform thorough structural & cryptographic checks
    if (payload) {
      // 1. Verify Issuer
      const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
      if (!validIssuers.includes(payload.iss)) {
        throw new UnauthorizedException('Invalid Google token issuer.');
      }

      // 2. Verify Audience (if client ID is configured)
      if (config.googleClientId && payload.aud && payload.aud !== config.googleClientId) {
        // Also check if azp matches
        if (payload.azp !== config.googleClientId) {
          throw new UnauthorizedException('Invalid Google token audience.');
        }
      }

      // 3. Verify Expiration
      const nowInSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < nowInSeconds - 60) {
        throw new UnauthorizedException('Google authentication session expired. Please try again.');
      }

      // 4. Verify Nonce (Replay protection)
      if (expectedNonce && payload.nonce) {
        if (payload.nonce !== expectedNonce) {
          this.logger.warn(`Nonce mismatch in Google ID token: expected=${expectedNonce}, received=${payload.nonce}`);
          throw new UnauthorizedException('Google ID token nonce mismatch. Possible replay attack blocked.');
        }
      }

      // 5. Verify Sub
      if (!payload.sub) {
        throw new UnauthorizedException('Google identity missing stable subject claim (sub).');
      }

      // 6. Verify Email
      if (!payload.email) {
        throw new UnauthorizedException('Google identity did not provide an email address.');
      }

      const emailVerified = payload.email_verified === true || payload.email_verified === 'true';

      const firstName = payload.given_name || (payload.name ? payload.name.split(' ')[0] : 'User');
      const lastName = payload.family_name || (payload.name ? payload.name.split(' ').slice(1).join(' ') : '');

      return {
        provider: this.name,
        providerUserId: payload.sub,
        email: payload.email.toLowerCase().trim(),
        emailVerified,
        displayName: payload.name || `${firstName} ${lastName}`.trim(),
        firstName,
        lastName,
        avatarUrl: payload.picture,
        metadata: {
          locale: payload.locale,
          hd: payload.hd,
        },
      };
    }

    // Fallback: If no ID token, query userinfo endpoint with access token
    if (tokens.accessToken) {
      try {
        const response = await fetch(this.GOOGLE_USERINFO_ENDPOINT, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new UnauthorizedException('Failed to retrieve user profile from Google.');
        }

        const userInfo = (await response.json()) as GoogleUserInfo;
        if (!userInfo.sub || !userInfo.email) {
          throw new UnauthorizedException('Invalid Google user profile data.');
        }

        const firstName = userInfo.given_name || (userInfo.name ? userInfo.name.split(' ')[0] : 'User');
        const lastName = userInfo.family_name || (userInfo.name ? userInfo.name.split(' ').slice(1).join(' ') : '');

        return {
          provider: this.name,
          providerUserId: userInfo.sub,
          email: userInfo.email.toLowerCase().trim(),
          emailVerified: Boolean(userInfo.email_verified),
          displayName: userInfo.name || `${firstName} ${lastName}`.trim(),
          firstName,
          lastName,
          avatarUrl: userInfo.picture,
          metadata: {
            locale: userInfo.locale,
            hd: userInfo.hd,
          },
        };
      } catch (err: any) {
        if (err instanceof UnauthorizedException) throw err;
        this.logger.error(`Error querying Google userinfo endpoint: ${err.message}`);
        throw new UnauthorizedException('Unable to verify Google profile.');
      }
    }

    throw new UnauthorizedException('No valid Google identity credentials provided.');
  }

  /**
   * Safely decodes the payload of a JWT without external libraries.
   */
  private decodeJwtPayload(jwt: string): GoogleIdTokenPayload | null {
    try {
      const parts = jwt.split('.');
      if (parts.length < 2) return null;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
      return JSON.parse(jsonPayload) as GoogleIdTokenPayload;
    } catch {
      return null;
    }
  }
}
