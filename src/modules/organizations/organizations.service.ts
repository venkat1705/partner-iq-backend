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
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OnboardingOrgDto,
  OnboardingProgramDto,
} from './dto/organization.dto';
import { TrialService } from '../billing/services/trial.service';
import { assertUserEligibleForOrganization } from '../affiliates/affiliate-eligibility.policy';

@Injectable()
export class OrganizationsService {
  constructor(private readonly trialService?: TrialService) { }

  async create(userId: string, dto: CreateOrganizationDto) {
    assertUserEligibleForOrganization(userId);
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
      name: dto.name,
      slug,
      website: dto.website,
      industry: dto.industry,
      companySize: dto.companySize,
      country: dto.country || 'US',
      defaultCurrency: dto.defaultCurrency || 'USD',
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

    // Start 14-day free trial for new organization
    try {
      await this.trialService?.startTrial(org.id, userId, 'PRO');
    } catch (err) {
      // Non-blocking if trial already exists or fails
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

    return org;
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
    return program;
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

