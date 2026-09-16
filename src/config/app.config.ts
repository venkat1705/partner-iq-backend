export interface AppConfig {
  env: string;
  port: number;
  appUrl: string;
  frontendUrl: string;
  affiliateFrontendUrl: string;
  corsOrigins: string[];
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
  enableSwagger: boolean;
  googleOAuthEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  googleAffiliateClientId: string;
  googleAffiliateClientSecret: string;
  googleAffiliateRedirectUri: string;
  googleStateTtlSeconds: number;
}

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3004',
  'http://localhost:3005',
  'http://localhost:3006',
  'http://*.localhost:3000',
  'http://*.localhost:3001',
  'http://*.localhost:3002',
  'http://*.localhost:3004',
  'http://*.localhost:3005',
  'http://*.localhost:3006',
  'https://*.partneriq.in',
];

export const isAllowedCorsOrigin = (origin: string | undefined, allowedOrigins: string[] = DEFAULT_CORS_ORIGINS): boolean => {
  if (!origin) return true;

  const normalizedOrigin = origin.trim().replace(/\/$/, '');
  const exactMatch = allowedOrigins.some((allowed) => allowed.trim().replace(/\/$/, '') === normalizedOrigin);
  if (exactMatch) return true;

  try {
    const parsed = new URL(normalizedOrigin);
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');

    // Allow any localhost origin (any port, any subdomain like *.localhost:*)
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1') {
      return true;
    }

    // Allow any partneriq domain/subdomain, but only over HTTPS — plaintext HTTP allows a
    // network-level man-in-the-middle attacker to intercept or forge cross-origin requests.
    if ((hostname === 'partneriq.in' || hostname.endsWith('.partneriq.in')) && parsed.protocol === 'https:') {
      return true;
    }

    const matchesWildcard = allowedOrigins.some((allowed) => {
      if (!allowed.includes('*')) return false;
      const pattern = allowed
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*');
      return new RegExp(`^${pattern}$`, 'i').test(normalizedOrigin);
    });

    const isLocalSubdomain = hostname.endsWith('.localhost') && ['3000', '3001', '3002', '3004', '3005', '3006'].includes(port);
    const isPartnerSubdomain = hostname.endsWith('.partneriq.in') && parsed.protocol === 'https:' && ['443', '3000', '3001', '3002', '3004', '3005', '3006'].includes(port);

    return matchesWildcard || isLocalSubdomain || isPartnerSubdomain;
  } catch {
    return false;
  }
};

export const getAppConfig = (): AppConfig => {
  const isProduction = process.env.NODE_ENV === 'production';
  const origins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : DEFAULT_CORS_ORIGINS;
  const appUrl = process.env.APP_URL || 'http://localhost:5000';

  return {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '5000', 10),
    appUrl,
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    affiliateFrontendUrl: process.env.AFFILIATE_FRONTEND_URL || process.env.VITE_AFFILIATE_APP_URL || 'http://localhost:3005',
    corsOrigins: origins,
    cookieSecure: process.env.AUTH_COOKIE_SECURE === 'true',
    cookieSameSite: (process.env.AUTH_COOKIE_SAME_SITE as 'lax' | 'strict' | 'none') || 'lax',
    enableSwagger: process.env.ENABLE_SWAGGER !== undefined ? process.env.ENABLE_SWAGGER === 'true' : !isProduction,
    googleOAuthEnabled: process.env.GOOGLE_OAUTH_ENABLED !== undefined ? process.env.GOOGLE_OAUTH_ENABLED === 'true' : true,
    googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    googleRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || `${appUrl}/api/v1/auth/google/callback`,
    googleAffiliateClientId: process.env.GOOGLE_AFFILIATE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
    googleAffiliateClientSecret: process.env.GOOGLE_AFFILIATE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
    googleAffiliateRedirectUri: process.env.GOOGLE_AFFILIATE_REDIRECT_URI || process.env.AFFILIATE_GOOGLE_REDIRECT_URI || `${appUrl}/api/v1/affiliate/auth/google/callback`,
    googleStateTtlSeconds: parseInt(process.env.GOOGLE_OAUTH_STATE_TTL_SECONDS || '600', 10),
  };
};
