import { Logger } from '@nestjs/common';

const logger = new Logger('GeoUtils');

export interface GeoLocation {
  country: string;
  region: string;
  city: string;
  timezone?: string;
}

let geoip: any = null;

async function getGeoip() {
  if (geoip) return geoip;
  try {
    // Dynamic import to avoid hard crash if geoip-lite isn't available
    const mod = await import('geoip-lite');
    geoip = mod.default ?? mod;
    return geoip;
  } catch {
    logger.warn('geoip-lite not available — IP geolocation will return null');
    return null;
  }
}

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^localhost$/i,
  /^0\.0\.0\.0$/,
];

function isPrivateIp(ip: string): boolean {
  const cleaned = ip?.trim().replace(/^::ffff:/, '');
  return PRIVATE_IP_PATTERNS.some((re) => re.test(cleaned));
}

/**
 * Look up approximate geographic location from an IP address.
 * Returns null for private/local IPs or if geolocation data is unavailable.
 * NOTE: IP geolocation is approximate — affected by VPNs, proxies, NAT, and carrier routing.
 */
export async function lookupIp(ip?: string): Promise<GeoLocation | null> {
  if (!ip) return null;

  const cleaned = ip.trim().split(',')[0].trim().replace(/^::ffff:/, '');

  if (isPrivateIp(cleaned)) return null;

  try {
    const geo = await getGeoip();
    if (!geo) return null;

    const result = geo.lookup(cleaned);
    if (!result) return null;

    return {
      country: result.country || '',
      region: Array.isArray(result.region) ? result.region[0] : (result.region || ''),
      city: result.city || '',
      timezone: result.timezone,
    };
  } catch (err) {
    logger.debug(`IP geolocation failed for ${cleaned}: ${err}`);
    return null;
  }
}

/**
 * Format location for display: "Bengaluru, Karnataka, India"
 */
export function formatLocation(geo: GeoLocation | null): string {
  if (!geo) return 'Unknown location';
  const parts = [geo.city, geo.region, geo.country].filter(Boolean);
  return parts.join(', ') || 'Unknown location';
}
