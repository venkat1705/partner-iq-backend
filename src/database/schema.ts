import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';
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
} from '../common/enums';
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
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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

  @Column({ type: 'varchar', length: 10, default: 'USD' })
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
@Index(['organizationId', 'environment'])
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

  @Column({ type: 'varchar', length: 255 })
  externalId!: string;

  @Column({ type: 'varchar', length: 255 })
  customerExternalId!: string;

  @Column({ type: 'int' })
  amount!: number;

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

  @Column({ type: 'timestamp' })
  occurredAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
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

  @Column({ type: 'varchar', length: 50 })
  calculationVersion!: string;

  @Column({ type: 'varchar', length: 50 })
  status!: ConversionStatus;

  @CreateDateColumn()
  createdAt!: Date;
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

  @Column({ type: 'varchar', length: 10, default: 'USD' })
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
  @Column({ type: 'uuid' })
  affiliateId!: string;

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

  @Column({ type: 'varchar', length: 10, default: 'USD' })
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

  @Column({ type: 'timestamp' })
  periodStart!: Date;

  @Column({ type: 'timestamp' })
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
