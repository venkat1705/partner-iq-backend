import crypto from 'crypto';
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { PaymentProviderType } from '../enums/billing.enums';
import {
  CreateCustomerInput,
  CreateOrderInput,
  CreateSubscriptionInput,
  PaymentProvider,
  ProviderCustomer,
  ProviderOrder,
  ProviderRefund,
  ProviderSubscription,
  VerifiedWebhookEvent,
} from './payment-provider.interface';

@Injectable()
export class RazorpayProvider implements PaymentProvider {
  readonly type = PaymentProviderType.RAZORPAY;

  private get keyId() {
    return process.env.RAZORPAY_KEY_ID || '';
  }

  private get keySecret() {
    return process.env.RAZORPAY_KEY_SECRET || '';
  }

  private get webhookSecret() {
    return process.env.RAZORPAY_WEBHOOK_SECRET || '';
  }

  getCheckoutKey() {
    return this.keyId;
  }

  private ensureConfigured() {
    if (!this.keyId || !this.keySecret) {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Razorpay test credentials are not configured on the server.',
      });
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    this.ensureConfigured();
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });

    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: data?.error?.description || 'Razorpay request failed.',
      });
    }
    return data as T;
  }

  async createCustomer(input: CreateCustomerInput): Promise<ProviderCustomer> {
    const customer = await this.request<any>('/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        contact: input.contact,
        fail_existing: '0',
        notes: input.notes,
      }),
    });
    return { id: customer.id, provider: this.type };
  }

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const order = await this.request<any>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
      }),
    });
    return { id: order.id, amount: order.amount, currency: order.currency, status: order.status };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription> {
    if (!input.providerPlanId) {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Razorpay subscription plan mapping is missing.',
      });
    }
    const subscription = await this.request<any>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        plan_id: input.providerPlanId,
        total_count: input.totalCount,
        customer_notify: input.customerNotify ? 1 : 0,
        notes: input.notes,
      }),
    });
    return this.toSubscription(subscription);
  }

  async getSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    return this.toSubscription(await this.request<any>(`/subscriptions/${subscriptionId}`));
  }

  async cancelSubscription(subscriptionId: string, options?: { cancelAtCycleEnd?: boolean }): Promise<void> {
    await this.request(`/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ cancel_at_cycle_end: options?.cancelAtCycleEnd ? 1 : 0 }),
    });
  }

  async refundPayment(paymentId: string, amount?: number): Promise<ProviderRefund> {
    const refund = await this.request<any>(`/payments/${paymentId}/refund`, {
      method: 'POST',
      body: JSON.stringify(amount ? { amount } : {}),
    });
    return { id: refund.id, amount: refund.amount, status: refund.status };
  }

  async fetchPayment(paymentId: string) {
    return this.request<any>(`/payments/${paymentId}`);
  }

  verifyPaymentSignature(input: { orderId?: string; subscriptionId?: string; paymentId: string; signature: string }) {
    const signedText = input.subscriptionId
      ? `${input.paymentId}|${input.subscriptionId}`
      : `${input.orderId}|${input.paymentId}`;
    const expected = crypto.createHmac('sha256', this.keySecret).update(signedText).digest('hex');
    return this.timingSafeEqual(expected, input.signature);
  }

  async verifyWebhook(payload: Buffer, signature: string): Promise<VerifiedWebhookEvent> {
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Razorpay webhook secret is not configured.',
      });
    }
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(payload).digest('hex');
    if (!this.timingSafeEqual(expected, signature)) {
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Invalid Razorpay webhook signature.',
      });
    }
    const parsed = JSON.parse(payload.toString('utf8'));
    const providerEventId =
      parsed.id ||
      crypto.createHash('sha256').update(`${parsed.event}:${payload.toString('utf8')}`).digest('hex');
    return { id: providerEventId, eventType: parsed.event, payload: parsed };
  }

  private timingSafeEqual(expected: string, actual: string) {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual || '');
    return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }

  private toSubscription(value: any): ProviderSubscription {
    return {
      id: value.id,
      status: value.status,
      currentStart: value.current_start,
      currentEnd: value.current_end,
    };
  }
}
