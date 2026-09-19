import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, MilestoneEntity } from '../../../database/store';
import { CreateMilestoneDto, UpdateMilestoneDto } from '../dto/milestone.dto';
import { AuditAction, GamificationMetric, MilestoneResetBehavior, MilestoneRewardType } from '../../../common/enums';
import { assertMilestoneNotClickCompensated } from '../../../common/invariants/click-compensation.invariant';

@Injectable()
export class MilestoneService {
  async createMilestone(
    organizationId: string,
    dto: CreateMilestoneDto,
    actorId?: string,
  ): Promise<MilestoneEntity> {
    if (dto.programId) {
      const program = dbStore.programs.find(
        (p) => p.id === dto.programId && p.organizationId === organizationId && !p.deletedAt,
      );
      if (!program) {
        throw new NotFoundException('Program not found');
      }
    }

    const code = dto.code.trim().toUpperCase();
    const existing = dbStore.milestones.find(
      (m) =>
        m.organizationId === organizationId &&
        (m.programId || null) === (dto.programId || null) &&
        m.code === code,
    );

    if (existing) {
      throw new BadRequestException(`A milestone with code '${code}' already exists in this program scope.`);
    }

    // CLICK != COMMISSION — a cash bonus may not be gated on raw click volume.
    assertMilestoneNotClickCompensated({
      metric: dto.metric || GamificationMetric.APPROVED_CONVERSIONS,
      rewardType: dto.rewardType || MilestoneRewardType.BADGE,
      rewardConfig: dto.rewardConfig,
    });

    const milestone: MilestoneEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      name: dto.name.trim(),
      code,
      description: dto.description,
      metric: dto.metric || GamificationMetric.APPROVED_CONVERSIONS,
      operator: dto.operator || 'GREATER_THAN_OR_EQUAL',
      targetValue: dto.targetValue,
      secondaryValue: dto.secondaryValue,
      period: dto.period || 'LIFETIME',
      resetBehavior: dto.resetBehavior || MilestoneResetBehavior.NONE,
      isRepeatable: Boolean(dto.isRepeatable),
      repeatInterval: dto.repeatInterval,
      rewardType: dto.rewardType || MilestoneRewardType.BADGE,
      rewardConfig: dto.rewardConfig || {},
      badgeIcon: dto.badgeIcon || 'award',
      badgeName: dto.badgeName || dto.name,
      isActive: dto.isActive !== undefined ? dto.isActive : true,
      displayOrder: dto.displayOrder ?? 0,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      createdBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.milestones.push(milestone);

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.MILESTONE_CREATED,
      resourceType: 'milestone',
      resourceId: milestone.id,
      metadata: { name: milestone.name, targetValue: milestone.targetValue, metric: milestone.metric },
      createdAt: new Date(),
    });

    return milestone;
  }

  async getMilestones(organizationId: string, programId?: string) {
    const milestones = dbStore.milestones
      .filter((m) => m.organizationId === organizationId && (!programId || !m.programId || m.programId === programId))
      .sort((a, b) => a.displayOrder - b.displayOrder);

    return milestones.map((m) => {
      const achievements = dbStore.affiliateMilestoneAchievements.filter(
        (a) => a.organizationId === organizationId && a.milestoneId === m.id,
      );
      return {
        ...m,
        achieverCount: new Set(achievements.map((a) => a.affiliateId)).size,
        totalAchievements: achievements.length,
      };
    });
  }

  async getMilestone(organizationId: string, id: string): Promise<MilestoneEntity> {
    const milestone = dbStore.milestones.find(
      (m) => m.id === id && m.organizationId === organizationId,
    );
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    return milestone;
  }

  async updateMilestone(
    organizationId: string,
    id: string,
    dto: UpdateMilestoneDto,
    actorId?: string,
  ): Promise<MilestoneEntity> {
    const milestone = await this.getMilestone(organizationId, id);

    // Validate the *resulting* configuration, not just the fields in this patch —
    // adding a bonus to an existing click milestone and switching an existing bonus
    // milestone over to a click metric are the same violation from opposite sides.
    assertMilestoneNotClickCompensated({
      metric: dto.metric ?? milestone.metric,
      rewardType: dto.rewardType ?? milestone.rewardType,
      rewardConfig: dto.rewardConfig !== undefined ? dto.rewardConfig : milestone.rewardConfig,
    });

    if (dto.name) milestone.name = dto.name.trim();
    if (dto.description !== undefined) milestone.description = dto.description;
    if (dto.metric) milestone.metric = dto.metric;
    if (dto.operator) milestone.operator = dto.operator;
    if (dto.targetValue !== undefined) milestone.targetValue = dto.targetValue;
    if (dto.secondaryValue !== undefined) milestone.secondaryValue = dto.secondaryValue;
    if (dto.period) milestone.period = dto.period;
    if (dto.resetBehavior) milestone.resetBehavior = dto.resetBehavior;
    if (dto.isRepeatable !== undefined) milestone.isRepeatable = dto.isRepeatable;
    if (dto.repeatInterval !== undefined) milestone.repeatInterval = dto.repeatInterval;
    if (dto.rewardType) milestone.rewardType = dto.rewardType;
    if (dto.rewardConfig !== undefined) milestone.rewardConfig = dto.rewardConfig;
    if (dto.badgeIcon !== undefined) milestone.badgeIcon = dto.badgeIcon;
    if (dto.badgeName !== undefined) milestone.badgeName = dto.badgeName;
    if (dto.isActive !== undefined) milestone.isActive = dto.isActive;
    if (dto.displayOrder !== undefined) milestone.displayOrder = dto.displayOrder;
    if (dto.startDate !== undefined) milestone.startDate = dto.startDate ? new Date(dto.startDate) : undefined;
    if (dto.endDate !== undefined) milestone.endDate = dto.endDate ? new Date(dto.endDate) : undefined;
    milestone.updatedBy = actorId;
    milestone.updatedAt = new Date();

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.MILESTONE_UPDATED,
      resourceType: 'milestone',
      resourceId: milestone.id,
      metadata: { name: milestone.name, targetValue: milestone.targetValue },
      createdAt: new Date(),
    });

    return milestone;
  }

  async deleteMilestone(organizationId: string, id: string, actorId?: string): Promise<{ success: boolean }> {
    const index = dbStore.milestones.findIndex(
      (m) => m.id === id && m.organizationId === organizationId,
    );
    if (index === -1) {
      throw new NotFoundException('Milestone not found');
    }

    const [deleted] = dbStore.milestones.splice(index, 1);

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.MILESTONE_DEACTIVATED,
      resourceType: 'milestone',
      resourceId: deleted.id,
      metadata: { name: deleted.name },
      createdAt: new Date(),
    });

    return { success: true };
  }

  async getMilestoneAchievements(organizationId: string, milestoneId: string) {
    const achievements = dbStore.affiliateMilestoneAchievements.filter(
      (a) => a.organizationId === organizationId && a.milestoneId === milestoneId,
    );

    return achievements.map((a) => {
      const affiliate = dbStore.affiliates.find((aff) => aff.id === a.affiliateId);
      return {
        ...a,
        affiliate: affiliate
          ? { id: affiliate.id, displayName: affiliate.displayName, email: affiliate.email }
          : null,
      };
    });
  }
}
