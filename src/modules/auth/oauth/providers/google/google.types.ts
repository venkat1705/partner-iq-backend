export interface GoogleIdTokenPayload {
  iss: string;
  sub: string;
  azp?: string;
  aud: string;
  email: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  nonce?: string;
  iat?: number;
  exp?: number;
  locale?: string;
  hd?: string;
}

export interface GoogleUserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email: string;
  email_verified: boolean;
  locale?: string;
  hd?: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  refresh_token?: string;
  id_token?: string;
}
