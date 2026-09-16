import { Injectable, Logger } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { AffiliateStatus, EnvironmentType } from '../../../common/enums';
import { MembershipStatus } from '../../../common/enums/rbac';
import { BillingResourceType } from '../enums/billing.enums';
import { BillingAccountService } from './billing-account.service';

export interface SubscriptionUsage {
  organizations: number;
  programs: number;
  affiliates: number;
  members: number;
}

export interface SubscriptionUsageBreakdown extends SubscriptionUsage {
  accountId: string;
  organizationIds: string[];
  /** Per-organization split, for the dashboard. Limits are never per-org. */
  perOrganization: Array<{
    organizationId: string;
    organizationName: string;
    programs: number;
    affiliates: number;
    members: number;
  }>;
  calculatedAt: Date;
}

/**
 * Counts what an account is actually using, always from the live records.
 *
 * Counting rules, all account-wide:
 *
 *  - **Organizations** — every non-deleted organization on the account.
 *  - **Programs** — every non-deleted LIVE program across those organizations.
 *    TEST-environment programs are sandbox scaffolding and are not billed.
 *  - **Affiliates** — distinct affiliate records that are ACTIVE or PENDING,
 *    plus live invitations for emails that have no record yet. An affiliate row
 *    is already unique per (organization, email), and joining five programs
 *    adds rows to `program_affiliates` only, so a partner in many programs is
 *    counted exactly once. SUSPENDED and REJECTED affiliates free their
 *    capacity, as do expired and revoked invitations.
 *  - **Members** — distinct *people*: the set of user ids holding an ACTIVE
 *    membership in any of the account's organizations, plus the emails on
 *    invitations that are still live (not accepted, not revoked, not expired).
 *    One person administering three organizations consumes one seat. Expired
 *    invitations release their seat automatically, so nothing is held forever.
 *
 * There is no cached copy of these numbers, which is what keeps usage correct
 * after a create, delete, deactivate or restore with no reconciliation step.
 */
@Injectable()
export class SubscriptionUsageService {
  private readonly logger = new Logger(SubscriptionUsageService.name);

  constructor(private readonly accounts: BillingAccountService) {}

  async getUsage(accountId: string): Promise<SubscriptionUsage> {
    const breakdown = await this.getUsageBreakdown(accountId);
    return {
      organizations: breakdown.organizations,
      programs: breakdown.programs,
      affiliates: breakdown.affiliates,
      members: breakdown.members,
    };
  }

  /** Usage for the account that owns `organizationId`. */
  async getUsageForOrganization(organizationId: string): Promise<SubscriptionUsage> {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.getUsage(account.id);
  }

  async countFor(accountId: string, resourceType: BillingResourceType): Promise<number> {
    const usage = await this.getUsage(accountId);
    switch (resourceType) {
      case BillingResourceType.ORGANIZATION:
        return usage.organizations;
      case BillingResourceType.PROGRAM:
        return usage.programs;
      case BillingResourceType.AFFILIATE:
        return usage.affiliates;
      case BillingResourceType.MEMBER:
        return usage.members;
      default:
        return 0;
    }
  }

  async getUsageBreakdown(accountId: string): Promise<SubscriptionUsageBreakdown> {
    const organizations = await this.accounts.listOrganizations(accountId);
    const organizationIds = organizations.map((item) => item.id);
    const orgIdSet = new Set(organizationIds);

    const programs = dbStore.programs.filter(
      (item) =>
        orgIdSet.has(item.organizationId) &&
        !item.deletedAt &&
        this.isLiveEnvironment(item.environment),
    );

    const affiliates = dbStore.affiliates.filter(
      (item) => orgIdSet.has(item.organizationId) && this.isBillableAffiliate(item.status),
    );

    const affiliateEmails = new Set(
      affiliates.map((item) => `${item.organizationId}:${item.email.toLowerCase().trim()}`),
    );

    // A live affiliate invitation reserves a slot, so an admin cannot invite
    // past the limit and only find out when everyone accepts. Expired and
    // revoked invitations release the slot on their own.
    const pendingAffiliateInvites = new Set(
      dbStore.affiliateInvitations
        .filter(
          (invite) =>
            orgIdSet.has(invite.organizationId) &&
            invite.status === 'PENDING' &&
            !invite.revokedAt &&
            !invite.acceptedAt &&
            new Date(invite.expiresAt).getTime() > Date.now(),
        )
        .map((invite) => `${invite.organizationId}:${invite.email.toLowerCase().trim()}`)
        .filter((key) => !affiliateEmails.has(key)),
    );

    const memberUserIds = new Set(
      dbStore.organizationMemberships
        .filter(
          (item) => orgIdSet.has(item.organizationId) && item.status === MembershipStatus.ACTIVE,
        )
        .map((item) => item.userId),
    );

    // A live invitation reserves a seat so an admin cannot invite past the limit
    // and only discover it when everyone accepts. Expired/revoked/accepted
    // invitations release the seat on their own.
    const now = Date.now();
    const pendingInviteEmails = new Set(
      dbStore.organizationInvitations
        .filter(
          (invite) =>
            orgIdSet.has(invite.organizationId) &&
            !invite.acceptedAt &&
            !invite.revokedAt &&
            new Date(invite.expiresAt).getTime() > now,
        )
        .map((invite) => invite.email.toLowerCase().trim())
        // An invitation addressed to someone who is already an active member
        // elsewhere on the account does not need a second seat.
        .filter((email) => {
          const user = dbStore.users.find(
            (item) => item.email?.toLowerCase().trim() === email && !item.deletedAt,
          );
          return !user || !memberUserIds.has(user.id);
        }),
    );

    const perOrganization = organizations.map((org) => ({
      organizationId: org.id,
      organizationName: org.name,
      programs: programs.filter((item) => item.organizationId === org.id).length,
      affiliates: affiliates.filter((item) => item.organizationId === org.id).length,
      members: dbStore.organizationMemberships.filter(
        (item) => item.organizationId === org.id && item.status === MembershipStatus.ACTIVE,
      ).length,
    }));

    return {
      accountId,
      organizationIds,
      organizations: organizations.length,
      programs: programs.length,
      affiliates: affiliates.length + pendingAffiliateInvites.size,
      members: memberUserIds.size + pendingInviteEmails.size,
      perOrganization,
      calculatedAt: new Date(),
    };
  }

  /**
   * An affiliate still occupies capacity while ACTIVE or PENDING approval.
   * SUSPENDED and REJECTED affiliates do not, so removing a partner frees a slot
   * immediately without deleting their history.
   */
  private isBillableAffiliate(status?: string) {
    return status === AffiliateStatus.ACTIVE || status === AffiliateStatus.PENDING;
  }

  /** Legacy rows have no `environment` and are LIVE by definition. */
  private isLiveEnvironment(environment?: string) {
    return !environment || environment === EnvironmentType.LIVE;
  }
}
