import { BaseIntegrationAdapter, NormalizedIntegrationEvent } from './integration-adapter';

export class StripeAdapter extends BaseIntegrationAdapter {
  code = 'STRIPE';
  implementationStatus = 'ACTIVE' as const;

  normalizeWebhookEvent(payload: any): NormalizedIntegrationEvent {
    const type = String(payload?.type || 'stripe.event');
    const normalizedMap: Record<string, string> = {
      'checkout.session.completed': 'conversion.created',
      'invoice.paid': 'subscription.payment_succeeded',
      'charge.refunded': 'conversion.refunded',
      'charge.dispute.created': 'conversion.disputed',
      'customer.subscription.deleted': 'subscription.cancelled',
    };

    return {
      externalEventId: String(payload?.id || `stripe_${Date.now()}`),
      eventType: type,
      normalizedType: normalizedMap[type] || 'integration.event.received',
      occurredAt: payload?.created ? new Date(Number(payload.created) * 1000) : new Date(),
      data: payload || {},
    };
  }
}

export class PaddleAdapter extends BaseIntegrationAdapter {
  code = 'PADDLE';
  implementationStatus = 'ACTIVE' as const;

  normalizeWebhookEvent(payload: any): NormalizedIntegrationEvent {
    const type = String(payload?.event_type || payload?.type || 'paddle.event');
    const normalizedMap: Record<string, string> = {
      'transaction.completed': 'conversion.created',
      'transaction.paid': 'subscription.payment_succeeded',
      'adjustment.created': 'conversion.refunded',
      'subscription.canceled': 'subscription.cancelled',
    };

    return {
      externalEventId: String(payload?.event_id || payload?.id || `paddle_${Date.now()}`),
      eventType: type,
      normalizedType: normalizedMap[type] || 'integration.event.received',
      occurredAt: payload?.occurred_at ? new Date(payload.occurred_at) : new Date(),
      data: payload || {},
    };
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
