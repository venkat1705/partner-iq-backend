import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export const JobExecutionStatus = {
  WAITING: 'WAITING',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  DELAYED: 'DELAYED',
  PAUSED: 'PAUSED',
} as const;
export type JobExecutionStatus = (typeof JobExecutionStatus)[keyof typeof JobExecutionStatus];

export const JobBackoffStrategy = {
  EXPONENTIAL: 'EXPONENTIAL',
  FIXED: 'FIXED',
} as const;
export type JobBackoffStrategy = (typeof JobBackoffStrategy)[keyof typeof JobBackoffStrategy];

export const WorkerStatus = {
  ONLINE: 'ONLINE',
  BUSY: 'BUSY',
  IDLE: 'IDLE',
  STALLED: 'STALLED',
  STOPPED: 'STOPPED',
} as const;
export type WorkerStatus = (typeof WorkerStatus)[keyof typeof WorkerStatus];

export const DlqRecordStatus = {
  AWAITING_REVIEW: 'AWAITING_REVIEW',
  REPLAYED: 'REPLAYED',
  DISCARDED: 'DISCARDED',
} as const;
export type DlqRecordStatus = (typeof DlqRecordStatus)[keyof typeof DlqRecordStatus];

export const JobExceptionSeverity = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;
export type JobExceptionSeverity = (typeof JobExceptionSeverity)[keyof typeof JobExceptionSeverity];

export const JobExceptionType = {
  STALLED_JOB: 'STALLED_JOB',
  ORPHANED_EXECUTION: 'ORPHANED_EXECUTION',
  CONCURRENCY_VIOLATION: 'CONCURRENCY_VIOLATION',
  HEARTBEAT_TIMEOUT: 'HEARTBEAT_TIMEOUT',
  QUEUE_PRESSURE: 'QUEUE_PRESSURE',
  UNHANDLED_EXCEPTION: 'UNHANDLED_EXCEPTION',
} as const;
export type JobExceptionType = (typeof JobExceptionType)[keyof typeof JobExceptionType];

@Entity('queue_records')
export class QueueRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 60, default: 'GENERAL' })
  category!: string;

  @Column({ type: 'boolean', default: false })
  isPaused!: boolean;

  @Column({ type: 'int', default: 5 })
  concurrency!: number;

  @Column({ type: 'int', default: 3 })
  maxRetries!: number;

  @Column({ type: 'int', default: 0 })
  waitingCount!: number;

  @Column({ type: 'int', default: 0 })
  activeCount!: number;

  @Column({ type: 'int', default: 0 })
  completedCount!: number;

  @Column({ type: 'int', default: 0 })
  failedCount!: number;

  @Column({ type: 'int', default: 0 })
  delayedCount!: number;

  @Column({ type: 'float', default: 0 })
  p95DurationMs!: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  lastActiveAt?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('worker_records')
export class WorkerRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  workerId!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  hostInfo!: string;

  @Column({ type: 'int', default: 1 })
  pid!: number;

  @Column({ type: 'simple-json', nullable: true })
  assignedQueues!: string[];

  @Column({ type: 'int', default: 4 })
  concurrency!: number;

  @Column({ type: 'int', default: 0 })
  activeJobs!: number;

  @Column({ type: 'int', default: 0 })
  processedCount!: number;

  @Column({ type: 'int', default: 0 })
  failedCount!: number;

  @Column({ type: 'varchar', length: 40, default: 'ONLINE' })
  status!: WorkerStatus;

  @Column({ type: 'varchar', length: 60 })
  lastHeartbeat!: string;

  @Column({ type: 'varchar', length: 60 })
  startedAt!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('job_records')
export class JobRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  jobId!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  queueName!: string;

  @Index()
  @Column({ type: 'varchar', length: 150 })
  jobName!: string;

  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  organizationName?: string;

  @Index()
  @Column({ type: 'varchar', length: 40, default: 'WAITING' })
  status!: JobExecutionStatus;

  @Column({ type: 'int', default: 5 })
  priority!: number;

  @Column({ type: 'simple-json', nullable: true })
  payload?: any;

  @Column({ type: 'simple-json', nullable: true })
  result?: any;

  @Column({ type: 'text', nullable: true })
  errorDetails?: string;

  @Column({ type: 'text', nullable: true })
  stackTrace?: string;

  @Column({ type: 'int', default: 0 })
  attemptsMade!: number;

  @Column({ type: 'int', default: 3 })
  maxAttempts!: number;

  @Column({ type: 'varchar', length: 40, default: 'EXPONENTIAL' })
  backoffStrategy!: JobBackoffStrategy;

  @Column({ type: 'int', default: 1000 })
  backoffDelayMs!: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  delayUntil?: string;

  @Column({ type: 'varchar', length: 60 })
  queuedAt!: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  startedAt?: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  completedAt?: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  failedAt?: string;

  @Column({ type: 'float', nullable: true })
  executionDurationMs?: number;

  @Column({ type: 'float', nullable: true })
  waitDurationMs?: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  workerId?: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  workerName?: string;

  @Column({ type: 'boolean', default: false })
  isDeadLetter!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('job_attempt_records')
export class JobAttemptRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  jobRecordId!: string;

  @Column({ type: 'int' })
  attemptNumber!: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  workerId?: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  workerName?: string;

  @Column({ type: 'varchar', length: 40 })
  status!: 'SUCCESS' | 'FAILURE';

  @Column({ type: 'float', default: 0 })
  durationMs!: number;

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ type: 'text', nullable: true })
  stackTrace?: string;

  @Column({ type: 'varchar', length: 60 })
  startedAt!: string;

  @Column({ type: 'varchar', length: 60 })
  endedAt!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('scheduled_job_records')
export class ScheduledJobRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 150 })
  jobName!: string;

  @Column({ type: 'varchar', length: 100 })
  cronSchedule!: string;

  @Column({ type: 'varchar', length: 120 })
  targetQueue!: string;

  @Column({ type: 'simple-json', nullable: true })
  payload?: any;

  @Column({ type: 'boolean', default: false })
  isPaused!: boolean;

  @Column({ type: 'varchar', length: 60, default: 'Asia/Kolkata' })
  timezone!: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  lastRunAt?: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  lastRunResult?: 'SUCCESS' | 'FAILED';

  @Column({ type: 'varchar', length: 60 })
  nextRunAt!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('dead_letter_records')
export class DeadLetterRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  originalJobId!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  queueName!: string;

  @Column({ type: 'varchar', length: 150 })
  jobName!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  organizationName?: string;

  @Column({ type: 'simple-json', nullable: true })
  payload?: any;

  @Column({ type: 'text' })
  finalError!: string;

  @Column({ type: 'int', default: 3 })
  failedAttempts!: number;

  @Index()
  @Column({ type: 'varchar', length: 40, default: 'AWAITING_REVIEW' })
  status!: DlqRecordStatus;

  @Column({ type: 'varchar', length: 60, nullable: true })
  replayedAt?: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  discardedAt?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('job_exception_records')
export class JobExceptionRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, default: 'MEDIUM' })
  severity!: JobExceptionSeverity;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  queueName!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  workerId?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  jobId?: string;

  @Column({ type: 'varchar', length: 60 })
  exceptionType!: JobExceptionType;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'boolean', default: false })
  isResolved!: boolean;

  @Column({ type: 'varchar', length: 60, nullable: true })
  resolvedAt?: string;

  @Column({ type: 'text', nullable: true })
  resolutionNotes?: string;

  @Column({ type: 'varchar', length: 60 })
  detectedAt!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('job_settings_records')
export class JobSettingsRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'simple-json' })
  value!: any;

  @UpdateDateColumn()
  updatedAt!: Date;
}

