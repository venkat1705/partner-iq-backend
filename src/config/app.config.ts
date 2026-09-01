export interface AppConfig {
  env: string;
  port: number;
  appUrl: string;
  frontendUrl: string;
  corsOrigins: string[];
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
  enableSwagger: boolean;
  googleOAuthEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  googleStateTtlSeconds: number;
}

export const getAppConfig = (): AppConfig => {
  const isProduction = process.env.NODE_ENV === 'production';
  const origins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3004'];
  const appUrl = process.env.APP_URL || 'http://localhost:5000';

  return {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '5000', 10),
    appUrl,
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    corsOrigins: origins,
    cookieSecure: process.env.AUTH_COOKIE_SECURE === 'true',
    cookieSameSite: (process.env.AUTH_COOKIE_SAME_SITE as 'lax' | 'strict' | 'none') || 'lax',
    enableSwagger: process.env.ENABLE_SWAGGER !== undefined ? process.env.ENABLE_SWAGGER === 'true' : !isProduction,
    googleOAuthEnabled: process.env.GOOGLE_OAUTH_ENABLED !== undefined ? process.env.GOOGLE_OAUTH_ENABLED === 'true' : true,
    googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    googleRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || `${appUrl}/api/v1/auth/google/callback`,
    googleStateTtlSeconds: parseInt(process.env.GOOGLE_OAUTH_STATE_TTL_SECONDS || '600', 10),
  };
};
