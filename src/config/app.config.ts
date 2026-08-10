export interface AppConfig {
  env: string;
  port: number;
  appUrl: string;
  frontendUrl: string;
  corsOrigins: string[];
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
}

export const getAppConfig = (): AppConfig => {
  const origins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001'];

  return {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '5000', 10),
    appUrl: process.env.APP_URL || 'http://localhost:5000',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    corsOrigins: origins,
    cookieSecure: process.env.AUTH_COOKIE_SECURE === 'true',
    cookieSameSite: (process.env.AUTH_COOKIE_SAME_SITE as 'lax' | 'strict' | 'none') || 'lax',
  };
};
