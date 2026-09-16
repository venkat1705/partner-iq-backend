import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { IsNull } from 'typeorm';
import { dbStore, OrganizationEntity, OrganizationMembershipEntity, ProgramEntity } from '../../database/store';
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
  async create(userId: string, dto: CreateOrganizationDto) {
    assertUserEligibleForOrganization(userId);

    if (this.billingAccounts && this.subscriptionLimits) {
      const account = await this.billingAccounts.resolveForUser(userId);
      return this.subscriptionLimits.reserve(
        account.id,
        BillingResourceType.ORGANIZATION,
        () => this.createOrganizationRecord(userId, dto, account.id),
      );
    }

    return this.createOrganizationRecord(userId, dto);
  }

  private async createOrganizationRecord(
    userId: string,
    dto: CreateOrganizationDto,
    accountId?: string,
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
      await AppDataSource.getRepository(Organization).save(org);
      await AppDataSource.getRepository(OrganizationMembership).save(membership);
    }

    if (!dbStore.organizations.some((o) => o.id === org.id)) {
      dbStore.organizations.push(org);
    }
    if (!dbStore.organizationMemberships.some((m) => m.id === membership.id)) {
      dbStore.organizationMemberships.push(membership);
    }

    // Start the 14-day free trial on GROWTH rather than PRO: PRO is unlimited,
    // so trialling on it would leave every allowance unenforced for 14 days and
    // then collapse hard at conversion. GROWTH gives a realistic, enforced set
    // of limits during the trial.
    try {
      await this.trialService?.startTrial(org.id, userId, 'GROWTH');
    } catch (err) {
      // Non-blocking if trial already exists or fails
    }

    // Seed a default organization-wide commission rule so the org isn't left with
    // an empty commission structure before any program-specific rules are configured.
    try {
      await this.commissionsService?.createRule(org.id, {
        name: 'Default Commission Rate',
        priority: 0,
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: 1500, // 15.00% — value is in basis points (100 = 1%)
        holdPeriodDays: 30,
        status: 'ACTIVE',
      });
    } catch (err) {
      // Non-blocking — an organization can still function without a default rule.
    }

    // Seed the Bronze/Silver/Gold/Platinum tier ladder so every affiliate this org
    // invites is assigned Bronze automatically — without this, an org that never
    // visits the Gamification page has no default tier for the system to assign at all.
    try {
      await this.tierService?.seedDefaultTiers(org.id, userId);
    } catch (err) {
      // Non-blocking — tiers can still be configured manually later.
    }

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

    return org;
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
    if (dto.status) org.status = dto.status;

    org.updatedAt = new Date();
    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(Organization).save(org);
    }
    return org;
  }

  // Onboarding Step 1
  async onboardingOrg(userId: string, dto: OnboardingOrgDto) {
    return this.create(userId, {
      name: dto.name,
      slug: dto.slug,
      website: dto.website,
      industry: dto.industry,
      companySize: dto.companySize,
      country: dto.country,
    });
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

  // Onboarding Step Complete
  async completeOnboarding(organizationId: string) {
    const org = await this.findOne(organizationId);
    org.onboardingCompleted = true;
    org.updatedAt = new Date();
    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(Organization).save(org);
    }
    return { success: true, onboardingCompleted: true };
  }
}

