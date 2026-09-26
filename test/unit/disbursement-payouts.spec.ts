import { describe, it, expect, beforeEach } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../src/database/store';
import {
  PayoutStatus,
  EnvironmentType,
  OrganizationIntegrationStatus,
  IntegrationStatus,
  FraudDecision,
} from '../../src/common/enums';
import { PayoutsService } from '../../src/modules/payouts/payouts.service';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { WebhooksService } from '../../src/modules/webhooks/webhooks.service';

describe('Disbursement Payouts (Razorpay & Cashfree)', () => {
  let payoutsService: PayoutsService;
  let orgId: string;
  let affiliateId: string;
  let userId: string;

  beforeEach(() => {
    const ledgerService = new LedgerService();
    const mockFraudService: any = {
      evaluatePayout: async () => ({ decision: FraudDecision.ALLOW, score: 0 }),
    };
    const webhooksService = new WebhooksService();

    payoutsService = new PayoutsService(
      ledgerService,
      mockFraudService,
      webhooksService,
    );

    orgId = `org_${uuidv4()}`;
    affiliateId = `aff_${uuidv4()}`;
    userId = `usr_${uuidv4()}`;

    dbStore.affiliates.push({
      id: affiliateId,
      organizationId: orgId,
      displayName: 'Aarav Sharma',
      email: 'aarav@partnerdomain.example.test',
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
      balance: 50000,
      environment: EnvironmentType.LIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  });

  it('creates and processes payout batches with RazorpayX', async () => {
    const rzpInt = dbStore.integrations.find((i) => i.provider === 'RAZORPAY') || ({
      id: 'int-razorpay',
      name: 'Razorpay',
      slug: 'razorpay',
      provider: 'RAZORPAY',
      category: 'PAYMENTS' as any,
      status: IntegrationStatus.ACTIVE,
    } as any);

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

    const { batch, items } = await payoutsService.createBatch(
      orgId,
      userId,
      { gateway: 'RAZORPAY' },
      EnvironmentType.LIVE,
    );

    expect(batch.gateway).toBe('RazorpayX');
    expect(items.length).toBe(1);
    expect(items[0].gateway).toBe('RazorpayX');
    expect(items[0].amount).toBe(50000);

    const processResult = await payoutsService.processBatch(
      orgId,
      batch.id,
      userId,
      EnvironmentType.LIVE,
      { gateway: 'RAZORPAY' },
    );

    expect(processResult.success).toBe(true);
    expect(processResult.batch.status).toBe(PayoutStatus.COMPLETED);
    expect(processResult.batch.gateway).toBe('RazorpayX');

    const processedItem = dbStore.payoutItems.find((i) => i.batchId === batch.id);
    expect(processedItem).toBeDefined();
    expect(processedItem!.status).toBe(PayoutStatus.COMPLETED);
    expect(processedItem!.gateway).toBe('RazorpayX');
    expect(processedItem!.providerReference?.startsWith('rzp_pout_')).toBe(true);
    expect(processedItem!.disbursementAccount).toBe('2323230012345678');

    const csv = await payoutsService.generateCsvExport(orgId, batch.id);
    expect(csv.includes('gateway')).toBe(true);
    expect(csv.includes('RazorpayX')).toBe(true);
    expect(csv.includes(processedItem!.providerReference!)).toBe(true);
  });

  it('creates and processes payout batches with Cashfree Payouts', async () => {
    const ledgerAcc = dbStore.ledgerAccounts.find((a) => a.organizationId === orgId && a.affiliateId === affiliateId);
    if (ledgerAcc) ledgerAcc.balance = 25000;

    const cfInt = dbStore.integrations.find((i) => i.provider === 'CASHFREE') || ({
      id: 'int-cashfree',
      name: 'Cashfree',
      slug: 'cashfree',
      provider: 'CASHFREE',
      category: 'PAYMENTS' as any,
      status: IntegrationStatus.ACTIVE,
    } as any);

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

    expect(cfBatchRes.batch.gateway).toBe('Cashfree Payouts');

    const cfProcessRes = await payoutsService.processBatch(
      orgId,
      cfBatchRes.batch.id,
      userId,
      EnvironmentType.LIVE,
      { gateway: 'CASHFREE' },
    );

    expect(cfProcessRes.batch.gateway).toBe('Cashfree Payouts');
    const cfItem = dbStore.payoutItems.find((i) => i.batchId === cfBatchRes.batch.id);
    expect(cfItem).toBeDefined();
    expect(cfItem!.gateway).toBe('Cashfree Payouts');
    expect(cfItem!.providerReference?.startsWith('cf_pout_')).toBe(true);
    expect(cfItem!.disbursementAccount).toBe('CF_PAYOUT_PARTNERIQ_01');
  });
});

