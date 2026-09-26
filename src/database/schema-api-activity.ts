import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// 1. ApiRequest: Master record of every API invocation handled by PartnerIQ
// ─────────────────────────────────────────────────────────────────────────────

@Entity('api_requests')
export class ApiRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  requestId!: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  correlationId?: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  traceId?: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  parentRequestId?: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  organizationName?: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  actorId?: string;

  @Column({ type: 'varchar', length: 30, default: 'SYSTEM' })
  actorType!: 'USER' | 'ADMIN' | 'AFFILIATE' | 'API_CLIENT' | 'SYSTEM';

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail?: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  apiClientId?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  apiClientName?: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  apiKeyPrefix?: string;

  @Index()
  @Column({ type: 'varchar', length: 10 })
  method!: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

  @Index()
  @Column({ type: 'varchar', length: 500 })
  route!: string;

  @Index()
  @Column({ type: 'varchar', length: 300 })
  normalizedRoute!: string;

  @Column({ type: 'varchar', length: 20, default: 'v1' })
  apiVersion!: string;

  @Index()
  @Column({ type: 'int' })
  statusCode!: number;

  @Index()
  @Column({ type: 'varchar', length: 40 })
  result!:
    | 'SUCCESS'
    | 'CLIENT_ERROR'
    | 'SERVER_ERROR'
    | 'REDIRECT'
    | 'RATE_LIMITED'
    | 'AUTHENTICATION_FAILED'
    | 'AUTHORIZATION_FAILED';

  @Index()
  @Column({ type: 'int' })
  durationMs!: number;

  @Column({ type: 'int', default: 0 })
  requestSize!: number; // bytes

  @Column({ type: 'int', default: 0 })
  responseSize!: number; // bytes

  @Index()
  @Column({ type: 'varchar', length: 100, default: 'PartnerIQ API Gateway' })
  service!: string;

  @Index()
  @Column({ type: 'varchar', length: 40, default: 'production' })
  environment!: 'production' | 'staging' | 'development' | 'sandbox';

  @Column({ type: 'varchar', length: 40, default: 'ap-south-1' })
  region!: string;

  @Index()
  @Column({ type: 'varchar', length: 40, default: 'NONE' })
  authenticationMethod!:
    | 'SESSION'
    | 'JWT'
    | 'API_KEY'
    | 'OAUTH'
    | 'WEBHOOK_SIGNATURE'
    | 'SERVICE_CREDENTIAL'
    | 'NONE';

  @Column({ type: 'varchar', length: 64, default: '127.0.0.1' })
  ipAddress!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent?: string;

  @Column({ type: 'simple-json', nullable: true })
  querySafe?: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  headersSafe?: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  requestBodyRedacted?: string;

  @Column({ type: 'text', nullable: true })
  responseBodyRedacted?: string;

  @Column({ type: 'int', default: 0 })
  databaseQueryCount!: number;

  @Column({ type: 'int', default: 0 })
  databaseDurationMs!: number;

  @Column({ type: 'int', default: 0 })
  externalCallCount!: number;

  @Column({ type: 'int', default: 0 })
  externalDurationMs!: number;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  errorCode?: string;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  errorFingerprint?: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  securityEventId?: string;

  @Column({ type: 'varchar', length: 30, default: 'NORMAL' })
  rateLimitStatus!: 'NORMAL' | 'NEAR_LIMIT' | 'RATE_LIMITED' | 'BLOCKED';

  @Column({ type: 'timestamp' })
  startedAt!: Date;

  @Column({ type: 'timestamp' })
  completedAt!: Date;

  @Index()
  @CreateDateColumn()
  createdAt!: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ApiExternalCall: Outbound integration calls (Cashfree, Razorpay, HubSpot, etc.)
// ─────────────────────────────────────────────────────────────────────────────

@Entity('api_external_calls')
export class ApiExternalCall {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  apiRequestId!: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  traceId?: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  provider!: string; // Cashfree, Razorpay, HubSpot, Zoho, Google, Cloudinary, SendGrid, etc.

  @Column({ type: 'varchar', length: 100 })
  operation!: string; // payout_transfer, webhook_dispatch, contact_sync, etc.

  @Column({ type: 'varchar', length: 10, default: 'POST' })
  method!: string;

  @Column({ type: 'varchar', length: 500 })
  endpointTemplate!: string;

  @Index()
  @Column({ type: 'int' })
  statusCode!: number;

  @Column({ type: 'int' })
  durationMs!: number;

  @Column({ type: 'int', default: 1 })
  attemptNumber!: number;

  @Column({ type: 'int', default: 0 })
  retryCount!: number;

  @Index()
  @Column({ type: 'varchar', length: 30 })
  result!: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'RATE_LIMITED';

  @Column({ type: 'varchar', length: 100, nullable: true })
  errorCode?: string;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ type: 'timestamp' })
  startedAt!: Date;

  @Column({ type: 'timestamp' })
  completedAt!: Date;

  @Index()
  @CreateDateColumn()
  createdAt!: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ApiErrorGroup: Fingerprinted clusters of real API errors
// ─────────────────────────────────────────────────────────────────────────────

@Entity('api_error_groups')
export class ApiErrorGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  errorFingerprint!: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  errorCode!: string;

  @Index()
  @Column({ type: 'int' })
  httpStatus!: number;

  @Column({ type: 'varchar', length: 100 })
  service!: string;

  @Column({ type: 'varchar', length: 300 })
  normalizedRoute!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'int', default: 1 })
  occurrenceCount!: number;

  @Column({ type: 'timestamp' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamp' })
  lastSeenAt!: Date;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INVESTIGATING' | 'RESOLVED' | 'IGNORED';

  @Column({ type: 'int', default: 1 })
  affectedOrganizationsCount!: number;

  @Column({ type: 'int', default: 1 })
  affectedClientsCount!: number;

  @Column({ type: 'varchar', length: 64 })
  sampleRequestId!: string;

  @Column({ type: 'text', nullable: true })
  stackTraceSanitized?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ApiRateLimitQuota: Real-time and historical rate limit consumption
// ─────────────────────────────────────────────────────────────────────────────

@Entity('api_rate_limit_quotas')
export class ApiRateLimitQuota {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 30 })
  entityType!: 'ORGANIZATION' | 'CLIENT' | 'IP';

  @Index()
  @Column({ type: 'varchar', length: 64 })
  entityId!: string;

  @Column({ type: 'varchar', length: 120 })
  entityName!: string;

  @Column({ type: 'varchar', length: 300, default: '*' })
  endpoint!: string;

  @Column({ type: 'int', default: 1000 })
  limit!: number;

  @Column({ type: 'int', default: 0 })
  currentUsage!: number;

  @Column({ type: 'int', default: 60 })
  windowSeconds!: number;

  @Column({ type: 'int', default: 0 })
  rateLimitedCount!: number;

  @Column({ type: 'timestamp', nullable: true })
  lastViolationAt?: Date;

  @Column({ type: 'varchar', length: 30, default: 'NORMAL' })
  status!: 'NORMAL' | 'WARNING' | 'EXCEEDED';

  @CreateDateColumn()
  createdAt!: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ApiActivityAudit: Immutable audit records for operator security actions
// ─────────────────────────────────────────────────────────────────────────────

@Entity('api_activity_audits')
export class ApiActivityAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 60 })
  action!:
    | 'EXPORT'
    | 'SETTINGS_CHANGED'
    | 'REDACTION_POLICY_UPDATED'
    | 'BODY_LOGGING_TOGGLED'
    | 'QUOTA_OVERRIDE'
    | 'RATE_LIMIT_RESET';

  @Column({ type: 'varchar', length: 64 })
  actorId!: string;

  @Column({ type: 'varchar', length: 255 })
  actorEmail!: string;

  @Column({ type: 'simple-json', nullable: true })
  details?: any;

  @Column({ type: 'varchar', length: 64, default: '127.0.0.1' })
  ipAddress!: string;

  @Index()
  @CreateDateColumn()
  timestamp!: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ApiActivityException: Telemetry pipeline or write failures
// ─────────────────────────────────────────────────────────────────────────────

@Entity('api_activity_exceptions')
export class ApiActivityException {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  exceptionCode!: string;

  @Column({ type: 'varchar', length: 30 })
  severity!: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

  @Column({ type: 'varchar', length: 100 })
  component!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  requestId?: string;

  @Column({ type: 'text' })
  expected!: string;

  @Column({ type: 'text' })
  actual!: string;

  @Column({ type: 'int', default: 0 })
  retryCount!: number;

  @Column({ type: 'text' })
  impact!: string;

  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  status!: 'PENDING' | 'RESOLVED' | 'IGNORED';

  @Index()
  @CreateDateColumn()
  detectedAt!: Date;
}

