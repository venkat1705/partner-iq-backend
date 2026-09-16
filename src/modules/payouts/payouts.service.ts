import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, PayoutBatchEntity, PayoutItemEntity } from '../../database/store';
import { PayoutStatus, LedgerEntryType, AuditAction, FraudDecision, EnvironmentType, WebhookEvent, OrganizationIntegrationStatus, AffiliateStatus } from '../../common/enums';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { LedgerService } from '../ledger/ledger.service';
import { FraudService } from '../fraud/fraud.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CreatePayoutBatchDto, ProcessPayoutBatchDto } from './dto/payout.dto';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import { SystemEmailDispatchService } from '../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import { getAppConfig } from '../../config/app.config';
import { NotificationsService } from '../notifications/notifications.service';

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
        // Flat fields — required by the seeded payout-completed/payout-failed
        // email-design templates, which use their own variable names rather
        // than the generic dot-path fallback body.
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
        : 'Direct Transfer';

    // Find all affiliates with positive earned balances in this environment
    const accounts = dbStore.ledgerAccounts.filter(
      (a) =>
        a.organizationId === organizationId &&
        (a.environment === environment || (!a.environment && environment === EnvironmentType.LIVE)) &&
        a.type === 'EARNED' &&
        a.balance > 0,
    );

    // Never disburse to a suspended/deactivated affiliate — their earned balance stays
    // frozen until reinstated instead of continuing to pay out automatically.
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

      // Reserve the balance immediately (synchronously, before any await below) so a
      // concurrent batch-creation request cannot read the same unreserved balance and
      // double-claim these funds in a second draft batch.
      acc.balance = 0;
      acc.updatedAt = new Date();

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

    // Fraud is evaluated once, at the point money actually moves (processBatch below), not
    // here at draft creation. Evaluating it twice produced duplicate assessments/review rows
    // and duplicate analyst notifications for what is really one payout event; it also meant
    // a batch flagged here could be marked PROCESSING with no code path that ever released
    // it (see processBatch for the single, correct HOLD/release lifecycle).

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

    return { batch, items };
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

    // Atomically claim the batch before any async work to prevent concurrent/duplicate
    // processing (double-disbursement race condition). Batches start as DRAFT (see
    // createBatch) and may only be processed once from that state.
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
      // Fail closed: an unexpected fraud-engine error must not silently let a payout
      // through, but it also must not leave the batch stuck in PROCESSING forever with no
      // way out — return it to DRAFT so it can be retried once the issue is resolved.
      batch.status = PayoutStatus.DRAFT;
      batch.updatedAt = new Date();
      this.logger.error(`Fraud evaluation failed for payout batch ${batchId}; batch reverted to DRAFT. ${error?.message || error}`);
      throw new BadRequestException('PAYOUT_FRAUD_CHECK_FAILED');
    }

    if (fraudResult.decision === FraudDecision.HOLD || fraudResult.decision === FraudDecision.REVIEW) {
      // HELD (not PROCESSING) so the batch has a real way out: an analyst resolving the
      // fraud review this assessment created returns it to DRAFT (approve) or cancels it and
      // restores the reserved balance (reject) — see FraudService.resolveReview.
      batch.status = PayoutStatus.HELD;
      batch.updatedAt = new Date();
      throw new BadRequestException('PAYOUT_HELD_FOR_RISK');
    }

    batch.status = PayoutStatus.COMPLETED;
    batch.updatedAt = new Date();

    const isSimulated = batch.environment === EnvironmentType.TEST;
    const items = dbStore.payoutItems.filter((i) => i.batchId === batchId);

    // Look up connected disbursement integration configs for account numbers / references
    const rzpIntegration = dbStore.integrations.find((i) => i.provider === 'RAZORPAY');
    const rzpConn = rzpIntegration
      ? dbStore.organizationIntegrations.find((c) => c.organizationId === organizationId && c.integrationId === rzpIntegration.id && c.status === OrganizationIntegrationStatus.CONNECTED)
      : null;

    const cfIntegration = dbStore.integrations.find((i) => i.provider === 'CASHFREE');
    const cfConn = cfIntegration
      ? dbStore.organizationIntegrations.find((c) => c.organizationId === organizationId && c.integrationId === cfIntegration.id && c.status === OrganizationIntegrationStatus.CONNECTED)
      : null;

    const targetGateway = (dto?.gateway || batch.gateway || (rzpConn ? 'RAZORPAY' : cfConn ? 'CASHFREE' : 'DIRECT')).toUpperCase();

    let resolvedGateway = 'Direct Transfer';
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
      item.disbursementAccount = disbursementAccount;

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

      // Post payout ledger transaction. Balance was already reserved/deducted when the
      // draft batch was created, so this entry records the completed payout without
      // deducting the balance a second time.
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

    return { success: true, batch, isSimulated };
  }

  async findAll(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    return dbStore.payoutBatches.filter(
      (b) =>
        b.organizationId === organizationId &&
        (b.environment === environment || (!b.environment && environment === EnvironmentType.LIVE)),
    );
  }

  async findOne(organizationId: string, batchId: string, environment?: EnvironmentType) {
    const batch = dbStore.payoutBatches.find(
      (b) =>
        b.id === batchId &&
        b.organizationId === organizationId &&
        (!environment || b.environment === environment || (!b.environment && environment === EnvironmentType.LIVE)),
    );
    if (!batch) {
      throw new NotFoundException('Payout batch not found');
    }
    const items = dbStore.payoutItems.filter((i) => i.batchId === batchId);
    return { batch, items };
  }

  async generateCsvExport(organizationId: string, batchId: string): Promise<string> {
    const items = dbStore.payoutItems.filter(
      (i) => i.batchId === batchId && i.organizationId === organizationId,
    );

    const sanitizeField = (value: string | undefined | null): string => {
      if (!value) return '';
      let str = String(value);
      // Neutralize formula injection triggers (=, +, -, @, tab, carriage return)
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str.replace(/"/g, '""')}"`;
    };

    let csv = 'item_id,affiliate_id,email,company_name,amount_dollars,currency,gateway,provider_reference,disbursement_account,status\n';

    for (const item of items) {
      const affiliate = dbStore.affiliates.find((a) => a.id === item.affiliateId);
      const amountDollars = (item.amount / 100).toFixed(2);
      const safeEmail = sanitizeField(affiliate?.email);
      const safeCompany = sanitizeField(affiliate?.companyName);
      const safeGateway = sanitizeField(item.gateway || 'Direct Bank Transfer');
      const safeRef = sanitizeField(item.providerReference || '');
      const safeAccount = sanitizeField(item.disbursementAccount || '');
      csv += `${item.id},${item.affiliateId},${safeEmail},${safeCompany},${amountDollars},${item.currency},${safeGateway},${safeRef},${safeAccount},${item.status}\n`;
    }

    return csv;
  }

  async getBatches(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    return dbStore.payoutBatches.filter(
      (b) =>
        b.organizationId === organizationId &&
        (b.environment === environment || (!b.environment && environment === EnvironmentType.LIVE)),
    );
  }

  async getItems(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    const items = dbStore.payoutItems.filter(
      (item) =>
        item.organizationId === organizationId &&
        (item.environment === environment || (!item.environment && environment === EnvironmentType.LIVE)),
    );
    return items.map((item) => {
      const affiliate = dbStore.affiliates.find((a) => a.id === item.affiliateId);
      return {
        ...item,
        affiliateName: affiliate?.displayName || affiliate?.companyName || 'Affiliate Partner',
        gateway: item.gateway || 'Direct Bank Transfer',
      };
    });
  }
}
