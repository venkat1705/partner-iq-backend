/**
 * Subscription plan limits, add-on capacity, and billing safety.
 *
 * Runs entirely against the in-memory `dbStore` with no database connection:
 * `PlanService`, `BillingAccountService` and `LimitLockService` all degrade
 * gracefully when `AppDataSource.isInitialized` is false, so the suite
 * exercises the real services rather than stubs.
 *
 *   npm run test:limits
 */
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../database/store';
import { AffiliateStatus, EnvironmentType, OrganizationStatus, ProgramStatus, Role } from '../common/enums';
import { MembershipStatus, ProgramAccessType } from '../common/enums/rbac';
import {
  BillingAddonPurchaseStatus,
  BillingInterval,
  BillingResourceType,
  SubscriptionStatus,
} from '../modules/billing/enums/billing.enums';
import { PlanService } from '../modules/billing/services/plan.service';
import { BillingAccountService } from '../modules/billing/services/billing-account.service';
import { LimitLockService } from '../modules/billing/services/limit-lock.service';
import { SubscriptionUsageService } from '../modules/billing/services/subscription-usage.service';
import { SubscriptionLimitService } from '../modules/billing/services/subscription-limit.service';
import { BillingTaxService } from '../modules/billing/services/billing-tax.service';
import { AddonService } from '../modules/billing/services/addon.service';
import { ResourceLimitReachedException } from '../modules/billing/errors/resource-limit.exception';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${name}`, detail ?? '');
    failed++;
  }
}

async function assertRejectsWithLimit(
  work: () => Promise<unknown>,
  name: string,
  expectedResource: BillingResourceType,
) {
  try {
    await work();
    assert(false, name, 'expected RESOURCE_LIMIT_REACHED but the call succeeded');
  } catch (error) {
    if (error instanceof ResourceLimitReachedException) {
      assert(
        error.details.resource === expectedResource,
        name,
        `resource was ${error.details.resource}`,
      );
    } else {
      assert(false, name, (error as Error)?.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const plans = new PlanService();
const accounts = new BillingAccountService();
const locks = new LimitLockService();
const usage = new SubscriptionUsageService(accounts);
const limits = new SubscriptionLimitService(accounts, usage, locks, plans);
const tax = new BillingTaxService();
const addons = new AddonService(accounts, limits, tax, {} as any, {} as any);

function resetStore() {
  dbStore.users.length = 0;
  dbStore.organizations.length = 0;
  dbStore.organizationMemberships.length = 0;
  dbStore.organizationInvitations.length = 0;
  dbStore.programs.length = 0;
  dbStore.affiliates.length = 0;
  dbStore.affiliateInvitations.length = 0;
  dbStore.programAffiliates.length = 0;
  dbStore.billingAccounts.length = 0;
  dbStore.billingSubscriptions.length = 0;
  dbStore.billingAddonPurchases.length = 0;
  dbStore.auditLogs.length = 0;
}

function makeUser(email: string) {
  const user = {
    id: uuidv4(),
    email,
    firstName: 'Test',
    lastName: 'Owner',
    passwordHash: 'x',
    status: 'ACTIVE',
    emailVerified: true,
    failedLoginAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
  dbStore.users.push(user);
  return user;
}

function makeOrganization(accountId: string, ownerUserId: string, name: string) {
  const org = {
    id: uuidv4(),
    accountId,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-') + '-' + uuidv4().slice(0, 4),
    country: 'IN',
    defaultCurrency: 'INR',
    status: OrganizationStatus.ACTIVE,
    onboardingCompleted: true,
    createdBy: ownerUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
  dbStore.organizations.push(org);
  return org;
}

function makeProgram(organizationId: string, name: string, environment = EnvironmentType.LIVE) {
  const program = {
    id: uuidv4(),
    organizationId,
    environment,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-') + '-' + uuidv4().slice(0, 4),
    type: 'AFFILIATE',
    status: ProgramStatus.ACTIVE,
    currency: 'INR',
    commissionType: 'PERCENTAGE',
    defaultCommissionValue: 1000,
    attributionModel: 'LAST_CLICK',
    createdBy: uuidv4(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
  dbStore.programs.push(program);
  return program;
}

function makeAffiliate(organizationId: string, email: string, status = AffiliateStatus.ACTIVE) {
  const affiliate = {
    id: uuidv4(),
    organizationId,
    displayName: email,
    email,
    country: 'IN',
    status,
    trustScore: 80,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
  dbStore.affiliates.push(affiliate);
  return affiliate;
}

function joinProgram(organizationId: string, programId: string, affiliateId: string) {
  const row = {
    id: uuidv4(),
    organizationId,
    environment: EnvironmentType.LIVE,
    programId,
    affiliateId,
    status: AffiliateStatus.ACTIVE,
    referralCode: uuidv4().slice(0, 8),
    joinedAt: new Date(),
  } as any;
  dbStore.programAffiliates.push(row);
  return row;
}

function makeMember(organizationId: string, userId: string, role = Role.ADMIN) {
  const membership = {
    id: uuidv4(),
    organizationId,
    userId,
    role,
    status: MembershipStatus.ACTIVE,
    programAccessType: ProgramAccessType.ALL,
    programIds: [],
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
  dbStore.organizationMemberships.push(membership);
  return membership;
}

async function subscribeAccount(accountId: string, organizationId: string, planCode: string) {
  const plan = await plans.findByCode(planCode, BillingInterval.MONTHLY);
  if (!plan) throw new Error(`Plan ${planCode} was not seeded`);
  const subscription = {
    id: uuidv4(),
    accountId,
    organizationId,
    planId: plan.id,
    provider: 'INTERNAL',
    status: SubscriptionStatus.ACTIVE,
    billingInterval: BillingInterval.MONTHLY,
    billingCycle: BillingInterval.MONTHLY,
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    cancelAtPeriodEnd: false,
    rowStatus: 'ACTIVE',
    createdDate: new Date(),
    modifiedDate: new Date(),
  } as any;
  dbStore.billingSubscriptions.push(subscription);
  return { subscription, plan };
}

/** Grants paid add-on capacity, as the payment webhook would. */
async function grantAddon(
  accountId: string,
  subscriptionId: string,
  resourceType: BillingResourceType,
  quantity: number,
) {
  const addon = (await addons.listAddons(BillingInterval.MONTHLY)).find(
    (item) => item.resourceType === resourceType,
  );
  if (!addon) throw new Error(`No add-on for ${resourceType}`);
  dbStore.billingAddonPurchases.push({
    id: uuidv4(),
    accountId,
    subscriptionId,
    addonId: addon.id,
    resourceType,
    quantity,
    unitPriceSnapshot: addon.unitPrice,
    currency: addon.currency,
    billingInterval: addon.billingInterval,
    status: BillingAddonPurchaseStatus.ACTIVE,
    startDate: new Date(),
    rowStatus: 'ACTIVE',
    createdDate: new Date(),
    modifiedDate: new Date(),
  } as any);
  return addon;
}

/**
 * Sets up one account on `planCode` with a single organization, and returns
 * helpers that create resources through the real limit service.
 */
async function setupAccount(planCode: string) {
  const owner = makeUser(`owner-${uuidv4().slice(0, 8)}@partneriq.test`);
  const account = await accounts.resolveForUser(owner.id);
  const org = makeOrganization(account.id, owner.id, 'Primary Brand');
  const { subscription } = await subscribeAccount(account.id, org.id, planCode);

  return {
    owner,
    account,
    org,
    subscription,

    /** Creates an organization through the ORGANIZATION allowance. */
    createOrganization: (name: string) =>
      limits.reserve(account.id, BillingResourceType.ORGANIZATION, async () =>
        makeOrganization(account.id, owner.id, name),
      ),

    /** Creates a LIVE program through the PROGRAM allowance. */
    createProgram: (organizationId: string, name: string) =>
      limits.reserve(account.id, BillingResourceType.PROGRAM, async () =>
        makeProgram(organizationId, name),
      ),

    /** Creates an affiliate through the AFFILIATE allowance. */
    createAffiliate: (organizationId: string, email: string) =>
      limits.reserve(account.id, BillingResourceType.AFFILIATE, async () =>
        makeAffiliate(organizationId, email),
      ),

    /** Adds an internal member seat through the MEMBER allowance. */
    createMember: (organizationId: string) =>
      limits.reserve(account.id, BillingResourceType.MEMBER, async () => {
        const user = makeUser(`member-${uuidv4().slice(0, 8)}@partneriq.test`);
        return makeMember(organizationId, user.id);
      }),
  };
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

async function testPlanCatalog() {
  console.log('\n📦 Plan catalog\n');
  resetStore();
  await plans.ensureDefaultPlans();

  const monthly = await plans.listPublicPlans(BillingInterval.MONTHLY);
  const byCode = (code: string) => monthly.find((plan) => plan.code === code);
  const limitOf = (code: string, resource: BillingResourceType) =>
    byCode(code)?.limits.find((item) => item.resourceType === resource)?.includedLimit;

  assert(byCode('STARTER')?.price === 500_000, 'Starter is ₹5,000/month (500000 paise)');
  assert(byCode('GROWTH')?.price === 1_000_000, 'Growth is ₹10,000/month');
  assert(byCode('PRO')?.price === 1_700_000, 'Pro is ₹17,000/month');

  const yearly = await plans.listPublicPlans(BillingInterval.YEARLY);
  assert(
    yearly.find((plan) => plan.code === 'STARTER')?.price === 5_000_000,
    'Starter is ₹50,000/year',
  );
  assert(
    yearly.find((plan) => plan.code === 'GROWTH')?.price === 10_000_000,
    'Growth is ₹1,00,000/year',
  );
  assert(
    yearly.find((plan) => plan.code === 'PRO')?.price === 17_000_000,
    'Pro is ₹1,70,000/year',
  );

  assert(limitOf('STARTER', BillingResourceType.ORGANIZATION) === 1, 'Starter includes 1 organization');
  assert(limitOf('STARTER', BillingResourceType.PROGRAM) === 3, 'Starter includes 3 programs');
  assert(limitOf('STARTER', BillingResourceType.AFFILIATE) === 50, 'Starter includes 50 affiliates');
  assert(limitOf('STARTER', BillingResourceType.MEMBER) === 5, 'Starter includes 5 members');

  assert(limitOf('GROWTH', BillingResourceType.ORGANIZATION) === 5, 'Growth includes 5 organizations');
  assert(limitOf('GROWTH', BillingResourceType.PROGRAM) === 10, 'Growth includes 10 programs');
  assert(limitOf('GROWTH', BillingResourceType.AFFILIATE) === 200, 'Growth includes 200 affiliates');
  assert(limitOf('GROWTH', BillingResourceType.MEMBER) === 15, 'Growth includes 15 members');

  assert(
    byCode('PRO')?.limits.every((item) => item.includedLimit === null),
    'Pro is unlimited on every resource (NULL, never Infinity)',
  );
  assert(
    !monthly.some((plan) => plan.code === 'BUSINESS'),
    'Retired BUSINESS plan is hidden from the public catalog',
  );

  const addonCatalog = await addons.listAddons(BillingInterval.MONTHLY);
  const addonPrice = (resource: BillingResourceType) =>
    addonCatalog.find((item) => item.resourceType === resource)?.unitPrice;
  assert(addonPrice(BillingResourceType.ORGANIZATION) === 200_000, 'Organization add-on is ₹2,000/month');
  assert(addonPrice(BillingResourceType.PROGRAM) === 50_000, 'Program add-on is ₹500/month');
  assert(addonPrice(BillingResourceType.AFFILIATE) === 5_000, 'Affiliate add-on is ₹50/month');
  assert(addonPrice(BillingResourceType.MEMBER) === 20_000, 'Member add-on is ₹200/month');
}

async function testStarterLimits() {
  console.log('\n🟢 Starter limits\n');
  resetStore();
  await plans.ensureDefaultPlans();
  const ctx = await setupAccount('STARTER');

  // Organizations: 1 included, the setup already used it.
  const orgUsage = await usage.getUsage(ctx.account.id);
  assert(orgUsage.organizations === 1, 'Starter starts at 1/1 organizations');
  await assertRejectsWithLimit(
    () => ctx.createOrganization('Second Brand'),
    'Starter rejects a second organization',
    BillingResourceType.ORGANIZATION,
  );

  // Programs: 3 included.
  await ctx.createProgram(ctx.org.id, 'Program 1');
  await ctx.createProgram(ctx.org.id, 'Program 2');
  await ctx.createProgram(ctx.org.id, 'Program 3');
  assert((await usage.getUsage(ctx.account.id)).programs === 3, 'Starter allows programs 1-3');
  await assertRejectsWithLimit(
    () => ctx.createProgram(ctx.org.id, 'Program 4'),
    'Starter rejects program 4',
    BillingResourceType.PROGRAM,
  );

  // Affiliates: 50 included.
  for (let i = 1; i <= 50; i++) {
    await ctx.createAffiliate(ctx.org.id, `affiliate${i}@partner.test`);
  }
  assert((await usage.getUsage(ctx.account.id)).affiliates === 50, 'Starter allows affiliates 1-50');
  await assertRejectsWithLimit(
    () => ctx.createAffiliate(ctx.org.id, 'affiliate51@partner.test'),
    'Starter rejects affiliate 51',
    BillingResourceType.AFFILIATE,
  );

  // Members: 5 included. The owner is not yet a member row, so add five.
  for (let i = 0; i < 5; i++) {
    await ctx.createMember(ctx.org.id);
  }
  assert((await usage.getUsage(ctx.account.id)).members === 5, 'Starter allows members 1-5');
  await assertRejectsWithLimit(
    () => ctx.createMember(ctx.org.id),
    'Starter rejects member 6',
    BillingResourceType.MEMBER,
  );

  // The rejection payload must tell the frontend exactly what to offer.
  try {
    await ctx.createProgram(ctx.org.id, 'Program 5');
  } catch (error) {
    const details = (error as ResourceLimitReachedException).details;
    assert(details.currentUsage === 3, 'Limit error reports currentUsage');
    assert(details.includedLimit === 3, 'Limit error reports includedLimit');
    assert(details.additionalPurchased === 0, 'Limit error reports additionalPurchased');
    assert(details.effectiveLimit === 3, 'Limit error reports effectiveLimit');
    assert(details.remaining === 0, 'Limit error reports remaining');
    assert(details.canPurchaseAddon === true, 'Limit error offers the add-on path');
    assert(details.canUpgradePlan === true, 'Limit error offers the upgrade path');
    assert(Boolean(details.addon?.id), 'Limit error names the add-on to purchase');
  }
}

async function testGrowthLimits() {
  console.log('\n🔵 Growth limits (account-wide, not per organization)\n');
  resetStore();
  await plans.ensureDefaultPlans();
  const ctx = await setupAccount('GROWTH');

  const orgs = [ctx.org];
  for (let i = 2; i <= 5; i++) {
    orgs.push(await ctx.createOrganization(`Brand ${i}`));
  }
  assert((await usage.getUsage(ctx.account.id)).organizations === 5, 'Growth allows organizations 1-5');
  await assertRejectsWithLimit(
    () => ctx.createOrganization('Brand 6'),
    'Growth rejects organization 6',
    BillingResourceType.ORGANIZATION,
  );

  // 10 programs spread across three organizations — 4 + 3 + 3.
  for (let i = 0; i < 4; i++) await ctx.createProgram(orgs[0].id, `A Program ${i}`);
  for (let i = 0; i < 3; i++) await ctx.createProgram(orgs[1].id, `B Program ${i}`);
  for (let i = 0; i < 3; i++) await ctx.createProgram(orgs[2].id, `C Program ${i}`);
  assert(
    (await usage.getUsage(ctx.account.id)).programs === 10,
    'Growth counts programs across all organizations',
  );
  await assertRejectsWithLimit(
    () => ctx.createProgram(orgs[3].id, 'D Program 1'),
    'Growth rejects program 11 even in a different organization',
    BillingResourceType.PROGRAM,
  );

  // 200 affiliates spread 100 + 60 + 40.
  for (let i = 0; i < 100; i++) await ctx.createAffiliate(orgs[0].id, `a${i}@partner.test`);
  for (let i = 0; i < 60; i++) await ctx.createAffiliate(orgs[1].id, `b${i}@partner.test`);
  for (let i = 0; i < 40; i++) await ctx.createAffiliate(orgs[2].id, `c${i}@partner.test`);
  assert(
    (await usage.getUsage(ctx.account.id)).affiliates === 200,
    'Growth counts affiliates across all organizations',
  );
  await assertRejectsWithLimit(
    () => ctx.createAffiliate(orgs[3].id, 'overflow@partner.test'),
    'Growth rejects affiliate 201 even in a different organization',
    BillingResourceType.AFFILIATE,
  );

  for (let i = 0; i < 15; i++) await ctx.createMember(orgs[i % 5].id);
  assert((await usage.getUsage(ctx.account.id)).members === 15, 'Growth allows members 1-15');
  await assertRejectsWithLimit(
    () => ctx.createMember(orgs[0].id),
    'Growth rejects member 16',
    BillingResourceType.MEMBER,
  );
}

async function testProUnlimited() {
  console.log('\n🟣 Pro is unlimited\n');
  resetStore();
  await plans.ensureDefaultPlans();
  const ctx = await setupAccount('PRO');

  for (let i = 2; i <= 12; i++) await ctx.createOrganization(`Brand ${i}`);
  for (let i = 0; i < 40; i++) await ctx.createProgram(ctx.org.id, `Program ${i}`);
  for (let i = 0; i < 400; i++) await ctx.createAffiliate(ctx.org.id, `pro${i}@partner.test`);
  for (let i = 0; i < 60; i++) await ctx.createMember(ctx.org.id);

  const effective = await limits.getEffectiveLimits(ctx.account.id);
  assert(effective.usage.organizations === 12, 'Pro created 12 organizations');
  assert(effective.usage.programs === 40, 'Pro created 40 programs');
  assert(effective.usage.affiliates === 400, 'Pro created 400 affiliates');
  assert(effective.usage.members === 60, 'Pro created 60 members');
  assert(
    Object.values(effective.limits).every((limit) => limit.unlimited && limit.effectiveLimit === null),
    'Pro reports every resource as unlimited with a null effective limit',
  );
  assert(
    Object.values(effective.limits).every((limit) => limit.remaining === null && !limit.atLimit),
    'Pro never reports a resource as at-limit',
  );
}

async function testAddonCapacity() {
  console.log('\n➕ Add-on capacity raises the effective limit\n');

  // Programs: 3 included + 2 purchased = 5.
  resetStore();
  await plans.ensureDefaultPlans();
  let ctx = await setupAccount('STARTER');
  for (let i = 1; i <= 3; i++) await ctx.createProgram(ctx.org.id, `Program ${i}`);
  await grantAddon(ctx.account.id, ctx.subscription.id, BillingResourceType.PROGRAM, 2);
  let effective = await limits.getEffectiveLimits(ctx.account.id);
  assert(
    effective.limits.PROGRAM.effectiveLimit === 5 && effective.limits.PROGRAM.additionalPurchased === 2,
    'Starter + 2 program add-ons gives an effective limit of 5',
  );
  await ctx.createProgram(ctx.org.id, 'Program 4');
  await ctx.createProgram(ctx.org.id, 'Program 5');
  assert((await usage.getUsage(ctx.account.id)).programs === 5, 'Programs 4 and 5 are allowed');
  await assertRejectsWithLimit(
    () => ctx.createProgram(ctx.org.id, 'Program 6'),
    'Program 6 is still rejected',
    BillingResourceType.PROGRAM,
  );

  // Affiliates: 50 included + 25 purchased = 75.
  resetStore();
  await plans.ensureDefaultPlans();
  ctx = await setupAccount('STARTER');
  for (let i = 1; i <= 50; i++) await ctx.createAffiliate(ctx.org.id, `a${i}@partner.test`);
  await grantAddon(ctx.account.id, ctx.subscription.id, BillingResourceType.AFFILIATE, 25);
  effective = await limits.getEffectiveLimits(ctx.account.id);
  assert(effective.limits.AFFILIATE.effectiveLimit === 75, 'Starter + 25 affiliate add-ons gives 75');
  for (let i = 51; i <= 75; i++) await ctx.createAffiliate(ctx.org.id, `a${i}@partner.test`);
  assert((await usage.getUsage(ctx.account.id)).affiliates === 75, 'Affiliates 51-75 are allowed');
  await assertRejectsWithLimit(
    () => ctx.createAffiliate(ctx.org.id, 'a76@partner.test'),
    'Affiliate 76 is still rejected',
    BillingResourceType.AFFILIATE,
  );

  // Members: 5 included + 3 purchased = 8.
  resetStore();
  await plans.ensureDefaultPlans();
  ctx = await setupAccount('STARTER');
  for (let i = 0; i < 5; i++) await ctx.createMember(ctx.org.id);
  await grantAddon(ctx.account.id, ctx.subscription.id, BillingResourceType.MEMBER, 3);
  effective = await limits.getEffectiveLimits(ctx.account.id);
  assert(effective.limits.MEMBER.effectiveLimit === 8, 'Starter + 3 member add-ons gives 8');
  for (let i = 6; i <= 8; i++) await ctx.createMember(ctx.org.id);
  await assertRejectsWithLimit(
    () => ctx.createMember(ctx.org.id),
    'Member 9 is still rejected',
    BillingResourceType.MEMBER,
  );

  // Organizations: 1 included + 2 purchased = 3.
  resetStore();
  await plans.ensureDefaultPlans();
  ctx = await setupAccount('STARTER');
  await grantAddon(ctx.account.id, ctx.subscription.id, BillingResourceType.ORGANIZATION, 2);
  effective = await limits.getEffectiveLimits(ctx.account.id);
  assert(effective.limits.ORGANIZATION.effectiveLimit === 3, 'Starter + 2 organization add-ons gives 3');
  await ctx.createOrganization('Brand 2');
  await ctx.createOrganization('Brand 3');
  await assertRejectsWithLimit(
    () => ctx.createOrganization('Brand 4'),
    'Organization 4 is still rejected',
    BillingResourceType.ORGANIZATION,
  );

  // A cancelled add-on stops granting capacity.
  const purchase = dbStore.billingAddonPurchases.find((item) => item.accountId === ctx.account.id)!;
  purchase.status = BillingAddonPurchaseStatus.CANCELLED;
  purchase.endDate = new Date(Date.now() - 1000);
  effective = await limits.getEffectiveLimits(ctx.account.id);
  assert(
    effective.limits.ORGANIZATION.effectiveLimit === 1,
    'A cancelled add-on stops contributing capacity',
  );
}

async function testUniqueAffiliateCounting() {
  console.log('\n🔁 A partner in many programs counts once\n');
  resetStore();
  await plans.ensureDefaultPlans();
  const ctx = await setupAccount('STARTER');

  const p1 = await ctx.createProgram(ctx.org.id, 'Referral');
  const p2 = await ctx.createProgram(ctx.org.id, 'Influencer');
  const p3 = await ctx.createProgram(ctx.org.id, 'Reseller');

  const affiliate = await ctx.createAffiliate(ctx.org.id, 'multi@partner.test');
  joinProgram(ctx.org.id, p1.id, affiliate.id);
  joinProgram(ctx.org.id, p2.id, affiliate.id);
  joinProgram(ctx.org.id, p3.id, affiliate.id);

  const after = await usage.getUsage(ctx.account.id);
  assert(after.affiliates === 1, 'One affiliate in three programs counts as one', after);
  assert(
    dbStore.programAffiliates.filter((item) => item.affiliateId === affiliate.id).length === 3,
    'Three program memberships exist but do not inflate usage',
  );

  // Status changes release capacity without deleting anything.
  affiliate.status = AffiliateStatus.SUSPENDED;
  assert(
    (await usage.getUsage(ctx.account.id)).affiliates === 0,
    'Suspending an affiliate frees their slot',
  );
  affiliate.status = AffiliateStatus.ACTIVE;
  assert(
    (await usage.getUsage(ctx.account.id)).affiliates === 1,
    'Restoring an affiliate reclaims their slot',
  );
}

async function testUsageAccuracy() {
  console.log('\n📊 Usage reflects create / delete / deactivate / restore\n');
  resetStore();
  await plans.ensureDefaultPlans();
  const ctx = await setupAccount('GROWTH');

  const program = await ctx.createProgram(ctx.org.id, 'Temp Program');
  assert((await usage.getUsage(ctx.account.id)).programs === 1, 'Creating a program raises usage');

  (program as any).deletedAt = new Date();
  assert((await usage.getUsage(ctx.account.id)).programs === 0, 'Soft-deleting a program frees capacity');

  (program as any).deletedAt = undefined;
  assert((await usage.getUsage(ctx.account.id)).programs === 1, 'Restoring a program reclaims capacity');

  // TEST-environment programs are sandbox scaffolding and are never billed.
  makeProgram(ctx.org.id, 'Sandbox', EnvironmentType.TEST);
  assert(
    (await usage.getUsage(ctx.account.id)).programs === 1,
    'TEST-environment programs do not consume program capacity',
  );

  // A member holding seats in three organizations is still one seat.
  const second = await ctx.createOrganization('Second Brand');
  const third = await ctx.createOrganization('Third Brand');
  const person = makeUser('shared-admin@partneriq.test');
  makeMember(ctx.org.id, person.id);
  makeMember(second.id, person.id);
  makeMember(third.id, person.id);
  assert(
    (await usage.getUsage(ctx.account.id)).members === 1,
    'One person across three organizations is one member seat',
  );

  // A live invitation reserves a seat; an expired one does not.
  dbStore.organizationInvitations.push({
    id: uuidv4(),
    organizationId: ctx.org.id,
    email: 'pending@partneriq.test',
    roleId: uuidv4(),
    programAccessType: ProgramAccessType.ALL,
    programIds: [],
    tokenHash: 'x',
    expiresAt: new Date(Date.now() + 3600_000),
    invitedBy: ctx.owner.id,
    createdAt: new Date(),
  } as any);
  assert(
    (await usage.getUsage(ctx.account.id)).members === 2,
    'A live invitation reserves a member seat',
  );

  dbStore.organizationInvitations.push({
    id: uuidv4(),
    organizationId: ctx.org.id,
    email: 'expired@partneriq.test',
    roleId: uuidv4(),
    programAccessType: ProgramAccessType.ALL,
    programIds: [],
    tokenHash: 'x',
    expiresAt: new Date(Date.now() - 3600_000),
    invitedBy: ctx.owner.id,
    createdAt: new Date(),
  } as any);
  assert(
    (await usage.getUsage(ctx.account.id)).members === 2,
    'An expired invitation does not hold a member seat forever',
  );
}

async function testConcurrency() {
  console.log('\n⚡ Concurrent creation cannot bypass the limit\n');
  resetStore();
  await plans.ensureDefaultPlans();
  const ctx = await setupAccount('STARTER');

  for (let i = 1; i <= 49; i++) {
    await ctx.createAffiliate(ctx.org.id, `a${i}@partner.test`);
  }
  assert((await usage.getUsage(ctx.account.id)).affiliates === 49, 'Account sits at 49/50 affiliates');

  // Two requests race for the single remaining slot.
  const results = await Promise.allSettled([
    ctx.createAffiliate(ctx.org.id, 'race-a@partner.test'),
    ctx.createAffiliate(ctx.org.id, 'race-b@partner.test'),
  ]);
  const fulfilled = results.filter((item) => item.status === 'fulfilled');
  const rejected = results.filter((item) => item.status === 'rejected');

  assert(fulfilled.length === 1, 'Exactly one of the two racing requests succeeds', results);
  assert(rejected.length === 1, 'Exactly one of the two racing requests is rejected');
  assert(
    rejected[0] &&
      (rejected[0] as PromiseRejectedResult).reason instanceof ResourceLimitReachedException,
    'The losing request is rejected with RESOURCE_LIMIT_REACHED',
  );
  assert(
    (await usage.getUsage(ctx.account.id)).affiliates === 50,
    'Usage lands exactly on the limit, never above it',
  );

  // A larger burst against the last few slots.
  resetStore();
  await plans.ensureDefaultPlans();
  const burst = await setupAccount('STARTER');
  for (let i = 1; i <= 45; i++) {
    await burst.createAffiliate(burst.org.id, `b${i}@partner.test`);
  }
  const burstResults = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      burst.createAffiliate(burst.org.id, `burst${i}@partner.test`),
    ),
  );
  assert(
    burstResults.filter((item) => item.status === 'fulfilled').length === 5,
    'Exactly the 5 remaining slots are filled out of 20 concurrent attempts',
  );
  assert(
    (await usage.getUsage(burst.account.id)).affiliates === 50,
    'A 20-way burst still lands exactly on 50',
  );
}

async function testPlanChanges() {
  console.log('\n🔄 Upgrade and downgrade\n');
  resetStore();
  await plans.ensureDefaultPlans();
  const ctx = await setupAccount('STARTER');

  for (let i = 1; i <= 3; i++) await ctx.createProgram(ctx.org.id, `Program ${i}`);
  await assertRejectsWithLimit(
    () => ctx.createProgram(ctx.org.id, 'Program 4'),
    'Starter is at its program limit before upgrading',
    BillingResourceType.PROGRAM,
  );

  // Upgrade Starter -> Growth.
  const growth = await plans.findByCode('GROWTH', BillingInterval.MONTHLY);
  ctx.subscription.planId = growth!.id;
  const afterUpgrade = await limits.getEffectiveLimits(ctx.account.id);
  assert(afterUpgrade.limits.PROGRAM.effectiveLimit === 10, 'Growth raises the program limit to 10');
  await ctx.createProgram(ctx.org.id, 'Program 4');
  assert((await usage.getUsage(ctx.account.id)).programs === 4, 'Program 4 is allowed after upgrading');

  // Add-on capacity survives an upgrade and stacks on the new allowance,
  // without double-counting the plan's own included capacity.
  await grantAddon(ctx.account.id, ctx.subscription.id, BillingResourceType.PROGRAM, 2);
  const stacked = await limits.getEffectiveLimits(ctx.account.id);
  assert(
    stacked.limits.PROGRAM.includedLimit === 10 &&
      stacked.limits.PROGRAM.additionalPurchased === 2 &&
      stacked.limits.PROGRAM.effectiveLimit === 12,
    'Included capacity is replaced, not added twice; add-ons stack on top',
  );

  // Upgrade Growth -> Pro.
  const pro = await plans.findByCode('PRO', BillingInterval.MONTHLY);
  ctx.subscription.planId = pro!.id;
  assert(
    (await limits.getEffectiveLimits(ctx.account.id)).limits.PROGRAM.unlimited,
    'Growth to Pro makes programs unlimited',
  );

  // Downgrade Pro -> Starter. Usage is 4 programs; Starter includes 3 but the
  // account kept 2 program add-ons, so the effective target limit is 5 and the
  // downgrade fits. Retained capacity is exactly what should make it fit.
  const starter = await plans.findByCode('STARTER', BillingInterval.MONTHLY);
  const withAddons = await limits.previewPlanChange(ctx.account.id, starter!.id);
  assert(
    withAddons.resources.find((item) => item.resourceType === BillingResourceType.PROGRAM)
      ?.additionalPurchased === 2,
    'Downgrade preview keeps purchased add-on capacity in the target-plan maths',
  );
  assert(
    withAddons.allowed,
    'Downgrade is allowed when retained add-ons cover the gap (4 used, 3 + 2 = 5 available)',
    withAddons.blockers,
  );

  // Release the add-on capacity and the same downgrade no longer fits.
  dbStore.billingAddonPurchases
    .filter((item) => item.accountId === ctx.account.id)
    .forEach((item) => {
      item.status = BillingAddonPurchaseStatus.CANCELLED;
      item.endDate = new Date(Date.now() - 1000);
    });

  const preview = await limits.previewPlanChange(ctx.account.id, starter!.id);
  assert(!preview.allowed, 'Downgrade is blocked while usage exceeds the target plan');
  assert(
    preview.blockers.some((item) => item.resourceType === BillingResourceType.PROGRAM),
    'Downgrade preview names programs as the blocking resource',
  );
  assert(
    preview.blockers.find((item) => item.resourceType === BillingResourceType.PROGRAM)?.exceedsBy === 1,
    'Downgrade preview reports how far over the account is (4 used vs 3 allowed)',
  );
  assert(
    dbStore.programs.filter((item) => !item.deletedAt).length === 4,
    'Downgrade preview deletes nothing',
  );
}

async function testTenantIsolationAndPricing() {
  console.log('\n🔐 Isolation, server-side pricing, and tax\n');
  resetStore();
  await plans.ensureDefaultPlans();

  const a = await setupAccount('STARTER');
  const b = await setupAccount('GROWTH');

  await a.createProgram(a.org.id, 'A1');
  await b.createProgram(b.org.id, 'B1');
  await b.createProgram(b.org.id, 'B2');

  assert((await usage.getUsage(a.account.id)).programs === 1, 'Account A sees only its own programs');
  assert((await usage.getUsage(b.account.id)).programs === 2, 'Account B sees only its own programs');
  assert(a.account.id !== b.account.id, 'Two owners get two separate accounts');

  // Prices come from the catalog; a client-supplied price is not part of the DTO
  // and cannot reach the calculation.
  const quote = await addons.preview(a.account.id, {
    items: [
      {
        addonId: (await addons.listAddons(BillingInterval.MONTHLY)).find(
          (item) => item.resourceType === BillingResourceType.PROGRAM,
        )!.id,
        quantity: 2,
      },
    ],
  } as any);
  assert(quote.newAddonsMinor === 100_000, '2 program add-ons price at ₹1,000 server-side');
  assert(quote.basePriceMinor === 500_000, 'Base Starter price is read from the database');
  assert(
    quote.subtotalMinor === 600_000,
    'Recurring subtotal is base ₹5,000 + add-ons ₹1,000 = ₹6,000',
  );
  assert(quote.taxMinor === 108_000, 'GST at 18% on ₹6,000 is ₹1,080');
  assert(quote.totalMinor === 708_000, 'Total recurring is ₹7,080');
  assert(
    quote.capacity.find((item) => item.resourceType === BillingResourceType.PROGRAM)
      ?.newEffectiveLimit === 5,
    'Quote shows the new effective program limit of 5',
  );

  // Every amount is an integer number of paise — no floating point anywhere.
  assert(
    [quote.subtotalMinor, quote.taxMinor, quote.totalMinor, quote.newAddonsMinor].every((value) =>
      Number.isInteger(value),
    ),
    'All monetary amounts are integer minor units',
  );

  // An add-on for a resource the plan already makes unlimited is refused.
  const pro = await setupAccount('PRO');
  try {
    await addons.preview(pro.account.id, {
      items: [
        {
          addonId: (await addons.listAddons(BillingInterval.MONTHLY)).find(
            (item) => item.resourceType === BillingResourceType.PROGRAM,
          )!.id,
          quantity: 1,
        },
      ],
    } as any);
    assert(false, 'Pro refuses an add-on for an already-unlimited resource');
  } catch (error) {
    assert(
      (error as any)?.response?.code === 'ADDON_NOT_NEEDED',
      'Pro refuses an add-on for an already-unlimited resource',
      (error as any)?.response,
    );
  }

  // Quantities must be positive whole numbers.
  for (const quantity of [0, -3, 1.5]) {
    try {
      await addons.preview(a.account.id, {
        items: [{ addonId: uuidv4(), quantity }],
      } as any);
      assert(false, `Quantity ${quantity} is rejected`);
    } catch {
      assert(true, `Quantity ${quantity} is rejected`);
    }
  }
}

async function testLapsedSubscription() {
  console.log('\n⛔ Lapsed subscriptions grant no new capacity\n');
  resetStore();
  await plans.ensureDefaultPlans();
  const ctx = await setupAccount('GROWTH');

  // Use the FREE fallback allowance up while still entitled, so the expiry
  // check below is testing the allowance and not an empty account.
  await ctx.createProgram(ctx.org.id, 'Live Program');

  ctx.subscription.status = SubscriptionStatus.TRIAL_EXPIRED;
  const effective = await limits.getEffectiveLimits(ctx.account.id);
  assert(!effective.entitled, 'An expired trial is reported as not entitled');
  assert(
    effective.limits.PROGRAM.effectiveLimit === 1,
    'An expired trial falls back to the FREE allowance rather than keeping Growth',
  );
  await assertRejectsWithLimit(
    () => ctx.createProgram(ctx.org.id, 'Blocked'),
    'An expired trial cannot create beyond the FREE allowance',
    BillingResourceType.PROGRAM,
  );

  ctx.subscription.status = SubscriptionStatus.ACTIVE;
  assert(
    (await limits.getEffectiveLimits(ctx.account.id)).limits.PROGRAM.effectiveLimit === 10,
    'Reactivating the subscription restores the Growth allowance',
  );
}

async function main() {
  console.log('\n🧪 PartnerIQ Subscription Limits & Add-on Billing Suite');

  await testPlanCatalog();
  await testStarterLimits();
  await testGrowthLimits();
  await testProUnlimited();
  await testAddonCapacity();
  await testUniqueAffiliateCounting();
  await testUsageAccuracy();
  await testConcurrency();
  await testPlanChanges();
  await testTenantIsolationAndPricing();
  await testLapsedSubscription();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`${'='.repeat(60)}\n`);

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Suite crashed:', error);
  process.exit(1);
});
