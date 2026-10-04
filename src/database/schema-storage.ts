/**
 * Storage accounting tables (assets audit, Part 3). Counters live in MySQL and are changed only through
 * StorageQuotaService (TypeORM repositories / conditional SQL) — never through dbStore.
 */
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** bigint ↔ number (byte counts stay far below 2^53). */
export const bigintNumber = {
  to: (value?: number | null) => value,
  from: (value?: string | number | null) => (value === null || value === undefined ? value : Number(value)),
};

/** One row per organization: limit, bytes in use, bytes reserved by uploads in progress, uploads in progress. */
@Entity('organization_storage')
export class OrganizationStorage {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  organizationId!: string;

  @Column({ type: 'bigint', transformer: bigintNumber })
  limitBytes!: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintNumber })
  usedBytes!: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintNumber })
  reservedBytes!: number;

  @Column({ type: 'int', default: 0 })
  activeUploads!: number;

  /** Platform admin who last changed the limit (null = default from config). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  limitUpdatedBy?: string | null;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  limitUpdatedAt?: Date | null;

  @Column({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)', onUpdate: 'CURRENT_TIMESTAMP(3)' })
  updatedAt!: Date;
}

/** Space reserved before an upload streams; committed (→ used) or released. */
@Entity('storage_reservations')
@Index(['status', 'createdAt'])
@Index(['organizationId', 'status'])
export class StorageReservation {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  organizationId!: string;

  @Column({ type: 'bigint', transformer: bigintNumber })
  bytes!: number;

  /** Key the upload writes to — lets the cleanup job remove an object left by a crashed upload. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  storageKey?: string | null;

  @Column({ type: 'varchar', length: 30 })
  purpose!: string;

  /** RESERVED | COMMITTED | RELEASED */
  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  releaseReason?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy?: string | null;

  @Column({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' })
  createdAt!: Date;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  finishedAt?: Date | null;
}

/** Every object the application keeps in storage. Usage = Σ sizeBytes where countsTowardQuota. */
@Entity('stored_objects')
@Index(['organizationId', 'kind'])
@Index(['assetId'])
export class StoredObject {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  /** Null for user-level objects (avatars). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  organizationId?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  ownerUserId?: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 500 })
  storageKey!: string;

  /** ASSET_FILE | THUMBNAIL | MEDIA | AVATAR */
  @Column({ type: 'varchar', length: 20 })
  kind!: string;

  @Column({ type: 'boolean', default: false })
  countsTowardQuota!: boolean;

  @Column({ type: 'bigint', transformer: bigintNumber })
  sizeBytes!: number;

  @Column({ type: 'char', length: 64 })
  checksumSha256!: string;

  @Column({ type: 'varchar', length: 120 })
  contentType!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  originalFileName?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  assetId?: string | null;

  /** For MEDIA: logo | banner | branding-logo …; for AVATAR: affiliate-avatar. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  purpose?: string | null;

  /** Legacy location this object was copied from (existing-file migration); the original is kept. */
  @Column({ type: 'varchar', length: 2000, nullable: true })
  migratedFrom?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy?: string | null;

  @Column({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' })
  createdAt!: Date;
}

/** Objects whose database rows are already gone and that still have to be deleted from storage (retried by the job). */
@Entity('storage_deletion_queue')
export class StorageDeletionQueueItem {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  organizationId?: string | null;

  @Column({ type: 'varchar', length: 500 })
  storageKey!: string;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastError?: string | null;

  @Column({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' })
  createdAt!: Date;
}
