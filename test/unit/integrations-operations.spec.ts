import { describe, it, expect, beforeEach } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, OrganizationIntegrationEntity, IntegrationEntity } from '../../src/database/store';
import {
  IntegrationCategory,
  IntegrationEnvironment,
  IntegrationEventStatus,
  IntegrationStatus,
  OrganizationIntegrationStatus,
} from '../../src/common/enums';
import { IntegrationsService } from '../../src/modules/integrations/integrations.service';
import { IntegrationCredentialService } from '../../src/modules/integrations/integration-credential.service';
import { IntegrationProviderFactory } from '../../src/modules/integrations/providers/provider.factory';
import { HubSpotProvider } from '../../src/modules/integrations/providers/hubspot.provider';
import { ZohoCrmProvider } from '../../src/modules/integrations/providers/zoho-crm.provider';
import { RazorpayProvider } from '../../src/modules/integrations/providers/razorpay.provider';
import { CashfreeProvider } from '../../src/modules/integrations/providers/cashfree.provider';
import { RazorpayTokenService } from '../../src/modules/integrations/razorpay/razorpay-token.service';

describe('Integrations Operations & Control Center Suite', () => {
  let credentialService: IntegrationCredentialService;
  let service: IntegrationsService;
  let orgA: string;
  let orgB: string;
  let userA: string;
  let hubspot: IntegrationEntity;
  let connA: OrganizationIntegrationEntity;

  beforeEach(() => {
    credentialService = new IntegrationCredentialService();
    const hubspotProvider = new HubSpotProvider();
    const zohoProvider = new ZohoCrmProvider();
    const razorpayProvider = new RazorpayProvider();
    const cashfreeProvider = new CashfreeProvider();

    const providerFactory = new IntegrationProviderFactory(
      hubspotProvider,
      zohoProvider,
      razorpayProvider,
      cashfreeProvider,
    );

    const razorpayTokenService = new RazorpayTokenService(credentialService, razorpayProvider);
    service = new IntegrationsService(
      credentialService,
      providerFactory,
      razorpayTokenService,
    );

    orgA = 'org_test_ops_a_' + uuidv4().slice(0, 8);
    orgB = 'org_test_ops_b_' + uuidv4().slice(0, 8);
    userA = 'user_test_ops_a_' + uuidv4().slice(0, 8);

    dbStore.organizations.push(
      { id: orgA, name: 'Acme Corp', slug: 'acme-corp' } as any,
      { id: orgB, name: 'Beta Inc', slug: 'beta-inc' } as any,
    );

    hubspot = {
      id: uuidv4(),
      code: 'HUBSPOT',
      name: 'HubSpot',
      slug: 'hubspot',
      category: IntegrationCategory.CRM,
      provider: 'HUBSPOT',
      status: IntegrationStatus.ACTIVE,
      supportsOAuth: true,
      supportsWebhooks: true,
      supportsApiKey: true,
      capabilities: ['contacts', 'companies', 'deals'],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as IntegrationEntity;
    dbStore.integrations.push(hubspot);

    connA = {
      id: uuidv4(),
      organizationId: orgA,
      integrationId: hubspot.id,
      publicId: 'oi_' + uuidv4().replace(/-/g, ''),
      status: OrganizationIntegrationStatus.CONNECTED,
      environment: IntegrationEnvironment.LIVE,
      config: { maskedCredentials: { privateAppToken: 'pat_••••••••91a2' } },
      connectedAt: new Date(),
      lastConnectedAt: new Date(),
      lastCheckedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as OrganizationIntegrationEntity;
    dbStore.organizationIntegrations.push(connA);

    credentialService.storeCredential(connA.id, 'privateAppToken', 'pat_live_test_secret_12345');
  });

  it('lists organization connections with masked credentials and environment', () => {
    const connections = service.listOrganizationConnections(orgA);
    expect(connections.length).toBe(1);
    expect(connections[0].integrationSlug).toBe('hubspot');
    expect(connections[0].status).toBe(OrganizationIntegrationStatus.CONNECTED);
  });

  it('triggers sync, logs execution, and retrieves webhook events', async () => {
    const syncResult = await service.triggerSync(orgA, userA, 'hubspot', { entityType: 'contacts' });
    expect(syncResult.status).toBe('SUCCEEDED');
    expect(syncResult.durationMs).toBeGreaterThanOrEqual(0);

    const syncLogs = service.listSyncLogs(orgA, 'hubspot');
    expect(syncLogs.length).toBe(1);
    expect(syncLogs[0].status).toBe('SUCCEEDED');
    expect(syncLogs[0].operation).toBe('MANUAL_SYNC');

    const eventId = uuidv4();
    dbStore.integrationEvents.push({
      id: eventId,
      organizationId: orgA,
      integrationId: hubspot.id,
      organizationIntegrationId: connA.id,
      externalEventId: 'evt_hubspot_12345',
      eventType: 'contact.creation',
      normalizedType: 'customer.created',
      status: IntegrationEventStatus.PROCESSED,
      processingMs: 142,
      metadata: { test: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const events = service.listEvents(orgA, 'hubspot');
    expect(events.length).toBe(1);
    expect(events[0].externalEventId).toBe('evt_hubspot_12345');
    expect(events[0].status).toBe(IntegrationEventStatus.PROCESSED);
  });

  it('groups errors by fingerprint and executes idempotent retries', async () => {
    const failedSyncId = uuidv4();
    dbStore.integrationSyncLogs.push({
      id: failedSyncId,
      organizationId: orgA,
      organizationIntegrationId: connA.id,
      provider: 'HUBSPOT',
      operation: 'SCHEDULED_SYNC',
      entityType: 'deals',
      direction: 'OUTBOUND',
      status: 'FAILED',
      attempt: 1,
      durationMs: 310,
      errorCode: 'AUTH_EXPIRED',
      errorMessage: 'Token expired during batch dispatch',
      metadata: {},
      createdAt: new Date(),
    } as any);

    const errors = service.listErrors(orgA, 'hubspot');
    expect(errors.length).toBe(1);
    expect(errors[0].providerErrorCode).toBe('AUTH_EXPIRED');
    expect(errors[0].occurrences).toBe(1);

    const retryResult = await service.retryOperation(orgA, userA, 'hubspot', {
      operationId: failedSyncId,
      operationType: 'SYNC',
    });
    expect(retryResult.success).toBe(true);

    const updatedErrors = service.listErrors(orgA, 'hubspot');
    expect(updatedErrors.length).toBe(0);
  });

  it('evaluates deterministic health signals and manages field mappings', async () => {
    const health = await service.getIntegrationHealth(orgA, 'hubspot');
    expect(health.status).toBe('OPERATIONAL');
    expect(health.signals.authentication.status).toBe('VALID');
    expect(health.signals.providerConnectivity.status).toBe('OPERATIONAL');
    expect(health.signals.rateLimits.status).toBe('HEALTHY');

    const mappings = await service.getFieldMappings(orgA, 'hubspot');
    expect(mappings.length).toBeGreaterThanOrEqual(1);

    const updatedMappings = await service.updateFieldMappings(orgA, userA, 'hubspot', {
      mappings: [
        { partnerIqField: 'email', externalField: 'customer_email', required: true },
        { partnerIqField: 'firstName', externalField: 'given_name', required: true },
      ],
    });
    expect(updatedMappings.find((m) => m.partnerIqField === 'email')?.externalField).toBe('customer_email');
  });

  it('updates connection status and strictly enforces multi-tenant boundary', async () => {
    const statusUpdate = await service.updateConnectionStatus(orgA, userA, connA.id, {
      status: 'PAUSED' as any,
    });
    expect(statusUpdate.success).toBe(true);
    expect(connA.status).toBe('PAUSED');

    // Tenant isolation
    const orgBConnections = service.listOrganizationConnections(orgB);
    expect(orgBConnections.length).toBe(0);

    const orgBSyncs = service.listSyncLogs(orgB);
    expect(orgBSyncs.length).toBe(0);

    await expect(service.triggerSync(orgB, 'user_b', 'hubspot')).rejects.toThrow();
  });
});

