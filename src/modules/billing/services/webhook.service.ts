import crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { PaymentEventStatus, PaymentProviderType, PaymentStatus, SubscriptionStatus } from '../enums/billing.enums';
import { PaymentProviderFactory } from '../providers/payment-provider.factory';
import { SubscriptionService } from './subscription.service';
import { BillingCouponService } from './billing-coupon.service';
import { AddonService } from './addon.service';

@Injectable()
export class BillingWebhookService {
  constructor(
    private readonly providerFactory: PaymentProviderFactory,
    private readonly subscriptions: SubscriptionService,
    private readonly coupons: BillingCouponService,
    private readonly addons: AddonService,
  ) {}

  async handleRazorpay(payload: Buffer, signature: string) {
    const provider = this.providerFactory.getProvider(PaymentProviderType.RAZORPAY);
    const verified = await provider.verifyWebhook(payload, signature);
    const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
    const existing = dbStore.billingPaymentEvents.find(
      (item) => item.provider === PaymentProviderType.RAZORPAY && item.providerEventId === verified.id,
    );
    if (existing) {
      return { received: true, duplicate: true };
    }

    const event: any = {
      id: uuidv4(),
      provider: PaymentProviderType.RAZORPAY,
      providerEventId: verified.id,
      eventType: verified.eventType,
      payloadHash,
      status: PaymentEventStatus.RECEIVED,
      retryCount: 0,
      receivedAt: new Date(),
      createdDate: new Date(),
    };
    dbStore.billingPaymentEvents.push(event as any);

    try {
      await this.dispatch(verified.eventType, verified.payload);
      event.status = PaymentEventStatus.PROCESSED;
      event.processedAt = new Date();
    } catch (error: any) {
      event.status = PaymentEventStatus.FAILED;
      event.errorMessage = error?.message || 'Webhook processing failed';
      throw error;
    }

    return { received: true };
  }

  private async dispatch(eventType: string, payload: any) {
    switch (eventType) {
      case 'payment.captured':
        return this.handlePaymentCaptured(payload);
      case 'payment.failed':
        return this.handlePaymentFailed(payload);
      case 'subscription.activated':
        return this.handleSubscriptionActivated(payload);
      case 'subscription.charged':
        return this.handleSubscriptionCharged(payload);
      case 'subscription.cancelled':
        return this.handleSubscriptionCancelled(payload);
      case 'subscription.completed':
        return this.handleSubscriptionCompleted(payload);
      case 'subscription.paused':
        return this.handleSubscriptionStatus(payload, SubscriptionStatus.PAUSED);
      case 'subscription.resumed':
        return this.handleSubscriptionStatus(payload, SubscriptionStatus.ACTIVE);
      default:
        return undefined;
    }
  }

  private async handlePaymentCaptured(payload: any) {
    const entity = payload?.payload?.payment?.entity;
    if (!entity?.id) return;

    // An add-on order attaches capacity to an existing subscription instead of
    // activating one. `activatePurchases` is idempotent, so this is safe even
    // when the customer's own verify call already ran.
    if (entity.notes?.kind === 'ADDON') {
      return this.handleAddonPaymentCaptured(entity);
    }

    if (dbStore.billingPayments.some((item) => item.providerPaymentId === entity.id)) return;
    const subscriptionId = entity.subscription_id;
    const subscription = subscriptionId
      ? dbStore.billingSubscriptions.find((item) => item.providerSubscriptionId === subscriptionId)
      : entity.notes?.internalSubscriptionId
        ? dbStore.billingSubscriptions.find((item) => item.id === entity.notes.internalSubscriptionId)
      : undefined;
    dbStore.billingPayments.push({
      id: uuidv4(),
      organizationId: subscription?.organizationId || entity.notes?.organizationId,
      subscriptionId: subscription?.id,
      provider: PaymentProviderType.RAZORPAY,
      providerPaymentId: entity.id,
      providerOrderId: entity.order_id,
      providerInvoiceId: entity.invoice_id,
      amount: entity.amount,
      currency: entity.currency,
      status: PaymentStatus.CAPTURED,
      paymentMethod: entity.method,
      paidAt: new Date((entity.created_at || Math.floor(Date.now() / 1000)) * 1000),
      createdDate: new Date(),
      modifiedDate: new Date(),
    });
    if (subscription?.providerSubscriptionId) {
      await this.subscriptions.activateFromProvider(subscription.providerSubscriptionId, PaymentProviderType.RAZORPAY);
    }
    if (subscription && !subscription.providerSubscriptionId) {
      this.subscriptions.activateSubscription(subscription.id);
    }
    if (subscription) {
      this.coupons.consumeForSubscription(subscription.id, entity.id);
    }
  }

  /** Records the payment and switches the order's add-on purchases to ACTIVE. */
  private handleAddonPaymentCaptured(entity: any) {
    if (!dbStore.billingPayments.some((item) => item.providerPaymentId === entity.id)) {
      dbStore.billingPayments.push({
        id: uuidv4(),
        organizationId: entity.notes?.organizationId,
        provider: PaymentProviderType.RAZORPAY,
        providerPaymentId: entity.id,
        providerOrderId: entity.order_id,
        amount: entity.amount,
        currency: entity.currency,
        status: PaymentStatus.CAPTURED,
        paymentMethod: entity.method,
        paidAt: new Date((entity.created_at || Math.floor(Date.now() / 1000)) * 1000),
        createdDate: new Date(),
        modifiedDate: new Date(),
      } as any);
    }

    this.addons.activatePurchases({
      providerOrderId: entity.order_id,
      providerPaymentId: entity.id,
      purchaseIds: entity.notes?.purchaseIds
        ? String(entity.notes.purchaseIds).split(',').filter(Boolean)
        : undefined,
    });
  }

  private async handlePaymentFailed(payload: any) {
    const entity = payload?.payload?.payment?.entity;
    if (!entity?.id) return;

    if (entity.notes?.kind === 'ADDON') {
      // Never grants capacity; simply closes out the pending purchases.
      this.addons.failPurchases(entity.order_id);
    }

    if (dbStore.billingPayments.some((item) => item.providerPaymentId === entity.id)) return;
    const subscription = entity.subscription_id
      ? dbStore.billingSubscriptions.find((item) => item.providerSubscriptionId === entity.subscription_id)
      : undefined;
    if (subscription) {
      subscription.status = SubscriptionStatus.PAST_DUE;
      subscription.modifiedDate = new Date();
      this.coupons.releaseExpiredReservations();
    }
    dbStore.billingPayments.push({
      id: uuidv4(),
      organizationId: subscription?.organizationId || entity.notes?.organizationId,
      subscriptionId: subscription?.id,
      provider: PaymentProviderType.RAZORPAY,
      providerPaymentId: entity.id,
      providerOrderId: entity.order_id,
      amount: entity.amount,
      currency: entity.currency,
      status: PaymentStatus.FAILED,
      paymentMethod: entity.method,
      failureCode: entity.error_code,
      failureReason: entity.error_description,
      createdDate: new Date(),
      modifiedDate: new Date(),
    });
  }

  private async handleSubscriptionActivated(payload: any) {
    const entity = payload?.payload?.subscription?.entity;
    if (entity?.id) await this.subscriptions.activateFromProvider(entity.id, PaymentProviderType.RAZORPAY);
  }

  private async handleSubscriptionCharged(payload: any) {
    await this.handlePaymentCaptured(payload);
    await this.handleSubscriptionActivated(payload);
  }

  private async handleSubscriptionCancelled(payload: any) {
    await this.handleSubscriptionStatus(payload, SubscriptionStatus.CANCELLED);
  }

  private async handleSubscriptionCompleted(payload: any) {
    await this.handleSubscriptionStatus(payload, SubscriptionStatus.COMPLETED);
  }

  private async handleSubscriptionStatus(payload: any, status: SubscriptionStatus) {
    const entity = payload?.payload?.subscription?.entity;
    const subscription = dbStore.billingSubscriptions.find((item) => item.providerSubscriptionId === entity?.id);
    if (!subscription) return;
    subscription.status = status;
    subscription.currentPeriodStart = entity.current_start ? new Date(entity.current_start * 1000) : subscription.currentPeriodStart;
    subscription.currentPeriodEnd = entity.current_end ? new Date(entity.current_end * 1000) : subscription.currentPeriodEnd;
    subscription.nextBillingDate = subscription.currentPeriodEnd;
    subscription.cancelledAt = status === SubscriptionStatus.CANCELLED ? new Date() : subscription.cancelledAt;
    subscription.modifiedDate = new Date();
  }

}
