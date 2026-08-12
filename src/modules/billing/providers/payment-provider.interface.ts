import { PaymentProviderType } from '../enums/billing.enums';

export interface CreateCustomerInput {
  name: string;
  email?: string;
  contact?: string;
  notes?: Record<string, string>;
}

export interface ProviderCustomer {
  id: string;
  provider: PaymentProviderType;
}

export interface CreateOrderInput {
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface ProviderOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface CreateSubscriptionInput {
  providerPlanId?: string;
  totalCount: number;
  customerNotify: boolean;
  notes?: Record<string, string>;
}

export interface ProviderSubscription {
  id: string;
  status: string;
  currentStart?: number;
  currentEnd?: number;
}

export interface ProviderRefund {
  id: string;
  amount: number;
  status: string;
}

export interface VerifiedWebhookEvent {
  id: string;
  eventType: string;
  payload: any;
}

export interface PaymentProvider {
  readonly type: PaymentProviderType;
  createCustomer(input: CreateCustomerInput): Promise<ProviderCustomer>;
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription>;
  getSubscription(subscriptionId: string): Promise<ProviderSubscription>;
  cancelSubscription(subscriptionId: string, options?: { cancelAtCycleEnd?: boolean }): Promise<void>;
  refundPayment(paymentId: string, amount?: number): Promise<ProviderRefund>;
  fetchPayment(paymentId: string): Promise<any>;
  verifyPaymentSignature(input: {
    orderId?: string;
    subscriptionId?: string;
    paymentId: string;
    signature: string;
  }): boolean;
  verifyWebhook(payload: Buffer, signature: string): Promise<VerifiedWebhookEvent>;
}
