import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, OrganizationTrialEntity, BillingSubscriptionEntity } from '../../../database/store';
import { AppDataSource } from '../../../database/data-source';
import { Organization } from '../../../database/schema';
import { AuditAction, SubscriptionStatus, BillingCycle } from '../../../common/enums';
import { PlanService } from './plan.service';

export interface TrialStatusResult {
  subscriptionStatus: SubscriptionStatus | string;
  isTrialing: boolean;
  isExpired: boolean;
  isRestricted: boolean;
  trialStartedAt?: Date;
  trialEndsAt?: Date;
  remainingDays: number;
  remainingSeconds: number;
  plan: any;
}

@Injectable()
export class TrialService {
  constructor(private readonly planService: PlanService) { }

  /**
   * Starts a 14-day free trial for an organization.
   * Strictly generates dates on backend in UTC.
   * Prevents trial abuse using OrganizationTrial records.
   */
  async startTrial(
    organizationId: string,
    userId: string,
    planCode = 'PRO',
  ): Promise<TrialStatusResult> {
    await this.planService.ensureDefaultPlans();

    // 1. Verify organization exists
    let org = dbStore.organizations.find((o) => o.id === organizationId && !o.deletedAt);
    if (!org && AppDataSource.isInitialized) {
      try {
        const dbOrg = await AppDataSource.getRepository(Organization).findOne({
          where: { id: organizationId },
        });
        if (dbOrg && !dbOrg.deletedAt) {
          if (!dbStore.organizations.some((o) => o.id === dbOrg.id)) {
            dbStore.organizations.push(dbOrg);
          }
          org = dbOrg;
        }
      } catch (e) { }
    }
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const paidSubscription = this.findCurrentPaidSubscription(organizationId);
    if (paidSubscription) {
      throw new BadRequestException({
        code: 'ACTIVE_SUBSCRIPTION_EXISTS',
        message: 'This organization already has an active paid subscription.',
      });
    }

    // 2. Prevent trial abuse
    let trialRecord = dbStore.organizationTrials.find((t) => t.organizationId === organizationId);
    if (trialRecord && trialRecord.trialUsed) {
      throw new BadRequestException({
        code: 'TRIAL_ALREADY_CONSUMED',
        message: 'This organization has already consumed its introductory 14-day free trial.',
      });
    }

    // 3. Resolve target plan (e.g. STARTER / PRO / ENTERPRISE)
    const plan =
      dbStore.billingPlans.find((p) => p.code === planCode && p.billingInterval === 'MONTHLY') ||
      dbStore.billingPlans.find((p) => p.code === 'PRO' && p.billingInterval === 'MONTHLY') ||
      dbStore.billingPlans[0];

    if (!plan) {
      throw new NotFoundException('Plan not found for trial setup');
    }

    // 4. Calculate UTC 14-day trial window
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    // 5. Update or create OrganizationTrial record
    if (!trialRecord) {
      trialRecord = {
        id: uuidv4(),
        organizationId,
        trialUsed: true,
        firstTrialStartedAt: now,
        firstTrialEndedAt: trialEndsAt,
        extendedByAdminDays: 0,
        createdAt: now,
        updatedAt: now,
      };
      dbStore.organizationTrials.push(trialRecord);
    } else {
      trialRecord.trialUsed = true;
      trialRecord.firstTrialStartedAt = now;
      trialRecord.firstTrialEndedAt = trialEndsAt;
      trialRecord.updatedAt = now;
    }

    // 6. Find or create subscription for organization
    let subscription = dbStore.billingSubscriptions.find(
      (s) => s.organizationId === organizationId && s.rowStatus === 'ACTIVE',
    );

    if (subscription) {
      subscription.planId = plan.id;
      subscription.status = SubscriptionStatus.TRIALING;
      subscription.trialStartedAt = now;
      subscription.trialEndsAt = trialEndsAt;
      subscription.trialStart = now;
      subscription.trialEnd = trialEndsAt;
      subscription.billingInterval = 'MONTHLY';
      subscription.billingCycle = 'MONTHLY';
      subscription.currentPeriodStart = now;
      subscription.currentPeriodEnd = trialEndsAt;
      subscription.modifiedBy = userId;
      subscription.modifiedDate = now;
    } else {
      subscription = {
        id: uuidv4(),
        organizationId,
        planId: plan.id,
        provider: 'INTERNAL',
        status: SubscriptionStatus.TRIALING,
        billingInterval: 'MONTHLY',
        billingCycle: 'MONTHLY',
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
        trialStart: now,
        trialEnd: trialEndsAt,
        trialStartedAt: now,
        trialEndsAt: trialEndsAt,
        cancelAtPeriodEnd: false,
        createdBy: userId,
        createdDate: now,
        modifiedDate: now,
        rowStatus: 'ACTIVE',
      };
      dbStore.billingSubscriptions.push(subscription);
    }

    // 7. Audit log
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: AuditAction.ORGANIZATION_CREATED,
      resourceType: 'trial',
      resourceId: subscription.id,
      metadata: {
        trialStartedAt: now.toISOString(),
        trialEndsAt: trialEndsAt.toISOString(),
        planCode: plan.code,
      },
      createdAt: now,
    });

    return this.getTrialStatus(organizationId);
  }

  /**
   * Retrieves trial status, remaining time, and subscription state
   */
  async getTrialStatus(organizationId: string): Promise<TrialStatusResult> {
    await this.planService.ensureDefaultPlans();

    let subscription =
      this.findCurrentPaidSubscription(organizationId) ||
      dbStore.billingSubscriptions
        .filter((s) => s.organizationId === organizationId && s.rowStatus === 'ACTIVE')
        .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime())[0];

    let trialRecord = dbStore.organizationTrials.find((t) => t.organizationId === organizationId);

    // If no subscription exists, anchor trial permanently to the organization's creation date
    if (!subscription) {
      let org = dbStore.organizations.find((o) => o.id === organizationId && !o.deletedAt);
      if (!org && AppDataSource.isInitialized) {
        try {
          const dbOrg = await AppDataSource.getRepository(Organization).findOne({
            where: { id: organizationId },
          });
          if (dbOrg && !dbOrg.deletedAt) {
            if (!dbStore.organizations.some((o) => o.id === dbOrg.id)) {
              dbStore.organizations.push(dbOrg);
            }
            org = dbOrg;
          }
        } catch (e) { }
      }
      if (org) {
        const startDate = org.createdAt ? new Date(org.createdAt) : new Date();
        const endDate = new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000);
        if (!trialRecord) {
          trialRecord = {
            id: uuidv4(),
            organizationId,
            trialUsed: true,
            firstTrialStartedAt: startDate,
            firstTrialEndedAt: endDate,
            extendedByAdminDays: 0,
            createdAt: startDate,
            updatedAt: new Date(),
          };
          dbStore.organizationTrials.push(trialRecord);
        }

        const proPlan =
          dbStore.billingPlans.find((p) => p.code === 'PRO' && p.billingInterval === 'MONTHLY') ||
          dbStore.billingPlans[0];

        const now = new Date();
        const isExpired = endDate.getTime() <= now.getTime();

        subscription = {
          id: uuidv4(),
          organizationId,
          planId: proPlan?.id || '',
          provider: 'INTERNAL',
          status: isExpired ? SubscriptionStatus.TRIAL_EXPIRED : SubscriptionStatus.TRIALING,
          billingInterval: 'MONTHLY',
          billingCycle: 'MONTHLY',
          currentPeriodStart: startDate,
          currentPeriodEnd: endDate,
          trialStart: startDate,
          trialEnd: endDate,
          trialStartedAt: startDate,
          trialEndsAt: endDate,
          cancelAtPeriodEnd: false,
          createdBy: org.createdBy || 'system',
          createdDate: startDate,
          modifiedDate: startDate,
          rowStatus: 'ACTIVE',
        };
        dbStore.billingSubscriptions.push(subscription as any);
      }
    }

    const plan = subscription
      ? dbStore.billingPlans.find((p) => p.id === subscription.planId)
      : dbStore.billingPlans.find((p) => p.code === 'FREE' && p.billingInterval === 'MONTHLY');

    const now = new Date();
    const trialEndsAt = subscription?.trialEndsAt || subscription?.trialEnd || trialRecord?.firstTrialEndedAt;
    const trialStartedAt = subscription?.trialStartedAt || subscription?.trialStart || trialRecord?.firstTrialStartedAt;

    let remainingSeconds = 0;
    let remainingDays = 0;

    if (trialEndsAt) {
      remainingSeconds = Math.max(0, Math.floor((new Date(trialEndsAt).getTime() - now.getTime()) / 1000));
      remainingDays = Math.ceil(remainingSeconds / (24 * 3600));
    }

    if (subscription?.status === SubscriptionStatus.TRIALING && trialEndsAt && remainingSeconds <= 0) {
      subscription.status = SubscriptionStatus.TRIAL_EXPIRED;
      subscription.modifiedDate = now;
    }

    const currentStatus = subscription?.status || (remainingSeconds > 0 ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE);
    const isTrialing = currentStatus === SubscriptionStatus.TRIALING;
    const isExpired =
      currentStatus === SubscriptionStatus.TRIAL_EXPIRED ||
      (isTrialing && remainingSeconds <= 0);
    const isRestricted =
      currentStatus === SubscriptionStatus.RESTRICTED ||
      currentStatus === SubscriptionStatus.TRIAL_EXPIRED;

    return {
      subscriptionStatus: currentStatus,
      isTrialing,
      isExpired,
      isRestricted,
      trialStartedAt: trialStartedAt ? new Date(trialStartedAt) : undefined,
      trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : undefined,
      remainingDays,
      remainingSeconds,
      plan: plan ? this.planService.canonicalizeBuiltInPlan(plan, 'MONTHLY' as any) : null,
    };
  }

  /**
   * Admin method to grant trial extension
   */
  async extendTrial(
    organizationId: string,
    days: number,
    adminUserId: string,
  ): Promise<TrialStatusResult> {
    if (days <= 0 || days > 90) {
      throw new BadRequestException('Trial extension days must be between 1 and 90.');
    }

    const subscription = dbStore.billingSubscriptions
      .filter((s) => s.organizationId === organizationId && s.rowStatus === 'ACTIVE')
      .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime())[0];

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    const currentEndsAt = subscription.trialEndsAt || subscription.trialEnd || new Date();
    const newEndsAt = new Date(Math.max(Date.now(), new Date(currentEndsAt).getTime()) + days * 24 * 60 * 60 * 1000);

    subscription.trialEndsAt = newEndsAt;
    subscription.trialEnd = newEndsAt;
    subscription.currentPeriodEnd = newEndsAt;
    subscription.status = SubscriptionStatus.TRIALING;
    subscription.modifiedBy = adminUserId;
    subscription.modifiedDate = new Date();

    const trialRecord = dbStore.organizationTrials.find((t) => t.organizationId === organizationId);
    if (trialRecord) {
      trialRecord.extendedByAdminDays = (trialRecord.extendedByAdminDays || 0) + days;
      trialRecord.grantedByAdminAt = new Date();
      trialRecord.grantedByAdminUserId = adminUserId;
      trialRecord.updatedAt = new Date();
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: adminUserId,
      action: AuditAction.ORGANIZATION_CREATED,
      resourceType: 'trial',
      resourceId: subscription.id,
      metadata: {
        action: 'TRIAL_EXTENDED',
        daysExtended: days,
        newEndsAt: newEndsAt.toISOString(),
      },
      createdAt: new Date(),
    });

    return this.getTrialStatus(organizationId);
  }

  private findCurrentPaidSubscription(organizationId: string): BillingSubscriptionEntity | undefined {
    const paidStatuses = [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.CANCEL_PENDING,
      SubscriptionStatus.PAUSED,
    ];

    return dbStore.billingSubscriptions
      .filter((subscription) =>
        subscription.organizationId === organizationId &&
        subscription.rowStatus === 'ACTIVE' &&
        paidStatuses.includes(subscription.status as SubscriptionStatus),
      )
      .sort((a, b) => {
        const planA = dbStore.billingPlans.find((plan) => plan.id === a.planId);
        const planB = dbStore.billingPlans.find((plan) => plan.id === b.planId);
        const rankDiff = this.planService.rank(planB?.code) - this.planService.rank(planA?.code);
        if (rankDiff !== 0) return rankDiff;
        return new Date(b.modifiedDate || b.createdDate).getTime() - new Date(a.modifiedDate || a.createdDate).getTime();
      })[0];
  }
}
