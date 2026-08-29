import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, WebhookEndpointEntity, WebhookDeliveryEntity } from '../../database/store';
import { SecurityUtils } from '../../common/utils/security.utils';
import { AuditAction, WebhookEvent } from '../../common/enums';
import { CreateWebhookEndpointDto, UpdateWebhookEndpointDto } from './dto/webhook.dto';

@Injectable()
export class WebhooksService {
  async createEndpoint(organizationId: string, createdByUserId: string, dto: CreateWebhookEndpointDto) {
    this.validateWebhookUrl(dto.url);
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
      const deliveryId = `del_${uuidv4()}`;

      // Record simulated async dispatch delivery
      const delivery: WebhookDeliveryEntity = {
        id: deliveryId,
        endpointId: ep.id,
        eventId: `evt_${uuidv4()}`,
        attempt: 1,
        requestBody: rawBody,
        responseCode: 200,
        responseBodyTruncated: JSON.stringify({
          received: true,
          headers: {
            'PartnerIQ-Event': event,
            'PartnerIQ-Delivery': deliveryId,
            'PartnerIQ-Timestamp': String(timestamp),
            'PartnerIQ-Signature': `v1=${signature}`,
          },
        }),
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

  private validateWebhookUrl(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Webhook URL must be a valid URL');
    }
    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('Webhook URL must use HTTPS');
    }
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host) || // AWS / GCP / Azure link-local instance metadata
      /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(host) || // Carrier-grade NAT (RFC 6598)
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '0:0:0:0:0:0:0:1' ||
      host.startsWith('fe80:') || // IPv6 link-local
      host.startsWith('fc00:') || // IPv6 unique local
      host.startsWith('fd00:')
    ) {
      throw new BadRequestException('Webhook URL cannot target private, local, or cloud metadata network addresses');
    }
  }
}
