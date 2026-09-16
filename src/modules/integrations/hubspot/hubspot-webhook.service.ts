import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { IntegrationEventStatus } from '../../../common/enums';
import { PartnerDealsService } from '../../partner-deals/partner-deals.service';
import { IntegrationCredentialService } from '../integration-credential.service';
import { HUBSPOT_PROVIDER } from './hubspot.constants';
import { HubSpotService } from './hubspot.service';
import { HubSpotTokenService } from './hubspot-token.service';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class HubSpotWebhookService {
  constructor(
    private readonly hubSpot: HubSpotService,
    private readonly tokenService: HubSpotTokenService,
    private readonly credentials: IntegrationCredentialService,
    @Inject(forwardRef(() => PartnerDealsService))
    private readonly partnerDeals: PartnerDealsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async receive(body: any, headers: Record<string, any>, rawBody: Buffer) {
    const events = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : [body];
    const integration = this.hubSpot.requireIntegration();
    const processed: Array<Record<string, unknown>> = [];

    for (const eventPayload of events) {
      const portalId = String(eventPayload.portalId || eventPayload.portalIdString || eventPayload.hubId || '');
      const connection = dbStore.organizationIntegrations.find(
        (item) => item.integrationId === integration.id && String(item.config?.externalAccountId || '') === portalId,
      );
      if (!connection) throw new NotFoundException('HubSpot connection not found for webhook portal');

      const platformConfig = dbStore.integrationPlatformConfigs.find((item) => item.provider === HUBSPOT_PROVIDER);
      const webhookSecret = platformConfig ? this.safeCredential(platformConfig.id, 'webhook_secret') : undefined;
      const signature = headers['x-hubspot-signature'] || headers['x-hubspot-signature-v3'];
      // Fail closed: without a configured webhook secret there is no way to verify the
      // request came from HubSpot, so it must be rejected rather than trusted by default —
      // otherwise anyone could forge deauthorization/deal events for this connection.
      const signatureValid = webhookSecret
        ? this.hubSpot.verifyWebhookSignature(rawBody, String(signature || ''), webhookSecret)
        : false;
      const externalEventId = String(eventPayload.eventId || eventPayload.subscriptionId || `${portalId}_${eventPayload.objectId}_${eventPayload.occurredAt || Date.now()}`);
      const duplicate = dbStore.integrationEvents.find((item) => item.organizationIntegrationId === connection.id && item.externalEventId === externalEventId);
      if (duplicate) {
        duplicate.status = IntegrationEventStatus.DUPLICATE;
        processed.push({ eventId: duplicate.id, duplicate: true });
        continue;
      }

      const started = Date.now();
      let status = signatureValid ? IntegrationEventStatus.PROCESSED : IntegrationEventStatus.FAILED;
      let error: string | undefined;
      let result: Record<string, unknown> = {};

      try {
        if (!signatureValid) throw new Error('Invalid HubSpot webhook signature');
        const propertyName = String(eventPayload.propertyName || '');
        const subscriptionType = String(eventPayload.subscriptionType || eventPayload.eventType || '');
        // Handle HubSpot app uninstall / deauthorization events and auto-disconnect
        const lowerSubscription = subscriptionType.toLowerCase();
        const isDeauthEvent = [
          'app_deauthorized',
          'app.deauthorized',
          'integration_deauthorized',
          'integration.deauthorized',
          'oauth.deauthorization',
          'app_uninstalled',
          'integration.uninstalled',
        ].some((t) => lowerSubscription.includes(t));

        if (isDeauthEvent) {
          // Perform a system disconnect and record it in logs/audit
          try {
            // Use a minimal system user for audit purposes
            const systemUser: any = { userId: 'system' };
            // Call HubSpotService.disconnect to mark as disconnected and create audit
            this.hubSpot.disconnect(connection.organizationId, systemUser);
            // Add a sync log entry to surface in integration logs
            this.hubSpot.syncLog(connection, 'app_uninstalled', 'INTEGRATION', 'INBOUND', 'SUCCEEDED', { event: eventPayload });
            // Notify active organization members about the disconnect (in-app + email)
            this.tokenService.notifyIntegrationDisconnected(connection, 'HubSpot app was uninstalled or access was revoked').catch(() => undefined);
            status = IntegrationEventStatus.PROCESSED;
            result = { uninstalled: true };
          } catch (e) {
            status = IntegrationEventStatus.FAILED;
            error = 'Failed to process HubSpot deauthorization';
          }
        } else if (propertyName === 'dealstage' || subscriptionType.includes('deal.propertyChange')) {
          result = await this.partnerDeals.handleHubSpotDealStage(
            connection.organizationId,
            String(eventPayload.objectId),
            String(eventPayload.propertyValue || eventPayload.value || ''),
            eventPayload.amount ? Number(eventPayload.amount) : undefined,
          );
        } else {
          status = IntegrationEventStatus.IGNORED;
          result = { ignored: true, reason: 'Webhook event is not a deal stage change' };
        }
        
      } catch {
        status = IntegrationEventStatus.FAILED;
        error = 'HubSpot webhook processing failed';
      }

      const event = {
        id: uuidv4(),
        organizationId: connection.organizationId,
        integrationId: integration.id,
        organizationIntegrationId: connection.id,
        externalEventId,
        eventType: String(eventPayload.subscriptionType || eventPayload.eventType || 'hubspot.webhook'),
        normalizedType: 'crm.deal_stage.changed',
        payloadHash: createHash('sha256').update(rawBody).digest('hex'),
        payloadReference: undefined,
        status,
        processingMs: Date.now() - started,
        error,
        metadata: { portalId, objectId: eventPayload.objectId, result },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.integrationEvents.push(event);
      connection.lastWebhookAt = new Date();
      connection.lastError = error;
      processed.push({ eventId: event.id, status, result });
    }

    return { received: true, processed };
  }

  private safeCredential(referenceId: string, key: string) {
    try {
      return this.credentials.getCredential(referenceId, key);
    } catch {
      return undefined;
    }
  }
}
