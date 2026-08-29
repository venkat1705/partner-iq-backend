import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import {
  IntegrationEventStatus,
  IntegrationStatus,
  OrganizationIntegrationStatus,
  PlatformRole,
} from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { integrationAdapterRegistry } from './adapters/registry';
import { IntegrationCredentialService } from './integration-credential.service';

@Injectable()
export class IntegrationsService {
  constructor(private readonly credentialService: IntegrationCredentialService) {}

  listAdminIntegrations(user: AuthUserPayload) {
    this.assertSuperAdmin(user);
    return this.integrationSummaries();
  }

  getMetrics(user: AuthUserPayload) {
    this.assertSuperAdmin(user);
    return this.metricsFor(this.integrationSummaries());
  }

  getAdminIntegration(user: AuthUserPayload, integrationId: string) {
    this.assertSuperAdmin(user);
    const integration = this.findIntegration(integrationId);
    return {
      ...this.summarizeIntegration(integration),
      connections: this.connectionsFor(integration.id),
      events: this.eventsFor(integration.id),
      adapterStatus: integrationAdapterRegistry.get(integration.code)?.implementationStatus || 'COMING_SOON',
    };
  }

  updateStatus(user: AuthUserPayload, integrationId: string, status: IntegrationStatus) {
    this.assertSuperAdmin(user);
    const integration = this.findIntegration(integrationId);
    integration.status = status;
    integration.updatedAt = new Date();
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId: undefined,
      actorType: 'USER',
      actorId: user.userId,
      action: 'INTEGRATION_STATUS_UPDATED' as any,
      resourceType: 'integration',
      resourceId: integration.id,
      metadata: { code: integration.code, status },
      createdAt: new Date(),
    });
    return this.summarizeIntegration(integration);
  }

  connections(user: AuthUserPayload, integrationId: string) {
    this.assertSuperAdmin(user);
    return this.connectionsFor(this.findIntegration(integrationId).id);
  }

  events(user: AuthUserPayload, integrationId: string) {
    this.assertSuperAdmin(user);
    return this.eventsFor(this.findIntegration(integrationId).id);
  }

  receiveWebhook(code: string, publicConnectionId: string, body: any, headers: Record<string, any>) {
    const integration = dbStore.integrations.find((item) => item.code === code.toUpperCase());
    if (!integration) throw new NotFoundException('Integration not found');
    const connection = dbStore.organizationIntegrations.find(
      (item) => item.publicId === publicConnectionId && item.integrationId === integration.id,
    );
    if (!connection) throw new NotFoundException('Integration connection not found');

    const rawBody = Buffer.from(JSON.stringify(body || {}));
    const adapter = integrationAdapterRegistry.get(integration.code);
    const startedAt = Date.now();
    let normalized = adapter?.normalizeWebhookEvent(body) || {
      externalEventId: `evt_${uuidv4()}`,
      eventType: 'unknown.event',
      normalizedType: 'integration.event.received',
      data: body || {},
    };

    const duplicate = dbStore.integrationEvents.find(
      (event) => event.organizationIntegrationId === connection.id && event.externalEventId === normalized.externalEventId,
    );
    if (duplicate) {
      duplicate.status = IntegrationEventStatus.DUPLICATE;
      return { received: true, duplicate: true, eventId: duplicate.id };
    }

    let status = IntegrationEventStatus.PROCESSED;
    let error: string | undefined;
    try {
      const secret = this.safeCredential(connection.id, 'webhook_secret');
      if (adapter && integration.supportsWebhooks && !adapter.verifyWebhookSignature(rawBody, headers, secret)) {
        status = IntegrationEventStatus.FAILED;
        error = 'Webhook signature verification failed';
      }
    } catch {
      status = IntegrationEventStatus.FAILED;
      error = 'Webhook secret is not configured';
    }

    const event = {
      id: uuidv4(),
      organizationId: connection.organizationId,
      integrationId: integration.id,
      organizationIntegrationId: connection.id,
      externalEventId: normalized.externalEventId,
      eventType: normalized.eventType,
      normalizedType: normalized.normalizedType,
      payloadHash: createHash('sha256').update(rawBody).digest('hex'),
      payloadReference: undefined,
      status,
      processingMs: Date.now() - startedAt,
      error,
      metadata: { adapter: adapter?.implementationStatus || 'COMING_SOON' },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    dbStore.integrationEvents.push(event);
    connection.lastWebhookAt = new Date();
    connection.lastError = error;
    connection.status = error ? OrganizationIntegrationStatus.ERROR : OrganizationIntegrationStatus.CONNECTED;

    return { received: true, eventId: event.id, status };
  }

  integrationSummaries() {
    return [...dbStore.integrations]
      .filter((integration) => integration.code === 'HUBSPOT')
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
      .map((integration) => this.summarizeIntegration(integration));
  }

  metricsFor(integrations = this.integrationSummaries()) {
    return {
      totalIntegrations: integrations.length,
      activeIntegrations: integrations.filter((item) => item.status === IntegrationStatus.ACTIVE).length,
      betaIntegrations: integrations.filter((item) => item.status === IntegrationStatus.BETA).length,
      comingSoonIntegrations: integrations.filter((item) => item.status === IntegrationStatus.COMING_SOON).length,
      connectedOrganizations: integrations.reduce((total, item) => total + item.connectedOrganizations, 0),
      healthyConnections: integrations.reduce((total, item) => total + item.healthyConnections, 0),
      degradedConnections: integrations.reduce((total, item) => total + item.degradedConnections, 0),
      failedConnections: integrations.reduce((total, item) => total + item.failedConnections, 0),
      eventsToday: integrations.reduce((total, item) => total + item.eventsToday, 0),
    };
  }

  private summarizeIntegration(integration: any) {
    const connections = dbStore.organizationIntegrations.filter((item) => item.integrationId === integration.id);
    const events = dbStore.integrationEvents.filter((item) => item.integrationId === integration.id);
    const today = new Date().toISOString().slice(0, 10);
    const processed = events.filter((event) => event.status === IntegrationEventStatus.PROCESSED).length;
    const failed = events.filter((event) => event.status === IntegrationEventStatus.FAILED).length;
    const total = processed + failed;

    return {
      id: integration.id,
      code: integration.code,
      name: integration.name,
      slug: integration.slug,
      description: integration.description,
      category: integration.category,
      provider: integration.provider,
      status: integration.status,
      connectionTypes: integration.connectionTypes || [],
      supportsOAuth: integration.supportsOAuth,
      supportsWebhooks: integration.supportsWebhooks,
      supportsApiKey: integration.supportsApiKey,
      documentationUrl: integration.documentationUrl,
      iconKey: integration.iconKey,
      displayOrder: integration.displayOrder,
      connectedOrganizations: connections.length,
      healthyConnections: connections.filter((item) => item.status === OrganizationIntegrationStatus.CONNECTED).length,
      degradedConnections: connections.filter((item) => item.status === OrganizationIntegrationStatus.REAUTH_REQUIRED || item.status === OrganizationIntegrationStatus.PENDING).length,
      failedConnections: connections.filter((item) => item.status === OrganizationIntegrationStatus.ERROR).length,
      eventsToday: events.filter((event) => new Date(event.createdAt).toISOString().slice(0, 10) === today).length,
      successRate: total === 0 ? 100 : Math.round((processed / total) * 1000) / 10,
      avgProcessingMs: events.length === 0 ? 0 : Math.round(events.reduce((sum, event) => sum + Number(event.processingMs || 0), 0) / events.length),
      webhookSuccessRate: total === 0 ? 100 : Math.round((processed / total) * 1000) / 10,
    };
  }

  private connectionsFor(integrationId: string) {
    return dbStore.organizationIntegrations
      .filter((item) => item.integrationId === integrationId)
      .map((connection) => ({
        id: connection.id,
        organizationId: connection.organizationId,
        orgName: dbStore.organizations.find((org) => org.id === connection.organizationId)?.name || 'Unknown Organization',
        status: connection.status,
        environment: connection.environment,
        connectedAt: this.dateTime(connection.connectedAt),
        lastSyncAt: this.dateTime(connection.lastSyncAt),
        lastWebhookAt: this.dateTime(connection.lastWebhookAt),
        lastError: connection.lastError,
        publicId: connection.publicId,
      }));
  }

  private eventsFor(integrationId: string) {
    return dbStore.integrationEvents
      .filter((item) => item.integrationId === integrationId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((event) => ({
        id: event.id,
        orgName: dbStore.organizations.find((org) => org.id === event.organizationId)?.name || 'Unknown Organization',
        externalEventId: event.externalEventId,
        eventType: event.eventType,
        normalizedType: event.normalizedType || 'integration.event.received',
        status: event.status,
        processingMs: event.processingMs,
        error: event.error,
        createdAt: this.dateTime(event.createdAt),
      }));
  }

  private findIntegration(integrationId: string) {
    const integration = dbStore.integrations.find(
      (item) => item.id === integrationId || item.slug === integrationId || item.code === integrationId.toUpperCase(),
    );
    if (!integration) throw new NotFoundException('Integration not found');
    return integration;
  }

  private safeCredential(connectionId: string, key: string) {
    try {
      return this.credentialService.getCredential(connectionId, key);
    } catch {
      return undefined;
    }
  }

  private assertSuperAdmin(user: AuthUserPayload) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }
  }

  private dateTime(value?: Date) {
    return value ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) : '';
  }
}
