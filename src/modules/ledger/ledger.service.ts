import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, LedgerAccountEntity, LedgerTransactionEntity, LedgerEntryEntity } from '../../database/store';
import { LedgerEntryType } from '../../common/enums';

@Injectable()
export class LedgerService {
  async getAccount(organizationId: string, affiliateId: string, type: 'EARNED' | 'PENDING' | 'PAYOUT' = 'EARNED') {
    let account = dbStore.ledgerAccounts.find(
      (a) => a.organizationId === organizationId && a.affiliateId === affiliateId && a.type === type,
    );

    if (!account) {
      account = {
        id: uuidv4(),
        organizationId,
        affiliateId,
        type,
        balance: 0,
        currency: 'USD',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.ledgerAccounts.push(account);
    }

    return account;
  }

  async recordTransaction(
    organizationId: string,
    affiliateId: string,
    type: LedgerEntryType,
    description: string,
    referenceId: string,
    amount: number, // positive amount in cents
  ) {
    const account = await this.getAccount(organizationId, affiliateId, 'EARNED');

    const transaction: LedgerTransactionEntity = {
      id: uuidv4(),
      organizationId,
      type,
      description,
      referenceId,
      createdAt: new Date(),
    };
    dbStore.ledgerTransactions.push(transaction);

    // Double-entry record
    const isCredit = [LedgerEntryType.COMMISSION_EARNED, LedgerEntryType.COMMISSION_APPROVED].includes(type);

    const entry: LedgerEntryEntity = {
      id: uuidv4(),
      transactionId: transaction.id,
      accountId: account.id,
      type: isCredit ? 'CREDIT' : 'DEBIT',
      amount,
      createdAt: new Date(),
    };
    dbStore.ledgerEntries.push(entry);

    // Update account balance
    if (isCredit) {
      account.balance += amount;
    } else {
      account.balance -= amount;
    }
    account.updatedAt = new Date();

    return { transaction, entry, updatedBalance: account.balance };
  }

  async getTransactions(organizationId: string, affiliateId?: string) {
    let accounts = dbStore.ledgerAccounts.filter((a) => a.organizationId === organizationId);
    if (affiliateId) accounts = accounts.filter((a) => a.affiliateId === affiliateId);

    const accountIds = accounts.map((a) => a.id);
    const entries = dbStore.ledgerEntries.filter((e) => accountIds.includes(e.accountId));
    const transactionIds = entries.map((e) => e.transactionId);

    return dbStore.ledgerTransactions.filter((t) => transactionIds.includes(t.id));
  }
}
