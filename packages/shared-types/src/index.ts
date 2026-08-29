export type PartnerIQEnvironment = 'test' | 'live';

export type CurrencyCode = string;

export interface PartnerIQRequestOptions {
  idempotencyKey?: string;
}

export interface PartnerIQErrorPayload {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export interface ConversionCreateRequest {
  externalId: string;
  customerExternalId: string;
  amount: number;
  currency: CurrencyCode;
  type?: 'PURCHASE' | 'SUBSCRIPTION_RENEWAL' | string;
  occurredAt?: string;
  attributionId?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundCreateRequest {
  externalId?: string;
  refundExternalId?: string;
  amount?: number;
  reason?: string;
}

export interface IdentifyCustomerRequest {
  customerId: string;
  attributionId?: string;
  anonymousId?: string;
}

export interface AttachOrderRequest {
  attributionId: string;
  provider: 'RAZORPAY' | 'CASHFREE' | 'JUSPAY' | 'CUSTOM';
  externalOrderId: string;
  amount: number;
  currency: CurrencyCode;
}

export interface TrackingLinkCreateRequest {
  programId: string;
  affiliateId: string;
  destinationUrl: string;
  campaignId?: string;
  customCode?: string;
}

export interface WebhookEndpointCreateRequest {
  url: string;
  subscribedEvents: string[];
}
