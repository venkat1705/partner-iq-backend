import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { lookup as dnsLookup } from 'dns/promises';
import { dbStore, WebhookEndpointEntity, WebhookDeliveryEntity } from '../../database/store';
import { SecurityUtils } from '../../common/utils/security.utils';
import { AuditAction, WebhookEvent } from '../../common/enums';
import { CreateWebhookEndpointDto, UpdateWebhookEndpointDto } from './dto/webhook.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

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

    if (!endpoints.length) return;

    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({ event, timestamp, data: payload });

    await Promise.all(endpoints.map((ep) => this.deliverToEndpoint(ep, event, timestamp, rawBody)));
  }

  private async deliverToEndpoint(
    ep: WebhookEndpointEntity,
    event: WebhookEvent,
    timestamp: number,
    rawBody: string,
  ) {
    const secret = SecurityUtils.decrypt(ep.secretEncrypted);
    const signature = SecurityUtils.signWebhookPayload(secret, timestamp, rawBody);
    const deliveryId = `del_${uuidv4()}`;
    const startedAt = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let responseCode = 0;
    let responseBodyTruncated = '';
    let status = 'FAILED';

    try {
      await this.assertSafeDeliveryTarget(ep.url);
      const response = await fetch(ep.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'PartnerIQ-Event': event,
          'PartnerIQ-Delivery': deliveryId,
          'PartnerIQ-Timestamp': String(timestamp),
          'PartnerIQ-Signature': `v1=${signature}`,
        },
        body: rawBody,
      });

      responseCode = response.status;
      const bodyText = await response.text().catch(() => '');
      responseBodyTruncated = bodyText.slice(0, 2000);
      status = response.ok ? 'SUCCESS' : 'FAILED';
    } catch (error: any) {
      responseCode = 0;
      responseBodyTruncated = `Delivery failed: ${error?.name === 'AbortError' ? 'request timed out after 5000ms' : error?.message || 'unknown error'}`;
      status = 'FAILED';
    } finally {
      clearTimeout(timeout);
    }

    const delivery: WebhookDeliveryEntity = {
      id: deliveryId,
      endpointId: ep.id,
      eventId: `evt_${uuidv4()}`,
      attempt: 1,
      requestBody: rawBody,
      responseCode,
      responseBodyTruncated,
      durationMs: Date.now() - startedAt,
      status,
      createdAt: new Date(),
    };

    dbStore.webhookDeliveries.push(delivery);
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
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || this.isDisallowedNetworkAddress(host)) {
      throw new BadRequestException('Webhook URL cannot target private, local, or cloud metadata network addresses');
    }
  }

  private isDisallowedNetworkAddress(host: string): boolean {
    return (
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host) || // AWS / GCP / Azure link-local instance metadata
      /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(host) || // Carrier-grade NAT (RFC 6598)
      host === '0.0.0.0' ||
      host === '::' ||
      host === '::1' ||
      host === '0:0:0:0:0:0:0:1' ||
      host.startsWith('fe80:') || // IPv6 link-local
      host.startsWith('fc00:') || // IPv6 unique local
      host.startsWith('fd00:') ||
      host.startsWith('::ffff:127.') ||
      host.startsWith('::ffff:10.') ||
      host.startsWith('::ffff:192.168.')
    );
  }

  /**
   * Re-checks the endpoint host at delivery time by resolving DNS, so a
   * webhook URL that passed registration-time validation cannot later be
   * repointed (via DNS rebinding) at a private or cloud-metadata address.
   */
  private async assertSafeDeliveryTarget(url: string): Promise<void> {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || this.isDisallowedNetworkAddress(host)) {
      throw new Error('Webhook URL host is not allowed');
    }
    const resolved = await dnsLookup(parsed.hostname, { all: true });
    for (const { address } of resolved) {
      if (this.isDisallowedNetworkAddress(address.toLowerCase())) {
        throw new Error('Webhook URL resolves to a private or disallowed network address');
      }
    }
  }
}
