import { OAuthService } from '../modules/auth/oauth/oauth.service';
import { GoogleOAuthService } from '../modules/auth/oauth/providers/google/google-oauth.service';
import { OAuthStateService } from '../modules/auth/oauth/state/oauth-state.service';
import { AuthService } from '../modules/auth/auth.service';
import { RiskEngineService } from '../modules/auth/risk-engine.service';
import { MembershipsService } from '../modules/memberships/memberships.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { runSeed } from '../database/seeds/run-seed';
import { dbStore } from '../database/store';
import { User, UserIdentity } from '../database/schema';
import { initializeDataSource } from '../database/data-source';
import { AuditAction, PlatformRole, Role, UserStatus } from '../common/enums';
import { SecurityUtils } from '../common/utils/security.utils';
import { v4 as uuidv4 } from 'uuid';

async function runOAuthTests() {
  console.log('🧪 Running PartnerIQ Enterprise-Grade Google OAuth Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Initialize Seed Data & Repositories
  const { admin, org } = await runSeed();
  await dbStore.initialize();
  const dataSource = await initializeDataSource();
  const userRepo = dataSource.getRepository(User);
  const identityRepo = dataSource.getRepository(UserIdentity);

  // Setup services with mocked Google OAuth token exchange & verifier
  const googleOAuthService = new GoogleOAuthService();
  const stateService = new OAuthStateService();
  const riskEngineService = new RiskEngineService();
  const authService = new AuthService(riskEngineService);
  const notificationGateway = { broadcastToUser: () => {} } as any;
  const notificationsService = new NotificationsService(notificationGateway);
  const membershipsService = new MembershipsService({ sendInvitationEmail: async () => {} } as any);

  const oauthService = new OAuthService(
    googleOAuthService,
    stateService,
    authService,
    membershipsService,
    notificationsService,
  );

  // Helper to mock Google OAuth exchange & verification for a given identity
  let mockIdentity: any = null;
  googleOAuthService.exchangeCode = async (input: any) => {
    if (input.code === 'invalid_code') {
      throw new Error('Invalid code');
    }
    return {
      accessToken: 'mock_google_access_token',
      idToken: 'mock_google_id_token',
      tokenType: 'Bearer',
      expiresIn: 3600,
    };
  };

  googleOAuthService.verifyAndExtractIdentity = async (tokens: any, expectedNonce?: string) => {
    if (!mockIdentity) {
      throw new Error('Mock identity not set');
    }
    if (mockIdentity.nonce && expectedNonce && mockIdentity.nonce !== expectedNonce) {
      throw new Error('Nonce mismatch');
    }
    return mockIdentity;
  };

  // --- Test 1: New User Google Registration ---
  console.log('--- 1. New User Google Signup Flow ---');
  const googleSub1 = `google_sub_${uuidv4().slice(0, 8)}`;
  const newUserEmail = `newuser_${uuidv4().slice(0, 6)}@acme.com`;
  mockIdentity = {
    provider: 'GOOGLE',
    providerUserId: googleSub1,
    email: newUserEmail,
    emailVerified: true,
    displayName: 'Alice Engineer',
    firstName: 'Alice',
    lastName: 'Engineer',
    avatarUrl: 'https://lh3.googleusercontent.com/a/alice-avatar',
  };

  const initReg = await oauthService.initiateGoogleAuth({ flowType: 'REGISTER', returnUrl: '/onboarding' });
  assert(initReg.url.includes('accounts.google.com') && initReg.url.includes('code_challenge='), 'Authorization URL generated with PKCE & OpenID scopes');

  const regResult: any = await oauthService.handleGoogleCallback({
    code: 'valid_auth_code_1',
    state: initReg.state,
  });

  assert(Boolean(regResult.accessToken && regResult.refreshToken), 'PartnerIQ Session & JWT Tokens Issued on Registration');
  assert(regResult.isNewUser === true, 'New User Flag Correctly Set to true');
  assert(regResult.user.email === newUserEmail, 'User Created with Correct Normalized Email');

  const createdUser = await userRepo.findOne({ where: { email: newUserEmail } });
  assert(Boolean(createdUser && createdUser.emailVerified && !createdUser.passwordHash), 'User Record Persisted with Verified Email & Nullable Password');

  const createdIdentity = await identityRepo.findOne({ where: { provider: 'GOOGLE', providerUserId: googleSub1 } });
  assert(Boolean(createdIdentity && createdIdentity.userId === createdUser?.id), 'UserIdentity Record Persisted with Stable Google sub claim');

  // --- Test 2: Existing Google User Login via Stable Sub ---
  console.log('\n--- 2. Existing Google User Login Flow ---');
  const initLogin = await oauthService.initiateGoogleAuth({ flowType: 'LOGIN', returnUrl: '/app/dashboard' });
  const loginResult: any = await oauthService.handleGoogleCallback({
    code: 'valid_auth_code_2',
    state: initLogin.state,
  });

  assert(loginResult.isNewUser === false, 'Existing User Correctly Identified (isNewUser = false)');
  assert(loginResult.user.id === createdUser?.id, 'Authenticated Correct User by Stable Sub Claim');
  assert(loginResult.returnUrl === '/app/dashboard', 'Post-Auth Return URL Preserved');

  // --- Test 3: Account Linking (Existing Password User connects Google) ---
  console.log('\n--- 3. Account Linking (Existing Password User) ---');
  const existingPasswordEmail = `password_user_${uuidv4().slice(0, 6)}@acme.com`;
  const passwordUserReg = await authService.register({
    email: existingPasswordEmail,
    password: 'SecurePassword123!',
    firstName: 'Bob',
    lastName: 'Builder',
  });

  const googleSubBob = `google_sub_${uuidv4().slice(0, 8)}`;
  mockIdentity = {
    provider: 'GOOGLE',
    providerUserId: googleSubBob,
    email: existingPasswordEmail,
    emailVerified: true,
    displayName: 'Bob Builder',
    firstName: 'Bob',
    lastName: 'Builder',
  };

  const initLink = await oauthService.initiateGoogleAuth(
    { flowType: 'LINK_ACCOUNT', returnUrl: '/app/settings' },
    passwordUserReg.userId,
  );

  const linkResult: any = await oauthService.handleGoogleCallback({
    code: 'valid_auth_code_bob',
    state: initLink.state,
  });

  assert(linkResult.linked === true, 'Google Account Linked to Existing Password User');
  const bobIdentities = await oauthService.getUserIdentities(passwordUserReg.userId);
  assert(bobIdentities.identities.length === 1 && bobIdentities.hasPassword === true, 'Identities View Shows Google Connected + Password Active');

  // --- Test 4: Disconnect Google when Password Exists ---
  console.log('\n--- 4. Disconnect Google Account with Password Available ---');
  const bobIdentityId = bobIdentities.identities[0].id;
  const unlinkRes = await oauthService.unlinkIdentity(passwordUserReg.userId, bobIdentityId);
  assert(unlinkRes.success === true, 'Google Disconnected Successfully when Password Exists');

  const bobIdentitiesAfter = await oauthService.getUserIdentities(passwordUserReg.userId);
  assert(bobIdentitiesAfter.identities.length === 0, 'Google Identity Removed from User');

  // --- Test 5: Lockout Prevention (Cannot Disconnect Only Login Method) ---
  console.log('\n--- 5. Lockout Prevention Defense ---');
  // Alice only has Google login (no password)
  const aliceIdentities = await oauthService.getUserIdentities(createdUser!.id);
  assert(aliceIdentities.hasPassword === false && aliceIdentities.identities.length === 1, 'Alice has only Google login method');

  try {
    await oauthService.unlinkIdentity(createdUser!.id, aliceIdentities.identities[0].id);
    assert(false, 'Should block unlinking only login method');
  } catch (err: any) {
    assert(err.message.includes('only login method'), 'Lockout Prevention Succeeded: Blocked unlinking only login method');
  }

  // --- Test 6: Set Password for Google-Only Account ---
  console.log('\n--- 6. Set Password for Google-Only Account ---');
  const setPassRes = await oauthService.setPassword(createdUser!.id, { password: 'NewSecurePassword123!' });
  assert(setPassRes.success === true, 'Password Set Successfully for Google-only user');

  const aliceIdentitiesWithPassword = await oauthService.getUserIdentities(createdUser!.id);
  assert(aliceIdentitiesWithPassword.hasPassword === true, 'User now has both Google and Password login methods');

  // Now Alice can safely unlink Google
  const aliceUnlinkRes = await oauthService.unlinkIdentity(createdUser!.id, aliceIdentities.identities[0].id);
  assert(aliceUnlinkRes.success === true, 'Google Unlinked Successfully after setting password');

  // --- Test 7: Organization Invitation Matching ---
  console.log('\n--- 7. Organization Invitation Acceptance with Google ---');
  const inviteEmail = `invitee_${uuidv4().slice(0, 6)}@acme.com`;
  const inviteRes = await membershipsService.inviteMember(org.id, admin.id, {
    email: inviteEmail,
    role: Role.PROGRAM_MANAGER,
  });

  const inviteToken = inviteRes.token || inviteRes.inviteUrl?.split('token=')[1] || '';
  const googleSubInvitee = `google_sub_${uuidv4().slice(0, 8)}`;
  mockIdentity = {
    provider: 'GOOGLE',
    providerUserId: googleSubInvitee,
    email: inviteEmail,
    emailVerified: true,
    displayName: 'Invited Colleague',
    firstName: 'Invited',
    lastName: 'Colleague',
  };

  const initInviteAuth = await oauthService.initiateGoogleAuth({
    flowType: 'ACCEPT_INVITATION',
    invitationToken: inviteToken,
    returnUrl: '/app/dashboard',
  });

  const inviteAuthRes: any = await oauthService.handleGoogleCallback({
    code: 'valid_auth_code_invite',
    state: initInviteAuth.state,
  });

  assert(inviteAuthRes.flowType === 'ACCEPT_INVITATION', 'Invitation Flow Type Processed');
  const memberships = await membershipsService.getMembers(org.id);
  const newMember = memberships.find((m) => m.email === inviteEmail);
  assert(Boolean(newMember && newMember.role === Role.PROGRAM_MANAGER), 'User Automatically Joined Organization with Invited Role');

  // --- Test 8: Organization Invitation Email Mismatch Rejection ---
  console.log('\n--- 8. Organization Invitation Email Mismatch Defense ---');
  const inviteEmail2 = `target_invite_${uuidv4().slice(0, 6)}@acme.com`;
  const inviteRes2 = await membershipsService.inviteMember(org.id, admin.id, {
    email: inviteEmail2,
    role: Role.VIEWER,
  });
  const inviteToken2 = inviteRes2.token || inviteRes2.inviteUrl?.split('token=')[1] || '';

  // Attacker tries to accept target's invitation with different Google email
  mockIdentity = {
    provider: 'GOOGLE',
    providerUserId: `google_attacker_${uuidv4().slice(0, 6)}`,
    email: 'attacker@evil.com',
    emailVerified: true,
    displayName: 'Attacker',
    firstName: 'Attacker',
    lastName: 'Evil',
  };

  const initInviteMismatch = await oauthService.initiateGoogleAuth({
    flowType: 'ACCEPT_INVITATION',
    invitationToken: inviteToken2,
  });

  try {
    await oauthService.handleGoogleCallback({
      code: 'valid_code_attacker',
      state: initInviteMismatch.state,
    });
    assert(false, 'Should reject invitation email mismatch');
  } catch (err: any) {
    assert(err.message.includes(inviteEmail2), 'Invitation Email Mismatch Blocked: Displayed expected target email');
  }

  // --- Test 9: OAuth Single-Use State & Replay Protection ---
  console.log('\n--- 9. Single-Use OAuth State Replay Protection ---');
  const initState = await oauthService.initiateGoogleAuth({ flowType: 'LOGIN' });
  mockIdentity = {
    provider: 'GOOGLE',
    providerUserId: `google_sub_${uuidv4().slice(0, 8)}`,
    email: `replay_${uuidv4().slice(0, 6)}@acme.com`,
    emailVerified: true,
    displayName: 'Replay User',
    firstName: 'Replay',
    lastName: 'User',
  };

  // First callback: success
  await oauthService.handleGoogleCallback({ code: 'code1', state: initState.state });

  // Second callback with same state: must be rejected
  try {
    await oauthService.handleGoogleCallback({ code: 'code1', state: initState.state });
    assert(false, 'State replay should have thrown UnauthorizedException');
  } catch (err: any) {
    assert(err.message.includes('expired or was already used'), 'State Replay Blocked: Atomic single-use state consumption passed');
  }

  // --- Test 10: Open Redirect Attack Defense ---
  console.log('\n--- 10. Open Redirect Defense ---');
  const test1 = stateService.sanitizeReturnUrl('https://evil.com/phish');
  assert(test1 === '/app/dashboard', 'Absolute external URL neutralized to /app/dashboard');

  const test2 = stateService.sanitizeReturnUrl('//evil.com/phish');
  assert(test2 === '/app/dashboard', 'Protocol-relative URL neutralized to /app/dashboard');

  const test3 = stateService.sanitizeReturnUrl('/\\evil.com');
  assert(test3 === '/app/dashboard', 'Backslash URL neutralized to /app/dashboard');

  const test4 = stateService.sanitizeReturnUrl('/app/programs/new');
  assert(test4 === '/app/programs/new', 'Valid internal relative return URL permitted');

  // --- Test 11: Suspended User Authentication Rejection ---
  console.log('\n--- 11. Suspended / Inactive User Login Block ---');
  const suspendedEmail = `suspended_${uuidv4().slice(0, 6)}@acme.com`;
  const suspendedUser = userRepo.create({
    email: suspendedEmail,
    firstName: 'Suspended',
    lastName: 'User',
    status: UserStatus.INACTIVE,
    emailVerified: true,
  });
  await userRepo.save(suspendedUser);

  mockIdentity = {
    provider: 'GOOGLE',
    providerUserId: `sub_suspended_${uuidv4().slice(0, 6)}`,
    email: suspendedEmail,
    emailVerified: true,
    displayName: 'Suspended User',
    firstName: 'Suspended',
    lastName: 'User',
  };

  const initSuspendedAuth = await oauthService.initiateGoogleAuth({ flowType: 'LOGIN' });
  try {
    await oauthService.handleGoogleCallback({ code: 'code_suspended', state: initSuspendedAuth.state });
    assert(false, 'Inactive/Suspended user should have been rejected');
  } catch (err: any) {
    assert(err.message.includes('inactive'), 'Suspended User Blocked with Safe Message');
  }

  // --- Test 12: Security Log Redaction ---
  console.log('\n--- 12. Security Log Redaction ---');
  const logPayload = {
    code: 'google_authorization_code_4_p9k123',
    accessToken: 'ya29.a0AfH6SMB...',
    refreshToken: '1//0gJ7...',
    clientSecret: 'GOCSPX-secret_123',
    user: { email: 'test@partneriq.demo', passwordHash: '$2a$12$hash...' },
  };
  const sanitized = SecurityUtils.sanitizeForLogging(logPayload);
  assert(sanitized.code === '[REDACTED]', 'OAuth Authorization Code Redacted from Logs');
  assert(sanitized.accessToken === '[REDACTED]', 'Access Token Redacted from Logs');
  assert(sanitized.refreshToken === '[REDACTED]', 'Refresh Token Redacted from Logs');
  assert(sanitized.clientSecret === '[REDACTED]', 'Client Secret Redacted from Logs');
  assert(sanitized.user.passwordHash === '[REDACTED]', 'Password Hash Redacted from Logs');

  console.log('\n========================================================');
  console.log(`🛡️  GOOGLE OAUTH TEST SUITE: ${passed} Passed, ${failed} Failed`);
  console.log('========================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runOAuthTests().catch((err) => {
  console.error('OAuth test suite error:', err);
  process.exit(1);
});
