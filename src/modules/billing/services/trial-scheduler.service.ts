import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { SubscriptionStatus } from '../../../common/enums';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class TrialSchedulerService implements OnModuleInit, OnModuleDestroy {
  private intervalRef?: NodeJS.Timeout;
  private isProcessing = false;

  constructor(private readonly notificationsService?: NotificationsService) {}

  onModuleInit() {
    // Check every 60 seconds
    this.intervalRef = setInterval(() => {
      this.evaluateTrials().catch((err) => {
        console.error('Error during trial evaluation:', err);
      });
    }, 60000);

    // Initial check on startup
    this.evaluateTrials().catch(() => {});
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
    }
  }

  /**
   * Evaluates all active trialing subscriptions
   */
  async evaluateTrials() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = new Date();
      const subscriptions = dbStore.billingSubscriptions.filter(
        (s) => s.rowStatus === 'ACTIVE' && s.status === SubscriptionStatus.TRIALING,
      );

      for (const sub of subscriptions) {
        const trialEnd = sub.trialEndsAt || sub.trialEnd;
        if (!trialEnd) continue;

        const endMillis = new Date(trialEnd).getTime();
        const diffSeconds = Math.floor((endMillis - now.getTime()) / 1000);
        const diffDays = Math.ceil(diffSeconds / (24 * 3600));

        // 1. Trial Expiration Condition
        if (diffSeconds <= 0) {
          sub.status = SubscriptionStatus.TRIAL_EXPIRED;
          sub.modifiedDate = now;

          // Dispatch expiration notification
          await this.dispatchNotification(
            sub.organizationId,
            `TRIAL_EXPIRED:${sub.organizationId}:${sub.id}`,
            'Your 14-Day Free Trial Has Ended',
            'Your PartnerIQ trial has ended. Select a plan to continue using live production features.',
          );
          continue;
        }

        // 2. Day-1 Warning Condition
        if (diffDays <= 1) {
          await this.dispatchNotification(
            sub.organizationId,
            `TRIAL_1_DAY_WARN:${sub.organizationId}:${sub.id}`,
            '1 Day Remaining in Your Free Trial',
            'Your PartnerIQ trial will expire in less than 24 hours. Choose a plan to ensure uninterrupted partner tracking.',
          );
        } else if (diffDays <= 3) {
          // 3. Day-3 Warning Condition
          await this.dispatchNotification(
            sub.organizationId,
            `TRIAL_3_DAY_WARN:${sub.organizationId}:${sub.id}`,
            '3 Days Remaining in Your Free Trial',
            'You have 3 days remaining in your PartnerIQ trial. Review available plans to go live with confidence.',
          );
        } else if (diffDays <= 7) {
          // 4. Day-7 Warning Condition
          await this.dispatchNotification(
            sub.organizationId,
            `TRIAL_7_DAY_WARN:${sub.organizationId}:${sub.id}`,
            '7 Days Remaining in Your Free Trial',
            'Halfway through your PartnerIQ trial! Explore automated payouts, fraud shields, and CRM integrations.',
          );
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async dispatchNotification(
    organizationId: string,
    idempotencyKey: string,
    title: string,
    body: string,
  ) {
    const existing = dbStore.notifications.find(
      (n) => n.organizationId === organizationId && (n.metadata as any)?.idempotencyKey === idempotencyKey,
    );
    if (existing) {
      return; // Already sent
    }

    const orgMembers = dbStore.organizationMemberships.filter(
      (m) => m.organizationId === organizationId && m.status === 'ACTIVE',
    );

    for (const member of orgMembers) {
      if (this.notificationsService) {
        await this.notificationsService.createNotification({
          userId: member.userId,
          organizationId,
          type: 'system',
          title,
          body,
          channel: 'in_app',
          priority: 'high',
          actionUrl: '/app/settings?tab=billing',
          metadata: { idempotencyKey },
        });
      } else {
        dbStore.notifications.push({
          id: uuidv4(),
          userId: member.userId,
          organizationId,
          type: 'system',
          title,
          body,
          channel: 'in_app',
          priority: 'high',
          isRead: false,
          actionUrl: '/app/settings?tab=billing',
          metadata: { idempotencyKey },
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
}
