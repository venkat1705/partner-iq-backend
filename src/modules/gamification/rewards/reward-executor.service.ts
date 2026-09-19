import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { LedgerService } from '../../ledger/ledger.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { BrevoEmailService } from '../../memberships/brevo-email.service';
import { AuditAction, CommissionType, LedgerEntryType, MilestoneRewardStatus, MilestoneRewardType } from '../../../common/enums';
import {
  collectTierConditionMetrics,
  isClickBasedMetric,
} from '../../../common/invariants/click-compensation.invariant';
import { SystemEmailDispatchService } from '../../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../../email-design/constants/email-template-keys';
import { getAppConfig } from '../../../config/app.config';

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
    private readonly emailDispatch?: SystemEmailDispatchService,
  ) {}

  /**
   * True when the milestone or tier that triggered this reward is gated on raw click
   * volume. A MANUAL reward has no metric behind it and is an operator decision, so it
   * is never click-sourced.
   */
  private isClickSourced(ctx: ExecuteRewardContext): boolean {
    if (ctx.milestoneId) {
      const milestone = dbStore.milestones.find((m) => m.id === ctx.milestoneId);
      if (milestone && isClickBasedMetric(milestone.metric)) return true;
    }
    if (ctx.tierId) {
      const tier = dbStore.partnerTiers.find((t) => t.id === ctx.tierId);
      if (tier && collectTierConditionMetrics(tier.conditions).some(isClickBasedMetric)) return true;
    }
    return false;
  }

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
        // CLICK != COMMISSION. This bonus credits the affiliate ledger directly, so it is the
        // one reward that can turn traffic into a payable balance. Milestone/tier creation
        // already refuses the combination, but rows configured before that check existed (or
        // written straight to the store by a seed or migration) still reach here, so the
        // boundary is enforced again at the moment money would actually be created.
        if (amountCents > 0 && this.isClickSourced(ctx)) {
          this.logger.warn(
            `Blocked a ${amountCents}-cent bonus for affiliate ${ctx.affiliateId}: its ${ctx.source.toLowerCase()} ` +
              'is gated on click volume, and clicks are a traffic metric rather than an earning event.',
          );
          results.fixedBonus = { amountCents, status: 'BLOCKED', reason: 'CLICK_BASED_COMPENSATION_NOT_SUPPORTED' };
        } else if (amountCents > 0) {
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

      // 1b. COMMISSION RATE CHANGE — permanently boosts the affiliate's effective commission
      // rate on this program enrollment. Framed in the admin UI as an additive "+X%" boost
      // (basis points), so it increments whatever the affiliate's current effective rate is
      // (their existing per-affiliate override if one is already set, otherwise their active
      // tier's override, otherwise the program default) rather than replacing it outright —
      // stacking milestone rewards keep adding up rather than clobbering each other.
      // Persisted on ProgramAffiliate.commissionOverride, which commissions.service.ts reads
      // with higher precedence than the tier default (but still below an explicit commission
      // rule, which stays the final word for merchant-configured business logic).
      if (type === MilestoneRewardType.COMMISSION_RATE_CHANGE || config.commissionRateOverride) {
        const boostBps = Number(config.commissionRateOverride || 0);
        if (boostBps !== 0) {
          const commissionChange = this.applyCommissionRateBoost(ctx.organizationId, ctx.programId, ctx.affiliateId, boostBps);
          if (commissionChange) {
            results.commissionRateChange = commissionChange;

            dbStore.auditLogs.push({
              id: uuidv4(),
              organizationId: ctx.organizationId,
              actorType: 'SYSTEM',
              actorId: 'system',
              action: AuditAction.REWARD_GRANTED,
              resourceType: 'program_affiliate',
              resourceId: ctx.affiliateId,
              metadata: {
                rewardKind: 'COMMISSION_RATE_CHANGE',
                source: ctx.source,
                programId: ctx.programId,
                previousRateBps: commissionChange.previousRateBps,
                newRateBps: commissionChange.newRateBps,
                boostBps,
              },
              createdAt: new Date(),
            });
          } else {
            this.logger.warn(
              `Skipped COMMISSION_RATE_CHANGE reward for affiliate ${ctx.affiliateId}: program ${ctx.programId} is not percentage-based.`,
            );
            results.commissionRateChange = { status: 'SKIPPED', reason: 'Program is not percentage-based' };
          }
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
      if (config.emailSubject || config.emailBody || type === MilestoneRewardType.EMAIL || results.fixedBonus || results.badge) {
        try {
          if (affiliate?.email) {
            const subject = config.emailSubject || `Congratulations on your new achievement!`;
            const rewardDescription = config.emailBody
              || (results.fixedBonus ? `A bonus of ${(results.fixedBonus.amountCents / 100).toFixed(2)} was credited to your account.` : undefined)
              || (results.badge ? `You earned the "${results.badge.badgeName}" badge.` : undefined)
              || ctx.reason
              || `You unlocked a new reward in ${program?.name || 'PartnerIQ'}.`;

            const dashboardUrl = `${getAppConfig().affiliateFrontendUrl.replace(/\/$/, '')}/dashboard`;
            const templateKey = ctx.source === 'TIER' ? SystemTemplateKey.AFFILIATE_TIER_CHANGED : SystemTemplateKey.AFFILIATE_REWARD_GRANTED;

            await this.emailDispatch?.send(
              templateKey,
              affiliate.email,
              {
                subject,
                affiliate: { firstName: (affiliate.displayName || '').split(' ')[0] || affiliate.displayName },
                organization: { name: organization?.name || 'PartnerIQ' },
                reward: { description: rewardDescription },
                tier: { name: config.tierName || 'Upgraded', commissionRate: config.commissionRate || '' },
                links: { dashboardUrl },
              },
              { organizationId: ctx.organizationId },
            );

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

  /**
   * Increments the affiliate's effective commission rate on this program enrollment by
   * `boostBps` basis points, persisting the result on ProgramAffiliate.commissionOverride.
   * Returns null (no-op) if the program isn't percentage-based, since a basis-point boost
   * cannot be meaningfully applied to a flat per-conversion fee.
   */
  private applyCommissionRateBoost(
    organizationId: string,
    programId: string,
    affiliateId: string,
    boostBps: number,
  ): { previousRateBps: number; newRateBps: number } | null {
    const program = dbStore.programs.find((p) => p.id === programId);
    let enrollment = dbStore.programAffiliates.find(
      (pa) => pa.organizationId === organizationId && pa.programId === programId && pa.affiliateId === affiliateId,
    );

    // Resolve the affiliate's current effective PERCENTAGE rate, in this precedence order:
    // existing per-affiliate override -> active tier override -> program default.
    let baseRateBps: number | undefined;
    let baseIsPercentage = true;

    if (enrollment?.commissionOverride !== undefined && enrollment.commissionOverride !== null && enrollment.commissionOverrideType) {
      baseIsPercentage = enrollment.commissionOverrideType === CommissionType.PERCENTAGE;
      baseRateBps = baseIsPercentage ? enrollment.commissionOverride : undefined;
    }

    if (baseRateBps === undefined) {
      const affiliateTier = dbStore.affiliateTiers.find(
        (at) => at.organizationId === organizationId && at.affiliateId === affiliateId && (!at.programId || at.programId === programId),
      );
      const tier = affiliateTier
        ? dbStore.partnerTiers.find((t) => t.id === affiliateTier.currentTierId && t.isActive && !t.deletedAt)
        : undefined;

      if (tier?.commissionRateOverride !== undefined && tier?.commissionRateOverride !== null) {
        baseRateBps = tier.commissionRateOverride;
        baseIsPercentage = true;
      } else if (tier?.fixedCommissionOverride !== undefined && tier?.fixedCommissionOverride !== null) {
        baseIsPercentage = false;
      }
    }

    if (baseRateBps === undefined && baseIsPercentage) {
      if (program?.commissionType && program.commissionType !== CommissionType.PERCENTAGE && program.commissionType !== CommissionType.RECURRING_PERCENTAGE) {
        baseIsPercentage = false;
      } else {
        baseRateBps = program?.defaultCommissionValue ?? 1000;
      }
    }

    if (!baseIsPercentage || baseRateBps === undefined) {
      return null;
    }

    const newRateBps = Math.max(0, Math.min(10000, baseRateBps + boostBps));

    if (!enrollment) {
      // Defensive fallback: a reward should never fail to apply just because the enrollment
      // row is momentarily missing from this lookup — dbStore keeps program enrollment
      // records, so this should always exist by the time a conversion/tier/milestone event
      // fires for this affiliate on this program.
      this.logger.warn(
        `No ProgramAffiliate enrollment found for affiliate ${affiliateId} on program ${programId}; cannot persist commission rate boost.`,
      );
      return null;
    }

    enrollment.commissionOverride = newRateBps;
    enrollment.commissionOverrideType = CommissionType.PERCENTAGE;

    return { previousRateBps: baseRateBps, newRateBps };
  }
}
