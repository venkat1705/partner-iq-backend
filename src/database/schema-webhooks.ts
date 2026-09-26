import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum WebhookEndpointStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  DEGRADED = 'DEGRADED',
}

export enum WebhookDeliveryStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
  EXHAUSTED = 'EXHAUSTED',
  DEAD_LETTER = 'DEAD_LETTER',
}

export enum WebhookFailureCategory {
  TIMEOUT = 'TIMEOUT',
  DNS_ERROR = 'DNS_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  HTTP_4XX = 'HTTP_4XX',
  HTTP_5XX = 'HTTP_5XX',
  TLS_ERROR = 'TLS_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  SIGNATURE_ERROR = 'SIGNATURE_ERROR',
  PAYLOAD_ERROR = 'PAYLOAD_ERROR',
  UNKNOWN = 'UNKNOWN',
}

@Entity('admin_webhook_endpoints')
@Index(['organizationId', 'status'])
export class WebhookEndpointRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  organizationId!: string;

  @Column({ type: 'varchar', length: 255, default: 'Default Organization' })
  organizationName!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 2000 })
  url!: string;

  @Column({ type: 'varchar', length: 30, default: WebhookEndpointStatus.ACTIVE })
  status!: WebhookEndpointStatus;

  @Column({ type: 'varchar', length: 20, default: 'LIVE' })
  environment!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 255 })
  secretHash!: string;

  @Column({ type: 'text' })
  secretEncrypted!: string;

  @Column({ type: 'varchar', length: 50, default: 'hmac-sha256' })
  signatureAlgorithm!: string;

  @Column({ type: 'int', default: 5000 })
  timeoutMs!: number;

  @Column({ type: 'simple-array' })
  subscribedEvents!: string[];

  @Column({ type: 'int', default: 5 })
  maxRetryAttempts!: number;

  @Column({ type: 'varchar', length: 50, default: 'EXPONENTIAL' })
  backoffStrategy!: string;

  @Column({ type: 'int', default: 0 })
  totalDeliveriesCount!: number;

  @Column({ type: 'int', default: 0 })
  successfulDeliveriesCount!: number;

  @Column({ type: 'int', default: 0 })
  failedDeliveriesCount!: number;

  @Column({ type: 'float', default: 100.0 })
  successRate!: number;

  @Column({ type: 'int', default: 0 })
  avgLatencyMs!: number;

  @Column({ type: 'datetime', nullable: true })
  lastDeliveryAt?: Date;

  @Column({ type: 'int', nullable: true })
  lastResponseCode?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  deletedAt?: Date;
}

@Entity('admin_webhook_events')
@Index(['eventType', 'createdAt'])
@Index(['organizationId', 'createdAt'])
export class WebhookEventRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'varchar', length: 20, default: '1.0' })
  version!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  organizationId!: string;

  @Column({ type: 'varchar', length: 255, default: 'Default Organization' })
  organizationName!: string;

  @Column({ type: 'varchar', length: 100 })
  source!: string;

  @Column({ type: 'varchar', length: 100 })
  entityType!: string;

  @Column({ type: 'varchar', length: 255 })
  entityId!: string;

  @Column({ type: 'simple-json' })
  payload!: any;

  @Column({ type: 'varchar', length: 64, nullable: true })
  payloadHash?: string;

  @Column({ type: 'varchar', length: 30, default: 'PROCESSED' })
  status!: string;

  @Column({ type: 'int', default: 0 })
  subscriptionsMatched!: number;

  @Column({ type: 'int', default: 0 })
  deliveriesCreated!: number;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('admin_webhook_deliveries')
@Index(['eventId', 'endpointId'])
@Index(['status', 'nextRetryAt'])
@Index(['organizationId', 'createdAt'])
export class WebhookDeliveryRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  eventId!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  endpointId!: string;

  @Column({ type: 'varchar', length: 2000 })
  endpointUrl!: string;

  @Column({ type: 'varchar', length: 255 })
  endpointName!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  organizationId!: string;

  @Column({ type: 'varchar', length: 255, default: 'Default Organization' })
  organizationName!: string;

  @Column({ type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'varchar', length: 30, default: WebhookDeliveryStatus.PENDING })
  status!: WebhookDeliveryStatus;

  @Column({ type: 'int', default: 1 })
  attemptCount!: number;

  @Column({ type: 'int', default: 5 })
  maxAttempts!: number;

  @Column({ type: 'datetime', nullable: true })
  nextRetryAt?: Date;

  @Column({ type: 'datetime', nullable: true })
  lastAttemptAt?: Date;

  @Column({ type: 'datetime', nullable: true })
  completedAt?: Date;

  @Column({ type: 'int', default: 0 })
  httpStatus!: number;

  @Column({ type: 'int', default: 0 })
  durationMs!: number;

  @Column({ type: 'text', nullable: true })
  lastError?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  lastErrorCategory?: WebhookFailureCategory;

  @Column({ type: 'varchar', length: 255, nullable: true })
  requestId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  correlationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  traceId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('admin_webhook_delivery_attempts')
@Index(['deliveryId', 'attemptNumber'])
export class WebhookDeliveryAttemptRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  deliveryId!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  endpointId!: string;

  @Column({ type: 'varchar', length: 255 })
  organizationId!: string;

  @Column({ type: 'int' })
  attemptNumber!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  requestId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  correlationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  traceId?: string;

  @Column({ type: 'datetime' })
  startedAt!: Date;

  @Column({ type: 'datetime' })
  completedAt!: Date;

  @Column({ type: 'int' })
  durationMs!: number;

  @Column({ type: 'int' })
  httpStatus!: number;

  @Column({ type: 'int', default: 0 })
  responseSize!: number;

  @Column({ type: 'simple-json', nullable: true })
  requestHeadersSafe?: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  requestBodyTruncated?: string;

  @Column({ type: 'simple-json', nullable: true })
  responseHeadersSafe?: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  responseBodyTruncated?: string;

  @Column({ type: 'varchar', length: 20 })
  result!: 'SUCCESS' | 'FAILED';

  @Column({ type: 'varchar', length: 50, nullable: true })
  errorCode?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  errorCategory?: WebhookFailureCategory;

  @Column({ type: 'text', nullable: true })
  errorMessageSafe?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('admin_webhook_event_types')
export class WebhookEventTypeDefinition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  eventType!: string;

  @Column({ type: 'varchar', length: 20, default: '1.0' })
  version!: string;

  @Column({ type: 'varchar', length: 50 })
  category!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'simple-json' })
  schema!: any;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'DEPRECATED';

  @Column({ type: 'int', default: 0 })
  subscribersCount!: number;

  @Column({ type: 'int', default: 0 })
  eventsGeneratedCount!: number;

  @Column({ type: 'int', default: 0 })
  deliveriesCount!: number;

  @Column({ type: 'datetime', nullable: true })
  lastEmittedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('admin_webhook_dead_letters')
@Index(['organizationId', 'status'])
export class WebhookDeadLetterRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  deliveryId!: string;

  @Column({ type: 'varchar', length: 255 })
  eventId!: string;

  @Column({ type: 'varchar', length: 255 })
  endpointId!: string;

  @Column({ type: 'varchar', length: 255 })
  endpointName!: string;

  @Column({ type: 'varchar', length: 255 })
  organizationId!: string;

  @Column({ type: 'varchar', length: 255 })
  organizationName!: string;

  @Column({ type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'int' })
  attempts!: number;

  @Column({ type: 'text' })
  lastError!: string;

  @Column({ type: 'int' })
  lastHttpStatus!: number;

  @Column({ type: 'datetime' })
  deadLetteredAt!: Date;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'varchar', length: 20, default: 'UNRESOLVED' })
  status!: 'UNRESOLVED' | 'RESOLVED' | 'RETRIED' | 'DISCARDED';

  @Column({ type: 'datetime', nullable: true })
  resolvedAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resolvedBy?: string;

  @Column({ type: 'text', nullable: true })
  resolutionNotes?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('admin_webhook_security_events')
@Index(['type', 'createdAt'])
export class WebhookSecurityIncidentRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  type!: string;

  @Column({ type: 'varchar', length: 20, default: 'HIGH' })
  severity!: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

  @Column({ type: 'varchar', length: 255, nullable: true })
  endpointId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ipAddress?: string;

  @Column({ type: 'simple-json', nullable: true })
  details?: any;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('admin_webhook_exceptions')
export class WebhookExceptionRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  exceptionType!: string;

  @Column({ type: 'varchar', length: 20, default: 'ERROR' })
  severity!: 'ERROR' | 'WARNING' | 'CRITICAL';

  @Column({ type: 'varchar', length: 255, nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  endpointId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deliveryId?: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'text', nullable: true })
  stackTrace?: string;

  @Column({ type: 'boolean', default: false })
  resolved!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('admin_webhook_audit_logs')
export class WebhookAuditRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  action!: string;

  @Column({ type: 'varchar', length: 255 })
  actorId!: string;

  @Column({ type: 'varchar', length: 255 })
  actorEmail!: string;

  @Column({ type: 'varchar', length: 255 })
  targetId!: string;

  @Column({ type: 'varchar', length: 100 })
  targetType!: string;

  @Column({ type: 'simple-json', nullable: true })
  details?: any;

  @Column({ type: 'varchar', length: 100, default: '127.0.0.1' })
  ipAddress!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

