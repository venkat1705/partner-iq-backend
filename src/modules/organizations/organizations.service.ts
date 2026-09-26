import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { IsNull } from 'typeorm';
import { dbStore, OrganizationEntity, OrganizationMembershipEntity, ProgramEntity, awaitPersist } from '../../database/store';
import { AppDataSource } from '../../database/data-source';
import { Organization, OrganizationMembership, Program } from '../../database/schema';
import { OrganizationStatus, Role, ProgramType, ProgramStatus, CommissionType, AttributionModel, AuditAction, EnvironmentType } from '../../common/enums';
import { MembershipStatus, ProgramAccessType } from '../../common/enums/rbac';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OnboardingOrgDto,
  OnboardingProgramDto,
} from './dto/organization.dto';
import { TrialService } from '../billing/services/trial.service';
import { BillingAccountService } from '../billing/services/billing-account.service';
import { SubscriptionLimitService } from '../billing/services/subscription-limit.service';
import { BillingResourceType } from '../billing/enums/billing.enums';
import { assertUserEligibleForOrganization } from '../affiliates/affiliate-eligibility.policy';
import { User } from '../../database/schema';
import { getAppConfig } from '../../config/app.config';
import { SystemEmailDispatchService } from '../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformRole } from '../../common/enums';
import { CommissionsService } from '../commissions/commissions.service';
import { TierService } from '../gamification/tiers/tier.service';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly trialService?: TrialService,
    private readonly emailDispatch?: SystemEmailDispatchService,
    private readonly notificationsService?: NotificationsService,
    private readonly commissionsService?: CommissionsService,
    private readonly tierService?: TierService,
    private readonly billingAccounts?: BillingAccountService,
    private readonly subscriptionLimits?: SubscriptionLimitService,
  ) { }

  /**
   * Creates an organization under the acting user's customer account.
   *
   * The organization allowance is account-wide, so the check runs against every
   * organization the user already owns — not against this one. The check and
   * the insert share a lock, so two tabs racing for the last slot cannot both
   * succeed.
   */
  private isDuplicateKeyError(err: any): boolean {
    return err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;
  }

  async create(
    userId: string,
    dto: CreateOrganizationDto,
    idempotencyKey?: string,
    options?: { isOnboarding?: boolean },
  ) {
    assertUserEligibleForOrganization(userId);

    // A replayed submission (double-click, network retry, two tabs) must return
    // the organization the first request already created, not consume another
    // slot in the account's org allowance or create a second row.
    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(userId, idempotencyKey);
      if (existing) return existing;
    }

    if (this.billingAccounts && this.subscriptionLimits) {
      const account = await this.billingAccounts.resolveForUser(userId);
      return this.subscriptionLimits.reserve(
        account.id,
        BillingResourceType.ORGANIZATION,
        () => this.createOrganizationRecord(userId, dto, account.id, idempotencyKey, options?.isOnboarding),
      );
    }

    return this.createOrganizationRecord(userId, dto, undefined, idempotencyKey, options?.isOnboarding);
  }

  private async findByIdempotencyKey(userId: string, idempotencyKey: string) {
    if (!AppDataSource.isInitialized) {
      return dbStore.organizations.find(
        (o) => o.createdBy === userId && (o as any).onboardingIdempotencyKey === idempotencyKey && !o.deletedAt,
      );
    }
    return AppDataSource.getRepository(Organization).findOne({
      where: { createdBy: userId, onboardingIdempotencyKey: idempotencyKey, deletedAt: IsNull() },
    });
  }

  /**
   * The real guard against duplicate onboarding orgs: unlike the idempotency
   * key (scoped to one form mount), this survives a refresh, a closed tab, or
   * a re-login, because it's keyed on the user, not the client session.
   */
  private async findInProgressOnboardingOrg(userId: string) {
    if (!AppDataSource.isInitialized) {
      return dbStore.organizations.find(
        (o) => o.createdBy === userId && o.onboardingStatus === 'IN_PROGRESS' && !o.deletedAt,
      );
    }
    return AppDataSource.getRepository(Organization).findOne({
      where: { createdBy: userId, onboardingStatus: 'IN_PROGRESS', deletedAt: IsNull() },
    });
  }

  private async createOrganizationRecord(
    userId: string,
    dto: CreateOrganizationDto,
    accountId?: string,
    idempotencyKey?: string,
    isOnboarding?: boolean,
  ) {
    let slug = this.slugify(dto.slug || dto.name);

    if (AppDataSource.isInitialized) {
      const orgRepo = AppDataSource.getRepository(Organization);
      let candidateSlug = slug;
      let count = 1;
      while (await orgRepo.findOne({ where: { slug: candidateSlug, deletedAt: IsNull() } })) {
        candidateSlug = `${slug}-${count++}`;
      }
      slug = candidateSlug;
    } else {
      const existing = dbStore.organizations.find((o) => o.slug === slug && !o.deletedAt);
      if (existing) {
        slug = `${slug}-${Date.now()}`;
      }
    }

    const org: OrganizationEntity = {
      id: uuidv4(),
      accountId,
      name: dto.name,
      slug,
      website: dto.website,
      industry: dto.industry,
      companySize: dto.companySize,
      country: dto.country || 'US',
      defaultCurrency: dto.defaultCurrency || PLATFORM_CURRENCY,
      status: OrganizationStatus.ACTIVE,
      onboardingCompleted: false,
      createdBy: userId,
      onboardingIdempotencyKey: idempotencyKey,
      // Plain (non-wizard) creation has no multi-step flow to resume, so it's
      // "complete" immediately; the wizard path locks this org to the user
      // until completeOnboarding() runs (see onboardingLockKey on the entity).
      onboardingStatus: isOnboarding ? 'IN_PROGRESS' : 'COMPLETED',
      onboardingStep: 1,
      onboardingLockKey: isOnboarding ? userId : undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Create Owner membership
    const membership: OrganizationMembershipEntity = {
      id: uuidv4(),
      organizationId: org.id,
      userId,
      role: Role.OWNER,
      status: MembershipStatus.ACTIVE,
      programAccessType: ProgramAccessType.ALL,
      programIds: [],
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (AppDataSource.isInitialized) {
      try {
        // Atomic: either both rows land, or neither does. A concurrent request
        // with the same idempotency key (the race the pre-check above can miss)
        // fails here on the unique index instead of creating a duplicate org.
        await AppDataSource.transaction(async (manager) => {
          await manager.getRepository(Organization).save(org);
          await manager.getRepository(OrganizationMembership).save(membership);
        });
      } catch (err: any) {
        if (this.isDuplicateKeyError(err)) {
          if (idempotencyKey) {
            const existing = await this.findByIdempotencyKey(userId, idempotencyKey);
            if (existing) return existing;
          }
          if (isOnboarding) {
            const existing = await this.findInProgressOnboardingOrg(userId);
            if (existing) return existing;
          }
        }
        throw err;
      }
    }

    if (!dbStore.organizations.some((o) => o.id === org.id)) {
      dbStore.organizations.push(org);
    }
    if (!dbStore.organizationMemberships.some((m) => m.id === membership.id)) {
      dbStore.organizationMemberships.push(membership);
    }
    await Promise.all([awaitPersist(org), awaitPersist(membership)]);

    // The wizard path defers trial/commission-rule/tier/audit/email to
    // completeOnboarding() — see the comment there for why. Plain creation has
    // no separate "complete" step, so it runs them here, as before.
    if (!isOnboarding) {
      await this.seedOrganizationDefaults(org, userId);
    }

    return org;
  }

  /**
   * Trial, default commission rule, default tier ladder, audit log entry, and
   * welcome email/notification. Each of the three service calls already
   * no-ops if it was already done for this org (checked directly in
   * `seedDefaultTiers`, via the DB unique constraint for the trial, and via a
   * caught "rule already exists" error for the commission rule) — so this
   * whole method is safe to call more than once for the same org, which is
   * exactly what happens when `completeOnboarding()` is retried after a
   * partial failure.
   */
  private async seedOrganizationDefaults(org: OrganizationEntity, userId: string) {
    // 1. Trial: Check-then-create, catching only expected 'already exists/consumed' states.
    // Start the 14-day free trial on GROWTH rather than PRO: PRO is unlimited,
    // so trialling on it would leave every allowance unenforced for 14 days and
    // then collapse hard at conversion. GROWTH gives a realistic, enforced set
    // of limits during the trial.
    try {
      const alreadyHasTrial = dbStore.organizationTrials.some((t) => t.organizationId === org.id);
      if (!alreadyHasTrial) {
        await this.trialService?.startTrial(org.id, userId, 'GROWTH');
      }
    } catch (err: any) {
      const isExpected =
        err?.response?.code === 'TRIAL_ALREADY_CONSUMED' ||
        err?.response?.code === 'ACTIVE_SUBSCRIPTION_EXISTS' ||
        err?.message?.includes?.('already consumed') ||
        err?.message?.includes?.('already has an active');
      if (!isExpected) {
        this.logger.error(
          `Failed to start trial for organization ${org.id}: ${err?.message || err}`,
          err?.stack,
        );
      }
    }

    // Note: a default commission rule and a Bronze/Silver/Gold/Platinum tier
    // ladder used to be fabricated here on every org creation. That was fake
    // placeholder data, not real organization state, so it has been removed —
    // a new organization now starts with genuinely empty commission rules and
    // tiers until an admin configures them for real.

    // Audit log
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId: org.id,
      actorType: 'USER',
      actorId: userId,
      action: AuditAction.ORGANIZATION_CREATED,
      resourceType: 'organization',
      resourceId: org.id,
      createdAt: new Date(),
    });

    this.notifyOrganizationCreated(org, userId).catch(() => undefined);
  }

  private async notifyOrganizationCreated(org: OrganizationEntity, userId: string) {
    let creator = dbStore.users.find((u) => u.id === userId) as User | undefined;
    if (!creator && AppDataSource.isInitialized) {
      creator = (await AppDataSource.getRepository(User).findOne({ where: { id: userId } })) ?? undefined;
    }
    if (!creator?.email) return;

    const dashboardUrl = `${getAppConfig().frontendUrl.replace(/\/$/, '')}/organizations/${org.id}/dashboard`;
    const statusLabel = org.status
      ? org.status.charAt(0) + org.status.slice(1).toLowerCase()
      : 'Active';

    await this.emailDispatch?.send(
      SystemTemplateKey.ORGANIZATION_WELCOME,
      creator.email,
      {
        user: { firstName: creator.firstName },
        organization: { name: org.name },
        // Flat fields — these match the email-design "welcome" template's own variables
        // (workspaceSlug/workspaceStatus/planName), since the resolver renders the
        // actual seeded email-design template, not a generic dot-path fallback body.
        organizationName: org.name,
        workspaceSlug: org.slug,
        workspaceStatus: statusLabel,
        planName: 'PRO Trial (14 Days)',
        links: { dashboardUrl, setupUrl: dashboardUrl },
      },
      { organizationId: org.id, userId: creator.id },
    );

    this.notificationsService?.createNotification({
      userId: creator.id,
      organizationId: org.id,
      type: 'system',
      title: 'Your workspace is ready',
      body: `${org.name} has been created and is ready to configure.`,
      channel: 'in_app',
      priority: 'normal',
      actionUrl: `/organizations/${org.id}/dashboard`,
    }).catch(() => undefined);

    // Platform visibility: let super admins know a new org just signed up.
    const superAdmins = dbStore.users.filter((u) => u.platformRole === PlatformRole.SUPER_ADMIN);
    for (const admin of superAdmins) {
      this.notificationsService?.createNotification({
        userId: admin.id,
        type: 'system',
        title: 'New organization created',
        body: `${org.name} (created by ${creator.email}) just joined PartnerIQ.`,
        channel: 'in_app',
        priority: 'normal',
        actionUrl: `/admin/organizations`,
      }).catch(() => undefined);
    }
  }

  async findAllForUser(userId: string, isSuperAdmin = false) {
    if (isSuperAdmin) {
      if (AppDataSource.isInitialized) {
        try {
          const allDbOrgs = await AppDataSource.getRepository(Organization).find({
            where: { deletedAt: IsNull() },
          });
          for (const dbOrg of allDbOrgs) {
            if (!dbStore.organizations.some((o) => o.id === dbOrg.id)) {
              dbStore.organizations.push(dbOrg);
            }
          }
        } catch (e) { }
      }

      return dbStore.organizations
        .filter((o) => !o.deletedAt)
        .map((org) => ({
          ...org,
          role: Role.SUPER_ADMIN,
        }));
    }

    // 1. Fetch user-owned orgs directly from DB
    let userOwnedOrgs: OrganizationEntity[] = [];
    if (AppDataSource.isInitialized) {
      try {
        userOwnedOrgs = await AppDataSource.getRepository(Organization).find({
          where: { createdBy: userId, deletedAt: IsNull() },
        });
      } catch (e) { }
    }

    // 2. Fetch memberships from DB or dbStore
    let memberships: OrganizationMembershipEntity[] = [];
    if (AppDataSource.isInitialized) {
      try {
        memberships = await AppDataSource.getRepository(OrganizationMembership).find({
          where: { userId, status: MembershipStatus.ACTIVE },
        });
      } catch (e) {
        memberships = dbStore.organizationMemberships.filter(
          (m) => m.userId === userId && m.status === MembershipStatus.ACTIVE,
        );
      }
    } else {
      memberships = dbStore.organizationMemberships.filter(
        (m) => m.userId === userId && m.status === MembershipStatus.ACTIVE,
      );
    }

    const validOrgsWithRole: Array<OrganizationEntity & { role?: Role | string }> = [];
    const checkedOrgIds = new Set<string>();

    for (const mem of memberships) {
      let org = userOwnedOrgs.find((o) => o.id === mem.organizationId) ||
        dbStore.organizations.find((o) => o.id === mem.organizationId && !o.deletedAt);

      if (!org && AppDataSource.isInitialized) {
        try {
          const dbOrg = await AppDataSource.getRepository(Organization).findOne({
            where: { id: mem.organizationId, deletedAt: IsNull() },
          });
          if (dbOrg) {
            org = dbOrg;
            if (!dbStore.organizations.some((o) => o.id === dbOrg.id)) {
              dbStore.organizations.push(dbOrg);
            }
          }
        } catch (e) { }
      }

      if (org && !org.deletedAt) {
        checkedOrgIds.add(org.id);
        if (!dbStore.organizations.some((o) => o.id === org.id)) {
          dbStore.organizations.push(org);
        }
        validOrgsWithRole.push({
          ...org,
          role: mem.role,
        });
      }
    }

    // 3. Include any user-created organizations that might be missing membership
    for (const org of userOwnedOrgs) {
      if (!checkedOrgIds.has(org.id) && !org.deletedAt) {
        if (!dbStore.organizations.some((o) => o.id === org.id)) {
          dbStore.organizations.push(org);
        }
        validOrgsWithRole.push({
          ...org,
          role: Role.OWNER,
        });
      }
    }

    return validOrgsWithRole;
  }

  async findOne(organizationId: string) {
    let org = dbStore.organizations.find((o) => o.id === organizationId && !o.deletedAt);
    if (!org && AppDataSource.isInitialized) {
      try {
        const dbOrg = await AppDataSource.getRepository(Organization).findOne({
          where: { id: organizationId },
        });
        if (dbOrg && !dbOrg.deletedAt) {
          if (!dbStore.organizations.some((o) => o.id === dbOrg.id)) {
            dbStore.organizations.push(dbOrg);
          }
          org = dbOrg;
        }
      } catch (e) {
        // ignore
      }
    }

    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    return org;
  }

  async update(organizationId: string, dto: UpdateOrganizationDto) {
    const org = await this.findOne(organizationId);

    if (dto.name) org.name = dto.name;
    if (dto.website) org.website = dto.website;
    if (dto.industry) org.industry = dto.industry;
    if (dto.companySize) org.companySize = dto.companySize;
    if (dto.country) org.country = dto.country;
    if (dto.logo !== undefined) (org as any).logo = dto.logo;
    if (dto.status) org.status = dto.status;

    org.updatedAt = new Date();
    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(Organization).save(org);
    }
    await awaitPersist(org);
    return org;
  }

  // Onboarding Step 1
  async onboardingOrg(userId: string, dto: OnboardingOrgDto) {
    // Checked BEFORE the idempotency key, and independent of it: a refresh,
    // closed tab, or re-login generates a brand new key every time, so the
    // key alone can't catch "this user already started onboarding". This
    // check can, because it's keyed on the user, not the client session.
    const inProgress = await this.findInProgressOnboardingOrg(userId);
    if (inProgress) return inProgress;

    return this.create(
      userId,
      {
        name: dto.name,
        slug: dto.slug,
        website: dto.website,
        industry: dto.industry,
        companySize: dto.companySize,
        country: dto.country,
      },
      dto.idempotencyKey,
      { isOnboarding: true },
    );
  }

  /**
   * For the frontend to resume onboarding at the right place on load —
   * covers the refresh / closed-tab / re-login case directly, rather than
   * relying on the wizard's own client-side state (which is gone in exactly
   * those cases).
   */
  async getOnboardingStatus(userId: string) {
    const inProgress = await this.findInProgressOnboardingOrg(userId);
    if (!inProgress) {
      return { inProgress: false as const };
    }
    return {
      inProgress: true as const,
      organization: {
        id: inProgress.id,
        name: inProgress.name,
        slug: inProgress.slug,
        website: inProgress.website,
        industry: inProgress.industry,
        companySize: inProgress.companySize,
        country: inProgress.country,
      },
      step: inProgress.onboardingStep,
    };
  }

  /** Called whenever the frontend advances past a step, so a resume lands on the right screen instead of always step 1. */
  async updateOnboardingStep(userId: string, organizationId: string, step: number) {
    const org = await this.findOne(organizationId);
    if (org.createdBy !== userId) {
      throw new ForbiddenException('You do not own this organization.');
    }
    org.onboardingStep = step;
    org.updatedAt = new Date();
    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(Organization).save(org);
    }
    await awaitPersist(org);
    return { success: true, step: org.onboardingStep };
  }

  private slugify(value: string) {
    const slug = value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!slug) {
      throw new BadRequestException('Organization slug is required');
    }

    return slug;
  }

  // Onboarding Step 2: Program setup
  async onboardingProgram(userId: string, dto: OnboardingProgramDto) {
    const org = await this.findOne(dto.organizationId);

    const program = {
      id: uuidv4(),
      organizationId: org.id,
      environment: EnvironmentType.TEST,
      name: dto.programName,
      slug: dto.programName.toLowerCase().replace(/\s+/g, '-'),
      type: ProgramType.AFFILIATE,
      status: ProgramStatus.ACTIVE,
      currency: org.defaultCurrency,
      commissionType: CommissionType.PERCENTAGE,
      defaultCommissionValue: (dto.defaultCommissionRate || 10) * 100, // Basis points
      attributionModel: AttributionModel.LAST_CLICK,
      attributionWindowDays: 30,
      cookieDurationDays: 30,
      couponAttributionPriority: 'PROMO_CODE' as const,
      attributionConfig: { weights: { first: 0.25, middle: 0.5, last: 0.25 } },
      affiliateApprovalMode: 'AUTO' as const,
      minimumPayoutAmount: 0,
      payoutSchedule: 'MONTHLY',
      payoutMethods: [],
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.programs.push(program);
    await awaitPersist(program);
    this.notifyProgramCreated(org, program, userId).catch(() => undefined);
    return program;
  }

  private async notifyProgramCreated(org: { id: string; name: string }, program: { name: string }, userId: string) {
    let creator = dbStore.users.find((u) => u.id === userId) as User | undefined;
    if (!creator && AppDataSource.isInitialized) {
      creator = (await AppDataSource.getRepository(User).findOne({ where: { id: userId } })) ?? undefined;
    }
    if (!creator?.email) return;

    const dashboardUrl = `${getAppConfig().frontendUrl.replace(/\/$/, '')}/organizations/${org.id}/programs`;
    await this.emailDispatch?.send(
      SystemTemplateKey.ORGANIZATION_PROGRAM_CREATED,
      creator.email,
      {
        user: { firstName: creator.firstName },
        organization: { name: org.name },
        program: { name: program.name },
        links: { dashboardUrl },
      },
      { organizationId: org.id, userId: creator.id },
    );

    this.notificationsService?.createNotification({
      userId: creator.id,
      organizationId: org.id,
      type: 'program',
      title: 'Program created',
      body: `"${program.name}" is live and ready to accept affiliates.`,
      channel: 'in_app',
      priority: 'normal',
      actionUrl: `/organizations/${org.id}/programs`,
    }).catch(() => undefined);
  }

  /**
   * Onboarding Step Complete.
   *
   * Idempotent and safe to retry: if the user's first call succeeded but the
   * response never reached the client (dropped connection, browser closed),
   * calling this again with the same organizationId re-runs
   * `seedOrganizationDefaults()` — which itself no-ops on anything already
   * seeded — and re-clears the lock, rather than leaving the org stuck
   * IN_PROGRESS forever. The welcome email/notification/audit-log-entry combo
   * inside it should still only fire once, so it's skipped on a call that
   * finds the org already COMPLETED.
   */
  async completeOnboarding(organizationId: string, userId: string) {
    const org = await this.findOne(organizationId);
    if (org.createdBy !== userId) {
      throw new ForbiddenException('You do not own this organization.');
    }

    const wasAlreadyCompleted = org.onboardingStatus === 'COMPLETED';

    // Enrichment runs BEFORE the org is marked COMPLETED and saved: if the
    // process dies partway through (or a sub-step throws past its own
    // try/catch), the org stays IN_PROGRESS and the next retry re-enters this
    // branch and tries again, instead of being marked "done" prematurely and
    // permanently skipping whatever didn't finish.
    if (!wasAlreadyCompleted) {
      await this.seedOrganizationDefaults(org, userId);
    }

    org.onboardingCompleted = true;
    org.onboardingStatus = 'COMPLETED';
    // Must be `null`, not `undefined`: TypeORM's save() treats an `undefined`
    // property as "not specified, leave the column alone", not "clear it" —
    // assigning `undefined` here silently left the old lock in place, which
    // permanently blocked this user's next onboarding attempt (caught by the
    // "third org via onboarding" case in onboarding-duplicate-org.test.ts).
    org.onboardingLockKey = null as any;
    org.updatedAt = new Date();
    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(Organization).save(org);
    }
    await awaitPersist(org);

    return { success: true, onboardingCompleted: true };
  }
}

