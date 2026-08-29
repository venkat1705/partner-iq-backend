import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, AffiliateTierEntity } from '../../../database/store';
import { RewardExecutorService } from './reward-executor.service';
import { AuditAction, MilestoneRewardType } from '../../../common/enums';
import { GrantRewardDto } from '../dto/milestone.dto';

@Injectable()
export class RewardService {
  private readonly logger = new Logger(RewardService.name);

  constructor(private readonly rewardExecutor: RewardExecutorService) {}

  async grantManualReward(
    organizationId: string,
    affiliateId: string,
    dto: GrantRewardDto,
    actorId?: string,
  ) {
    const affiliate = dbStore.affiliates.find(
      (a) => a.id === affiliateId && a.organizationId === organizationId,
    );
    if (!affiliate) {
      throw new NotFoundException('Affiliate not found');
    }

    const programAffiliate = dbStore.programAffiliates.find(
      (pa) => pa.affiliateId === affiliateId && pa.organizationId === organizationId,
    );
    const programId = programAffiliate?.programId || dbStore.programs.find((p) => p.organizationId === organizationId)?.id;

    if (!programId) {
      throw new BadRequestException('No associated program found for this affiliate');
    }

    const idempotencyKey = `manual-reward-${organizationId}-${affiliateId}-${Date.now()}`;

    const execResult = await this.rewardExecutor.executeReward({
      organizationId,
      programId,
      affiliateId,
      rewardType: dto.rewardType,
      rewardConfig: dto.rewardConfig || {},
      idempotencyKey,
      source: 'MANUAL',
      reason: dto.reason,
    });

    if (!execResult.success) {
      throw new BadRequestException(`Reward execution failed: ${execResult.error}`);
    }

    // Audit log
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: AuditAction.REWARD_GRANTED,
      resourceType: 'affiliate',
      resourceId: affiliateId,
      metadata: {
        rewardType: dto.rewardType,
        rewardConfig: dto.rewardConfig,
        reason: dto.reason,
        details: execResult.details,
      },
      createdAt: new Date(),
    });

    return {
      success: true,
      message: 'Reward successfully granted',
      details: execResult.details,
    };
  }
}
