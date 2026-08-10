import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, PayoutBatchEntity, PayoutItemEntity } from '../../database/store';
import { PayoutStatus, LedgerEntryType, AuditAction, FraudDecision } from '../../common/enums';
import { LedgerService } from '../ledger/ledger.service';
import { FraudService } from '../fraud/fraud.service';
import { CreatePayoutBatchDto } from './dto/payout.dto';

@Injectable()
export class PayoutsService {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly fraudService: FraudService,
  ) {}

  async createBatch(organizationId: string, createdByUserId: string, dto: CreatePayoutBatchDto) {
    const batchId = uuidv4();
    let totalAmount = 0;
    const items: PayoutItemEntity[] = [];

    // Find all affiliates with positive earned balances
    const accounts = dbStore.ledgerAccounts.filter(
      (a) => a.organizationId === organizationId && a.type === 'EARNED' && a.balance > 0,
    );

    const eligibleAccounts = dto.affiliateIds
      ? accounts.filter((a) => a.affiliateId && dto.affiliateIds?.includes(a.affiliateId))
      : accounts;

    if (eligibleAccounts.length === 0) {
      throw new BadRequestException('No eligible affiliate balances available for payout');
    }

    for (const acc of eligibleAccounts) {
      const amount = acc.balance;
      totalAmount += amount;

      const item: PayoutItemEntity = {
        id: uuidv4(),
        batchId,
        organizationId,
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
      createdAt: new Date(),
    });

    return { batch, items };
  }

  async processBatch(organizationId: string, batchId: string, actorId: string) {
    const batch = dbStore.payoutBatches.find(
      (b) => b.id === batchId && b.organizationId === organizationId,
    );

    if (!batch) {
      throw new NotFoundException('Payout batch not found');
    }

    const fraudResult = await this.fraudService.evaluatePayout(batch);
    if (fraudResult.decision === FraudDecision.HOLD || fraudResult.decision === FraudDecision.REVIEW) {
      batch.status = PayoutStatus.PROCESSING;
      batch.updatedAt = new Date();
      throw new BadRequestException('PAYOUT_HELD_FOR_RISK');
    }

    batch.status = PayoutStatus.COMPLETED;
    batch.updatedAt = new Date();

    const items = dbStore.payoutItems.filter((i) => i.batchId === batchId);
    for (const item of items) {
      item.status = PayoutStatus.COMPLETED;

      // Post payout ledger transaction
      await this.ledgerService.recordTransaction(
        organizationId,
        item.affiliateId,
        LedgerEntryType.PAYOUT_COMPLETED,
        `Payout batch ${batchId} executed`,
        item.id,
        item.amount,
      );
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: AuditAction.PAYOUT_APPROVED,
      resourceType: 'payout_batch',
      resourceId: batch.id,
      metadata: {
        itemCount: items.length,
        totalAmount: batch.totalAmount,
        currency: batch.currency,
      },
      createdAt: new Date(),
    });

    return { batch, items };
  }

  async generateCsvExport(organizationId: string, batchId: string): Promise<string> {
    const items = dbStore.payoutItems.filter(
      (i) => i.batchId === batchId && i.organizationId === organizationId,
    );

    let csv = 'item_id,affiliate_id,email,company_name,amount_dollars,currency,status\n';

    for (const item of items) {
      const affiliate = dbStore.affiliates.find((a) => a.id === item.affiliateId);
      const amountDollars = (item.amount / 100).toFixed(2);
      csv += `${item.id},${item.affiliateId},"${affiliate?.email || ''}","${affiliate?.companyName || ''}",${amountDollars},${item.currency},${item.status}\n`;
    }

    return csv;
  }

  async getBatches(organizationId: string) {
    return dbStore.payoutBatches.filter((b) => b.organizationId === organizationId);
  }
}
