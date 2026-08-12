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
import { BillingWebhookService } from './services/webhook.service';
import { InvoiceService } from './services/invoice.service';
import { PaymentService } from './services/payment.service';
import { AdminBillingService } from './services/admin-billing.service';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { RazorpayProvider } from './providers/razorpay.provider';

@Module({
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
    BillingWebhookService,
    InvoiceService,
    PaymentService,
    AdminBillingService,
    PaymentProviderFactory,
    RazorpayProvider,
  ],
  exports: [PlanService, SubscriptionService, EntitlementService],
})
export class BillingModule {}
