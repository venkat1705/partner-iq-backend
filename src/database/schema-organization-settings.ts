import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type AttributionModelType = 'LAST_TOUCH' | 'FIRST_TOUCH' | 'LINEAR' | 'POSITION_BASED';
export type CommissionCalculationType = 'PERCENTAGE' | 'FIXED';
export type PayoutScheduleType = 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY' | 'MANUAL';
export type DomainStatusType = 'NOT_CONFIGURED' | 'PENDING' | 'VERIFIED';
export type SslStatusType = 'ACTIVE' | 'PENDING';
export type WeekStartDay = 'MONDAY' | 'SUNDAY';

@Entity('organization_settings')
export class OrganizationSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  organizationId!: string;

  // ---------------------------------------------------------------------------
  // Profile & Identity
  // ---------------------------------------------------------------------------
  @Column({ type: 'varchar', length: 255, nullable: true })
  legalName?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  supportEmail?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  contactEmail?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  addressLine1?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  addressLine2?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state?: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  postalCode?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  taxId?: string;

  // ---------------------------------------------------------------------------
  // Localization
  // ---------------------------------------------------------------------------
  @Column({ type: 'varchar', length: 10, default: 'en' })
  language!: string;

  @Column({ type: 'varchar', length: 100, default: 'America/New_York' })
  timezone!: string;

  @Column({ type: 'varchar', length: 30, default: 'YYYY-MM-DD' })
  dateFormat!: string;

  @Column({ type: 'varchar', length: 30, default: 'standard' })
  numberFormat!: string;

  @Column({ type: 'varchar', length: 20, default: 'MONDAY' })
  weekStartsOn!: WeekStartDay;

  // ---------------------------------------------------------------------------
  // Tracking & Attribution
  // ---------------------------------------------------------------------------
  @Column({ type: 'varchar', length: 50, default: 'LAST_TOUCH' })
  defaultAttributionModel!: AttributionModelType;

  @Column({ type: 'int', default: 30 })
  cookieDurationDays!: number;

  @Column({ type: 'int', default: 30 })
  attributionWindowDays!: number;

  @Column({ type: 'varchar', length: 50, default: 'via' })
  referralParam!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  trackingDomain?: string;

  @Column({ type: 'boolean', default: false })
  crossDomainTracking!: boolean;

  @Column({ type: 'int', default: 24 })
  deduplicationWindowHours!: number;

  // ---------------------------------------------------------------------------
  // Commissions
  // ---------------------------------------------------------------------------
  @Column({ type: 'varchar', length: 50, default: 'PERCENTAGE' })
  defaultCommissionType!: CommissionCalculationType;

  @Column({ type: 'int', default: 1500 }) // 15.00% (basis points)
  defaultCommissionValue!: number;

  @Column({ type: 'int', default: 30 })
  holdPeriodDays!: number;

  @Column({ type: 'int', default: 5000 }) // $50.00 (minor units / cents)
  minimumThreshold!: number;

  @Column({ type: 'boolean', default: true })
  refundDeduction!: boolean;

  @Column({ type: 'varchar', length: 50, default: 'AUTOMATIC' })
  reversalPolicy!: string;

  // ---------------------------------------------------------------------------
  // Payout Preferences
  // ---------------------------------------------------------------------------
  @Column({ type: 'varchar', length: 50, default: 'MONTHLY' })
  defaultPayoutSchedule!: PayoutScheduleType;

  @Column({ type: 'int', default: 5000 })
  minimumPayoutAmount!: number;

  @Column({ type: 'boolean', default: false })
  autoApprovePayouts!: boolean;

  @Column({ type: 'int', default: 14 })
  payoutHoldingDays!: number;

  @Column({ type: 'simple-json', nullable: true })
  supportedPayoutMethods?: string[];

  // ---------------------------------------------------------------------------
  // Email Configuration
  // ---------------------------------------------------------------------------
  @Column({ type: 'varchar', length: 255, nullable: true })
  fromName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fromEmail?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  replyToEmail?: string;

  @Column({ type: 'varchar', length: 100, default: 'Amazon SES' })
  providerName!: string;

  @Column({ type: 'varchar', length: 50, default: 'CONNECTED' })
  providerStatus!: string;

  @Column({ type: 'timestamp', nullable: true })
  lastVerifiedAt?: Date;

  // ---------------------------------------------------------------------------
  // Documents & Invoicing
  // ---------------------------------------------------------------------------
  @Column({ type: 'varchar', length: 255, nullable: true })
  legalEntityName?: string;

  @Column({ type: 'text', nullable: true })
  registeredAddress?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  taxNumber?: string;

  @Column({ type: 'text', nullable: true })
  invoiceFooterNote?: string;

  // ---------------------------------------------------------------------------
  // Domains
  // ---------------------------------------------------------------------------
  @Column({ type: 'varchar', length: 255, nullable: true })
  customDomain?: string;

  @Column({ type: 'varchar', length: 50, default: 'NOT_CONFIGURED' })
  customDomainStatus!: DomainStatusType;

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  sslStatus!: SslStatusType;

  @Column({ type: 'boolean', default: false })
  dnsConfigured!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  trackingCustomDomain?: string;

  // ---------------------------------------------------------------------------
  // Developer Preferences
  // ---------------------------------------------------------------------------
  @Column({ type: 'boolean', default: true })
  apiAccessEnabled!: boolean;

  @Column({ type: 'int', default: 600 })
  apiRateLimitPerMinute!: number;

  @Column({ type: 'int', default: 10 })
  webhookDefaultTimeoutSeconds!: number;

  @Column({ type: 'int', default: 5 })
  webhookRetryLimit!: number;

  @Column({ type: 'boolean', default: true })
  webhookSignatureRequired!: boolean;

  // ---------------------------------------------------------------------------
  // Security Preferences
  // ---------------------------------------------------------------------------
  @Column({ type: 'boolean', default: true })
  allowGoogleLogin!: boolean;

  @Column({ type: 'boolean', default: true })
  allowPasswordLogin!: boolean;

  @Column({ type: 'boolean', default: false })
  singleSessionOnly!: boolean;

  @Column({ type: 'int', default: 10080 }) // 7 days
  sessionTimeoutMinutes!: number;

  @Column({ type: 'boolean', default: false })
  require2fa!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  securityAlertEmail?: string;

  // ---------------------------------------------------------------------------
  // Data & Privacy
  // ---------------------------------------------------------------------------
  @Column({ type: 'int', default: 365 })
  dataRetentionDays!: number;

  @Column({ type: 'boolean', default: true })
  analyticsCollection!: boolean;

  @Column({ type: 'boolean', default: true })
  ipLoggingEnabled!: boolean;

  @Column({ type: 'boolean', default: true })
  deviceMetadataEnabled!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  privacyContactEmail?: string;

  // ---------------------------------------------------------------------------
  // Auditing & Meta
  // ---------------------------------------------------------------------------
  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 255, default: 'system' })
  updatedBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
