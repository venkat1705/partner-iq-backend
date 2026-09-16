import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { AppDataSource } from '../../../database/data-source';

/**
 * Serialises "check the limit, then create the resource" so two concurrent
 * requests cannot both read `50 / 50` and both succeed.
 *
 * Two layers, because PartnerIQ runs its services against an in-process
 * write-through store but can be deployed on more than one node:
 *
 *  1. An in-process promise chain keyed by account+resource. This is what makes
 *     concurrency correct for everything reading `dbStore` inside one node.
 *  2. A MySQL named lock (`GET_LOCK`/`RELEASE_LOCK`) on the same key, which is
 *     held on a dedicated connection and is therefore a true cross-process
 *     critical section. If the database is unavailable the in-process lock
 *     still applies and the operation proceeds rather than failing closed.
 *
 * Deliberately no usage counter table: a counter is a second source of truth
 * that drifts from the real rows after deletes, restores and status changes.
 * Usage is always recounted from the actual records inside the lock instead.
 */
@Injectable()
export class LimitLockService {
  private readonly logger = new Logger(LimitLockService.name);

  /** Tail of the pending promise chain for each lock key, plus its waiter count. */
  private readonly chains = new Map<string, { tail: Promise<unknown>; waiters: number }>();

  /** Seconds a caller waits for the database lock before giving up on it. */
  private static readonly DB_LOCK_TIMEOUT_SECONDS = 10;

  /**
   * Runs `work` while holding the lock for `key`. Returns whatever `work`
   * returns; the lock is always released, including when `work` throws.
   */
  async withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const entry = this.chains.get(key) ?? { tail: Promise.resolve(), waiters: 0 };
    entry.waiters += 1;

    // A failed predecessor must not poison the queue, so swallow its rejection
    // before chaining — each caller still sees its own result or error.
    const run = entry.tail.then(
      () => this.withDatabaseLock(key, work),
      () => this.withDatabaseLock(key, work),
    );

    entry.tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(key, entry);

    try {
      return await run;
    } finally {
      entry.waiters -= 1;
      // Drop the entry once nobody is queued, so the map cannot grow without
      // bound across many accounts.
      if (entry.waiters === 0 && this.chains.get(key) === entry) {
        this.chains.delete(key);
      }
    }
  }

  /** Lock key for an account-wide resource allowance. */
  static resourceKey(accountId: string, resourceType: string) {
    return `piq:limit:${accountId}:${resourceType}`;
  }

  private async withDatabaseLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (!AppDataSource.isInitialized || AppDataSource.options.type !== 'mysql') {
      return work();
    }

    // MySQL truncates lock names over 64 chars; hash to a stable short name.
    const lockName = `piq_${createHash('sha1').update(key).digest('hex').slice(0, 40)}`;

    let runner;
    let acquired = false;
    try {
      runner = AppDataSource.createQueryRunner();
      await runner.connect();
      const rows = await runner.query('SELECT GET_LOCK(?, ?) AS acquired', [
        lockName,
        LimitLockService.DB_LOCK_TIMEOUT_SECONDS,
      ]);
      acquired = Number(rows?.[0]?.acquired) === 1;
      if (!acquired) {
        this.logger.warn(
          `Timed out waiting for database lock ${lockName}; relying on the in-process lock.`,
        );
      }
    } catch (error) {
      this.logger.warn(`Database lock unavailable for ${lockName}: ${(error as Error).message}`);
    }

    try {
      return await work();
    } finally {
      if (runner) {
        try {
          if (acquired) {
            await runner.query('SELECT RELEASE_LOCK(?)', [lockName]);
          }
        } catch (error) {
          this.logger.warn(`Failed to release lock ${lockName}: ${(error as Error).message}`);
        }
        try {
          await runner.release();
        } catch {
          /* connection already gone */
        }
      }
    }
  }
}
