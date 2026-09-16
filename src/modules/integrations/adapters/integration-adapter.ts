import { createHmac, timingSafeEqual } from 'crypto';

export interface NormalizedIntegrationEvent {
  externalEventId: string;
  eventType: string;
  normalizedType: string;
  occurredAt?: Date;
  data: Record<string, any>;
}

/**
 * What a payment-provider webhook needs to hand PartnerIQ in order to create/refund a
 * Conversion. clickId/attributionId are the trusted attribution identifiers a merchant's
 * checkout can stash on the order (e.g. Cashfree order_tags) at the moment the customer pays -
 * this is what lets a webhook-driven conversion resolve attribution the same way a
 * server-to-server /api/v1/conversions call would.
 */
export interface ConversionWebhookInput {
  kind: 'PAYMENT_SUCCESS' | 'REFUND';
  externalId: string;
  customerExternalId?: string;
  amount: number;
  currency: string;
  clickId?: string;
  attributionId?: string;
  refundExternalId?: string;
  refundAmount?: number;
  occurredAt?: Date;
}

export interface IntegrationAdapter {
  code: string;
  implementationStatus: 'ACTIVE' | 'BETA' | 'COMING_SOON';
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, any>, secret?: string): boolean;
  normalizeWebhookEvent(payload: any): NormalizedIntegrationEvent;
  extractConversionInput?(payload: any): ConversionWebhookInput | null;
}

export abstract class BaseIntegrationAdapter implements IntegrationAdapter {
  abstract code: string;
  abstract implementationStatus: 'ACTIVE' | 'BETA' | 'COMING_SOON';

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, any>, secret?: string) {
    if (!secret) return false;
    const signature = String(headers['x-partneriq-signature'] || headers['stripe-signature'] || headers['paddle-signature'] || '');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const received = signature.includes('=') ? signature.split('=').pop() || '' : signature;
    return this.safeCompare(expected, received);
  }

  normalizeWebhookEvent(payload: any): NormalizedIntegrationEvent {
    return {
      externalEventId: String(payload?.id || payload?.event_id || `evt_${Date.now()}`),
      eventType: String(payload?.type || payload?.event_type || 'unknown.event'),
      normalizedType: 'integration.event.received',
      occurredAt: payload?.created ? new Date(Number(payload.created) * 1000) : new Date(),
      data: payload || {},
    };
  }

  protected safeCompare(expected: string, received: string) {
    if (!expected || !received) return false;
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  }
}
