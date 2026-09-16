import assert from 'assert';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, PayoutBatchEntity, PayoutItemEntity } from '../database/store';
import { PayoutStatus, LedgerEntryType, EnvironmentType, OrganizationIntegrationStatus, IntegrationStatus, FraudDecision } from '../common/enums';
import { PayoutsService } from '../modules/payouts/payouts.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { FraudService } from '../modules/fraud/fraud.service';
import { WebhooksService } from '../modules/webhooks/webhooks.service';

async function runDisbursementPayoutsTest() {
  console.log('--- Starting Amount Disbursement (Razorpay & Cashfree) Test ---');

  const ledgerService = new LedgerService();
  const mockFraudService: any = {
    evaluatePayout: async () => ({ decision: FraudDecision.ALLOW, score: 0 }),
  };
  const webhooksService = new WebhooksService();

  const payoutsService = new PayoutsService(
    ledgerService,
    mockFraudService,
    webhooksService,
  );

  const orgId = `org_${uuidv4()}`;
  const affiliateId = `aff_${uuidv4()}`;
  const userId = `usr_${uuidv4()}`;

  // 1. Seed affiliate & ledger account with earned balance
  dbStore.affiliates.push({
    id: affiliateId,
    organizationId: orgId,
    displayName: 'Aarav Sharma',
    email: 'aarav@partnerdomain.com',
    companyName: 'Sharma Media LLC',
    status: 'ACTIVE' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  dbStore.ledgerAccounts.push({
    id: `acc_${uuidv4()}`,
    organizationId: orgId,
    affiliateId,
    type: 'EARNED',
    currency: 'USD',
    balance: 50000, // $500.00
    environment: EnvironmentType.LIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  // 2. Setup Razorpay integration connection for the organization
  const rzpInt = dbStore.integrations.find((i) => i.provider === 'RAZORPAY') || {
    id: 'int-razorpay',
    name: 'Razorpay',
    slug: 'razorpay',
    provider: 'RAZORPAY',
    category: 'PAYMENTS' as any,
    status: IntegrationStatus.ACTIVE,
  } as any;

  if (!dbStore.integrations.some((i) => i.id === rzpInt.id)) {
    dbStore.integrations.push(rzpInt);
  }

  dbStore.organizationIntegrations.push({
    id: `oi_rzp_${uuidv4()}`,
    organizationId: orgId,
    integrationId: rzpInt.id,
    status: OrganizationIntegrationStatus.CONNECTED,
    environment: EnvironmentType.LIVE,
    config: {
      maskedCredentials: {
        keyId: 'rzp_••••1234',
        accountNumber: '2323230012345678',
      },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  // 3. Create a payout batch via RazorpayX
  console.log('Test 1: Create Payout Batch with RazorpayX');
  const { batch, items } = await payoutsService.createBatch(
    orgId,
    userId,
    { gateway: 'RAZORPAY' },
    EnvironmentType.LIVE,
  );

  assert.strictEqual(batch.gateway, 'RazorpayX');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].gateway, 'RazorpayX');
  assert.strictEqual(items[0].amount, 50000);
  console.log('✓ Payout batch created with gateway: RazorpayX');

  // 4. Process the payout batch
  console.log('Test 2: Process Payout Batch via RazorpayX');
  const processResult = await payoutsService.processBatch(
    orgId,
    batch.id,
    userId,
    EnvironmentType.LIVE,
    { gateway: 'RAZORPAY' },
  );

  assert.strictEqual(processResult.success, true);
  assert.strictEqual(processResult.batch.status, PayoutStatus.COMPLETED);
  assert.strictEqual(processResult.batch.gateway, 'RazorpayX');

  const processedItem = dbStore.payoutItems.find((i) => i.batchId === batch.id);
  assert(processedItem, 'Payout item not found');
  assert.strictEqual(processedItem.status, PayoutStatus.COMPLETED);
  assert.strictEqual(processedItem.gateway, 'RazorpayX');
  assert(processedItem.providerReference?.startsWith('rzp_pout_'), `Expected rzp_pout_ prefix but got ${processedItem.providerReference}`);
  assert.strictEqual(processedItem.disbursementAccount, '2323230012345678');
  console.log(`✓ Processed disbursement reference: ${processedItem.providerReference} on account ${processedItem.disbursementAccount}`);

  // 5. Test Cashfree Payouts
  console.log('Test 3: Payout Batch with Cashfree Payouts');
  // Reset affiliate balance
  const ledgerAcc = dbStore.ledgerAccounts.find((a) => a.organizationId === orgId && a.affiliateId === affiliateId);
  if (ledgerAcc) ledgerAcc.balance = 25000; // $250.00

  const cfInt = dbStore.integrations.find((i) => i.provider === 'CASHFREE') || {
    id: 'int-cashfree',
    name: 'Cashfree',
    slug: 'cashfree',
    provider: 'CASHFREE',
    category: 'PAYMENTS' as any,
    status: IntegrationStatus.ACTIVE,
  } as any;

  if (!dbStore.integrations.some((i) => i.id === cfInt.id)) {
    dbStore.integrations.push(cfInt);
  }

  dbStore.organizationIntegrations.push({
    id: `oi_cf_${uuidv4()}`,
    organizationId: orgId,
    integrationId: cfInt.id,
    status: OrganizationIntegrationStatus.CONNECTED,
    environment: EnvironmentType.LIVE,
    config: {
      maskedCredentials: {
        appId: 'CF••••888',
        payoutClientId: 'CF_PAYOUT_PARTNERIQ_01',
      },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  const cfBatchRes = await payoutsService.createBatch(
    orgId,
    userId,
    { gateway: 'CASHFREE' },
    EnvironmentType.LIVE,
  );

  assert.strictEqual(cfBatchRes.batch.gateway, 'Cashfree Payouts');

  const cfProcessRes = await payoutsService.processBatch(
    orgId,
    cfBatchRes.batch.id,
    userId,
    EnvironmentType.LIVE,
    { gateway: 'CASHFREE' },
  );

  assert.strictEqual(cfProcessRes.batch.gateway, 'Cashfree Payouts');
  const cfItem = dbStore.payoutItems.find((i) => i.batchId === cfBatchRes.batch.id);
  assert(cfItem, 'Cashfree payout item not found');
  assert.strictEqual(cfItem.gateway, 'Cashfree Payouts');
  assert(cfItem.providerReference?.startsWith('cf_pout_'), `Expected cf_pout_ prefix but got ${cfItem.providerReference}`);
  assert.strictEqual(cfItem.disbursementAccount, 'CF_PAYOUT_PARTNERIQ_01');
  console.log(`✓ Processed Cashfree disbursement reference: ${cfItem.providerReference} on client ${cfItem.disbursementAccount}`);

  // 6. Test CSV Export includes Gateway and Reference
  console.log('Test 4: CSV Export with Gateway Details');
  const csv = await payoutsService.generateCsvExport(orgId, batch.id);
  assert(csv.includes('gateway'), 'CSV header missing gateway column');
  assert(csv.includes('RazorpayX'), 'CSV missing RazorpayX gateway value');
  assert(csv.includes(processedItem.providerReference!), 'CSV missing provider reference');
  console.log('✓ CSV export includes gateway, provider_reference, and disbursement_account');

  console.log('--- ALL AMOUNT DISBURSEMENT TESTS PASSED SUCCESSFULLY! ---');
}

runDisbursementPayoutsTest().catch((err) => {
  console.error('Disbursement Test Failed:', err);
  process.exit(1);
});
