import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { LedgerService } from '../../ledger/ledger.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { BrevoEmailService } from '../../memberships/brevo-email.service';
import { LedgerEntryType, MilestoneRewardStatus, MilestoneRewardType } from '../../../common/enums';

export interface ExecuteRewardContext {
  organizationId: string;
  programId: string;
  affiliateId: string;
  rewardType: MilestoneRewardType | string;
  rewardConfig: Record<string, any>;
  idempotencyKey: string;
  milestoneId?: string;
  tierId?: string;
  source: 'MILESTONE' | 'TIER' | 'MANUAL';
  reason?: string;
}

@Injectable()
export class RewardExecutorService {
  private readonly logger = new Logger(RewardExecutorService.name);

  constructor(
    private readonly ledgerService: LedgerService,
    private readonly notificationsService: NotificationsService,
    private readonly brevoEmail: BrevoEmailService,
  ) {}

  async executeReward(ctx: ExecuteRewardContext): Promise<{ success: boolean; error?: string; details?: any }> {
    const affiliate = dbStore.affiliates.find((a) => a.id === ctx.affiliateId);
    const organization = dbStore.organizations.find((o) => o.id === ctx.organizationId);
    const program = dbStore.programs.find((p) => p.id === ctx.programId);

    const results: Record<string, any> = {};

    try {
      const type = ctx.rewardType;
      const config = ctx.rewardConfig || {};

      // 1. FIXED BONUS
      if (type === MilestoneRewardType.FIXED_BONUS || config.bonusAmount) {
        const amountCents = config.bonusAmount || 0;
        if (amountCents > 0) {
          const desc = ctx.reason || `Reward bonus for ${ctx.source.toLowerCase()}`;
          await this.ledgerService.recordTransaction(
            ctx.organizationId,
            ctx.affiliateId,
            LedgerEntryType.COMMISSION_EARNED,
            desc,
            uuidv4(),
            amountCents,
          );
          results.fixedBonus = { amountCents, status: 'CREDITED' };
        }
      }

      // 2. BADGE
      if (type === MilestoneRewardType.BADGE || config.badgeName) {
        results.badge = {
          badgeName: config.badgeName || 'Achievement Badge',
          badgeIcon: config.badgeIcon || 'award',
          awardedAt: new Date(),
        };
      }

      // 3. IN-APP NOTIFICATION
      if (config.notificationTitle || config.notificationBody || type === MilestoneRewardType.NOTIFICATION) {
        try {
          const title = config.notificationTitle || `🎉 Achievement Unlocked!`;
          const body = config.notificationBody || `Congratulations! You unlocked a new reward in ${program?.name || 'PartnerIQ'}.`;
          
          // Find associated user for the affiliate
          const user = dbStore.users.find((u) => u.email.toLowerCase() === affiliate?.email.toLowerCase());
          if (user) {
            await this.notificationsService.createNotification({
              userId: user.id,
              organizationId: ctx.organizationId,
              title,
              body,
              type: 'commission',
              priority: 'high',
              metadata: { source: ctx.source, idempotencyKey: ctx.idempotencyKey },
            });
            results.inAppNotification = { status: 'DELIVERED', userId: user.id };
          }
        } catch (notifErr: any) {
          this.logger.warn(`Non-blocking notification delivery failure: ${notifErr.message}`);
          results.inAppNotification = { status: 'FAILED', error: notifErr.message };
        }
      }

      // 4. EMAIL
      if (config.emailSubject || config.emailBody || type === MilestoneRewardType.EMAIL) {
        try {
          if (affiliate?.email) {
            const subject = config.emailSubject || `Congratulations on your new achievement!`;
            // Log prepared email
            dbStore.automationEmailLogs.push({
              id: uuidv4(),
              organizationId: ctx.organizationId,
              executionId: undefined,
              affiliateId: ctx.affiliateId,
              templateId: undefined,
              toEmail: affiliate.email,
              subject,
              status: 'SENT' as any,
              sentAt: new Date(),
              createdAt: new Date(),
            });
            results.email = { to: affiliate.email, subject, status: 'SENT' };
          }
        } catch (emailErr: any) {
          this.logger.warn(`Non-blocking email delivery failure: ${emailErr.message}`);
          results.email = { status: 'FAILED', error: emailErr.message };
        }
      }

      // 5. COUPON REWARD
      if (type === MilestoneRewardType.COUPON_REWARD || config.couponDiscountPercent) {
        const discount = config.couponDiscountPercent || 15;
        const couponCode = `TIER-${(affiliate?.displayName || 'VIP').substring(0, 4).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
        results.coupon = { couponCode, discountPercent: discount };
      }

      // 6. MULTI REWARD
      if (type === MilestoneRewardType.MULTI_REWARD && Array.isArray(config.rewards)) {
        for (const subReward of config.rewards) {
          await this.executeReward({
            ...ctx,
            rewardType: subReward.type,
            rewardConfig: subReward.config || {},
          });
        }
      }

      return { success: true, details: results };
    } catch (err: any) {
      this.logger.error(`Failed to execute reward: ${err.message}`, err.stack);
      return { success: false, error: err.message, details: results };
    }
  }
}
