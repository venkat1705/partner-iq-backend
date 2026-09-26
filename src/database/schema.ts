import { Entity, PrimaryGeneratedColumn, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';
import {
  EnvironmentType,
  SubscriptionStatus,
  ApplicationStatus,
  AffiliateStatus,
  AffiliateInvitationStatus,
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
  CrmHealthStatus,
  PartnerDealCommissionStatus,
  PartnerDealStatus,
  AssetBundleStatus,
  AssetBundleVisibility,
  AssetSourceType,
  AssetStatus,
  AssetType,
  AffiliateAssetActivityType,
  TierEvaluationPeriod,
  TierDowngradeMode,
  CommissionRateEffectiveStrategy,
  TierTransitionType,
  GamificationMetric,
  MilestoneRewardType,
  MilestoneResetBehavior,
  MilestoneRewardStatus,
  AutomationTriggerType,
  AutomationWorkflowStatus,
  AutomationNodeType,
  AutomationActionType,
  AutomationExecutionStatus,
  AutomationStepStatus,
  AutomationEmailDeliveryStatus,
  TemplateChannel,
  DocumentType,
  DocumentStatus,
  TemplateStatus,
  PageSize,
  PageOrientation,
} from '../common/enums';
import { PLATFORM_CURRENCY } from '../common/constants/currency';
import {
  RoleType,
  MembershipStatus,
  ProgramAccessType,
  PolicyEffect,
} from '../common/enums/rbac';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
} from '../modules/notifications/notifications.types';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  passwordHash?: string;

  @Column({ type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ type: 'varchar', length: 100 })
  lastName!: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  avatarUrl?: string;

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

  /**
   * Set on accounts bootstrapped with a generated password (e.g. by
   * `create-super-admin`) so the holder is forced to set their own password
   * before touching anything else. Cleared by `POST /auth/set-password`.
   */
  @Column({ type: 'boolean', default: false })
  mustChangePassword!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}

@Entity('user_identities')
@Unique(['provider', 'providerUserId'])
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  provider!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  providerUserId!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'boolean', default: false })
  emailVerified!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  displayName?: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  avatarUrl?: string;

  @Column({ type: 'simple-json', nullable: true })
  providerMetadata?: any;

  @CreateDateColumn()
  linkedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('organizations')
@Index(['createdBy', 'onboardingIdempotencyKey'], { unique: true })
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Customer account this organization belongs to. Nullable for rows created
   * before account-level billing existed — BillingAccountService backfills it
   * on first access from `createdBy`.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  accountId?: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  slug?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  industry?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  companySize?: string;

  @Column({ type: 'varchar', length: 200, default: 'US' })
  country!: string;

  @Column({ type: 'varchar', length: 10, default: PLATFORM_CURRENCY })
  defaultCurrency!: string;

  @Column({ type: 'varchar', length: 50, default: OrganizationStatus.ACTIVE })
  status!: OrganizationStatus;

  @Column({ type: 'boolean', default: false })
  onboardingCompleted!: boolean;

  @Column({ type: 'uuid' })
  createdBy!: string;

  /**
   * Client-generated key (e.g. one `useRef(crypto.randomUUID())` per onboarding
   * form mount), unique per creator. Lets a double-submit (double-click, retry,
   * two tabs racing the same form) resolve to the SAME organization instead of
   * creating a duplicate — enforced at the database level, not just in the UI.
   * NULL for organizations created outside onboarding (MySQL's unique index
   * treats NULLs as distinct, so those rows are never deduped against it).
   *
   * This alone isn't enough: a refresh, closed tab, or re-login starts a FRESH
   * form mount with a NEW key, so it can't catch "user re-enters onboarding
   * after already starting it". `onboardingStatus`/`onboardingLockKey` below
   * are the actual guard for that; this key only covers same-session replay.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  onboardingIdempotencyKey?: string;

  /**
   * 'IN_PROGRESS' from the moment the onboarding wizard creates the org until
   * `completeOnboarding()` runs; 'COMPLETED' immediately for organizations
   * created through the plain (non-wizard) create endpoint, since those have
   * no multi-step flow to resume. Distinct from the legacy `onboardingCompleted`
   * boolean above, which this keeps in sync but doesn't replace, since other
   * code already reads that field.
   */
  @Column({ type: 'varchar', length: 20, default: 'COMPLETED' })
  onboardingStatus!: 'IN_PROGRESS' | 'COMPLETED';

  /** Which onboarding step the user last reached — lets the frontend resume there instead of restarting at step 1. */
  @Column({ type: 'int', default: 1 })
  onboardingStep!: number;

  /**
   * Set to `createdBy` while onboardingStatus is 'IN_PROGRESS', NULL once
   * completed. The unique index below means MySQL itself refuses a second row
   * with the same value — i.e. at most one in-progress onboarding org per
   * user, no matter how many times they re-enter the wizard (new tab, new
   * idempotency key, whatever). NULLs are distinct in a MySQL unique index,
   * so completed/plain-create organizations (lockKey NULL) never collide.
   */
  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  onboardingLockKey?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}

@Entity('organization_brandings')
export class OrganizationBranding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'mediumtext', nullable: true })
  logoUrl?: string;

  @Column({ type: 'mediumtext', nullable: true })
  logoDarkUrl?: string;

  @Column({ type: 'mediumtext', nullable: true })
  faviconUrl?: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  primaryColor?: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  secondaryColor?: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  backgroundColor?: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  textColor?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  heroHeaderPill?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  heroTitle?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  heroHighlightText?: string;

  @Column({ type: 'text', nullable: true })
  heroDescription?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  heroCtaText?: string;

  @Column({ type: 'mediumtext', nullable: true })
  heroImageUrl?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  storyTitle?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  storyHeading?: string;

  @Column({ type: 'text', nullable: true })
  storyDescription?: string;

  @Column({ type: 'text', nullable: true })
  mission?: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  foundedYear?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location?: string;

  @Column({ type: 'simple-json', nullable: true })
  accreditations?: string[];

  @Column({ type: 'simple-json', nullable: true })
  trustMetrics?: Array<{ label: string; value: string }>;

  @Column({ type: 'varchar', length: 255, nullable: true })
  legalName?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  partnerBenefits?: Array<{ title: string; description?: string; icon?: string }>;

  @Column({ type: 'simple-json', nullable: true })
  howItWorks?: Array<{ title: string; description?: string }>;

  @Column({ type: 'simple-json', nullable: true })
  faq?: Array<{ question: string; answer: string; active?: boolean }>;

  @Column({ type: 'text', nullable: true })
  footerDescription?: string;

  @Column({ type: 'simple-json', nullable: true })
  footerLinks?: Array<{ label: string; url: string; newTab?: boolean }>;

  @Column({ type: 'simple-json', nullable: true })
  socialLinks?: Record<string, string>;

  @Column({ type: 'varchar', length: 255, nullable: true })
  privacyUrl?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  termsUrl?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cookiePolicyUrl?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  partnerTermsUrl?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  seoTitle?: string;

  @Column({ type: 'text', nullable: true })
  seoDescription?: string;

  @Column({ type: 'mediumtext', nullable: true })
  seoImageUrl?: string;

  @Column({ type: 'simple-json', nullable: true })
  visibility?: { showPrograms?: boolean; showBenefits?: boolean; showHowItWorks?: boolean; showFaq?: boolean; showCompany?: boolean; showSocialLinks?: boolean };

  @Column({ type: 'boolean', default: false, nullable: true })
  highlightWebsite?: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
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

  // Security extensions
  @Index()
  @Column({ type: 'uuid', nullable: true })
  deviceId?: string;

  @Column({ type: 'uuid', nullable: true })
  organizationContextId?: string;

  @Column({ type: 'varchar', length: 50, default: 'PASSWORD' })
  authenticationLevel!: string;

  @Column({ type: 'timestamp', nullable: true })
  mfaVerifiedAt?: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  region?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  revokeReason?: string;

  @Column({ type: 'timestamp', nullable: true })
  idleExpiresAt?: Date;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'timestamp' })
  lastUsedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('user_devices')
export class UserDevice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  deviceIdentifierHash!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  displayName?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  deviceType?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  operatingSystem?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  osVersion?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  browser?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  browserVersion?: string;

  @Column({ type: 'timestamp', nullable: true })
  firstSeenAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt?: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lastIpAddress?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  region?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city?: string;

  @Column({ type: 'boolean', default: false })
  isTrusted!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  trustedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  trustedUntil?: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('user_mfa_configs')
export class UserMfaConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 50, nullable: true })
  method?: string;

  @Column({ type: 'text', nullable: true })
  secretEncrypted?: string;

  @Column({ type: 'timestamp', nullable: true })
  enabledAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastVerifiedAt?: Date;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('user_recovery_codes')
export class UserRecoveryCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 128 })
  codeHash!: string;

  @Column({ type: 'timestamp', nullable: true })
  usedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('mfa_challenges')
export class MfaChallenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 100 })
  challengeId!: string;

  @Column({ type: 'varchar', length: 50 })
  method!: string;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  usedAt?: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ipAddress?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('auth_security_events')
export class AuthSecurityEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId?: string;

  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'uuid', nullable: true })
  sessionId?: string;

  @Column({ type: 'uuid', nullable: true })
  deviceId?: string;

  @Column({ type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ipAddress?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  region?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  browser?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  operatingSystem?: string;

  @Column({ type: 'int', default: 0 })
  riskScore!: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  riskLevel?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('organization_security_policies')
export class OrganizationSecurityPolicy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'boolean', default: false })
  requireMfa!: boolean;

  @Column({ type: 'varchar', length: 50, default: 'ALL' })
  mfaScope!: string; // 'ALL' | 'ADMINS' | 'SENSITIVE_ROLES'

  @Column({ type: 'simple-json', nullable: true })
  sensitiveRoles?: string[];

  @Column({ type: 'int', default: 10080 })
  sessionIdleTimeoutMinutes!: number; // Default 7 days

  @Column({ type: 'uuid', nullable: true })
  updatedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('mfa_rate_limits')
export class MfaRateLimit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 200 })
  key!: string; // e.g. "mfa_verify:challengeId" or "mfa_verify:ip:1.2.3.4"

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamp' })
  windowStart!: Date;

  @Column({ type: 'timestamp', nullable: true })
  lockedUntil?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 50, default: 'system' })
  type!: NotificationCategory;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', length: 50, default: 'in_app' })
  channel!: NotificationChannel;

  @Column({ type: 'varchar', length: 50, default: 'normal' })
  priority!: NotificationPriority;

  @Column({ type: 'boolean', default: false })
  isRead!: boolean;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  actionUrl?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: string;
}

@Entity('notification_preferences')
@Unique(['userId', 'organizationId'])
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'simple-json' })
  channels!: Record<NotificationChannel, boolean>;

  @Column({ type: 'simple-json' })
  categories!: Record<NotificationCategory, boolean>;

  @CreateDateColumn()
  createdAt?: Date;

  @UpdateDateColumn()
  updatedAt?: Date;
}

@Entity('programs')
@Index(['organizationId', 'environment'])
@Index(['organizationId', 'environment', 'status'])
export class Program {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  slug!: string;

  @Column({ type: 'varchar', length: 50, default: ProgramType.AFFILIATE })
  type!: ProgramType;

  @Column({ type: 'varchar', length: 50, default: ProgramStatus.ACTIVE })
  status!: ProgramStatus;

  @Column({ type: 'varchar', length: 10, default: PLATFORM_CURRENCY })
  currency!: string;

  @Column({ type: 'varchar', length: 50, default: CommissionType.PERCENTAGE })
  commissionType!: CommissionType;

  @Column({ type: 'bigint', default: 1000 })
  defaultCommissionValue!: number;

  @Column({ type: 'varchar', length: 50, default: AttributionModel.LAST_CLICK })
  attributionModel!: AttributionModel;

  @Column({ type: 'int', default: 30 })
  attributionWindowDays!: number;

  @Column({ type: 'int', default: 30 })
  cookieDurationDays!: number;

  @Column({ type: 'varchar', length: 40, default: 'PROMO_CODE' })
  couponAttributionPriority!: 'PROMO_CODE' | 'AFFILIATE' | 'LAST_CLICK';

  @Column({ type: 'simple-json', nullable: true })
  attributionConfig?: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'AUTO' })
  affiliateApprovalMode!: string;

  @Column({ type: 'bigint', default: 0 })
  minimumPayoutAmount!: number;

  @Column({ type: 'varchar', length: 20, default: 'MONTHLY' })
  payoutSchedule!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  payoutDay?: string;

  @Column({ type: 'simple-json', nullable: true })
  payoutMethods?: string[];

  @Column({ type: 'varchar', length: 1000, nullable: true })
  logoUrl?: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  bannerUrl?: string;

  @Column({ type: 'varchar', length: 50, default: 'PUBLIC', nullable: true })
  visibility?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  shortDescription?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category?: string;

  @Column({ type: 'simple-json', nullable: true })
  tags?: string[];

  @Column({ type: 'varchar', length: 1000, nullable: true })
  websiteUrl?: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  landingUrl?: string;

  @Column({ type: 'text', nullable: true })
  termsContent?: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  termsUrl?: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  privacyPolicyUrl?: string;

  @Column({ type: 'simple-json', nullable: true })
  promotionRules?: Record<string, unknown>;

  @Column({ type: 'simple-json', nullable: true })
  allowedAffiliateTypes?: string[];

  @Column({ type: 'simple-json', nullable: true })
  customRules?: Record<string, unknown>[];

  // Per-program commission-rate overrides for existing organization-level partner tiers
  // (e.g. "Gold tier affiliates get 22% instead of the org default of 20% on THIS
  // program"). Stored here rather than mutated onto the shared PartnerTier record,
  // because a PartnerTier can be reused across multiple programs and an override
  // entered while configuring one program must not silently change another.
  @Column({ type: 'simple-json', nullable: true })
  tierOverrides?: Record<string, unknown>[];

  // Org-admin controlled "Featured" badge for the public marketplace. Defaults to
  // false — a program is only featured because the org explicitly said so, never
  // because a fallback assumed every program deserves the badge. Optional in the TS
  // type (unlike other required columns) so existing in-memory callers that build a
  // ProgramEntity by hand without this field still compile; the DB/service default
  // (false) still applies wherever a value is actually persisted.
  @Column({ type: 'boolean', default: false })
  featured?: boolean;

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


/**
 * A tax certificate (Form 16A, 1099, etc.) published to one affiliate for one
 * filing period. Certificates are issued by PartnerIQ staff, never by the
 * partner, so there is no affiliate-facing write path — only list and download.
 */
@Entity('affiliate_tax_certificates')
@Index(['userId', 'financialYear'])
export class AffiliateTaxCertificate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The affiliate's user id — the same identity the portal authenticates as. */
  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  /** Set when the certificate relates to earnings from one organization. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 50, default: 'FORM_16A' })
  formType!: string;

  /** e.g. "FY 2025-26". */
  @Column({ type: 'varchar', length: 20 })
  financialYear!: string;

  /** e.g. "Q3" — null for an annual certificate. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  quarter?: string;

  @Column({ type: 'varchar', length: 255 })
  periodLabel!: string;

  @Column({ type: 'varchar', length: 2000 })
  fileUrl!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fileName?: string;

  @Column({ type: 'int', default: 0 })
  fileSizeBytes!: number;

  /** Minor units, matching every other money column in this schema. */
  @Column({ type: 'bigint', default: 0 })
  grossAmount!: number;

  @Column({ type: 'bigint', default: 0 })
  taxWithheldAmount!: number;

  @Column({ type: 'varchar', length: 10, default: 'INR' })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: 'PUBLISHED' })
  status!: 'DRAFT' | 'PUBLISHED' | 'REVOKED';

  @Column({ type: 'timestamp', nullable: true })
  publishedAt?: Date;

  /** The staff user who published it, for audit. */
  @Column({ type: 'uuid', nullable: true })
  publishedByUserId?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('affiliate_portal_profiles')
export class AffiliatePortalProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  userId!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fullName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 50, default: 'India' })
  country!: string;

  @Column({ type: 'varchar', length: 50, default: 'AFFILIATE' })
  partnerType!: string;

  @Column({ type: 'varchar', length: 255, default: 'India' })
  primaryMarket!: string;

  @Column({ type: 'varchar', length: 50, default: '0-1k' })
  audienceSize!: string;

  @Column({ type: 'simple-json', nullable: true })
  socialProfiles?: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  bio?: string;

  @Column({ type: 'boolean', default: false })
  onboardingCompleted!: boolean;

  @Column({ type: 'varchar', length: 50, default: 'India' })
  taxCountry!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  panOrTaxId?: string;

  @Column({ type: 'text', nullable: true })
  panOrTaxIdEncrypted?: string;

  @Column({ type: 'varchar', length: 50, default: 'INDIVIDUAL' })
  taxClassification!: string;

  @Column({ type: 'int', default: 0 })
  withholdingRate!: number;

  @Column({ type: 'boolean', default: false })
  taxVerified!: boolean;

  @Column({ type: 'varchar', length: 50, default: 'PAN_TDS' })
  taxFormType!: string;

  @Column({ type: 'timestamp', nullable: true })
  taxSubmittedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('affiliate_payout_methods')
export class AffiliatePayoutMethod {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 50 })
  type!: string;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  bankName?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  accountNumberMasked?: string;

  @Column({ type: 'text', nullable: true })
  accountNumberEncrypted?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  ifscCode?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  accountHolderName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  upiIdMasked?: string;

  @Column({ type: 'text', nullable: true })
  upiIdEncrypted?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paypalEmailMasked?: string;

  @Column({ type: 'text', nullable: true })
  paypalEmailEncrypted?: string;

  @Column({ type: 'simple-json', nullable: true })
  authorizedOrgIds?: string[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('affiliate_support_tickets')
export class AffiliateSupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 255, default: 'Global Partner Support' })
  organizationName!: string;

  @Column({ type: 'varchar', length: 255 })
  subject!: string;

  @Column({ type: 'varchar', length: 100, default: 'General Support' })
  category!: string;

  @Column({ type: 'varchar', length: 50, default: 'NORMAL' })
  priority!: string;

  @Column({ type: 'varchar', length: 50, default: 'OPEN' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  message?: string;

  @Column({ type: 'text', nullable: true })
  lastReply?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('program_affiliates')
@Index(['organizationId', 'environment'])
// One membership per affiliate per program. Enforced in the database so a
// double-submitted invitation or a race between two accept calls cannot
// produce two rows for the same partner in the same program.
@Unique(['programId', 'affiliateId'])
export class ProgramAffiliate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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

  @Column({ type: 'varchar', length: 50, nullable: true })
  commissionOverrideType?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  source?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  primaryChannel?: string;

  @Column({ type: 'int', nullable: true })
  termsVersionAccepted?: number;

  @Column({ type: 'timestamp', nullable: true })
  termsAcceptedAt?: Date;

  @Column({ type: 'uuid', nullable: true })
  invitedBy?: string;

  @Column({ type: 'timestamp' })
  joinedAt!: Date;
}

@Entity('affiliate_invitations')
@Index(['organizationId', 'environment'])
export class AffiliateInvitation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 150 })
  partnerName!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  affiliateType?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  primaryChannel?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  customChannel?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  commissionOverrideType?: string;

  @Column({ type: 'bigint', nullable: true })
  commissionOverrideValue?: number;

  @Column({ type: 'text', nullable: true })
  personalMessage?: string;

  @Column({ type: 'varchar', length: 50, default: AffiliateInvitationStatus.PENDING })
  status!: AffiliateInvitationStatus;

  @Column({ type: 'varchar', length: 255 })
  tokenHash!: string;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'uuid' })
  invitedBy!: string;

  @Column({ type: 'uuid', nullable: true })
  acceptedBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt?: Date;

  /**
   * When the invited partner accepted the program terms on the invitation page.
   * Set before they have an account — acceptance of terms is not membership.
   */
  @Column({ type: 'timestamp', nullable: true })
  termsAcceptedAt?: Date;

  @Column({ type: 'int', nullable: true })
  termsVersionAccepted?: number;

  /** When the membership was actually created, after portal authentication. */
  @Column({ type: 'timestamp', nullable: true })
  joinedAt?: Date;

  /** The affiliate record this invitation ultimately produced or linked to. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  affiliateId?: string;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('affiliate_applications')
@Index(['organizationId', 'environment'])
export class AffiliateApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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
@Index(['organizationId', 'environment'])
@Unique(['organizationId', 'environment', 'shortCode'])
export class TrackingLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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

  @Index()
  @Column({ type: 'varchar', length: 255 })
  shortCode!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subId?: string;

  @Column({ type: 'varchar', length: 50, default: TrackingLinkStatus.ACTIVE })
  status!: TrackingLinkStatus;

  // 'CUSTOM' = affiliate-authored link (alias/campaign/subId, via POST /affiliate/me/links).
  // 'PROGRAM_DEFAULT' = the single auto-generated canonical link for an
  // affiliate+program pair (via POST /affiliate/me/programs/:programId/links).
  @Column({ type: 'varchar', length: 30, default: 'CUSTOM' })
  linkKind?: 'CUSTOM' | 'PROGRAM_DEFAULT';

  // Set only for PROGRAM_DEFAULT rows, to `${organizationId}:${environment}:${programId}:${affiliateId}`.
  // Left null for CUSTOM links. The unique index on this column is what makes
  // concurrent "get or create the program default link" requests race-safe —
  // MySQL unique indexes allow unlimited NULLs, so CUSTOM links are unaffected.
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 160, nullable: true })
  affiliateProgramDefaultKey?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  utmSource?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  utmMedium?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  utmCampaign?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  utmTerm?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  utmContent?: string;

  @Column({ type: 'json', nullable: true })
  customParameters?: Record<string, string>;

  @Column({ type: 'varchar', length: 30, default: 'HEALTHY' })
  healthStatus?: 'HEALTHY' | 'DEGRADED' | 'BROKEN' | 'INACTIVE';

  @Column({ type: 'simple-array', nullable: true })
  healthIssues?: string[];

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastActivityAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn({ nullable: true })
  updatedAt?: Date;
}

@Entity('asset_tags')
@Unique(['organizationId', 'name'])
export class AssetTag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 90 })
  slug!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('assets')
@Index(['organizationId', 'environment'])
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  assetType!: AssetType;

  @Column({ type: 'varchar', length: 30, default: AssetSourceType.FILE })
  sourceType!: AssetSourceType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  contentType?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fileName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  originalFileName?: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  fileExtension?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  mimeType?: string;

  @Column({ type: 'bigint', nullable: true })
  fileSize?: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  storageProvider?: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  storageKey?: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  storageUrl?: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  thumbnailUrl?: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  previewUrl?: string;

  @Column({ type: 'text', nullable: true })
  textContent?: string;

  @Column({ type: 'text', nullable: true })
  htmlContent?: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  externalUrl?: string;

  @Column({ type: 'int', nullable: true })
  width?: number;

  @Column({ type: 'int', nullable: true })
  height?: number;

  @Column({ type: 'int', nullable: true })
  duration?: number;

  @Index()
  @Column({ type: 'varchar', length: 12, nullable: true })
  language?: string;

  @Index()
  @Column({ type: 'varchar', length: 12, nullable: true })
  country?: string;

  @Column({ type: 'simple-array', nullable: true })
  tags?: string[];

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, unknown>;

  @Index()
  @Column({ type: 'varchar', length: 40, default: AssetStatus.DRAFT })
  status!: AssetStatus;

  @Column({ type: 'boolean', default: false })
  isPublicToAffiliates!: boolean;

  @Column({ type: 'boolean', default: true })
  isDownloadable!: boolean;

  @Column({ type: 'boolean', default: true })
  isCopyable!: boolean;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  checksum?: string;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}

@Entity('asset_versions')
@Unique(['assetId', 'versionNumber'])
export class AssetVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  assetId!: string;

  @Column({ type: 'int' })
  versionNumber!: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  storageKey?: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  storageUrl?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fileName?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  mimeType?: string;

  @Column({ type: 'bigint', nullable: true })
  fileSize?: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  checksum?: string;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  changeNotes?: string;

  @Column({ type: 'boolean', default: false })
  isCurrent!: boolean;
}

@Entity('asset_bundles')
@Unique(['organizationId', 'slug'])
export class AssetBundle {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  campaignId?: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'uuid', nullable: true })
  coverImageAssetId?: string;

  @Index()
  @Column({ type: 'varchar', length: 40, default: AssetBundleStatus.DRAFT })
  status!: AssetBundleStatus;

  @Index()
  @Column({ type: 'varchar', length: 60, default: AssetBundleVisibility.ALL_PROGRAM_AFFILIATES })
  visibility!: AssetBundleVisibility;

  @Column({ type: 'timestamp', nullable: true })
  startDate?: Date;

  @Column({ type: 'timestamp', nullable: true })
  endDate?: Date;

  @Column({ type: 'varchar', length: 12, nullable: true })
  language?: string;

  @Column({ type: 'varchar', length: 12, nullable: true })
  country?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  partnerTierId?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  affiliateSegmentId?: string;

  @Column({ type: 'simple-array', nullable: true })
  affiliateIds?: string[];

  @Column({ type: 'int', default: 1000 })
  displayOrder!: number;

  @Column({ type: 'boolean', default: false })
  featured!: boolean;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}

@Entity('asset_bundle_items')
@Unique(['assetBundleId', 'assetId'])
export class AssetBundleItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  assetBundleId!: string;

  @Index()
  @Column({ type: 'uuid' })
  assetId!: string;

  @Column({ type: 'int', default: 1000 })
  displayOrder!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customTitle?: string;

  @Column({ type: 'text', nullable: true })
  customDescription?: string;

  @Column({ type: 'boolean', default: false })
  isFeatured!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'uuid' })
  createdBy!: string;
}

@Entity('affiliate_asset_activities')
export class AffiliateAssetActivity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Index()
  @Column({ type: 'uuid' })
  assetId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  bundleId?: string;

  @Index()
  @Column({ type: 'varchar', length: 40 })
  activityType!: AffiliateAssetActivityType;

  @Column({ type: 'varchar', length: 120, nullable: true })
  idempotencyKey?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, unknown>;
}

@Entity('affiliate_asset_favorites')
@Unique(['affiliateId', 'assetId', 'bundleId'])
export class AffiliateAssetFavorite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  affiliateId!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  assetId?: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  bundleId?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('clicks')
@Index(['organizationId', 'environment'])
@Index(['organizationId', 'environment', 'createdAt'])
export class Click {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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

  @Column({ type: 'varchar', length: 2000, nullable: true })
  landingUrl?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  utmSource?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  utmMedium?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  utmCampaign?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  utmTerm?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  utmContent?: string;

  /**
   * The traffic source as configured on the tracking link, captured at click
   * time.
   *
   * `utmSource` above holds the *effective* value, which an inbound
   * `?utm_source=` overrides — that override is a deliberate feature (partners
   * tag placements per channel) and it is what gets forwarded to the merchant.
   * But it also means a partner can decide what appears in the organization's
   * own traffic-source reporting. Source breakdowns read this column instead,
   * so reporting reflects how the link was set up rather than what the partner
   * put in the URL.
   *
   * Stored rather than resolved from the link at query time so that editing a
   * link's UTMs later does not silently re-bucket historical clicks.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  canonicalUtmSource?: string;

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
@Index(['organizationId', 'environment'])
export class Attribution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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

  @Column({ type: 'simple-json', nullable: true })
  breakdown?: Array<Record<string, unknown>>;

  @Index()
  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('api_keys')
@Index(['organizationId', 'environment'])
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

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Column({ type: 'simple-array' })
  scopes!: string[];

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastUsedIpHash?: string;

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
@Index(['organizationId', 'environment', 'key'])
export class IdempotencyKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  apiKeyId?: string;

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
@Index(['organizationId', 'environment'])
@Index(['organizationId', 'environment', 'createdAt'])
export class Conversion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  affiliateId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  clickId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  resolvedAttributionId?: string;

  @Column({ type: 'varchar', length: 255 })
  externalId!: string;

  @Column({ type: 'varchar', length: 255 })
  customerExternalId!: string;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'int', default: 0 })
  refundedAmount!: number;

  @Column({ type: 'simple-json', nullable: true })
  refundHistory?: Array<{ refundExternalId?: string; amount: number; reason?: string; createdAt: string }>;

  @Column({ type: 'varchar', length: 10 })
  currency!: string;

  @Column({ type: 'varchar', length: 50, default: 'PURCHASE' })
  type!: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: any;

  @Column({ type: 'varchar', length: 255, nullable: true })
  productId?: string;

  @Column({ type: 'varchar', length: 50 })
  status!: ConversionStatus;

  @Column({ type: 'varchar', length: 50, default: 'VALID' })
  validationStatus?: string;

  @Column({ type: 'timestamp', nullable: true })
  validatedAt?: Date;

  @Column({ type: 'uuid', nullable: true })
  validatedBy?: string;

  @Column({ type: 'text', nullable: true })
  validationNotes?: string;

  @Column({ type: 'simple-json', nullable: true })
  validationChecks?: Array<{ code: string; name: string; passed: boolean; details?: string }>;

  @Column({ type: 'varchar', length: 50, default: 'API' })
  source?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  rejectionReason?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  /**
   * When the conversion actually happened in the merchant's system, as opposed
   * to `createdAt`, which is when PartnerIQ recorded it. The two diverge for
   * backfilled or queued orders, and every analytics bucket, date filter and
   * CSV export reads `occurredAt || createdAt`. `datetime` rather than
   * `timestamp` so backdated imports and post-2038 dates both survive.
   */
  @Column({ type: 'datetime', nullable: true })
  occurredAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt?: Date;
}

@Entity('commission_rules')
@Index(['organizationId', 'environment'])
export class CommissionRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  slug!: string;

  @Column({ type: 'int' })
  priority!: number;

  @Column({ type: 'simple-json' })
  conditions!: any;

  @Column({ type: 'varchar', length: 50 })
  commissionType!: CommissionType;

  @Column({ type: 'int' })
  commissionValue!: number;

  @Column({ type: 'int', default: 30 })
  holdPeriodDays!: number;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 50, default: 'ACTIVE' })
  status!: string;

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
@Index(['organizationId', 'environment'])
@Index(['organizationId', 'environment', 'createdAt'])
export class Commission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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

  @Column({ type: 'int', default: 0 })
  reversedAmount!: number;

  @Column({ type: 'varchar', length: 50 })
  calculationVersion!: string;

  @Column({ type: 'varchar', length: 50 })
  status!: ConversionStatus;

  @Column({ type: 'varchar', length: 50, nullable: true })
  approvalStatus?: string;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  approvedBy?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  payoutStatus?: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  payoutItemId?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  disputeStatus?: string;

  @Column({ type: 'text', nullable: true })
  disputeReason?: string;

  @Column({ type: 'text', nullable: true })
  disputeNotes?: string;

  @Column({ type: 'simple-json', nullable: true })
  adjustmentHistory?: any[];

  @Column({ type: 'timestamp', nullable: true })
  holdUntil?: Date;

  @Column({ type: 'int', nullable: true })
  riskScore?: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn({ nullable: true })
  updatedAt?: Date;
}

@Entity('ledger_accounts')
@Index(['organizationId', 'environment'])
export class LedgerAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  affiliateId?: string;

  @Column({ type: 'varchar', length: 20 })
  type!: string;

  @Column({ type: 'int', default: 0 })
  balance!: number;

  @Column({ type: 'varchar', length: 10, default: PLATFORM_CURRENCY })
  currency!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('ledger_transactions')
@Index(['organizationId', 'environment'])
export class LedgerTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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
@Index(['organizationId', 'environment'])
export class FraudReview {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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
@Unique(['organizationId', 'programId', 'environment'])
@Index(['organizationId', 'environment'])
export class FraudSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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
@Index(['organizationId', 'environment'])
export class FraudAssessment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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
@Index(['organizationId', 'affiliateId'])
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
@Unique(['organizationId', 'programId', 'date', 'environment'])
@Index(['organizationId', 'environment'])
export class FraudMetricRollup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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

@Entity('fraud_rules')
@Index(['organizationId', 'status'])
export class FraudRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 80, unique: true })
  code!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 50 })
  category!: string;

  @Column({ type: 'varchar', length: 20, default: 'HIGH' })
  severity!: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'DISABLED' | 'DRY_RUN';

  @Column({ type: 'int', default: 1 })
  currentVersion!: number;

  @Column({ type: 'json' })
  conditions!: any;

  @Column({ type: 'json' })
  actions!: any;

  @Column({ type: 'int', default: 0 })
  triggerCount!: number;

  @Column({ type: 'timestamp', nullable: true })
  lastTriggeredAt?: Date;

  @Column({ type: 'varchar', length: 100, default: 'System' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('fraud_rule_versions')
@Index(['ruleId', 'version'])
export class FraudRuleVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  ruleId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'json' })
  conditions!: any;

  @Column({ type: 'json' })
  actions!: any;

  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  effectiveFrom!: Date;

  @Column({ type: 'timestamp', nullable: true })
  effectiveTo?: Date;

  @Column({ type: 'varchar', length: 100, default: 'System' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('fraud_alerts')
@Index(['organizationId', 'status'])
@Index(['severity', 'status'])
export class FraudAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  alertNumber!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'varchar', length: 20, default: 'HIGH' })
  severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @Column({ type: 'text' })
  severityReason!: string;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status!: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  affiliateId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  conversionId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  commissionId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  payoutId?: string;

  @Column({ type: 'varchar', length: 80 })
  signalCode!: string;

  @Column({ type: 'varchar', length: 50 })
  signalCategory!: string;

  @Column({ type: 'json' })
  evidenceSummary!: any;

  @Column({ type: 'int', default: 0 })
  financialExposurePaise!: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  assignedTo?: string;

  @Column({ type: 'timestamp', nullable: true })
  acknowledgedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  resolvedBy?: string;

  @Column({ type: 'text', nullable: true })
  resolutionNotes?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('fraud_investigations')
@Index(['organizationId', 'status'])
@Index(['severity', 'status'])
export class FraudInvestigation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  caseNumber!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'varchar', length: 20, default: 'HIGH' })
  severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @Column({ type: 'varchar', length: 30, default: 'OPEN' })
  status!: 'OPEN' | 'INVESTIGATING' | 'ACTION_REQUIRED' | 'RESOLVED' | 'CLOSED';

  @Column({ type: 'varchar', length: 30, nullable: true })
  outcome?: 'NO_ISSUE' | 'SUSPICIOUS' | 'CONFIRMED_FRAUD' | 'FALSE_POSITIVE' | 'INCONCLUSIVE';

  @Column({ type: 'text', nullable: true })
  outcomeReason?: string;

  @Column({ type: 'text', nullable: true })
  actionTaken?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  assignedTo?: string;

  @Column({ type: 'timestamp', nullable: true })
  assignedAt?: Date;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  affiliateId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Column({ type: 'int', default: 0 })
  financialExposurePaise!: number;

  @Column({ type: 'json', nullable: true })
  linkedAlertIds?: string[];

  @Column({ type: 'json', nullable: true })
  linkedConversionIds?: string[];

  @Column({ type: 'json', nullable: true })
  linkedCommissionIds?: string[];

  @Column({ type: 'json', nullable: true })
  linkedPayoutIds?: string[];

  @Column({ type: 'json', nullable: true })
  notes?: any[];

  @Column({ type: 'json', nullable: true })
  timeline?: any[];

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  openedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  resolvedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('fraud_holds')
@Index(['entityType', 'entityId'])
@Index(['organizationId', 'status'])
export class FraudHold {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  holdNumber!: string;

  @Column({ type: 'varchar', length: 30 })
  entityType!: 'CONVERSION' | 'COMMISSION' | 'PAYOUT';

  @Index()
  @Column({ type: 'uuid' })
  entityId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  affiliateId?: string;

  @Column({ type: 'int', default: 0 })
  amountPaise!: number;

  @Column({ type: 'varchar', length: 10, default: 'INR' })
  currency!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  alertId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  investigationId?: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'RELEASED' | 'RESOLVED';

  @Column({ type: 'varchar', length: 100, default: 'System' })
  createdBy!: string;

  @Column({ type: 'timestamp', nullable: true })
  releasedAt?: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  releasedBy?: string;

  @Column({ type: 'text', nullable: true })
  releaseReason?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('fraud_exceptions')
export class FraudException {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  type!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  entityType?: string;

  @Column({ type: 'uuid', nullable: true })
  entityId?: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  detectedAt!: Date;

  @Column({ type: 'varchar', length: 50, default: 'PENDING_RETRY' })
  retryState!: string;

  @Column({ type: 'varchar', length: 100, default: 'LOW' })
  currentImpact!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('payout_batches')
@Index(['organizationId', 'environment'])
export class PayoutBatch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Column({ type: 'varchar', length: 50 })
  status!: PayoutStatus;

  @Column({ type: 'int' })
  totalAmount!: number;

  @Column({ type: 'varchar', length: 10, default: PLATFORM_CURRENCY })
  currency!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  gateway?: string;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @Column({ type: 'simple-json', nullable: true })
  validationSummary?: { eligibleCount: number; blockedCount: number; warningCount: number };

  @Column({ type: 'uuid', nullable: true })
  approvedBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('payout_items')
@Index(['organizationId', 'environment'])
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
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 10, default: PLATFORM_CURRENCY })
  currency!: string;

  @Column({ type: 'varchar', length: 50 })
  status!: PayoutStatus;

  @Column({ type: 'varchar', length: 50, nullable: true })
  gateway?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  disbursementAccount?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerReference?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  failureReason?: string;

  @Column({ type: 'int', default: 0 })
  retryCount?: number;

  @Column({ type: 'timestamp', nullable: true })
  lastRetryAt?: Date;

  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotencyKey?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  beneficiaryName?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  payoutMethod?: string;

  @Column({ type: 'varchar', length: 50, default: 'MATCHED' })
  reconciliationStatus?: string;

  @Column({ type: 'timestamp', nullable: true })
  reconciledAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('webhook_endpoints')
@Index(['organizationId', 'environment'])
export class WebhookEndpoint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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
@Index(['endpointId', 'environment'])
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  endpointId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

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
@Index(['organizationId', 'createdAt'])
@Index(['action', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  organizationName?: string;

  @Column({ type: 'varchar', length: 50, default: 'USER' })
  actorType!: string;

  @Column({ type: 'varchar', length: 255 })
  actorId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorName?: string;

  @Column({ type: 'varchar', length: 100 })
  action!: AuditAction;

  @Column({ type: 'varchar', length: 50, default: 'ADMINISTRATION' })
  category?: string;

  @Column({ type: 'varchar', length: 20, default: 'SUCCESS' })
  result?: 'SUCCESS' | 'FAILED' | 'DENIED' | 'PARTIAL' | 'SYSTEM_ERROR';

  @Column({ type: 'varchar', length: 100 })
  resourceType!: string;

  @Column({ type: 'varchar', length: 255 })
  resourceId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  targetName?: string;

  @Column({ type: 'varchar', length: 50, default: 'ADMIN_PORTAL' })
  source?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  requestId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  correlationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  traceId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ipAddress?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent?: string;

  @Column({ type: 'simple-json', nullable: true })
  beforeState?: any;

  @Column({ type: 'simple-json', nullable: true })
  afterState?: any;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  eventHash?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  previousEventHash?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('demo_bookings')
export class DemoBooking {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  firstName!: string;

  @Column({ type: 'varchar', length: 120 })
  lastName!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  company!: string;

  @Column({ type: 'varchar', length: 80 })
  partnerCount!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  website?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  jobTitle?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  businessModel?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  companySize?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  programStatus?: string;

  @Column({ type: 'simple-array', nullable: true })
  interests?: string[];

  @Column({ type: 'text' })
  challenge!: string;

  @Column({ type: 'timestamp' })
  scheduledAt!: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  timezone?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  host?: string;

  @Column({ type: 'varchar', length: 40, default: 'new' })
  status!: 'new' | 'confirmed' | 'completed' | 'rescheduled' | 'cancelled';

  @Column({ type: 'varchar', length: 40, default: 'UNREVIEWED', nullable: true })
  qualificationStatus?: 'UNREVIEWED' | 'QUALIFIED' | 'DISQUALIFIED' | 'NEEDS_INFO';

  @Column({ type: 'simple-array', nullable: true })
  qualificationSignals?: string[];

  @Column({ type: 'text', nullable: true })
  qualificationNotes?: string;

  @Column({ type: 'varchar', length: 40, default: 'NOT_STARTED', nullable: true })
  attendanceStatus?: 'NOT_STARTED' | 'ATTENDED' | 'PARTIALLY_ATTENDED' | 'NO_SHOW' | 'CANCELLED';

  @Column({ type: 'timestamp', nullable: true })
  attendedAt?: Date;

  @Column({ type: 'int', nullable: true })
  attendanceDurationMinutes?: number;

  @Column({ type: 'text', nullable: true })
  attendanceNotes?: string;

  @Column({ type: 'varchar', length: 80, default: 'GOOGLE_MEET', nullable: true })
  meetingProvider?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  meetingUrl?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  googleEventId?: string;

  @Column({ type: 'int', default: 0, nullable: true })
  rescheduleCount?: number;

  @Column({ type: 'json', nullable: true })
  rescheduleHistory?: any[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancellationReason?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  cancelledBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt?: Date;

  @Column({ type: 'varchar', length: 40, default: 'NONE', nullable: true })
  followUpStatus?: 'NONE' | 'PENDING' | 'OVERDUE' | 'COMPLETED';

  @Column({ type: 'timestamp', nullable: true })
  followUpDueDate?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  followUpAction?: string;

  @Column({ type: 'text', nullable: true })
  followUpNotes?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  followUpOwner?: string;

  @Column({ type: 'varchar', length: 80, default: 'PENDING', nullable: true })
  opportunityStage?: string;

  @Column({ type: 'bigint', nullable: true })
  estimatedValuePaise?: number;

  @Column({ type: 'varchar', length: 10, default: 'INR', nullable: true })
  opportunityCurrency?: string;

  @Column({ type: 'timestamp', nullable: true })
  opportunityCloseDate?: Date;

  @Column({ type: 'varchar', length: 120, nullable: true })
  convertedCustomerId?: string;

  @Column({ type: 'varchar', length: 120, default: 'Organic / Direct', nullable: true })
  source?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  medium?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  campaign?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmSource?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmMedium?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmCampaign?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmTerm?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmContent?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  referrer?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  landingPage?: string;

  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  rescheduleToken?: string;

  @Column({ type: 'timestamp', nullable: true })
  rescheduleTokenExpiresAt?: Date;

  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  idempotencyKey?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  ownerId?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  ownerName?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  preferredFormat?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  industry?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  currentSolution?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  monthlyRevenueRange?: string;

  @Column({ type: 'simple-array', nullable: true })
  goals?: string[];

  @Column({ type: 'simple-array', nullable: true })
  requestedFeatures?: string[];

  @Column({ type: 'int', default: 30, nullable: true })
  durationMinutes?: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

/**
 * Single platform-wide connection (one admin connects PartnerIQ's own sales
 * calendar — this is not a per-organization tenant integration, so it
 * intentionally sits outside the OrganizationIntegration/Integration catalog
 * used for tenant-facing integrations). Exactly one row is expected to exist,
 * keyed by the fixed id GOOGLE_CALENDAR_CONNECTION_ID.
 *
 * access_token/refresh_token themselves are NOT stored here — they're
 * encrypted via IntegrationCredentialService into `integration_credentials`,
 * keyed by GOOGLE_CALENDAR_CONNECTION_ID. This row only tracks connection
 * metadata/status.
 */
@Entity('google_calendar_connections')
export class GoogleCalendarConnection {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 20, default: 'DISCONNECTED' })
  status!: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

  @Column({ type: 'varchar', length: 255, nullable: true })
  connectedEmail?: string;

  @Column({ type: 'uuid', nullable: true })
  connectedByUserId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  connectedByName?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  scope?: string;

  @Column({ type: 'timestamp', nullable: true })
  accessTokenExpiresAt?: Date;

  @Column({ type: 'text', nullable: true })
  lastError?: string;

  @Column({ type: 'timestamp', nullable: true })
  connectedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('public_keys')
export class PublicKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Column({ type: 'varchar', length: 255 })
  key!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  publicKey?: string;

  @Column({ type: 'simple-array' })
  allowedDomains!: string[];

  @Column({ type: 'varchar', length: 20 })
  environment!: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;

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

  @Column({ type: 'varchar', length: 255, nullable: true })
  logo?: string;

  @Column({ type: 'simple-json', nullable: true })
  capabilities?: string[];

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
  lastConnectedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastCheckedAt?: Date;

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

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId?: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  state!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nonce?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  redirectUrl?: string;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  consumedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('integration_platform_configs')
@Unique(['provider'])
export class IntegrationPlatformConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  provider!: string;

  @Column({ type: 'varchar', length: 50, default: IntegrationStatus.ACTIVE })
  status!: IntegrationStatus;

  @Column({ type: 'varchar', length: 2000 })
  redirectUri!: string;

  @Column({ type: 'simple-array' })
  requiredScopes!: string[];

  @Column({ type: 'simple-array', nullable: true })
  optionalScopes?: string[];

  @Column({ type: 'varchar', length: 120, nullable: true })
  appId?: string;

  @Column({ type: 'varchar', length: 50, default: IntegrationEnvironment.LIVE })
  environment!: IntegrationEnvironment;

  @Column({ type: 'uuid', nullable: true })
  secretReferenceId?: string;

  @Column({ type: 'varchar', length: 12, nullable: true })
  clientSecretLast4?: string;

  @Column({ type: 'uuid' })
  updatedBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('crm_pipeline_mappings')
@Unique(['organizationIntegrationId', 'externalPipelineId'])
export class CrmPipelineMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationIntegrationId!: string;

  @Column({ type: 'varchar', length: 80 })
  provider!: string;

  @Column({ type: 'varchar', length: 255 })
  externalPipelineId!: string;

  @Column({ type: 'varchar', length: 255 })
  externalPipelineLabel!: string;

  @Column({ type: 'simple-json' })
  stageMappings!: Record<string, PartnerDealStatus>;

  @Column({ type: 'varchar', length: 255, nullable: true })
  closedWonStageId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  closedLostStageId?: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('crm_field_mappings')
@Unique(['organizationIntegrationId', 'partnerIqField'])
export class CrmFieldMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationIntegrationId!: string;

  @Column({ type: 'varchar', length: 120 })
  partnerIqField!: string;

  @Column({ type: 'varchar', length: 120 })
  externalField!: string;

  @Column({ type: 'boolean', default: false })
  required!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('crm_entity_mappings')
@Unique(['organizationIntegrationId', 'entityType', 'partnerIqEntityId'])
export class CrmEntityMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationIntegrationId!: string;

  @Column({ type: 'varchar', length: 40 })
  entityType!: 'CONTACT' | 'COMPANY' | 'DEAL' | 'OWNER';

  @Column({ type: 'uuid' })
  partnerIqEntityId!: string;

  @Column({ type: 'varchar', length: 255 })
  externalEntityId!: string;

  @Column({ type: 'varchar', length: 80 })
  externalEntityType!: string;

  @Column({ type: 'int', default: 1 })
  syncVersion!: number;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('integration_sync_logs')
export class IntegrationSyncLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationIntegrationId!: string;

  @Column({ type: 'varchar', length: 80 })
  provider!: string;

  @Column({ type: 'varchar', length: 80 })
  operation!: string;

  @Column({ type: 'varchar', length: 40 })
  entityType!: string;

  @Column({ type: 'uuid', nullable: true })
  entityId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  externalEntityId?: string;

  @Column({ type: 'varchar', length: 20 })
  direction!: 'INBOUND' | 'OUTBOUND' | 'HEALTH';

  @Column({ type: 'varchar', length: 30 })
  status!: 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'RETRYING' | 'IGNORED';

  @Column({ type: 'int', default: 0 })
  attempt!: number;

  @Column({ type: 'int', nullable: true })
  durationMs?: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  errorCode?: string;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('partner_deals')
@Index(['organizationId', 'environment'])
export class PartnerDeal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  affiliateId?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  campaignId?: string;

  @Column({ type: 'varchar', length: 40 })
  dealRegistrationNumber!: string;

  @Column({ type: 'varchar', length: 255 })
  companyName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  companyDomain?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contactFirstName?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contactLastName?: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  contactEmail!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  contactPhone?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  contactJobTitle?: string;

  @Column({ type: 'bigint', default: 0 })
  estimatedValue!: number;

  @Column({ type: 'bigint', nullable: true })
  actualValue?: number;

  @Column({ type: 'varchar', length: 10, default: PLATFORM_CURRENCY })
  currency!: string;

  @Column({ type: 'timestamp', nullable: true })
  expectedCloseDate?: Date;

  @Column({ type: 'timestamp', nullable: true })
  actualCloseDate?: Date;

  @Column({ type: 'varchar', length: 50, default: PartnerDealStatus.SUBMITTED })
  status!: PartnerDealStatus;

  @Column({ type: 'varchar', length: 80, nullable: true })
  crmProvider?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  crmDealId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  crmPipelineId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  crmStageId?: string;

  @Column({ type: 'varchar', length: 50, default: PartnerDealCommissionStatus.NOT_ELIGIBLE })
  commissionStatus!: PartnerDealCommissionStatus;

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  attributionStatus!: string;

  @Column({ type: 'timestamp' })
  submittedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  rejectedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  closedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  protectedUntil?: Date;

  @Column({ type: 'simple-json', nullable: true })
  duplicateSignals?: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'text', nullable: true })
  rejectionReason?: string;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @Column({ type: 'uuid', nullable: true })
  approvedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
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

@Entity('billing_promotions')
@Unique(['code'])
export class BillingPromotion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 80 })
  code!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  campaignType?: string;

  @Column({ type: 'timestamp', nullable: true })
  startsAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  endsAt?: Date;

  @Index()
  @Column({ type: 'varchar', length: 40, default: 'DRAFT' })
  status!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmCampaign?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmSource?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  utmMedium?: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  landingPage?: string;

  @CreateDateColumn()
  createdDate!: Date;

  @UpdateDateColumn()
  modifiedDate!: Date;
}

@Entity('billing_coupons')
@Unique(['normalizedCode'])
@Index(['status'])
@Index(['validFrom'])
@Index(['validUntil'])
export class BillingCoupon {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  normalizedCode!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 40 })
  discountType!: string;

  @Column({ type: 'int', nullable: true })
  discountValue?: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency?: string;

  @Column({ type: 'varchar', length: 40, default: 'ONE_TIME' })
  durationType!: string;

  @Column({ type: 'int', nullable: true })
  durationCycles?: number;

  @Column({ type: 'int', nullable: true })
  trialExtensionDays?: number;

  @Column({ type: 'int', nullable: true })
  freeMonths?: number;

  @Column({ type: 'timestamp', nullable: true })
  validFrom?: Date;

  @Column({ type: 'timestamp', nullable: true })
  validUntil?: Date;

  @Column({ type: 'int', nullable: true })
  maxRedemptions?: number;

  @Column({ type: 'int', nullable: true })
  maxRedemptionsPerOrganization?: number;

  @Column({ type: 'int', nullable: true })
  minimumPurchaseAmount?: number;

  @Column({ type: 'varchar', length: 40, default: 'DRAFT' })
  status!: string;

  @Column({ type: 'boolean', default: false })
  isPublic!: boolean;

  @Column({ type: 'boolean', default: false })
  isStackable!: boolean;

  @Column({ type: 'boolean', default: false })
  firstTimeCustomersOnly!: boolean;

  @Column({ type: 'varchar', length: 40, default: 'ALL_PLANS' })
  planEligibility!: string;

  @Column({ type: 'varchar', length: 40, default: 'ALL' })
  billingCycleEligibility!: string;

  @Column({ type: 'varchar', length: 60, default: 'ANY_ORGANIZATION' })
  customerEligibility!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  promotionId?: string;

  @Column({ type: 'varchar', length: 40, default: 'PRESERVE_IF_ELIGIBLE' })
  planChangePolicy!: string;

  @Column({ type: 'simple-json', nullable: true })
  advancedRules?: Record<string, any>;

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdDate!: Date;

  @Column({ type: 'uuid', nullable: true })
  modifiedBy?: string;

  @UpdateDateColumn()
  modifiedDate!: Date;

  @Column({ type: 'int', default: 1 })
  rowVersion!: number;
}

@Entity('billing_coupon_plans')
@Unique(['couponId', 'planId'])
export class BillingCouponPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  couponId!: string;

  @Index()
  @Column({ type: 'uuid' })
  planId!: string;
}

@Entity('billing_coupon_organizations')
@Unique(['couponId', 'organizationId'])
export class BillingCouponOrganization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  couponId!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;
}

@Entity('billing_coupon_redemptions')
@Index(['couponId', 'status'])
@Index(['organizationId', 'redeemedAt'])
@Unique(['organizationId', 'idempotencyKey'])
export class BillingCouponRedemption {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  couponId!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  subscriptionId?: string;

  @Column({ type: 'uuid' })
  planId!: string;

  @Column({ type: 'varchar', length: 20 })
  billingCycle!: string;

  @Column({ type: 'varchar', length: 10 })
  currency!: string;

  @Column({ type: 'int' })
  originalSubtotal!: number;

  @Column({ type: 'int', default: 0 })
  discountAmount!: number;

  @Column({ type: 'int' })
  discountedSubtotal!: number;

  @Column({ type: 'int', default: 0 })
  taxAmount!: number;

  @Column({ type: 'int' })
  finalAmount!: number;

  @Column({ type: 'varchar', length: 40 })
  durationType!: string;

  @Column({ type: 'int', nullable: true })
  remainingCycles?: number;

  @Index()
  @Column({ type: 'varchar', length: 40, default: 'RESERVED' })
  status!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  provider?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerPaymentId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerSubscriptionId?: string;

  @Column({ type: 'varchar', length: 191 })
  idempotencyKey!: string;

  @Column({ type: 'simple-json' })
  pricingSnapshot!: Record<string, any>;

  @Column({ type: 'timestamp' })
  reservedAt!: Date;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  redeemedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt?: Date;

  @CreateDateColumn()
  createdDate!: Date;
}

@Entity('billing_subscription_discounts')
@Unique(['subscriptionId', 'couponRedemptionId'])
export class BillingSubscriptionDiscount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  subscriptionId!: string;

  @Index()
  @Column({ type: 'uuid' })
  couponRedemptionId!: string;

  @Column({ type: 'varchar', length: 40 })
  discountType!: string;

  @Column({ type: 'int', nullable: true })
  discountValue?: number;

  @Column({ type: 'timestamp' })
  startsAt!: Date;

  @Column({ type: 'int', nullable: true })
  totalCycles?: number;

  @Column({ type: 'int', default: 0 })
  cyclesConsumed!: number;

  @Column({ type: 'varchar', length: 40, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'simple-json' })
  snapshot!: Record<string, any>;

  @CreateDateColumn()
  createdDate!: Date;

  @UpdateDateColumn()
  modifiedDate!: Date;
}

// ─────────────────────────────────────────────────────────
// Organization product coupons — discount codes an org creates for its OWN
// product and assigns to specific affiliates to share with their audience.
// Distinct from BillingCoupon above (PartnerIQ's own SaaS subscription discounts).
// ─────────────────────────────────────────────────────────

@Entity('organization_coupons')
@Unique(['organizationId', 'normalizedCode'])
@Index(['organizationId', 'status'])
export class OrganizationCoupon {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 60 })
  code!: string;

  @Column({ type: 'varchar', length: 60 })
  normalizedCode!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 30, default: 'PERCENTAGE' })
  discountType!: string;

  @Column({ type: 'int' })
  discountValue!: number;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'int', nullable: true })
  maxRedemptions?: number;

  @Column({ type: 'timestamp', nullable: true })
  validFrom?: Date;

  @Column({ type: 'timestamp', nullable: true })
  validUntil?: Date;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('organization_coupon_assignments')
@Unique(['couponId', 'affiliateId'])
export class OrganizationCouponAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  couponId!: string;

  // Denormalized for fast ownership checks and to guarantee an assignment can
  // never straddle organizations even if couponId/affiliateId were tampered with.
  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Column({ type: 'uuid' })
  assignedBy!: string;

  @CreateDateColumn()
  assignedAt!: Date;
}

@Entity('organization_coupon_settings')
@Unique(['organizationId'])
export class OrganizationCouponSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'boolean', default: true })
  couponsEnabled!: boolean;

  @Column({ type: 'uuid', nullable: true })
  updatedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('organization_trials')
export class OrganizationTrial {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'boolean', default: false })
  trialUsed!: boolean;

  @Column({ type: 'timestamp' })
  firstTrialStartedAt!: Date;

  @Column({ type: 'timestamp' })
  firstTrialEndedAt!: Date;

  @Column({ type: 'int', default: 0 })
  extendedByAdminDays!: number;

  @Column({ type: 'timestamp', nullable: true })
  grantedByAdminAt?: Date;

  @Column({ type: 'uuid', nullable: true })
  grantedByAdminUserId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('billing_subscriptions')
@Unique(['organizationId', 'providerSubscriptionId'])
export class BillingSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Account this subscription bills. Nullable for legacy org-level rows, which
   * are still resolved through their organization's account.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  accountId?: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid' })
  planId!: string;

  @Column({ type: 'varchar', length: 30, default: 'INTERNAL' })
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

  @Column({ type: 'varchar', length: 20, default: 'MONTHLY' })
  billingCycle!: string;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodStart?: Date;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodEnd?: Date;

  @Column({ type: 'timestamp', nullable: true })
  trialStart?: Date;

  @Column({ type: 'timestamp', nullable: true })
  trialEnd?: Date;

  @Column({ type: 'timestamp', nullable: true })
  trialStartedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  trialEndsAt?: Date;

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

@Entity('partner_tiers')
@Unique(['organizationId', 'programId', 'code', 'environment'])
@Index(['organizationId', 'environment'])
export class PartnerTier {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 100 })
  code!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description?: string;

  @Column({ type: 'int', default: 1 })
  level!: number;

  @Column({ type: 'int', default: 0 })
  displayOrder!: number;

  @Column({ type: 'varchar', length: 100, default: 'award' })
  icon!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  badge?: string;

  @Column({ type: 'varchar', length: 50, default: 'blue' })
  colorToken!: string;

  @Column({ type: 'varchar', length: 50, default: TierEvaluationPeriod.LIFETIME })
  evaluationPeriod!: TierEvaluationPeriod;

  @Column({ type: 'varchar', length: 50, default: TierDowngradeMode.DOWNGRADE_NEXT_PERIOD })
  downgradeMode!: TierDowngradeMode;

  @Column({ type: 'int', default: 7 })
  gracePeriodDays!: number;

  @Column({ type: 'varchar', length: 50, default: CommissionRateEffectiveStrategy.FUTURE_CONVERSIONS_ONLY })
  commissionRateEffectiveStrategy!: CommissionRateEffectiveStrategy;

  @Column({ type: 'int', nullable: true })
  commissionRateOverride?: number; // In basis points (e.g. 2000 = 20%)

  @Column({ type: 'int', nullable: true })
  fixedCommissionOverride?: number; // In cents

  @Column({ type: 'simple-json', nullable: true })
  conditions?: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  rewardsConfig?: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'boolean', default: true })
  isVisibleToAffiliate!: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('affiliate_tiers')
@Unique(['organizationId', 'programId', 'affiliateId', 'environment'])
@Index(['organizationId', 'environment'])
export class AffiliateTier {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  programId!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  affiliateId!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  currentTierId!: string;

  @Column({ type: 'uuid', nullable: true })
  previousTierId?: string;

  @Column({ type: 'timestamp' })
  effectiveFrom!: Date;

  @Column({ type: 'timestamp', nullable: true })
  effectiveTo?: Date;

  @Column({ type: 'boolean', default: false })
  isLocked!: boolean;

  @Column({ type: 'uuid', nullable: true })
  lockedBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  lockedAt?: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  lockReason?: string;

  @Column({ type: 'timestamp', nullable: true })
  gracePeriodExpiresAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('affiliate_tier_histories')
@Index(['organizationId', 'environment'])
export class AffiliateTierHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Column({ type: 'uuid', nullable: true })
  previousTierId?: string;

  @Index()
  @Column({ type: 'uuid' })
  newTierId!: string;

  @Column({ type: 'varchar', length: 50, default: TierTransitionType.AUTOMATIC_UPGRADE })
  transitionType!: TierTransitionType;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @Column({ type: 'simple-json', nullable: true })
  metricSnapshot?: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  ruleSnapshot?: Record<string, any>;

  @Column({ type: 'int', nullable: true })
  effectiveCommissionRate?: number;

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('milestones')
@Unique(['organizationId', 'programId', 'code', 'environment'])
@Index(['organizationId', 'environment'])
export class Milestone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 100 })
  code!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 50, default: GamificationMetric.APPROVED_CONVERSIONS })
  metric!: GamificationMetric;

  @Column({ type: 'varchar', length: 50, default: 'GREATER_THAN_OR_EQUAL' })
  operator!: string;

  @Column({ type: 'int' })
  targetValue!: number;

  @Column({ type: 'int', nullable: true })
  secondaryValue?: number;

  @Column({ type: 'varchar', length: 50, default: 'LIFETIME' })
  period!: string;

  @Column({ type: 'varchar', length: 50, default: MilestoneResetBehavior.NONE })
  resetBehavior!: MilestoneResetBehavior;

  @Column({ type: 'boolean', default: false })
  isRepeatable!: boolean;

  @Column({ type: 'int', nullable: true })
  repeatInterval?: number;

  @Column({ type: 'varchar', length: 50, default: MilestoneRewardType.BADGE })
  rewardType!: MilestoneRewardType;

  @Column({ type: 'simple-json', nullable: true })
  rewardConfig?: Record<string, any>;

  @Column({ type: 'varchar', length: 100, nullable: true })
  badgeIcon?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  badgeName?: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  displayOrder!: number;

  @Column({ type: 'timestamp', nullable: true })
  startDate?: Date;

  @Column({ type: 'timestamp', nullable: true })
  endDate?: Date;

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('affiliate_milestone_achievements')
@Unique(['organizationId', 'affiliateId', 'milestoneId', 'periodKey', 'environment'])
@Index(['organizationId', 'environment'])
export class AffiliateMilestoneAchievement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  programId!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  affiliateId!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  milestoneId!: string;

  @Column({ type: 'varchar', length: 50, default: 'LIFETIME' })
  periodKey!: string;

  @Column({ type: 'timestamp', nullable: true })
  periodStart?: Date;

  @Column({ type: 'timestamp', nullable: true })
  periodEnd?: Date;

  @Column({ type: 'int' })
  metricValue!: number;

  @Column({ type: 'int' })
  targetValue!: number;

  @Column({ type: 'timestamp' })
  achievedAt!: Date;

  @Column({ type: 'varchar', length: 50, default: MilestoneRewardStatus.COMPLETED })
  rewardStatus!: MilestoneRewardStatus;

  @Column({ type: 'timestamp', nullable: true })
  rewardProcessedAt?: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  rewardError?: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 191 })
  idempotencyKey!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('affiliate_performance_summaries')
@Unique(['organizationId', 'programId', 'affiliateId', 'periodType', 'periodKey', 'environment'])
@Index(['organizationId', 'environment'])
export class AffiliatePerformanceSummary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  programId!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  affiliateId!: string;

  @Column({ type: 'varchar', length: 50, default: 'LIFETIME' })
  periodType!: string;

  @Column({ type: 'varchar', length: 50, default: 'LIFETIME' })
  periodKey!: string;

  // `datetime`, not `timestamp`: the LIFETIME period is stored as epoch 0 to
  // year 9999, and MySQL's TIMESTAMP only spans 1970-01-01 00:00:01 UTC to
  // 2038-01-19. Under a non-UTC session timezone epoch 0 also lands *below*
  // that floor, so every LIFETIME upsert was rejected with ER_TRUNCATED_WRONG_VALUE.
  @Column({ type: 'datetime' })
  periodStart!: Date;

  @Column({ type: 'datetime' })
  periodEnd!: Date;

  @Column({ type: 'int', default: 0 })
  clicks!: number;

  @Column({ type: 'int', default: 0 })
  trackingLinksCreated!: number;

  @Column({ type: 'int', default: 0 })
  approvedConversions!: number;

  @Column({ type: 'int', default: 0 })
  revenue!: number; // In cents

  @Column({ type: 'int', default: 0 })
  attributedRevenue!: number; // In cents

  @Column({ type: 'int', default: 0 })
  commissionEarned!: number; // In cents

  @Column({ type: 'int', default: 0 })
  qualifiedLeads!: number;

  @Column({ type: 'int', default: 0 })
  closedWonDeals!: number;

  @Column({ type: 'int', default: 0 })
  closedWonRevenue!: number; // In cents

  @Column({ type: 'timestamp', nullable: true })
  lastActivityAt?: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('automation_workflows')
@Index(['organizationId', 'environment'])
export class AutomationWorkflow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 50, default: AutomationTriggerType.AFFILIATE_JOINED_PROGRAM })
  triggerType!: AutomationTriggerType;

  @Column({ type: 'varchar', length: 50, default: AutomationWorkflowStatus.DRAFT })
  status!: AutomationWorkflowStatus;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  goalType?: string;

  @Column({ type: 'simple-json', nullable: true })
  goalConfig?: Record<string, any>;

  @Column({ type: 'int', default: 2 })
  maxEmailsPerDay!: number;

  @Column({ type: 'int', default: 5 })
  maxEmailsPerWeek!: number;

  @Column({ type: 'boolean', default: true })
  quietHoursEnabled!: boolean;

  @Column({ type: 'varchar', length: 10, default: '22:00' })
  quietHoursStart!: string;

  @Column({ type: 'varchar', length: 10, default: '08:00' })
  quietHoursEnd!: string;

  @Column({ type: 'simple-json' })
  nodes!: Array<{
    id: string;
    type: AutomationNodeType;
    name?: string;
    config: Record<string, any>;
    position?: { x: number; y: number };
  }>;

  @Column({ type: 'simple-json' })
  edges!: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    branchKey?: string;
  }>;

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('automation_workflow_versions')
@Unique(['workflowId', 'version'])
export class AutomationWorkflowVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workflowId!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'simple-json' })
  definition!: Record<string, any>;

  @Column({ type: 'uuid', nullable: true })
  publishedBy?: string;

  @CreateDateColumn()
  publishedAt!: Date;
}

@Entity('automation_executions')
@Index(['organizationId', 'environment'])
export class AutomationExecution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid' })
  workflowId!: string;

  @Column({ type: 'int', default: 1 })
  workflowVersion!: number;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Index()
  @Column({ type: 'uuid' })
  programId!: string;

  @Column({ type: 'varchar', length: 50, default: AutomationExecutionStatus.RUNNING })
  status!: AutomationExecutionStatus;

  @Column({ type: 'varchar', length: 100, nullable: true })
  currentNodeId?: string;

  @Column({ type: 'simple-json', nullable: true })
  context?: Record<string, any>;

  @Column({ type: 'timestamp' })
  startedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt?: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  cancelReason?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('automation_scheduled_steps')
@Index(['organizationId', 'environment'])
export class AutomationScheduledStep {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  executionId!: string;

  @Index()
  @Column({ type: 'uuid' })
  workflowId!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: EnvironmentType.LIVE })
  environment?: EnvironmentType;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Column({ type: 'varchar', length: 100 })
  nodeId!: string;

  @Index()
  @Column({ type: 'timestamp' })
  executeAt!: Date;

  @Column({ type: 'varchar', length: 50, default: AutomationStepStatus.PENDING })
  status!: AutomationStepStatus;

  @Column({ type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  lastError?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('automation_email_templates')
@Unique(['organizationId', 'code'])
export class AutomationEmailTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  programId?: string;

  @Column({ type: 'varchar', length: 100 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  subject!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  preheader?: string;

  @Column({ type: 'text' })
  bodyHtml!: string;

  @Column({ type: 'text' })
  bodyText!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ctaText?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  ctaUrl?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  senderName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  replyTo?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('email_design_templates')
@Unique(['templateId'])
export class EmailDesignTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  templateId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 80 })
  category!: string;

  @Column({ type: 'boolean', default: false })
  isCustom!: boolean;

  @Column({ type: 'boolean', default: false })
  isEdited!: boolean;

  @Column({ type: 'simple-json' })
  payload!: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('email_design_settings')
@Unique(['settingsKey'])
export class EmailDesignSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  settingsKey!: string;

  @Column({ type: 'simple-json' })
  payload!: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('document_design_templates')
@Unique(['templateKey'])
export class DocumentDesignTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  templateKey!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 80 })
  category!: string;

  @Column({ type: 'varchar', length: 50, default: DocumentType.CUSTOM })
  documentType!: DocumentType;

  @Column({ type: 'varchar', length: 30, default: PageSize.A4 })
  pageSize!: PageSize;

  @Column({ type: 'varchar', length: 30, default: PageOrientation.PORTRAIT })
  orientation!: PageOrientation;

  @Column({ type: 'simple-json', nullable: true })
  margins?: { top: number; right: number; bottom: number; left: number; unit: string };

  @Column({ type: 'simple-json', nullable: true })
  headerSettings?: { enabled: boolean; showOn: 'all' | 'first' | 'subsequent'; content?: string };

  @Column({ type: 'simple-json', nullable: true })
  footerSettings?: { enabled: boolean; showOn: 'all' | 'first' | 'last'; showPageNumber: boolean; format?: string; content?: string };

  @Column({ type: 'simple-json', nullable: true })
  watermarkSettings?: { enabled: boolean; text?: string; opacity?: number; rotation?: number };

  @Column({ type: 'varchar', length: 50, default: TemplateStatus.DRAFT })
  status!: TemplateStatus;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'boolean', default: false })
  isCustom!: boolean;

  @Column({ type: 'boolean', default: false })
  isEdited!: boolean;

  @Column({ type: 'simple-json' })
  payload!: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('document_template_versions')
export class DocumentTemplateVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 150 })
  templateKey!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 50, default: TemplateStatus.DRAFT })
  status!: TemplateStatus;

  @Column({ type: 'text' })
  bodyTemplate!: string;

  @Column({ type: 'simple-json', nullable: true })
  variables?: any;

  @Column({ type: 'simple-json', nullable: true })
  settings?: any;

  @Column({ type: 'varchar', length: 500, nullable: true })
  changeSummary?: string;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('generated_documents')
export class GeneratedDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 150 })
  templateKey!: string;

  @Column({ type: 'uuid', nullable: true })
  templateVersionId?: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: DocumentType.CUSTOM })
  documentType!: DocumentType;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  documentNumber?: string;

  @Index()
  @Column({ type: 'varchar', length: 150, nullable: true })
  referenceId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recipientName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recipientEmail?: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: DocumentStatus.GENERATED })
  status!: DocumentStatus;

  @Column({ type: 'text', nullable: true })
  renderedHtmlSnapshot?: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  pdfUrl?: string;

  @Column({ type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ type: 'int', nullable: true })
  fileSizeBytes?: number;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  errorMessage?: string;

  @Column({ type: 'timestamp' })
  generatedAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  generatedById?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}


@Entity('automation_email_logs')
export class AutomationEmailLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  executionId?: string;

  @Index()
  @Column({ type: 'uuid' })
  affiliateId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  templateId?: string;

  @Column({ type: 'varchar', length: 255 })
  toEmail!: string;

  @Column({ type: 'varchar', length: 255 })
  subject!: string;

  @Column({ type: 'varchar', length: 50, default: AutomationEmailDeliveryStatus.SENT })
  status!: AutomationEmailDeliveryStatus;

  @Column({ type: 'timestamp', nullable: true })
  sentAt?: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('email_template_versions')
export class EmailTemplateVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 150 })
  templateKey!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 50, default: 'DRAFT' })
  status!: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

  @Column({ type: 'varchar', length: 255 })
  subject!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  preheader?: string;

  @Column({ type: 'text' })
  bodyTemplate!: string;

  @Column({ type: 'simple-json', nullable: true })
  variables?: any;

  @Column({ type: 'varchar', length: 500, nullable: true })
  changeSummary?: string;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('email_template_overrides')
@Unique(['organizationId', 'templateKey'])
export class EmailTemplateOverride {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ type: 'varchar', length: 150 })
  templateKey!: string;

  @Column({ type: 'varchar', length: 50, default: 'PUBLISHED' })
  status!: 'DRAFT' | 'PUBLISHED' | 'DISABLED';

  @Column({ type: 'varchar', length: 255, nullable: true })
  customSubject?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customPreheader?: string;

  @Column({ type: 'text', nullable: true })
  customBody?: string;

  @Column({ type: 'simple-json', nullable: true })
  customData?: Record<string, any>;

  @Column({ type: 'uuid', nullable: true })
  updatedById?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('email_delivery_logs')
export class EmailDeliveryLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 150, nullable: true })
  messageId?: string;

  @Index()
  @Column({ type: 'varchar', length: 150 })
  templateKey!: string;

  @Column({ type: 'uuid', nullable: true })
  templateVersionId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  recipientEmail!: string;

  @Column({ type: 'varchar', length: 255 })
  recipientEmailMasked!: string;

  @Column({ type: 'varchar', length: 255 })
  subject!: string;

  @Column({ type: 'varchar', length: 50, default: 'development' })
  provider!: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  providerMessageId?: string;

  @Column({ type: 'varchar', length: 50, default: 'QUEUED' })
  status!: 'QUEUED' | 'PROCESSING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'BOUNCED' | 'COMPLAINED' | 'SUPPRESSED';

  @Column({ type: 'int', default: 1 })
  attemptCount!: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  failureCode?: string;

  @Column({ type: 'text', nullable: true })
  failureMessage?: string;

  @Index()
  @Column({ type: 'varchar', length: 150, nullable: true })
  eventId?: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  idempotencyKey?: string;

  @Column({ type: 'text', nullable: true })
  snapshotHtml?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  queuedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  sentAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  failedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('email_suppressions')
@Unique(['email', 'organizationId'])
export class EmailSuppression {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 50, default: 'HARD_BOUNCE' })
  reason!: 'HARD_BOUNCE' | 'COMPLAINT' | 'UNSUBSCRIBED' | 'ADMIN_SUPPRESSED' | 'INVALID_ADDRESS';

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('platform_settings')
export class PlatformSetting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  key!: string;

  @Column({ type: 'simple-json' })
  value!: any;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

// ---------------------------------------------------------------------------
// Subscription accounts, plan limits, add-ons and add-on purchases
//
// PartnerIQ bills a *customer account*, not an individual organization: one
// paid subscription covers every organization the customer creates, and the
// plan's organization/program/affiliate/member allowances are consumed across
// all of them together. `organizations.accountId` and
// `billing_subscriptions.accountId` are nullable so pre-existing rows keep
// working and get backfilled lazily by BillingAccountService.
// ---------------------------------------------------------------------------

@Entity('billing_accounts')
export class BillingAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  ownerUserId!: string;

  @Column({ type: 'varchar', length: 10, default: PLATFORM_CURRENCY })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}

/**
 * Included allowance for one resource on one plan.
 *
 * `includedLimit === null` means UNLIMITED. NULL is used rather than a sentinel
 * number (and never JavaScript `Infinity`, which has no SQL representation) so
 * that "unlimited" is unambiguous at the database level.
 */
@Entity('billing_plan_limits')
@Unique(['planId', 'resourceType'])
export class BillingPlanLimit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  planId!: string;

  @Column({ type: 'varchar', length: 30 })
  resourceType!: string;

  @Column({ type: 'int', nullable: true })
  includedLimit?: number | null;

  @Column({ type: 'boolean', default: true })
  addonPurchasable!: boolean;

  @CreateDateColumn()
  createdDate!: Date;

  @UpdateDateColumn()
  modifiedDate!: Date;
}

@Entity('billing_addons')
@Unique(['code', 'billingInterval', 'currency'])
export class BillingAddon {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Index()
  @Column({ type: 'varchar', length: 30 })
  resourceType!: string;

  /** Price of a single unit, in the currency's minor unit (paise for INR). */
  @Column({ type: 'int', default: 0 })
  unitPrice!: number;

  @Column({ type: 'varchar', length: 10, default: PLATFORM_CURRENCY })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: 'MONTHLY' })
  billingInterval!: string;

  /** Units of capacity granted per purchased quantity (e.g. 1 affiliate per unit). */
  @Column({ type: 'int', default: 1 })
  unitsPerQuantity!: number;

  @Column({ type: 'int', default: 1 })
  minQuantity!: number;

  @Column({ type: 'int', nullable: true })
  maxQuantity?: number | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

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

@Entity('billing_addon_purchases')
export class BillingAddonPurchase {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  accountId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  subscriptionId?: string;

  @Index()
  @Column({ type: 'uuid' })
  addonId!: string;

  /** Denormalised so usage math never has to join through the catalog. */
  @Index()
  @Column({ type: 'varchar', length: 30 })
  resourceType!: string;

  @Column({ type: 'int', default: 0 })
  quantity!: number;

  /** Unit price at purchase time — the catalog price may change later. */
  @Column({ type: 'int', default: 0 })
  unitPriceSnapshot!: number;

  @Column({ type: 'varchar', length: 10, default: PLATFORM_CURRENCY })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: 'MONTHLY' })
  billingInterval!: string;

  @Index()
  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  status!: string;

  @Column({ type: 'timestamp', nullable: true })
  startDate?: Date;

  @Column({ type: 'timestamp', nullable: true })
  endDate?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerPaymentId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerOrderId?: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  idempotencyKey?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: any;

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

// ---------------------------------------------------------------------------
// Legal document acceptance
//
// Evidence that a specific user accepted a specific version of a specific
// document, at a specific time, from a specific address. Kept as an append-only
// audit trail rather than a boolean on `users`, because consent has to survive
// document revisions: when a policy version changes, the old acceptance stays
// on record and the absence of a row for the new version is what makes
// re-acceptance detectable.
// ---------------------------------------------------------------------------

@Entity('user_legal_acceptances')
@Index(['userId', 'documentType'])
export class UserLegalAcceptance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  /** e.g. 'terms', 'privacy', 'anti-fraud' — mirrors the landing legal docs. */
  @Column({ type: 'varchar', length: 40 })
  documentType!: string;

  /** Version string in force when the user accepted, e.g. 'draft-1.0'. */
  @Column({ type: 'varchar', length: 40 })
  documentVersion!: string;

  @Column({ type: 'timestamp' })
  acceptedAt!: Date;

  /** How the acceptance was given — the signup form, OAuth signup, re-consent. */
  @Column({ type: 'varchar', length: 40, default: 'SIGNUP' })
  acceptanceContext!: string;

  /** Retained as evidence of where the acceptance came from. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress?: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('blog_posts')
@Unique(['slug'])
export class BlogPost {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'varchar', length: 255 })
  slug!: string;

  @Column({ type: 'text' })
  excerpt!: string;

  @Column({ type: 'simple-json' })
  content!: any;

  @Column({ type: 'text', nullable: true })
  coverImage?: string;

  @Column({ type: 'text', nullable: true })
  ogImage?: string;

  @Index()
  @Column({ type: 'varchar', length: 80 })
  category!: string;

  @Column({ type: 'simple-json' })
  tags!: string[];

  @Column({ type: 'simple-json' })
  author!: {
    id?: string;
    name: string;
    role?: string;
    avatarUrl?: string;
    bio?: string;
    twitter?: string;
    linkedin?: string;
  };

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'DRAFT' })
  status!: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'GLOBAL' })
  scopeType!: 'GLOBAL' | 'ORGANIZATION';

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  readingTime?: string;

  @Column({ type: 'boolean', default: false })
  featured!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  seoTitle?: string;

  @Column({ type: 'text', nullable: true })
  seoDescription?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  canonicalUrl?: string;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string;

  @Column({ type: 'uuid', nullable: true })
  updatedById?: string;

  @Column({ type: 'datetime', nullable: true })
  publishedAt?: Date;

  @Column({ type: 'datetime', nullable: true })
  deletedAt?: Date;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('security_events')
export class SecurityEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  eventNumber!: string;

  @Column({ type: 'varchar', length: 16, default: '1.0' })
  eventSchemaVersion!: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  eventType!: string;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  category!: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  result!: string;

  @Column({ type: 'varchar', length: 50 })
  actorType!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  actorId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  organizationName?: string;

  @Column({ type: 'varchar', length: 100 })
  resourceType!: string;

  @Column({ type: 'varchar', length: 255 })
  resourceId!: string;

  @Column({ type: 'varchar', length: 100 })
  source!: string;

  @Column({ type: 'varchar', length: 100, default: 'core-api' })
  service!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  endpoint?: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  httpMethod?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sessionId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  requestId?: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  correlationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  traceId?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ipAddress?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deviceId?: string;

  @Column({ type: 'text', nullable: true })
  userAgent?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city?: string;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'datetime' })
  occurredAt!: Date;

  @Column({ type: 'datetime' })
  detectedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('security_signals')
export class SecuritySignal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  signalNumber!: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  signalType!: string;

  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Column({ type: 'uuid', nullable: true })
  eventId?: string;

  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resourceId?: string;

  @Column({ type: 'varchar', length: 255 })
  observedValue!: string;

  @Column({ type: 'varchar', length: 255 })
  expectedValue!: string;

  @Column({ type: 'varchar', length: 255 })
  threshold!: string;

  @Column({ type: 'varchar', length: 255 })
  difference!: string;

  @Column({ type: 'varchar', length: 100 })
  source!: string;

  @Column({ type: 'uuid', nullable: true })
  ruleId?: string;

  @Column({ type: 'int', default: 1 })
  ruleVersion!: number;

  @Column({ type: 'varchar', length: 50, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'datetime' })
  detectedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('security_alerts')
export class SecurityAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  alertNumber!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'OPEN' })
  status!: string;

  @Column({ type: 'uuid', nullable: true })
  ruleId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ruleName?: string;

  @Column({ type: 'int', default: 1 })
  ruleVersion!: number;

  @Column({ type: 'uuid', nullable: true })
  signalId?: string;

  @Column({ type: 'int', default: 1 })
  eventCount!: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  actorType?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail?: string;

  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  organizationName?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  resourceType?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resourceId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  assignedTo?: string;

  @Column({ type: 'text', nullable: true })
  impact?: string;

  @Column({ type: 'simple-json', nullable: true })
  evidence?: any;

  @Column({ type: 'datetime', nullable: true })
  acknowledgedAt?: Date;

  @Column({ type: 'datetime', nullable: true })
  resolvedAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resolvedBy?: string;

  @Column({ type: 'text', nullable: true })
  resolutionReason?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('security_investigations')
export class SecurityInvestigation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  caseNumber!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'OPEN' })
  status!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  outcome?: string;

  @Column({ type: 'uuid', nullable: true })
  alertId?: string;

  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  organizationName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  resourceType?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resourceId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  assignedTo?: string;

  @Column({ type: 'text', nullable: true })
  securityImpact?: string;

  @Column({ type: 'simple-json', nullable: true })
  notes?: any[];

  @Column({ type: 'simple-json', nullable: true })
  evidence?: any[];

  @Column({ type: 'simple-json', nullable: true })
  actions?: any[];

  @Column({ type: 'datetime' })
  openedAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  resolvedAt?: Date;

  @Column({ type: 'datetime', nullable: true })
  closedAt?: Date;

  @Column({ type: 'text', nullable: true })
  resolution?: string;

  @Column({ type: 'text', nullable: true })
  resolutionReason?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('security_incidents')
export class SecurityIncident {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  incidentNumber!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  category!: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'OPEN' })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  assignedOwner?: string;

  @Column({ type: 'simple-json', nullable: true })
  affectedOrganizations?: any[];

  @Column({ type: 'simple-json', nullable: true })
  affectedUsers?: any[];

  @Column({ type: 'simple-json', nullable: true })
  affectedResources?: any[];

  @Column({ type: 'text', nullable: true })
  securityImpact?: string;

  @Column({ type: 'text', nullable: true })
  containmentAction?: string;

  @Column({ type: 'text', nullable: true })
  remediationAction?: string;

  @Column({ type: 'text', nullable: true })
  communicationNotes?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  outcome?: string;

  @Column({ type: 'text', nullable: true })
  resolutionReason?: string;

  @Column({ type: 'datetime' })
  openedAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  resolvedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('security_rules')
export class SecurityRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  category!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'simple-json' })
  conditions!: any;

  @Column({ type: 'simple-json' })
  actions!: any;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'int', default: 0 })
  triggerCount!: number;

  @Column({ type: 'int', default: 0 })
  alertCount!: number;

  @Column({ type: 'int', default: 0 })
  incidentCount!: number;

  @Column({ type: 'datetime', nullable: true })
  lastTriggeredAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('security_rule_versions')
export class SecurityRuleVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  ruleId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'simple-json' })
  conditions!: any;

  @Column({ type: 'simple-json' })
  actions!: any;

  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Column({ type: 'varchar', length: 255 })
  changedBy!: string;

  @Column({ type: 'text', nullable: true })
  changeReason?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('security_actions')
export class SecurityAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  actionType!: string;

  @Column({ type: 'varchar', length: 255 })
  actorId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail?: string;

  @Column({ type: 'varchar', length: 50 })
  targetType!: string;

  @Column({ type: 'varchar', length: 255 })
  targetId!: string;

  @Column({ type: 'simple-json', nullable: true })
  beforeState?: any;

  @Column({ type: 'simple-json', nullable: true })
  afterState?: any;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'varchar', length: 100, default: 'admin_portal' })
  source!: string;

  @Column({ type: 'boolean', default: true })
  success!: boolean;

  @Column({ type: 'text', nullable: true })
  failureReason?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  requestId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  correlationId?: string;

  @CreateDateColumn()
  executedAt!: Date;
}

@Entity('security_exceptions')
export class SecurityException {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  exceptionCode!: string;

  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Column({ type: 'varchar', length: 100 })
  component!: string;

  @Column({ type: 'varchar', length: 100 })
  entity!: string;

  @Column({ type: 'text' })
  expected!: string;

  @Column({ type: 'text' })
  actual!: string;

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  retryState!: string;

  @Column({ type: 'int', default: 0 })
  retryCount!: number;

  @Column({ type: 'text' })
  impact!: string;

  @Column({ type: 'text', nullable: true })
  resolution?: string;

  @CreateDateColumn()
  detectedAt!: Date;
}

export * from './schema-api-activity';
export * from './schema-webhooks';
export * from './schema-system-health';
export * from './schema-jobs';
export * from './schema-feature-flags';
export * from './schema-organization-settings';


