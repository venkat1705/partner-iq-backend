import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { initializeDataSource } from '../../../database/data-source';
import { AffiliatesService } from '../affiliates.service';
import { Affiliate, AffiliateInvitation, AffiliatePortalProfile, AuditLog, User, UserIdentity } from '../../../database/schema';
import { dbStore, awaitPersist } from '../../../database/store';
import { AuditAction, PlatformRole, UserStatus } from '../../../common/enums';
import { SecurityUtils } from '../../../common/utils/security.utils';
import { safeReturnPath } from '../../../common/utils/safe-redirect.utils';
import { getAppConfig } from '../../../config/app.config';
import { AuthService } from '../../auth/auth.service';
import { GoogleOAuthService } from '../../auth/oauth/providers/google/google-oauth.service';
import { ExternalIdentity } from '../../auth/oauth/providers/oauth-provider.interface';
import { OAuthFlowType, OAuthStateService } from '../../auth/oauth/state/oauth-state.service';
import { assertUserEligibleForAffiliate } from '../affiliate-eligibility.policy';
import { SystemEmailDispatchService } from '../../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../../email-design/constants/email-template-keys';
import { NotificationsService } from '../../notifications/notifications.service';

export interface AffiliateRegisterPayload {
  fullName: string;
  email: string;
  password: string;
  partnerType?: string;
  website?: string;
  country?: string;
  referralCode?: string;
  termsAccepted?: boolean;
  /**
   * Set when the partner arrived from an organization's invitation email. The
   * registered email must match the invited address, and the invitation is
   * completed automatically once the account exists.
   */
  invitationToken?: string;
}

@Injectable()
export class AffiliateAuthService {
  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    @Inject(forwardRef(() => GoogleOAuthService))
    private readonly googleOAuthService: GoogleOAuthService,
    @Inject(forwardRef(() => OAuthStateService))
    private readonly stateService: OAuthStateService,
    @Inject(forwardRef(() => AffiliatesService))
    private readonly affiliatesService: AffiliatesService,
    @Optional() @Inject(forwardRef(() => SystemEmailDispatchService))
    private readonly emailDispatch?: SystemEmailDispatchService,
    @Optional() @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService?: NotificationsService,
  ) { }

  private async repositories() {
    const dataSource = await initializeDataSource();
    return {
      users: dataSource.getRepository(User),
      userIdentities: dataSource.getRepository(UserIdentity),
      affiliatePortalProfiles: dataSource.getRepository(AffiliatePortalProfile),
      affiliates: dataSource.getRepository(Affiliate),
      affiliateInvitations: dataSource.getRepository(AffiliateInvitation),
      auditLogs: dataSource.getRepository(AuditLog),
    };
  }

  async register(payload: AffiliateRegisterPayload, userAgent?: string, ipAddress?: string) {
    if (!payload?.termsAccepted) {
      throw new BadRequestException('Partner terms must be accepted.');
    }

    const normalizedEmail = payload.email.toLowerCase().trim();
    assertUserEligibleForAffiliate(normalizedEmail);

    // An invitation binds this registration to one address. Checking it before
    // the account is created means a mismatch leaves nothing behind, and the
    // check lives here rather than in the browser because that is the only
    // place it cannot be bypassed.
    if (payload.invitationToken) {
      const invitation = await this.affiliatesService.peekInvitationByToken(payload.invitationToken);
      const invitedEmail = invitation.email.toLowerCase().trim();
      if (invitedEmail !== normalizedEmail) {
        throw new BadRequestException({
          code: 'INVITATION_EMAIL_MISMATCH',
          message: 'Please use the email address that received this invitation.',
          details: { invitedEmail },
        });
      }
    }

    const { users } = await this.repositories();
    const existing = await users.findOne({ where: { email: normalizedEmail, deletedAt: IsNull() } });
    if (existing) {
      // An invited partner who already has a portal account should sign in and
      // have the invitation completed, not be told to go away.
      if (payload.invitationToken) {
        throw new BadRequestException({
          code: 'AFFILIATE_ACCOUNT_EXISTS',
          message: 'You already have a PartnerIQ affiliate account. Sign in to finish joining this program.',
          details: { email: normalizedEmail, shouldSignIn: true },
        });
      }
      throw new BadRequestException('User with this email already exists');
    }

    const nameParts = payload.fullName.trim().split(/\s+/);
    const createdUser = users.create({
      email: normalizedEmail,
      passwordHash: await SecurityUtils.hashPassword(payload.password),
      firstName: nameParts[0] || 'Partner',
      lastName: nameParts.slice(1).join(' ') || '',
      status: UserStatus.ACTIVE,
      emailVerified: false,
      platformRole: PlatformRole.AFFILIATE,
      failedLoginAttempts: 0,
    });
    const savedUser = await users.save(createdUser);
    if (!dbStore.users.some((item) => item.id === savedUser.id)) {
      dbStore.users.push(savedUser);
    }

    // The partner profile is created now so the account is complete the moment
    // the code is entered, but no session is issued until then.
    await this.ensureAffiliateProfile({
      userId: savedUser.id,
      email: normalizedEmail,
      fullName: payload.fullName,
      partnerType: payload.partnerType,
      country: payload.country,
      website: payload.website,
    });

    this.audit(savedUser.id, AuditAction.AFFILIATE_REGISTERED, 'affiliate_profile', savedUser.id, {
      source: 'AFFILIATE_REGISTER',
      partnerType: payload.partnerType,
      referralCode: payload.referralCode,
    });

    // Registration ends at the email-verification gate. The invitation token is
    // carried on the challenge rather than in the browser, so the program join
    // still happens on verification even if the partner finishes on another tab.
    const challenge = await this.authService.issueEmailOtpChallenge(savedUser, userAgent, ipAddress, {
      metadata: {
        portal: 'AFFILIATE',
        stage: 'registration',
        invitationToken: payload.invitationToken,
      },
    });

    return {
      requiresEmailVerification: true,
      challengeId: challenge.challengeId,
      userId: savedUser.id,
      email: savedUser.email,
      expiresAt: challenge.expiresAt,
      message: 'Account created. Enter the verification code we emailed you to continue.',
    };
  }

  /**
   * Finishes a registration or an unverified sign-in: verifies the emailed code,
   * issues the affiliate session, and runs the post-signup work that was held
   * back until the address was proven.
   */
  async verifyEmailOtp(challengeId: string, code: string, userAgent?: string, ipAddress?: string) {
    const result: any = await this.authService.verifyEmailOtp(challengeId, code, userAgent, ipAddress, {
      expectAffiliate: true,
    });

    const userId = result.user?.id;
    const email = (result.user?.email || '').toLowerCase().trim();

    if (userId && email) {
      await this.ensureAffiliateProfile({ userId, email });
    }

    // Only a registration that has just been verified gets the welcome mail; a
    // returning partner clearing the gate at sign-in has already had it.
    if (userId && result.verificationContext?.stage === 'registration') {
      const dashboardUrl = `${getAppConfig().affiliateFrontendUrl.replace(/\/$/, '')}/dashboard`;
      const firstName = result.user?.firstName || 'Partner';
      this.emailDispatch?.send(
        SystemTemplateKey.AFFILIATE_WELCOME,
        email,
        {
          affiliateName: firstName,
          organizationName: 'PartnerIQ',
          dashboardUrl,
          affiliate: { firstName },
          organization: { name: 'PartnerIQ' },
          links: { dashboardUrl },
        },
        { userId },
      ).catch(() => undefined);

      this.notificationsService?.createNotification({
        userId,
        type: 'system',
        title: 'Welcome to PartnerIQ',
        body: 'Your affiliate account is ready. Apply to a partner program to start earning.',
        channel: 'in_app',
        priority: 'normal',
        actionUrl: '/dashboard',
      }).catch(() => undefined);
    }

    const invitationToken = result.verificationContext?.invitationToken;
    const invitation = userId
      ? await this.affiliatesService.completeInvitationAfterAuth(invitationToken, userId)
      : undefined;

    const { verificationContext, ...tokens } = result;
    return { ...(await this.withAffiliateContext(tokens)), invitation };
  }

  /**
   * Re-sends the pending verification code. Cooldown and account-enumeration
   * handling both live in AuthService; this only pins the request to this portal.
   */
  async resendEmailOtp(challengeId?: string, email?: string, userAgent?: string, ipAddress?: string) {
    return this.authService.resendEmailOtp(challengeId, email, userAgent, ipAddress, {
      expectAffiliate: true,
    });
  }

  async login(
    email: string,
    password: string,
    userAgent?: string,
    ipAddress?: string,
    invitationToken?: string,
  ) {
    const normalizedEmail = email.toLowerCase().trim();
    const result = await this.authService.login(
      { email: normalizedEmail, password },
      userAgent,
      ipAddress,
      { allowAffiliate: true },
    );

    // Unverified account: AuthService has already raised (or re-sent) the email
    // challenge instead of issuing a session. Pin the invitation to that
    // challenge so verifying the code still joins the invited program.
    if ('requiresEmailVerification' in result) {
      if (invitationToken) {
        const { users } = await this.repositories();
        const user = await users.findOne({ where: { email: normalizedEmail, deletedAt: IsNull() } });
        if (user) {
          await this.authService.issueEmailOtpChallenge(user, userAgent, ipAddress, {
            metadata: { portal: 'AFFILIATE', stage: 'login', invitationToken },
          });
        }
      }
      return result;
    }

    if ('accessToken' in result) {
      const userId = (result as any).user?.id;
      if (userId) {
        await this.ensureAffiliateProfile({ userId, email: normalizedEmail });
      }

      // Existing affiliate arriving from an invitation link: no new account is
      // created, the invitation simply adds them to the invited program.
      if (invitationToken && userId) {
        const invitation = await this.affiliatesService.completeInvitationAfterAuth(
          invitationToken,
          userId,
        );
        return { ...(await this.withAffiliateContext(result)), invitation };
      }
    }

    return this.withAffiliateContext(result);
  }

  async refresh(refreshToken: string, userAgent?: string, ipAddress?: string) {
    const result = await this.authService.refreshToken(refreshToken, userAgent, ipAddress);
    assertUserEligibleForAffiliate(result.user.email);
    await this.ensureAffiliateProfile({ userId: result.user.id, email: result.user.email });
    return this.withAffiliateContext(result);
  }

  async logout(sessionId: string, userId: string) {
    return this.authService.logout(sessionId, userId);
  }

  async me(userId: string) {
    const base = await this.authService.getMe(userId);
    assertUserEligibleForAffiliate(base.email);
    await this.ensureAffiliateProfile({
      userId: base.id,
      email: base.email,
      fullName: `${base.firstName || ''} ${base.lastName || ''}`.trim(),
    });
    return this.toAffiliateMe(base);
  }

  async initiateGoogleAuth(query: { returnUrl?: string; flowType?: OAuthFlowType; invitationToken?: string }) {
    const config = getAppConfig();
    if (config.googleOAuthEnabled === false) {
      throw new BadRequestException('Google OAuth authentication is currently disabled.');
    }
    const clientId = config.googleAffiliateClientId || config.googleClientId;
    const clientSecret = config.googleAffiliateClientSecret || config.googleClientSecret;
    if (!clientId || !clientSecret) {
      throw new BadRequestException('Affiliate Google OAuth is not configured.');
    }

    const state = this.stateService.createState({
      flowType: query.flowType || 'LOGIN',
      returnUrl: this.sanitizeAffiliateReturnUrl(query.returnUrl),
      invitationToken: query.invitationToken,
    });

    const url = await this.googleOAuthService.getAuthorizationUrl({
      state: state.state,
      nonce: state.nonce,
      codeChallenge: state.codeChallenge,
      codeChallengeMethod: 'S256',
      redirectUri: config.googleAffiliateRedirectUri,
      clientId: clientId,
      prompt: 'select_account',
    });

    this.audit('unauthenticated', AuditAction.GOOGLE_LOGIN_STARTED, 'affiliate_oauth_flow', state.state.slice(0, 12), {
      flowType: state.flowType,
      hasInvitation: Boolean(query.invitationToken),
    });

    return { url, state: state.state };
  }

  async handleGoogleCallback(query: { code?: string; state?: string; error?: string }) {
    if (query.error) {
      throw new UnauthorizedException(query.error);
    }
    if (!query.code || !query.state) {
      throw new BadRequestException('OAuth code and state are required.');
    }

    const state = this.stateService.consumeState(query.state);
    if (!state) {
      throw new UnauthorizedException('Your Google sign-in session expired. Please try again.');
    }

    const config = getAppConfig();
    const clientId = config.googleAffiliateClientId || config.googleClientId;
    const clientSecret = config.googleAffiliateClientSecret || config.googleClientSecret;

    const tokens = await this.googleOAuthService.exchangeCode({
      code: query.code,
      codeVerifier: state.codeVerifier,
      redirectUri: config.googleAffiliateRedirectUri,
      clientId: clientId,
      clientSecret: clientSecret,
    });
    const identity = await this.googleOAuthService.verifyAndExtractIdentity(
      tokens,
      state.nonce,
      clientId,
    );

    if (!identity.emailVerified) {
      throw new UnauthorizedException('Google email must be verified to access the affiliate portal.');
    }

    assertUserEligibleForAffiliate(identity.email);

    // A Google sign-in that came from an invitation link must be the invited
    // person. Checked before the account is created or linked, so signing in
    // with the wrong Google account leaves nothing behind.
    if (state.invitationToken) {
      const invitation = await this.affiliatesService.peekInvitationByToken(state.invitationToken);
      const invitedEmail = invitation.email.toLowerCase().trim();
      if (invitedEmail !== identity.email.toLowerCase().trim()) {
        throw new ForbiddenException({
          code: 'INVITATION_EMAIL_MISMATCH',
          message: 'Please use the email address that received this invitation.',
          details: { invitedEmail },
        });
      }
    }

    const { user, isNewUser } = await this.resolveOrCreateGoogleUser(identity);
    await this.ensureAffiliateProfile({
      userId: user.id,
      email: user.email,
      fullName: identity.displayName,
    });

    const session = await this.authService.createSessionAndTokens(user);
    this.audit(user.id, isNewUser ? AuditAction.GOOGLE_ACCOUNT_CREATED : AuditAction.GOOGLE_LOGIN_SUCCESS, 'affiliate_user', user.id, {
      email: user.email,
      isNewUser,
    });

    // The partner is authenticated now, so the invitation can be completed and
    // the membership created.
    const invitation = await this.affiliatesService.completeInvitationAfterAuth(
      state.invitationToken,
      user.id,
    );

    return {
      ...(await this.withAffiliateContext(session)),
      returnUrl: this.sanitizeAffiliateReturnUrl(state.returnUrl) || '/dashboard',
      isNewUser,
      invitation,
    };
  }

  getGoogleStatus() {
    const config = getAppConfig();
    return {
      enabled: config.googleOAuthEnabled,
      configured: Boolean(config.googleAffiliateClientId && config.googleAffiliateClientSecret),
      clientIdConfigured: Boolean(config.googleAffiliateClientId),
      redirectUriConfigured: Boolean(config.googleAffiliateRedirectUri),
      redirectUri: config.googleAffiliateRedirectUri,
    };
  }

  private async resolveOrCreateGoogleUser(identity: ExternalIdentity): Promise<{ user: User; isNewUser: boolean }> {
    const { users, userIdentities } = await this.repositories();
    const normalizedEmail = identity.email.toLowerCase().trim();

    const existingIdentity = await userIdentities.findOne({
      where: { provider: identity.provider, providerUserId: identity.providerUserId },
    });
    if (existingIdentity) {
      const user = await users.findOne({ where: { id: existingIdentity.userId, deletedAt: IsNull() } });
      if (user) {
        existingIdentity.email = normalizedEmail;
        existingIdentity.emailVerified = identity.emailVerified;
        existingIdentity.lastLoginAt = new Date();
        await userIdentities.save(existingIdentity);
        return { user, isNewUser: false };
      }
    }

    const existingUser = await users.findOne({ where: { email: normalizedEmail, deletedAt: IsNull() } });
    if (existingUser) {
      const linked = userIdentities.create({
        userId: existingUser.id,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        email: normalizedEmail,
        emailVerified: true,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        providerMetadata: identity.metadata,
        linkedAt: new Date(),
        lastLoginAt: new Date(),
      });
      const savedIdentity = await userIdentities.save(linked);
      if (!dbStore.userIdentities.some((item) => item.id === savedIdentity.id)) {
        dbStore.userIdentities.push(savedIdentity);
      }
      existingUser.emailVerified = true;
      if (existingUser.platformRole === PlatformRole.USER) {
        existingUser.platformRole = PlatformRole.AFFILIATE;
      }
      await users.save(existingUser);
      const storeUser = dbStore.users.find((u) => u.id === existingUser.id);
      if (storeUser && storeUser.platformRole === PlatformRole.USER) {
        storeUser.platformRole = PlatformRole.AFFILIATE;
        await awaitPersist(storeUser);
      }
      return { user: existingUser, isNewUser: false };
    }

    const user = users.create({
      email: normalizedEmail,
      firstName: identity.firstName || 'Partner',
      lastName: identity.lastName || '',
      avatarUrl: identity.avatarUrl,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      platformRole: PlatformRole.AFFILIATE,
      failedLoginAttempts: 0,
    });
    const savedUser = await users.save(user);
    if (!dbStore.users.some((item) => item.id === savedUser.id)) {
      dbStore.users.push(savedUser);
    }

    const linked = userIdentities.create({
      userId: savedUser.id,
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      email: normalizedEmail,
      emailVerified: true,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      providerMetadata: identity.metadata,
      linkedAt: new Date(),
      lastLoginAt: new Date(),
    });
    const savedIdentity = await userIdentities.save(linked);
    if (!dbStore.userIdentities.some((item) => item.id === savedIdentity.id)) {
      dbStore.userIdentities.push(savedIdentity);
    }

    return { user: savedUser, isNewUser: true };
  }

  private async withAffiliateContext(result: any) {
    if (!result || !('accessToken' in result)) {
      return result;
    }

    const userId = result.user?.id || result.userId;
    const email = result.user?.email || result.email;
    return {
      ...result,
      affiliate: userId && email ? await this.getAffiliateContext(userId, email) : undefined,
    };
  }

  private async toAffiliateMe(user: any) {
    const { userIdentities } = await this.repositories();
    const googleIdentity = user.id
      ? await userIdentities.findOne({ where: { userId: user.id, provider: 'GOOGLE' } })
      : null;

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      avatarUrl: user.avatarUrl,
      platformRole: user.platformRole,
      emailVerified: user.emailVerified,
      mfaEnabled: Boolean(user.mfa?.enabled),
      googleConnected: Boolean(googleIdentity),
      hasPassword: Boolean(user.passwordHash),
      affiliate: await this.getAffiliateContext(user.id, user.email),
    };
  }

  private async getAffiliateContext(userId: string, email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const { affiliates, affiliateInvitations } = await this.repositories();

    const affiliateRows = await affiliates
      .createQueryBuilder('affiliate')
      .where('LOWER(affiliate.email) = :email', { email: normalizedEmail })
      .getMany();

    const pendingInvitations = await affiliateInvitations
      .createQueryBuilder('inv')
      .where('LOWER(inv.email) = :email', { email: normalizedEmail })
      .andWhere("inv.status = 'PENDING'")
      .andWhere('inv.revokedAt IS NULL')
      .andWhere('inv.expiresAt > :now', { now: new Date() })
      .getMany();

    const storedProfile = await this.ensureAffiliateProfile({ userId, email });
    const isOnboarded = Boolean(
      storedProfile.onboardingCompleted ?? (storedProfile.primaryMarket && (storedProfile.bio || storedProfile.website))
    );

    return {
      profile: {
        id: storedProfile.id,
        userId,
        website: storedProfile.website || '',
        // Serialized as stored. An unset field is reported as unset rather than
        // being filled in with a plausible-looking guess.
        country: storedProfile.country || '',
        partnerType: storedProfile.partnerType || 'AFFILIATE',
        primaryMarket: storedProfile.primaryMarket || '',
        audienceSize: storedProfile.audienceSize || '',
        socialProfiles: storedProfile.socialProfiles || {},
        bio: storedProfile.bio || '',
        onboardingCompleted: isOnboarded,
        createdAt: storedProfile.createdAt || new Date().toISOString(),
      },
      partnershipsCount: affiliateRows.length,
      pendingInvitationsCount: pendingInvitations.length,
      pendingInvitations: pendingInvitations.map((item) => ({
        id: item.id,
        organizationId: item.organizationId,
        programId: item.programId,
        email: item.email,
        status: item.status,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
      })),
    };
  }

  private async ensureAffiliateProfile(input: {
    userId: string;
    email: string;
    fullName?: string;
    partnerType?: string;
    country?: string;
    website?: string;
  }): Promise<AffiliatePortalProfile> {
    const { affiliatePortalProfiles } = await this.repositories();
    const existing = await affiliatePortalProfiles.findOne({ where: { userId: input.userId } });
    if (existing) {
      let changed = false;
      if (existing.email !== input.email.toLowerCase().trim()) {
        existing.email = input.email.toLowerCase().trim();
        changed = true;
      }
      if (input.fullName && !existing.fullName) {
        existing.fullName = input.fullName;
        changed = true;
      }
      if (input.partnerType && !existing.partnerType) {
        existing.partnerType = input.partnerType;
        changed = true;
      }
      if (input.country && !existing.country) {
        existing.country = input.country;
        changed = true;
      }
      if (input.website && !existing.website) {
        existing.website = input.website;
        changed = true;
      }
      return changed ? await affiliatePortalProfiles.save(existing) : existing;
    }

    // Only what the partner actually gave us. Seeding a new profile with
    // 'India' and '0-1k' wrote figures into the database that the partner never
    // entered, and the profile screen then showed them as if they had — there
    // was no way to tell a real answer from an invented one. Unknown fields stay
    // empty so onboarding can ask for them.
    const created = affiliatePortalProfiles.create({
      userId: input.userId,
      email: input.email.toLowerCase().trim(),
      fullName: input.fullName,
      // A genuine system default: every portal account is an affiliate.
      partnerType: input.partnerType || 'AFFILIATE',
      country: input.country || '',
      website: input.website || '',
      primaryMarket: '',
      audienceSize: '',
      socialProfiles: {},
      bio: '',
      onboardingCompleted: false,
      // Tax details drive withholding, so they are never guessed. These stay
      // blank and unverified until the partner submits them.
      taxCountry: input.country || '',
      panOrTaxId: '',
      taxClassification: '',
      withholdingRate: 0,
      taxVerified: false,
      taxFormType: '',
    });
    return await affiliatePortalProfiles.save(created);
  }

  async forgotPassword(email: string) {
    return this.authService.forgotPassword(email, 'affiliate');
  }

  async verifyResetToken(token: string) {
    return this.authService.verifyResetToken(token);
  }

  async resetPassword(dto: { token: string; newPassword: string }) {
    return this.authService.resetPassword(dto);
  }

  /**
   * This check was already correct; it now delegates to the shared validator so
   * the affiliate and organization OAuth flows use one implementation and cannot
   * drift apart again (they had, in three different directions).
   */
  private sanitizeAffiliateReturnUrl(value?: string) {
    return safeReturnPath(value, '/dashboard');
  }

  private async audit(actorId: string, action: AuditAction, resourceType: string, resourceId: string, metadata?: Record<string, any>) {
    try {
      const { auditLogs } = await this.repositories();
      const log = auditLogs.create({
        id: uuidv4(),
        actorType: actorId === 'unauthenticated' ? 'system' : 'user',
        actorId,
        action,
        resourceType,
        resourceId,
        metadata: SecurityUtils.sanitizeForLogging(metadata),
        createdAt: new Date(),
      } as any);
      await auditLogs.save(log);
    } catch {
      // Non-critical audit logging failure fallback
      if (dbStore.auditLogs) {
        dbStore.auditLogs.unshift({
          id: uuidv4(),
          actorType: actorId === 'unauthenticated' ? 'system' : 'user',
          actorId,
          action,
          resourceType,
          resourceId,
          metadata: SecurityUtils.sanitizeForLogging(metadata),
          createdAt: new Date(),
        } as any);
      }
    }
  }
}
