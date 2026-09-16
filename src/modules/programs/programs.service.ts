import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, ProgramEntity } from '../../database/store';
import { ProgramStatus, AuditAction, EnvironmentType, AffiliateStatus } from '../../common/enums';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { CreateProgramDto, UpdateProgramDto } from './dto/program.dto';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import { getAppConfig } from '../../config/app.config';
import { User } from '../../database/schema';
import { initializeDataSource } from '../../database/data-source';
import { SystemEmailDispatchService } from '../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionLimitService } from '../billing/services/subscription-limit.service';
import { BillingResourceType } from '../billing/enums/billing.enums';

@Injectable()
export class ProgramsService {
  constructor(
    private readonly emailDispatch?: SystemEmailDispatchService,
    private readonly notificationsService?: NotificationsService,
    private readonly subscriptionLimits?: SubscriptionLimitService,
  ) { }

  private formatCommissionStructure(program: Pick<ProgramEntity, 'commissionType' | 'defaultCommissionValue'>): string {
    const value = program.defaultCommissionValue ?? 0;
    if (program.commissionType === 'FIXED_AMOUNT') {
      return `${(value / 100).toFixed(2)} Fixed per Conversion`;
    }
    const isRecurring = String(program.commissionType || '').toUpperCase().includes('RECURRING');
    return `${(value / 100).toFixed(1)}%${isRecurring ? ' Recurring' : ''}`;
  }

  private async notifyProgramCreated(organizationId: string, createdByUserId: string, program: ProgramEntity) {
    let creator = dbStore.users.find((u) => u.id === createdByUserId) as User | undefined;
    if (!creator) {
      try {
        const dataSource = await initializeDataSource();
        creator = (await dataSource.getRepository(User).findOne({ where: { id: createdByUserId } })) ?? undefined;
      } catch { }
    }
    if (!creator?.email) return;

    const organization = dbStore.organizations.find((o) => o.id === organizationId);
    const dashboardUrl = `${getAppConfig().frontendUrl.replace(/\/$/, '')}/organizations/${organizationId}/programs`;
    const landingPageUrl = program.landingUrl || program.websiteUrl || dashboardUrl;

    await this.emailDispatch?.send(
      SystemTemplateKey.ORGANIZATION_PROGRAM_CREATED,
      creator.email,
      {
        user: { firstName: creator.firstName },
        organization: { name: organization?.name || 'Your organization' },
        program: { name: program.name },
        // Flat fields — these match the email-design "program-created" template's own
        // variables (programName/commissionStructure/cookieDuration/landingPageUrl/
        // manageProgramUrl), since the resolver renders the actual seeded email-design
        // template, not a generic dot-path fallback body.
        programName: program.name,
        commissionStructure: this.formatCommissionStructure(program),
        cookieDuration: `${program.cookieDurationDays ?? program.attributionWindowDays ?? 30} Days`,
        landingPageUrl,
        manageProgramUrl: dashboardUrl,
        links: { dashboardUrl },
      },
      { organizationId, userId: creator.id },
    );

    this.notificationsService?.createNotification({
      userId: creator.id,
      organizationId,
      type: 'program',
      title: 'Program created',
      body: `"${program.name}" is live and ready to accept affiliates.`,
      channel: 'in_app',
      priority: 'normal',
      actionUrl: `/organizations/${organizationId}/programs`,
    }).catch(() => undefined);
  }

  /**
   * Creates a program.
   *
   * The program allowance is counted across the whole customer account, so four
   * programs spread over three organizations still count as four. Only LIVE
   * programs consume capacity — TEST-environment programs are sandbox
   * scaffolding and are not billed, so they skip the check entirely.
   */
  async create(
    organizationId: string,
    createdByUserId: string,
    dto: CreateProgramDto,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    if (this.subscriptionLimits && environment === EnvironmentType.LIVE) {
      return this.subscriptionLimits.reserveForOrganization(
        organizationId,
        BillingResourceType.PROGRAM,
        () => this.createProgramRecord(organizationId, createdByUserId, dto, environment),
      );
    }
    return this.createProgramRecord(organizationId, createdByUserId, dto, environment);
  }

  private async createProgramRecord(
    organizationId: string,
    createdByUserId: string,
    dto: CreateProgramDto,
    environment: EnvironmentType,
  ) {
    const slug = dto.slug.toLowerCase().trim();
    const payoutPolicy = (dto.policy?.payout || {}) as {
      minimumPayoutAmount?: number;
      payoutSchedule?: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'MANUAL';
      payoutDay?: string;
      payoutMethods?: string[];
    };

    const existing = dbStore.programs.find(
      (p) =>
        p.organizationId === organizationId &&
        p.environment === environment &&
        p.slug === slug &&
        !p.deletedAt,
    );

    if (existing) {
      throw new BadRequestException(`Program with slug '${slug}' already exists in ${environment} environment.`);
    }

    const program: ProgramEntity = {
      id: uuidv4(),
      organizationId,
      environment,
      name: dto.name,
      slug,
      type: dto.type,
      status: dto.status || ProgramStatus.ACTIVE,
      currency: dto.currency || PLATFORM_CURRENCY,
      commissionType: dto.commissionType,
      defaultCommissionValue: dto.defaultCommissionValue ?? (dto.defaultCommissionRate || 10) * 100,
      attributionModel: dto.attributionModel,
      attributionWindowDays: dto.attributionWindowDays ?? dto.cookieDurationDays ?? 30,
      cookieDurationDays: dto.cookieDurationDays || dto.attributionWindowDays || 30,
      couponAttributionPriority: dto.couponAttributionPriority || 'PROMO_CODE',
      attributionConfig: dto.attributionConfig || undefined,
      affiliateApprovalMode: dto.affiliateApprovalMode || 'AUTO',
      minimumPayoutAmount: dto.minimumPayoutAmount ?? payoutPolicy.minimumPayoutAmount ?? 0,
      payoutSchedule: dto.payoutSchedule || payoutPolicy.payoutSchedule || 'MONTHLY',
      payoutDay: dto.payoutDay || payoutPolicy.payoutDay,
      payoutMethods: dto.payoutMethods || payoutPolicy.payoutMethods || [],
      logoUrl: dto.logoUrl,
      bannerUrl: dto.bannerUrl,
      visibility: (dto.visibility || 'PUBLIC').toUpperCase(),
      shortDescription: dto.shortDescription,
      description: dto.description,
      category: dto.category,
      tags: dto.tags,
      websiteUrl: dto.websiteUrl,
      landingUrl: dto.landingUrl,
      createdBy: createdByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.programs.push(program);

    this.notifyProgramCreated(organizationId, createdByUserId, program).catch(() => undefined);

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: createdByUserId,
      action: AuditAction.PROGRAM_CREATED,
      resourceType: 'program',
      resourceId: program.id,
      metadata: {
        environment,
        name: program.name,
        slug: program.slug,
        visibility: program.visibility,
      },
      createdAt: new Date(),
    });

    return {
      ...program,
      visibility: program.visibility || 'PUBLIC',
      affiliatesCount: 0,
    };
  }

  async findAll(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    const programs = dbStore.programs.filter(
      (p) =>
        p.organizationId === organizationId &&
        (p.environment === environment || (!p.environment && environment === EnvironmentType.LIVE)) &&
        !p.deletedAt,
    );

    const totalOrgAffiliates = dbStore.affiliates.filter((a) => a.organizationId === organizationId).length;

    return programs.map((p) => {
      const explicitCount = dbStore.programAffiliates.filter(
        (pa) =>
          pa.programId === p.id &&
          (pa.organizationId === organizationId || !pa.organizationId) &&
          pa.status !== AffiliateStatus.REJECTED,
      ).length;

      const affiliatesCount = explicitCount > 0 ? explicitCount : (programs.length === 1 ? totalOrgAffiliates : 0);

      return {
        ...p,
        visibility: p.visibility || 'PUBLIC',
        affiliatesCount,
      };
    });
  }

  async findOne(organizationId: string, programId: string, environment?: EnvironmentType) {
    const program = dbStore.programs.find((p) => {
      if (p.id !== programId || p.organizationId !== organizationId || p.deletedAt) {
        return false;
      }
      if (environment) {
        return p.environment === environment || (!p.environment && environment === EnvironmentType.LIVE);
      }
      return true;
    });

    if (!program) {
      throw new NotFoundException('Program not found in current environment context');
    }

    const explicitCount = dbStore.programAffiliates.filter(
      (pa) =>
        pa.programId === program.id &&
        (pa.organizationId === organizationId || !pa.organizationId) &&
        pa.status !== AffiliateStatus.REJECTED,
    ).length;

    const orgProgramsCount = dbStore.programs.filter((p) => p.organizationId === organizationId && !p.deletedAt).length;
    const totalOrgAffiliates = dbStore.affiliates.filter((a) => a.organizationId === organizationId).length;
    const affiliatesCount = explicitCount > 0 ? explicitCount : (orgProgramsCount === 1 ? totalOrgAffiliates : 0);

    return {
      ...program,
      visibility: program.visibility || 'PUBLIC',
      affiliatesCount,
    };
  }

  async update(
    organizationId: string,
    programId: string,
    dto: UpdateProgramDto,
    actorId: string,
    environment?: EnvironmentType,
  ) {
    const program = await this.findOne(organizationId, programId, environment);
    const rawProgram = dbStore.programs.find((p) => p.id === programId && p.organizationId === organizationId && !p.deletedAt);
    if (!rawProgram) {
      throw new NotFoundException('Program not found in current environment context');
    }
    const previous = { ...rawProgram };

    // Once affiliates have joined, the economic terms of the program (commission
    // structure, attribution model/window) can no longer be changed retroactively —
    // that would silently alter what already-enrolled affiliates agreed to. Cosmetic
    // and operational fields (name, description, branding, payout logistics, etc.)
    // remain freely editable at any time.
    const hasAffiliates = dbStore.programAffiliates.some((pa) => pa.programId === programId && pa.status !== AffiliateStatus.REJECTED);
    const ECONOMIC_TERM_FIELDS: (keyof UpdateProgramDto)[] = [
      'commissionType',
      'defaultCommissionValue',
      'attributionModel',
      'attributionWindowDays',
      'cookieDurationDays',
      'couponAttributionPriority',
      'attributionConfig',
    ];
    if (hasAffiliates && ECONOMIC_TERM_FIELDS.some((field) => dto[field] !== undefined)) {
      throw new BadRequestException(
        'Commission structure and attribution settings cannot be changed after affiliates have joined this program. Create a new commission rule instead to adjust rates going forward.',
      );
    }

    if (dto.name) rawProgram.name = dto.name;
    if (dto.defaultCommissionValue !== undefined) rawProgram.defaultCommissionValue = dto.defaultCommissionValue;
    if (dto.commissionType) rawProgram.commissionType = dto.commissionType;
    if (dto.attributionModel) rawProgram.attributionModel = dto.attributionModel;
    if (dto.attributionWindowDays !== undefined) rawProgram.attributionWindowDays = dto.attributionWindowDays;
    if (dto.cookieDurationDays !== undefined) rawProgram.cookieDurationDays = dto.cookieDurationDays;
    if (dto.couponAttributionPriority !== undefined) rawProgram.couponAttributionPriority = dto.couponAttributionPriority;
    if (dto.attributionConfig !== undefined) rawProgram.attributionConfig = dto.attributionConfig;
    if (dto.minimumPayoutAmount !== undefined) rawProgram.minimumPayoutAmount = dto.minimumPayoutAmount;
    if (dto.payoutSchedule !== undefined) rawProgram.payoutSchedule = dto.payoutSchedule;
    if (dto.payoutDay !== undefined) rawProgram.payoutDay = dto.payoutDay;
    if (dto.payoutMethods !== undefined) rawProgram.payoutMethods = dto.payoutMethods;
    if (dto.logoUrl !== undefined) rawProgram.logoUrl = dto.logoUrl;
    if (dto.bannerUrl !== undefined) rawProgram.bannerUrl = dto.bannerUrl;
    if (dto.visibility !== undefined) rawProgram.visibility = (dto.visibility || 'PUBLIC').toUpperCase();
    if (dto.shortDescription !== undefined) rawProgram.shortDescription = dto.shortDescription;
    if (dto.description !== undefined) rawProgram.description = dto.description;
    if (dto.category !== undefined) rawProgram.category = dto.category;
    if (dto.tags !== undefined) rawProgram.tags = dto.tags;
    if (dto.websiteUrl !== undefined) rawProgram.websiteUrl = dto.websiteUrl;
    if (dto.landingUrl !== undefined) rawProgram.landingUrl = dto.landingUrl;

    rawProgram.updatedAt = new Date();

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: AuditAction.PROGRAM_UPDATED,
      resourceType: 'program',
      resourceId: rawProgram.id,
      metadata: {
        previous,
        updates: dto,
        environment: rawProgram.environment,
      },
      createdAt: new Date(),
    });

    return {
      ...rawProgram,
      visibility: rawProgram.visibility || 'PUBLIC',
      affiliatesCount: program.affiliatesCount ?? 0,
    };
  }

  /**
   * "Copy to Live" Feature:
   * Clones program configuration from TEST into LIVE.
   * Copies metadata, commission rules, tiers, milestones, workflows.
   * Explicitly avoids copying clicks, conversions, commissions, or affiliates.
   */
  async copyToLive(
    organizationId: string,
    programId: string,
    actorId: string,
    options?: { newName?: string; newSlug?: string },
  ) {
    const source = await this.findOne(organizationId, programId);

    const liveSlug = (options?.newSlug || source.slug).toLowerCase().trim();
    const liveName = options?.newName || (source.environment === EnvironmentType.TEST ? source.name : `${source.name} (Live)`);

    // Check slug collision in LIVE
    const existing = dbStore.programs.find(
      (p) =>
        p.organizationId === organizationId &&
        p.environment === EnvironmentType.LIVE &&
        p.slug === liveSlug &&
        !p.deletedAt,
    );

    if (existing) {
      throw new BadRequestException(
        `A LIVE program with slug '${liveSlug}' already exists. Please provide a different slug.`,
      );
    }

    // Clone core program entity to LIVE
    const liveProgramId = uuidv4();
    const liveProgram: ProgramEntity = {
      ...source,
      id: liveProgramId,
      organizationId,
      environment: EnvironmentType.LIVE,
      name: liveName,
      slug: liveSlug,
      status: ProgramStatus.ACTIVE,
      createdBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.programs.push(liveProgram);

    // 1. Clone Commission Rules
    const sourceRules = dbStore.commissionRules.filter(
      (r) => r.organizationId === organizationId && r.programId === programId,
    );
    for (const rule of sourceRules) {
      dbStore.commissionRules.push({
        ...rule,
        id: uuidv4(),
        programId: liveProgramId,
        environment: EnvironmentType.LIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // 2. Clone Partner Tiers
    const sourceTiers = dbStore.partnerTiers.filter(
      (t) => t.organizationId === organizationId && t.programId === programId,
    );
    for (const tier of sourceTiers) {
      dbStore.partnerTiers.push({
        ...tier,
        id: uuidv4(),
        programId: liveProgramId,
        environment: EnvironmentType.LIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // 3. Clone Milestones
    const sourceMilestones = dbStore.milestones.filter(
      (m) => m.organizationId === organizationId && m.programId === programId,
    );
    for (const ms of sourceMilestones) {
      dbStore.milestones.push({
        ...ms,
        id: uuidv4(),
        programId: liveProgramId,
        environment: EnvironmentType.LIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // 4. Clone Automation Workflows
    const sourceWorkflows = dbStore.automationWorkflows.filter(
      (w) => w.organizationId === organizationId && w.programId === programId,
    );
    for (const wf of sourceWorkflows) {
      dbStore.automationWorkflows.push({
        ...wf,
        id: uuidv4(),
        programId: liveProgramId,
        environment: EnvironmentType.LIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Audit log
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: AuditAction.PROGRAM_CREATED,
      resourceType: 'program',
      resourceId: liveProgramId,
      metadata: {
        action: 'COPIED_TO_LIVE',
        sourceProgramId: programId,
        liveProgramId,
        clonedRulesCount: sourceRules.length,
        clonedTiersCount: sourceTiers.length,
        clonedMilestonesCount: sourceMilestones.length,
      },
      createdAt: new Date(),
    });

    return liveProgram;
  }

  async pause(organizationId: string, programId: string, actorId: string, environment?: EnvironmentType) {
    const program = await this.findOne(organizationId, programId, environment);
    program.status = ProgramStatus.PAUSED;
    program.updatedAt = new Date();
    this.audit(organizationId, actorId, 'PROGRAM_PAUSED', 'program', program.id, { name: program.name, environment: program.environment });
    return program;
  }

  async activate(organizationId: string, programId: string, actorId: string, environment?: EnvironmentType) {
    const program = await this.findOne(organizationId, programId, environment);
    program.status = ProgramStatus.ACTIVE;
    program.updatedAt = new Date();
    this.audit(organizationId, actorId, 'PROGRAM_ACTIVATED', 'program', program.id, { name: program.name, environment: program.environment });
    return program;
  }

  async remove(organizationId: string, programId: string, actorId: string, environment?: EnvironmentType) {
    const rawProgram = dbStore.programs.find((p) => p.id === programId && p.organizationId === organizationId && !p.deletedAt);
    if (!rawProgram) {
      throw new NotFoundException('Program not found in current environment context');
    }

    const hasAffiliates = dbStore.programAffiliates.some((pa) => pa.programId === programId && pa.status !== AffiliateStatus.REJECTED);
    if (hasAffiliates) {
      throw new BadRequestException('Cannot delete program with joined affiliates');
    }

    rawProgram.deletedAt = new Date();
    rawProgram.status = ProgramStatus.ARCHIVED;
    this.audit(organizationId, actorId, 'PROGRAM_ARCHIVED', 'program', rawProgram.id, { name: rawProgram.name, environment: rawProgram.environment });
    return { success: true, message: 'Program archived' };
  }

  private audit(
    organizationId: string,
    actorId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, any>,
  ) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: action as AuditAction,
      resourceType,
      resourceId,
      metadata,
      createdAt: new Date(),
    });
  }
}

