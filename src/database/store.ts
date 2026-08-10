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
  Organization,
  OrganizationMembership,
  AuthSession,
  Program,
  Affiliate,
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
  PayoutBatch,
  PayoutItem,
  WebhookEndpoint,
  WebhookDelivery,
  AuditLog,
  PublicKey,
  Integration,
  OrganizationIntegration,
  IntegrationCredential,
  IntegrationEvent,
  IntegrationOAuthState,
} from './schema';
import {
  RoleDefinition,
  PermissionDefinition,
  RolePermission,
  OrganizationPolicy,
  OrganizationInvitation,
} from './schema-rbac';

export type UserEntity = User;
export type OrganizationEntity = Organization;
export type OrganizationMembershipEntity = OrganizationMembership;
export type AuthSessionEntity = AuthSession;
export type ProgramEntity = Program;
export type AffiliateEntity = Affiliate;
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
export type PayoutBatchEntity = PayoutBatch;
export type PayoutItemEntity = PayoutItem;
export type WebhookEndpointEntity = WebhookEndpoint;
export type WebhookDeliveryEntity = WebhookDelivery;
export type AuditLogEntity = AuditLog;
export type PublicKeyEntity = PublicKey;
export type IntegrationEntity = Integration;
export type OrganizationIntegrationEntity = OrganizationIntegration;
export type IntegrationCredentialEntity = IntegrationCredential;
export type IntegrationEventEntity = IntegrationEvent;
export type IntegrationOAuthStateEntity = IntegrationOAuthState;
export type RoleDefinitionEntity = import('./schema-rbac').RoleDefinition;
export type PermissionDefinitionEntity = import('./schema-rbac').PermissionDefinition;
export type RolePermissionEntity = import('./schema-rbac').RolePermission;
export type OrganizationPolicyEntity = import('./schema-rbac').OrganizationPolicy;
export type OrganizationInvitationEntity = import('./schema-rbac').OrganizationInvitation;

class DBBackedArray<T extends object> extends Array<T> {
  private repo: Repository<T>;

  private persist(items: T | T[]) {
    const values = Array.isArray(items) ? items : [items];
    this.repo.upsert(values, ['id'] as any).catch((err) => {
      console.error('dbStore save error:', err);
    });
  }

  constructor(repo: Repository<T>, items: T[] = []) {
    super(...items.map((item) => DBBackedArray.wrapEntity(repo, item)));
    Object.setPrototypeOf(this, DBBackedArray.prototype);
    this.repo = repo;
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

    const proxy = new Proxy(item, {
      set(target, property, value) {
        const result = Reflect.set(target, property, value);
        if (property !== 'id') {
          repo.upsert(target as T, ['id'] as any).catch((err) => {
            console.error('dbStore save error:', err);
          });
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
    return removed;
  }
}

export class InMemoryDataStore {
  static instance = new InMemoryDataStore();

  private initialized = false;

  users: UserEntity[] = [];
  organizations: OrganizationEntity[] = [];
  organizationMemberships: OrganizationMembershipEntity[] = [];
  authSessions: AuthSessionEntity[] = [];
  programs: ProgramEntity[] = [];
  affiliates: AffiliateEntity[] = [];
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
  payoutBatches: PayoutBatchEntity[] = [];
  payoutItems: PayoutItemEntity[] = [];
  webhookEndpoints: WebhookEndpointEntity[] = [];
  webhookDeliveries: WebhookDeliveryEntity[] = [];
  auditLogs: AuditLogEntity[] = [];
  publicKeys: PublicKeyEntity[] = [];
  integrations: IntegrationEntity[] = [];
  organizationIntegrations: OrganizationIntegrationEntity[] = [];
  integrationCredentials: IntegrationCredentialEntity[] = [];
  integrationEvents: IntegrationEventEntity[] = [];
  integrationOAuthStates: IntegrationOAuthStateEntity[] = [];
  roles: RoleDefinitionEntity[] = [];
  permissions: PermissionDefinitionEntity[] = [];
  rolePermissions: RolePermissionEntity[] = [];
  organizationPolicies: OrganizationPolicyEntity[] = [];
  organizationInvitations: OrganizationInvitationEntity[] = [];

  // Counter maps for Redis rate-limit/fraud tracking
  ipClickCounters: Map<string, { count: number; expiresAt: number }> = new Map();
  affiliateClickCounters: Map<string, { count: number; expiresAt: number }> = new Map();

  async initialize() {
    if (this.initialized) {
      return;
    }

    await initializeDataSource();

    this.users = new DBBackedArray(AppDataSource.getRepository(User), await AppDataSource.getRepository(User).find());
    this.organizations = new DBBackedArray(
      AppDataSource.getRepository(Organization),
      await AppDataSource.getRepository(Organization).find(),
    );
    this.organizationMemberships = new DBBackedArray(
      AppDataSource.getRepository(OrganizationMembership),
      await AppDataSource.getRepository(OrganizationMembership).find(),
    );
    this.authSessions = new DBBackedArray(AppDataSource.getRepository(AuthSession), await AppDataSource.getRepository(AuthSession).find());
    this.programs = new DBBackedArray(AppDataSource.getRepository(Program), await AppDataSource.getRepository(Program).find());
    this.affiliates = new DBBackedArray(AppDataSource.getRepository(Affiliate), await AppDataSource.getRepository(Affiliate).find());
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
    this.roles = new DBBackedArray(AppDataSource.getRepository(RoleDefinition), await AppDataSource.getRepository(RoleDefinition).find());
    this.permissions = new DBBackedArray(AppDataSource.getRepository(PermissionDefinition), await AppDataSource.getRepository(PermissionDefinition).find());
    this.rolePermissions = new DBBackedArray(AppDataSource.getRepository(RolePermission), await AppDataSource.getRepository(RolePermission).find());
    this.organizationPolicies = new DBBackedArray(AppDataSource.getRepository(OrganizationPolicy), await AppDataSource.getRepository(OrganizationPolicy).find());
    this.organizationInvitations = new DBBackedArray(AppDataSource.getRepository(OrganizationInvitation), await AppDataSource.getRepository(OrganizationInvitation).find());

    this.initialized = true;
  }
}

export const dbStore = InMemoryDataStore.instance;
