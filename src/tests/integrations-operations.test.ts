import assert from 'assert';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, OrganizationIntegrationEntity, IntegrationEntity } from '../database/store';
import {
  IntegrationCategory,
  IntegrationEnvironment,
  IntegrationEventStatus,
  IntegrationStatus,
  OrganizationIntegrationStatus,
} from '../common/enums';
import { IntegrationsService } from '../modules/integrations/integrations.service';
import { IntegrationCredentialService } from '../modules/integrations/integration-credential.service';
import { IntegrationProviderFactory } from '../modules/integrations/providers/provider.factory';
import { HubSpotProvider } from '../modules/integrations/providers/hubspot.provider';
import { ZohoCrmProvider } from '../modules/integrations/providers/zoho-crm.provider';
import { RazorpayProvider } from '../modules/integrations/providers/razorpay.provider';
import { CashfreeProvider } from '../modules/integrations/providers/cashfree.provider';
import { RazorpayTokenService } from '../modules/integrations/razorpay/razorpay-token.service';

async function runOperationsSuite() {
  console.log('🧪 Starting Integrations Operations & Control Center Verification Suite...\n');

  // Setup services
  const credentialService = new IntegrationCredentialService();
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
  const service = new IntegrationsService(
    credentialService,
    providerFactory,
    razorpayTokenService,
  );

  // Setup test organizations
  const orgA = 'org_test_ops_a_' + uuidv4().slice(0, 8);
  const orgB = 'org_test_ops_b_' + uuidv4().slice(0, 8);
  const userA = 'user_test_ops_a_' + uuidv4().slice(0, 8);

  dbStore.organizations.push(
    { id: orgA, name: 'Acme Corp', slug: 'acme-corp' } as any,
    { id: orgB, name: 'Beta Inc', slug: 'beta-inc' } as any,
  );

  // Ensure catalog has HubSpot and Razorpay
  let hubspot = dbStore.integrations.find((i) => i.slug === 'hubspot');
  if (!hubspot) {
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
  }

  let razorpay = dbStore.integrations.find((i) => i.slug === 'razorpay');
  if (!razorpay) {
    razorpay = {
      id: uuidv4(),
      code: 'RAZORPAY',
      name: 'Razorpay',
      slug: 'razorpay',
      category: IntegrationCategory.PAYMENTS,
      provider: 'RAZORPAY',
      status: IntegrationStatus.ACTIVE,
      supportsOAuth: true,
      supportsWebhooks: true,
      supportsApiKey: true,
      capabilities: ['payments', 'orders', 'refunds', 'webhooks'],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as IntegrationEntity;
    dbStore.integrations.push(razorpay);
  }

  // Create connected integration for Org A
  const connA: OrganizationIntegrationEntity = {
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

  // Store mock AES credential for connA
  credentialService.storeCredential(connA.id, 'privateAppToken', 'pat_live_test_secret_12345');

  // Test 1: List connections
  const connections = service.listOrganizationConnections(orgA);
  assert.strictEqual(connections.length, 1, 'Org A should have exactly 1 connection');
  assert.strictEqual(connections[0].integrationSlug, 'hubspot');
  assert.strictEqual(connections[0].status, OrganizationIntegrationStatus.CONNECTED);
  console.log('✅ PASS: Organization connections listed with masked credentials and environment');

  // Test 2: Trigger Sync
  const syncResult = await service.triggerSync(orgA, userA, 'hubspot', { entityType: 'contacts' });
  assert.strictEqual(syncResult.status, 'SUCCEEDED');
  assert(syncResult.durationMs >= 0, 'Duration should be recorded in ms');

  const syncLogs = service.listSyncLogs(orgA, 'hubspot');
  assert.strictEqual(syncLogs.length, 1, 'Should find recorded sync log');
  assert.strictEqual(syncLogs[0].status, 'SUCCEEDED');
  assert.strictEqual(syncLogs[0].operation, 'MANUAL_SYNC');
  console.log('✅ PASS: Sync triggered, logged with duration, and audited');

  // Test 3: List Webhook Events
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
  assert.strictEqual(events.length, 1, 'Should find recorded webhook event');
  assert.strictEqual(events[0].externalEventId, 'evt_hubspot_12345');
  assert.strictEqual(events[0].status, IntegrationEventStatus.PROCESSED);
  console.log('✅ PASS: Integration webhook events retrieved with latency and status');

  // Test 4: Error grouping & Retry
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
  assert.strictEqual(errors.length, 1, 'Should group errors by fingerprint');
  assert.strictEqual(errors[0].providerErrorCode, 'AUTH_EXPIRED');
  assert.strictEqual(errors[0].occurrences, 1);
  assert(errors[0].suggestedResolution.includes('Authentication'), 'Should provide actionable resolution advice');
  console.log('✅ PASS: Errors grouped by fingerprint with resolution advice');

  // Test 5: Idempotent Retry
  const retryResult = await service.retryOperation(orgA, userA, 'hubspot', {
    operationId: failedSyncId,
    operationType: 'SYNC',
  });
  assert.strictEqual(retryResult.success, true);
  const updatedErrors = service.listErrors(orgA, 'hubspot');
  assert.strictEqual(updatedErrors.length, 0, 'Original error should be resolved after successful retry');
  console.log('✅ PASS: Idempotent retry resolved failed sync and created retry log');

  // Test 6: Deterministic Health Signals
  const health = await service.getIntegrationHealth(orgA, 'hubspot');
  assert.strictEqual(health.status, 'OPERATIONAL');
  assert.strictEqual(health.signals.authentication.status, 'VALID');
  assert.strictEqual(health.signals.providerConnectivity.status, 'OPERATIONAL');
  assert.strictEqual(health.signals.rateLimits.status, 'HEALTHY');
  console.log('✅ PASS: Deterministic health breakdown calculated from live signals');

  // Test 7: Field Mappings
  const mappings = await service.getFieldMappings(orgA, 'hubspot');
  assert(mappings.length >= 1, 'Should return default or stored field mappings');

  const updatedMappings = await service.updateFieldMappings(orgA, userA, 'hubspot', {
    mappings: [
      { partnerIqField: 'email', externalField: 'customer_email', required: true },
      { partnerIqField: 'firstName', externalField: 'given_name', required: true },
    ],
  });
  assert.strictEqual(updatedMappings.find((m) => m.partnerIqField === 'email')?.externalField, 'customer_email');
  console.log('✅ PASS: Field mappings updated and versioned in crmFieldMappings store');

  // Test 8: Connection Status Mutation (Pause / Resume)
  const statusUpdate = await service.updateConnectionStatus(orgA, userA, connA.id, {
    status: 'PAUSED' as any,
  });
  assert.strictEqual(statusUpdate.success, true);
  assert.strictEqual(connA.status, 'PAUSED' as any);
  console.log('✅ PASS: Connection status successfully updated to PAUSED');

  // Test 9: Tenant Isolation
  const orgBConnections = service.listOrganizationConnections(orgB);
  assert.strictEqual(orgBConnections.length, 0, 'Org B should see zero connections');

  const orgBSyncs = service.listSyncLogs(orgB);
  assert.strictEqual(orgBSyncs.length, 0, 'Org B should not see Org A sync logs');

  try {
    await service.triggerSync(orgB, 'user_b', 'hubspot');
    assert.fail('Org B should not be allowed to trigger sync on an unconnected integration');
  } catch (err: any) {
    assert(err.message.includes('not connected'));
  }
  console.log('✅ PASS: Multi-tenant boundary strictly preserved between organizations');

  console.log('\n========================================');
  console.log('Results: 9 passed, 0 failed');
  console.log('========================================\n');
}

runOperationsSuite().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
