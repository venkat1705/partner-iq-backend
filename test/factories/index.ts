import { v4 as uuidv4 } from 'uuid';
import { SecurityUtils } from '../../src/common/utils/security.utils';
import {
  User,
  Organization,
  OrganizationMembership,
  Program,
  Affiliate,
  TrackingLink,
} from '../../src/database/schema';
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
} from '../../src/common/enums';
import { MembershipStatus, ProgramAccessType } from '../../src/common/enums/rbac';
import { dbStore } from '../../src/database/store';
import { AppDataSource } from '../../src/database/data-source';

export async function makeUser(overrides: Partial<User> = {}, options: { save?: boolean } = {}) {
  const plainPassword = `Pass_${uuidv4().replace(/-/g, '').slice(0, 12)}!Aa1`;
  const passwordHash = await SecurityUtils.hashPassword(plainPassword);
  const id = overrides.id || uuidv4();
  const email = overrides.email || `user-${id.slice(0, 8)}@example.test`;

  const user = new User();
  Object.assign(user, {
    id,
    email,
    passwordHash,
    firstName: 'Test',
    lastName: 'User',
    status: UserStatus.ACTIVE,
    emailVerified: true,
    platformRole: PlatformRole.SUPER_ADMIN,
    failedLoginAttempts: 0,
    ...overrides,
  });

  if (options.save && AppDataSource.isInitialized) {
    await AppDataSource.getRepository(User).save(user);
  }

  if (!dbStore.users.some((u) => u.id === user.id)) {
    dbStore.users.push(user);
  }

  return { user, plainPassword };
}

export async function makeOrg(overrides: Partial<Organization> = {}, options: { save?: boolean } = {}) {
  const id = overrides.id || uuidv4();
  const slug = overrides.slug || `org-${uuidv4().replace(/-/g, '').slice(0, 10)}`;

  const org = new Organization();
  Object.assign(org, {
    id,
    name: `Test Org ${slug.slice(0, 8)}`,
    slug,
    website: `https://${slug}.example.test`,
    country: 'US',
    defaultCurrency: 'USD',
    status: OrganizationStatus.ACTIVE,
    onboardingCompleted: true,
    ...overrides,
  });

  if (options.save && AppDataSource.isInitialized) {
    await AppDataSource.getRepository(Organization).save(org);
  }

  if (!dbStore.organizations.some((o) => o.id === org.id)) {
    dbStore.organizations.push(org);
  }

  return org;
}

export async function makeMembership(overrides: Partial<OrganizationMembership> = {}, options: { save?: boolean } = {}) {
  const id = overrides.id || uuidv4();
  const membership = new OrganizationMembership();
  Object.assign(membership, {
    id,
    organizationId: overrides.organizationId || uuidv4(),
    userId: overrides.userId || uuidv4(),
    role: Role.OWNER,
    status: MembershipStatus.ACTIVE,
    programAccessType: ProgramAccessType.ALL,
    ...overrides,
  });

  if (options.save && AppDataSource.isInitialized) {
    await AppDataSource.getRepository(OrganizationMembership).save(membership);
  }

  if (!dbStore.organizationMemberships.some((m) => m.id === membership.id)) {
    dbStore.organizationMemberships.push(membership);
  }

  return membership;
}

export async function makeProgram(overrides: Partial<Program> = {}, options: { save?: boolean } = {}) {
  const id = overrides.id || uuidv4();
  const slug = overrides.slug || `prog-${uuidv4().replace(/-/g, '').slice(0, 10)}`;

  const program = new Program();
  Object.assign(program, {
    id,
    organizationId: overrides.organizationId || uuidv4(),
    name: `Test Program ${slug.slice(0, 8)}`,
    slug,
    description: 'Test program for automated test suites',
    type: ProgramType.AFFILIATE,
    status: ProgramStatus.ACTIVE,
    commissionType: CommissionType.PERCENTAGE,
    defaultCommissionValue: 2000,
    cookieDurationDays: 60,
    attributionModel: AttributionModel.LAST_CLICK,
    affiliateApprovalMode: 'AUTO',
    ...overrides,
  });

  if (options.save && AppDataSource.isInitialized) {
    await AppDataSource.getRepository(Program).save(program);
  }

  if (!dbStore.programs.some((p) => p.id === program.id)) {
    dbStore.programs.push(program);
  }

  return program;
}

export async function makeAffiliate(overrides: Partial<Affiliate> = {}, options: { save?: boolean } = {}) {
  const id = overrides.id || uuidv4();
  const email = overrides.email || `affiliate-${id.slice(0, 8)}@example.test`;

  const affiliate = new Affiliate();
  Object.assign(affiliate, {
    id,
    organizationId: overrides.organizationId || uuidv4(),
    displayName: `Test Affiliate ${id.slice(0, 6)}`,
    email,
    status: AffiliateStatus.ACTIVE,
    ...overrides,
  });

  if (options.save && AppDataSource.isInitialized) {
    await AppDataSource.getRepository(Affiliate).save(affiliate);
  }

  if (!dbStore.affiliates.some((a) => a.id === affiliate.id)) {
    dbStore.affiliates.push(affiliate);
  }

  return affiliate;
}

export async function makeTrackingLink(overrides: Partial<TrackingLink> = {}, options: { save?: boolean } = {}) {
  const id = overrides.id || uuidv4();
  const shortCode = overrides.shortCode || `TL${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  const link = new TrackingLink();
  Object.assign(link, {
    id,
    organizationId: overrides.organizationId || uuidv4(),
    programId: overrides.programId || uuidv4(),
    affiliateId: overrides.affiliateId || uuidv4(),
    shortCode,
    destinationUrl: 'https://example.test/ref',
    status: TrackingLinkStatus.ACTIVE,
    ...overrides,
  });

  if (options.save && AppDataSource.isInitialized) {
    await AppDataSource.getRepository(TrackingLink).save(link);
  }

  if (!dbStore.trackingLinks.some((t) => t.id === link.id)) {
    dbStore.trackingLinks.push(link);
  }

  return link;
}

/**
 * Creates a complete isolated test fixture:
 * User (Super Admin), Org, Membership, Program, Affiliate, and Tracking Link.
 * In integration tests (save: true), persists entities to partneriq_test.
 */
export async function createTestContext(options: { save?: boolean } = {}) {
  const shouldSave = options.save ?? (AppDataSource.isInitialized && process.env.UNIT_TEST !== 'true');

  const { user: admin, plainPassword: adminPassword } = await makeUser(
    { platformRole: PlatformRole.SUPER_ADMIN },
    { save: shouldSave }
  );

  const org = await makeOrg({ createdBy: admin.id }, { save: shouldSave });

  const membership = await makeMembership(
    { organizationId: org.id, userId: admin.id, role: Role.OWNER },
    { save: shouldSave }
  );

  const program = await makeProgram(
    { organizationId: org.id, createdBy: admin.id },
    { save: shouldSave }
  );

  const affiliate = await makeAffiliate(
    { organizationId: org.id },
    { save: shouldSave }
  );

  const trackingLink = await makeTrackingLink(
    { organizationId: org.id, programId: program.id, affiliateId: affiliate.id },
    { save: shouldSave }
  );

  return {
    admin,
    adminPassword,
    org,
    membership,
    program,
    seedPrograms: [program],
    affiliate,
    trackingLink,
  };
}

