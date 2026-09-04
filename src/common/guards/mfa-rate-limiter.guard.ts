import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { initializeDataSource } from '../../database/data-source';
import { MfaRateLimit } from '../../database/schema';
import type { Request } from 'express';

const MAX_ATTEMPTS = parseInt(process.env.MFA_RATE_LIMIT_ATTEMPTS || '10', 10);
const WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 15;

/**
 * Rate limiter guard for MFA verification endpoints.
 * Tracks attempts per challengeId + IP address combination.
 * After MAX_ATTEMPTS within WINDOW_MINUTES, returns 429 with TOO_MANY_ATTEMPTS.
 *
 * This does NOT permanently lock accounts — only applies temporary throttling.
 */
@Injectable()
export class MfaRateLimiterGuard implements CanActivate {
  private readonly logger = new Logger(MfaRateLimiterGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = (request.ip || (request.headers['x-forwarded-for'] as string) || 'unknown')
      .split(',')[0]
      .trim();
    const body = request.body as any;
    const identifier = body?.challengeId || body?.email || 'unknown';
    const key = `mfa:${identifier}:${ip}`;

    try {
      const dataSource = await initializeDataSource();
      const repo = dataSource.getRepository(MfaRateLimit);
      const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

      let record = await repo.findOne({ where: { key } });

      if (record) {
        // Check if locked
        if (record.lockedUntil && new Date() < record.lockedUntil) {
          const remaining = Math.ceil((record.lockedUntil.getTime() - Date.now()) / 60000);
          throw new HttpException(
            {
              success: false,
              error: {
                code: 'TOO_MANY_ATTEMPTS',
                message: `Too many verification attempts. Please try again in ${remaining} minute${remaining !== 1 ? 's' : ''}.`,
              },
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        // Reset if window has passed
        if (record.windowStart < windowStart) {
          record.attempts = 0;
          record.windowStart = new Date();
          record.lockedUntil = undefined;
        }

        record.attempts += 1;

        if (record.attempts >= MAX_ATTEMPTS) {
          record.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
          await repo.save(record);
          throw new HttpException(
            {
              success: false,
              error: {
                code: 'TOO_MANY_ATTEMPTS',
                message: `Too many verification attempts. Please try again in ${LOCKOUT_MINUTES} minutes.`,
              },
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        await repo.save(record);
      } else {
        // First attempt
        record = repo.create({
          key,
          attempts: 1,
          windowStart: new Date(),
        });
        await repo.save(record);
      }

      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // If rate limiter DB is unavailable, log and allow the request through
      this.logger.warn(`MFA rate limiter unavailable: ${err}`);
      return true;
    }
  }

  /**
   * Reset rate limit after successful verification.
   * Call this after a successful MFA verify to clear the counter.
   */
  static async resetLimit(key: string): Promise<void> {
    try {
      const dataSource = await initializeDataSource();
      await dataSource.getRepository(MfaRateLimit).delete({ key });
    } catch {
      // Non-fatal
    }
  }
}
