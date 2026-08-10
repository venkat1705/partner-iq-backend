import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, WebhookEndpointEntity, WebhookDeliveryEntity } from '../../database/store';
import { SecurityUtils } from '../../common/utils/security.utils';
import { AuditAction, WebhookEvent } from '../../common/enums';
import { CreateWebhookEndpointDto, UpdateWebhookEndpointDto } from './dto/webhook.dto';

@Injectable()
export class WebhooksService {
  async createEndpoint(organizationId: string, createdByUserId: string, dto: CreateWebhookEndpointDto) {
    const { secret, hash } = SecurityUtils.generateWebhookSecret();
    const encryptedSecret = SecurityUtils.encrypt(secret);

    const endpoint: WebhookEndpointEntity = {
      id: uuidv4(),
      organizationId,
      url: dto.url,
      secretHash: hash,
      secretEncrypted: encryptedSecret,
      enabled: true,
      subscribedEvents: dto.subscribedEvents,
      createdAt: new Date(),
    };

    dbStore.webhookEndpoints.push(endpoint);

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: createdByUserId,
      action: AuditAction.WEBHOOK_CREATED,
      resourceType: 'webhook_endpoint',
      resourceId: endpoint.id,
      createdAt: new Date(),
    });

    return {
      id: endpoint.id,
      url: endpoint.url,
      secret, // Returned ONLY ONCE
      subscribedEvents: endpoint.subscribedEvents,
      createdAt: endpoint.createdAt,
    };
  }

  async getEndpoints(organizationId: string) {
    return dbStore.webhookEndpoints
      .filter((e) => e.organizationId === organizationId)
      .map((e) => ({
        id: e.id,
        url: e.url,
        enabled: e.enabled,
        subscribedEvents: e.subscribedEvents,
        createdAt: e.createdAt,
      }));
  }

  async triggerEvent(organizationId: string, event: WebhookEvent, payload: any) {
    const endpoints = dbStore.webhookEndpoints.filter(
      (e) => e.organizationId === organizationId && e.enabled && e.subscribedEvents.includes(event),
    );

    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({ event, timestamp, data: payload });

    for (const ep of endpoints) {
      const secret = SecurityUtils.decrypt(ep.secretEncrypted);
      const signature = SecurityUtils.signWebhookPayload(secret, timestamp, rawBody);

      // Record simulated async dispatch delivery
      const delivery: WebhookDeliveryEntity = {
        id: uuidv4(),
        endpointId: ep.id,
        eventId: `evt_${uuidv4()}`,
        attempt: 1,
        requestBody: rawBody,
        responseCode: 200,
        responseBodyTruncated: '{"received": true}',
        durationMs: 42,
        status: 'SUCCESS',
        createdAt: new Date(),
      };

      dbStore.webhookDeliveries.push(delivery);
    }
  }

  async getDeliveries(organizationId: string) {
    const endpoints = dbStore.webhookEndpoints.filter((e) => e.organizationId === organizationId);
    const endpointIds = endpoints.map((e) => e.id);
    return dbStore.webhookDeliveries.filter((d) => endpointIds.includes(d.endpointId));
  }
}
