/**
 * Storage maintenance jobs (run inside the API process every few minutes/hours when STORAGE_JOBS_ENABLED is not
 * "false"; platform admins can run each one on demand):
 *
 *  cleanup-reservations — releases reservations older than STORAGE_RESERVATION_TTL_MINUTES (abandoned/crashed
 *                         uploads), deletes an object a crashed upload left behind (no record), aborts multipart
 *                         uploads older than 1 day, retries queued object deletions.
 *  purge-trash          — permanently deletes files that have been in the trash longer than the retention period.
 *  reconcile            — lists every object in storage, compares each organization's counted usage with the real
 *                         objects, corrects the counter (logged + audit row) and reports objects without a record and
 *                         records without an object.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StorageService } from '../../common/storage';
import { AppDataSource, initializeDataSource } from '../../database/data-source';
import { StorageQuotaService } from '../storage-quota/storage-quota.service';
import { AssetManagementService } from './asset-management.service';
import { inTx } from './asset-common';

export interface ReconcileReport {
  startedAt: string;
  finishedAt: string;
  objectsListed: number;
  organizations: Array<{ organizationId: string; counterBytes: number; actualBytes: number; inStorageBytes: number; differenceBytes: number; corrected: boolean }>;
  objectsWithoutRecord: Array<{ key: string; sizeBytes: number; organizationId?: string; uploadInProgress: boolean }>;
  recordsWithoutObject: Array<{ id: string; key: string; organizationId: string | null; assetId: string | null; sizeBytes: number }>;
  sizeMismatches: Array<{ key: string; recordBytes: number; storedBytes: number }>;
}

@Injectable()
export class StorageJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('StorageJobs');
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();

  constructor(
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
    private readonly assets: AssetManagementService,
  ) {}

  onModuleInit() {
    if (!this.storage.settings.jobsEnabled || process.env.NODE_ENV === 'test') return;
    const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
      const t = setInterval(() => void this.once(name, fn), ms);
      t.unref();
      this.timers.push(t);
    };
    every(10 * 60_000, 'cleanup-reservations', () => this.cleanupReservations());
    every(6 * 3600_000, 'purge-trash', () => this.purgeExpiredTrash());
    every(24 * 3600_000, 'reconcile', () => this.reconcile());
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  /** Never run the same job twice at the same time; errors are logged, never swallowed silently. */
  private async once<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (this.running.has(name)) {
      this.logger.warn(`job ${name} is already running; skipped`);
      return undefined;
    }
    this.running.add(name);
    try {
      const result = await fn();
      this.logger.log(`job ${name} finished: ${JSON.stringify(result).slice(0, 2000)}`);
      return result;
    } catch (err: any) {
      this.logger.error(`job ${name} failed: ${err?.message || err}`);
      throw err;
    } finally {
      this.running.delete(name);
    }
  }

  run(name: string) {
    switch (name) {
      case 'cleanup-reservations':
        return this.once(name, () => this.cleanupReservations());
      case 'purge-trash':
        return this.once(name, () => this.purgeExpiredTrash());
      case 'reconcile':
        return this.once(name, () => this.reconcile());
      case 'process-deletions':
        return this.once(name, () => this.quota.processDeletionQueue());
      default:
        return undefined;
    }
  }

  async cleanupReservations(olderThanMinutes = this.storage.settings.reservationTtlMinutes) {
    await initializeDataSource();
    const expired: Array<{ id: string; organizationId: string; bytes: string; storageKey: string | null }> = await AppDataSource.query(
      `SELECT id, organizationId, bytes, storageKey FROM storage_reservations WHERE status = 'RESERVED' AND createdAt < (CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE) ORDER BY createdAt LIMIT 1000`,
      [olderThanMinutes],
    );
    let released = 0;
    let orphanObjectsDeleted = 0;
    for (const r of expired) {
      if (await this.quota.release(r.id, 'expired (cleanup job)')) released += 1;
      if (r.storageKey) {
        const [rec] = await AppDataSource.query(`SELECT COUNT(*) n FROM stored_objects WHERE storageKey = ?`, [r.storageKey]);
        if (!Number(rec.n) && (await this.storage.headObject(r.storageKey, { organizationId: r.organizationId }))) {
          await this.storage.deleteObject(r.storageKey, { organizationId: r.organizationId });
          orphanObjectsDeleted += 1;
        }
      }
    }
    const abortedMultipart = await this.storage.abortStaleMultipartUploads(24 * 3600_000);
    const deletions = await this.quota.processDeletionQueue();
    return { expiredReservations: expired.length, released, orphanObjectsDeleted, abortedMultipart, deletionQueue: deletions };
  }

  async purgeExpiredTrash(retentionDays = this.storage.settings.trashRetentionDays) {
    await initializeDataSource();
    const rows: Array<{ id: string; organizationId: string }> = await AppDataSource.query(
      `SELECT id, organizationId FROM assets WHERE deletedAt IS NOT NULL AND deletedAt < (CURRENT_TIMESTAMP(6) - INTERVAL ? DAY) ORDER BY deletedAt LIMIT 5000`,
      [retentionDays],
    );
    const byOrg = new Map<string, string[]>();
    for (const r of rows) byOrg.set(r.organizationId, [...(byOrg.get(r.organizationId) || []), r.id]);
    let deleted = 0;
    let freedBytes = 0;
    for (const [organizationId, ids] of byOrg) {
      const res = await this.assets.purgeAssets(organizationId, ids, 'system', 'RETENTION_EXPIRED', { requireTrashed: true });
      deleted += res.deleted;
      freedBytes += res.freedBytes;
    }
    return { expiredAssets: rows.length, deleted, freedBytes, organizations: byOrg.size };
  }

  async reconcile(): Promise<ReconcileReport> {
    await initializeDataSource();
    const startedAt = new Date().toISOString();
    const listed = new Map<string, number>();
    for await (const o of this.storage.listObjects()) listed.set(o.key, o.sizeBytes);
    const records: Array<{ id: string; storageKey: string; organizationId: string | null; assetId: string | null; sizeBytes: string; countsTowardQuota: number }> =
      await AppDataSource.query(`SELECT id, storageKey, organizationId, assetId, sizeBytes, countsTowardQuota FROM stored_objects`);
    const recordKeys = new Set(records.map((r) => r.storageKey));
    const reserved: Array<{ storageKey: string }> = await AppDataSource.query(`SELECT storageKey FROM storage_reservations WHERE status = 'RESERVED' AND storageKey IS NOT NULL`);
    const inProgress = new Set(reserved.map((r) => r.storageKey));
    const queued: Array<{ storageKey: string }> = await AppDataSource.query(`SELECT storageKey FROM storage_deletion_queue`);
    const queuedKeys = new Set(queued.map((q) => q.storageKey));

    const objectsWithoutRecord = [...listed.entries()]
      .filter(([key]) => !recordKeys.has(key) && !queuedKeys.has(key))
      .map(([key, sizeBytes]) => {
        const m = key.match(/orgs\/([0-9a-f-]{36})\//);
        return { key, sizeBytes, organizationId: m?.[1], uploadInProgress: inProgress.has(key) };
      });
    const recordsWithoutObject = records
      .filter((r) => !listed.has(r.storageKey))
      .map((r) => ({ id: r.id, key: r.storageKey, organizationId: r.organizationId, assetId: r.assetId, sizeBytes: Number(r.sizeBytes) }));
    const sizeMismatches = records
      .filter((r) => listed.has(r.storageKey) && listed.get(r.storageKey) !== Number(r.sizeBytes))
      .map((r) => ({ key: r.storageKey, recordBytes: Number(r.sizeBytes), storedBytes: listed.get(r.storageKey)! }));

    const orgIds: Array<{ organizationId: string }> = await AppDataSource.query(
      `SELECT organizationId FROM organization_storage UNION SELECT DISTINCT organizationId FROM stored_objects WHERE organizationId IS NOT NULL`,
    );
    const organizations: ReconcileReport['organizations'] = [];
    for (const { organizationId } of orgIds) {
      const result = await inTx(async (m) => {
        await this.quota.ensureRow(m, organizationId);
        const [row] = await m.query(`SELECT usedBytes FROM organization_storage WHERE organizationId = ? FOR UPDATE`, [organizationId]);
        // the counter must equal the sum of the counted records: every later delete subtracts a record's size, so a
        // counter set from the bucket listing would drift below zero once a record whose object is missing is deleted
        // (decision A27). Objects without records, records without objects and size mismatches are reported for a
        // person to resolve — never fixed by guessing.
        const counted: Array<{ storageKey: string; sizeBytes: string }> = await m.query(
          `SELECT storageKey, sizeBytes FROM stored_objects WHERE organizationId = ? AND countsTowardQuota = 1 FOR UPDATE`,
          [organizationId],
        );
        const actual = counted.reduce((s, o) => s + Number(o.sizeBytes), 0);
        const inStorage = counted.reduce((s, o) => s + (listed.get(o.storageKey) ?? 0), 0);
        const counter = Number(row.usedBytes);
        const corrected = counter !== actual;
        if (corrected) {
          await m.query(`UPDATE organization_storage SET usedBytes = ? WHERE organizationId = ?`, [actual, organizationId]);
          await m.query(
            `INSERT INTO audit_logs (id, organizationId, actorType, actorId, action, category, result, resourceType, resourceId, source, beforeState, afterState, reason, createdAt)
             VALUES (?, ?, 'SYSTEM', 'storage-reconciliation', 'STORAGE_USAGE_RECONCILED', 'ASSETS', 'SUCCESS', 'organization_storage', ?, 'SYSTEM', ?, ?, 'reconciliation job', CURRENT_TIMESTAMP(6))`,
            [randomUUID(), organizationId, organizationId, JSON.stringify({ usedBytes: counter }), JSON.stringify({ usedBytes: actual })],
          );
          this.logger.warn(`reconcile org=${organizationId} counter=${counter} actual=${actual} difference=${actual - counter} -> corrected`);
        }
        return { organizationId, counterBytes: counter, actualBytes: actual, inStorageBytes: inStorage, differenceBytes: actual - counter, corrected };
      });
      organizations.push(result);
    }
    for (const o of objectsWithoutRecord) this.logger.warn(`reconcile object-without-record key=${o.key} bytes=${o.sizeBytes}${o.uploadInProgress ? ' (upload in progress)' : ''}`);
    for (const r of recordsWithoutObject) this.logger.warn(`reconcile record-without-object id=${r.id} key=${r.key}`);
    return { startedAt, finishedAt: new Date().toISOString(), objectsListed: listed.size, organizations, objectsWithoutRecord, recordsWithoutObject, sizeMismatches };
  }
}
