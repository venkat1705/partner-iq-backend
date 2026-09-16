import { Module } from '@nestjs/common';
import { PlansController } from './controllers/plans.controller';
import { BillingController } from './controllers/billing.controller';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { SubscriptionLimitsController } from './controllers/subscription-limits.controller';
import { BillingWebhookController } from './controllers/webhook.controller';
import { AdminBillingController } from './controllers/admin-billing.controller';
import { AdminBillingConfigController } from './controllers/admin-billing-config.controller';
import { PlanService } from './services/plan.service';
import { BillingService } from './services/billing.service';
import { SubscriptionService } from './services/subscription.service';
import { EntitlementService } from './services/entitlement.service';
import { TrialService } from './services/trial.service';
import { TrialSchedulerService } from './services/trial-scheduler.service';
import { BillingWebhookService } from './services/webhook.service';
import { InvoiceService } from './services/invoice.service';
import { PaymentService } from './services/payment.service';
import { AdminBillingService } from './services/admin-billing.service';
import { AdminBillingConfigService } from './services/admin-billing-config.service';
import { BillingCouponService } from './services/billing-coupon.service';
import { BillingCouponValidationService } from './services/billing-coupon-validation.service';
import { BillingPricingService } from './services/billing-pricing.service';
import { BillingAccountService } from './services/billing-account.service';
import { BillingTaxService } from './services/billing-tax.service';
import { LimitLockService } from './services/limit-lock.service';
import { SubscriptionUsageService } from './services/subscription-usage.service';
import { SubscriptionLimitService } from './services/subscription-limit.service';
import { AddonService } from './services/addon.service';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { RazorpayProvider } from './providers/razorpay.provider';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [
    PlansController,
    BillingController,
    SubscriptionsController,
    SubscriptionLimitsController,
    BillingWebhookController,
    AdminBillingController,
    AdminBillingConfigController,
  ],
  providers: [
    PlanService,
    BillingService,
    SubscriptionService,
    EntitlementService,
    TrialService,
    TrialSchedulerService,
    BillingWebhookService,
    InvoiceService,
    PaymentService,
    AdminBillingService,
    AdminBillingConfigService,
    BillingCouponService,
    BillingCouponValidationService,
    BillingPricingService,
    BillingAccountService,
    BillingTaxService,
    LimitLockService,
    SubscriptionUsageService,
    SubscriptionLimitService,
    AddonService,
    PaymentProviderFactory,
    RazorpayProvider,
  ],
  exports: [
    PlanService,
    SubscriptionService,
    EntitlementService,
    TrialService,
    BillingPricingService,
    BillingCouponService,
    // Exported so resource modules (organizations, programs, affiliates,
    // memberships) can enforce subscription limits at their creation points.
    BillingAccountService,
    SubscriptionUsageService,
    SubscriptionLimitService,
    AddonService,
  ],
})
export class BillingModule {}
