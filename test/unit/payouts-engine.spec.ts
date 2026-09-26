import { describe, it, expect, beforeEach } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { PayoutsService } from '../../src/modules/payouts/payouts.service';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { dbStore } from '../../src/database/store';
import { EnvironmentType, PayoutStatus } from '../../src/common/enums';

describe('PayoutsService', () => {
  let payoutsService: PayoutsService;
  let testOrgId: string;
  let testAffiliateId: string;

  beforeEach(() => {
    testOrgId = uuidv4();
    testAffiliateId = uuidv4();

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
      email: 'affiliate@apexmedia.example.test',
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

    payoutsService = new PayoutsService(ledgerService, fraudService, webhooksService);

    // Real earned balance for the fixture affiliate — payout batches are only
    // ever created for real, so exercising createBatch()/processBatch() needs
    // a genuine EARNED ledger account, not a fabricated one auto-injected by
    // the service.
    dbStore.ledgerAccounts.push({
      id: uuidv4(),
      organizationId: testOrgId,
      affiliateId: testAffiliateId,
      type: 'EARNED',
      balance: 145000,
      currency: 'INR',
      environment: EnvironmentType.LIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  });

  it('starts with no auto-seeded payout batches or items for a brand-new organization', async () => {
    const itemsRes = await payoutsService.getItemsPaginated(testOrgId, EnvironmentType.LIVE, { page: 1, limit: 10 });
    expect(itemsRes.data.length).toBe(0);

    const batchesRes = await payoutsService.getBatchesPaginated(testOrgId, EnvironmentType.LIVE, { page: 1, limit: 10 });
    expect(batchesRes.data.length).toBe(0);
  });

  it('computes payout analytics and baseline metrics from a real processed batch', async () => {
    const created = await payoutsService.createBatch(testOrgId, 'ops-admin', {}, EnvironmentType.LIVE);
    await payoutsService.processBatch(testOrgId, created.batch.id, 'ops-admin', EnvironmentType.LIVE);

    const analytics = await payoutsService.getPayoutAnalytics(testOrgId, EnvironmentType.LIVE);
    expect(analytics.totalSettled).toBeGreaterThan(0);
    expect(analytics.trajectory.length).toBeGreaterThan(0);
  });

  it('validates pre-flight batch payouts', async () => {
    const validation = await payoutsService.validateBatch(testOrgId, EnvironmentType.LIVE, {});
    expect(validation).toHaveProperty('readyCount');
    expect(validation).toHaveProperty('readyAmount');
    expect(validation).toHaveProperty('eligiblePartners');
  });

  it('retrieves paginated payout items and batches', async () => {
    await payoutsService.createBatch(testOrgId, 'ops-admin', {}, EnvironmentType.LIVE);

    const itemsRes = await payoutsService.getItemsPaginated(testOrgId, EnvironmentType.LIVE, { page: 1, limit: 10 });
    expect(itemsRes.data.length).toBeGreaterThan(0);

    const batchesRes = await payoutsService.getBatchesPaginated(testOrgId, EnvironmentType.LIVE, { page: 1, limit: 10 });
    expect(batchesRes.data.length).toBeGreaterThan(0);
  });

  it('provides settlement reconciliation data', async () => {
    const recon = await payoutsService.getReconciliationData(testOrgId, EnvironmentType.LIVE);
    expect(recon).toHaveProperty('reconciliationRate');
    expect(recon).toHaveProperty('matchedCount');
  });

  it('supports retrying failed payout items', async () => {
    // Fixture a FAILED item directly (a real failure comes from a gateway
    // callback, which this unit suite doesn't drive) the way this suite
    // already fixtures org/affiliate/ledger rows above.
    const failedItemId = uuidv4();
    dbStore.payoutItems.push({
      id: failedItemId,
      batchId: uuidv4(),
      organizationId: testOrgId,
      environment: EnvironmentType.LIVE,
      affiliateId: testAffiliateId,
      amount: 50000,
      currency: 'INR',
      status: PayoutStatus.FAILED,
      gateway: 'Direct Bank Transfer',
      failureReason: 'Beneficiary account validation failed',
      createdAt: new Date(),
    } as any);

    const retryRes = await payoutsService.retryFailedItem(testOrgId, failedItemId, 'ops-admin', { reason: 'Updated IFSC' });
    expect(retryRes.item.status).not.toBe(PayoutStatus.FAILED);
  });
});

