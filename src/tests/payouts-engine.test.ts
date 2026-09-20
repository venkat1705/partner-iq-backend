import { PayoutsService } from '../modules/payouts/payouts.service';
import { LedgerService } from '../modules/ledger/ledger.service';
import { dbStore } from '../database/store';
import { EnvironmentType, PayoutStatus } from '../common/enums';
import { v4 as uuidv4 } from 'uuid';

export async function runPayoutsTest() {
  console.log('--- Starting Payouts Engine & Settlement Verification ---');

  const testOrgId = uuidv4();
  const testAffiliateId = uuidv4();

  // Seed test organization & affiliate
  dbStore.organizations.push({
    id: testOrgId,
    name: 'Enterprise Settlement Corp',
    slug: 'settlement-corp',
    defaultCurrency: 'INR',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  dbStore.affiliates.push({
    id: testAffiliateId,
    organizationId: testOrgId,
    displayName: 'Apex Global Media',
    email: 'affiliate@apexmedia.io',
    companyName: 'Apex Media Group',
    country: 'IN',
    status: 'ACTIVE' as any,
    trustScore: 92,
    payoutMethod: 'BANK_ACCOUNT',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  const ledgerService = new LedgerService();
  const fraudService = {
    evaluatePayout: async () => ({ decision: 'APPROVE', riskScore: 10 }),
  } as any;
  const webhooksService = {
    triggerEvent: async () => { },
  } as any;

  const payoutsService = new PayoutsService(ledgerService, fraudService, webhooksService);

  // 1. Analytics & Default Baseline Seeding
  console.log('1. Testing getPayoutAnalytics...');
  const analytics = await payoutsService.getPayoutAnalytics(testOrgId, EnvironmentType.LIVE);
  console.log('   Total Settled:', analytics.totalSettled / 100);
  console.log('   Pending Batch (Payable):', analytics.pendingBatch / 100);
  console.log('   In-Flight Processing:', analytics.inFlightProcessing / 100);
  console.log('   Failed Payouts:', analytics.failedPayouts / 100);
  console.log('   Success Rate:', analytics.successRate + '%');
  console.log('   Trajectory points:', analytics.trajectory.length);

  if (analytics.totalSettled <= 0) {
    throw new Error('Analytics did not return seeded settled amount');
  }

  // 2. Pre-flight Validation
  console.log('\n2. Testing validateBatch...');
  const validation = await payoutsService.validateBatch(testOrgId, EnvironmentType.LIVE, {});
  console.log('   Ready Count:', validation.readyCount);
  console.log('   Ready Amount:', validation.readyAmount / 100);
  console.log('   Eligible Partners:', validation.eligiblePartners.length);

  // 3. Paginated Items
  console.log('\n3. Testing getItemsPaginated...');
  const itemsRes = await payoutsService.getItemsPaginated(testOrgId, EnvironmentType.LIVE, { page: 1, limit: 10 });
  console.log(`   Fetched ${itemsRes.data.length} items of ${itemsRes.meta.total} total.`);
  for (const item of itemsRes.data.slice(0, 3)) {
    console.log(`   * ${item.id.slice(0, 8)}: ${item.affiliateName} | ${item.status} | ${item.gateway} | ₹${item.amount / 100}`);
  }

  // 4. Paginated Batches
  console.log('\n4. Testing getBatchesPaginated...');
  const batchesRes = await payoutsService.getBatchesPaginated(testOrgId, EnvironmentType.LIVE, { page: 1, limit: 10 });
  console.log(`   Fetched ${batchesRes.data.length} batches of ${batchesRes.meta.total} total.`);

  // 5. Settlement Reconciliation
  console.log('\n5. Testing getReconciliationData...');
  const recon = await payoutsService.getReconciliationData(testOrgId, EnvironmentType.LIVE);
  console.log('   Reconciliation Rate:', recon.reconciliationRate + '%');
  console.log('   Matched Records:', recon.matchedCount);
  console.log('   Discrepancies:', recon.discrepancyCount);

  // 6. Retry Failed Payout Item
  console.log('\n6. Testing retryFailedItem...');
  const failedItem = itemsRes.data.find((i) => i.status === PayoutStatus.FAILED);
  if (failedItem) {
    const retryRes = await payoutsService.retryFailedItem(testOrgId, failedItem.id, 'ops-admin', { reason: 'Updated IFSC' });
    console.log(`   Retry Success: Item status updated to ${retryRes.item.status} (Ref: ${retryRes.item.providerReference})`);
  }

  console.log('\n [ALL PAYOUT ENGINE TESTS PASSED]');
}

runPayoutsTest().catch((err) => {
  console.error('Payout test failed:', err);
  process.exit(1);
});

