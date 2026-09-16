import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { SecurityUtils } from '../utils/security.utils';

const API_KEY_PATTERN = /^(?:pi_|sk_|pk_)(test|live)_/i;

/**
 * Global rate-limit guard applied to every route. Requests authenticated with
 * a PartnerIQ secret/public API key are bucketed per key (hashed, never the
 * raw key) so one integration's traffic never eats another's quota even if
 * they share an IP. Everything else (portal-session JWT calls and fully
 * public/unauthenticated routes) falls back to per-IP buckets.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const authHeader = (req.headers?.authorization || '') as string;
    const rawKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (rawKey && API_KEY_PATTERN.test(rawKey)) {
      return `apikey:${SecurityUtils.hashToken(rawKey)}`;
    }

    const forwardedFor = req.headers?.['x-forwarded-for'];
    const ip = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.ip || 'unknown';
    return `ip:${ip}`;
  }
}
