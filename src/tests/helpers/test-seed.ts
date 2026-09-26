import { v4 as uuidv4 } from 'uuid';
import { initializeDataSource } from '../../database/data-source';
import {
  User,
  Organization,
  OrganizationMembership,
  Program,
  Affiliate,
  ProgramAffiliate,
  TrackingLink,
} from '../../database/schema';
import { dbStore } from '../../database/store';
import { SecurityUtils } from '../../common/utils/security.utils';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import {
  UserStatus,
  PlatformRole,
  Role,
  OrganizationStatus,
  ProgramType,
  ProgramStatus,
  CommissionType,
  AttributionModel,
  AffiliateStatus,
  TrackingLinkStatus,
} from '../../common/enums';
import { MembershipStatus, ProgramAccessType } from '../../common/enums/rbac';
import { seedSystemDefaults } from '../../database/seeds/run-seed';

export interface TestSeedResult {
  admin: User;
  adminPassword: string;
  org: Organization;
  seedPrograms: Program[];
  affiliate: Affiliate;
}

/**
 * Lightweight test fixture seed exclusively for test execution.
 * Provisions one isolated test organization, admin user, test program, and test affiliate.
 */
export async function runTestSeed(): Promise<TestSeedResult> {
  await seedSystemDefaults();

  const dataSource = await initializeDataSource();
  const users = dataSource.getRepository(User);
  const organizations = dataSource.getRepository(Organization);
  const memberships = dataSource.getRepository(OrganizationMembership);
  const programs = dataSource.getRepository(Program);
  const affiliates = dataSource.getRepository(Affiliate);
  const trackingLinks = dataSource.getRepository(TrackingLink);

  const adminPassword = 'TestAdminPass@2026';
  const adminEmail = `test-admin-${Date.now()}@partneriq.test`;

  let admin = await users.findOne({ where: { platformRole: PlatformRole.SUPER_ADMIN } });
  if (!admin) {
    const passwordHash = await SecurityUtils.hashPassword(adminPassword);
    const adminEntity = users.create({
      id: uuidv4(),
      email: adminEmail,
      passwordHash,
      firstName: 'Test',
      lastName: 'Admin',
      status: UserStatus.ACTIVE,
      emailVerified: true,
      platformRole: PlatformRole.SUPER_ADMIN,
      failedLoginAttempts: 0,
    });
    admin = await users.save(adminEntity);
  }

  // Sync to dbStore
  if (!dbStore.users.some((u) => u.id === admin!.id)) {
    dbStore.users.push(admin);
  }

  const orgSlug = `test-org-${Date.now()}`;
  const orgEntity = organizations.create({
    id: uuidv4(),
    name: 'Test Organization',
    slug: orgSlug,
    website: 'https://test.partneriq.io',
    country: 'US',
    defaultCurrency: PLATFORM_CURRENCY || 'USD',
    status: OrganizationStatus.ACTIVE,
    onboardingCompleted: true,
    createdBy: admin.id,
  });
  const org = await organizations.save(orgEntity);

  if (!dbStore.organizations.some((o) => o.id === org.id)) {
    dbStore.organizations.push(org);
  }

  const membership = memberships.create({
    id: uuidv4(),
    organizationId: org.id,
    userId: admin.id,
    role: Role.OWNER,
    status: MembershipStatus.ACTIVE,
    programAccessType: ProgramAccessType.ALL,
  });
  await memberships.save(membership);

  if (!dbStore.organizationMemberships.some((m) => m.id === membership.id)) {
    dbStore.organizationMemberships.push(membership);
  }

  const programEntity = programs.create({
    id: uuidv4(),
    organizationId: org.id,
    name: 'Test Partner Program',
    slug: `${orgSlug}-program`,
    description: 'Test program for automated test suites',
    type: ProgramType.AFFILIATE,
    status: ProgramStatus.ACTIVE,
    commissionType: CommissionType.PERCENTAGE,
    defaultCommissionValue: 2000,
    cookieDurationDays: 60,
    attributionModel: AttributionModel.LAST_CLICK,
    affiliateApprovalMode: 'AUTO',
    createdBy: admin.id,
  });
  const program = await programs.save(programEntity);

  if (!dbStore.programs.some((p) => p.id === program.id)) {
    dbStore.programs.push(program);
  }

  const affiliateEntity = affiliates.create({
    id: uuidv4(),
    organizationId: org.id,
    displayName: 'Test Affiliate',
    email: `affiliate-${Date.now()}@partneriq.test`,
    status: AffiliateStatus.ACTIVE,
    trustScore: 85,
  });
  const affiliate = await affiliates.save(affiliateEntity);

  if (!dbStore.affiliates.some((a) => a.id === affiliate.id)) {
    dbStore.affiliates.push(affiliate);
  }

  const programAffiliatesRepo = dataSource.getRepository(ProgramAffiliate);
  const progAffEntity = programAffiliatesRepo.create({
    id: uuidv4(),
    organizationId: org.id,
    programId: program.id,
    affiliateId: affiliate.id,
    status: AffiliateStatus.ACTIVE,
    referralCode: `REF-${Date.now().toString(36).toUpperCase()}`,
    joinedAt: new Date(),
  });
  const progAff = await programAffiliatesRepo.save(progAffEntity);
  if (!dbStore.programAffiliates.some((pa) => pa.id === progAff.id)) {
    dbStore.programAffiliates.push(progAff);
  }

  const linkEntity = trackingLinks.create({
    id: uuidv4(),
    organizationId: org.id,
    programId: program.id,
    affiliateId: affiliate.id,
    shortCode: 'k8s-deepdive',
    destinationUrl: 'https://test.partneriq.io/ref',
    status: TrackingLinkStatus.ACTIVE,
  });
  const link = await trackingLinks.save(linkEntity);

  if (!dbStore.trackingLinks.some((t) => t.id === link.id)) {
    dbStore.trackingLinks.push(link);
  }

  return {
    admin,
    adminPassword,
    org,
    seedPrograms: [program],
    affiliate,
  };
}

// Alias for backwards compatibility in existing test suites
export const runSeed = runTestSeed;
