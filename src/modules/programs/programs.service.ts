import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, ProgramEntity } from '../../database/store';
import { ProgramStatus, AuditAction, EnvironmentType } from '../../common/enums';
import { CreateProgramDto, UpdateProgramDto } from './dto/program.dto';
import { EnvironmentUtils } from '../../common/utils/environment.utils';

@Injectable()
export class ProgramsService {
  async create(
    organizationId: string,
    createdByUserId: string,
    dto: CreateProgramDto,
    environment: EnvironmentType = EnvironmentType.LIVE,
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
      currency: dto.currency || 'INR',
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
      createdBy: createdByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.programs.push(program);

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
      },
      createdAt: new Date(),
    });

    return program;
  }

  async findAll(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    return dbStore.programs.filter(
      (p) =>
        p.organizationId === organizationId &&
        (p.environment === environment || (!p.environment && environment === EnvironmentType.LIVE)) &&
        !p.deletedAt,
    );
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

    return program;
  }

  async update(
    organizationId: string,
    programId: string,
    dto: UpdateProgramDto,
    actorId: string,
    environment?: EnvironmentType,
  ) {
    const program = await this.findOne(organizationId, programId, environment);
    const previous = { ...program };

    // Prevent edits if any affiliates have already joined this program
    const hasAffiliates = dbStore.programAffiliates.some((pa) => pa.programId === programId);
    if (hasAffiliates) {
      throw new BadRequestException('Cannot edit program after affiliates have joined');
    }

    if (dto.name) program.name = dto.name;
    if (dto.defaultCommissionValue !== undefined) program.defaultCommissionValue = dto.defaultCommissionValue;
    if (dto.commissionType) program.commissionType = dto.commissionType;
    if (dto.attributionModel) program.attributionModel = dto.attributionModel;
    if (dto.attributionWindowDays !== undefined) program.attributionWindowDays = dto.attributionWindowDays;
    if (dto.cookieDurationDays !== undefined) program.cookieDurationDays = dto.cookieDurationDays;
    if (dto.couponAttributionPriority !== undefined) program.couponAttributionPriority = dto.couponAttributionPriority;
    if (dto.attributionConfig !== undefined) program.attributionConfig = dto.attributionConfig;
    if (dto.minimumPayoutAmount !== undefined) program.minimumPayoutAmount = dto.minimumPayoutAmount;
    if (dto.payoutSchedule !== undefined) program.payoutSchedule = dto.payoutSchedule;
    if (dto.payoutDay !== undefined) program.payoutDay = dto.payoutDay;
    if (dto.payoutMethods !== undefined) program.payoutMethods = dto.payoutMethods;
    if (dto.logoUrl !== undefined) program.logoUrl = dto.logoUrl;
    if (dto.bannerUrl !== undefined) program.bannerUrl = dto.bannerUrl;

    program.updatedAt = new Date();

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: AuditAction.PROGRAM_UPDATED,
      resourceType: 'program',
      resourceId: program.id,
      metadata: {
        previous,
        updates: dto,
        environment: program.environment,
      },
      createdAt: new Date(),
    });

    return program;
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
    const program = await this.findOne(organizationId, programId, environment);
    const hasAffiliates = dbStore.programAffiliates.some((pa) => pa.programId === programId);
    if (hasAffiliates) {
      throw new BadRequestException('Cannot delete program with joined affiliates');
    }

    program.deletedAt = new Date();
    program.status = ProgramStatus.ARCHIVED;
    this.audit(organizationId, actorId, 'PROGRAM_ARCHIVED', 'program', program.id, { name: program.name, environment: program.environment });
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

