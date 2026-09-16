import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, BillingAccountEntity, OrganizationEntity } from '../../../database/store';
import { AppDataSource } from '../../../database/data-source';
import { BillingAccount, Organization } from '../../../database/schema';
import { PLATFORM_CURRENCY } from '../../../common/constants/currency';

/**
 * Resolves the *customer account* that owns a user or an organization.
 *
 * PartnerIQ originally billed per organization. This service introduces the
 * account layer without a destructive migration: `organizations.accountId` is
 * nullable, and any organization that predates accounts is attached lazily to
 * an account derived from its `createdBy` user the first time it is resolved.
 * One user owns exactly one account, so every organization a person creates
 * lands on the same subscription.
 */
@Injectable()
export class BillingAccountService {
  private readonly logger = new Logger(BillingAccountService.name);

  /** Returns the account owned by `userId`, creating it if this is their first. */
  async resolveForUser(userId: string, nameHint?: string): Promise<BillingAccountEntity> {
    const existing = dbStore.billingAccounts.find(
      (item) => item.ownerUserId === userId && !item.deletedAt,
    );
    if (existing) return existing;

    // The in-memory store is a snapshot; a concurrent instance may already have
    // written this account, so check the database before creating a duplicate.
    if (AppDataSource.isInitialized) {
      try {
        const fromDb = await AppDataSource.getRepository(BillingAccount).findOne({
          where: { ownerUserId: userId },
        });
        if (fromDb && !fromDb.deletedAt) {
          if (!dbStore.billingAccounts.some((item) => item.id === fromDb.id)) {
            dbStore.billingAccounts.push(fromDb);
          }
          return fromDb;
        }
      } catch (error) {
        this.logger.warn(`Account lookup failed for user ${userId}: ${(error as Error).message}`);
      }
    }

    const user = dbStore.users.find((item) => item.id === userId);
    const account: BillingAccountEntity = {
      id: uuidv4(),
      name:
        nameHint ||
        [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
        user?.email ||
        'PartnerIQ Account',
      ownerUserId: userId,
      currency: PLATFORM_CURRENCY,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as BillingAccountEntity;

    dbStore.billingAccounts.push(account);
    return account;
  }

  /**
   * Returns the account an organization belongs to, backfilling `accountId`
   * from the organization's creator when it has never been set.
   */
  async resolveForOrganization(organizationId: string): Promise<BillingAccountEntity> {
    const org = await this.loadOrganization(organizationId);
    if (!org) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found.',
      });
    }

    if (org.accountId) {
      const account = dbStore.billingAccounts.find((item) => item.id === org.accountId);
      if (account) return account;
      if (AppDataSource.isInitialized) {
        const fromDb = await AppDataSource.getRepository(BillingAccount).findOne({
          where: { id: org.accountId },
        });
        if (fromDb) {
          if (!dbStore.billingAccounts.some((item) => item.id === fromDb.id)) {
            dbStore.billingAccounts.push(fromDb);
          }
          return fromDb;
        }
      }
      // accountId points at a row that no longer exists — fall through and re-link.
    }

    const account = await this.resolveForUser(org.createdBy, org.name);
    await this.attachOrganization(org, account.id);
    return account;
  }

  /** Links an organization to an account, persisting through the store. */
  async attachOrganization(org: OrganizationEntity, accountId: string) {
    if (org.accountId === accountId) return;
    org.accountId = accountId;
    org.updatedAt = new Date();
    if (AppDataSource.isInitialized) {
      try {
        await AppDataSource.getRepository(Organization).update({ id: org.id }, { accountId });
      } catch (error) {
        this.logger.warn(`Failed to persist accountId for org ${org.id}: ${(error as Error).message}`);
      }
    }
  }

  /** Every non-deleted organization on an account. */
  async listOrganizations(accountId: string): Promise<OrganizationEntity[]> {
    await this.backfillAccount(accountId);
    return dbStore.organizations.filter((item) => item.accountId === accountId && !item.deletedAt);
  }

  async listOrganizationIds(accountId: string): Promise<string[]> {
    return (await this.listOrganizations(accountId)).map((item) => item.id);
  }

  getById(accountId: string): BillingAccountEntity | undefined {
    return dbStore.billingAccounts.find((item) => item.id === accountId && !item.deletedAt);
  }

  /**
   * Attaches any still-unlinked organizations created by this account's owner.
   * Cheap and idempotent — organizations with an `accountId` are skipped.
   */
  private async backfillAccount(accountId: string) {
    const account = this.getById(accountId);
    if (!account) return;
    const orphans = dbStore.organizations.filter(
      (item) => !item.accountId && !item.deletedAt && item.createdBy === account.ownerUserId,
    );
    for (const org of orphans) {
      await this.attachOrganization(org, accountId);
    }
  }

  private async loadOrganization(organizationId: string): Promise<OrganizationEntity | undefined> {
    const cached = dbStore.organizations.find((item) => item.id === organizationId && !item.deletedAt);
    if (cached) return cached;
    if (!AppDataSource.isInitialized) return undefined;
    try {
      const fromDb = await AppDataSource.getRepository(Organization).findOne({
        where: { id: organizationId },
      });
      if (fromDb && !fromDb.deletedAt) {
        if (!dbStore.organizations.some((item) => item.id === fromDb.id)) {
          dbStore.organizations.push(fromDb);
        }
        return fromDb;
      }
    } catch (error) {
      this.logger.warn(`Organization lookup failed for ${organizationId}: ${(error as Error).message}`);
    }
    return undefined;
  }
}
