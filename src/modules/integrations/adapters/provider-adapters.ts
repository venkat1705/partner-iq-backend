import { BaseIntegrationAdapter, NormalizedIntegrationEvent } from './integration-adapter';

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
