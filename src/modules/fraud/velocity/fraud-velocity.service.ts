import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class FraudVelocityService {
  private redis?: Redis;
  private readonly fallbackCounters = new Map<string, { count: number; expiresAt: number }>();

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

  async increment(key: string, ttlSeconds: number) {
    try {
      const client = this.getClient();
      if (client.status === 'wait') await client.connect();
      const results = await client.multi().incr(key).expire(key, ttlSeconds, 'NX').exec();
      return Number(results?.[0]?.[1] || 0);
    } catch {
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
    } catch {
      const current = this.fallbackCounters.get(key);
      return current && current.expiresAt > Date.now() ? current.count : 0;
    }
  }
}
