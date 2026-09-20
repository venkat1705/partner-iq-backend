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
import {
  ProgramAnalyticsQueryDto,
  BulkProgramActionDto,
  DuplicateProgramDto,
  ProgramAnalyticsOverview,
  ProgramPerformanceItem,
  ProgramDetailAnalytics,
  ProgramActivityLogItem,
  ProgramHealthSignal,
  ProgramLifecycleStage,
  ProgramTimeSeriesPoint,
  ProgramSetupChecklistItem,
} from './dto/program-analytics.dto';

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

  /**
   * Helper to parse date range from query params
   */
  private parseDateRange(period?: string, dateFrom?: string, dateTo?: string): { start: Date; end: Date; days: number } {
    const end = dateTo ? new Date(dateTo) : new Date();
    let start: Date;
    let days = 30;

    if (dateFrom) {
      start = new Date(dateFrom);
      days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    } else {
      switch (period) {
        case '7D':
          days = 7;
          start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '90D':
          days = 90;
          start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case '12M':
          days = 365;
          start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        case 'LIFETIME':
          days = 3650;
          start = new Date(0);
          break;
        case '30D':
        default:
          days = 30;
          start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }
    }
    return { start, end, days };
  }

  /**
   * Get 360-degree Program Analytics Overview, Bento KPIs, Health Signals, and Lifecycle Breakdown
   */
  async getAnalyticsOverview(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query?: ProgramAnalyticsQueryDto,
  ): Promise<ProgramAnalyticsOverview> {
    const { start, end, days } = this.parseDateRange(query?.period, query?.dateFrom, query?.dateTo);

    const programs = dbStore.programs.filter(
      (p) =>
        p.organizationId === organizationId &&
        (p.environment === environment || (!p.environment && environment === EnvironmentType.LIVE)) &&
        !p.deletedAt,
    );

    const programIds = new Set(programs.map((p) => p.id));
    if (query?.programId && programIds.has(query.programId)) {
      programIds.clear();
      programIds.add(query.programId);
    }

    const filteredPrograms = programs.filter((p) => programIds.has(p.id));

    const totalPrograms = filteredPrograms.length;
    const activePrograms = filteredPrograms.filter((p) => p.status === ProgramStatus.ACTIVE).length;
    const pausedPrograms = filteredPrograms.filter((p) => p.status === ProgramStatus.PAUSED).length;
    const draftPrograms = filteredPrograms.filter((p) => p.status === ProgramStatus.DRAFT).length;
    const archivedPrograms = filteredPrograms.filter((p) => p.status === ProgramStatus.ARCHIVED).length;
    const recruitingPrograms = filteredPrograms.filter(
      (p) => p.status === ProgramStatus.ACTIVE && (p.visibility || 'PUBLIC').toUpperCase() === 'PUBLIC',
    ).length;

    // Enrolled program affiliates
    const progAffiliates = dbStore.programAffiliates.filter(
      (pa) =>
        pa.organizationId === organizationId &&
        programIds.has(pa.programId) &&
        pa.status !== AffiliateStatus.REJECTED,
    );
    const uniqueAffiliateIds = new Set(progAffiliates.map((pa) => pa.affiliateId));
    const totalAffiliates = uniqueAffiliateIds.size;

    // Tracking links
    const trackingLinks = dbStore.trackingLinks.filter(
      (tl) => tl.organizationId === organizationId && programIds.has(tl.programId),
    );
    const trackingLinkIds = new Set(trackingLinks.map((tl) => tl.id));

    // Clicks in date range
    const clicks = dbStore.clicks.filter((cl) => {
      if (cl.organizationId !== organizationId) return false;
      const isMatched = (cl.programId && programIds.has(cl.programId)) || (cl.trackingLinkId && trackingLinkIds.has(cl.trackingLinkId));
      if (!isMatched) return false;
      const createdAt = new Date(cl.createdAt);
      return createdAt >= start && createdAt <= end;
    });
    const totalClicks = clicks.length;

    // Conversions in date range
    const conversions = dbStore.conversions.filter((c) => {
      if (c.organizationId !== organizationId) return false;
      if (!programIds.has(c.programId)) return false;
      const createdAt = new Date(c.createdAt);
      return createdAt >= start && createdAt <= end;
    });
    const totalConversions = conversions.length;

    let grossRevenueCents = 0;
    for (const c of conversions) {
      grossRevenueCents += Number(c.amount || 0);
    }
    const grossRevenue = grossRevenueCents / 100;

    // Active affiliates (affiliates who generated at least one conversion in period)
    const activeAffiliateIds = new Set(conversions.map((c) => c.affiliateId));
    const activeAffiliates = activeAffiliateIds.size;

    // Commissions for these conversions
    const conversionIds = new Set(conversions.map((c) => c.id));
    const commissions = dbStore.commissions.filter(
      (cm) => cm.organizationId === organizationId && (conversionIds.has(cm.conversionId) || programIds.has(cm.programId)),
    );

    let commissionGeneratedCents = 0;
    let pendingCommissionCents = 0;
    for (const cm of commissions) {
      const val = Number((cm as any).commissionAmount || (cm as any).amount || 0);
      commissionGeneratedCents += val;
      const status = String(cm.status || '').toUpperCase();
      if (status === 'PENDING' || status === 'HELD') {
        pendingCommissionCents += val;
      }
    }
    const commissionGenerated = commissionGeneratedCents / 100;
    const pendingCommission = pendingCommissionCents / 100;

    // Payouts for affiliates in this program
    const payoutItems = dbStore.payoutItems.filter(
      (pi) => pi.organizationId === organizationId && uniqueAffiliateIds.has(pi.affiliateId),
    );
    let totalPayoutsCents = 0;
    for (const pi of payoutItems) {
      totalPayoutsCents += Number(pi.amount || 0);
    }
    const totalPayouts = totalPayoutsCents / 100;

    const conversionRate = totalClicks > 0 ? Math.round((totalConversions / totalClicks) * 1000) / 10 : 0;
    const averageProgramRevenue = totalPrograms > 0 ? Math.round((grossRevenue / totalPrograms) * 100) / 100 : 0;

    // Operational Health Signals
    const healthSignals: ProgramHealthSignal[] = [];

    // 1. Programs with no affiliates
    const programsNoAffiliates = filteredPrograms.filter((p) => {
      const count = progAffiliates.filter((pa) => pa.programId === p.id).length;
      return count === 0 && p.status === ProgramStatus.ACTIVE;
    });
    if (programsNoAffiliates.length > 0) {
      healthSignals.push({
        id: 'no-affiliates',
        type: 'WARNING',
        title: 'Programs with no active affiliates',
        description: `${programsNoAffiliates.length} active program(s) have no enrolled affiliates yet. Invite partners or enable open recruitment.`,
        count: programsNoAffiliates.length,
        programIds: programsNoAffiliates.map((p) => p.id),
        actionLabel: 'Recruit Affiliates',
      });
    }

    // 2. Programs with pending applications
    const pendingApps = dbStore.affiliateApplications.filter(
      (app) => app.organizationId === organizationId && programIds.has(app.programId) && (app.status as string) === 'PENDING',
    );
    const pendingAppProgramIds = Array.from(new Set(pendingApps.map((a) => a.programId)));
    if (pendingApps.length > 0) {
      healthSignals.push({
        id: 'pending-applications',
        type: 'WARNING',
        title: 'Pending affiliate applications',
        description: `${pendingApps.length} partner application(s) awaiting review and approval across ${pendingAppProgramIds.length} program(s).`,
        count: pendingApps.length,
        programIds: pendingAppProgramIds,
        actionLabel: 'Review Applications',
      });
    }

    // 3. Programs with no tracking links
    const programsNoLinks = filteredPrograms.filter((p) => {
      const linksCount = trackingLinks.filter((tl) => tl.programId === p.id).length;
      return linksCount === 0 && p.status === ProgramStatus.ACTIVE;
    });
    if (programsNoLinks.length > 0) {
      healthSignals.push({
        id: 'no-links',
        type: 'INFO',
        title: 'Active programs missing tracking links',
        description: `${programsNoLinks.length} active program(s) do not have any tracking links configured yet.`,
        count: programsNoLinks.length,
        programIds: programsNoLinks.map((p) => p.id),
        actionLabel: 'Create Link',
      });
    }

    // 4. Programs with clicks but zero conversions
    const programsClicksNoConv = filteredPrograms.filter((p) => {
      const progClicks = clicks.filter((cl) => cl.programId === p.id).length;
      const progConv = conversions.filter((c) => c.programId === p.id).length;
      return progClicks >= 10 && progConv === 0;
    });
    if (programsClicksNoConv.length > 0) {
      healthSignals.push({
        id: 'clicks-no-conversions',
        type: 'WARNING',
        title: 'High traffic with zero conversions',
        description: `${programsClicksNoConv.length} program(s) have logged 10+ clicks without a single conversion. Review destination URL and attribution setup.`,
        count: programsClicksNoConv.length,
        programIds: programsClicksNoConv.map((p) => p.id),
        actionLabel: 'Inspect Attribution',
      });
    }

    // 5. Programs with pending commission liability
    if (pendingCommission > 0) {
      healthSignals.push({
        id: 'pending-commissions',
        type: 'INFO',
        title: 'Pending commission approvals',
        description: `${commissions.filter((c) => String(c.status).toUpperCase() === 'PENDING').length} commission records awaiting approval (${pendingCommission.toLocaleString()} ${filteredPrograms[0]?.currency || PLATFORM_CURRENCY}).`,
        count: commissions.filter((c) => String(c.status).toUpperCase() === 'PENDING').length,
        programIds: Array.from(programIds),
        actionLabel: 'Review Commissions',
      });
    }

    // 6. Paused programs
    if (pausedPrograms > 0) {
      healthSignals.push({
        id: 'paused-programs',
        type: 'INFO',
        title: 'Paused programs',
        description: `${pausedPrograms} partner program(s) are paused. Incoming traffic will not be attributed to inactive engines.`,
        count: pausedPrograms,
        programIds: filteredPrograms.filter((p) => p.status === ProgramStatus.PAUSED).map((p) => p.id),
        actionLabel: 'View Paused',
      });
    }

    // Lifecycle Distribution
    const totalOrOne = Math.max(1, totalPrograms);
    const lifecycleDistribution: ProgramLifecycleStage[] = [
      {
        stage: 'DRAFT',
        label: 'Draft',
        count: draftPrograms,
        percentage: Math.round((draftPrograms / totalOrOne) * 100),
      },
      {
        stage: 'CONFIGURED',
        label: 'Configured',
        count: filteredPrograms.filter((p) => p.logoUrl && p.description).length,
        percentage: Math.round((filteredPrograms.filter((p) => p.logoUrl && p.description).length / totalOrOne) * 100),
      },
      {
        stage: 'PUBLISHED',
        label: 'Published',
        count: filteredPrograms.filter((p) => (p.visibility || 'PUBLIC').toUpperCase() === 'PUBLIC').length,
        percentage: Math.round(
          (filteredPrograms.filter((p) => (p.visibility || 'PUBLIC').toUpperCase() === 'PUBLIC').length / totalOrOne) * 100,
        ),
      },
      {
        stage: 'RECRUITING',
        label: 'Recruiting',
        count: recruitingPrograms,
        percentage: Math.round((recruitingPrograms / totalOrOne) * 100),
      },
      {
        stage: 'ACTIVE',
        label: 'Active',
        count: activePrograms,
        percentage: Math.round((activePrograms / totalOrOne) * 100),
      },
      {
        stage: 'PAUSED',
        label: 'Paused',
        count: pausedPrograms,
        percentage: Math.round((pausedPrograms / totalOrOne) * 100),
      },
      {
        stage: 'ARCHIVED',
        label: 'Archived',
        count: archivedPrograms,
        percentage: Math.round((archivedPrograms / totalOrOne) * 100),
      },
    ];

    // Activity Time Series (day buckets across date range)
    const bucketCount = Math.min(days, 30);
    const bucketIntervalMs = (end.getTime() - start.getTime()) / bucketCount;
    const activityTrend: ProgramTimeSeriesPoint[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const bStart = new Date(start.getTime() + i * bucketIntervalMs);
      const bEnd = new Date(start.getTime() + (i + 1) * bucketIntervalMs);
      const dateKey = bStart.toISOString().split('T')[0];

      const bConvs = conversions.filter((c) => {
        const d = new Date(c.createdAt);
        return d >= bStart && d < bEnd;
      });
      const bClicks = clicks.filter((cl) => {
        const d = new Date(cl.createdAt);
        return d >= bStart && d < bEnd;
      });
      const bComms = commissions.filter((cm) => {
        const d = new Date(cm.createdAt);
        return d >= bStart && d < bEnd;
      });
      const bAffs = progAffiliates.filter((pa) => {
        const d = new Date((pa as any).joinedAt || (pa as any).createdAt || 0);
        return d >= bStart && d < bEnd;
      });

      const bRev = bConvs.reduce((sum, c) => sum + Number(c.amount || 0), 0) / 100;
      const bComm = bComms.reduce((sum, cm) => sum + Number((cm as any).commissionAmount || (cm as any).amount || 0), 0) / 100;

      activityTrend.push({
        date: dateKey,
        revenue: Math.round(bRev * 100) / 100,
        conversions: bConvs.length,
        commission: Math.round(bComm * 100) / 100,
        clicks: bClicks.length,
        affiliates: bAffs.length,
        payouts: 0,
      });
    }

    return {
      totalPrograms,
      activePrograms,
      pausedPrograms,
      draftPrograms,
      archivedPrograms,
      recruitingPrograms,
      totalAffiliates,
      activeAffiliates,
      totalConversions,
      totalClicks,
      conversionRate,
      grossRevenue,
      commissionGenerated,
      pendingCommission,
      totalPayouts,
      averageProgramRevenue,
      healthSignals,
      lifecycleDistribution,
      activityTrend,
    };
  }

  /**
   * Get Per-Program Performance Analytics Table
   */
  async getPerformanceAnalytics(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query?: ProgramAnalyticsQueryDto,
  ): Promise<ProgramPerformanceItem[]> {
    const { start, end } = this.parseDateRange(query?.period, query?.dateFrom, query?.dateTo);

    let programs = dbStore.programs.filter(
      (p) =>
        p.organizationId === organizationId &&
        (p.environment === environment || (!p.environment && environment === EnvironmentType.LIVE)) &&
        !p.deletedAt,
    );

    if (query?.status && query.status.toUpperCase() !== 'ALL') {
      programs = programs.filter((p) => p.status === query.status);
    }
    if (query?.type && query.type.toUpperCase() !== 'ALL') {
      programs = programs.filter((p) => p.type === query.type);
    }
    if (query?.programId && query.programId.toUpperCase() !== 'ALL') {
      programs = programs.filter((p) => p.id === query.programId);
    }

    const performanceItems: ProgramPerformanceItem[] = programs.map((program) => {
      const explicitAffiliates = dbStore.programAffiliates.filter(
        (pa) =>
          pa.programId === program.id &&
          (pa.organizationId === organizationId || !pa.organizationId) &&
          pa.status !== AffiliateStatus.REJECTED,
      );
      const affiliatesCount = explicitAffiliates.length;

      const links = dbStore.trackingLinks.filter(
        (tl) => tl.programId === program.id && tl.organizationId === organizationId,
      );
      const trackingLinksCount = links.length;

      const linkIds = new Set(links.map((l) => l.id));
      const clicks = dbStore.clicks.filter((cl) => {
        if (cl.organizationId !== organizationId) return false;
        const matches = cl.programId === program.id || (cl.trackingLinkId && linkIds.has(cl.trackingLinkId));
        if (!matches) return false;
        const d = new Date(cl.createdAt);
        return d >= start && d <= end;
      });
      const clicksCount = clicks.length;

      const conversions = dbStore.conversions.filter((c) => {
        if (c.organizationId !== organizationId || c.programId !== program.id) return false;
        const d = new Date(c.createdAt);
        return d >= start && d <= end;
      });
      const conversionsCount = conversions.length;

      let revenueCents = 0;
      for (const c of conversions) {
        revenueCents += Number(c.amount || 0);
      }
      const revenue = revenueCents / 100;

      const activeAffiliateIds = new Set(conversions.map((c) => c.affiliateId));
      const activeAffiliatesCount = activeAffiliateIds.size;

      const convIds = new Set(conversions.map((c) => c.id));
      const commissions = dbStore.commissions.filter(
        (cm) => cm.organizationId === organizationId && (convIds.has(cm.conversionId) || cm.programId === program.id),
      );

      let commCents = 0;
      let pendingCents = 0;
      for (const cm of commissions) {
        const val = Number((cm as any).commissionAmount || (cm as any).amount || 0);
        commCents += val;
        const status = String(cm.status || '').toUpperCase();
        if (status === 'PENDING' || status === 'HELD') {
          pendingCents += val;
        }
      }
      const commission = commCents / 100;
      const pendingCommission = pendingCents / 100;

      const affiliateIds = new Set(explicitAffiliates.map((pa) => pa.affiliateId));
      const payoutsItems = dbStore.payoutItems.filter(
        (pi) => pi.organizationId === organizationId && affiliateIds.has(pi.affiliateId),
      );
      const payouts = payoutsItems.reduce((sum, pi) => sum + Number(pi.amount || 0), 0) / 100;

      const conversionRate = clicksCount > 0 ? Math.round((conversionsCount / clicksCount) * 1000) / 10 : 0;

      // Setup completion score (out of 100)
      let score = 0;
      if (program.name) score += 15;
      if (program.slug) score += 15;
      if (program.description || program.shortDescription) score += 15;
      if (program.logoUrl || program.bannerUrl) score += 15;
      if (program.defaultCommissionValue !== undefined) score += 15;
      if (program.cookieDurationDays) score += 10;
      if (program.websiteUrl || program.landingUrl) score += 15;
      const setupCompletionScore = Math.min(100, score);

      let healthStatus: 'HEALTHY' | 'NEEDS_ATTENTION' | 'DRAFT' | 'INACTIVE' = 'HEALTHY';
      if (program.status === ProgramStatus.DRAFT) {
        healthStatus = 'DRAFT';
      } else if (program.status === ProgramStatus.PAUSED || program.status === ProgramStatus.ARCHIVED) {
        healthStatus = 'INACTIVE';
      } else if (affiliatesCount === 0 || (clicksCount > 10 && conversionsCount === 0) || setupCompletionScore < 60) {
        healthStatus = 'NEEDS_ATTENTION';
      }

      return {
        id: program.id,
        name: program.name,
        slug: program.slug,
        type: program.type,
        status: program.status,
        visibility: program.visibility || 'PUBLIC',
        currency: program.currency || PLATFORM_CURRENCY,
        commissionType: program.commissionType,
        defaultCommissionValue: program.defaultCommissionValue ?? 0,
        createdAt: new Date(program.createdAt).toISOString(),
        updatedAt: new Date(program.updatedAt).toISOString(),
        affiliatesCount,
        activeAffiliatesCount,
        trackingLinksCount,
        clicksCount,
        conversionsCount,
        revenue,
        commission,
        pendingCommission,
        payouts,
        conversionRate,
        healthStatus,
        setupCompletionScore,
      };
    });

    if (query?.sortBy) {
      switch (query.sortBy) {
        case 'revenue':
          performanceItems.sort((a, b) => b.revenue - a.revenue);
          break;
        case 'conversions':
          performanceItems.sort((a, b) => b.conversionsCount - a.conversionsCount);
          break;
        case 'affiliates':
          performanceItems.sort((a, b) => b.affiliatesCount - a.affiliatesCount);
          break;
        case 'name':
          performanceItems.sort((a, b) => a.name.localeCompare(b.name));
          break;
      }
    }

    return performanceItems;
  }

  /**
   * Get Deep Single-Program Intelligence Dossier
   */
  async getProgramDetailAnalytics(
    organizationId: string,
    programId: string,
    environment?: EnvironmentType,
  ): Promise<ProgramDetailAnalytics> {
    const program = await this.findOne(organizationId, programId, environment);

    const progAffiliates = dbStore.programAffiliates.filter(
      (pa) =>
        pa.programId === program.id &&
        (pa.organizationId === organizationId || !pa.organizationId) &&
        pa.status !== AffiliateStatus.REJECTED,
    );

    const links = dbStore.trackingLinks.filter(
      (tl) => tl.programId === program.id && tl.organizationId === organizationId,
    );
    const linkIds = new Set(links.map((l) => l.id));

    const clicks = dbStore.clicks.filter((cl) => {
      if (cl.organizationId !== organizationId) return false;
      return cl.programId === program.id || (cl.trackingLinkId && linkIds.has(cl.trackingLinkId));
    });

    const conversions = dbStore.conversions.filter(
      (c) => c.organizationId === organizationId && c.programId === program.id,
    );

    let revenueCents = 0;
    for (const c of conversions) {
      revenueCents += Number(c.amount || 0);
    }
    const revenue = revenueCents / 100;

    const convIds = new Set(conversions.map((c) => c.id));
    const commissions = dbStore.commissions.filter(
      (cm) => cm.organizationId === organizationId && (convIds.has(cm.conversionId) || cm.programId === program.id),
    );

    let commCents = 0;
    let pendingCents = 0;
    for (const cm of commissions) {
      const val = Number((cm as any).commissionAmount || (cm as any).amount || 0);
      commCents += val;
      const status = String(cm.status || '').toUpperCase();
      if (status === 'PENDING' || status === 'HELD') {
        pendingCents += val;
      }
    }
    const commission = commCents / 100;
    const pendingCommission = pendingCents / 100;

    const affIds = new Set(progAffiliates.map((pa) => pa.affiliateId));
    const payoutsItems = dbStore.payoutItems.filter(
      (pi) => pi.organizationId === organizationId && affIds.has(pi.affiliateId),
    );
    const payouts = payoutsItems.reduce((sum, pi) => sum + Number(pi.amount || 0), 0) / 100;

    const activeAffiliates = new Set(conversions.map((c) => c.affiliateId)).size;
    const conversionRate = clicks.length > 0 ? Math.round((conversions.length / clicks.length) * 1000) / 10 : 0;
    const averageOrderValue = conversions.length > 0 ? Math.round((revenue / conversions.length) * 100) / 100 : 0;

    // Top Affiliates
    const affiliateMap = new Map<string, { conversions: number; revenue: number; commission: number }>();
    for (const c of conversions) {
      const entry = affiliateMap.get(c.affiliateId) || { conversions: 0, revenue: 0, commission: 0 };
      entry.conversions++;
      entry.revenue += Number(c.amount || 0) / 100;
      affiliateMap.set(c.affiliateId, entry);
    }
    for (const cm of commissions) {
      const affId = (cm as any).affiliateId;
      if (affId && affiliateMap.has(affId)) {
        const entry = affiliateMap.get(affId)!;
        entry.commission += Number((cm as any).commissionAmount || (cm as any).amount || 0) / 100;
      }
    }

    const topAffiliates = Array.from(affiliateMap.entries())
      .map(([id, data]) => {
        const aff = dbStore.affiliates.find((a) => a.id === id);
        return {
          id,
          displayName: aff?.displayName || aff?.companyName || 'Affiliate Partner',
          email: aff?.email || '',
          conversions: data.conversions,
          revenue: Math.round(data.revenue * 100) / 100,
          commission: Math.round(data.commission * 100) / 100,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Recent Conversions
    const recentConversions = conversions
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)
      .map((c) => {
        const aff = dbStore.affiliates.find((a) => a.id === c.affiliateId);
        const comm = commissions.find((cm) => cm.conversionId === c.id);
        return {
          id: c.id,
          amount: Number(c.amount || 0) / 100,
          commissionAmount: Number((comm as any)?.commissionAmount || (comm as any)?.amount || 0) / 100,
          status: c.status,
          affiliateName: aff?.displayName || aff?.companyName || 'Partner',
          createdAt: new Date(c.createdAt).toISOString(),
        };
      });

    // Tracking links summary
    const trackingLinksSummary = links.slice(0, 10).map((tl) => {
      const lClicks = clicks.filter((cl) => cl.trackingLinkId === tl.id).length;
      const lConvs = conversions.filter((c) => (c as any).trackingLinkId === tl.id).length;
      return {
        id: tl.id,
        shortCode: (tl as any).shortCode || (tl as any).code || tl.id.slice(0, 8),
        destinationUrl: tl.destinationUrl || '',
        clicks: lClicks,
        conversions: lConvs,
      };
    });

    // Setup Checklist
    const setupChecklist: ProgramSetupChecklistItem[] = [
      {
        key: 'basic_info',
        label: 'Basic Program Information',
        completed: Boolean(program.name && program.slug && (program.description || program.shortDescription)),
        description: 'Program name, slug, description, and category details.',
      },
      {
        key: 'branding',
        label: 'Branding & Assets',
        completed: Boolean(program.logoUrl || program.bannerUrl),
        description: 'Visual identity, logo, and cover graphics for partner portals.',
      },
      {
        key: 'commission',
        label: 'Commission Rules Engine',
        completed: Boolean(program.defaultCommissionValue !== undefined && program.commissionType),
        description: 'Default conversion rate, basis points, and payout structure.',
      },
      {
        key: 'attribution',
        label: 'Attribution & Cookie Window',
        completed: Boolean(program.attributionModel && program.cookieDurationDays),
        description: `${program.attributionModel} with ${program.cookieDurationDays || 30} days window.`,
      },
      {
        key: 'recruitment',
        label: 'Partner Recruitment',
        completed: progAffiliates.length > 0,
        description: `${progAffiliates.length} partner(s) currently enrolled.`,
      },
      {
        key: 'tracking',
        label: 'Tracking Link Infrastructure',
        completed: links.length > 0,
        description: `${links.length} referral link(s) configured.`,
      },
    ];

    // Health issues
    const healthIssues: string[] = [];
    if (progAffiliates.length === 0) healthIssues.push('No enrolled affiliates in this program.');
    if (links.length === 0) healthIssues.push('No tracking links generated for this program.');
    if (clicks.length > 10 && conversions.length === 0) healthIssues.push('High click traffic with zero conversions.');
    if (pendingCommission > 0) healthIssues.push(`Pending commission liability: ${pendingCommission.toFixed(2)}.`);

    const commissionRulesCount = dbStore.commissionRules.filter(
      (r) => r.organizationId === organizationId && r.programId === program.id,
    ).length;
    const partnerTiersCount = dbStore.partnerTiers.filter(
      (t) => t.organizationId === organizationId && t.programId === program.id,
    ).length;
    const milestonesCount = dbStore.milestones.filter(
      (m) => m.organizationId === organizationId && m.programId === program.id,
    ).length;

    // 30-day time series for this program
    const now = new Date();
    const start30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const timeSeries: ProgramTimeSeriesPoint[] = [];
    for (let i = 0; i < 30; i++) {
      const bStart = new Date(start30.getTime() + i * 24 * 60 * 60 * 1000);
      const bEnd = new Date(start30.getTime() + (i + 1) * 24 * 60 * 60 * 1000);
      const dateKey = bStart.toISOString().split('T')[0];

      const bConvs = conversions.filter((c) => {
        const d = new Date(c.createdAt);
        return d >= bStart && d < bEnd;
      });
      const bClicks = clicks.filter((cl) => {
        const d = new Date(cl.createdAt);
        return d >= bStart && d < bEnd;
      });
      const bComms = commissions.filter((cm) => {
        const d = new Date(cm.createdAt);
        return d >= bStart && d < bEnd;
      });

      timeSeries.push({
        date: dateKey,
        revenue: Math.round(bConvs.reduce((sum, c) => sum + Number(c.amount || 0), 0) / 100),
        conversions: bConvs.length,
        commission: Math.round(bComms.reduce((sum, cm) => sum + Number((cm as any).commissionAmount || (cm as any).amount || 0), 0) / 100),
        clicks: bClicks.length,
        affiliates: 0,
        payouts: 0,
      });
    }

    return {
      program,
      metrics: {
        affiliates: progAffiliates.length,
        activeAffiliates,
        trackingLinks: links.length,
        clicks: clicks.length,
        conversions: conversions.length,
        revenue,
        commission,
        pendingCommission,
        payouts,
        conversionRate,
        averageOrderValue,
      },
      healthIssues,
      setupChecklist,
      topAffiliates,
      recentConversions,
      trackingLinks: trackingLinksSummary,
      commissionRulesCount,
      partnerTiersCount,
      milestonesCount,
      timeSeries,
    };
  }

  /**
   * Get Program Activity / Audit Log Trail
   */
  async getActivityLog(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    programId?: string,
  ): Promise<ProgramActivityLogItem[]> {
    const logs = dbStore.auditLogs.filter((log) => {
      if (log.organizationId !== organizationId) return false;
      if (log.resourceType !== 'program') return false;
      if (programId && log.resourceId !== programId) return false;
      return true;
    });

    return logs
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50)
      .map((log) => {
        const user = dbStore.users.find((u) => u.id === log.actorId);
        const prog = dbStore.programs.find((p) => p.id === log.resourceId);
        return {
          id: log.id,
          action: log.action,
          actorId: log.actorId,
          actorName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'System Admin',
          programId: log.resourceId,
          programName: prog?.name || log.metadata?.name || 'Program',
          metadata: log.metadata,
          createdAt: new Date(log.createdAt).toISOString(),
        };
      });
  }

  /**
   * Safe Program Duplication (Clones metadata & rules without copying historical stats or affiliates)
   */
  async duplicateProgram(
    organizationId: string,
    programId: string,
    actorId: string,
    dto: DuplicateProgramDto,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    const source = await this.findOne(organizationId, programId, environment);

    const newSlug = dto.newSlug.toLowerCase().trim();
    const existing = dbStore.programs.find(
      (p) =>
        p.organizationId === organizationId &&
        p.environment === environment &&
        p.slug === newSlug &&
        !p.deletedAt,
    );

    if (existing) {
      throw new BadRequestException(`A program with slug '${newSlug}' already exists.`);
    }

    const newProgramId = uuidv4();
    const clonedProgram: ProgramEntity = {
      ...source,
      id: newProgramId,
      name: dto.newName.trim(),
      slug: newSlug,
      status: ProgramStatus.DRAFT,
      createdBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: undefined,
    };

    dbStore.programs.push(clonedProgram);

    // Copy rules if selected
    if (dto.copyRules !== false) {
      const rules = dbStore.commissionRules.filter(
        (r) => r.organizationId === organizationId && r.programId === programId,
      );
      for (const rule of rules) {
        dbStore.commissionRules.push({
          ...rule,
          id: uuidv4(),
          programId: newProgramId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    // Copy tiers if selected
    if (dto.copyTiers !== false) {
      const tiers = dbStore.partnerTiers.filter(
        (t) => t.organizationId === organizationId && t.programId === programId,
      );
      for (const tier of tiers) {
        dbStore.partnerTiers.push({
          ...tier,
          id: uuidv4(),
          programId: newProgramId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    // Copy milestones if selected
    if (dto.copyMilestones !== false) {
      const milestones = dbStore.milestones.filter(
        (m) => m.organizationId === organizationId && m.programId === programId,
      );
      for (const ms of milestones) {
        dbStore.milestones.push({
          ...ms,
          id: uuidv4(),
          programId: newProgramId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    this.audit(organizationId, actorId, 'PROGRAM_DUPLICATED', 'program', newProgramId, {
      sourceProgramId: programId,
      newName: dto.newName,
      newSlug,
    });

    return clonedProgram;
  }

  /**
   * Bulk Program Management (ACTIVATE, PAUSE, ARCHIVE)
   */
  async bulkAction(
    organizationId: string,
    actorId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    dto: BulkProgramActionDto,
  ) {
    if (!dto.programIds?.length) {
      throw new BadRequestException('No program IDs specified for bulk action.');
    }

    let updatedCount = 0;
    for (const progId of dto.programIds) {
      const prog = dbStore.programs.find(
        (p) =>
          p.id === progId &&
          p.organizationId === organizationId &&
          (p.environment === environment || (!p.environment && environment === EnvironmentType.LIVE)) &&
          !p.deletedAt,
      );
      if (!prog) continue;

      if (dto.action === 'ACTIVATE') {
        prog.status = ProgramStatus.ACTIVE;
        prog.updatedAt = new Date();
        this.audit(organizationId, actorId, 'PROGRAM_ACTIVATED', 'program', prog.id, { bulk: true });
        updatedCount++;
      } else if (dto.action === 'PAUSE') {
        prog.status = ProgramStatus.PAUSED;
        prog.updatedAt = new Date();
        this.audit(organizationId, actorId, 'PROGRAM_PAUSED', 'program', prog.id, { bulk: true });
        updatedCount++;
      } else if (dto.action === 'ARCHIVE') {
        prog.status = ProgramStatus.ARCHIVED;
        prog.deletedAt = new Date();
        prog.updatedAt = new Date();
        this.audit(organizationId, actorId, 'PROGRAM_ARCHIVED', 'program', prog.id, { bulk: true });
        updatedCount++;
      }
    }

    return {
      success: true,
      action: dto.action,
      updatedCount,
      message: `Successfully executed ${dto.action} across ${updatedCount} partner program(s).`,
    };
  }
}

