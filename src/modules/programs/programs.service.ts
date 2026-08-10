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
      status: ProgramStatus.ACTIVE,
      currency: dto.currency || 'USD',
      commissionType: dto.commissionType,
      defaultCommissionValue: dto.defaultCommissionValue ?? (dto.defaultCommissionRate || 10) * 100,
      attributionModel: dto.attributionModel,
      cookieDurationDays: dto.cookieDurationDays || 30,
      affiliateApprovalMode: dto.affiliateApprovalMode || 'AUTO',
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

    if (dto.name) program.name = dto.name;
    if (dto.defaultCommissionValue !== undefined) program.defaultCommissionValue = dto.defaultCommissionValue;
    if (dto.commissionType) program.commissionType = dto.commissionType;
    if (dto.attributionModel) program.attributionModel = dto.attributionModel;
    if (dto.cookieDurationDays !== undefined) program.cookieDurationDays = dto.cookieDurationDays;

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
