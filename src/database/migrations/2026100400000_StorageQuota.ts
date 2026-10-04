import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Storage accounting for the central storage service (assets audit, Part 3).
 *
 * up   — creates organization_storage, storage_reservations, stored_objects, storage_deletion_queue.
 *        Idempotent: TypeORM `synchronize` may already have created the tables at boot.
 * down — refuses (and changes nothing) while any of these tables holds data: dropping them would lose the only record
 *        of which storage objects belong to which organization, and the usage counters. Empty tables are dropped.
 */
export class StorageQuota2026100400000 implements MigrationInterface {
  name = 'StorageQuota2026100400000';

  private async tableExists(q: QueryRunner, table: string) {
    const rows = await q.query(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`, [table]);
    return Number(rows[0].n) > 0;
  }

  public async up(q: QueryRunner): Promise<void> {
    if (!(await this.tableExists(q, 'organization_storage'))) {
      await q.query(`CREATE TABLE organization_storage (
        organizationId varchar(36) NOT NULL,
        limitBytes bigint NOT NULL,
        usedBytes bigint NOT NULL DEFAULT 0,
        reservedBytes bigint NOT NULL DEFAULT 0,
        activeUploads int NOT NULL DEFAULT 0,
        limitUpdatedBy varchar(36) NULL,
        limitUpdatedAt datetime(3) NULL,
        updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (organizationId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    if (!(await this.tableExists(q, 'storage_reservations'))) {
      await q.query(`CREATE TABLE storage_reservations (
        id varchar(36) NOT NULL,
        organizationId varchar(36) NOT NULL,
        bytes bigint NOT NULL,
        storageKey varchar(500) NULL,
        purpose varchar(30) NOT NULL,
        status varchar(20) NOT NULL,
        releaseReason varchar(80) NULL,
        createdBy varchar(36) NULL,
        createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        finishedAt datetime(3) NULL,
        PRIMARY KEY (id),
        KEY IDX_storage_reservations_status_created (status, createdAt),
        KEY IDX_storage_reservations_org_status (organizationId, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    if (!(await this.tableExists(q, 'stored_objects'))) {
      await q.query(`CREATE TABLE stored_objects (
        id varchar(36) NOT NULL,
        organizationId varchar(36) NULL,
        ownerUserId varchar(36) NULL,
        storageKey varchar(500) NOT NULL,
        kind varchar(20) NOT NULL,
        countsTowardQuota tinyint NOT NULL DEFAULT 0,
        sizeBytes bigint NOT NULL,
        checksumSha256 char(64) NOT NULL,
        contentType varchar(120) NOT NULL,
        originalFileName varchar(255) NULL,
        assetId varchar(36) NULL,
        purpose varchar(40) NULL,
        migratedFrom varchar(2000) NULL,
        createdBy varchar(36) NULL,
        createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_stored_objects_key (storageKey),
        KEY IDX_stored_objects_org_kind (organizationId, kind),
        KEY IDX_stored_objects_asset (assetId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
    if (!(await this.tableExists(q, 'storage_deletion_queue'))) {
      await q.query(`CREATE TABLE storage_deletion_queue (
        id varchar(36) NOT NULL,
        organizationId varchar(36) NULL,
        storageKey varchar(500) NOT NULL,
        attempts int NOT NULL DEFAULT 0,
        lastError varchar(255) NULL,
        createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const tables = ['stored_objects', 'storage_reservations', 'storage_deletion_queue', 'organization_storage'];
    // check everything first: refuse without changing anything
    for (const table of tables) {
      if (!(await this.tableExists(q, table))) continue;
      const rows = await q.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      if (Number(rows[0].n) > 0) {
        throw new Error(`StorageQuota down refused: ${table} has ${rows[0].n} rows. Dropping it would lose storage accounting data (which object belongs to which organization, usage counters). Export or remove the data deliberately first.`);
      }
    }
    for (const table of tables) {
      if (await this.tableExists(q, table)) await q.query(`DROP TABLE \`${table}\``);
    }
  }
}
