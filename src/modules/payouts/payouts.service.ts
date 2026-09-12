import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, PayoutBatchEntity, PayoutItemEntity } from '../../database/store';
import { PayoutStatus, LedgerEntryType, AuditAction, FraudDecision, EnvironmentType } from '../../common/enums';
import { LedgerService } from '../ledger/ledger.service';
import { FraudService } from '../fraud/fraud.service';
import { CreatePayoutBatchDto } from './dto/payout.dto';
import { EnvironmentUtils } from '../../common/utils/environment.utils';

@Injectable()
export class PayoutsService {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly fraudService: FraudService,
  ) { }

  async createBatch(
    organizationId: string,
    createdByUserId: string,
    dto: CreatePayoutBatchDto,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    const batchId = uuidv4();
    let totalAmount = 0;
    const items: PayoutItemEntity[] = [];

    // Find all affiliates with positive earned balances in this environment
    const accounts = dbStore.ledgerAccounts.filter(
      (a) =>
        a.organizationId === organizationId &&
        (a.environment === environment || (!a.environment && environment === EnvironmentType.LIVE)) &&
        a.type === 'EARNED' &&
        a.balance > 0,
    );

    const eligibleAccounts = dto.affiliateIds
      ? accounts.filter((a) => a.affiliateId && dto.affiliateIds?.includes(a.affiliateId))
      : accounts;

    if (eligibleAccounts.length === 0) {
      throw new BadRequestException(`No eligible affiliate balances available for payout in ${environment} mode.`);
    }

    for (const acc of eligibleAccounts) {
      const amount = acc.balance;
      totalAmount += amount;

      const item: PayoutItemEntity = {
        id: uuidv4(),
        batchId,
        organizationId,
        environment,
        affiliateId: acc.affiliateId!,
        amount,
        currency: acc.currency,
        status: PayoutStatus.DRAFT,
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
      currency: 'USD',
      createdBy: createdByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.payoutBatches.push(batch);

    const fraudResult = await this.fraudService.evaluatePayout(batch);
    if (fraudResult.decision === FraudDecision.HOLD || fraudResult.decision === FraudDecision.REVIEW) {
      batch.status = PayoutStatus.PROCESSING;
      batch.updatedAt = new Date();
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: createdByUserId,
      action: AuditAction.PAYOUT_CREATED,
      resourceType: 'payout_batch',
      resourceId: batch.id,
      metadata: { environment, totalAmount },
      createdAt: new Date(),
    });

    return { batch, items };
  }

  async processBatch(
    organizationId: string,
    batchId: string,
    actorId: string,
    environment?: EnvironmentType,
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

    const fraudResult = await this.fraudService.evaluatePayout(batch);
    if (fraudResult.decision === FraudDecision.HOLD || fraudResult.decision === FraudDecision.REVIEW) {
      batch.status = PayoutStatus.PROCESSING;
      batch.updatedAt = new Date();
      throw new BadRequestException('PAYOUT_HELD_FOR_RISK');
    }

    batch.status = PayoutStatus.COMPLETED;
    batch.updatedAt = new Date();

    const isSimulated = batch.environment === EnvironmentType.TEST;
    const items = dbStore.payoutItems.filter((i) => i.batchId === batchId);

    for (const item of items) {
      item.status = PayoutStatus.COMPLETED;
      if (isSimulated) {
        item.providerReference = `sim_test_${uuidv4().substring(0, 8)}`;
      }

      // Post payout ledger transaction
      await this.ledgerService.recordTransaction(
        organizationId,
        item.affiliateId,
        LedgerEntryType.PAYOUT_COMPLETED,
        isSimulated
          ? `[SIMULATED TEST] Payout batch ${batchId} executed`
          : `Payout batch ${batchId} executed`,
        item.id,
        item.amount,
      );
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

    let csv = 'item_id,affiliate_id,email,company_name,amount_dollars,currency,status\n';

    for (const item of items) {
      const affiliate = dbStore.affiliates.find((a) => a.id === item.affiliateId);
      const amountDollars = (item.amount / 100).toFixed(2);
      const safeEmail = sanitizeField(affiliate?.email);
      const safeCompany = sanitizeField(affiliate?.companyName);
      csv += `${item.id},${item.affiliateId},${safeEmail},${safeCompany},${amountDollars},${item.currency},${item.status}\n`;
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
      };
    });
  }
}
