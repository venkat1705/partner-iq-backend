import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, PayoutBatchEntity, PayoutItemEntity } from '../../database/store';
import {
  PayoutStatus,
  LedgerEntryType,
  AuditAction,
  FraudDecision,
  EnvironmentType,
  WebhookEvent,
  OrganizationIntegrationStatus,
  AffiliateStatus,
} from '../../common/enums';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { LedgerService } from '../ledger/ledger.service';
import { FraudService } from '../fraud/fraud.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  CreatePayoutBatchDto,
  ProcessPayoutBatchDto,
  ListPayoutsQueryDto,
  PayoutAnalyticsQueryDto,
  ValidateBatchDto,
  RetryPayoutItemDto,
  CancelBatchDto,
} from './dto/payout.dto';
import { SystemEmailDispatchService } from '../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import { getAppConfig } from '../../config/app.config';
import { NotificationsService } from '../notifications/notifications.service';

export interface HydratedPayoutItem extends PayoutItemEntity {
  affiliateName: string;
  affiliateEmail: string;
  affiliateCompany?: string;
  maskedAccount: string;
}

export interface HydratedPayoutBatch extends PayoutBatchEntity {
  itemCount: number;
  partnerCount: number;
  successfulCount: number;
  failedCount: number;
  heldCount: number;
  createdByUserName?: string;
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly ledgerService: LedgerService,
    private readonly fraudService: FraudService,
    private readonly webhooksService: WebhooksService,
    private readonly emailDispatch?: SystemEmailDispatchService,
    private readonly notificationsService?: NotificationsService,
  ) { }

  private emitWebhook(organizationId: string, event: WebhookEvent, payload: any) {
    this.webhooksService.triggerEvent(organizationId, event, payload).catch((error) => {
      this.logger.error(`Webhook delivery failed for ${event}: ${error?.message || error}`);
    });
  }

  private async notifyAffiliatePayout(
    templateKey: SystemTemplateKey,
    organizationId: string,
    affiliateId: string,
    amountCents: number,
    currency: string,
    extra: Record<string, any> = {},
  ) {
    const affiliate = dbStore.affiliates.find((a) => a.id === affiliateId);
    if (!affiliate?.email) return;
    const organization = dbStore.organizations.find((o) => o.id === organizationId);
    const dashboardUrl = `${getAppConfig().affiliateFrontendUrl.replace(/\/$/, '')}/payouts`;
    const amountFormatted = `${currency} ${(amountCents / 100).toFixed(2)}`;

    await this.emailDispatch?.send(
      templateKey,
      affiliate.email,
      {
        affiliateName: (affiliate.displayName || '').split(' ')[0] || affiliate.displayName,
        payoutAmount: amountFormatted,
        transactionRef: extra.reference || extra.transactionRef,
        paymentMethod: extra.paymentMethod || affiliate.payoutMethod || 'PartnerIQ Payout',
        transferDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        failureReason: extra.reason || extra.failureReason,
        portalUrl: dashboardUrl,
        updateSettingsUrl: dashboardUrl,
        affiliate: { firstName: (affiliate.displayName || '').split(' ')[0] || affiliate.displayName },
        organization: { name: organization?.name || 'PartnerIQ' },
        payout: { amountFormatted, ...extra },
        links: { dashboardUrl },
      },
      { organizationId },
    );

    const userId = affiliate.userId || dbStore.users.find((u) => u.email?.toLowerCase() === affiliate.email.toLowerCase())?.id;
    if (!userId) return;

    const isProcessing = templateKey === SystemTemplateKey.AFFILIATE_PAYOUT_PROCESSING;
    this.notificationsService?.createNotification({
      userId,
      organizationId,
      type: 'payout',
      title: isProcessing ? 'Payout processing' : 'Payout completed',
      body: isProcessing
        ? `Your payout of ${currency} ${(amountCents / 100).toFixed(2)} is being processed.`
        : `${currency} ${(amountCents / 100).toFixed(2)} has been deposited to your account.`,
      channel: 'in_app',
      priority: 'normal',
      actionUrl: '/payouts',
    }).catch(() => undefined);
  }

  /**
   * Seeds baseline payout batches and items for an organization if none exist,
   * providing rich operational data across all statuses (Completed, Processing, Failed, Held).
   */
  ensureDefaultPayouts(organizationId: string) {
    const existing = dbStore.payoutBatches.filter((b) => b.organizationId === organizationId);
    if (existing.length >= 2) return;

    const affiliates = dbStore.affiliates.filter((a) => a.organizationId === organizationId);
    if (affiliates.length === 0) return;

    const org = dbStore.organizations.find((o) => o.id === organizationId);
    const currency = org?.defaultCurrency || PLATFORM_CURRENCY;
    const now = new Date();

    // Ensure some ledger accounts have positive earned balances for testing "Payable Now"
    for (let i = 0; i < Math.min(affiliates.length, 3); i++) {
      const aff = affiliates[i];
      let acc = dbStore.ledgerAccounts.find(
        (a) => a.organizationId === organizationId && a.affiliateId === aff.id && a.type === 'EARNED',
      );
      if (!acc) {
        acc = {
          id: uuidv4(),
          organizationId,
          affiliateId: aff.id,
          type: 'EARNED',
          balance: 145000 + i * 85000, // in cents
          currency,
          environment: EnvironmentType.LIVE,
          createdAt: new Date(now.getTime() - 20 * 86400000),
          updatedAt: now,
        };
        dbStore.ledgerAccounts.push(acc);
      } else if (acc.balance === 0) {
        acc.balance = 125000 + i * 50000;
        acc.updatedAt = now;
      }
    }

    // Batch 1: Completed via RazorpayX (Past Week)
    const batch1Id = uuidv4();
    const batch1Date = new Date(now.getTime() - 7 * 86400000);
    const batch1Items: PayoutItemEntity[] = [];
    let batch1Total = 0;

    const aff1 = affiliates[0] || { id: uuidv4(), displayName: 'Velocity Growth Labs' };
    const aff2 = affiliates[1] || { id: uuidv4(), displayName: 'Summit Media Partners' };
    const aff3 = affiliates[2] || { id: uuidv4(), displayName: 'Apex Creators Collective' };

    const b1Affs = [aff1, aff2, aff3];
    const b1Amounts = [425000, 280000, 195000]; // in cents

    for (let i = 0; i < b1Affs.length; i++) {
      const a = b1Affs[i];
      const amount = b1Amounts[i];
      batch1Total += amount;
      const itemId = uuidv4();
      const item: PayoutItemEntity = {
        id: itemId,
        batchId: batch1Id,
        organizationId,
        environment: EnvironmentType.LIVE,
        affiliateId: a.id,
        amount,
        currency,
        status: PayoutStatus.COMPLETED,
        gateway: 'RazorpayX',
        disbursementAccount: `••••${4100 + i * 12} (HDFC Bank)`,
        providerReference: `rzp_pout_${uuidv4().replace(/-/g, '').substring(0, 14)}`,
        beneficiaryName: a.displayName,
        payoutMethod: 'BANK_ACCOUNT',
        reconciliationStatus: 'MATCHED',
        reconciledAt: new Date(batch1Date.getTime() + 1800000),
        createdAt: batch1Date,
      };
      batch1Items.push(item);
      dbStore.payoutItems.push(item);
    }

    const batch1: PayoutBatchEntity = {
      id: batch1Id,
      organizationId,
      environment: EnvironmentType.LIVE,
      status: PayoutStatus.COMPLETED,
      totalAmount: batch1Total,
      currency,
      gateway: 'RazorpayX',
      createdBy: 'system-ops',
      createdAt: batch1Date,
      updatedAt: new Date(batch1Date.getTime() + 3600000),
    };
    dbStore.payoutBatches.push(batch1);

    // Batch 2: Completed via Cashfree Payouts (3 Days Ago)
    const batch2Id = uuidv4();
    const batch2Date = new Date(now.getTime() - 3 * 86400000);
    const batch2Items: PayoutItemEntity[] = [];
    let batch2Total = 0;

    const b2Affs = [aff2, aff3];
    const b2Amounts = [310000, 175000];

    for (let i = 0; i < b2Affs.length; i++) {
      const a = b2Affs[i];
      const amount = b2Amounts[i];
      batch2Total += amount;
      const itemId = uuidv4();
      const item: PayoutItemEntity = {
        id: itemId,
        batchId: batch2Id,
        organizationId,
        environment: EnvironmentType.LIVE,
        affiliateId: a.id,
        amount,
        currency,
        status: PayoutStatus.COMPLETED,
        gateway: 'Cashfree Payouts',
        disbursementAccount: i === 0 ? `••••CF88 (ICICI Bank)` : `upi: ve${a.displayName.slice(0, 3).toLowerCase()}@okaxis`,
        providerReference: `cf_pout_${uuidv4().replace(/-/g, '').substring(0, 14)}`,
        beneficiaryName: a.displayName,
        payoutMethod: i === 0 ? 'BANK_ACCOUNT' : 'UPI',
        reconciliationStatus: 'MATCHED',
        reconciledAt: new Date(batch2Date.getTime() + 1200000),
        createdAt: batch2Date,
      };
      batch2Items.push(item);
      dbStore.payoutItems.push(item);
    }

    const batch2: PayoutBatchEntity = {
      id: batch2Id,
      organizationId,
      environment: EnvironmentType.LIVE,
      status: PayoutStatus.COMPLETED,
      totalAmount: batch2Total,
      currency,
      gateway: 'Cashfree Payouts',
      createdBy: 'system-ops',
      createdAt: batch2Date,
      updatedAt: new Date(batch2Date.getTime() + 2400000),
    };
    dbStore.payoutBatches.push(batch2);

    // Batch 3: Mixed Settlement Run (Yesterday) - In-Flight, Failed, Held
    const batch3Id = uuidv4();
    const batch3Date = new Date(now.getTime() - 1 * 86400000);
    let batch3Total = 0;

    // Item 3a: Processing via Direct Bank Transfer
    const item3a: PayoutItemEntity = {
      id: uuidv4(),
      batchId: batch3Id,
      organizationId,
      environment: EnvironmentType.LIVE,
      affiliateId: aff1.id,
      amount: 220000,
      currency,
      status: PayoutStatus.PROCESSING,
      gateway: 'Direct Bank Transfer',
      disbursementAccount: '••••7721 (State Bank of India)',
      providerReference: `pout_${uuidv4().substring(0, 10)}`,
      beneficiaryName: aff1.displayName,
      payoutMethod: 'BANK_ACCOUNT',
      reconciliationStatus: 'PENDING',
      createdAt: batch3Date,
    };
    batch3Total += item3a.amount;
    dbStore.payoutItems.push(item3a);

    // Item 3b: Failed item due to invalid IFSC code
    const item3b: PayoutItemEntity = {
      id: uuidv4(),
      batchId: batch3Id,
      organizationId,
      environment: EnvironmentType.LIVE,
      affiliateId: aff2.id,
      amount: 85000,
      currency,
      status: PayoutStatus.FAILED,
      gateway: 'RazorpayX',
      disbursementAccount: '••••1092 (Axis Bank)',
      providerReference: `rzp_pout_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      failureReason: 'BENEFICIARY_IFSC_INVALID: Bank branch closed or invalid IFSC identifier provided by partner.',
      retryCount: 1,
      lastRetryAt: new Date(batch3Date.getTime() + 3600000),
      beneficiaryName: aff2.displayName,
      payoutMethod: 'BANK_ACCOUNT',
      reconciliationStatus: 'DISCREPANCY',
      createdAt: batch3Date,
    };
    batch3Total += item3b.amount;
    dbStore.payoutItems.push(item3b);

    // Item 3c: Held for Risk / Velocity Check
    const item3c: PayoutItemEntity = {
      id: uuidv4(),
      batchId: batch3Id,
      organizationId,
      environment: EnvironmentType.LIVE,
      affiliateId: aff3.id,
      amount: 450000,
      currency,
      status: PayoutStatus.HELD,
      gateway: 'Cashfree Payouts',
      disbursementAccount: `upi: ${aff3.displayName.slice(0, 4).toLowerCase()}@okhdfcbank`,
      providerReference: `cf_pout_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      failureReason: 'RISK_SCORE_THRESHOLD: Payout flagged by automated fraud rule: spike in weekly commission volume.',
      beneficiaryName: aff3.displayName,
      payoutMethod: 'UPI',
      reconciliationStatus: 'PENDING',
      createdAt: batch3Date,
    };
    batch3Total += item3c.amount;
    dbStore.payoutItems.push(item3c);

    const batch3: PayoutBatchEntity = {
      id: batch3Id,
      organizationId,
      environment: EnvironmentType.LIVE,
      status: PayoutStatus.PARTIALLY_FAILED,
      totalAmount: batch3Total,
      currency,
      gateway: 'RazorpayX',
      createdBy: 'system-ops',
      createdAt: batch3Date,
      updatedAt: now,
    };
    dbStore.payoutBatches.push(batch3);
  }

  private hydrateItem(item: PayoutItemEntity): HydratedPayoutItem {
    const affiliate = dbStore.affiliates.find((a) => a.id === item.affiliateId);
    let masked = item.disbursementAccount;
    if (!masked) {
      masked = item.payoutMethod === 'UPI' ? '••••@upi' : '••••7812 (Direct Bank)';
    }

    return {
      ...item,
      affiliateName: affiliate?.displayName || affiliate?.companyName || 'Affiliate Partner',
      affiliateEmail: affiliate?.email || 'partner@affiliate.io',
      affiliateCompany: affiliate?.companyName,
      maskedAccount: masked,
    };
  }

  private hydrateBatch(batch: PayoutBatchEntity): HydratedPayoutBatch {
    const items = dbStore.payoutItems.filter((i) => i.batchId === batch.id);
    const partnerIds = new Set(items.map((i) => i.affiliateId));
    const user = dbStore.users.find((u) => u.id === batch.createdBy);

    return {
      ...batch,
      itemCount: items.length,
      partnerCount: partnerIds.size,
      successfulCount: items.filter((i) => i.status === PayoutStatus.COMPLETED).length,
      failedCount: items.filter((i) => i.status === PayoutStatus.FAILED).length,
      heldCount: items.filter((i) => i.status === PayoutStatus.HELD).length,
      createdByUserName: user?.displayName || user?.email?.split('@')[0] || 'Operations Lead',
    };
  }

  async getPayoutAnalytics(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query?: PayoutAnalyticsQueryDto,
  ) {
    this.ensureDefaultPayouts(organizationId);

    const org = dbStore.organizations.find((o) => o.id === organizationId);
    const currency = org?.defaultCurrency || PLATFORM_CURRENCY;

    const allItems = dbStore.payoutItems.filter(
      (item) =>
        item.organizationId === organizationId &&
        (item.environment === environment || (!item.environment && environment === EnvironmentType.LIVE)),
    );

    // Eligible balances from double-entry ledger accounts
    const eligibleAccounts = dbStore.ledgerAccounts.filter(
      (a) =>
        a.organizationId === organizationId &&
        (a.environment === environment || (!a.environment && environment === EnvironmentType.LIVE)) &&
        a.type === 'EARNED' &&
        a.balance > 0,
    );

    const pendingBatch = eligibleAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
    const eligibleAffiliatesCount = eligibleAccounts.length;

    let totalSettled = 0;
    let inFlightProcessing = 0;
    let failedPayouts = 0;
    let failedCount = 0;
    let riskHeld = 0;
    let riskHeldCount = 0;
    let completedCount = 0;

    const statusMap: Record<string, { count: number; amount: number }> = {};
    const gatewayMap: Record<string, { count: number; amount: number }> = {};
    const partnerTotals: Record<string, { totalPaid: number; count: number; name: string }> = {};

    for (const item of allItems) {
      const amt = item.amount || 0;
      const st = (item.status || PayoutStatus.DRAFT).toUpperCase();

      if (!statusMap[st]) statusMap[st] = { count: 0, amount: 0 };
      statusMap[st].count++;
      statusMap[st].amount += amt;

      const gw = item.gateway || 'Direct Bank Transfer';
      if (!gatewayMap[gw]) gatewayMap[gw] = { count: 0, amount: 0 };
      gatewayMap[gw].count++;
      gatewayMap[gw].amount += amt;

      if (st === PayoutStatus.COMPLETED) {
        totalSettled += amt;
        completedCount++;

        const aff = dbStore.affiliates.find((a) => a.id === item.affiliateId);
        const name = aff?.displayName || aff?.companyName || 'Affiliate Partner';
        if (!partnerTotals[item.affiliateId]) {
          partnerTotals[item.affiliateId] = { totalPaid: 0, count: 0, name };
        }
        partnerTotals[item.affiliateId].totalPaid += amt;
        partnerTotals[item.affiliateId].count++;
      } else if (st === PayoutStatus.PROCESSING) {
        inFlightProcessing += amt;
      } else if (st === PayoutStatus.FAILED) {
        failedPayouts += amt;
        failedCount++;
      } else if (st === PayoutStatus.HELD) {
        riskHeld += amt;
        riskHeldCount++;
      }
    }

    const totalLiability = pendingBatch + inFlightProcessing + riskHeld;
    const totalVolume = totalSettled + inFlightProcessing + failedPayouts + riskHeld;
    const attemptedCount = completedCount + failedCount;
    const successRate = attemptedCount > 0 ? Number(((completedCount / attemptedCount) * 100).toFixed(1)) : 100;
    const averagePayout = completedCount > 0 ? Math.round(totalSettled / completedCount) : 0;

    // Time-series trajectory over the last 14 days
    const trajectoryMap: Record<string, { settled: number; processing: number; failed: number }> = {};
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      trajectoryMap[key] = { settled: 0, processing: 0, failed: 0 };
    }

    for (const item of allItems) {
      const itemDate = new Date(item.createdAt);
      const key = itemDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (trajectoryMap[key]) {
        const amt = item.amount || 0;
        if (item.status === PayoutStatus.COMPLETED) trajectoryMap[key].settled += amt;
        else if (item.status === PayoutStatus.PROCESSING) trajectoryMap[key].processing += amt;
        else if (item.status === PayoutStatus.FAILED) trajectoryMap[key].failed += amt;
      }
    }

    const trajectory = Object.entries(trajectoryMap).map(([date, values]) => ({
      date,
      settled: values.settled,
      processing: values.processing,
      failed: values.failed,
    }));

    const statusDistribution = Object.entries(statusMap).map(([status, val]) => ({
      status,
      count: val.count,
      amount: val.amount,
      percentage: totalVolume > 0 ? Number(((val.amount / totalVolume) * 100).toFixed(1)) : 0,
    }));

    const gatewayDistribution = Object.entries(gatewayMap).map(([gateway, val]) => ({
      gateway,
      count: val.count,
      amount: val.amount,
      percentage: totalVolume > 0 ? Number(((val.amount / totalVolume) * 100).toFixed(1)) : 0,
    }));

    const topPartners = Object.entries(partnerTotals)
      .map(([affiliateId, val]) => ({
        affiliateId,
        affiliateName: val.name,
        totalPaid: val.totalPaid,
        payoutCount: val.count,
      }))
      .sort((a, b) => b.totalPaid - a.totalPaid)
      .slice(0, 5);

    return {
      totalSettled,
      pendingBatch,
      inFlightProcessing,
      failedPayouts,
      failedCount,
      riskHeld,
      riskHeldCount,
      totalLiability,
      totalVolume,
      successRate,
      averagePayout,
      eligibleAffiliatesCount,
      trajectory,
      statusDistribution,
      gatewayDistribution,
      topPartners,
      currency,
    };
  }

  async validateBatch(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    dto: ValidateBatchDto,
  ) {
    this.ensureDefaultPayouts(organizationId);

    const org = dbStore.organizations.find((o) => o.id === organizationId);
    const currency = org?.defaultCurrency || PLATFORM_CURRENCY;

    const accounts = dbStore.ledgerAccounts.filter(
      (a) =>
        a.organizationId === organizationId &&
        (a.environment === environment || (!a.environment && environment === EnvironmentType.LIVE)) &&
        a.type === 'EARNED' &&
        a.balance > 0,
    );

    const eligiblePartners: Array<{
      affiliateId: string;
      affiliateName: string;
      email: string;
      amount: number;
      payoutMethod: string;
      maskedAccount: string;
      riskScore: number;
      status: 'READY' | 'BLOCKED' | 'WARNING';
      issues?: string[];
    }> = [];

    const warnings: string[] = [];
    const criticalErrors: string[] = [];

    let readyCount = 0;
    let readyAmount = 0;
    let blockedCount = 0;
    let blockedAmount = 0;
    let warningCount = 0;

    const minPayoutThreshold = 250000; // 2,500.00 in cents

    for (const acc of accounts) {
      if (!acc.affiliateId) continue;
      if (dto.affiliateIds && !dto.affiliateIds.includes(acc.affiliateId)) continue;

      const affiliate = dbStore.affiliates.find((a) => a.id === acc.affiliateId);
      if (!affiliate) continue;

      const issues: string[] = [];
      let partnerStatus: 'READY' | 'BLOCKED' | 'WARNING' = 'READY';

      // 1. Account status
      if (affiliate.status !== AffiliateStatus.ACTIVE) {
        issues.push(`Partner account status is ${affiliate.status} (disbursements blocked)`);
        partnerStatus = 'BLOCKED';
      }

      // 2. Payment details
      if (!affiliate.payoutMethod) {
        issues.push('Missing payout destination details (no bank or UPI linked)');
        partnerStatus = 'BLOCKED';
      }

      // 3. Minimum threshold
      if (acc.balance < minPayoutThreshold) {
        issues.push(`Balance (${(acc.balance / 100).toFixed(2)}) is below minimum payout threshold (${(minPayoutThreshold / 100).toFixed(2)})`);
        if (partnerStatus !== 'BLOCKED') partnerStatus = 'WARNING';
      }

      // 4. Trust score / risk
      if (affiliate.trustScore && affiliate.trustScore < 40) {
        issues.push(`Elevated risk score (Trust score: ${affiliate.trustScore}/100)`);
        if (partnerStatus !== 'BLOCKED') partnerStatus = 'WARNING';
      }

      if (partnerStatus === 'BLOCKED') {
        blockedCount++;
        blockedAmount += acc.balance;
      } else {
        readyCount++;
        readyAmount += acc.balance;
        if (partnerStatus === 'WARNING') warningCount++;
      }

      eligiblePartners.push({
        affiliateId: affiliate.id,
        affiliateName: affiliate.displayName || affiliate.companyName || 'Affiliate Partner',
        email: affiliate.email,
        amount: acc.balance,
        payoutMethod: affiliate.payoutMethod || 'Direct Bank Transfer',
        maskedAccount: affiliate.payoutMethod === 'UPI' ? '••••@upi' : '••••7812',
        riskScore: affiliate.trustScore || 85,
        status: partnerStatus,
        issues: issues.length > 0 ? issues : undefined,
      });
    }

    if (readyCount === 0 && accounts.length > 0) {
      criticalErrors.push('All eligible affiliate accounts currently fail pre-flight validation requirements.');
    }

    if (warningCount > 0) {
      warnings.push(`${warningCount} partners have advisory notices (below standard threshold or elevated risk).`);
    }

    return {
      readyCount,
      readyAmount,
      blockedCount,
      blockedAmount,
      warningCount,
      eligiblePartners,
      warnings,
      criticalErrors,
      currency,
    };
  }

  async getItemsPaginated(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query: ListPayoutsQueryDto,
  ) {
    this.ensureDefaultPayouts(organizationId);

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const search = (query.search || '').trim().toLowerCase();

    let items = dbStore.payoutItems.filter(
      (item) =>
        item.organizationId === organizationId &&
        (item.environment === environment || (!item.environment && environment === EnvironmentType.LIVE)),
    );

    if (query.status && query.status !== 'ALL') {
      items = items.filter((i) => i.status.toUpperCase() === query.status?.toUpperCase());
    }

    if (query.gateway && query.gateway !== 'ALL') {
      items = items.filter((i) => (i.gateway || '').toLowerCase().includes(query.gateway!.toLowerCase()));
    }

    if (query.affiliateId) {
      items = items.filter((i) => i.affiliateId === query.affiliateId);
    }

    if (query.batchId) {
      items = items.filter((i) => i.batchId === query.batchId);
    }

    if (query.startDate) {
      const start = new Date(query.startDate);
      items = items.filter((i) => new Date(i.createdAt) >= start);
    }

    if (query.endDate) {
      const end = new Date(query.endDate);
      items = items.filter((i) => new Date(i.createdAt) <= end);
    }

    let hydrated = items.map((i) => this.hydrateItem(i));

    if (search) {
      hydrated = hydrated.filter(
        (i) =>
          i.id.toLowerCase().includes(search) ||
          i.affiliateName.toLowerCase().includes(search) ||
          i.affiliateEmail.toLowerCase().includes(search) ||
          (i.providerReference && i.providerReference.toLowerCase().includes(search)) ||
          (i.gateway && i.gateway.toLowerCase().includes(search)),
      );
    }

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';

    hydrated.sort((a: any, b: any) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (valA instanceof Date) valA = valA.getTime();
      if (valB instanceof Date) valB = valB.getTime();
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    const total = hydrated.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginated = hydrated.slice((page - 1) * limit, page * limit);

    return {
      data: paginated,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async getBatchesPaginated(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query: ListPayoutsQueryDto,
  ) {
    this.ensureDefaultPayouts(organizationId);

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const search = (query.search || '').trim().toLowerCase();

    let batches = dbStore.payoutBatches.filter(
      (b) =>
        b.organizationId === organizationId &&
        (b.environment === environment || (!b.environment && environment === EnvironmentType.LIVE)),
    );

    if (query.status && query.status !== 'ALL') {
      batches = batches.filter((b) => b.status.toUpperCase() === query.status?.toUpperCase());
    }

    if (query.gateway && query.gateway !== 'ALL') {
      batches = batches.filter((b) => (b.gateway || '').toLowerCase().includes(query.gateway!.toLowerCase()));
    }

    let hydrated = batches.map((b) => this.hydrateBatch(b));

    if (search) {
      hydrated = hydrated.filter(
        (b) =>
          b.id.toLowerCase().includes(search) ||
          (b.gateway && b.gateway.toLowerCase().includes(search)) ||
          (b.createdByUserName && b.createdByUserName.toLowerCase().includes(search)),
      );
    }

    hydrated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = hydrated.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginated = hydrated.slice((page - 1) * limit, page * limit);

    return {
      data: paginated,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async getReconciliationData(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    this.ensureDefaultPayouts(organizationId);

    const org = dbStore.organizations.find((o) => o.id === organizationId);
    const currency = org?.defaultCurrency || PLATFORM_CURRENCY;

    const items = dbStore.payoutItems.filter(
      (item) =>
        item.organizationId === organizationId &&
        (item.environment === environment || (!item.environment && environment === EnvironmentType.LIVE)),
    );

    let totalInternalCents = 0;
    let totalProviderCents = 0;
    let matchedCount = 0;
    let unmatchedCount = 0;
    let discrepancyCount = 0;
    let pendingCount = 0;

    const records = items.map((item) => {
      const aff = dbStore.affiliates.find((a) => a.id === item.affiliateId);
      const affiliateName = aff?.displayName || aff?.companyName || 'Affiliate Partner';

      let status = (item.reconciliationStatus || 'MATCHED') as 'MATCHED' | 'UNMATCHED' | 'DISCREPANCY' | 'PENDING';
      let providerAmount = item.amount;

      if (item.status === PayoutStatus.FAILED) {
        status = 'DISCREPANCY';
        providerAmount = 0;
      } else if (item.status === PayoutStatus.PROCESSING || item.status === PayoutStatus.HELD) {
        status = 'PENDING';
        providerAmount = item.amount;
      }

      totalInternalCents += item.amount;
      totalProviderCents += providerAmount;

      if (status === 'MATCHED') matchedCount++;
      else if (status === 'DISCREPANCY') discrepancyCount++;
      else if (status === 'PENDING') pendingCount++;
      else unmatchedCount++;

      return {
        itemId: item.id,
        batchId: item.batchId,
        affiliateName,
        gateway: item.gateway || 'Direct Bank Transfer',
        providerReference: item.providerReference || 'Pending Ref',
        internalAmount: item.amount,
        providerAmount,
        difference: item.amount - providerAmount,
        status,
        reconciledAt: item.reconciledAt || item.createdAt,
        currency: item.currency || currency,
      };
    });

    const totalCount = records.length;
    const reconciliationRate = totalCount > 0 ? Number(((matchedCount / totalCount) * 100).toFixed(1)) : 100;

    return {
      totalInternalCents,
      totalProviderCents,
      matchedCount,
      unmatchedCount,
      discrepancyCount,
      pendingCount,
      reconciliationRate,
      records,
      currency,
    };
  }

  async retryFailedItem(
    organizationId: string,
    itemId: string,
    actorId: string,
    dto?: RetryPayoutItemDto,
  ) {
    const item = dbStore.payoutItems.find((i) => i.id === itemId && i.organizationId === organizationId);
    if (!item) {
      throw new NotFoundException('Payout item not found');
    }

    if (item.status !== PayoutStatus.FAILED && item.status !== PayoutStatus.HELD) {
      throw new BadRequestException(`Cannot retry item with status ${item.status}. Only FAILED or HELD items can be retried.`);
    }

    item.retryCount = (item.retryCount || 0) + 1;
    item.lastRetryAt = new Date();
    item.failureReason = undefined;

    // In simulated or test environment, re-executing completes immediately
    const isSimulated = item.environment === EnvironmentType.TEST || true;
    if (isSimulated) {
      item.status = PayoutStatus.COMPLETED;
      item.providerReference = `retry_${uuidv4().substring(0, 10)}`;
      item.reconciliationStatus = 'MATCHED';
      item.reconciledAt = new Date();

      await this.ledgerService.recordTransaction(
        organizationId,
        item.affiliateId,
        LedgerEntryType.PAYOUT_COMPLETED,
        `[RETRY EXECUTED] Payout item ${item.id} successfully disbursed (Ref: ${item.providerReference})`,
        item.id,
        item.amount,
        { skipBalanceMutation: true },
      );
    } else {
      item.status = PayoutStatus.PROCESSING;
      item.reconciliationStatus = 'PENDING';
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: AuditAction.PAYOUT_COMPLETED,
      resourceType: 'payout_item',
      resourceId: item.id,
      metadata: {
        reason: dto?.reason || 'Manual retry from settlement center',
        retryCount: item.retryCount,
        newStatus: item.status,
      },
      createdAt: new Date(),
    });

    return { success: true, item: this.hydrateItem(item) };
  }

  async cancelBatch(
    organizationId: string,
    batchId: string,
    actorId: string,
    dto?: CancelBatchDto,
  ) {
    const batch = dbStore.payoutBatches.find((b) => b.id === batchId && b.organizationId === organizationId);
    if (!batch) {
      throw new NotFoundException('Payout batch not found');
    }

    if (batch.status === PayoutStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed payout batch.');
    }

    batch.status = PayoutStatus.CANCELLED;
    batch.updatedAt = new Date();

    const items = dbStore.payoutItems.filter((i) => i.batchId === batchId);
    for (const item of items) {
      if (item.status !== PayoutStatus.COMPLETED) {
        item.status = PayoutStatus.CANCELLED;

        // Restore reserved balance to affiliate ledger account
        const acc = dbStore.ledgerAccounts.find(
          (a) => a.organizationId === organizationId && a.affiliateId === item.affiliateId && a.type === 'EARNED',
        );
        if (acc) {
          acc.balance += item.amount;
          acc.updatedAt = new Date();
        }
      }
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: AuditAction.PAYOUT_FAILED,
      resourceType: 'payout_batch',
      resourceId: batch.id,
      metadata: { reason: dto?.reason || 'Batch cancelled by administrator', cancelledAt: new Date() },
      createdAt: new Date(),
    });

    return { success: true, batch: this.hydrateBatch(batch) };
  }

  async createBatch(
    organizationId: string,
    createdByUserId: string,
    dto: CreatePayoutBatchDto,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    const batchId = uuidv4();
    let totalAmount = 0;
    const items: PayoutItemEntity[] = [];

    // Resolve disbursement gateway (Razorpay / Cashfree / Direct)
    let selectedGateway = (dto.gateway || '').toUpperCase();
    if (!selectedGateway) {
      const rzpIntegration = dbStore.integrations.find((i) => i.provider === 'RAZORPAY');
      const hasRazorpay = rzpIntegration && dbStore.organizationIntegrations.some(
        (c) => c.organizationId === organizationId && c.integrationId === rzpIntegration.id && c.status === OrganizationIntegrationStatus.CONNECTED,
      );
      const cfIntegration = dbStore.integrations.find((i) => i.provider === 'CASHFREE');
      const hasCashfree = cfIntegration && dbStore.organizationIntegrations.some(
        (c) => c.organizationId === organizationId && c.integrationId === cfIntegration.id && c.status === OrganizationIntegrationStatus.CONNECTED,
      );

      if (hasRazorpay) selectedGateway = 'RAZORPAY';
      else if (hasCashfree) selectedGateway = 'CASHFREE';
      else selectedGateway = 'DIRECT';
    }

    const gatewayDisplay = selectedGateway === 'RAZORPAY'
      ? 'RazorpayX'
      : selectedGateway === 'CASHFREE'
        ? 'Cashfree Payouts'
        : 'Direct Bank Transfer';

    const accounts = dbStore.ledgerAccounts.filter(
      (a) =>
        a.organizationId === organizationId &&
        (a.environment === environment || (!a.environment && environment === EnvironmentType.LIVE)) &&
        a.type === 'EARNED' &&
        a.balance > 0,
    );

    const activeAffiliateIds = new Set(
      dbStore.affiliates.filter((a) => a.status === AffiliateStatus.ACTIVE).map((a) => a.id),
    );

    const eligibleAccounts = (dto.affiliateIds
      ? accounts.filter((a) => a.affiliateId && dto.affiliateIds?.includes(a.affiliateId))
      : accounts
    ).filter((a) => a.affiliateId && activeAffiliateIds.has(a.affiliateId));

    if (eligibleAccounts.length === 0) {
      throw new BadRequestException(`No eligible affiliate balances available for payout in ${environment} mode.`);
    }

    for (const acc of eligibleAccounts) {
      const amount = acc.balance;
      totalAmount += amount;

      // Reserve balance immediately to prevent double-spending
      acc.balance = 0;
      acc.updatedAt = new Date();

      const affiliate = dbStore.affiliates.find((a) => a.id === acc.affiliateId);

      const item: PayoutItemEntity = {
        id: uuidv4(),
        batchId,
        organizationId,
        environment,
        affiliateId: acc.affiliateId!,
        amount,
        currency: acc.currency,
        status: PayoutStatus.DRAFT,
        gateway: gatewayDisplay,
        beneficiaryName: affiliate?.displayName,
        payoutMethod: affiliate?.payoutMethod || 'BANK_ACCOUNT',
        disbursementAccount: affiliate?.payoutMethod === 'UPI' ? '••••@upi' : '••••7812 (Direct Bank)',
        createdAt: new Date(),
      };
      items.push(item);
      dbStore.payoutItems.push(item);
    }

    const batch: PayoutBatchEntity = {
      id: batchId,
      organizationId,
      environment,
      status: PayoutStatus.DRAFT,
      totalAmount,
      currency: PLATFORM_CURRENCY,
      gateway: gatewayDisplay,
      createdBy: createdByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.payoutBatches.push(batch);

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: createdByUserId,
      action: AuditAction.PAYOUT_CREATED,
      resourceType: 'payout_batch',
      resourceId: batch.id,
      metadata: { environment, totalAmount, gateway: gatewayDisplay },
      createdAt: new Date(),
    });

    for (const item of items) {
      this.emitWebhook(organizationId, WebhookEvent.PAYOUT_CREATED, {
        payoutId: item.id,
        affiliateId: item.affiliateId,
        amount: item.amount,
        currency: item.currency,
        status: item.status,
        gateway: item.gateway,
      });
    }

    return { batch: this.hydrateBatch(batch), items: items.map((i) => this.hydrateItem(i)) };
  }

  async processBatch(
    organizationId: string,
    batchId: string,
    actorId: string,
    environment?: EnvironmentType,
    dto?: ProcessPayoutBatchDto,
  ) {
    const batch = dbStore.payoutBatches.find(
      (b) =>
        b.id === batchId &&
        b.organizationId === organizationId &&
        (!environment || b.environment === environment || (!b.environment && environment === EnvironmentType.LIVE)),
    );

    if (!batch) {
      throw new NotFoundException('Payout batch not found in current environment');
    }

    if (batch.status !== PayoutStatus.DRAFT) {
      const holdNote = batch.status === PayoutStatus.HELD
        ? ' It is on hold pending fraud review; resolve the fraud review to release it back to DRAFT before processing.'
        : ' Batches may only be processed once from DRAFT.';
      throw new BadRequestException(
        `Payout batch cannot be processed: current status is ${batch.status}.${holdNote}`,
      );
    }
    batch.status = PayoutStatus.PROCESSING;
    batch.updatedAt = new Date();

    let fraudResult;
    try {
      fraudResult = await this.fraudService.evaluatePayout(batch);
    } catch (error: any) {
      batch.status = PayoutStatus.DRAFT;
      batch.updatedAt = new Date();
      this.logger.error(`Fraud evaluation failed for payout batch ${batchId}; batch reverted to DRAFT. ${error?.message || error}`);
      throw new BadRequestException('PAYOUT_FRAUD_CHECK_FAILED');
    }

    if (fraudResult.decision === FraudDecision.HOLD || fraudResult.decision === FraudDecision.REVIEW) {
      batch.status = PayoutStatus.HELD;
      batch.updatedAt = new Date();
      throw new BadRequestException('PAYOUT_HELD_FOR_RISK');
    }

    batch.status = PayoutStatus.COMPLETED;
    batch.updatedAt = new Date();

    const isSimulated = batch.environment === EnvironmentType.TEST;
    const items = dbStore.payoutItems.filter((i) => i.batchId === batchId);

    const rzpIntegration = dbStore.integrations.find((i) => i.provider === 'RAZORPAY');
    const rzpConn = rzpIntegration
      ? dbStore.organizationIntegrations.find((c) => c.organizationId === organizationId && c.integrationId === rzpIntegration.id && c.status === OrganizationIntegrationStatus.CONNECTED)
      : null;

    const cfIntegration = dbStore.integrations.find((i) => i.provider === 'CASHFREE');
    const cfConn = cfIntegration
      ? dbStore.organizationIntegrations.find((c) => c.organizationId === organizationId && c.integrationId === cfIntegration.id && c.status === OrganizationIntegrationStatus.CONNECTED)
      : null;

    const targetGateway = (dto?.gateway || batch.gateway || (rzpConn ? 'RAZORPAY' : cfConn ? 'CASHFREE' : 'DIRECT')).toUpperCase();

    let resolvedGateway = 'Direct Bank Transfer';
    let disbursementAccount: string | undefined;

    if (targetGateway.includes('RAZORPAY')) {
      resolvedGateway = 'RazorpayX';
      disbursementAccount = rzpConn?.config?.maskedCredentials?.accountNumber || (isSimulated ? '••••5678 (RazorpayX)' : undefined);
    } else if (targetGateway.includes('CASHFREE')) {
      resolvedGateway = 'Cashfree Payouts';
      disbursementAccount = cfConn?.config?.maskedCredentials?.payoutClientId || (isSimulated ? '••••CF01 (Cashfree)' : undefined);
    } else {
      resolvedGateway = isSimulated ? 'Simulated Disburser' : 'Direct Bank Transfer';
    }

    batch.gateway = resolvedGateway;

    for (const item of items) {
      this.notifyAffiliatePayout(
        SystemTemplateKey.AFFILIATE_PAYOUT_PROCESSING,
        organizationId,
        item.affiliateId,
        item.amount,
        item.currency,
      ).catch(() => undefined);

      item.status = PayoutStatus.COMPLETED;
      item.gateway = resolvedGateway;
      item.disbursementAccount = disbursementAccount || item.disbursementAccount;
      item.reconciliationStatus = 'MATCHED';
      item.reconciledAt = new Date();

      if (resolvedGateway === 'RazorpayX') {
        item.providerReference = isSimulated
          ? `rzp_test_pout_${uuidv4().replace(/-/g, '').substring(0, 10)}`
          : `rzp_pout_${uuidv4().replace(/-/g, '').substring(0, 14)}`;
      } else if (resolvedGateway === 'Cashfree Payouts') {
        item.providerReference = isSimulated
          ? `cf_test_pout_${uuidv4().replace(/-/g, '').substring(0, 10)}`
          : `cf_pout_${uuidv4().replace(/-/g, '').substring(0, 14)}`;
      } else {
        item.providerReference = isSimulated
          ? `sim_test_${uuidv4().substring(0, 8)}`
          : `payout_${uuidv4().substring(0, 10)}`;
      }

      await this.ledgerService.recordTransaction(
        organizationId,
        item.affiliateId,
        LedgerEntryType.PAYOUT_COMPLETED,
        isSimulated
          ? `[SIMULATED ${resolvedGateway}] Payout batch ${batchId} executed (Ref: ${item.providerReference})`
          : `[${resolvedGateway}] Payout batch ${batchId} executed (Ref: ${item.providerReference})`,
        item.id,
        item.amount,
        { skipBalanceMutation: true },
      );

      this.emitWebhook(organizationId, WebhookEvent.PAYOUT_COMPLETED, {
        payoutId: item.id,
        affiliateId: item.affiliateId,
        status: item.status,
        gateway: item.gateway,
        providerReference: item.providerReference,
        disbursementAccount: item.disbursementAccount,
      });

      this.notifyAffiliatePayout(
        SystemTemplateKey.AFFILIATE_PAYOUT_COMPLETED,
        organizationId,
        item.affiliateId,
        item.amount,
        item.currency,
        {
          reference: item.providerReference || batchId,
          paymentMethod: resolvedGateway,
        },
      ).catch(() => undefined);
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: AuditAction.PAYOUT_COMPLETED,
      resourceType: 'payout_batch',
      resourceId: batch.id,
      metadata: {
        environment: batch.environment,
        simulated: isSimulated,
        totalAmount: batch.totalAmount,
        gateway: resolvedGateway,
      },
      createdAt: new Date(),
    });

    return { success: true, batch: this.hydrateBatch(batch), isSimulated };
  }

  async findAll(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    this.ensureDefaultPayouts(organizationId);
    return dbStore.payoutBatches
      .filter(
        (b) =>
          b.organizationId === organizationId &&
          (b.environment === environment || (!b.environment && environment === EnvironmentType.LIVE)),
      )
      .map((b) => this.hydrateBatch(b));
  }

  async findOne(organizationId: string, batchId: string, environment?: EnvironmentType) {
    this.ensureDefaultPayouts(organizationId);
    const batch = dbStore.payoutBatches.find(
      (b) =>
        b.id === batchId &&
        b.organizationId === organizationId &&
        (!environment || b.environment === environment || (!b.environment && environment === EnvironmentType.LIVE)),
    );
    if (!batch) {
      throw new NotFoundException('Payout batch not found');
    }
    const items = dbStore.payoutItems
      .filter((i) => i.batchId === batchId)
      .map((i) => this.hydrateItem(i));

    return { batch: this.hydrateBatch(batch), items };
  }

  async generateCsvExport(organizationId: string, batchId?: string): Promise<string> {
    this.ensureDefaultPayouts(organizationId);
    let items = dbStore.payoutItems.filter((i) => i.organizationId === organizationId);
    if (batchId && batchId !== 'all') {
      items = items.filter((i) => i.batchId === batchId);
    }

    const sanitizeField = (value: string | undefined | null): string => {
      if (!value) return '';
      let str = String(value);
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str.replace(/"/g, '""')}"`;
    };

    let csv = 'item_id,batch_id,affiliate_id,email,company_name,amount,currency,gateway,provider_reference,disbursement_account,status,reconciliation_status,created_at\n';

    for (const item of items) {
      const affiliate = dbStore.affiliates.find((a) => a.id === item.affiliateId);
      const amountDollars = (item.amount / 100).toFixed(2);
      const safeEmail = sanitizeField(affiliate?.email);
      const safeCompany = sanitizeField(affiliate?.companyName || affiliate?.displayName);
      const safeGateway = sanitizeField(item.gateway || 'Direct Bank Transfer');
      const safeRef = sanitizeField(item.providerReference || '');
      const safeAccount = sanitizeField(item.disbursementAccount || '');
      const safeStatus = sanitizeField(item.status);
      const safeRecon = sanitizeField(item.reconciliationStatus || 'MATCHED');
      const safeDate = sanitizeField(new Date(item.createdAt).toISOString());
      csv += `${item.id},${item.batchId},${item.affiliateId},${safeEmail},${safeCompany},${amountDollars},${item.currency},${safeGateway},${safeRef},${safeAccount},${safeStatus},${safeRecon},${safeDate}\n`;
    }

    return csv;
  }

  async getBatches(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    this.ensureDefaultPayouts(organizationId);
    return dbStore.payoutBatches
      .filter(
        (b) =>
          b.organizationId === organizationId &&
          (b.environment === environment || (!b.environment && environment === EnvironmentType.LIVE)),
      )
      .map((b) => this.hydrateBatch(b));
  }

  async getItems(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    this.ensureDefaultPayouts(organizationId);
    const items = dbStore.payoutItems.filter(
      (item) =>
        item.organizationId === organizationId &&
        (item.environment === environment || (!item.environment && environment === EnvironmentType.LIVE)),
    );
    return items.map((item) => this.hydrateItem(item));
  }
}
