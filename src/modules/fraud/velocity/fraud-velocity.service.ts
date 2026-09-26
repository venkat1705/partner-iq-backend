import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class FraudVelocityService {
  private readonly logger = new Logger(FraudVelocityService.name);
  private redis?: Redis;
  private readonly fallbackCounters = new Map<string, { count: number; expiresAt: number }>();
  // Logged once, not per-request — Redis being unreachable degrades velocity signals for the
  // life of the process (each instance only sees its own slice of traffic in multi-instance
  // deployments), which would otherwise fail completely silently.
  private hasWarnedFallback = false;

  private getClient() {
    if (!this.redis) {
      const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
      this.redis = redisUrl
        ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false })
        : new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: Number(process.env.REDIS_PORT || 6379),
          password: process.env.REDIS_PASSWORD || undefined,
          lazyConnect: true,
          maxRetriesPerRequest: 0,
          enableOfflineQueue: false,
        });
      this.redis.on('error', () => undefined);
    }
    return this.redis;
  }

  private warnFallback(error: unknown) {
    if (this.hasWarnedFallback) return;
    this.hasWarnedFallback = true;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Redis is unavailable for fraud velocity tracking (unreachable, or a command was rejected); falling back to in-process counters. ` +
      `In a multi-instance deployment this undercounts velocity (each instance only sees its own traffic), weakening IP/affiliate/device velocity signals. (${message})`,
    );
  }

  async increment(key: string, ttlSeconds: number) {
    try {
      const client = this.getClient();
      if (client.status === 'wait') await client.connect();
      // `EXPIRE key ttl NX` is Redis 7.0+. On older servers the flag is rejected
      // when the command is queued, which aborts the whole MULTI (EXECABORT) and
      // pushes every increment into the fallback path even though Redis is up.
      // Reading the TTL and setting it only when absent has the same
      // "don't extend an existing window" semantics on every version.
      const results = await client.multi().incr(key).ttl(key).exec();
      const count = Number(results?.[0]?.[1] || 0);
      const remainingTtl = Number(results?.[1]?.[1] ?? -1);
      if (remainingTtl < 0) {
        await client.expire(key, ttlSeconds);
      }
      return count;
    } catch (error) {
      this.warnFallback(error);
      const now = Date.now();
      const current = this.fallbackCounters.get(key);
      if (!current || current.expiresAt < now) {
        this.fallbackCounters.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
        return 1;
      }
      current.count += 1;
      return current.count;
    }
  }

  async snapshot(key: string) {
    try {
      const client = this.getClient();
      if (client.status === 'wait') await client.connect();
      return Number(await client.get(key) || 0);
    } catch (error) {
      this.warnFallback(error);
      const current = this.fallbackCounters.get(key);
      return current && current.expiresAt > Date.now() ? current.count : 0;
    }
  }
}
