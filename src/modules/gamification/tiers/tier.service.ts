import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  dbStore,
  PartnerTierEntity,
  AffiliateTierEntity,
  AffiliateTierHistoryEntity,
} from '../../../database/store';
import {
  CreatePartnerTierDto,
  UpdatePartnerTierDto,
  AssignTierDto,
  LockTierDto,
} from '../dto/tier.dto';
import {
  AuditAction,
  TierTransitionType,
  TierEvaluationPeriod,
  TierDowngradeMode,
  CommissionRateEffectiveStrategy,
} from '../../../common/enums';
import { TierEvaluatorService } from './tier-evaluator.service';

@Injectable()
export class TierService {
  private readonly logger = new Logger(TierService.name);

  constructor(private readonly tierEvaluator: TierEvaluatorService) {}

  async createTier(organizationId: string, dto: CreatePartnerTierDto, actorId?: string): Promise<PartnerTierEntity> {
    if (dto.programId) {
      const program = dbStore.programs.find(
        (p) => p.id === dto.programId && p.organizationId === organizationId && !p.deletedAt,
      );
      if (!program) {
        throw new NotFoundException('Program not found');
      }
    }

    const code = dto.code.trim().toUpperCase();
    const existing = dbStore.partnerTiers.find(
      (t) =>
        t.organizationId === organizationId &&
        (t.programId || null) === (dto.programId || null) &&
        t.code === code &&
        !t.deletedAt,
    );

    if (existing) {
      throw new BadRequestException(`A tier with code '${code}' already exists in this program scope.`);
    }

    // If marked default, unset previous default
    if (dto.isDefault) {
      dbStore.partnerTiers.forEach((t) => {
        if (
          t.organizationId === organizationId &&
          (t.programId || null) === (dto.programId || null) &&
          t.isDefault
        ) {
          t.isDefault = false;
        }
      });
    }

    const tier: PartnerTierEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      name: dto.name.trim(),
      code,
      description: dto.description,
      level: dto.level,
      displayOrder: dto.displayOrder ?? dto.level,
      icon: dto.icon || 'award',
      badge: dto.badge,
      colorToken: dto.colorToken || 'blue',
      evaluationPeriod: dto.evaluationPeriod || TierEvaluationPeriod.LIFETIME,
      downgradeMode: dto.downgradeMode || TierDowngradeMode.DOWNGRADE_NEXT_PERIOD,
      gracePeriodDays: dto.gracePeriodDays ?? 7,
      commissionRateEffectiveStrategy:
        dto.commissionRateEffectiveStrategy || CommissionRateEffectiveStrategy.FUTURE_CONVERSIONS_ONLY,
      commissionRateOverride: dto.commissionRateOverride,
      fixedCommissionOverride: dto.fixedCommissionOverride,
      conditions: dto.conditions || {},
      rewardsConfig: dto.rewardsConfig,
      isDefault: Boolean(dto.isDefault),
      isActive: dto.isActive !== undefined ? dto.isActive : true,
      isVisibleToAffiliate: dto.isVisibleToAffiliate !== undefined ? dto.isVisibleToAffiliate : true,
      createdBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.partnerTiers.push(tier);

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.TIER_CREATED,
      resourceType: 'partner_tier',
      resourceId: tier.id,
      metadata: { name: tier.name, code: tier.code, level: tier.level },
      createdAt: new Date(),
    });

    return tier;
  }

  async getTiers(organizationId: string, programId?: string): Promise<PartnerTierEntity[]> {
    return dbStore.partnerTiers
      .filter(
        (t) =>
          t.organizationId === organizationId &&
          (!programId || !t.programId || t.programId === programId) &&
          !t.deletedAt,
      )
      .sort((a, b) => a.level - b.level);
  }

  async getTier(organizationId: string, id: string): Promise<PartnerTierEntity> {
    const tier = dbStore.partnerTiers.find(
      (t) => t.id === id && t.organizationId === organizationId && !t.deletedAt,
    );
    if (!tier) {
      throw new NotFoundException('Partner tier not found');
    }
    return tier;
  }

  async updateTier(
    organizationId: string,
    id: string,
    dto: UpdatePartnerTierDto,
    actorId?: string,
  ): Promise<PartnerTierEntity> {
    const tier = await this.getTier(organizationId, id);

    if (dto.isDefault && !tier.isDefault) {
      dbStore.partnerTiers.forEach((t) => {
        if (
          t.organizationId === organizationId &&
          (t.programId || null) === (tier.programId || null) &&
          t.isDefault
        ) {
          t.isDefault = false;
        }
      });
    }

    if (dto.name) tier.name = dto.name.trim();
    if (dto.description !== undefined) tier.description = dto.description;
    if (dto.level !== undefined) tier.level = dto.level;
    if (dto.displayOrder !== undefined) tier.displayOrder = dto.displayOrder;
    if (dto.icon) tier.icon = dto.icon;
    if (dto.badge !== undefined) tier.badge = dto.badge;
    if (dto.colorToken) tier.colorToken = dto.colorToken;
    if (dto.evaluationPeriod) tier.evaluationPeriod = dto.evaluationPeriod;
    if (dto.downgradeMode) tier.downgradeMode = dto.downgradeMode;
    if (dto.gracePeriodDays !== undefined) tier.gracePeriodDays = dto.gracePeriodDays;
    if (dto.commissionRateEffectiveStrategy) tier.commissionRateEffectiveStrategy = dto.commissionRateEffectiveStrategy;
    if (dto.commissionRateOverride !== undefined) tier.commissionRateOverride = dto.commissionRateOverride;
    if (dto.fixedCommissionOverride !== undefined) tier.fixedCommissionOverride = dto.fixedCommissionOverride;
    if (dto.conditions) tier.conditions = dto.conditions;
    if (dto.rewardsConfig !== undefined) tier.rewardsConfig = dto.rewardsConfig;
    if (dto.isDefault !== undefined) tier.isDefault = dto.isDefault;
    if (dto.isActive !== undefined) tier.isActive = dto.isActive;
    if (dto.isVisibleToAffiliate !== undefined) tier.isVisibleToAffiliate = dto.isVisibleToAffiliate;
    tier.updatedBy = actorId;
    tier.updatedAt = new Date();

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.TIER_UPDATED,
      resourceType: 'partner_tier',
      resourceId: tier.id,
      metadata: { name: tier.name, level: tier.level },
      createdAt: new Date(),
    });

    return tier;
  }

  async deleteTier(organizationId: string, id: string, actorId?: string): Promise<{ success: boolean }> {
    const tier = await this.getTier(organizationId, id);

    // Prevent deleting if affiliates are currently assigned
    const assignedCount = dbStore.affiliateTiers.filter(
      (at) => at.organizationId === organizationId && at.currentTierId === id,
    ).length;

    if (assignedCount > 0) {
      throw new BadRequestException(
        `Cannot delete tier '${tier.name}' because ${assignedCount} affiliate(s) are currently assigned to it. Reassign affiliates first or deactivate the tier.`,
      );
    }

    tier.deletedAt = new Date();
    tier.isActive = false;
    tier.updatedAt = new Date();

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.TIER_DEACTIVATED,
      resourceType: 'partner_tier',
      resourceId: tier.id,
      metadata: { name: tier.name },
      createdAt: new Date(),
    });

    return { success: true };
  }

  async reorderTiers(organizationId: string, tierIds: string[]): Promise<PartnerTierEntity[]> {
    tierIds.forEach((id, index) => {
      const tier = dbStore.partnerTiers.find((t) => t.id === id && t.organizationId === organizationId);
      if (tier) {
        tier.displayOrder = index + 1;
        tier.updatedAt = new Date();
      }
    });
    return this.getTiers(organizationId);
  }

  async assignTierManually(
    organizationId: string,
    affiliateId: string,
    dto: AssignTierDto,
    actorId?: string,
  ): Promise<AffiliateTierEntity> {
    const affiliate = dbStore.affiliates.find(
      (a) => a.id === affiliateId && a.organizationId === organizationId,
    );
    if (!affiliate) {
      throw new NotFoundException('Affiliate not found');
    }

    const programAffiliate = dbStore.programAffiliates.find(
      (pa) => pa.affiliateId === affiliateId && pa.organizationId === organizationId,
    );
    const programId = dto.programId || programAffiliate?.programId || dbStore.programs.find((p) => p.organizationId === organizationId)?.id;
    if (!programId) {
      throw new BadRequestException('Program ID is required for tier assignment');
    }

    const newTier = await this.getTier(organizationId, dto.tierId);

    let affiliateTier = dbStore.affiliateTiers.find(
      (at) => at.organizationId === organizationId && at.programId === programId && at.affiliateId === affiliateId,
    );

    const previousTierId = affiliateTier?.currentTierId;

    if (!affiliateTier) {
      affiliateTier = {
        id: uuidv4(),
        organizationId,
        programId,
        affiliateId,
        currentTierId: newTier.id,
        previousTierId: undefined,
        effectiveFrom: new Date(),
        isLocked: Boolean(dto.lockTier),
        lockedBy: dto.lockTier ? actorId : undefined,
        lockedAt: dto.lockTier ? new Date() : undefined,
        lockReason: dto.lockTier ? (dto.reason || 'Manual lock by admin') : undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.affiliateTiers.push(affiliateTier);
    } else {
      affiliateTier.previousTierId = previousTierId;
      affiliateTier.currentTierId = newTier.id;
      affiliateTier.effectiveFrom = new Date();
      if (dto.lockTier !== undefined) {
        affiliateTier.isLocked = dto.lockTier;
        if (dto.lockTier) {
          affiliateTier.lockedBy = actorId;
          affiliateTier.lockedAt = new Date();
          affiliateTier.lockReason = dto.reason || 'Manual lock by admin';
        }
      }
      affiliateTier.updatedAt = new Date();
    }

    // Record Tier History
    const history: AffiliateTierHistoryEntity = {
      id: uuidv4(),
      organizationId,
      programId,
      affiliateId,
      previousTierId,
      newTierId: newTier.id,
      transitionType: TierTransitionType.MANUAL_OVERRIDE,
      reason: dto.reason || 'Manually assigned by organization admin',
      metricSnapshot: {},
      ruleSnapshot: { tierCode: newTier.code, name: newTier.name, level: newTier.level },
      effectiveCommissionRate: newTier.commissionRateOverride,
      createdBy: actorId,
      createdAt: new Date(),
    };
    dbStore.affiliateTierHistories.push(history);

    // Audit log
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.TIER_MANUALLY_ASSIGNED,
      resourceType: 'affiliate_tier',
      resourceId: newTier.id,
      metadata: {
        affiliateId,
        programId,
        newTierName: newTier.name,
        reason: dto.reason,
        locked: affiliateTier.isLocked,
      },
      createdAt: new Date(),
    });

    return affiliateTier;
  }

  async lockTier(
    organizationId: string,
    affiliateId: string,
    dto: LockTierDto,
    actorId?: string,
  ): Promise<AffiliateTierEntity> {
    const affiliateTier = dbStore.affiliateTiers.find(
      (at) => at.organizationId === organizationId && at.affiliateId === affiliateId,
    );
    if (!affiliateTier) {
      throw new NotFoundException('Affiliate tier assignment not found');
    }

    affiliateTier.isLocked = dto.locked;
    if (dto.locked) {
      affiliateTier.lockedBy = actorId;
      affiliateTier.lockedAt = new Date();
      affiliateTier.lockReason = dto.reason || 'Manual lock by administrator';
    } else {
      affiliateTier.lockedBy = undefined;
      affiliateTier.lockedAt = undefined;
      affiliateTier.lockReason = undefined;
    }
    affiliateTier.updatedAt = new Date();

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: dto.locked ? AuditAction.TIER_LOCKED : AuditAction.TIER_UNLOCKED,
      resourceType: 'affiliate_tier',
      resourceId: affiliateTier.currentTierId,
      metadata: { affiliateId, reason: dto.reason },
      createdAt: new Date(),
    });

    return affiliateTier;
  }

  /** Every affiliate's current tier in one call — used by the org admin affiliates roster to avoid N+1 lookups. */
  async getAffiliateTierAssignments(organizationId: string): Promise<Record<string, {
    id: string; name: string; code: string; level: number; icon?: string; badge?: string; colorToken?: string;
  }>> {
    const assignments = dbStore.affiliateTiers.filter((at) => at.organizationId === organizationId);
    const tiersById = new Map(
      dbStore.partnerTiers.filter((t) => t.organizationId === organizationId).map((t) => [t.id, t]),
    );

    const result: Record<string, { id: string; name: string; code: string; level: number; icon?: string; badge?: string; colorToken?: string }> = {};
    for (const assignment of assignments) {
      const tier = tiersById.get(assignment.currentTierId);
      if (!tier) continue;
      // An affiliate can be in multiple programs; keep the highest tier held.
      const existing = result[assignment.affiliateId];
      if (!existing || tier.level > existing.level) {
        result[assignment.affiliateId] = {
          id: tier.id,
          name: tier.name,
          code: tier.code,
          level: tier.level,
          icon: tier.icon,
          badge: tier.badge,
          colorToken: tier.colorToken,
        };
      }
    }
    return result;
  }

  async getAffiliateTier(organizationId: string, programId: string, affiliateId: string) {
    const affiliateTier = dbStore.affiliateTiers.find(
      (at) => at.organizationId === organizationId && at.programId === programId && at.affiliateId === affiliateId,
    );

    const tiers = this.tierEvaluator.getActiveTiers(organizationId, programId);
    const defaultTier = tiers.find((t) => t.isDefault) || tiers[tiers.length - 1];

    const currentTier = affiliateTier
      ? tiers.find((t) => t.id === affiliateTier.currentTierId) || defaultTier
      : defaultTier;

    const nextTier = tiers
      .filter((t) => t.level > (currentTier?.level || 0))
      .sort((a, b) => a.level - b.level)[0] || null;

    return {
      affiliateTier,
      currentTier,
      nextTier,
      isLocked: Boolean(affiliateTier?.isLocked),
      lockReason: affiliateTier?.lockReason,
      effectiveCommissionRate: currentTier?.commissionRateOverride,
    };
  }

  async getAffiliatesInTier(organizationId: string, tierId: string) {
    const tier = await this.getTier(organizationId, tierId);
    const assignments = dbStore.affiliateTiers.filter(
      (at) => at.organizationId === organizationId && at.currentTierId === tierId,
    );

    return assignments.map((a) => {
      const affiliate = dbStore.affiliates.find((aff) => aff.id === a.affiliateId);
      const program = dbStore.programs.find((p) => p.id === a.programId);
      return {
        affiliateTier: a,
        affiliate: affiliate
          ? { id: affiliate.id, displayName: affiliate.displayName, email: affiliate.email, companyName: affiliate.companyName }
          : null,
        program: program ? { id: program.id, name: program.name } : null,
      };
    });
  }

  /**
   * Seeds the Bronze/Silver/Gold/Platinum org-wide tier ladder for a brand-new organization.
   * No-ops if the org already has any org-wide tier (e.g. an org restored from backup,
   * or this being called twice) — never overwrites tiers an admin may have configured.
   */
  async seedDefaultTiers(organizationId: string, actorId?: string): Promise<void> {
    const hasOrgWideTier = dbStore.partnerTiers.some(
      (t) => t.organizationId === organizationId && !t.programId && !t.deletedAt,
    );
    if (hasOrgWideTier) return;

    const defaults: CreatePartnerTierDto[] = [
      {
        name: 'Bronze',
        code: 'BRONZE',
        description: 'Starting tier for every new partner.',
        level: 1,
        displayOrder: 1,
        icon: 'shield',
        badge: 'Bronze Partner',
        colorToken: 'bronze',
        isDefault: true,
        isActive: true,
        isVisibleToAffiliate: true,
        conditions: { minimumConversions: 0, minimumRevenue: 0 },
      } as CreatePartnerTierDto,
      {
        name: 'Silver',
        code: 'SILVER',
        description: 'Unlocked at 10+ approved conversions or $2,500+ in revenue.',
        level: 2,
        displayOrder: 2,
        icon: 'award',
        badge: 'Silver Partner',
        colorToken: 'silver',
        isDefault: false,
        isActive: true,
        isVisibleToAffiliate: true,
        conditions: { minimumConversions: 10, minimumRevenue: 2500 },
      } as CreatePartnerTierDto,
      {
        name: 'Gold',
        code: 'GOLD',
        description: 'Unlocked at 50+ approved conversions or $10,000+ in revenue.',
        level: 3,
        displayOrder: 3,
        icon: 'crown',
        badge: 'Gold Partner',
        colorToken: 'gold',
        isDefault: false,
        isActive: true,
        isVisibleToAffiliate: true,
        conditions: { minimumConversions: 50, minimumRevenue: 10000 },
      } as CreatePartnerTierDto,
      {
        name: 'Platinum',
        code: 'PLATINUM',
        description: 'Top tier for elite partners with 150+ approved conversions or $50,000+ in revenue.',
        level: 4,
        displayOrder: 4,
        icon: 'gem',
        badge: 'Platinum Partner',
        colorToken: 'platinum',
        isDefault: false,
        isActive: true,
        isVisibleToAffiliate: true,
        conditions: { minimumConversions: 150, minimumRevenue: 50000 },
      } as CreatePartnerTierDto,
    ];

    for (const dto of defaults) {
      try {
        await this.createTier(organizationId, dto, actorId);
      } catch (err) {
        this.logger.warn(`Failed to seed default tier ${dto.code} for org ${organizationId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
