import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';
import {
  ApplicationStatus,
  AffiliateStatus,
  AttributionModel,
  AuditAction,
  CommissionType,
  ConversionStatus,
  FraudReviewStatus,
  FraudStatus,
  AffiliateTrustSource,
  FraudAssessmentType,
  FraudDecision,
  FraudEntityType,
  FraudRiskLevel,
  FraudSensitivity,
  FraudSignalCategory,
  FraudSignalCode,
  LedgerEntryType,
  OrganizationStatus,
  PlatformRole,
  PayoutStatus,
  ProgramStatus,
  ProgramType,
  Role,
  TrackingLinkStatus,
  UserStatus,
  IntegrationCategory,
  IntegrationConnectionType,
  IntegrationEnvironment,
  IntegrationEventStatus,
  IntegrationStatus,
  OrganizationIntegrationStatus,
} from '../common/enums';
import {
  RoleType,
  MembershipStatus,
  ProgramAccessType,
  PolicyEffect,
} from '../common/enums/rbac';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ type: 'varchar', length: 100 })
  lastName!: string;

  @Column({ type: 'varchar', length: 50, default: UserStatus.ACTIVE })
  status!: UserStatus;

  @Column({ type: 'boolean', default: false })
  emailVerified!: boolean;

  @Column({ type: 'varchar', length: 50, default: PlatformRole.USER })
  platformRole!: PlatformRole;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt?: Date;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ type: 'timestamp', nullable: true })
  lockedUntil?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  slug!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  industry?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  companySize?: string;

  @Column({ type: 'varchar', length: 10, default: 'US' })
  country!: string;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  defaultCurrency!: string;

  @Column({ type: 'varchar', length: 50, default: OrganizationStatus.ACTIVE })
  status!: OrganizationStatus;

  @Column({ type: 'boolean', default: false })
  onboardingCompleted!: boolean;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}

@Entity('organization_memberships')
@Unique(['organizationId', 'userId'])
export class OrganizationMembership {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 50 })
  role!: Role;

  @Column({ type: 'varchar', length: 50, default: MembershipStatus.ACTIVE })
  status!: MembershipStatus;

  @Column({ type: 'varchar', length: 50, default: ProgramAccessType.ALL })
  programAccessType!: ProgramAccessType;

  @Column({ type: 'simple-array', nullable: true })
  programIds?: string[];

  @Column({ type: 'uuid', nullable: true })
  invitedBy?: string;

  @CreateDateColumn()
  joinedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('auth_sessions')
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  refreshTokenHash!: string;

  @Index()
  @Column({ type: 'uuid' })
  tokenFamilyId!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ipAddress?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  deviceName?: string;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'timestamp' })
  lastUsedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('programs')
export class Program {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  slug!: string;

  @Column({ type: 'varchar', length: 50, default: ProgramType.AFFILIATE })
  type!: ProgramType;

  @Column({ type: 'varchar', length: 50, default: ProgramStatus.ACTIVE })
  status!: ProgramStatus;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency!: string;

  @Column({ type: 'varchar', length: 50, default: CommissionType.PERCENTAGE })
  commissionType!: CommissionType;

  @Column({ type: 'bigint', default: 1000 })
  defaultCommissionValue!: number;

  @Column({ type: 'varchar', length: 50, default: AttributionModel.LAST_CLICK })
  attributionModel!: AttributionModel;

  @Column({ type: 'int', default: 30 })
  cookieDurationDays!: number;

  @Column({ type: 'varchar', length: 20, default: 'AUTO' })
  affiliateApprovalMode!: string;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}

@Entity('affiliates')
export class Affiliate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'uuid', nullable: true })
  userId?: string;

  @Column({ type: 'varchar', length: 255 })
  displayName!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  companyName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website?: string;

  @Column({ type: 'varchar', length: 10, default: 'US' })
  country!: string;

  @Column({ type: 'varchar', length: 50, default: AffiliateStatus.ACTIVE })
  status!: AffiliateStatus;

  @Column({ type: 'int', default: 0 })
  trustScore!: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  payoutMethod?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('program_affiliates')
export class ProgramAffiliate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Column({ type: 'varchar', length: 50, default: AffiliateStatus.ACTIVE })
  status!: AffiliateStatus;

  @Column({ type: 'varchar', length: 100 })
  referralCode!: string;

  @Column({ type: 'int', nullable: true })
  commissionOverride?: number;

  @Column({ type: 'timestamp' })
  joinedAt!: Date;
}

@Entity('affiliate_applications')
export class AffiliateApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  promotionMethod?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  audienceSize?: string;

  @Column({ type: 'varchar', length: 10, default: 'US' })
  country!: string;

  @Column({ type: 'varchar', length: 50, default: ApplicationStatus.PENDING })
  status!: ApplicationStatus;

  @Column({ type: 'varchar', length: 36, nullable: true })
  reviewedBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('tracking_links')
export class TrackingLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  campaignId?: string;

  @Column({ type: 'varchar', length: 2000 })
  destinationUrl!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  shortCode!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subId?: string;

  @Column({ type: 'varchar', length: 50, default: TrackingLinkStatus.ACTIVE })
  status!: TrackingLinkStatus;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('clicks')
export class Click {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Index()
  @Column({ type: 'uuid' })
  trackingLinkId!: string;

  @Column({ type: 'varchar', length: 255 })
  anonymousId!: string;

  @Column({ type: 'varchar', length: 255 })
  ipHash!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  ipEncrypted?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent?: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  referrer?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  deviceType?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  browser?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  os?: string;

  @Column({ type: 'int', default: 0 })
  fraudScore!: number;

  @Column({ type: 'varchar', length: 50, default: FraudStatus.LOW })
  fraudStatus!: FraudStatus;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('attributions')
export class Attribution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Index()
  @Column({ type: 'uuid' })
  clickId!: string;

  @Column({ type: 'varchar', length: 255 })
  anonymousId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customerExternalId?: string;

  @Column({ type: 'varchar', length: 50, default: AttributionModel.LAST_CLICK })
  model!: AttributionModel;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 50 })
  prefix!: string;

  @Column({ type: 'varchar', length: 255 })
  keyHash!: string;

  @Column({ type: 'simple-array' })
  scopes!: string[];

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 255 })
  key!: string;

  @Column({ type: 'varchar', length: 255 })
  requestHash!: string;

  @Column({ type: 'int' })
  responseStatus!: number;

  @Column({ type: 'simple-json' })
  responseBody!: any;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('conversions')
export class Conversion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  affiliateId?: string;

  @Column({ type: 'varchar', length: 255 })
  externalId!: string;

  @Column({ type: 'varchar', length: 255 })
  customerExternalId!: string;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 10 })
  currency!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  productId?: string;

  @Column({ type: 'varchar', length: 50 })
  status!: ConversionStatus;

  @Column({ type: 'timestamp' })
  occurredAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('commission_rules')
export class CommissionRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'int' })
  priority!: number;

  @Column({ type: 'simple-json' })
  conditions!: any;

  @Column({ type: 'varchar', length: 50 })
  commissionType!: CommissionType;

  @Column({ type: 'int' })
  commissionValue!: number;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  effectiveFrom?: Date;

  @Column({ type: 'timestamp', nullable: true })
  effectiveTo?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('commissions')
export class Commission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Index()
  @Column({ type: 'uuid' })
  conversionId!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  ruleId?: string;

  @Column({ type: 'simple-json' })
  ruleSnapshot!: any;

  @Column({ type: 'int' })
  rate!: number;

  @Column({ type: 'int' })
  baseAmount!: number;

  @Column({ type: 'int' })
  commissionAmount!: number;

  @Column({ type: 'varchar', length: 50 })
  calculationVersion!: string;

  @Column({ type: 'varchar', length: 50 })
  status!: ConversionStatus;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('ledger_accounts')
export class LedgerAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  affiliateId?: string;

  @Column({ type: 'varchar', length: 20 })
  type!: string;

  @Column({ type: 'int', default: 0 })
  balance!: number;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('ledger_transactions')
export class LedgerTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 50 })
  type!: LedgerEntryType;

  @Column({ type: 'varchar', length: 500 })
  description!: string;

  @Column({ type: 'varchar', length: 255 })
  referenceId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('ledger_entries')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  transactionId!: string;

  @Index()
  @Column({ type: 'uuid' })
  accountId!: string;

  @Column({ type: 'varchar', length: 10 })
  type!: string;

  @Column({ type: 'int' })
  amount!: number;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('fraud_reviews')
export class FraudReview {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Index()
  @Column({ type: 'uuid' })
  conversionId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  assessmentId?: string;

  @Column({ type: 'varchar', length: 50, default: FraudEntityType.CONVERSION })
  entityType!: FraudEntityType;

  @Column({ type: 'uuid', nullable: true })
  entityId?: string;

  @Column({ type: 'int' })
  fraudScore!: number;

  @Column({ type: 'int', default: 0 })
  confidence!: number;

  @Column({ type: 'varchar', length: 50, default: FraudRiskLevel.LOW })
  riskLevel!: FraudRiskLevel;

  @Column({ type: 'simple-json' })
  signals!: any[];

  @Column({ type: 'varchar', length: 50, default: FraudReviewStatus.PENDING })
  status!: FraudReviewStatus;

  @Column({ type: 'uuid', nullable: true })
  assignedTo?: string;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  reviewDecision?: string;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt?: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  decisionReason?: string;

  @Column({ type: 'text', nullable: true })
  reviewNotes?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('fraud_settings')
@Unique(['organizationId', 'programId'])
export class FraudSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 50, default: FraudSensitivity.BALANCED })
  sensitivity!: FraudSensitivity;

  @Column({ type: 'int', default: 30 })
  allowMaxScore!: number;

  @Column({ type: 'int', default: 70 })
  reviewMaxScore!: number;

  @Column({ type: 'int', default: 71 })
  blockMinScore!: number;

  @Column({ type: 'int', default: 71 })
  payoutHoldScore!: number;

  @Column({ type: 'simple-json', nullable: true })
  enabledSignals?: FraudSignalCode[];

  @Column({ type: 'simple-json', nullable: true })
  signalWeights?: Record<string, number>;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('fraud_assessments')
export class FraudAssessment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Column({ type: 'varchar', length: 50 })
  entityType!: FraudEntityType;

  @Index()
  @Column({ type: 'uuid' })
  entityId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  affiliateId?: string;

  @Column({ type: 'int' })
  score!: number;

  @Column({ type: 'int' })
  confidence!: number;

  @Column({ type: 'varchar', length: 50 })
  riskLevel!: FraudRiskLevel;

  @Column({ type: 'varchar', length: 50 })
  decision!: FraudDecision;

  @Column({ type: 'varchar', length: 50 })
  engineVersion!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  policyVersion?: string;

  @Column({ type: 'varchar', length: 50 })
  assessmentType!: FraudAssessmentType;

  @Column({ type: 'simple-json', nullable: true })
  categoryScores?: Record<string, number>;

  @Column({ type: 'int', nullable: true })
  amount?: number;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('fraud_signals')
export class FraudSignal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  assessmentId!: string;

  @Column({ type: 'varchar', length: 80 })
  signalCode!: FraudSignalCode;

  @Column({ type: 'varchar', length: 50 })
  category!: FraudSignalCategory;

  @Column({ type: 'boolean' })
  detected!: boolean;

  @Column({ type: 'int' })
  score!: number;

  @Column({ type: 'int' })
  confidence!: number;

  @Column({ type: 'varchar', length: 1000 })
  reason!: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('affiliate_trust_history')
export class AffiliateTrustHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Column({ type: 'int' })
  previousScore!: number;

  @Column({ type: 'int' })
  newScore!: number;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @Column({ type: 'varchar', length: 50 })
  source!: AffiliateTrustSource;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('fraud_metric_rollups')
@Unique(['organizationId', 'programId', 'date'])
export class FraudMetricRollup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Column({ type: 'varchar', length: 20 })
  date!: string;

  @Column({ type: 'int', default: 0 })
  assessments!: number;

  @Column({ type: 'int', default: 0 })
  highRiskCount!: number;

  @Column({ type: 'int', default: 0 })
  blockedCount!: number;

  @Column({ type: 'int', default: 0 })
  reviewCount!: number;

  @Column({ type: 'int', default: 0 })
  fraudPreventedAmount!: number;

  @Column({ type: 'int', default: 0 })
  averageScore!: number;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('payout_batches')
export class PayoutBatch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 50 })
  status!: PayoutStatus;

  @Column({ type: 'int' })
  totalAmount!: number;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency!: string;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('payout_items')
export class PayoutItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  batchId!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency!: string;

  @Column({ type: 'varchar', length: 50 })
  status!: PayoutStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerReference?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('webhook_endpoints')
export class WebhookEndpoint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 2000 })
  url!: string;

  @Column({ type: 'varchar', length: 255 })
  secretHash!: string;

  @Column({ type: 'text' })
  secretEncrypted!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'simple-array' })
  subscribedEvents!: string[];

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  endpointId!: string;

  @Column({ type: 'varchar', length: 255 })
  eventId!: string;

  @Column({ type: 'int' })
  attempt!: number;

  @Column({ type: 'simple-json' })
  requestBody!: any;

  @Column({ type: 'int' })
  responseCode!: number;

  @Column({ type: 'text', nullable: true })
  responseBodyTruncated?: string;

  @Column({ type: 'int' })
  durationMs!: number;

  @Column({ type: 'varchar', length: 50 })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 20 })
  actorType!: string;

  @Column({ type: 'uuid' })
  actorId!: string;

  @Column({ type: 'varchar', length: 100 })
  action!: AuditAction;

  @Column({ type: 'varchar', length: 100 })
  resourceType!: string;

  @Column({ type: 'varchar', length: 255 })
  resourceId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ipAddress?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('public_keys')
export class PublicKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Column({ type: 'varchar', length: 255 })
  key!: string;

  @Column({ type: 'simple-array' })
  allowedDomains!: string[];

  @Column({ type: 'varchar', length: 20 })
  environment!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('integrations')
export class Integration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 50 })
  category!: IntegrationCategory;

  @Column({ type: 'varchar', length: 120 })
  provider!: string;

  @Column({ type: 'varchar', length: 50, default: IntegrationStatus.COMING_SOON })
  status!: IntegrationStatus;

  @Column({ type: 'simple-json' })
  connectionTypes!: IntegrationConnectionType[];

  @Column({ type: 'boolean', default: false })
  supportsOAuth!: boolean;

  @Column({ type: 'boolean', default: false })
  supportsWebhooks!: boolean;

  @Column({ type: 'boolean', default: false })
  supportsApiKey!: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  documentationUrl?: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  iconKey?: string;

  @Column({ type: 'int', default: 1000 })
  displayOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('organization_integrations')
@Unique(['organizationId', 'integrationId', 'environment'])
export class OrganizationIntegration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  integrationId!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  publicId!: string;

  @Column({ type: 'varchar', length: 50, default: OrganizationIntegrationStatus.PENDING })
  status!: OrganizationIntegrationStatus;

  @Column({ type: 'varchar', length: 50, default: IntegrationEnvironment.TEST })
  environment!: IntegrationEnvironment;

  @Column({ type: 'simple-json', nullable: true })
  config?: any;

  @Column({ type: 'timestamp', nullable: true })
  connectedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastWebhookAt?: Date;

  @Column({ type: 'text', nullable: true })
  lastError?: string;

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('integration_credentials')
@Unique(['organizationIntegrationId', 'credentialKey'])
export class IntegrationCredential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationIntegrationId!: string;

  @Column({ type: 'varchar', length: 120 })
  credentialKey!: string;

  @Column({ type: 'text' })
  encryptedValue!: string;

  @Column({ type: 'varchar', length: 64 })
  iv!: string;

  @Column({ type: 'varchar', length: 64 })
  authTag!: string;

  @Column({ type: 'int', default: 1 })
  keyVersion!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('integration_events')
@Unique(['organizationIntegrationId', 'externalEventId'])
export class IntegrationEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  integrationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationIntegrationId!: string;

  @Column({ type: 'varchar', length: 255 })
  externalEventId!: string;

  @Column({ type: 'varchar', length: 120 })
  eventType!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  normalizedType?: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  payloadHash?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  payloadReference?: string;

  @Column({ type: 'varchar', length: 50, default: IntegrationEventStatus.RECEIVED })
  status!: IntegrationEventStatus;

  @Column({ type: 'int', default: 0 })
  processingMs!: number;

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('integration_oauth_states')
export class IntegrationOAuthState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  integrationId!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  state!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  redirectUrl?: string;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  consumedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('billing_plans')
@Unique(['code', 'billingInterval', 'currency'])
export class BillingPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'int', default: 0 })
  price!: number;

  @Column({ type: 'varchar', length: 10, default: 'INR' })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: 'MONTHLY' })
  billingInterval!: string;

  @Column({ type: 'int', default: 1 })
  billingIntervalCount!: number;

  @Column({ type: 'int', default: 0 })
  trialDays!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'boolean', default: true })
  isPublic!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdDate!: Date;

  @UpdateDateColumn()
  modifiedDate!: Date;

  @Column({ type: 'uuid', nullable: true })
  modifiedBy?: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  rowStatus!: string;
}

@Entity('billing_plan_provider_mappings')
@Unique(['planId', 'provider', 'currency'])
export class BillingPlanProviderMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  planId!: string;

  @Column({ type: 'varchar', length: 30 })
  provider!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerPlanId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerPriceId?: string;

  @Column({ type: 'varchar', length: 10, default: 'INR' })
  currency!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdDate!: Date;

  @UpdateDateColumn()
  modifiedDate!: Date;
}

@Entity('billing_plan_features')
@Unique(['planId', 'featureKey'])
export class BillingPlanFeature {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  planId!: string;

  @Column({ type: 'varchar', length: 120 })
  featureKey!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'int', nullable: true })
  limitValue?: number;

  @CreateDateColumn()
  createdDate!: Date;

  @UpdateDateColumn()
  modifiedDate!: Date;
}

@Entity('billing_subscriptions')
@Unique(['organizationId', 'providerSubscriptionId'])
export class BillingSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  planId!: string;

  @Column({ type: 'varchar', length: 30 })
  provider!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerCustomerId?: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  providerSubscriptionId?: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'CREATED' })
  status!: string;

  @Column({ type: 'varchar', length: 20, default: 'MONTHLY' })
  billingInterval!: string;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodStart?: Date;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodEnd?: Date;

  @Column({ type: 'timestamp', nullable: true })
  trialStart?: Date;

  @Column({ type: 'timestamp', nullable: true })
  trialEnd?: Date;

  @Column({ type: 'boolean', default: false })
  cancelAtPeriodEnd!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  nextBillingDate?: Date;

  @Column({ type: 'uuid', nullable: true })
  pendingPlanId?: string;

  @Column({ type: 'timestamp', nullable: true })
  scheduledChangeDate?: Date;

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdDate!: Date;

  @UpdateDateColumn()
  modifiedDate!: Date;

  @Column({ type: 'uuid', nullable: true })
  modifiedBy?: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  rowStatus!: string;
}

@Entity('billing_payments')
export class BillingPayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  subscriptionId?: string;

  @Column({ type: 'varchar', length: 30 })
  provider!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  providerPaymentId?: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  providerOrderId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerInvoiceId?: string;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 10, default: 'INR' })
  currency!: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'CREATED' })
  status!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  paymentMethod?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  failureCode?: string;

  @Column({ type: 'text', nullable: true })
  failureReason?: string;

  @Column({ type: 'timestamp', nullable: true })
  paidAt?: Date;

  @CreateDateColumn()
  createdDate!: Date;

  @UpdateDateColumn()
  modifiedDate!: Date;
}

@Entity('billing_payment_events')
@Unique(['provider', 'providerEventId'])
export class BillingPaymentEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30 })
  provider!: string;

  @Column({ type: 'varchar', length: 255 })
  providerEventId!: string;

  @Column({ type: 'varchar', length: 120 })
  eventType!: string;

  @Column({ type: 'varchar', length: 128 })
  payloadHash!: string;

  @Column({ type: 'varchar', length: 50, default: 'RECEIVED' })
  status!: string;

  @Column({ type: 'int', default: 0 })
  retryCount!: number;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ type: 'timestamp' })
  receivedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  processedAt?: Date;

  @CreateDateColumn()
  createdDate!: Date;
}

@Entity('billing_refunds')
export class BillingRefund {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  paymentId!: string;

  @Column({ type: 'varchar', length: 30 })
  provider!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  providerRefundId?: string;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 10, default: 'INR' })
  currency!: string;

  @Column({ type: 'varchar', length: 50, default: 'CREATED' })
  status!: string;

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdDate!: Date;

  @UpdateDateColumn()
  modifiedDate!: Date;
}

@Entity('billing_invoices')
export class BillingInvoice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  subscriptionId?: string;

  @Column({ type: 'varchar', length: 30 })
  provider!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerInvoiceId?: string;

  @Column({ type: 'varchar', length: 80 })
  invoiceNumber!: string;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'int', default: 0 })
  tax!: number;

  @Column({ type: 'int' })
  total!: number;

  @Column({ type: 'varchar', length: 10, default: 'INR' })
  currency!: string;

  @Column({ type: 'varchar', length: 50, default: 'ISSUED' })
  status!: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  invoiceUrl?: string;

  @Column({ type: 'timestamp' })
  invoiceDate!: Date;

  @Column({ type: 'timestamp', nullable: true })
  dueDate?: Date;

  @Column({ type: 'timestamp', nullable: true })
  paidDate?: Date;
}
