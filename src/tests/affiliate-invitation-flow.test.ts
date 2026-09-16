/**
 * Affiliate invitation -> registration -> join flow.
 *
 * The rule under test: accepting an invitation must never create a program
 * membership before the partner has authenticated through the Affiliate Portal.
 * An invitation token proves an email was invited — it is not authentication.
 *
 * Runs against the in-memory dbStore with no database connection.
 *
 *   npm run test:invitations
 */
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../database/store';
import { SecurityUtils } from '../common/utils/security.utils';
import {
  AffiliateInvitationStatus,
  AffiliateStatus,
  EnvironmentType,
  OrganizationStatus,
  PlatformRole,
  ProgramStatus,
} from '../common/enums';
import { AffiliatesService } from '../modules/affiliates/affiliates.service';

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

async function assertRejects(work: () => Promise<unknown>, name: string, expectedCode?: string) {
  try {
    await work();
    assert(false, name, 'expected a rejection but the call succeeded');
  } catch (error) {
    const code = (error as any)?.response?.code || (error as any)?.response?.details?.code;
    if (!expectedCode || code === expectedCode) {
      assert(true, name);
    } else {
      assert(false, name, `expected ${expectedCode}, got ${code}: ${(error as any)?.message}`);
    }
  }
}

// The service only needs the collaborators these paths actually touch; the rest
// are optional constructor dependencies.
const affiliates = new AffiliatesService(
  { sendAffiliateInvitationEmail: async () => undefined } as any,
  { seedDefaultTiers: async () => undefined } as any,
  { trigger: async () => undefined, handleEvent: async () => undefined } as any,
);

function resetStore() {
  dbStore.users.length = 0;
  dbStore.organizations.length = 0;
  dbStore.programs.length = 0;
  dbStore.affiliates.length = 0;
  dbStore.affiliateInvitations.length = 0;
  dbStore.programAffiliates.length = 0;
  dbStore.affiliateTiers.length = 0;
  dbStore.partnerTiers.length = 0;
  dbStore.trackingLinks.length = 0;
  dbStore.auditLogs.length = 0;
}

function makeOrganization(name = 'ABC Brand') {
  const org = {
    id: uuidv4(),
    name,
    slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${uuidv4().slice(0, 4)}`,
    country: 'IN',
    defaultCurrency: 'INR',
    status: OrganizationStatus.ACTIVE,
    onboardingCompleted: true,
    createdBy: uuidv4(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
  dbStore.organizations.push(org);
  return org;
}

function makeProgram(organizationId: string, name = 'ABC Referral Program') {
  const program = {
    id: uuidv4(),
    organizationId,
    environment: EnvironmentType.LIVE,
    name,
    slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${uuidv4().slice(0, 4)}`,
    type: 'AFFILIATE',
    status: ProgramStatus.ACTIVE,
    currency: 'INR',
    commissionType: 'PERCENTAGE',
    defaultCommissionValue: 1500,
    attributionModel: 'LAST_CLICK',
    cookieDurationDays: 30,
    createdBy: uuidv4(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
  dbStore.programs.push(program);
  return program;
}

/** Creates an Affiliate Portal user account. */
function makePortalUser(email: string) {
  const user = {
    id: uuidv4(),
    email: email.toLowerCase().trim(),
    firstName: 'Partner',
    lastName: 'Person',
    passwordHash: 'x',
    status: 'ACTIVE',
    emailVerified: true,
    platformRole: PlatformRole.AFFILIATE,
    failedLoginAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
  dbStore.users.push(user);
  return user;
}

/** Creates an invitation exactly as `inviteAffiliate` would, returning the raw token. */
function makeInvitation(
  organizationId: string,
  programId: string,
  email: string,
  overrides: Record<string, unknown> = {},
) {
  const token = `${uuidv4()}${uuidv4()}`.replace(/-/g, '');
  const invitation = {
    id: uuidv4(),
    organizationId,
    environment: EnvironmentType.LIVE,
    programId,
    email: email.toLowerCase().trim(),
    partnerName: 'Invited Partner',
    status: AffiliateInvitationStatus.PENDING,
    tokenHash: SecurityUtils.hashToken(token),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    invitedBy: uuidv4(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
  dbStore.affiliateInvitations.push(invitation);
  return { invitation, token };
}

function membershipsFor(programId: string) {
  return dbStore.programAffiliates.filter((item) => item.programId === programId);
}

// ---------------------------------------------------------------------------

async function testTermsAcceptanceCreatesNothing() {
  console.log('\n🔒 Accepting terms must not create an affiliate or a membership\n');
  resetStore();
  const org = makeOrganization();
  const program = makeProgram(org.id);
  const { invitation, token } = makeInvitation(org.id, program.id, 'newpartner@example.com');

  const result = await affiliates.acceptAffiliateInvitationTerms(token, {
    acceptedTerms: true,
    termsVersionAccepted: 1,
  } as any);

  assert(dbStore.affiliates.length === 0, 'No affiliate record is created by accepting terms');
  assert(membershipsFor(program.id).length === 0, 'No program membership is created by accepting terms');
  assert(
    invitation.status === AffiliateInvitationStatus.TERMS_ACCEPTED,
    'Invitation moves to TERMS_ACCEPTED, not JOINED',
    invitation.status,
  );
  assert(Boolean(invitation.termsAcceptedAt), 'Terms acceptance timestamp is recorded');
  assert(!invitation.joinedAt, 'No join timestamp is recorded yet');
  assert(result.nextStep === 'REGISTER', 'A partner with no portal account is sent to registration');
  assert(
    result.email === 'newpartner@example.com',
    'The invited email is returned so the portal can pre-fill and lock it',
  );
  assert(
    result.redirectUrl.includes('/signup?invitationToken='),
    'The redirect carries the invitation token to the portal signup screen',
    result.redirectUrl,
  );

  // An existing portal account should be routed to sign-in instead.
  resetStore();
  const org2 = makeOrganization();
  const program2 = makeProgram(org2.id);
  makePortalUser('existing@example.com');
  const { token: token2 } = makeInvitation(org2.id, program2.id, 'existing@example.com');
  const result2 = await affiliates.acceptAffiliateInvitationTerms(token2, {
    acceptedTerms: true,
  } as any);
  assert(result2.nextStep === 'LOGIN', 'A partner who already has a portal account is sent to sign-in');
  assert(
    result2.redirectUrl.includes('/login?invitationToken='),
    'The sign-in redirect carries the invitation token',
  );
  assert(dbStore.affiliates.length === 0, 'Still no affiliate created for the existing-account path');
}

async function testNewAffiliateJoinsAfterRegistration() {
  console.log('\n✅ New affiliate: join happens only after authentication\n');
  resetStore();
  const org = makeOrganization('ABC Brand');
  const program = makeProgram(org.id, 'ABC Referral Program');
  const { invitation, token } = makeInvitation(org.id, program.id, 'newpartner@example.com');

  await affiliates.acceptAffiliateInvitationTerms(token, { acceptedTerms: true } as any);
  assert(membershipsFor(program.id).length === 0, 'Nothing joined before the account exists');

  // Registration creates the portal account; completion then joins them.
  const user = makePortalUser('newpartner@example.com');
  const result = await affiliates.completeAffiliateInvitation(token, user.id);

  assert(result.joined === true, 'Completion reports the partner as joined');
  assert(result.alreadyMember === false, 'A first completion is not reported as an existing membership');
  assert(dbStore.affiliates.length === 1, 'Exactly one affiliate record is created');
  assert(membershipsFor(program.id).length === 1, 'Exactly one program membership is created');
  assert(
    invitation.status === AffiliateInvitationStatus.JOINED,
    'Invitation reaches JOINED',
    invitation.status,
  );
  assert(Boolean(invitation.joinedAt), 'Join timestamp is recorded');
  assert(invitation.acceptedBy === user.id, 'The authenticated user is recorded as the acceptor');
  assert(invitation.affiliateId === dbStore.affiliates[0].id, 'Invitation links to the affiliate it produced');
  assert(
    dbStore.affiliates[0].userId === user.id,
    'The affiliate record is linked to the portal account',
  );
  assert(
    result.message.includes('ABC Brand') && result.message.includes('ABC Referral Program'),
    'The success message names the organization and program',
    result.message,
  );
}

async function testExistingAffiliateJoinsWithoutDuplicateAccount() {
  console.log('\n👤 Existing affiliate: no second account, membership added\n');
  resetStore();
  const org = makeOrganization('XYZ Brand');
  const firstProgram = makeProgram(org.id, 'XYZ Partner Program');
  const secondProgram = makeProgram(org.id, 'XYZ Influencer Program');
  const user = makePortalUser('veteran@example.com');

  // Already an affiliate of this organization, in one program.
  const existingAffiliate = {
    id: uuidv4(),
    organizationId: org.id,
    userId: user.id,
    displayName: 'Veteran Partner',
    email: 'veteran@example.com',
    country: 'IN',
    status: AffiliateStatus.ACTIVE,
    trustScore: 80,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
  dbStore.affiliates.push(existingAffiliate);
  dbStore.programAffiliates.push({
    id: uuidv4(),
    organizationId: org.id,
    environment: EnvironmentType.LIVE,
    programId: firstProgram.id,
    affiliateId: existingAffiliate.id,
    status: AffiliateStatus.ACTIVE,
    referralCode: 'existing1',
    joinedAt: new Date(),
  } as any);

  const { token } = makeInvitation(org.id, secondProgram.id, 'veteran@example.com');
  await affiliates.acceptAffiliateInvitationTerms(token, { acceptedTerms: true } as any);
  await affiliates.completeAffiliateInvitation(token, user.id);

  assert(dbStore.affiliates.length === 1, 'No duplicate affiliate account is created');
  assert(
    membershipsFor(secondProgram.id).length === 1,
    'The affiliate is added to the newly invited program',
  );
  assert(
    membershipsFor(firstProgram.id).length === 1,
    'The existing program membership is untouched',
  );
}

async function testEmailMismatchIsBlocked() {
  console.log('\n🚫 The invitation cannot be redeemed by a different email\n');
  resetStore();
  const org = makeOrganization();
  const program = makeProgram(org.id);
  const { token } = makeInvitation(org.id, program.id, 'john@example.com');
  await affiliates.acceptAffiliateInvitationTerms(token, { acceptedTerms: true } as any);

  const impostor = makePortalUser('another@example.com');
  await assertRejects(
    () => affiliates.completeAffiliateInvitation(token, impostor.id),
    'A different authenticated email cannot complete the invitation',
    'INVITATION_EMAIL_MISMATCH',
  );
  assert(membershipsFor(program.id).length === 0, 'No membership is created for the wrong account');
  assert(dbStore.affiliates.length === 0, 'No affiliate is created for the wrong account');
  assert(
    dbStore.auditLogs.some((item) => String(item.action) === 'AFFILIATE_INVITATION_EMAIL_MISMATCH'),
    'The mismatch attempt is audited',
  );

  // The rightful invitee still works afterwards.
  const rightful = makePortalUser('john@example.com');
  const ok = await affiliates.completeAffiliateInvitation(token, rightful.id);
  assert(ok.joined === true, 'The invited partner can still complete the invitation');
}

async function testDuplicateCompletionIsIdempotent() {
  console.log('\n🔁 Completing twice does not create a second membership\n');
  resetStore();
  const org = makeOrganization();
  const program = makeProgram(org.id);
  const { token } = makeInvitation(org.id, program.id, 'repeat@example.com');
  const user = makePortalUser('repeat@example.com');

  await affiliates.acceptAffiliateInvitationTerms(token, { acceptedTerms: true } as any);
  await affiliates.completeAffiliateInvitation(token, user.id);
  const second = await affiliates.completeAffiliateInvitation(token, user.id);

  assert(second.alreadyMember === true, 'The second completion reports an existing membership');
  assert(membershipsFor(program.id).length === 1, 'Still exactly one program membership');
  assert(dbStore.affiliates.length === 1, 'Still exactly one affiliate record');
}

async function testExpiredAndRevokedAreBlocked() {
  console.log('\n⛔ Expired, revoked and declined invitations are blocked\n');

  // Expired.
  resetStore();
  let org = makeOrganization();
  let program = makeProgram(org.id);
  let made = makeInvitation(org.id, program.id, 'late@example.com', {
    expiresAt: new Date(Date.now() - 1000),
  });
  await assertRejects(
    () => affiliates.acceptAffiliateInvitationTerms(made.token, { acceptedTerms: true } as any),
    'An expired invitation cannot have its terms accepted',
    'INVITATION_EXPIRED',
  );
  const expiredUser = makePortalUser('late@example.com');
  await assertRejects(
    () => affiliates.completeAffiliateInvitation(made.token, expiredUser.id),
    'An expired invitation cannot be completed even when authenticated',
    'INVITATION_EXPIRED',
  );
  assert(membershipsFor(program.id).length === 0, 'An expired invitation creates no membership');

  // Revoked.
  resetStore();
  org = makeOrganization();
  program = makeProgram(org.id);
  made = makeInvitation(org.id, program.id, 'revoked@example.com', {
    status: AffiliateInvitationStatus.REVOKED,
    revokedAt: new Date(),
  });
  const revokedUser = makePortalUser('revoked@example.com');
  await assertRejects(
    () => affiliates.acceptAffiliateInvitationTerms(made.token, { acceptedTerms: true } as any),
    'A revoked invitation cannot have its terms accepted',
    'INVITATION_REVOKED',
  );
  await assertRejects(
    () => affiliates.completeAffiliateInvitation(made.token, revokedUser.id),
    'A revoked invitation cannot be completed',
    'INVITATION_REVOKED',
  );
  assert(membershipsFor(program.id).length === 0, 'A revoked invitation creates no membership');

  // Declined.
  resetStore();
  org = makeOrganization();
  program = makeProgram(org.id);
  made = makeInvitation(org.id, program.id, 'declined@example.com', {
    status: AffiliateInvitationStatus.DECLINED,
  });
  const declinedUser = makePortalUser('declined@example.com');
  await assertRejects(
    () => affiliates.completeAffiliateInvitation(made.token, declinedUser.id),
    'A declined invitation cannot be completed',
    'INVITATION_DECLINED',
  );
}

async function testInactiveTargetsAreBlocked() {
  console.log('\n🏢 Inactive organizations and programs are blocked\n');

  resetStore();
  let org = makeOrganization();
  let program = makeProgram(org.id);
  program.status = ProgramStatus.PAUSED;
  let made = makeInvitation(org.id, program.id, 'paused@example.com');
  await assertRejects(
    () => affiliates.acceptAffiliateInvitationTerms(made.token, { acceptedTerms: true } as any),
    'A paused program cannot be joined',
  );

  resetStore();
  org = makeOrganization();
  org.status = OrganizationStatus.SUSPENDED;
  program = makeProgram(org.id);
  made = makeInvitation(org.id, program.id, 'suspended@example.com');
  await assertRejects(
    () => affiliates.acceptAffiliateInvitationTerms(made.token, { acceptedTerms: true } as any),
    'A suspended organization cannot be joined',
  );
}

async function testTermsMustBeAccepted() {
  console.log('\n📄 Terms are required\n');
  resetStore();
  const org = makeOrganization();
  const program = makeProgram(org.id);
  const { invitation, token } = makeInvitation(org.id, program.id, 'terms@example.com');

  await assertRejects(
    () => affiliates.acceptAffiliateInvitationTerms(token, { acceptedTerms: false } as any),
    'Terms must be accepted to proceed',
  );
  assert(
    invitation.status === AffiliateInvitationStatus.PENDING,
    'A refused acceptance leaves the invitation PENDING',
  );
}

async function testUnknownTokenIsRejected() {
  console.log('\n🔑 An unknown token grants nothing\n');
  resetStore();
  const org = makeOrganization();
  const program = makeProgram(org.id);
  makeInvitation(org.id, program.id, 'real@example.com');
  const stranger = makePortalUser('real@example.com');

  await assertRejects(
    () => affiliates.completeAffiliateInvitation('not-a-real-token', stranger.id),
    'A token that matches no invitation is rejected',
  );
  assert(membershipsFor(program.id).length === 0, 'No membership is created from an unknown token');
}

async function main() {
  console.log('\n🧪 PartnerIQ Affiliate Invitation Flow Suite');

  await testTermsAcceptanceCreatesNothing();
  await testNewAffiliateJoinsAfterRegistration();
  await testExistingAffiliateJoinsWithoutDuplicateAccount();
  await testEmailMismatchIsBlocked();
  await testDuplicateCompletionIsIdempotent();
  await testExpiredAndRevokedAreBlocked();
  await testInactiveTargetsAreBlocked();
  await testTermsMustBeAccepted();
  await testUnknownTokenIsRejected();

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
