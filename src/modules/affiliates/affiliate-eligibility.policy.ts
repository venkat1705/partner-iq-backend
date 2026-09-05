import { ConflictException, ForbiddenException } from '@nestjs/common';
import { dbStore } from '../../database/store';
import { MembershipStatus } from '../../common/enums/rbac';
import { PlatformRole } from '../../common/enums';

const AFFILIATE_ORG_MEMBER_SETTING_KEY = 'affiliateEligibility.allowOrganizationMembers';

export function areOrganizationMembersAllowedAsAffiliates() {
  const setting = dbStore.platformSettings?.find((s) => s.key === AFFILIATE_ORG_MEMBER_SETTING_KEY);
  return setting ? Boolean(setting.value) : false;
}

export function assertUserEligibleForAffiliate(email: string) {
  if (areOrganizationMembersAllowedAsAffiliates()) {
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existingUser = dbStore.users.find(
    (user) => user.email.toLowerCase().trim() === normalizedEmail && !user.deletedAt,
  );

  if (!existingUser) {
    return;
  }

  const activeOrgMembership = dbStore.organizationMemberships.find((membership) => {
    if (membership.userId !== existingUser.id) return false;
    if (membership.status !== MembershipStatus.ACTIVE) return false;

    const organization = dbStore.organizations.find(
      (org) => org.id === membership.organizationId && !org.deletedAt,
    );
    if (!organization) return false;
    if (organization.status === 'SUSPENDED' || organization.status === 'CLOSED') return false;

    return true;
  });

  if (activeOrgMembership) {
    throw new ConflictException({
      statusCode: 409,
      code: 'AFFILIATE_INELIGIBLE_ORGANIZATION_MEMBER',
      message:
        'This user is an active organization member and cannot become an affiliate at this time.',
    });
  }
}

export function assertUserEligibleForOrganization(emailOrUserId: string) {
  if (areOrganizationMembersAllowedAsAffiliates()) {
    return;
  }

  const normalized = emailOrUserId.toLowerCase().trim();
  const existingUser = dbStore.users.find(
    (u) => (u.email.toLowerCase().trim() === normalized || u.id === emailOrUserId) && !u.deletedAt,
  );

  const emailToCheck = existingUser ? existingUser.email.toLowerCase().trim() : normalized;

  const isAffiliate =
    existingUser?.platformRole === PlatformRole.AFFILIATE ||
    dbStore.affiliates?.some(
      (aff) => aff.email.toLowerCase().trim() === emailToCheck,
    );

  if (isAffiliate) {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'ORGANIZATION_INELIGIBLE_AFFILIATE_USER',
      message:
        'This account is registered as an affiliate partner and cannot register, join, or create an organization account.',
    });
  }
}

