import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, OrganizationEntity, OrganizationMembershipEntity } from '../../database/store';
import { OrganizationStatus, Role, ProgramType, ProgramStatus, CommissionType, AttributionModel, AuditAction, EnvironmentType } from '../../common/enums';
import { MembershipStatus, ProgramAccessType } from '../../common/enums/rbac';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OnboardingOrgDto,
  OnboardingProgramDto,
} from './dto/organization.dto';
import { TrialService } from '../billing/services/trial.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly trialService?: TrialService) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    const slug = this.slugify(dto.slug || dto.name);

    const existing = dbStore.organizations.find((o) => o.slug === slug && !o.deletedAt);
    if (existing) {
      throw new BadRequestException('Organization slug is already taken');
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

    dbStore.organizations.push(org);

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

    dbStore.organizationMemberships.push(membership);

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
      return dbStore.organizations
        .filter((o) => !o.deletedAt)
        .map((org) => ({
          ...org,
          role: Role.SUPER_ADMIN,
        }));
    }

    const memberships = dbStore.organizationMemberships.filter(
      (m) => m.userId === userId && m.status === MembershipStatus.ACTIVE,
    );

    const orgIds = memberships.map((m) => m.organizationId);

    return dbStore.organizations
      .filter((o) => orgIds.includes(o.id) && !o.deletedAt)
      .map((org) => {
        const mem = memberships.find((m) => m.organizationId === org.id);
        return {
          ...org,
          role: mem?.role,
        };
      });
  }

  async findOne(organizationId: string) {
    const org = dbStore.organizations.find((o) => o.id === organizationId && !o.deletedAt);
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
    return { success: true, onboardingCompleted: true };
  }
}
