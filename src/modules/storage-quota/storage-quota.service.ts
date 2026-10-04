/**
 * Per-organization storage accounting in MySQL (TypeORM repositories + conditional SQL; never dbStore).
 *
 *  reserve  — one conditional UPDATE: succeeds only if used + reserved + size ≤ limit AND fewer than the allowed
 *             number of uploads run for the organization. Otherwise 413 (space) or 429 (concurrency), before any
 *             byte reaches storage.
 *  commit   — inside the caller's transaction (the one that creates the asset record): reserved → used with the
 *             REAL size.
 *  release  — idempotent: only a RESERVED reservation can be released, exactly once.
 */
import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { StorageService } from '../../common/storage';
import { AppDataSource, initializeDataSource } from '../../database/data-source';
import { OrganizationStorage, StorageReservation } from '../../database/schema';

const LOCK_WAIT_SECONDS = 5;

export interface UsageView {
  organizationId: string;
  limitBytes: number;
  usedBytes: number;
  reservedBytes: number;
  availableBytes: number;
  percentUsed: number;
  overLimit: boolean;
  activeUploads: number;
  breakdown: { filesBytes: number; olderVersionsBytes: number; trashBytes: number };
  counts: { files: number; olderVersions: number; trashedAssets: number };
  maxFileBytes: number;
  allowedExtensions: string[];
  trashRetentionDays: number;
  maxConcurrentUploads: number;
}

export function formatBytesForMessage(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(v)} B`;
  // same rule as the UI's formatStorage: one decimal, trailing ".0" dropped (3,221,225,472 bytes = "3 GB")
  const r = Math.round(v * 10) / 10;
  return `${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)} ${units[i]}`;
}

export class StorageLimitReachedException extends HttpException {
  constructor(details: { neededBytes: number; availableBytes: number; limitBytes: number; usedBytes: number; reservedBytes: number }) {
    super(
      {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'STORAGE_LIMIT_REACHED',
        message: `Not enough storage space: this file needs ${formatBytesForMessage(details.neededBytes)} but only ${formatBytesForMessage(details.availableBytes)} of your ${formatBytesForMessage(details.limitBytes)} is left. Free space by emptying the trash or deleting older versions.`,
        // the global exception filter forwards `details` to the client
        details: {
          ...details,
          howToFree: ['Empty the trash (files in the trash still count until they are permanently deleted).', 'Delete older versions of files you have replaced.', 'Delete files you no longer need.'],
        },
      },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
}

export class TooManyUploadsException extends HttpException {
  constructor(max: number) {
    super(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, code: 'TOO_MANY_CONCURRENT_UPLOADS', message: `Your organization already has ${max} uploads in progress. Wait for one to finish, then try again.`, details: { maxConcurrentUploads: max } },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class StorageQuotaService {
  private readonly logger = new Logger('StorageQuota');

  constructor(private readonly storage: StorageService) {}

  /** Transaction with a short lock wait so a locked table produces a clear 503 instead of a hung request. */
  async inTx<T>(work: (m: EntityManager) => Promise<T>): Promise<T> {
    await initializeDataSource();
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    try {
      await qr.query(`SET SESSION innodb_lock_wait_timeout = ${LOCK_WAIT_SECONDS}, lock_wait_timeout = ${LOCK_WAIT_SECONDS}`);
      await qr.startTransaction();
      const result = await work(qr.manager);
      await qr.commitTransaction();
      return result;
    } catch (err: any) {
      if (qr.isTransactionActive) await qr.rollbackTransaction().catch(() => undefined);
      if (err instanceof HttpException) throw err;
      this.logger.error(`storage accounting write failed: ${err?.code || ''} ${err?.message || err}`);
      throw new ServiceUnavailableException('The change could not be saved because the database is busy or unavailable. Nothing was changed; please retry.');
    } finally {
      await qr.query('SET SESSION innodb_lock_wait_timeout = DEFAULT, lock_wait_timeout = DEFAULT').catch(() => undefined);
      await qr.release();
    }
  }

  /** Create the organization's row with the default limit (no-op when it exists). */
  async ensureRow(m: EntityManager, organizationId: string) {
    await m.query(
      `INSERT INTO organization_storage (organizationId, limitBytes, usedBytes, reservedBytes, activeUploads)
       VALUES (?, ?, 0, 0, 0) ON DUPLICATE KEY UPDATE organizationId = organizationId`,
      [organizationId, this.storage.settings.defaultOrganizationLimitBytes],
    );
  }

  /** Reserve `bytes` for one upload. Throws 413 (no space) or 429 (too many concurrent uploads). */
  async reserve(organizationId: string, bytes: number, opts: { purpose: string; storageKey?: string; createdBy?: string }): Promise<StorageReservation> {
    const max = this.storage.settings.maxConcurrentUploadsPerOrganization;
    return this.inTx(async (m) => {
      await this.ensureRow(m, organizationId);
      const result = await m
        .getRepository(OrganizationStorage)
        .createQueryBuilder()
        .update(OrganizationStorage)
        .set({ reservedBytes: () => 'reservedBytes + :size', activeUploads: () => 'activeUploads + 1' })
        .where('organizationId = :org', { org: organizationId })
        .andWhere('usedBytes + reservedBytes + :size <= limitBytes')
        .andWhere('activeUploads < :max')
        .setParameters({ size: bytes, max })
        .execute();
      if (!result.affected) {
        const row = await m.getRepository(OrganizationStorage).findOneByOrFail({ organizationId });
        if (row.activeUploads >= max && row.usedBytes + row.reservedBytes + bytes <= row.limitBytes) throw new TooManyUploadsException(max);
        throw new StorageLimitReachedException({
          neededBytes: bytes,
          availableBytes: Math.max(0, row.limitBytes - row.usedBytes - row.reservedBytes),
          limitBytes: row.limitBytes,
          usedBytes: row.usedBytes,
          reservedBytes: row.reservedBytes,
        });
      }
      const reservation = m.getRepository(StorageReservation).create({
        id: randomUUID(),
        organizationId,
        bytes,
        storageKey: opts.storageKey ?? null,
        purpose: opts.purpose,
        status: 'RESERVED',
        createdBy: opts.createdBy ?? null,
        createdAt: new Date(),
      });
      await m.getRepository(StorageReservation).insert(reservation);
      return reservation;
    });
  }

  /** Inside the asset transaction: mark the reservation committed and move its space to used (real size). */
  async commit(m: EntityManager, reservation: StorageReservation, realBytes: number) {
    if (realBytes > reservation.bytes) throw new HttpException({ statusCode: 413, code: 'STORAGE_LIMIT_REACHED', message: 'The file is larger than the space reserved for it.' }, 413);
    const done = await m
      .getRepository(StorageReservation)
      .createQueryBuilder()
      .update(StorageReservation)
      .set({ status: 'COMMITTED', finishedAt: () => 'CURRENT_TIMESTAMP(3)' })
      .where('id = :id AND status = :s', { id: reservation.id, s: 'RESERVED' })
      .execute();
    if (!done.affected) {
      throw new HttpException({ statusCode: 409, code: 'STORAGE_RESERVATION_EXPIRED', message: 'The upload took too long and its reserved space was released. Nothing was saved; please upload again.' }, 409);
    }
    await m
      .getRepository(OrganizationStorage)
      .createQueryBuilder()
      .update(OrganizationStorage)
      .set({
        usedBytes: () => 'usedBytes + :real',
        reservedBytes: () => 'GREATEST(reservedBytes - :reserved, 0)',
        activeUploads: () => 'GREATEST(activeUploads - 1, 0)',
      })
      .where('organizationId = :org', { org: reservation.organizationId })
      .setParameters({ real: realBytes, reserved: reservation.bytes })
      .execute();
  }

  /** Release a reservation that did not turn into a file. Safe to call more than once. */
  async release(reservationId: string, reason: string): Promise<boolean> {
    return this.inTx(async (m) => this.releaseIn(m, reservationId, reason));
  }

  async releaseIn(m: EntityManager, reservationId: string, reason: string): Promise<boolean> {
    const reservation = await m.getRepository(StorageReservation).findOneBy({ id: reservationId });
    if (!reservation) return false;
    const done = await m
      .getRepository(StorageReservation)
      .createQueryBuilder()
      .update(StorageReservation)
      .set({ status: 'RELEASED', releaseReason: reason.slice(0, 80), finishedAt: () => 'CURRENT_TIMESTAMP(3)' })
      .where('id = :id AND status = :s', { id: reservationId, s: 'RESERVED' })
      .execute();
    if (!done.affected) return false;
    await m
      .getRepository(OrganizationStorage)
      .createQueryBuilder()
      .update(OrganizationStorage)
      .set({ reservedBytes: () => 'GREATEST(reservedBytes - :b, 0)', activeUploads: () => 'GREATEST(activeUploads - 1, 0)' })
      .where('organizationId = :org', { org: reservation.organizationId })
      .setParameters({ b: reservation.bytes })
      .execute();
    return true;
  }

  /** Permanent deletion inside the caller's transaction: frees space immediately. */
  async free(m: EntityManager, organizationId: string, bytes: number) {
    if (bytes <= 0) return;
    await m
      .getRepository(OrganizationStorage)
      .createQueryBuilder()
      .update(OrganizationStorage)
      .set({ usedBytes: () => 'GREATEST(usedBytes - :b, 0)' })
      .where('organizationId = :org', { org: organizationId })
      .setParameters({ b: bytes })
      .execute();
  }

  /** Existing-file migration / reconciliation: add usage without a reservation (never blocked by the limit). */
  async addUsage(m: EntityManager, organizationId: string, bytes: number) {
    await this.ensureRow(m, organizationId);
    await m
      .getRepository(OrganizationStorage)
      .createQueryBuilder()
      .update(OrganizationStorage)
      .set({ usedBytes: () => 'usedBytes + :b' })
      .where('organizationId = :org', { org: organizationId })
      .setParameters({ b: bytes })
      .execute();
  }

  async getUsage(organizationId: string): Promise<UsageView> {
    await initializeDataSource();
    await this.inTx((m) => this.ensureRow(m, organizationId));
    const row = await AppDataSource.getRepository(OrganizationStorage).findOneByOrFail({ organizationId });
    const [b] = await AppDataSource.query(
      `SELECT
         COALESCE(SUM(CASE WHEN a.deletedAt IS NULL AND cur.storageKey IS NOT NULL THEN o.sizeBytes END), 0) AS filesBytes,
         COALESCE(SUM(CASE WHEN a.deletedAt IS NULL AND cur.storageKey IS NULL THEN o.sizeBytes END), 0) AS olderVersionsBytes,
         COALESCE(SUM(CASE WHEN a.deletedAt IS NOT NULL THEN o.sizeBytes END), 0) AS trashBytes,
         COUNT(CASE WHEN a.deletedAt IS NULL AND cur.storageKey IS NOT NULL THEN 1 END) AS files,
         COUNT(CASE WHEN a.deletedAt IS NULL AND cur.storageKey IS NULL THEN 1 END) AS olderVersions,
         COUNT(DISTINCT CASE WHEN a.deletedAt IS NOT NULL THEN a.id END) AS trashedAssets
       FROM stored_objects o
       LEFT JOIN assets a ON a.id = o.assetId
       LEFT JOIN (SELECT DISTINCT assetId, storageKey FROM asset_versions WHERE isCurrent = 1) cur
              ON cur.assetId = o.assetId AND cur.storageKey = o.storageKey
       WHERE o.organizationId = ? AND o.countsTowardQuota = 1`,
      [organizationId],
    );
    const s = this.storage.settings;
    return {
      organizationId,
      limitBytes: row.limitBytes,
      usedBytes: row.usedBytes,
      reservedBytes: row.reservedBytes,
      availableBytes: Math.max(0, row.limitBytes - row.usedBytes - row.reservedBytes),
      percentUsed: row.limitBytes > 0 ? Math.round((row.usedBytes / row.limitBytes) * 10000) / 100 : 100,
      overLimit: row.usedBytes >= row.limitBytes,
      activeUploads: row.activeUploads,
      breakdown: { filesBytes: Number(b.filesBytes), olderVersionsBytes: Number(b.olderVersionsBytes), trashBytes: Number(b.trashBytes) },
      counts: { files: Number(b.files), olderVersions: Number(b.olderVersions), trashedAssets: Number(b.trashedAssets) },
      maxFileBytes: s.maxFileBytes,
      allowedExtensions: s.allowedExtensions,
      trashRetentionDays: s.trashRetentionDays,
      maxConcurrentUploads: s.maxConcurrentUploadsPerOrganization,
    };
  }

  /** Platform admins only (enforced by the controller guard). */
  async setLimit(organizationId: string, limitBytes: number, adminUserId: string, reason?: string) {
    const organization = await AppDataSource.query(`SELECT id, name FROM organizations WHERE id = ?`, [organizationId]);
    if (!organization.length) throw new NotFoundException('Organization not found');
    return this.inTx(async (m) => {
      await this.ensureRow(m, organizationId);
      const before = await m.getRepository(OrganizationStorage).findOneByOrFail({ organizationId });
      await m.getRepository(OrganizationStorage).update({ organizationId }, { limitBytes, limitUpdatedBy: adminUserId, limitUpdatedAt: new Date() });
      await m.query(
        `INSERT INTO audit_logs (id, organizationId, actorType, actorId, action, category, result, resourceType, resourceId, source, beforeState, afterState, reason, createdAt)
         VALUES (?, ?, 'PLATFORM_ADMIN', ?, 'STORAGE_LIMIT_CHANGED', 'ADMINISTRATION', 'SUCCESS', 'organization_storage', ?, 'PLATFORM_ADMIN', ?, ?, ?, CURRENT_TIMESTAMP(6))`,
        [randomUUID(), organizationId, adminUserId, organizationId, JSON.stringify({ limitBytes: before.limitBytes }), JSON.stringify({ limitBytes }), reason ?? null],
      );
      return { organizationId, previousLimitBytes: before.limitBytes, limitBytes, usedBytes: before.usedBytes };
    });
  }

  /** Delete queued storage objects; queue rows are removed only after storage confirmed the delete. */
  async processDeletionQueue(organizationId?: string, keys?: string[]) {
    await initializeDataSource();
    const where: string[] = [];
    const params: unknown[] = [];
    if (organizationId) {
      where.push('organizationId = ?');
      params.push(organizationId);
    }
    if (keys) {
      if (!keys.length) return { deleted: 0, failed: 0 };
      where.push('storageKey IN (?)');
      params.push(keys);
    }
    const pending: Array<{ id: string; organizationId: string | null; storageKey: string }> = await AppDataSource.query(
      `SELECT id, organizationId, storageKey FROM storage_deletion_queue ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY createdAt LIMIT 1000`,
      params,
    );
    let deleted = 0;
    let failed = 0;
    for (const p of pending) {
      try {
        // keys are random and never reused; still, never delete an object a live record points to
        const [live] = await AppDataSource.query(`SELECT COUNT(*) n FROM stored_objects WHERE storageKey = ?`, [p.storageKey]);
        if (!Number(live.n)) await this.storage.deleteObject(p.storageKey, { organizationId: p.organizationId || 'platform' });
        await AppDataSource.query(`DELETE FROM storage_deletion_queue WHERE id = ?`, [p.id]);
        deleted += 1;
      } catch (err: any) {
        failed += 1;
        this.logger.warn(`deletion of ${p.storageKey} failed (will retry): ${err?.message || err}`);
        await AppDataSource.query(`UPDATE storage_deletion_queue SET attempts = attempts + 1, lastError = ? WHERE id = ?`, [String(err?.message || err).slice(0, 255), p.id]).catch(() => undefined);
      }
    }
    return { deleted, failed };
  }
}
