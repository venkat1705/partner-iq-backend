import crypto from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { BillingInterval, PaymentProviderType, PaymentStatus, SubscriptionStatus } from '../enums/billing.enums';
import { CheckoutDto, VerifyPaymentDto } from '../dto/billing.dto';
import { PlanService } from './plan.service';
import { SubscriptionService } from './subscription.service';
import { PaymentProviderFactory } from '../providers/payment-provider.factory';
import { PaymentProviderRouter } from '../providers/payment-provider.router';
import { RazorpayProvider } from '../providers/razorpay.provider';

@Injectable()
export class BillingService {
  private readonly router = new PaymentProviderRouter();

  constructor(
    private readonly plans: PlanService,
    private readonly subscriptions: SubscriptionService,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly razorpayProvider: RazorpayProvider,
  ) {}

  async checkout(organizationId: string, userId: string, dto: CheckoutDto, idempotencyKey?: string) {
    this.subscriptions.expireStalePendingCheckouts(organizationId);
    const plan = await this.plans.getActivePlan(dto.planId, dto.billingInterval);
    if (plan.code === 'FREE' || plan.code === 'ENTERPRISE') {
      throw new BadRequestException({ code: 'PLAN_NOT_PURCHASABLE', message: 'This plan does not use online checkout.' });
    }

    const requestHash = crypto.createHash('sha256').update(JSON.stringify({ organizationId, userId, dto })).digest('hex');
    if (idempotencyKey) {
      const existing = dbStore.idempotencyKeys.find((item) => item.organizationId === organizationId && item.key === idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency key was reused with a different request.' });
        }
        return existing.responseBody;
      }
    }

    const org = dbStore.organizations.find((item) => item.id === organizationId);
    if (!org) throw new NotFoundException({ code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found.' });
    const providerType = this.router.resolve({ country: org.country, currency: plan.currency, paymentType: 'SUBSCRIPTION' });
    const provider = this.providerFactory.getProvider(providerType);
    const mapping = dbStore.billingPlanProviderMappings.find(
      (item) => item.planId === plan.id && item.provider === providerType && item.currency === plan.currency && item.isActive,
    );

    let providerSubscriptionId: string | undefined;
    let providerOrderId: string | undefined;
    let providerCustomerId: string | undefined;
    const useRazorpaySubscriptions =
      process.env.BILLING_USE_RAZORPAY_SUBSCRIPTIONS === 'true' && Boolean(mapping?.providerPlanId);
    if (useRazorpaySubscriptions && mapping?.providerPlanId) {
      const user = dbStore.users.find((item) => item.id === userId);
      const existingProviderCustomerId = dbStore.billingSubscriptions
        .filter((item) => item.organizationId === organizationId && item.provider === providerType && item.providerCustomerId)
        .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime())[0]?.providerCustomerId;
      const customer = existingProviderCustomerId
        ? { id: existingProviderCustomerId, provider: providerType }
        : await provider.createCustomer({
          name: org.name,
          email: user?.email,
          notes: { organizationId },
        });
      providerCustomerId = customer.id;
      const providerSubscription = await provider.createSubscription({
        providerPlanId: mapping.providerPlanId,
        totalCount: dto.billingInterval === BillingInterval.YEARLY ? 5 : 120,
        customerNotify: true,
        notes: { organizationId, planId: plan.id },
      });
      providerSubscriptionId = providerSubscription.id;
    }

    const subscription = this.subscriptions.createPending({
      organizationId,
      planId: plan.id,
      provider: providerType,
      providerCustomerId,
      providerSubscriptionId,
      billingInterval: dto.billingInterval,
      userId,
    });

    if (!useRazorpaySubscriptions) {
      const order = await provider.createOrder({
        amount: plan.price,
        currency: plan.currency,
        receipt: `sub_${organizationId.slice(0, 8)}_${Date.now()}`,
        notes: {
          organizationId,
          planId: plan.id,
          billingInterval: dto.billingInterval,
          internalSubscriptionId: subscription.id,
        },
      });
      providerOrderId = order.id;
    }

    const response = {
      provider: providerType,
      plan,
      subscription,
      checkout: {
        key: providerType === PaymentProviderType.RAZORPAY ? this.razorpayProvider.getCheckoutKey() : '',
        orderId: providerOrderId,
        subscriptionId: providerSubscriptionId,
        amount: plan.price,
        currency: plan.currency,
        name: 'PartnerIQ',
        description: `${plan.name} ${dto.billingInterval.toLowerCase()}`,
        notes: { organizationId, internalSubscriptionId: subscription.id },
      },
    };

    if (idempotencyKey) {
      dbStore.idempotencyKeys.push({
        id: uuidv4(),
        organizationId,
        key: idempotencyKey,
        requestHash,
        responseStatus: 200,
        responseBody: response,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        createdAt: new Date(),
      });
    }
    return response;
  }

  async verify(organizationId: string, dto: VerifyPaymentDto) {
    const provider = this.providerFactory.getProvider(PaymentProviderType.RAZORPAY);
    const valid = provider.verifyPaymentSignature({
      orderId: dto.razorpay_order_id,
      subscriptionId: dto.razorpay_subscription_id,
      paymentId: dto.razorpay_payment_id,
      signature: dto.razorpay_signature,
    });
    if (!valid) {
      throw new BadRequestException({ code: 'INVALID_PAYMENT_SIGNATURE', message: 'Payment signature could not be verified.' });
    }

    const paymentDetails = await provider.fetchPayment(dto.razorpay_payment_id);
    const status = paymentDetails.status === 'captured' ? PaymentStatus.CAPTURED : PaymentStatus.AUTHORIZED;
    const subscription = dto.razorpay_subscription_id
      ? dbStore.billingSubscriptions.find((item) => item.organizationId === organizationId && item.providerSubscriptionId === dto.razorpay_subscription_id)
      : paymentDetails.notes?.internalSubscriptionId
        ? dbStore.billingSubscriptions.find(
          (item) => item.organizationId === organizationId && item.id === paymentDetails.notes.internalSubscriptionId,
        )
        : dbStore.billingSubscriptions
          .filter((item) => item.organizationId === organizationId && item.status === SubscriptionStatus.AUTHENTICATION_PENDING)
          .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime())[0];

    const existing = dbStore.billingPayments.find((item) => item.providerPaymentId === dto.razorpay_payment_id);
    if (!existing) {
      dbStore.billingPayments.push({
        id: uuidv4(),
        organizationId,
        subscriptionId: subscription?.id,
        provider: PaymentProviderType.RAZORPAY,
        providerPaymentId: dto.razorpay_payment_id,
        providerOrderId: dto.razorpay_order_id,
        amount: paymentDetails.amount,
        currency: paymentDetails.currency,
        status,
        paymentMethod: paymentDetails.method,
        paidAt: status === PaymentStatus.CAPTURED ? new Date() : undefined,
        createdDate: new Date(),
        modifiedDate: new Date(),
      });
    }

    if (subscription && paymentDetails.status === 'captured') {
      this.subscriptions.activateSubscription(subscription.id);
    }

    return {
      verified: true,
      message: 'Payment signature verified. Paid access is finalized from provider confirmation/webhook.',
    };
  }

  payments(organizationId: string) {
    return dbStore.billingPayments
      .filter((item) => item.organizationId === organizationId)
      .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime());
  }

  invoices(organizationId: string) {
    return dbStore.billingInvoices
      .filter((item) => item.organizationId === organizationId)
      .sort((a, b) => b.invoiceDate.getTime() - a.invoiceDate.getTime());
  }

}
