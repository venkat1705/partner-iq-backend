/**
 * Regression suite for the duplicate-organization-on-onboarding bug.
 *
 * Root cause recap: the billing-quota lock in OrganizationsService.create()
 * only prevents EXCEEDING an account's org allowance — it does nothing to
 * stop the SAME user from creating two separate (quota-compliant) orgs via
 * two onboarding attempts, whether from a double-click, a refresh, a closed
 * tab, or a re-login. These tests exercise the fix: an explicit
 * onboardingStatus/onboardingLockKey pair on the organization, checked
 * independently of the per-form-mount idempotency key.
 */
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { initializeDataSource } from '../database/data-source';
import { User, Organization, OrganizationMembership } from '../database/schema';
import { UserStatus, PlatformRole, AuditAction } from '../common/enums';
import { SecurityUtils } from '../common/utils/security.utils';
import { OrganizationsService } from '../modules/organizations/organizations.service';
import { dbStore } from '../database/store';

async function makeTestUser(label: string) {
  const dataSource = await initializeDataSource();
  const users = dataSource.getRepository(User);
  const email = `onboarding-dup-test-${label}-${uuidv4().slice(0, 8)}@partneriq.local`;
  const user = users.create({
    email,
    passwordHash: await SecurityUtils.hashPassword(uuidv4()),
    firstName: 'Test',
    lastName: label,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    platformRole: PlatformRole.USER,
    failedLoginAttempts: 0,
  });
  const saved = await users.save(user);
  dbStore.users.push(saved);
  return saved;
}

async function countOrgsFor(userId: string) {
  const dataSource = await initializeDataSource();
  return dataSource.getRepository(Organization).count({ where: { createdBy: userId } });
}

async function cleanup(userIds: string[]) {
  const dataSource = await initializeDataSource();
  const orgRepo = dataSource.getRepository(Organization);
  const membershipRepo = dataSource.getRepository(OrganizationMembership);
  const userRepo = dataSource.getRepository(User);
  for (const userId of userIds) {
    const orgs = await orgRepo.find({ where: { createdBy: userId } });
    for (const org of orgs) {
      await membershipRepo.delete({ organizationId: org.id });
      await orgRepo.delete({ id: org.id });
    }
    await userRepo.delete({ id: userId });
  }
}

async function runTests() {
  console.log('🧪 Starting Onboarding Duplicate-Org Regression Suite...\n');
  let passed = 0;
  let failed = 0;
  const testUserIds: string[] = [];

  function assertTest(condition: boolean, name: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name}`);
      failed++;
    }
  }

  await initializeDataSource();
  const service = new OrganizationsService();

  try {
    // 1. Refresh mid-onboarding -> same org.
    // Simulates: user submits step 1 (org created, IN_PROGRESS), then the tab
    // reloads before completeOnboarding() runs. A fresh form mount generates
    // a NEW idempotency key, but onboardingOrg() must still return the same org.
    {
      const user = await makeTestUser('refresh');
      testUserIds.push(user.id);

      const first = await service.onboardingOrg(user.id, {
        name: 'Refresh Test Org',
        idempotencyKey: uuidv4(), // form-mount #1
      } as any);

      const second = await service.onboardingOrg(user.id, {
        name: 'Refresh Test Org', // same wizard, re-entered after "refresh"
        idempotencyKey: uuidv4(), // form-mount #2 — deliberately different key
      } as any);

      assertTest(first.id === second.id, 'Refresh mid-onboarding resolves to the same organization');
      assertTest((await countOrgsFor(user.id)) === 1, 'Refresh mid-onboarding creates exactly one org row');
    }

    // 2. Re-login mid-onboarding -> same org.
    // Functionally identical to #1 from the service's point of view (there is
    // no "session" state involved server-side), but exercises the status
    // endpoint a resumed frontend would actually call.
    {
      const user = await makeTestUser('relogin');
      testUserIds.push(user.id);

      const first = await service.onboardingOrg(user.id, { name: 'Re-login Test Org' } as any);

      const status = await service.getOnboardingStatus(user.id);
      assertTest(status.inProgress === true, 'getOnboardingStatus reports in-progress after step 1');
      assertTest(status.organization?.id === first.id, 'getOnboardingStatus returns the in-progress org id');

      const second = await service.onboardingOrg(user.id, { name: 'Re-login Test Org' } as any);
      assertTest(first.id === second.id, 'Re-login mid-onboarding resolves to the same organization');
      assertTest((await countOrgsFor(user.id)) === 1, 'Re-login mid-onboarding creates exactly one org row');
    }

    // 3. Concurrent requests -> one org.
    // The scenario the original bug report was actually about: a fast
    // double-click firing two requests before either has committed.
    {
      const user = await makeTestUser('concurrent');
      testUserIds.push(user.id);

      const [a, b] = await Promise.all([
        service.onboardingOrg(user.id, { name: 'Concurrent Test Org', idempotencyKey: uuidv4() } as any),
        service.onboardingOrg(user.id, { name: 'Concurrent Test Org', idempotencyKey: uuidv4() } as any),
      ]);

      assertTest(a.id === b.id, 'Two concurrent onboarding requests resolve to the same organization');
      assertTest((await countOrgsFor(user.id)) === 1, 'Concurrent onboarding requests create exactly one org row');
    }

    // 4. Completed user creating a second org -> works (must not be blocked).
    // Multi-org ownership is a real, supported feature — the lock must only
    // ever apply while an onboarding is genuinely IN_PROGRESS.
    {
      const user = await makeTestUser('multiorg');
      testUserIds.push(user.id);

      const firstOrg = await service.onboardingOrg(user.id, { name: 'First Org' } as any);
      await service.completeOnboarding(firstOrg.id, user.id);

      const statusAfterComplete = await service.getOnboardingStatus(user.id);
      assertTest(statusAfterComplete.inProgress === false, 'No in-progress onboarding remains after completion');

      const secondOrg = await service.create(user.id, { name: 'Second Org (created later)' } as any);
      assertTest(
        secondOrg.id !== firstOrg.id,
        'A user who already completed onboarding can create a second, independent organization',
      );
      assertTest((await countOrgsFor(user.id)) === 2, 'Completed user ends up owning exactly two organizations');

      // And a THIRD onboarding attempt after completion must not be treated
      // as "still in progress" from the first org.
      const thirdViaOnboarding = await service.onboardingOrg(user.id, { name: 'Third Org via onboarding' } as any);
      assertTest(
        thirdViaOnboarding.id !== firstOrg.id && thirdViaOnboarding.id !== secondOrg.id,
        'A new onboarding attempt after completion creates a genuinely new organization, not a stale lock hit',
      );
    }

    // 5. DB-level guard actually exists (not just the application-level check).
    {
      const user = await makeTestUser('dblock');
      testUserIds.push(user.id);
      const org = await service.onboardingOrg(user.id, { name: 'DB Lock Test Org' } as any);

      const dataSource = await initializeDataSource();
      let threwUniqueViolation = false;
      try {
        // Attempt to insert a second IN_PROGRESS org for the same user by
        // going around the service entirely — this is what proves the
        // constraint is enforced by the database, not just application code.
        await dataSource.getRepository(Organization).save(
          dataSource.getRepository(Organization).create({
            id: uuidv4(),
            name: 'Bypass Attempt Org',
            slug: `bypass-${uuidv4().slice(0, 8)}`,
            country: 'US',
            defaultCurrency: 'INR',
            createdBy: user.id,
            onboardingStatus: 'IN_PROGRESS',
            onboardingLockKey: user.id, // same lock key as the org above
            onboardingStep: 1,
          }),
        );
      } catch (err: any) {
        threwUniqueViolation = err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;
      }
      assertTest(threwUniqueViolation, 'Database rejects a second IN_PROGRESS org for the same user at the constraint level');
      assertTest(!!org, 'First org from this block was created successfully');
    }

    // 6. Plain (non-wizard) create path still gets trial, default commission rule,
    // tier ladder, audit log, and welcome email.
    {
      const user = await makeTestUser('plaincreate');
      testUserIds.push(user.id);

      let trialStartedFor: string | null = null;
      let commissionRuleCreatedFor: string | null = null;
      let tiersSeededFor: string | null = null;
      let welcomeEmailSentTo: string | null = null;
      let notificationSentTo: string | null = null;

      const mockTrialService = {
        startTrial: async (orgId: string, uId: string, plan: string) => {
          trialStartedFor = orgId;
          dbStore.organizationTrials.push({
            id: uuidv4(),
            organizationId: orgId,
            planCode: plan,
            trialStartedAt: new Date(),
            trialEndsAt: new Date(Date.now() + 14 * 86400000),
            trialUsed: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any);
          return { success: true };
        },
      } as any;

      const mockCommissionsService = {
        createRule: async (orgId: string, dto: any) => {
          commissionRuleCreatedFor = orgId;
          dbStore.commissionRules.push({
            id: uuidv4(),
            organizationId: orgId,
            name: dto.name,
            priority: dto.priority,
            commissionType: dto.commissionType,
            commissionValue: dto.commissionValue,
            holdPeriodDays: dto.holdPeriodDays,
            status: 'ACTIVE',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any);
          return { id: 'rule-test' };
        },
      } as any;

      const mockTierService = {
        seedDefaultTiers: async (orgId: string, uId?: string) => {
          tiersSeededFor = orgId;
          dbStore.partnerTiers.push({
            id: uuidv4(),
            organizationId: orgId,
            name: 'Bronze',
            code: 'BRONZE',
            isDefault: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any);
        },
      } as any;

      const mockEmailDispatch = {
        send: async (templateKey: string, recipient: string, vars: any) => {
          welcomeEmailSentTo = recipient;
          return { success: true };
        },
      } as any;

      const mockNotificationsService = {
        createNotification: async (params: any) => {
          notificationSentTo = params.userId;
          return { id: 'notif-test' };
        },
      } as any;

      const plainService = new OrganizationsService(
        mockTrialService,
        mockEmailDispatch,
        mockNotificationsService,
        mockCommissionsService,
        mockTierService,
      );

      const org = await plainService.create(user.id, {
        name: 'Plain Non-Wizard Org',
      } as any);

      assertTest(org.onboardingStatus === 'COMPLETED', 'Plain create marks onboardingStatus as COMPLETED immediately');
      assertTest(!org.onboardingLockKey, 'Plain create leaves onboardingLockKey NULL');
      assertTest(trialStartedFor === org.id, 'Plain create starts the introductory trial');
      assertTest(commissionRuleCreatedFor === org.id, 'Plain create seeds the default commission rule');
      assertTest(tiersSeededFor === org.id, 'Plain create seeds the default tier ladder');

      const hasAuditLog = dbStore.auditLogs.some(
        (a) => a.organizationId === org.id && a.action === AuditAction.ORGANIZATION_CREATED,
      );
      assertTest(hasAuditLog, 'Plain create writes an ORGANIZATION_CREATED audit log entry');
      assertTest(welcomeEmailSentTo === user.email, 'Plain create dispatches a welcome email to the creator');
      assertTest(notificationSentTo === user.id, 'Plain create emits an in-app workspace ready notification');
    }
  } finally {
    await cleanup(testUserIds);
  }

  console.log(`\n📊 Onboarding Duplicate-Org Tests Complete: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
