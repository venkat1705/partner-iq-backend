import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestWithUser } from '../interfaces/request-with-user.interface';
import { dbStore } from '../../database/store';
import { SubscriptionStatus } from '../enums';

export const REQUIRE_SUBSCRIPTION_ACCESS_KEY = 'require_subscription_access';
export const REQUIRE_FEATURE_KEY = 'require_feature';

export const RequireSubscriptionAccess = () => SetMetadata(REQUIRE_SUBSCRIPTION_ACCESS_KEY, true);
export const RequireFeature = (featureKey: string) => SetMetadata(REQUIRE_FEATURE_KEY, featureKey);

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const orgId = request.tenantId || request.user?.organizationId;

    if (!orgId) {
      return true; // Let OrganizationGuard handle missing tenant
    }

    // Super admin bypasses subscription restrictions
    if (request.user?.isSuperAdmin) {
      return true;
    }

    const subscription = dbStore.billingSubscriptions
      .filter((s) => s.organizationId === orgId && s.rowStatus === 'ACTIVE')
      .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime())[0];

    const currentStatus = subscription?.status as SubscriptionStatus | undefined;

    // Check if subscription status is restricted or expired
    const isRestricted =
      currentStatus === SubscriptionStatus.RESTRICTED ||
      currentStatus === SubscriptionStatus.TRIAL_EXPIRED ||
      currentStatus === SubscriptionStatus.SUSPENDED;

    const isMutatingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase());

    // In restricted mode, allow read-only (GET/HEAD) and billing endpoints, but block resource mutations
    const isBillingPath = request.path?.includes('/billing') || request.path?.includes('/subscriptions') || request.path?.includes('/plans');

    if (isRestricted && isMutatingMethod && !isBillingPath) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_RESTRICTED',
        message: 'Your PartnerIQ trial has ended. Choose a plan to continue using live features.',
        details: {
          subscriptionStatus: currentStatus,
        },
      });
    }

    // Check feature requirements
    const requiredFeature = this.reflector.getAllAndOverride<string>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredFeature) {
      const plan = subscription ? dbStore.billingPlans.find((p) => p.id === subscription.planId) : null;
      if (plan) {
        const feature = dbStore.billingPlanFeatures.find(
          (f) => f.planId === plan.id && f.featureKey === requiredFeature,
        );
        if (feature && !feature.enabled) {
          throw new ForbiddenException({
            code: 'FEATURE_NOT_IN_PLAN',
            message: `The feature '${requiredFeature}' is not included in your current plan. Please upgrade to unlock it.`,
          });
        }
      }
    }

    return true;
  }
}
