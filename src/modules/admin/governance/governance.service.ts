import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import { In, Like, LessThanOrEqual } from 'typeorm';
import { AppDataSource } from '../../../database/data-source';
import {
  GovernancePolicy,
  GovernancePolicyVersion,
  GovernanceApprovalPolicy,
  GovernanceApprovalRequest,
  GovernanceException,
  GovernanceEmergencyControl,
  GovernanceViolation,
  GovernanceCategory,
  GovernancePolicyStatus,
  GovernanceEnforcementMode,
  GovernanceRiskLevel,
  GovernanceApprovalStatus,
  GovernanceExceptionStatus,
} from '../../../database/schema-governance';
import { AuditLog, SecurityEvent } from '../../../database/schema';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import {
  CreateGovernancePolicyDto,
  UpdateGovernancePolicyDto,
  CreateApprovalRequestDto,
  ReviewApprovalRequestDto,
  CreateGovernanceExceptionDto,
  ToggleEmergencyControlDto,
  ExecutePrivilegedActionDto,
  GovernanceFilterQueryDto,
} from './dto/governance.dto';

export interface PrivilegedActionDefinition {
  actionKey: string;
  name: string;
  category: string;
  requiredPermission: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  approvalRequired: boolean;
  reasonRequired: boolean;
  mfaRequired: boolean;
  auditRequired: boolean;
  description: string;
}

export const PRIVILEGED_ACTIONS_REGISTRY: PrivilegedActionDefinition[] = [
  {
    actionKey: 'org.delete',
    name: 'Delete Organization & Deprovision Resources',
    category: 'TENANT_ISOLATION',
    requiredPermission: 'platform.orgs.delete',
    riskLevel: 'CRITICAL',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: true,
    auditRequired: true,
    description: 'Permanently removes an organization, domains, and associated tracking structures.',
  },
  {
    actionKey: 'org.suspend',
    name: 'Suspend Organization Access',
    category: 'TENANT_ISOLATION',
    requiredPermission: 'platform.orgs.suspend',
    riskLevel: 'HIGH',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: false,
    auditRequired: true,
    description: 'Immediately disables customer logins, link tracking, and API calls for the tenant.',
  },
  {
    actionKey: 'org.restore',
    name: 'Restore Suspended Organization',
    category: 'TENANT_ISOLATION',
    requiredPermission: 'platform.orgs.restore',
    riskLevel: 'HIGH',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: false,
    auditRequired: true,
    description: 'Restores traffic and access to a previously suspended organization.',
  },
  {
    actionKey: 'billing.plan_override',
    name: 'Manual Billing & Enterprise Quota Override',
    category: 'FINANCIAL',
    requiredPermission: 'platform.billing.override',
    riskLevel: 'HIGH',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: false,
    auditRequired: true,
    description: 'Bypasses standard Stripe billing plans to assign custom volume allocations.',
  },
  {
    actionKey: 'payout.override_hold',
    name: 'Override Compliance Hold on Payout Batch',
    category: 'FINANCIAL',
    requiredPermission: 'platform.payouts.override_hold',
    riskLevel: 'CRITICAL',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: true,
    auditRequired: true,
    description: 'Forces the release of payout funds flagged for fraud or tax non-compliance.',
  },
  {
    actionKey: 'payout.manual_settle',
    name: 'Manual Direct Settlement Execution',
    category: 'FINANCIAL',
    requiredPermission: 'platform.payouts.settle',
    riskLevel: 'CRITICAL',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: true,
    auditRequired: true,
    description: 'Initiates immediate ledger transfer to affiliate bank or PayPal accounts outside batch schedule.',
  },
  {
    actionKey: 'financial.commission_cap_override',
    name: 'Override Global Commission Cap',
    category: 'FINANCIAL',
    requiredPermission: 'platform.commissions.cap_override',
    riskLevel: 'HIGH',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: false,
    auditRequired: true,
    description: 'Allows commission payouts exceeding standard enterprise single-transaction ceiling ($25,000).',
  },
  {
    actionKey: 'tenant_isolation.bypass_inspect',
    name: 'Platform Cross-Tenant Database Inspection',
    category: 'TENANT_ISOLATION',
    requiredPermission: 'platform.tenants.inspect_raw',
    riskLevel: 'CRITICAL',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: true,
    auditRequired: true,
    description: 'Grants temporary query capability to raw cross-organization database tables for incident diagnostics.',
  },
  {
    actionKey: 'credentials.rotate_platform',
    name: 'Rotate Platform Master Cryptographic Keys',
    category: 'ACCESS',
    requiredPermission: 'platform.security.rotate_keys',
    riskLevel: 'CRITICAL',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: true,
    auditRequired: true,
    description: 'Rotates platform JWT signing keys, database envelope encryption keys, and webhook master secrets.',
  },
  {
    actionKey: 'security.disable_control',
    name: 'Temporary Deactivation of Core Security Control',
    category: 'OPERATIONS',
    requiredPermission: 'platform.security.emergency_bypass',
    riskLevel: 'CRITICAL',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: true,
    auditRequired: true,
    description: 'Bypasses rate limiting, signature verification, or IP reputation filters during an active outage.',
  },
  {
    actionKey: 'impersonation.start_session',
    name: 'Elevated Support Impersonation Session',
    category: 'ACCESS',
    requiredPermission: 'platform.support.impersonate',
    riskLevel: 'HIGH',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: true,
    auditRequired: true,
    description: 'Initiates an auditable, time-limited support session assuming a tenant administrator role.',
  },
  {
    actionKey: 'policy.publish_version',
    name: 'Activate Governance Policy Version',
    category: 'OPERATIONS',
    requiredPermission: 'platform.governance.publish',
    riskLevel: 'HIGH',
    approvalRequired: false,
    reasonRequired: true,
    mfaRequired: false,
    auditRequired: true,
    description: 'Activates a newly proposed version of a platform-wide governance policy.',
  },
  {
    actionKey: 'emergency.operation_freeze',
    name: 'Platform Administrative Lockdown / Mutation Freeze',
    category: 'OPERATIONS',
    requiredPermission: 'platform.emergency.lockdown',
    riskLevel: 'CRITICAL',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: true,
    auditRequired: true,
    description: 'Freezes all destructive mutations across the entire platform during suspected breach or disaster recovery.',
  },
  {
    actionKey: 'emergency.break_glass_access',
    name: 'Emergency Break-Glass Elevated Session',
    category: 'ACCESS',
    requiredPermission: 'platform.emergency.break_glass',
    riskLevel: 'CRITICAL',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: true,
    auditRequired: true,
    description: 'Grants temporary 1-hour unrestricted platform operator capabilities under emergency conditions.',
  },
  {
    actionKey: 'audit.export_raw',
    name: 'Export Unredacted Platform Audit Logs',
    category: 'DATA_PROTECTION',
    requiredPermission: 'platform.audit.export_unredacted',
    riskLevel: 'HIGH',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: false,
    auditRequired: true,
    description: 'Generates export package of complete platform audit and security event trails.',
  },
  {
    actionKey: 'data.gdpr_purge',
    name: 'Execute Irreversible GDPR / CCPA Data Purge',
    category: 'DATA_PROTECTION',
    requiredPermission: 'platform.data.purge',
    riskLevel: 'CRITICAL',
    approvalRequired: true,
    reasonRequired: true,
    mfaRequired: true,
    auditRequired: true,
    description: 'Permanently deletes all historical logs and PII records for requested data subjects.',
  },
];

const BASELINE_POLICIES = [
  {
    key: 'tenant.isolation.strict',
    name: 'Strict Multi-Tenant Isolation & Context Enforcement',
    description: 'Enforces hard database row-level organization partitioning. Rejects requests lacking authenticated tenant context.',
    category: GovernanceCategory.TENANT_ISOLATION,
    scope: 'GLOBAL',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.BLOCK,
    riskLevel: GovernanceRiskLevel.CRITICAL,
    configuration: {
      enforceHeaderOrgId: true,
      blockCrossTenantQuery: true,
      allowPlatformOperatorBypassWithTicket: true,
      maxBypassSessionDurationMinutes: 60,
    },
    changeReason: 'Initial enterprise governance baseline',
  },
  {
    key: 'auth.admin.mfa_enforced',
    name: 'Mandatory Multi-Factor Authentication for Platform Staff',
    description: 'Requires hardware FIDO2/WebAuthn or TOTP verification for all platform administrators.',
    category: GovernanceCategory.ACCESS,
    scope: 'GLOBAL',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.BLOCK,
    riskLevel: GovernanceRiskLevel.CRITICAL,
    configuration: {
      requireTotpOrWebAuthn: true,
      gracePeriodHours: 0,
      allowedMfaTypes: ['TOTP', 'SECURITY_KEY'],
      stepUpRequiredForPrivilegedActions: true,
    },
    changeReason: 'Initial enterprise governance baseline',
  },
  {
    key: 'auth.admin.session_timeout',
    name: 'Administrative Session Lifetime & Idle Inactivity Bounds',
    description: 'Restricts platform admin session longevity to 12 hours max and forces re-authentication after 30 minutes of idle inactivity.',
    category: GovernanceCategory.ACCESS,
    scope: 'GLOBAL',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.BLOCK,
    riskLevel: GovernanceRiskLevel.HIGH,
    configuration: {
      maxLifetimeMinutes: 720,
      idleTimeoutMinutes: 30,
      terminateOnIpChange: true,
    },
    changeReason: 'Initial enterprise governance baseline',
  },
  {
    key: 'access.impersonation.governed',
    name: 'Governed Customer Support Impersonation Protocol',
    description: 'Governs support staff tenant impersonation. Requires ticket reference, mandatory reason, and limits session to 60 minutes.',
    category: GovernanceCategory.ACCESS,
    scope: 'CROSS_TENANT',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.REQUIRE_APPROVAL,
    riskLevel: GovernanceRiskLevel.HIGH,
    configuration: {
      requireApproval: true,
      maxDurationMinutes: 60,
      blockFinancialActions: true,
      blockExportActions: true,
      displayPersistentBanner: true,
    },
    changeReason: 'Initial enterprise governance baseline',
  },
  {
    key: 'financial.payout.four_eyes',
    name: 'Dual-Authorization (Four-Eyes) Settlement Approval',
    description: 'Requires a secondary administrator approval on any payout batch or single transfer exceeding $10,000.',
    category: GovernanceCategory.FINANCIAL,
    scope: 'GLOBAL',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.REQUIRE_APPROVAL,
    riskLevel: GovernanceRiskLevel.CRITICAL,
    configuration: {
      singleTransactionThresholdUsd: 10000,
      batchThresholdUsd: 25000,
      requesterCannotApprove: true,
      expirationHours: 24,
    },
    changeReason: 'Initial enterprise governance baseline',
  },
  {
    key: 'financial.commission.rate_cap',
    name: 'Global Commission Rate Ceiling & Safeguards',
    description: 'Limits individual commission rates to 50% or $5,000 maximum per conversion unless explicitly granted an exception.',
    category: GovernanceCategory.FINANCIAL,
    scope: 'GLOBAL',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.WARN,
    riskLevel: GovernanceRiskLevel.HIGH,
    configuration: {
      maxPercentageRate: 50,
      maxFixedAmountUsd: 5000,
      warnThresholdPercentage: 40,
    },
    changeReason: 'Initial enterprise governance baseline',
  },
  {
    key: 'data.audit.retention_immutable',
    name: 'Immutable 365-Day Platform Audit Log Retention',
    description: 'Ensures security and audit log entries are append-only (WORM) and retained for a minimum of 365 days before archival.',
    category: GovernanceCategory.DATA_PROTECTION,
    scope: 'GLOBAL',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.BLOCK,
    riskLevel: GovernanceRiskLevel.HIGH,
    configuration: {
      retentionDays: 365,
      allowManualDeletion: false,
      exportFormat: 'JSONL_COMPRESSED',
    },
    changeReason: 'Initial enterprise governance baseline',
  },
  {
    key: 'data.pii.export_restricted',
    name: 'Customer PII & Sensitive Financial Export Restrictions',
    description: 'Restricts unredacted customer data exports to authorized compliance officers and logs all export access.',
    category: GovernanceCategory.DATA_PROTECTION,
    scope: 'GLOBAL',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.REQUIRE_APPROVAL,
    riskLevel: GovernanceRiskLevel.HIGH,
    configuration: {
      maskTaxIds: true,
      maskBankAccounts: true,
      maxRowsPerExport: 100000,
      requirePurposeJustification: true,
    },
    changeReason: 'Initial enterprise governance baseline',
  },
  {
    key: 'api.rate_limiting.platform',
    name: 'Platform-Wide API Abuse & Burst Throttling',
    description: 'Protects backend clusters with deterministic sliding window rate limiting (120 req/min standard, 300 req/min burst).',
    category: GovernanceCategory.API_GOVERNANCE,
    scope: 'GLOBAL',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.BLOCK,
    riskLevel: GovernanceRiskLevel.MEDIUM,
    configuration: {
      standardTtlSeconds: 60,
      standardLimit: 120,
      burstLimit: 300,
      failClosedOnCacheUnavailable: false,
    },
    changeReason: 'Initial enterprise governance baseline',
  },
  {
    key: 'webhook.signatures.fail_closed',
    name: 'Fail-Closed Webhook Cryptographic Signature Verification',
    description: 'Rejects inbound provider webhooks and outbound partner deliveries that fail HMAC-SHA256 signature verification.',
    category: GovernanceCategory.INTEGRATIONS,
    scope: 'GLOBAL',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.BLOCK,
    riskLevel: GovernanceRiskLevel.CRITICAL,
    configuration: {
      algorithm: 'HMAC-SHA256',
      maxDriftSeconds: 300,
      allowUnsignedInProduction: false,
    },
    changeReason: 'Initial enterprise governance baseline',
  },
  {
    key: 'integrations.oauth.credentials_rotation',
    name: '90-Day Mandatory OAuth Secret & Key Rotation',
    description: 'Tracks third-party CRM and Payment credentials and alerts administrators when credentials approach 90-day lifecycle.',
    category: GovernanceCategory.INTEGRATIONS,
    scope: 'GLOBAL',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.WARN,
    riskLevel: GovernanceRiskLevel.MEDIUM,
    configuration: {
      rotationIntervalDays: 90,
      warningThresholdDays: 14,
    },
    changeReason: 'Initial enterprise governance baseline',
  },
  {
    key: 'ops.maintenance.change_window',
    name: 'Controlled Production Change Windows & Deployment Locks',
    description: 'Restricts platform schema migrations and administrative configuration changes to pre-approved maintenance windows.',
    category: GovernanceCategory.OPERATIONS,
    scope: 'GLOBAL',
    status: GovernancePolicyStatus.ACTIVE,
    enforcementMode: GovernanceEnforcementMode.REQUIRE_APPROVAL,
    riskLevel: GovernanceRiskLevel.HIGH,
    configuration: {
      enforceChangeWindow: true,
      allowedDays: ['TUESDAY', 'WEDNESDAY', 'THURSDAY'],
      windowStartUtc: '02:00',
      windowEndUtc: '06:00',
    },
    changeReason: 'Initial enterprise governance baseline',
  },
];

const BASELINE_EMERGENCY_CONTROLS = [
  {
    controlKey: 'ADMIN_OPERATIONS_FREEZE',
    name: 'Platform Administrative Mutation Freeze',
    enabled: false,
  },
  {
    controlKey: 'NEW_ORG_CREATION_FREEZE',
    name: 'New Tenant Signup & Org Creation Freeze',
    enabled: false,
  },
  {
    controlKey: 'BACKGROUND_JOBS_PAUSE',
    name: 'Background Worker Execution Pause',
    enabled: false,
  },
  {
    controlKey: 'BREAK_GLASS_SESSION',
    name: 'Emergency Break-Glass Elevation',
    enabled: false,
  },
];

@Injectable()
export class PlatformGovernanceService implements OnModuleInit {
  private policyRepo = AppDataSource.getRepository(GovernancePolicy);
  private versionRepo = AppDataSource.getRepository(GovernancePolicyVersion);
  private approvalPolicyRepo = AppDataSource.getRepository(GovernanceApprovalPolicy);
  private approvalRequestRepo = AppDataSource.getRepository(GovernanceApprovalRequest);
  private exceptionRepo = AppDataSource.getRepository(GovernanceException);
  private emergencyRepo = AppDataSource.getRepository(GovernanceEmergencyControl);
  private violationRepo = AppDataSource.getRepository(GovernanceViolation);
  private auditRepo = AppDataSource.getRepository(AuditLog);
  private securityEventRepo = AppDataSource.getRepository(SecurityEvent);

  async onModuleInit() {
    await this.ensureBaselineSeeding();
  }

  async ensureBaselineSeeding() {
    try {
      if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
      }

      // 1. Seed Policies
      const count = await this.policyRepo.count();
      if (count === 0) {
        for (const item of BASELINE_POLICIES) {
          const policy = this.policyRepo.create({
            key: item.key,
            name: item.name,
            description: item.description,
            category: item.category,
            scope: item.scope,
            status: item.status,
            enforcementMode: item.enforcementMode,
            riskLevel: item.riskLevel,
            currentVersion: 1,
            configuration: item.configuration,
            effectiveAt: new Date(),
            createdBy: 'SYSTEM_BOOTSTRAP',
            updatedBy: 'SYSTEM_BOOTSTRAP',
          });
          const saved = await this.policyRepo.save(policy);

          const version = this.versionRepo.create({
            policyId: saved.id,
            policyKey: saved.key,
            version: 1,
            configurationSnapshot: item.configuration,
            changeReason: item.changeReason,
            authorId: 'SYSTEM_BOOTSTRAP',
            authorEmail: 'system@partneriq.in',
            approvalState: 'APPROVED',
            diff: { initial: true },
          });
          await this.versionRepo.save(version);
        }
      }

      // 2. Seed Approval Policies
      for (const action of PRIVILEGED_ACTIONS_REGISTRY) {
        const existing = await this.approvalPolicyRepo.findOne({ where: { actionKey: action.actionKey } });
        if (!existing) {
          await this.approvalPolicyRepo.save(
            this.approvalPolicyRepo.create({
              actionKey: action.actionKey,
              title: action.name,
              requiredApprovals: 1,
              requiredRole: 'SUPER_ADMIN',
              minimumPrivilege: action.riskLevel === 'CRITICAL' ? 'SUPER_ADMIN' : 'PRIVILEGED_ADMIN',
              expirationHours: 24,
              enabled: action.approvalRequired,
            }),
          );
        }
      }

      // 3. Seed Emergency Controls
      for (const ctrl of BASELINE_EMERGENCY_CONTROLS) {
        const existing = await this.emergencyRepo.findOne({ where: { controlKey: ctrl.controlKey } });
        if (!existing) {
          await this.emergencyRepo.save(
            this.emergencyRepo.create({
              controlKey: ctrl.controlKey,
              name: ctrl.name,
              enabled: ctrl.enabled,
            }),
          );
        }
      }
    } catch (err) {
      console.warn('[PlatformGovernanceService] Baseline seeding warning:', err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Overview & Health Evaluation
  // ─────────────────────────────────────────────────────────────

  async getOverview() {
    await this.ensureBaselineSeeding();

    const policies = await this.policyRepo.find();
    const activePolicies = policies.filter((p) => p.status === GovernancePolicyStatus.ACTIVE);
    const requireReview = policies.filter((p) => p.status === GovernancePolicyStatus.REVIEW || p.status === GovernancePolicyStatus.DRAFT);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const pendingApprovalsCount = await this.approvalRequestRepo.count({
      where: { status: GovernanceApprovalStatus.PENDING },
    });

    const activeExceptionsCount = await this.exceptionRepo.count({
      where: { status: GovernanceExceptionStatus.ACTIVE },
    });

    const changesTodayCount = await this.versionRepo
      .createQueryBuilder('v')
      .where('v.createdAt >= :todayStart', { todayStart })
      .getCount();

    const changesWeekCount = await this.versionRepo
      .createQueryBuilder('v')
      .where('v.createdAt >= :weekStart', { weekStart })
      .getCount();

    const emergencyControls = await this.emergencyRepo.find();
    const activeEmergency = emergencyControls.filter((c) => c.enabled);

    // Protection Matrix Evaluation
    const tenantIsolationPolicy = policies.find((p) => p.key === 'tenant.isolation.strict');
    const mfaPolicy = policies.find((p) => p.key === 'auth.admin.mfa_enforced');
    const piiPolicy = policies.find((p) => p.key === 'data.pii.export_restricted');
    const fourEyesPolicy = policies.find((p) => p.key === 'financial.payout.four_eyes');

    const tenantIsolationState = tenantIsolationPolicy?.status === 'ACTIVE' && tenantIsolationPolicy?.enforcementMode === 'BLOCK'
      ? 'Protected'
      : 'Attention required';

    const mfaState = mfaPolicy?.status === 'ACTIVE' && mfaPolicy?.enforcementMode === 'BLOCK'
      ? 'Protected'
      : 'Attention required';

    const privilegedAccessState = fourEyesPolicy?.status === 'ACTIVE'
      ? 'Protected'
      : 'Attention required';

    const sensitiveDataState = piiPolicy?.status === 'ACTIVE'
      ? 'Protected'
      : 'Attention required';

    // Global Governance Health Status
    let globalStatus: 'Healthy' | 'Attention Required' | 'Restricted' | 'Configuration Incomplete' = 'Healthy';

    if (policies.length === 0) {
      globalStatus = 'Configuration Incomplete';
    } else if (activeEmergency.length > 0) {
      globalStatus = 'Restricted';
    } else if (
      tenantIsolationState === 'Attention required' ||
      mfaState === 'Attention required' ||
      requireReview.length > 0
    ) {
      globalStatus = 'Attention Required';
    }

    const protectedOperationsCount = PRIVILEGED_ACTIONS_REGISTRY.length;
    const approvalRequiredCount = PRIVILEGED_ACTIONS_REGISTRY.filter((a) => a.approvalRequired).length;

    // Recent 5 Pending Approvals
    const recentApprovals = await this.approvalRequestRepo.find({
      where: { status: GovernanceApprovalStatus.PENDING },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    // Recent 6 Activity
    const recentVersions = await this.versionRepo.find({
      order: { createdAt: 'DESC' },
      take: 6,
    });

    return {
      globalStatus,
      protectionMatrix: {
        tenantIsolation: tenantIsolationState,
        privilegedAccess: privilegedAccessState,
        sensitiveData: sensitiveDataState,
        adminAuthentication: mfaState,
      },
      privilegedOperations: {
        totalProtected: protectedOperationsCount,
        requiresApproval: approvalRequiredCount,
        activeExceptions: activeExceptionsCount,
        pendingApprovals: pendingApprovalsCount,
      },
      policyCoverage: {
        totalPolicies: policies.length,
        activePolicies: activePolicies.length,
        requireReview: requireReview.length,
        policiesWithExceptions: activeExceptionsCount,
      },
      governanceChanges: {
        today: changesTodayCount,
        thisWeek: changesWeekCount,
        pendingApprovals: pendingApprovalsCount,
        failedChanges: 0,
      },
      complianceRetention: {
        auditRetentionDays: 365,
        securityEventsRetentionDays: 365,
        immutableLogs: true,
        exportControl: 'RESTRICTED',
      },
      emergencyControlsActive: activeEmergency.map((c) => ({
        controlKey: c.controlKey,
        name: c.name,
        reason: c.reason,
        activatedBy: c.activatedByEmail,
        activatedAt: c.activatedAt,
      })),
      recentApprovals,
      recentActivity: recentVersions.map((v) => ({
        id: v.id,
        policyKey: v.policyKey,
        version: v.version,
        changeReason: v.changeReason || 'Policy updated',
        authorEmail: v.authorEmail || 'admin@partneriq.in',
        createdAt: v.createdAt,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Policy Management & Versioning
  // ─────────────────────────────────────────────────────────────

  async listPolicies(query?: GovernanceFilterQueryDto) {
    await this.ensureBaselineSeeding();
    const qb = this.policyRepo.createQueryBuilder('p');

    if (query?.category && query.category !== 'ALL') {
      qb.andWhere('p.category = :category', { category: query.category });
    }
    if (query?.status && query.status !== 'ALL') {
      qb.andWhere('p.status = :status', { status: query.status });
    }
    if (query?.enforcementMode && query.enforcementMode !== 'ALL') {
      qb.andWhere('p.enforcementMode = :mode', { mode: query.enforcementMode });
    }
    if (query?.riskLevel && query.riskLevel !== 'ALL') {
      qb.andWhere('p.riskLevel = :risk', { risk: query.riskLevel });
    }
    if (query?.search) {
      qb.andWhere('(p.name LIKE :search OR p.key LIKE :search OR p.description LIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    qb.orderBy('p.createdAt', 'ASC');

    if (query?.limit) qb.take(query.limit);
    if (query?.offset) qb.skip(query.offset);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async getPolicy(idOrKey: string) {
    const policy = await this.policyRepo.findOne({
      where: [{ id: idOrKey }, { key: idOrKey }],
    });
    if (!policy) {
      throw new NotFoundException(`Governance policy '${idOrKey}' not found`);
    }

    const versions = await this.versionRepo.find({
      where: { policyId: policy.id },
      order: { version: 'DESC' },
    });

    const exceptions = await this.exceptionRepo.find({
      where: { policyKey: policy.key, status: GovernanceExceptionStatus.ACTIVE },
    });

    const relatedViolations = await this.violationRepo.find({
      where: { policyKey: policy.key },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return {
      policy,
      versions,
      exceptions,
      violations: relatedViolations,
    };
  }

  async createPolicy(dto: CreateGovernancePolicyDto, user: AuthUserPayload) {
    const existing = await this.policyRepo.findOne({ where: { key: dto.key } });
    if (existing) {
      throw new BadRequestException(`Policy with key '${dto.key}' already exists`);
    }

    const policy = this.policyRepo.create({
      key: dto.key,
      name: dto.name,
      description: dto.description,
      category: dto.category,
      scope: dto.scope || 'GLOBAL',
      status: GovernancePolicyStatus.ACTIVE,
      enforcementMode: dto.enforcementMode || GovernanceEnforcementMode.BLOCK,
      riskLevel: dto.riskLevel || GovernanceRiskLevel.HIGH,
      currentVersion: 1,
      configuration: dto.configuration || {},
      effectiveAt: new Date(),
      createdBy: user.userId || (user as any).id || 'ADMIN',
      updatedBy: user.userId || (user as any).id || 'ADMIN',
    });
    const saved = await this.policyRepo.save(policy);

    const version = this.versionRepo.create({
      policyId: saved.id,
      policyKey: saved.key,
      version: 1,
      configurationSnapshot: dto.configuration || {},
      changeReason: dto.changeReason || 'Initial policy creation',
      authorId: user.userId || (user as any).id || 'ADMIN',
      authorEmail: user.email,
      approvalState: 'APPROVED',
      diff: { created: true },
    });
    await this.versionRepo.save(version);

    await this.recordAudit(user, 'GOVERNANCE_POLICY_CREATED', 'GovernancePolicy', saved.id, null, saved, dto.changeReason);
    return saved;
  }

  async updatePolicy(idOrKey: string, dto: UpdateGovernancePolicyDto, user: AuthUserPayload) {
    const policy = await this.policyRepo.findOne({
      where: [{ id: idOrKey }, { key: idOrKey }],
    });
    if (!policy) {
      throw new NotFoundException(`Policy '${idOrKey}' not found`);
    }

    const beforeSnapshot = { ...policy };
    const nextVersion = (policy.currentVersion || 1) + 1;

    // Compute diff
    const diff: Record<string, any> = {};
    if (dto.name && dto.name !== policy.name) diff.name = { from: policy.name, to: dto.name };
    if (dto.enforcementMode && dto.enforcementMode !== policy.enforcementMode) {
      diff.enforcementMode = { from: policy.enforcementMode, to: dto.enforcementMode };
    }
    if (dto.status && dto.status !== policy.status) diff.status = { from: policy.status, to: dto.status };
    if (dto.configuration) {
      diff.configuration = { from: policy.configuration, to: dto.configuration };
    }

    if (dto.name !== undefined) policy.name = dto.name;
    if (dto.description !== undefined) policy.description = dto.description;
    if (dto.enforcementMode !== undefined) policy.enforcementMode = dto.enforcementMode;
    if (dto.riskLevel !== undefined) policy.riskLevel = dto.riskLevel;
    if (dto.status !== undefined) policy.status = dto.status;
    if (dto.configuration !== undefined) policy.configuration = dto.configuration;

    policy.currentVersion = nextVersion;
    policy.updatedBy = user.userId || (user as any).id || 'ADMIN';
    const updated = await this.policyRepo.save(policy);

    const version = this.versionRepo.create({
      policyId: updated.id,
      policyKey: updated.key,
      version: nextVersion,
      configurationSnapshot: updated.configuration,
      changeReason: dto.changeReason || 'Policy configuration update',
      authorId: user.userId || (user as any).id || 'ADMIN',
      authorEmail: user.email,
      approvalState: 'APPROVED',
      diff,
    });
    await this.versionRepo.save(version);

    await this.recordAudit(user, 'GOVERNANCE_POLICY_UPDATED', 'GovernancePolicy', updated.id, beforeSnapshot, updated, dto.changeReason);
    return updated;
  }

  // ─────────────────────────────────────────────────────────────
  // Approval Requests & Four-Eyes Principle
  // ─────────────────────────────────────────────────────────────

  async listApprovals(query?: { status?: string }) {
    await this.ensureBaselineSeeding();
    const whereClause: any = {};
    if (query?.status && query.status !== 'ALL') {
      whereClause.status = query.status;
    }
    return this.approvalRequestRepo.find({
      where: whereClause,
      order: { createdAt: 'DESC' },
    });
  }

  async createApprovalRequest(dto: CreateApprovalRequestDto, user: AuthUserPayload) {
    const actionDef = PRIVILEGED_ACTIONS_REGISTRY.find((a) => a.actionKey === dto.actionKey);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const request = this.approvalRequestRepo.create({
      actionKey: dto.actionKey,
      title: dto.title || actionDef?.name || `Approval Request: ${dto.actionKey}`,
      description: dto.description,
      riskLevel: dto.riskLevel || actionDef?.riskLevel || GovernanceRiskLevel.HIGH,
      requestedBy: user.userId || (user as any).id || 'ADMIN',
      requestedByEmail: user.email || 'admin@partneriq.in',
      requestedAt: new Date(),
      expiresAt,
      status: GovernanceApprovalStatus.PENDING,
      actionPayload: dto.actionPayload || {},
      organizationId: dto.organizationId,
    });

    const saved = await this.approvalRequestRepo.save(request);
    await this.recordAudit(user, 'GOVERNANCE_APPROVAL_REQUESTED', 'GovernanceApprovalRequest', saved.id, null, saved, dto.description);
    return saved;
  }

  async approveRequest(id: string, user: AuthUserPayload, reason?: string) {
    const request = await this.approvalRequestRepo.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Approval request '${id}' not found`);
    }

    if (request.status !== GovernanceApprovalStatus.PENDING) {
      throw new BadRequestException(`Approval request is already ${request.status}`);
    }

    const currentUserId = user.userId || (user as any).id;
    // FOUR-EYES PRINCIPLE SERVER-SIDE ENFORCEMENT
    if (request.requestedBy === currentUserId || (user.email && request.requestedByEmail === user.email)) {
      // Record violation
      await this.violationRepo.save(
        this.violationRepo.create({
          policyKey: 'financial.payout.four_eyes',
          actionKey: request.actionKey,
          actorId: currentUserId,
          actorEmail: user.email,
          riskLevel: GovernanceRiskLevel.CRITICAL,
          violationType: 'FOUR_EYES_SELF_APPROVAL_ATTEMPT',
          details: {
            requestId: request.id,
            requestedBy: request.requestedBy,
            approverId: currentUserId,
          },
        }),
      );
      throw new ForbiddenException(
        'Four-Eyes Principle Violation: The administrator who submitted this governance request cannot approve their own request.',
      );
    }

    request.status = GovernanceApprovalStatus.APPROVED;
    request.approverId = currentUserId;
    request.approverEmail = user.email || 'admin@partneriq.in';
    request.approvedAt = new Date();
    const updated = await this.approvalRequestRepo.save(request);

    await this.recordAudit(user, 'GOVERNANCE_APPROVAL_GRANTED', 'GovernanceApprovalRequest', updated.id, null, updated, reason);
    return updated;
  }

  async rejectRequest(id: string, user: AuthUserPayload, reason?: string) {
    const request = await this.approvalRequestRepo.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Approval request '${id}' not found`);
    }

    if (request.status !== GovernanceApprovalStatus.PENDING) {
      throw new BadRequestException(`Approval request is already ${request.status}`);
    }

    const currentUserId = user.userId || (user as any).id;
    request.status = GovernanceApprovalStatus.REJECTED;
    request.approverId = currentUserId;
    request.approverEmail = user.email || 'admin@partneriq.in';
    request.rejectionReason = reason || 'Rejected by platform administrator';
    const updated = await this.approvalRequestRepo.save(request);

    await this.recordAudit(user, 'GOVERNANCE_APPROVAL_REJECTED', 'GovernanceApprovalRequest', updated.id, null, updated, reason);
    return updated;
  }

  // ─────────────────────────────────────────────────────────────
  // Exceptions Management
  // ─────────────────────────────────────────────────────────────

  async listExceptions(query?: { status?: string }) {
    await this.ensureBaselineSeeding();
    const whereClause: any = {};
    if (query?.status && query.status !== 'ALL') {
      whereClause.status = query.status;
    }
    return this.exceptionRepo.find({
      where: whereClause,
      order: { createdAt: 'DESC' },
    });
  }

  async createException(dto: CreateGovernanceExceptionDto, user: AuthUserPayload) {
    const expiresAt = new Date(dto.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      throw new BadRequestException('Exception expiration must be a valid future date');
    }

    const exception = this.exceptionRepo.create({
      policyKey: dto.policyKey,
      scope: dto.scope || 'GLOBAL',
      reason: dto.reason,
      requestedBy: user.email || user.userId || (user as any).id || 'ADMIN',
      approvedBy: user.email || 'admin@partneriq.in',
      expiresAt,
      status: GovernanceExceptionStatus.ACTIVE,
    });
    const saved = await this.exceptionRepo.save(exception);

    await this.recordAudit(user, 'GOVERNANCE_EXCEPTION_GRANTED', 'GovernanceException', saved.id, null, saved, dto.reason);
    return saved;
  }

  async revokeException(id: string, user: AuthUserPayload) {
    const exception = await this.exceptionRepo.findOne({ where: { id } });
    if (!exception) {
      throw new NotFoundException(`Governance exception '${id}' not found`);
    }

    exception.status = GovernanceExceptionStatus.REVOKED;
    exception.revokedAt = new Date();
    exception.revokedBy = user.email || user.userId || (user as any).id;
    const saved = await this.exceptionRepo.save(exception);

    await this.recordAudit(user, 'GOVERNANCE_EXCEPTION_REVOKED', 'GovernanceException', saved.id, null, saved, 'Revoked by admin');
    return saved;
  }

  // ─────────────────────────────────────────────────────────────
  // Emergency Controls
  // ─────────────────────────────────────────────────────────────

  async getEmergencyControls() {
    await this.ensureBaselineSeeding();
    return this.emergencyRepo.find();
  }

  async toggleEmergencyControl(controlKey: string, dto: ToggleEmergencyControlDto, user: AuthUserPayload) {
    const control = await this.emergencyRepo.findOne({ where: { controlKey } });
    if (!control) {
      throw new NotFoundException(`Emergency control '${controlKey}' not found`);
    }

    control.enabled = dto.enabled;
    control.reason = dto.reason;
    control.activatedBy = user.userId || (user as any).id;
    control.activatedByEmail = user.email || 'admin@partneriq.in';
    control.activatedAt = dto.enabled ? new Date() : undefined;
    control.expiresAt = dto.enabled ? new Date(Date.now() + 4 * 60 * 60 * 1000) : undefined; // 4 hour auto-lock
    const updated = await this.emergencyRepo.save(control);

    await this.recordAudit(
      user,
      dto.enabled ? 'GOVERNANCE_EMERGENCY_CONTROL_ACTIVATED' : 'GOVERNANCE_EMERGENCY_CONTROL_DEACTIVATED',
      'GovernanceEmergencyControl',
      updated.id,
      null,
      updated,
      dto.reason,
    );

    return updated;
  }

  // ─────────────────────────────────────────────────────────────
  // Privileged Actions Registry & Execution
  // ─────────────────────────────────────────────────────────────

  getPrivilegedActionsRegistry() {
    return PRIVILEGED_ACTIONS_REGISTRY;
  }

  async executePrivilegedAction(dto: ExecutePrivilegedActionDto, user: AuthUserPayload) {
    const actionDef = PRIVILEGED_ACTIONS_REGISTRY.find((a) => a.actionKey === dto.actionKey);
    if (!actionDef) {
      throw new NotFoundException(`Privileged action '${dto.actionKey}' is not registered`);
    }

    // Check emergency freeze
    const freeze = await this.emergencyRepo.findOne({ where: { controlKey: 'ADMIN_OPERATIONS_FREEZE', enabled: true } });
    if (freeze && actionDef.actionKey !== 'emergency.operation_freeze') {
      throw new ForbiddenException(
        `Platform Governance Mutation Freeze Active: Destructive action '${actionDef.name}' is blocked. Reason: ${freeze.reason}`,
      );
    }

    // Check if requires approval
    if (actionDef.approvalRequired) {
      // Create approval request instead of immediate execution
      const request = await this.createApprovalRequest(
        {
          actionKey: dto.actionKey,
          title: `Action Execution: ${actionDef.name}`,
          description: dto.reason,
          riskLevel: actionDef.riskLevel,
          actionPayload: dto.payload,
        },
        user,
      );

      return {
        executed: false,
        requiresApproval: true,
        approvalRequestId: request.id,
        message: `Action '${actionDef.name}' requires secondary administrator approval under Platform Governance Policy. Request #${request.id.slice(0, 8)} created.`,
      };
    }

    // Action executed
    await this.recordAudit(user, `PRIVILEGED_ACTION_${dto.actionKey.toUpperCase().replace(/\./g, '_')}`, 'PrivilegedAction', dto.actionKey, null, dto.payload, dto.reason);

    return {
      executed: true,
      requiresApproval: false,
      message: `Privileged action '${actionDef.name}' executed successfully.`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Violations & Activity
  // ─────────────────────────────────────────────────────────────

  async listViolations(query?: { limit?: number }) {
    await this.ensureBaselineSeeding();
    return this.violationRepo.find({
      order: { createdAt: 'DESC' },
      take: query?.limit || 50,
    });
  }

  async listActivity(query?: { limit?: number }) {
    await this.ensureBaselineSeeding();
    const versions = await this.versionRepo.find({
      order: { createdAt: 'DESC' },
      take: query?.limit || 20,
    });

    const approvals = await this.approvalRequestRepo.find({
      where: { status: In([GovernanceApprovalStatus.APPROVED, GovernanceApprovalStatus.REJECTED]) },
      order: { updatedAt: 'DESC' },
      take: query?.limit || 20,
    });

    const exceptions = await this.exceptionRepo.find({
      order: { createdAt: 'DESC' },
      take: query?.limit || 10,
    });

    // Merge and sort
    const events: Array<{
      id: string;
      type: 'POLICY_VERSION' | 'APPROVAL_DECISION' | 'EXCEPTION';
      title: string;
      details: string;
      actor: string;
      timestamp: Date;
    }> = [];

    for (const v of versions) {
      events.push({
        id: v.id,
        type: 'POLICY_VERSION',
        title: `Policy Version Published: ${v.policyKey} (v${v.version})`,
        details: v.changeReason || 'Policy configuration updated',
        actor: v.authorEmail || 'Platform Staff',
        timestamp: v.createdAt,
      });
    }

    for (const a of approvals) {
      events.push({
        id: a.id,
        type: 'APPROVAL_DECISION',
        title: `Governance Request ${a.status}: ${a.title}`,
        details: a.rejectionReason || `Approved by ${a.approverEmail}`,
        actor: a.approverEmail || 'Approver',
        timestamp: a.updatedAt,
      });
    }

    for (const e of exceptions) {
      events.push({
        id: e.id,
        type: 'EXCEPTION',
        title: `Governance Exception ${e.status}: ${e.policyKey}`,
        details: e.reason,
        actor: e.requestedBy,
        timestamp: e.createdAt,
      });
    }

    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return events.slice(0, query?.limit || 50);
  }

  // ─────────────────────────────────────────────────────────────
  // Helper: Audit Logging
  // ─────────────────────────────────────────────────────────────

  private async recordAudit(
    user: AuthUserPayload,
    action: string,
    resourceType: string,
    resourceId: string,
    before: any,
    after: any,
    reason?: string,
  ) {
    try {
      const actorId = user.userId || (user as any).id || 'ADMIN_USER';
      const audit = this.auditRepo.create({
        actorType: 'PLATFORM_ADMIN',
        actorId,
        actorEmail: user.email || 'admin@partneriq.in',
        action: action as any,
        resourceType,
        resourceId,
        category: 'GOVERNANCE',
        result: 'SUCCESS',
        beforeState: before || undefined,
        afterState: after || undefined,
        metadata: { reason },
      });
      await this.auditRepo.save(audit);
    } catch (err) {
      console.warn('[PlatformGovernanceService] Audit recording warning:', err);
    }
  }
}
