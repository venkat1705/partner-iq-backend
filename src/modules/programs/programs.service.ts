import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, ProgramEntity } from '../../database/store';
import { ProgramStatus, AuditAction } from '../../common/enums';
import { CreateProgramDto, UpdateProgramDto } from './dto/program.dto';

@Injectable()
export class ProgramsService {
  async create(organizationId: string, createdByUserId: string, dto: CreateProgramDto) {
    const slug = dto.slug.toLowerCase().trim();
    const payoutPolicy = (dto.policy?.payout || {}) as {
      minimumPayoutAmount?: number;
      payoutSchedule?: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'MANUAL';
      payoutDay?: string;
      payoutMethods?: string[];
    };

    const existing = dbStore.programs.find(
      (p) => p.organizationId === organizationId && p.slug === slug && !p.deletedAt,
    );

    if (existing) {
      throw new BadRequestException('Program with this slug already exists in organization');
    }

    const program: ProgramEntity = {
      id: uuidv4(),
      organizationId,
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
      createdAt: new Date(),
    });

    return program;
  }

  async findAll(organizationId: string) {
    return dbStore.programs.filter(
      (p) => p.organizationId === organizationId && !p.deletedAt,
    );
  }

  async findOne(organizationId: string, programId: string) {
    const program = dbStore.programs.find(
      (p) => p.id === programId && p.organizationId === organizationId && !p.deletedAt,
    );

    if (!program) {
      throw new NotFoundException('Program not found');
    }

    return program;
  }

  async update(organizationId: string, programId: string, dto: UpdateProgramDto, actorId: string) {
    const program = await this.findOne(organizationId, programId);
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
      },
      createdAt: new Date(),
    });

    return program;
  }

  async pause(organizationId: string, programId: string, actorId: string) {
    const program = await this.findOne(organizationId, programId);
    program.status = ProgramStatus.PAUSED;
    program.updatedAt = new Date();
    this.audit(organizationId, actorId, 'PROGRAM_PAUSED', 'program', program.id, { name: program.name });
    return program;
  }

  async activate(organizationId: string, programId: string, actorId: string) {
    const program = await this.findOne(organizationId, programId);
    program.status = ProgramStatus.ACTIVE;
    program.updatedAt = new Date();
    this.audit(organizationId, actorId, 'PROGRAM_ACTIVATED', 'program', program.id, { name: program.name });
    return program;
  }

  async remove(organizationId: string, programId: string, actorId: string) {
    const program = await this.findOne(organizationId, programId);
    // Prevent deletion/archival if any affiliates have joined this program
    const hasAffiliates = dbStore.programAffiliates.some((pa) => pa.programId === programId);
    if (hasAffiliates) {
      throw new BadRequestException('Cannot delete program with joined affiliates');
    }

    program.deletedAt = new Date();
    program.status = ProgramStatus.ARCHIVED;
    this.audit(organizationId, actorId, 'PROGRAM_ARCHIVED', 'program', program.id, { name: program.name });
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
