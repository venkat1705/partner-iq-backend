import { v4 as uuidv4 } from 'uuid';
import { Repository } from 'typeorm';
import {
  UserStatus,
  OrganizationStatus,
  Role,
  ProgramType,
  ProgramStatus,
  CommissionType,
  AttributionModel,
  AffiliateStatus,
  ApplicationStatus,
  ConversionStatus,
  FraudStatus,
  FraudReviewStatus,
  PayoutStatus,
  LedgerEntryType,
  AuditAction,
  WebhookEvent,
} from '../common/enums';
import { AppDataSource, initializeDataSource } from './data-source';
import {
  User,
  UserIdentity,
  Organization,
  OrganizationMembership,
  AuthSession,
  Notification,
  NotificationPreference,
  Program,
  Affiliate,
  AffiliateInvitation,
  ProgramAffiliate,
  AffiliateApplication,
  TrackingLink,
  Click,
  Attribution,
  ApiKey,
  IdempotencyKey,
  Conversion,
  CommissionRule,
  Commission,
  LedgerAccount,
  LedgerTransaction,
  LedgerEntry,
  FraudReview,
  FraudSettings,
  FraudAssessment,
  FraudSignal,
  AffiliateTrustHistory,
  FraudMetricRollup,
  FraudRule,
  FraudRuleVersion,
  FraudAlert,
  FraudInvestigation,
  FraudHold,
  FraudException,
  PayoutBatch,
  PayoutItem,
  WebhookEndpoint,
  WebhookDelivery,
  AuditLog,
  DemoBooking,
  GoogleCalendarConnection,
  PublicKey,
  Integration,
  OrganizationIntegration,
  IntegrationCredential,
  IntegrationEvent,
  IntegrationOAuthState,
  IntegrationPlatformConfig,
  CrmPipelineMapping,
  CrmFieldMapping,
  CrmEntityMapping,
  IntegrationSyncLog,
  PartnerDeal,
  OrganizationTrial,
  BillingAccount,
  UserLegalAcceptance,
  BillingPlan,
  BillingPlanProviderMapping,
  BillingPlanFeature,
  BillingPlanLimit,
  BillingAddon,
  BillingAddonPurchase,
  BillingPromotion,
  BillingCoupon,
  BillingCouponPlan,
  BillingCouponOrganization,
  BillingCouponRedemption,
  BillingSubscriptionDiscount,
  OrganizationCoupon,
  OrganizationCouponAssignment,
  OrganizationCouponSettings,
  BillingSubscription,
  BillingPayment,
  BillingPaymentEvent,
  BillingRefund,
  BillingInvoice,
  Asset,
  AssetVersion,
  AssetBundle,
  AssetBundleItem,
  AssetTag,
  AffiliateAssetActivity,
  AffiliateAssetFavorite,
  PartnerTier,
  AffiliateTier,
  AffiliateTierHistory,
  Milestone,
  AffiliateMilestoneAchievement,
  AffiliatePerformanceSummary,
  AutomationWorkflow,
  AutomationWorkflowVersion,
  AutomationExecution,
  AutomationScheduledStep,
  AutomationEmailTemplate,
  EmailDesignTemplate,
  EmailDesignSettings,
  DocumentDesignTemplate,
  DocumentTemplateVersion,
  GeneratedDocument,
  AutomationEmailLog,
  EmailTemplateVersion,
  EmailTemplateOverride,
  EmailDeliveryLog,
  EmailSuppression,
  PlatformSetting,
  OrganizationBranding,
  BlogPost,
  SecurityEvent,
  SecuritySignal,
  SecurityAlert,
  SecurityInvestigation,
  SecurityIncident,
  SecurityRule,
  SecurityRuleVersion,
  SecurityAction,
  SecurityException,
  ApiRequest,
  ApiExternalCall,
  ApiErrorGroup,
  ApiRateLimitQuota,
  ApiActivityAudit,
  ApiActivityException,
  WebhookEndpointRecord,
  WebhookEventRecord,
  WebhookDeliveryRecord,
  WebhookDeliveryAttemptRecord,
  WebhookEventTypeDefinition,
  WebhookDeadLetterRecord,
  WebhookSecurityIncidentRecord,
  WebhookExceptionRecord,
  WebhookAuditRecord,
  SystemMonitoredService,
  SystemHealthCheckResult,
  SystemIncident,
  SystemServiceDependency,
  SystemDeploymentRecord,
  SystemMaintenanceWindow,
  QueueRecord,
  WorkerRecord,
  JobRecord,
  JobAttemptRecord,
  ScheduledJobRecord,
  DeadLetterRecord,
  JobExceptionRecord,
  JobSettingsRecord,
  FeatureFlag,
  FeatureFlagEnvironment,
  FeatureFlagRule,
  FeatureFlagOverride,
  FeatureFlagVersion,
  FeatureFlagDependency,
  FeatureFlagEvaluationMetric,
  FeatureFlagSettingsRecord,
  OrganizationSettings,
} from './schema';
import {
  RoleDefinition,
  PermissionDefinition,
  RolePermission,
  OrganizationPolicy,
  OrganizationInvitation,
} from './schema-rbac';

export type UserEntity = User;
export type UserIdentityEntity = UserIdentity;
export type OrganizationEntity = Organization;
export type OrganizationMembershipEntity = OrganizationMembership;
export type AuthSessionEntity = AuthSession;
export type NotificationEntity = Notification;
export type NotificationPreferenceEntity = NotificationPreference;
export type ProgramEntity = Program;
export type AffiliateEntity = Affiliate;
export type AffiliateInvitationEntity = AffiliateInvitation;
export type ProgramAffiliateEntity = ProgramAffiliate;
export type AffiliateApplicationEntity = AffiliateApplication;
export type TrackingLinkEntity = TrackingLink;
export type ClickEntity = Click;
export type AttributionEntity = Attribution;
export type ApiKeyEntity = ApiKey;
export type IdempotencyKeyEntity = IdempotencyKey;
export type ConversionEntity = Conversion;
export type CommissionRuleEntity = CommissionRule;
export type CommissionEntity = Commission;
export type LedgerAccountEntity = LedgerAccount;
export type LedgerTransactionEntity = LedgerTransaction;
export type LedgerEntryEntity = LedgerEntry;
export type FraudReviewEntity = FraudReview;
export type FraudSettingsEntity = FraudSettings;
export type FraudAssessmentEntity = FraudAssessment;
export type FraudSignalEntity = FraudSignal;
export type AffiliateTrustHistoryEntity = AffiliateTrustHistory;
export type FraudMetricRollupEntity = FraudMetricRollup;
export type FraudRuleEntity = FraudRule;
export type FraudRuleVersionEntity = FraudRuleVersion;
export type FraudAlertEntity = FraudAlert;
export type FraudInvestigationEntity = FraudInvestigation;
export type FraudHoldEntity = FraudHold;
export type FraudExceptionEntity = FraudException;
export type PayoutBatchEntity = PayoutBatch;
export type PayoutItemEntity = PayoutItem;
export type WebhookEndpointEntity = WebhookEndpoint;
export type WebhookDeliveryEntity = WebhookDelivery;
export type AuditLogEntity = AuditLog;
export type DemoBookingEntity = DemoBooking;
export type GoogleCalendarConnectionEntity = GoogleCalendarConnection;
export type PublicKeyEntity = PublicKey;
export type IntegrationEntity = Integration;
export type OrganizationIntegrationEntity = OrganizationIntegration;
export type IntegrationCredentialEntity = IntegrationCredential;
export type IntegrationEventEntity = IntegrationEvent;
export type IntegrationOAuthStateEntity = IntegrationOAuthState;
export type IntegrationPlatformConfigEntity = IntegrationPlatformConfig;
export type CrmPipelineMappingEntity = CrmPipelineMapping;
export type CrmFieldMappingEntity = CrmFieldMapping;
export type CrmEntityMappingEntity = CrmEntityMapping;
export type IntegrationSyncLogEntity = IntegrationSyncLog;
export type PartnerDealEntity = PartnerDeal;
export type OrganizationTrialEntity = OrganizationTrial;
export type UserLegalAcceptanceEntity = UserLegalAcceptance;
export type BillingAccountEntity = BillingAccount;
export type BillingPlanEntity = BillingPlan;
export type BillingPlanLimitEntity = BillingPlanLimit;
export type BillingAddonEntity = BillingAddon;
export type BillingAddonPurchaseEntity = BillingAddonPurchase;
export type BillingPlanProviderMappingEntity = BillingPlanProviderMapping;
export type BillingPlanFeatureEntity = BillingPlanFeature;
export type BillingPromotionEntity = BillingPromotion;
export type BillingCouponEntity = BillingCoupon;
export type BillingCouponPlanEntity = BillingCouponPlan;
export type BillingCouponOrganizationEntity = BillingCouponOrganization;
export type BillingCouponRedemptionEntity = BillingCouponRedemption;
export type BillingSubscriptionDiscountEntity = BillingSubscriptionDiscount;
export type OrganizationCouponEntity = OrganizationCoupon;
export type OrganizationCouponAssignmentEntity = OrganizationCouponAssignment;
export type OrganizationCouponSettingsEntity = OrganizationCouponSettings;
export type BillingSubscriptionEntity = BillingSubscription;
export type BillingPaymentEntity = BillingPayment;
export type BillingPaymentEventEntity = BillingPaymentEvent;
export type BillingRefundEntity = BillingRefund;
export type BillingInvoiceEntity = BillingInvoice;
export type AssetEntity = Asset;
export type AssetVersionEntity = AssetVersion;
export type AssetBundleEntity = AssetBundle;
export type AssetBundleItemEntity = AssetBundleItem;
export type AssetTagEntity = AssetTag;
export type AffiliateAssetActivityEntity = AffiliateAssetActivity;
export type AffiliateAssetFavoriteEntity = AffiliateAssetFavorite;
export type PartnerTierEntity = PartnerTier;
export type AffiliateTierEntity = AffiliateTier;
export type AffiliateTierHistoryEntity = AffiliateTierHistory;
export type MilestoneEntity = Milestone;
export type AffiliateMilestoneAchievementEntity = AffiliateMilestoneAchievement;
export type AffiliatePerformanceSummaryEntity = AffiliatePerformanceSummary;
export type AutomationWorkflowEntity = AutomationWorkflow;
export type AutomationWorkflowVersionEntity = AutomationWorkflowVersion;
export type AutomationExecutionEntity = AutomationExecution;
export type AutomationScheduledStepEntity = AutomationScheduledStep;
export type AutomationEmailTemplateEntity = AutomationEmailTemplate;
export type EmailDesignTemplateEntity = EmailDesignTemplate;
export type EmailDesignSettingsEntity = EmailDesignSettings;
export type DocumentDesignTemplateEntity = DocumentDesignTemplate;
export type DocumentTemplateVersionEntity = DocumentTemplateVersion;
export type GeneratedDocumentEntity = GeneratedDocument;
export type AutomationEmailLogEntity = AutomationEmailLog;
export type EmailTemplateVersionEntity = EmailTemplateVersion;
export type EmailTemplateOverrideEntity = EmailTemplateOverride;
export type EmailDeliveryLogEntity = EmailDeliveryLog;
export type EmailSuppressionEntity = EmailSuppression;
export type RoleDefinitionEntity = import('./schema-rbac').RoleDefinition;
export type PermissionDefinitionEntity = import('./schema-rbac').PermissionDefinition;
export type RolePermissionEntity = import('./schema-rbac').RolePermission;
export type OrganizationPolicyEntity = import('./schema-rbac').OrganizationPolicy;
export type OrganizationInvitationEntity = import('./schema-rbac').OrganizationInvitation;
export type PlatformSettingEntity = PlatformSetting;
export type OrganizationBrandingEntity = OrganizationBranding;
export type BlogPostEntity = BlogPost;
export type SecurityEventEntity = SecurityEvent;
export type SecuritySignalEntity = SecuritySignal;
export type SecurityAlertEntity = SecurityAlert;
export type SecurityInvestigationEntity = SecurityInvestigation;
export type SecurityIncidentEntity = SecurityIncident;
export type SecurityRuleEntity = SecurityRule;
export type SecurityRuleVersionEntity = SecurityRuleVersion;
export type SecurityActionEntity = SecurityAction;
export type SecurityExceptionEntity = SecurityException;
export type ApiRequestEntity = ApiRequest;
export type ApiExternalCallEntity = ApiExternalCall;
export type ApiErrorGroupEntity = ApiErrorGroup;
export type ApiRateLimitQuotaEntity = ApiRateLimitQuota;
export type ApiActivityAuditEntity = ApiActivityAudit;
export type ApiActivityExceptionEntity = ApiActivityException;
export type WebhookEndpointRecordEntity = WebhookEndpointRecord;
export type WebhookEventRecordEntity = WebhookEventRecord;
export type WebhookDeliveryRecordEntity = WebhookDeliveryRecord;
export type WebhookDeliveryAttemptRecordEntity = WebhookDeliveryAttemptRecord;
export type WebhookEventTypeDefinitionEntity = WebhookEventTypeDefinition;
export type WebhookDeadLetterRecordEntity = WebhookDeadLetterRecord;
export type WebhookSecurityIncidentRecordEntity = WebhookSecurityIncidentRecord;
export type WebhookExceptionRecordEntity = WebhookExceptionRecord;
export type WebhookAuditRecordEntity = WebhookAuditRecord;
export type SystemMonitoredServiceEntity = SystemMonitoredService;
export type SystemHealthCheckResultEntity = SystemHealthCheckResult;
export type SystemIncidentEntity = SystemIncident;
export type SystemServiceDependencyEntity = SystemServiceDependency;
export type SystemDeploymentRecordEntity = SystemDeploymentRecord;
export type SystemMaintenanceWindowEntity = SystemMaintenanceWindow;
export type QueueRecordEntity = QueueRecord;
export type WorkerRecordEntity = WorkerRecord;
export type JobRecordEntity = JobRecord;
export type JobAttemptRecordEntity = JobAttemptRecord;
export type ScheduledJobRecordEntity = ScheduledJobRecord;
export type DeadLetterRecordEntity = DeadLetterRecord;
export type JobExceptionRecordEntity = JobExceptionRecord;
export type JobSettingsRecordEntity = JobSettingsRecord;
export type FeatureFlagEntity = FeatureFlag;
export type FeatureFlagEnvironmentEntity = FeatureFlagEnvironment;
export type FeatureFlagRuleEntity = FeatureFlagRule;
export type FeatureFlagOverrideEntity = FeatureFlagOverride;
export type FeatureFlagVersionEntity = FeatureFlagVersion;
export type FeatureFlagDependencyEntity = FeatureFlagDependency;
export type FeatureFlagEvaluationMetricEntity = FeatureFlagEvaluationMetric;
export type FeatureFlagSettingsRecordEntity = FeatureFlagSettingsRecord;
export type OrganizationSettingsEntity = OrganizationSettings;


class DBBackedArray<T extends object> extends Array<T> {
  private repo: Repository<T>;

  private static isBillingPlans<T extends object>(repo?: Repository<T>) {
    return repo?.metadata?.tableName === 'billing_plans';
  }

  private static conflictPathsFor<T extends object>(repo?: Repository<T>) {
    if (!repo?.metadata) return ['id'];
    if (DBBackedArray.isBillingPlans(repo)) {
      return ['code', 'billingInterval', 'currency'];
    }
    if (repo.metadata.tableName === 'email_design_templates') {
      return ['templateId'];
    }
    if (repo.metadata.tableName === 'document_design_templates') {
      return ['templateKey'];
    }
    if (repo.metadata.tableName === 'email_design_settings') {
      return ['settingsKey'];
    }
    if (repo.metadata.tableName === 'platform_settings') {
      return ['key'];
    }
    if (repo.metadata.tableName === 'blog_posts') {
      return ['slug'];
    }
    return ['id'];
  }

  private static async persistEntity<T extends object>(repo?: Repository<T>, item?: T) {
    if (process.env.TEST_MEMORY_ONLY === 'true' || !AppDataSource.isInitialized) {
      return;
    }
    if (!repo || !item) return;
    if (DBBackedArray.isBillingPlans(repo)) {
      const plan = item as any;
      if (plan.code && plan.billingInterval && plan.currency) {
        const existing = await repo.findOne({
          where: {
            code: plan.code,
            billingInterval: plan.billingInterval,
            currency: plan.currency,
          } as any,
        });

        if (existing) {
          const saved = await repo.save({
            ...plan,
            id: (existing as any).id,
            createdDate: (existing as any).createdDate || plan.createdDate,
          });
          Object.assign(item, saved);
          return;
        }
      }

      const saved = await repo.save(item);
      Object.assign(item, saved);
      return;
    }

    if (repo.metadata.tableName === 'email_design_templates') {
      const tpl = item as any;
      if (tpl.templateId) {
        const existing = await repo.findOne({ where: { templateId: tpl.templateId } as any });
        if (existing) {
          const saved = await repo.save({
            ...tpl,
            id: (existing as any).id,
            createdAt: (existing as any).createdAt || tpl.createdAt,
          });
          Object.assign(item, saved);
          return;
        }
      }
    }

    if (repo.metadata.tableName === 'document_design_templates') {
      const doc = item as any;
      if (doc.templateKey) {
        const existing = await repo.findOne({ where: { templateKey: doc.templateKey } as any });
        if (existing) {
          const saved = await repo.save({
            ...doc,
            id: (existing as any).id,
            createdAt: (existing as any).createdAt || doc.createdAt,
          });
          Object.assign(item, saved);
          return;
        }
      }
    }

    if (repo.metadata.tableName === 'email_design_settings') {
      const set = item as any;
      if (set.settingsKey) {
        const existing = await repo.findOne({ where: { settingsKey: set.settingsKey } as any });
        if (existing) {
          const saved = await repo.save({
            ...set,
            id: (existing as any).id,
            createdAt: (existing as any).createdAt || set.createdAt,
          });
          Object.assign(item, saved);
          return;
        }
      }
    }

    await repo.upsert(item, DBBackedArray.conflictPathsFor(repo) as any);
  }

  private persist(items: T | T[]) {
    if (process.env.TEST_MEMORY_ONLY === 'true' || !AppDataSource.isInitialized) {
      return;
    }
    const values = Array.isArray(items) ? items : [items];
    const promise = Promise.all(values.map((item) => DBBackedArray.persistEntity(this.repo, item)))
      .then(() => undefined)
      .catch((err) => {
        console.error('dbStore save error:', err);
      });
    for (const item of values) {
      DBBackedArray.setPendingPersist(item, promise);
    }
  }

  constructor(repo: Repository<T>, items: T[] = []) {
    super(...items.map((item) => DBBackedArray.wrapEntity(repo, item)));
    Object.setPrototypeOf(this, DBBackedArray.prototype);
    this.repo = repo;
  }

  /**
   * Property assignment through the Proxy's `set` trap is synchronous by JS spec — the code
   * doing `entity.field = value` has no expression to `await`, so the trap can only *start* the
   * database write, never let the caller wait on it. To let a service method confirm its own
   * writes landed before it returns (rather than firing-and-forgetting and trusting it worked),
   * every write's promise is stashed on the entity as a non-enumerable field. Call the exported
   * `awaitPersist(entity)` after mutating to wait for that write.
   */
  private static setPendingPersist<T extends object>(item: T, promise: Promise<void>) {
    Object.defineProperty(item, '__pendingPersist', {
      value: promise,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  private static wrapEntity<T extends object>(repo: Repository<T>, item: T): T {
    if ((item as any).__dbStoreProxy) {
      return item;
    }

    Object.defineProperty(item, '__dbStoreProxy', {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    DBBackedArray.setPendingPersist(item, Promise.resolve());

    const proxy = new Proxy(item, {
      set(target, property, value) {
        const result = Reflect.set(target, property, value);
        if (property !== 'id' && process.env.TEST_MEMORY_ONLY !== 'true' && AppDataSource.isInitialized) {
          const promise = DBBackedArray.persistEntity(repo, target as T).catch((err) => {
            console.error('dbStore save error:', err);
          });
          DBBackedArray.setPendingPersist(target, promise);
        }
        return result;
      },
    });

    return proxy;
  }

  push(...items: T[]): number {
    const wrapped = items.map((item) => DBBackedArray.wrapEntity(this.repo, item));
    this.persist(items);
    return super.push(...wrapped);
  }

  unshift(...items: T[]): number {
    const wrapped = items.map((item) => DBBackedArray.wrapEntity(this.repo, item));
    this.persist(items);
    return super.unshift(...wrapped);
  }

  splice(start: number, deleteCount?: number, ...items: T[]): T[] {
    const wrapped = items.map((item) => DBBackedArray.wrapEntity(this.repo, item));
    const removed = super.splice(start, deleteCount === undefined ? this.length - start : deleteCount, ...wrapped);
    if (items.length > 0) {
      this.persist(items);
    }
    // If items were removed, delete them from the underlying repository as well
    if (removed && removed.length > 0) {
      const ids = removed.map((r: any) => r && (r as any).id).filter(Boolean);
      if (ids.length) {
        this.repo.delete(ids as any).catch((err) => {
          console.error('dbStore delete error:', err);
        });
      }
    }

    return removed;
  }

  pop(): T | undefined {
    const item = super.pop();
    if (item) {
      if (process.env.TEST_MEMORY_ONLY !== 'true' && AppDataSource.isInitialized) {
        const id = (item as any).id;
        if (id) {
          this.repo.delete(id as any).catch((err) => {
            console.error('dbStore delete error:', err);
          });
        }
      }
    }
    return item;
  }

  shift(): T | undefined {
    const item = super.shift();
    if (item) {
      if (process.env.TEST_MEMORY_ONLY !== 'true' && AppDataSource.isInitialized) {
        const id = (item as any).id;
        if (id) {
          this.repo.delete(id as any).catch((err) => {
            console.error('dbStore delete error:', err);
          });
        }
      }
    }
    return item;
  }
}

export class InMemoryDataStore {
        static instance = new InMemoryDataStore();

        private initialized = false;

        users: UserEntity[] = [];
        userIdentities: UserIdentityEntity[] = [];
        organizations: OrganizationEntity[] = [];
        organizationMemberships: OrganizationMembershipEntity[] = [];
        authSessions: AuthSessionEntity[] = [];
        notifications: NotificationEntity[] = [];
        notificationPreferences: NotificationPreferenceEntity[] = [];
        programs: ProgramEntity[] = [];
        affiliates: AffiliateEntity[] = [];
        affiliateInvitations: AffiliateInvitationEntity[] = [];
        programAffiliates: ProgramAffiliateEntity[] = [];
        affiliateApplications: AffiliateApplicationEntity[] = [];
        trackingLinks: TrackingLinkEntity[] = [];
        clicks: ClickEntity[] = [];
        attributions: AttributionEntity[] = [];
        apiKeys: ApiKeyEntity[] = [];
        idempotencyKeys: IdempotencyKeyEntity[] = [];
        conversions: ConversionEntity[] = [];
        commissionRules: CommissionRuleEntity[] = [];
        commissions: CommissionEntity[] = [];
        ledgerAccounts: LedgerAccountEntity[] = [];
        ledgerTransactions: LedgerTransactionEntity[] = [];
        ledgerEntries: LedgerEntryEntity[] = [];
        fraudReviews: FraudReviewEntity[] = [];
        fraudSettings: FraudSettingsEntity[] = [];
        fraudAssessments: FraudAssessmentEntity[] = [];
        fraudSignals: FraudSignalEntity[] = [];
        affiliateTrustHistory: AffiliateTrustHistoryEntity[] = [];
        fraudMetricRollups: FraudMetricRollupEntity[] = [];
        fraudRules: FraudRuleEntity[] = [];
        fraudRuleVersions: FraudRuleVersionEntity[] = [];
        fraudAlerts: FraudAlertEntity[] = [];
        fraudInvestigations: FraudInvestigationEntity[] = [];
        fraudHolds: FraudHoldEntity[] = [];
        fraudExceptions: FraudExceptionEntity[] = [];
        payoutBatches: PayoutBatchEntity[] = [];
        payoutItems: PayoutItemEntity[] = [];
        webhookEndpoints: WebhookEndpointEntity[] = [];
        webhookDeliveries: WebhookDeliveryEntity[] = [];
        auditLogs: AuditLogEntity[] = [];
        demoBookings: DemoBookingEntity[] = [];
        googleCalendarConnections: GoogleCalendarConnectionEntity[] = [];
        publicKeys: PublicKeyEntity[] = [];
        integrations: IntegrationEntity[] = [];
        organizationIntegrations: OrganizationIntegrationEntity[] = [];
        integrationCredentials: IntegrationCredentialEntity[] = [];
        integrationEvents: IntegrationEventEntity[] = [];
        integrationOAuthStates: IntegrationOAuthStateEntity[] = [];
        integrationPlatformConfigs: IntegrationPlatformConfigEntity[] = [];
        crmPipelineMappings: CrmPipelineMappingEntity[] = [];
        crmFieldMappings: CrmFieldMappingEntity[] = [];
        crmEntityMappings: CrmEntityMappingEntity[] = [];
        integrationSyncLogs: IntegrationSyncLogEntity[] = [];
        partnerDeals: PartnerDealEntity[] = [];
        organizationTrials: OrganizationTrialEntity[] = [];
        userLegalAcceptances: UserLegalAcceptanceEntity[] = [];
        billingAccounts: BillingAccountEntity[] = [];
        billingPlans: BillingPlanEntity[] = [];
        billingPlanLimits: BillingPlanLimitEntity[] = [];
        billingAddons: BillingAddonEntity[] = [];
        billingAddonPurchases: BillingAddonPurchaseEntity[] = [];
        billingPlanProviderMappings: BillingPlanProviderMappingEntity[] = [];
        billingPlanFeatures: BillingPlanFeatureEntity[] = [];
        billingPromotions: BillingPromotionEntity[] = [];
        billingCoupons: BillingCouponEntity[] = [];
        billingCouponPlans: BillingCouponPlanEntity[] = [];
        billingCouponOrganizations: BillingCouponOrganizationEntity[] = [];
        billingCouponRedemptions: BillingCouponRedemptionEntity[] = [];
        billingSubscriptionDiscounts: BillingSubscriptionDiscountEntity[] = [];
        organizationCoupons: OrganizationCouponEntity[] = [];
        organizationCouponAssignments: OrganizationCouponAssignmentEntity[] = [];
        organizationCouponSettings: OrganizationCouponSettingsEntity[] = [];
        billingSubscriptions: BillingSubscriptionEntity[] = [];
        billingPayments: BillingPaymentEntity[] = [];
        billingPaymentEvents: BillingPaymentEventEntity[] = [];
        billingRefunds: BillingRefundEntity[] = [];
        billingInvoices: BillingInvoiceEntity[] = [];
        assets: AssetEntity[] = [];
        assetVersions: AssetVersionEntity[] = [];
        assetBundles: AssetBundleEntity[] = [];
        assetBundleItems: AssetBundleItemEntity[] = [];
        assetTags: AssetTagEntity[] = [];
        affiliateAssetActivities: AffiliateAssetActivityEntity[] = [];
        affiliateAssetFavorites: AffiliateAssetFavoriteEntity[] = [];
        partnerTiers: PartnerTierEntity[] = [];
        affiliateTiers: AffiliateTierEntity[] = [];
        affiliateTierHistories: AffiliateTierHistoryEntity[] = [];
        milestones: MilestoneEntity[] = [];
        affiliateMilestoneAchievements: AffiliateMilestoneAchievementEntity[] = [];
        affiliatePerformanceSummaries: AffiliatePerformanceSummaryEntity[] = [];
        automationWorkflows: AutomationWorkflowEntity[] = [];
        automationWorkflowVersions: AutomationWorkflowVersionEntity[] = [];
        automationExecutions: AutomationExecutionEntity[] = [];
        automationScheduledSteps: AutomationScheduledStepEntity[] = [];
        automationEmailTemplates: AutomationEmailTemplateEntity[] = [];
        emailDesignTemplates: EmailDesignTemplateEntity[] = [];
        emailDesignSettings: EmailDesignSettingsEntity[] = [];
        documentDesignTemplates: DocumentDesignTemplateEntity[] = [];
        documentTemplateVersions: DocumentTemplateVersionEntity[] = [];
        generatedDocuments: GeneratedDocumentEntity[] = [];
        automationEmailLogs: AutomationEmailLogEntity[] = [];
        emailTemplateVersions: EmailTemplateVersionEntity[] = [];
        emailTemplateOverrides: EmailTemplateOverrideEntity[] = [];
        emailDeliveryLogs: EmailDeliveryLogEntity[] = [];
        emailSuppressions: EmailSuppressionEntity[] = [];
        roles: RoleDefinitionEntity[] = [];
        permissions: PermissionDefinitionEntity[] = [];
        rolePermissions: RolePermissionEntity[] = [];
        organizationPolicies: OrganizationPolicyEntity[] = [];
        organizationInvitations: OrganizationInvitationEntity[] = [];
        platformSettings: PlatformSettingEntity[] = [];
        organizationBrandings: OrganizationBrandingEntity[] = [];
        blogPosts: BlogPostEntity[] = [];
        securityEvents: SecurityEventEntity[] = [];
        securitySignals: SecuritySignalEntity[] = [];
        securityAlerts: SecurityAlertEntity[] = [];
        securityInvestigations: SecurityInvestigationEntity[] = [];
        securityIncidents: SecurityIncidentEntity[] = [];
        securityRules: SecurityRuleEntity[] = [];
        securityRuleVersions: SecurityRuleVersionEntity[] = [];
        securityActions: SecurityActionEntity[] = [];
        securityExceptions: SecurityExceptionEntity[] = [];
        apiRequests: ApiRequestEntity[] = [];
        apiExternalCalls: ApiExternalCallEntity[] = [];
        apiErrorGroups: ApiErrorGroupEntity[] = [];
        apiRateLimitQuotas: ApiRateLimitQuotaEntity[] = [];
        apiActivityAudits: ApiActivityAuditEntity[] = [];
        apiActivityExceptions: ApiActivityExceptionEntity[] = [];
        webhookEndpointRecords: WebhookEndpointRecordEntity[] = [];
        webhookEventRecords: WebhookEventRecordEntity[] = [];
        webhookDeliveryRecords: WebhookDeliveryRecordEntity[] = [];
        webhookDeliveryAttemptRecords: WebhookDeliveryAttemptRecordEntity[] = [];
        webhookEventTypeDefinitions: WebhookEventTypeDefinitionEntity[] = [];
        webhookDeadLetterRecords: WebhookDeadLetterRecordEntity[] = [];
        webhookSecurityIncidents: WebhookSecurityIncidentRecordEntity[] = [];
        webhookExceptions: WebhookExceptionRecordEntity[] = [];
        webhookAuditRecords: WebhookAuditRecordEntity[] = [];
        systemMonitoredServices: SystemMonitoredServiceEntity[] = [];
        systemHealthCheckResults: SystemHealthCheckResultEntity[] = [];
        systemIncidents: SystemIncidentEntity[] = [];
        systemServiceDependencies: SystemServiceDependencyEntity[] = [];
        systemDeploymentRecords: SystemDeploymentRecordEntity[] = [];
        systemMaintenanceWindows: SystemMaintenanceWindowEntity[] = [];
        queueRecords: QueueRecordEntity[] = [];
        workerRecords: WorkerRecordEntity[] = [];
        jobRecords: JobRecordEntity[] = [];
        jobAttemptRecords: JobAttemptRecordEntity[] = [];
        scheduledJobRecords: ScheduledJobRecordEntity[] = [];
        deadLetterRecords: DeadLetterRecordEntity[] = [];
        jobExceptionRecords: JobExceptionRecordEntity[] = [];
        jobSettingsRecords: JobSettingsRecordEntity[] = [];
        featureFlags: FeatureFlagEntity[] = [];
        featureFlagEnvironments: FeatureFlagEnvironmentEntity[] = [];
        featureFlagRules: FeatureFlagRuleEntity[] = [];
        featureFlagOverrides: FeatureFlagOverrideEntity[] = [];
        featureFlagVersions: FeatureFlagVersionEntity[] = [];
        featureFlagDependencies: FeatureFlagDependencyEntity[] = [];
        featureFlagMetrics: FeatureFlagEvaluationMetricEntity[] = [];
        featureFlagSettingsRecords: FeatureFlagSettingsRecordEntity[] = [];
        organizationSettings: OrganizationSettingsEntity[] = [];


        // Counter maps for Redis rate-limit/fraud tracking
        ipClickCounters: Map<string, { count: number; expiresAt: number }> = new Map();
        affiliateClickCounters: Map<string, { count: number; expiresAt: number }> = new Map();

        async initialize() {
          if (this.initialized) {
            return;
          }

          await initializeDataSource();

          this.users = new DBBackedArray(AppDataSource.getRepository(User), await AppDataSource.getRepository(User).find());
          this.userIdentities = new DBBackedArray(
            AppDataSource.getRepository(UserIdentity),
            await AppDataSource.getRepository(UserIdentity).find(),
          );
          this.organizations = new DBBackedArray(
            AppDataSource.getRepository(Organization),
            await AppDataSource.getRepository(Organization).find(),
          );
          this.organizationMemberships = new DBBackedArray(
            AppDataSource.getRepository(OrganizationMembership),
            await AppDataSource.getRepository(OrganizationMembership).find(),
          );
          this.authSessions = new DBBackedArray(AppDataSource.getRepository(AuthSession), await AppDataSource.getRepository(AuthSession).find());
          this.notifications = new DBBackedArray(
            AppDataSource.getRepository(Notification),
            await AppDataSource.getRepository(Notification).find(),
          );
          this.notificationPreferences = new DBBackedArray(
            AppDataSource.getRepository(NotificationPreference),
            await AppDataSource.getRepository(NotificationPreference).find(),
          );
          this.programs = new DBBackedArray(AppDataSource.getRepository(Program), await AppDataSource.getRepository(Program).find());
          this.affiliates = new DBBackedArray(AppDataSource.getRepository(Affiliate), await AppDataSource.getRepository(Affiliate).find());
          this.affiliateInvitations = new DBBackedArray(
            AppDataSource.getRepository(AffiliateInvitation),
            await AppDataSource.getRepository(AffiliateInvitation).find(),
          );
          this.programAffiliates = new DBBackedArray(
            AppDataSource.getRepository(ProgramAffiliate),
            await AppDataSource.getRepository(ProgramAffiliate).find(),
          );
          this.affiliateApplications = new DBBackedArray(
            AppDataSource.getRepository(AffiliateApplication),
            await AppDataSource.getRepository(AffiliateApplication).find(),
          );
          this.trackingLinks = new DBBackedArray(
            AppDataSource.getRepository(TrackingLink),
            await AppDataSource.getRepository(TrackingLink).find(),
          );
          this.clicks = new DBBackedArray(AppDataSource.getRepository(Click), await AppDataSource.getRepository(Click).find());
          this.attributions = new DBBackedArray(AppDataSource.getRepository(Attribution), await AppDataSource.getRepository(Attribution).find());
          this.apiKeys = new DBBackedArray(AppDataSource.getRepository(ApiKey), await AppDataSource.getRepository(ApiKey).find());
          this.idempotencyKeys = new DBBackedArray(
            AppDataSource.getRepository(IdempotencyKey),
            await AppDataSource.getRepository(IdempotencyKey).find(),
          );
          this.conversions = new DBBackedArray(AppDataSource.getRepository(Conversion), await AppDataSource.getRepository(Conversion).find());
          this.commissionRules = new DBBackedArray(
            AppDataSource.getRepository(CommissionRule),
            await AppDataSource.getRepository(CommissionRule).find(),
          );
          this.commissions = new DBBackedArray(AppDataSource.getRepository(Commission), await AppDataSource.getRepository(Commission).find());
          this.ledgerAccounts = new DBBackedArray(
            AppDataSource.getRepository(LedgerAccount),
            await AppDataSource.getRepository(LedgerAccount).find(),
          );
          this.ledgerTransactions = new DBBackedArray(
            AppDataSource.getRepository(LedgerTransaction),
            await AppDataSource.getRepository(LedgerTransaction).find(),
          );
          this.ledgerEntries = new DBBackedArray(
            AppDataSource.getRepository(LedgerEntry),
            await AppDataSource.getRepository(LedgerEntry).find(),
          );
          this.fraudReviews = new DBBackedArray(AppDataSource.getRepository(FraudReview), await AppDataSource.getRepository(FraudReview).find());
          this.fraudSettings = new DBBackedArray(AppDataSource.getRepository(FraudSettings), await AppDataSource.getRepository(FraudSettings).find());
          this.fraudAssessments = new DBBackedArray(AppDataSource.getRepository(FraudAssessment), await AppDataSource.getRepository(FraudAssessment).find());
          this.fraudSignals = new DBBackedArray(AppDataSource.getRepository(FraudSignal), await AppDataSource.getRepository(FraudSignal).find());
          this.affiliateTrustHistory = new DBBackedArray(
            AppDataSource.getRepository(AffiliateTrustHistory),
            await AppDataSource.getRepository(AffiliateTrustHistory).find(),
          );
          this.fraudMetricRollups = new DBBackedArray(
            AppDataSource.getRepository(FraudMetricRollup),
            await AppDataSource.getRepository(FraudMetricRollup).find(),
          );
          this.fraudRules = new DBBackedArray(AppDataSource.getRepository(FraudRule), await AppDataSource.getRepository(FraudRule).find());
          this.fraudRuleVersions = new DBBackedArray(AppDataSource.getRepository(FraudRuleVersion), await AppDataSource.getRepository(FraudRuleVersion).find());
          this.fraudAlerts = new DBBackedArray(AppDataSource.getRepository(FraudAlert), await AppDataSource.getRepository(FraudAlert).find());
          this.fraudInvestigations = new DBBackedArray(AppDataSource.getRepository(FraudInvestigation), await AppDataSource.getRepository(FraudInvestigation).find());
          this.fraudHolds = new DBBackedArray(AppDataSource.getRepository(FraudHold), await AppDataSource.getRepository(FraudHold).find());
          this.fraudExceptions = new DBBackedArray(AppDataSource.getRepository(FraudException), await AppDataSource.getRepository(FraudException).find());
          this.payoutBatches = new DBBackedArray(
            AppDataSource.getRepository(PayoutBatch),
            await AppDataSource.getRepository(PayoutBatch).find(),
          );
          this.payoutItems = new DBBackedArray(AppDataSource.getRepository(PayoutItem), await AppDataSource.getRepository(PayoutItem).find());
          this.webhookEndpoints = new DBBackedArray(
            AppDataSource.getRepository(WebhookEndpoint),
            await AppDataSource.getRepository(WebhookEndpoint).find(),
          );
          this.webhookDeliveries = new DBBackedArray(
            AppDataSource.getRepository(WebhookDelivery),
            await AppDataSource.getRepository(WebhookDelivery).find(),
          );
          this.auditLogs = new DBBackedArray(AppDataSource.getRepository(AuditLog), await AppDataSource.getRepository(AuditLog).find());
          this.demoBookings = new DBBackedArray(AppDataSource.getRepository(DemoBooking), await AppDataSource.getRepository(DemoBooking).find());
          this.googleCalendarConnections = new DBBackedArray(
            AppDataSource.getRepository(GoogleCalendarConnection),
            await AppDataSource.getRepository(GoogleCalendarConnection).find(),
          );
          this.publicKeys = new DBBackedArray(AppDataSource.getRepository(PublicKey), await AppDataSource.getRepository(PublicKey).find());
          this.integrations = new DBBackedArray(AppDataSource.getRepository(Integration), await AppDataSource.getRepository(Integration).find());
          this.organizationIntegrations = new DBBackedArray(
            AppDataSource.getRepository(OrganizationIntegration),
            await AppDataSource.getRepository(OrganizationIntegration).find(),
          );
          this.integrationCredentials = new DBBackedArray(
            AppDataSource.getRepository(IntegrationCredential),
            await AppDataSource.getRepository(IntegrationCredential).find(),
          );
          this.integrationEvents = new DBBackedArray(
            AppDataSource.getRepository(IntegrationEvent),
            await AppDataSource.getRepository(IntegrationEvent).find(),
          );
          this.integrationOAuthStates = new DBBackedArray(
            AppDataSource.getRepository(IntegrationOAuthState),
            await AppDataSource.getRepository(IntegrationOAuthState).find(),
          );
          this.integrationPlatformConfigs = new DBBackedArray(
            AppDataSource.getRepository(IntegrationPlatformConfig),
            await AppDataSource.getRepository(IntegrationPlatformConfig).find(),
          );
          this.crmPipelineMappings = new DBBackedArray(
            AppDataSource.getRepository(CrmPipelineMapping),
            await AppDataSource.getRepository(CrmPipelineMapping).find(),
          );
          this.crmFieldMappings = new DBBackedArray(
            AppDataSource.getRepository(CrmFieldMapping),
            await AppDataSource.getRepository(CrmFieldMapping).find(),
          );
          this.crmEntityMappings = new DBBackedArray(
            AppDataSource.getRepository(CrmEntityMapping),
            await AppDataSource.getRepository(CrmEntityMapping).find(),
          );
          this.integrationSyncLogs = new DBBackedArray(
            AppDataSource.getRepository(IntegrationSyncLog),
            await AppDataSource.getRepository(IntegrationSyncLog).find(),
          );
          this.partnerDeals = new DBBackedArray(
            AppDataSource.getRepository(PartnerDeal),
            await AppDataSource.getRepository(PartnerDeal).find(),
          );
          this.organizationTrials = new DBBackedArray(
            AppDataSource.getRepository(OrganizationTrial),
            await AppDataSource.getRepository(OrganizationTrial).find(),
          );
          this.userLegalAcceptances = new DBBackedArray(
            AppDataSource.getRepository(UserLegalAcceptance),
            await AppDataSource.getRepository(UserLegalAcceptance).find(),
          );
          this.billingAccounts = new DBBackedArray(
            AppDataSource.getRepository(BillingAccount),
            await AppDataSource.getRepository(BillingAccount).find(),
          );
          this.billingPlans = new DBBackedArray(AppDataSource.getRepository(BillingPlan), await AppDataSource.getRepository(BillingPlan).find());
          this.billingPlanLimits = new DBBackedArray(
            AppDataSource.getRepository(BillingPlanLimit),
            await AppDataSource.getRepository(BillingPlanLimit).find(),
          );
          this.billingAddons = new DBBackedArray(
            AppDataSource.getRepository(BillingAddon),
            await AppDataSource.getRepository(BillingAddon).find(),
          );
          this.billingAddonPurchases = new DBBackedArray(
            AppDataSource.getRepository(BillingAddonPurchase),
            await AppDataSource.getRepository(BillingAddonPurchase).find(),
          );
          this.billingPlanProviderMappings = new DBBackedArray(
            AppDataSource.getRepository(BillingPlanProviderMapping),
            await AppDataSource.getRepository(BillingPlanProviderMapping).find(),
          );
          this.billingPlanFeatures = new DBBackedArray(
            AppDataSource.getRepository(BillingPlanFeature),
            await AppDataSource.getRepository(BillingPlanFeature).find(),
          );
          this.billingPromotions = new DBBackedArray(
            AppDataSource.getRepository(BillingPromotion),
            await AppDataSource.getRepository(BillingPromotion).find(),
          );
          this.billingCoupons = new DBBackedArray(
            AppDataSource.getRepository(BillingCoupon),
            await AppDataSource.getRepository(BillingCoupon).find(),
          );
          this.billingCouponPlans = new DBBackedArray(
            AppDataSource.getRepository(BillingCouponPlan),
            await AppDataSource.getRepository(BillingCouponPlan).find(),
          );
          this.billingCouponOrganizations = new DBBackedArray(
            AppDataSource.getRepository(BillingCouponOrganization),
            await AppDataSource.getRepository(BillingCouponOrganization).find(),
          );
          this.billingCouponRedemptions = new DBBackedArray(
            AppDataSource.getRepository(BillingCouponRedemption),
            await AppDataSource.getRepository(BillingCouponRedemption).find(),
          );
          this.billingSubscriptionDiscounts = new DBBackedArray(
            AppDataSource.getRepository(BillingSubscriptionDiscount),
            await AppDataSource.getRepository(BillingSubscriptionDiscount).find(),
          );
          this.organizationCoupons = new DBBackedArray(
            AppDataSource.getRepository(OrganizationCoupon),
            await AppDataSource.getRepository(OrganizationCoupon).find(),
          );
          this.organizationCouponAssignments = new DBBackedArray(
            AppDataSource.getRepository(OrganizationCouponAssignment),
            await AppDataSource.getRepository(OrganizationCouponAssignment).find(),
          );
          this.organizationCouponSettings = new DBBackedArray(
            AppDataSource.getRepository(OrganizationCouponSettings),
            await AppDataSource.getRepository(OrganizationCouponSettings).find(),
          );
          this.billingSubscriptions = new DBBackedArray(
            AppDataSource.getRepository(BillingSubscription),
            await AppDataSource.getRepository(BillingSubscription).find(),
          );
          this.billingPayments = new DBBackedArray(
            AppDataSource.getRepository(BillingPayment),
            await AppDataSource.getRepository(BillingPayment).find(),
          );
          this.billingPaymentEvents = new DBBackedArray(
            AppDataSource.getRepository(BillingPaymentEvent),
            await AppDataSource.getRepository(BillingPaymentEvent).find(),
          );
          this.billingRefunds = new DBBackedArray(
            AppDataSource.getRepository(BillingRefund),
            await AppDataSource.getRepository(BillingRefund).find(),
          );
          this.billingInvoices = new DBBackedArray(
            AppDataSource.getRepository(BillingInvoice),
            await AppDataSource.getRepository(BillingInvoice).find(),
          );
          this.assets = new DBBackedArray(AppDataSource.getRepository(Asset), await AppDataSource.getRepository(Asset).find());
          this.assetVersions = new DBBackedArray(
            AppDataSource.getRepository(AssetVersion),
            await AppDataSource.getRepository(AssetVersion).find(),
          );
          this.assetBundles = new DBBackedArray(
            AppDataSource.getRepository(AssetBundle),
            await AppDataSource.getRepository(AssetBundle).find(),
          );
          this.assetBundleItems = new DBBackedArray(
            AppDataSource.getRepository(AssetBundleItem),
            await AppDataSource.getRepository(AssetBundleItem).find(),
          );
          this.assetTags = new DBBackedArray(AppDataSource.getRepository(AssetTag), await AppDataSource.getRepository(AssetTag).find());
          this.affiliateAssetActivities = new DBBackedArray(
            AppDataSource.getRepository(AffiliateAssetActivity),
            await AppDataSource.getRepository(AffiliateAssetActivity).find(),
          );
          this.affiliateAssetFavorites = new DBBackedArray(
            AppDataSource.getRepository(AffiliateAssetFavorite),
            await AppDataSource.getRepository(AffiliateAssetFavorite).find(),
          );
          this.partnerTiers = new DBBackedArray(
            AppDataSource.getRepository(PartnerTier),
            await AppDataSource.getRepository(PartnerTier).find(),
          );
          this.affiliateTiers = new DBBackedArray(
            AppDataSource.getRepository(AffiliateTier),
            await AppDataSource.getRepository(AffiliateTier).find(),
          );
          this.affiliateTierHistories = new DBBackedArray(
            AppDataSource.getRepository(AffiliateTierHistory),
            await AppDataSource.getRepository(AffiliateTierHistory).find(),
          );
          this.milestones = new DBBackedArray(
            AppDataSource.getRepository(Milestone),
            await AppDataSource.getRepository(Milestone).find(),
          );
          this.affiliateMilestoneAchievements = new DBBackedArray(
            AppDataSource.getRepository(AffiliateMilestoneAchievement),
            await AppDataSource.getRepository(AffiliateMilestoneAchievement).find(),
          );
          this.affiliatePerformanceSummaries = new DBBackedArray(
            AppDataSource.getRepository(AffiliatePerformanceSummary),
            await AppDataSource.getRepository(AffiliatePerformanceSummary).find(),
          );
          this.automationWorkflows = new DBBackedArray(
            AppDataSource.getRepository(AutomationWorkflow),
            await AppDataSource.getRepository(AutomationWorkflow).find(),
          );
          this.automationWorkflowVersions = new DBBackedArray(
            AppDataSource.getRepository(AutomationWorkflowVersion),
            await AppDataSource.getRepository(AutomationWorkflowVersion).find(),
          );
          this.automationExecutions = new DBBackedArray(
            AppDataSource.getRepository(AutomationExecution),
            await AppDataSource.getRepository(AutomationExecution).find(),
          );
          this.automationScheduledSteps = new DBBackedArray(
            AppDataSource.getRepository(AutomationScheduledStep),
            await AppDataSource.getRepository(AutomationScheduledStep).find(),
          );
          this.automationEmailTemplates = new DBBackedArray(
            AppDataSource.getRepository(AutomationEmailTemplate),
            await AppDataSource.getRepository(AutomationEmailTemplate).find(),
          );
          this.emailDesignTemplates = new DBBackedArray(
            AppDataSource.getRepository(EmailDesignTemplate),
            await AppDataSource.getRepository(EmailDesignTemplate).find(),
          );
          this.emailDesignSettings = new DBBackedArray(
            AppDataSource.getRepository(EmailDesignSettings),
            await AppDataSource.getRepository(EmailDesignSettings).find(),
          );
          this.documentDesignTemplates = new DBBackedArray(
            AppDataSource.getRepository(DocumentDesignTemplate),
            await AppDataSource.getRepository(DocumentDesignTemplate).find(),
          );
          this.documentTemplateVersions = new DBBackedArray(
            AppDataSource.getRepository(DocumentTemplateVersion),
            await AppDataSource.getRepository(DocumentTemplateVersion).find(),
          );
          this.generatedDocuments = new DBBackedArray(
            AppDataSource.getRepository(GeneratedDocument),
            await AppDataSource.getRepository(GeneratedDocument).find(),
          );
          this.automationEmailLogs = new DBBackedArray(
            AppDataSource.getRepository(AutomationEmailLog),
            await AppDataSource.getRepository(AutomationEmailLog).find(),
          );
          this.emailTemplateVersions = new DBBackedArray(
            AppDataSource.getRepository(EmailTemplateVersion),
            await AppDataSource.getRepository(EmailTemplateVersion).find(),
          );
          this.emailTemplateOverrides = new DBBackedArray(
            AppDataSource.getRepository(EmailTemplateOverride),
            await AppDataSource.getRepository(EmailTemplateOverride).find(),
          );
          this.emailDeliveryLogs = new DBBackedArray(
            AppDataSource.getRepository(EmailDeliveryLog),
            await AppDataSource.getRepository(EmailDeliveryLog).find(),
          );
          this.emailSuppressions = new DBBackedArray(
            AppDataSource.getRepository(EmailSuppression),
            await AppDataSource.getRepository(EmailSuppression).find(),
          );
          this.roles = new DBBackedArray(AppDataSource.getRepository(RoleDefinition), await AppDataSource.getRepository(RoleDefinition).find());
          this.permissions = new DBBackedArray(AppDataSource.getRepository(PermissionDefinition), await AppDataSource.getRepository(PermissionDefinition).find());
          this.rolePermissions = new DBBackedArray(AppDataSource.getRepository(RolePermission), await AppDataSource.getRepository(RolePermission).find());
          this.organizationPolicies = new DBBackedArray(AppDataSource.getRepository(OrganizationPolicy), await AppDataSource.getRepository(OrganizationPolicy).find());
          this.organizationInvitations = new DBBackedArray(AppDataSource.getRepository(OrganizationInvitation), await AppDataSource.getRepository(OrganizationInvitation).find());
          this.platformSettings = new DBBackedArray(AppDataSource.getRepository(PlatformSetting), await AppDataSource.getRepository(PlatformSetting).find());
          this.organizationBrandings = new DBBackedArray(AppDataSource.getRepository(OrganizationBranding), await AppDataSource.getRepository(OrganizationBranding).find());
          this.blogPosts = new DBBackedArray(AppDataSource.getRepository(BlogPost), await AppDataSource.getRepository(BlogPost).find());
          this.securityEvents = new DBBackedArray(AppDataSource.getRepository(SecurityEvent), await AppDataSource.getRepository(SecurityEvent).find());
          this.securitySignals = new DBBackedArray(AppDataSource.getRepository(SecuritySignal), await AppDataSource.getRepository(SecuritySignal).find());
          this.securityAlerts = new DBBackedArray(AppDataSource.getRepository(SecurityAlert), await AppDataSource.getRepository(SecurityAlert).find());
          this.securityInvestigations = new DBBackedArray(AppDataSource.getRepository(SecurityInvestigation), await AppDataSource.getRepository(SecurityInvestigation).find());
          this.securityIncidents = new DBBackedArray(AppDataSource.getRepository(SecurityIncident), await AppDataSource.getRepository(SecurityIncident).find());
          this.securityRules = new DBBackedArray(AppDataSource.getRepository(SecurityRule), await AppDataSource.getRepository(SecurityRule).find());
          this.securityRuleVersions = new DBBackedArray(AppDataSource.getRepository(SecurityRuleVersion), await AppDataSource.getRepository(SecurityRuleVersion).find());
          this.securityActions = new DBBackedArray(AppDataSource.getRepository(SecurityAction), await AppDataSource.getRepository(SecurityAction).find());
          this.securityExceptions = new DBBackedArray(AppDataSource.getRepository(SecurityException), await AppDataSource.getRepository(SecurityException).find());
          this.apiRequests = new DBBackedArray(AppDataSource.getRepository(ApiRequest), await AppDataSource.getRepository(ApiRequest).find());
          this.apiExternalCalls = new DBBackedArray(AppDataSource.getRepository(ApiExternalCall), await AppDataSource.getRepository(ApiExternalCall).find());
          this.apiErrorGroups = new DBBackedArray(AppDataSource.getRepository(ApiErrorGroup), await AppDataSource.getRepository(ApiErrorGroup).find());
          this.apiRateLimitQuotas = new DBBackedArray(AppDataSource.getRepository(ApiRateLimitQuota), await AppDataSource.getRepository(ApiRateLimitQuota).find());
          this.apiActivityAudits = new DBBackedArray(AppDataSource.getRepository(ApiActivityAudit), await AppDataSource.getRepository(ApiActivityAudit).find());
          this.apiActivityExceptions = new DBBackedArray(AppDataSource.getRepository(ApiActivityException), await AppDataSource.getRepository(ApiActivityException).find());
          this.webhookEndpointRecords = new DBBackedArray(AppDataSource.getRepository(WebhookEndpointRecord), await AppDataSource.getRepository(WebhookEndpointRecord).find());
          this.webhookEventRecords = new DBBackedArray(AppDataSource.getRepository(WebhookEventRecord), await AppDataSource.getRepository(WebhookEventRecord).find());
          this.webhookDeliveryRecords = new DBBackedArray(AppDataSource.getRepository(WebhookDeliveryRecord), await AppDataSource.getRepository(WebhookDeliveryRecord).find());
          this.webhookDeliveryAttemptRecords = new DBBackedArray(AppDataSource.getRepository(WebhookDeliveryAttemptRecord), await AppDataSource.getRepository(WebhookDeliveryAttemptRecord).find());
          this.webhookEventTypeDefinitions = new DBBackedArray(AppDataSource.getRepository(WebhookEventTypeDefinition), await AppDataSource.getRepository(WebhookEventTypeDefinition).find());
          this.webhookDeadLetterRecords = new DBBackedArray(AppDataSource.getRepository(WebhookDeadLetterRecord), await AppDataSource.getRepository(WebhookDeadLetterRecord).find());
          this.webhookSecurityIncidents = new DBBackedArray(AppDataSource.getRepository(WebhookSecurityIncidentRecord), await AppDataSource.getRepository(WebhookSecurityIncidentRecord).find());
          this.webhookExceptions = new DBBackedArray(AppDataSource.getRepository(WebhookExceptionRecord), await AppDataSource.getRepository(WebhookExceptionRecord).find());
          this.webhookAuditRecords = new DBBackedArray(AppDataSource.getRepository(WebhookAuditRecord), await AppDataSource.getRepository(WebhookAuditRecord).find());
          this.systemMonitoredServices = new DBBackedArray(AppDataSource.getRepository(SystemMonitoredService), await AppDataSource.getRepository(SystemMonitoredService).find());
          this.systemHealthCheckResults = new DBBackedArray(AppDataSource.getRepository(SystemHealthCheckResult), await AppDataSource.getRepository(SystemHealthCheckResult).find());
          this.systemIncidents = new DBBackedArray(AppDataSource.getRepository(SystemIncident), await AppDataSource.getRepository(SystemIncident).find());
          this.systemServiceDependencies = new DBBackedArray(AppDataSource.getRepository(SystemServiceDependency), await AppDataSource.getRepository(SystemServiceDependency).find());
          this.systemDeploymentRecords = new DBBackedArray(AppDataSource.getRepository(SystemDeploymentRecord), await AppDataSource.getRepository(SystemDeploymentRecord).find());
          this.systemMaintenanceWindows = new DBBackedArray(AppDataSource.getRepository(SystemMaintenanceWindow), await AppDataSource.getRepository(SystemMaintenanceWindow).find());
          try {
            this.queueRecords = new DBBackedArray(AppDataSource.getRepository(QueueRecord), await AppDataSource.getRepository(QueueRecord).find());
            this.workerRecords = new DBBackedArray(AppDataSource.getRepository(WorkerRecord), await AppDataSource.getRepository(WorkerRecord).find());
            this.jobRecords = new DBBackedArray(AppDataSource.getRepository(JobRecord), await AppDataSource.getRepository(JobRecord).find());
            this.jobAttemptRecords = new DBBackedArray(AppDataSource.getRepository(JobAttemptRecord), await AppDataSource.getRepository(JobAttemptRecord).find());
            this.scheduledJobRecords = new DBBackedArray(AppDataSource.getRepository(ScheduledJobRecord), await AppDataSource.getRepository(ScheduledJobRecord).find());
            this.deadLetterRecords = new DBBackedArray(AppDataSource.getRepository(DeadLetterRecord), await AppDataSource.getRepository(DeadLetterRecord).find());
            this.jobExceptionRecords = new DBBackedArray(AppDataSource.getRepository(JobExceptionRecord), await AppDataSource.getRepository(JobExceptionRecord).find());
            this.jobSettingsRecords = new DBBackedArray(AppDataSource.getRepository(JobSettingsRecord), await AppDataSource.getRepository(JobSettingsRecord).find());
            this.featureFlags = new DBBackedArray(AppDataSource.getRepository(FeatureFlag), await AppDataSource.getRepository(FeatureFlag).find());
            this.featureFlagEnvironments = new DBBackedArray(AppDataSource.getRepository(FeatureFlagEnvironment), await AppDataSource.getRepository(FeatureFlagEnvironment).find());
            this.featureFlagRules = new DBBackedArray(AppDataSource.getRepository(FeatureFlagRule), await AppDataSource.getRepository(FeatureFlagRule).find());
            this.featureFlagOverrides = new DBBackedArray(AppDataSource.getRepository(FeatureFlagOverride), await AppDataSource.getRepository(FeatureFlagOverride).find());
            this.featureFlagVersions = new DBBackedArray(AppDataSource.getRepository(FeatureFlagVersion), await AppDataSource.getRepository(FeatureFlagVersion).find());
            this.featureFlagDependencies = new DBBackedArray(AppDataSource.getRepository(FeatureFlagDependency), await AppDataSource.getRepository(FeatureFlagDependency).find());
            this.featureFlagMetrics = new DBBackedArray(AppDataSource.getRepository(FeatureFlagEvaluationMetric), await AppDataSource.getRepository(FeatureFlagEvaluationMetric).find());
            this.featureFlagSettingsRecords = new DBBackedArray(AppDataSource.getRepository(FeatureFlagSettingsRecord), await AppDataSource.getRepository(FeatureFlagSettingsRecord).find());
            this.organizationSettings = new DBBackedArray(AppDataSource.getRepository(OrganizationSettings), await AppDataSource.getRepository(OrganizationSettings).find());
          } catch {
            // In-memory fallback if schema migration not yet run
          }


          // Preload default affiliate eligibility setting if not present
          if (!this.platformSettings.some((s) => s.key === 'affiliateEligibility.allowOrganizationMembers')) {
            const defaultSetting = new PlatformSetting();
            defaultSetting.id = uuidv4();
            defaultSetting.key = 'affiliateEligibility.allowOrganizationMembers';
            defaultSetting.value = false;
            defaultSetting.description = 'Allow organization users to become affiliates';
            defaultSetting.createdAt = new Date();
            defaultSetting.updatedAt = new Date();
            this.platformSettings.push(defaultSetting);
          }

          this.initialized = true;
        }

        reset() {
          for (const key of Object.keys(this)) {
            const val = (this as any)[key];
            if (Array.isArray(val)) {
              val.length = 0;
            }
          }
        }
      }

      export const dbStore = InMemoryDataStore.instance;

      export function resetDbStore() {
        dbStore.reset();
      }

/**
 * Waits for an entity's most recent database write (from a property assignment, `push`,
 * `unshift`, or `splice` through the dbStore proxy) to actually land before continuing.
 * Call this after mutating an entity and before a service method returns, so the HTTP
 * response only confirms success once the change is durable — instead of the write racing
 * in the background where a failure would surface only as a console.error, with the
 * in-memory copy and the real database silently disagreeing from then on.
 *
 * No-ops harmlessly when there is nothing pending (memory-only test runs, or an entity that
 * was never wrapped by dbStore, e.g. a fresh plain object before its first push/set).
 */
export async function awaitPersist<T>(entity: T): Promise<T> {
  const pending = (entity as any)?.__pendingPersist;
  if (pending && typeof pending.then === 'function') {
    await pending;
  }
  return entity;
}
