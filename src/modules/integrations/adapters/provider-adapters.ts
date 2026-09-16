import { createHmac } from 'crypto';
import { BaseIntegrationAdapter, ConversionWebhookInput, NormalizedIntegrationEvent } from './integration-adapter';

export class HubSpotAdapter extends BaseIntegrationAdapter {
  code = 'HUBSPOT';
  implementationStatus = 'ACTIVE' as const;

  normalizeWebhookEvent(payload: any): NormalizedIntegrationEvent {
    const event = Array.isArray(payload) ? payload[0] : payload;
    const type = String(event?.subscriptionType || event?.eventType || 'hubspot.webhook');
    return {
      externalEventId: String(event?.eventId || `${event?.portalId || 'hubspot'}_${event?.objectId || Date.now()}`),
      eventType: type,
      normalizedType: type.includes('deal') ? 'crm.deal_stage.changed' : 'integration.event.received',
      occurredAt: event?.occurredAt ? new Date(event.occurredAt) : new Date(),
      data: payload || {},
    };
  }
}

/**
 * Razorpay webhook signature: raw hex HMAC-SHA256 of the exact raw request
 * body, sent in the `X-Razorpay-Signature` header (no prefix, unlike
 * Stripe/Paddle-style `sha256=...` headers) — see Razorpay's webhook docs.
 */
export class RazorpayAdapter extends BaseIntegrationAdapter {
  code = 'RAZORPAY';
  implementationStatus = 'ACTIVE' as const;

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, any>, secret?: string) {
    if (!secret) return false;
    const received = String(headers['x-razorpay-signature'] || '');
    if (!received) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return this.safeCompare(expected, received);
  }

  normalizeWebhookEvent(payload: any): NormalizedIntegrationEvent {
    const eventType = String(payload?.event || 'razorpay.webhook');
    const entity = payload?.payload?.payment?.entity || payload?.payload?.refund?.entity || payload?.payload?.order?.entity;
    return {
      externalEventId: String(entity?.id || `rzp_${Date.now()}`),
      eventType,
      normalizedType: eventType.startsWith('refund.')
        ? 'payment.refund.received'
        : eventType.startsWith('payment.')
          ? 'payment.event.received'
          : 'integration.event.received',
      occurredAt: payload?.created_at ? new Date(Number(payload.created_at) * 1000) : new Date(),
      data: payload || {},
    };
  }

  extractConversionInput(payload: any): ConversionWebhookInput | null {
    const eventType = String(payload?.event || '').toLowerCase();
    const payment = payload?.payload?.payment?.entity;
    const refund = payload?.payload?.refund?.entity;
    const occurredAt = payload?.created_at ? new Date(Number(payload.created_at) * 1000) : undefined;
    const notes = payment?.notes || refund?.notes || {};

    if (eventType.startsWith('refund.') && refund) {
      if (!refund.payment_id || refund.amount == null) return null;
      return {
        kind: 'REFUND',
        externalId: String(refund.payment_id),
        amount: 0,
        currency: String(refund.currency || 'INR'),
        refundExternalId: String(refund.id),
        refundAmount: Number(refund.amount),
        occurredAt,
      };
    }

    if (eventType === 'payment.captured' && payment) {
      if (!payment.id || payment.amount == null) return null;
      return {
        kind: 'PAYMENT_SUCCESS',
        externalId: String(payment.id),
        customerExternalId: notes?.partneriq_customer_id || payment.email || payment.contact,
        amount: Number(payment.amount),
        currency: String(payment.currency || 'INR'),
        clickId: notes?.partneriq_click_id || undefined,
        attributionId: notes?.partneriq_attribution_id || undefined,
        occurredAt,
      };
    }

    return null;
  }
}

/**
 * Cashfree webhook signature: base64 HMAC-SHA256 of `timestamp + rawBody`
 * (concatenated, no separator), sent in `x-webhook-signature`, with the
 * timestamp supplied separately in `x-webhook-timestamp` — see Cashfree PG
 * webhook docs. Verify the exact header names/format against Cashfree's
 * current API version before relying on this in production.
 */
export class CashfreeAdapter extends BaseIntegrationAdapter {
  code = 'CASHFREE';
  implementationStatus = 'ACTIVE' as const;

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, any>, secret?: string) {
    if (!secret) return false;
    const received = String(headers['x-webhook-signature'] || '');
    const timestamp = String(headers['x-webhook-timestamp'] || '');
    if (!received || !timestamp) return false;
    const expected = createHmac('sha256', secret).update(timestamp + rawBody.toString('utf8')).digest('base64');
    return this.safeCompare(expected, received);
  }

  normalizeWebhookEvent(payload: any): NormalizedIntegrationEvent {
    const eventType = String(payload?.type || 'cashfree.webhook');
    const orderData = payload?.data?.order || {};
    const paymentData = payload?.data?.payment || {};
    return {
      externalEventId: String(paymentData?.cf_payment_id || orderData?.order_id || `cf_${Date.now()}`),
      eventType,
      normalizedType: eventType.toUpperCase().includes('REFUND')
        ? 'payment.refund.received'
        : eventType.toUpperCase().includes('PAYMENT')
          ? 'payment.event.received'
          : 'integration.event.received',
      occurredAt: payload?.event_time ? new Date(payload.event_time) : new Date(),
      data: payload || {},
    };
  }

  /**
   * Bridges a Cashfree payment/refund webhook into PartnerIQ's Conversion pipeline.
   * order_tags is the mechanism a merchant's checkout uses to carry the PartnerIQ Click ID
   * (captured client-side from the pi_anon_id-driven click, or resolved server-side via
   * /tracking/identify) through to the payment provider, so attribution can be resolved
   * server-to-server without ever trusting a client-supplied affiliate id.
   */
  extractConversionInput(payload: any): ConversionWebhookInput | null {
    const eventType = String(payload?.type || '').toUpperCase();
    const orderData = payload?.data?.order || {};
    const paymentData = payload?.data?.payment || {};
    const refundData = payload?.data?.refund || {};
    const customerData = payload?.data?.customer_details || {};
    const tags = orderData?.order_tags || {};
    const occurredAt = payload?.event_time ? new Date(payload.event_time) : undefined;

    if (eventType.includes('REFUND')) {
      const cfPaymentId = refundData?.cf_payment_id || paymentData?.cf_payment_id;
      if (!cfPaymentId || refundData?.refund_amount == null) return null;
      return {
        kind: 'REFUND',
        externalId: String(cfPaymentId),
        amount: 0,
        currency: String(refundData?.refund_currency || orderData?.order_currency || 'INR'),
        refundExternalId: String(refundData?.refund_id || refundData?.cf_refund_id || ''),
        refundAmount: Math.round(Number(refundData.refund_amount) * 100),
        occurredAt,
      };
    }

    if (eventType.includes('PAYMENT') && String(paymentData?.payment_status || '').toUpperCase() === 'SUCCESS') {
      const externalId = paymentData?.cf_payment_id || orderData?.order_id;
      if (!externalId || paymentData?.payment_amount == null) return null;
      return {
        kind: 'PAYMENT_SUCCESS',
        externalId: String(externalId),
        customerExternalId: tags?.partneriq_customer_id || customerData?.customer_id || customerData?.customer_email,
        amount: Math.round(Number(paymentData.payment_amount) * 100),
        currency: String(paymentData?.payment_currency || orderData?.order_currency || 'INR'),
        clickId: tags?.partneriq_click_id || undefined,
        attributionId: tags?.partneriq_attribution_id || undefined,
        occurredAt,
      };
    }

    return null;
  }
}

export class BetaAdapter extends BaseIntegrationAdapter {
  implementationStatus = 'BETA' as const;

  constructor(public code: string) {
    super();
  }
}

export class ComingSoonAdapter extends BaseIntegrationAdapter {
  implementationStatus = 'COMING_SOON' as const;

  constructor(public code: string) {
    super();
  }
}
