import { Module } from '@nestjs/common';
import { PlansController } from './controllers/plans.controller';
import { BillingController } from './controllers/billing.controller';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { BillingWebhookController } from './controllers/webhook.controller';
import { AdminBillingController } from './controllers/admin-billing.controller';
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
import { BillingCouponService } from './services/billing-coupon.service';
import { BillingCouponValidationService } from './services/billing-coupon-validation.service';
import { BillingPricingService } from './services/billing-pricing.service';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { RazorpayProvider } from './providers/razorpay.provider';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [
    PlansController,
    BillingController,
    SubscriptionsController,
    BillingWebhookController,
    AdminBillingController,
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
    BillingCouponService,
    BillingCouponValidationService,
    BillingPricingService,
    PaymentProviderFactory,
    RazorpayProvider,
  ],
  exports: [PlanService, SubscriptionService, EntitlementService, TrialService, BillingPricingService, BillingCouponService],
})
export class BillingModule {}
