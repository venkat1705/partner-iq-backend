import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { initializeDataSource } from '../../../database/data-source';
import { AffiliatePortalProfile, User, UserIdentity } from '../../../database/schema';
import { dbStore } from '../../../database/store';
import { AuditAction, PlatformRole, UserStatus } from '../../../common/enums';
import { SecurityUtils } from '../../../common/utils/security.utils';
import { getAppConfig } from '../../../config/app.config';
import { AuthService } from '../../auth/auth.service';
import { GoogleOAuthService } from '../../auth/oauth/providers/google/google-oauth.service';
import { ExternalIdentity } from '../../auth/oauth/providers/oauth-provider.interface';
import { OAuthFlowType, OAuthStateService } from '../../auth/oauth/state/oauth-state.service';
import { assertUserEligibleForAffiliate } from '../affiliate-eligibility.policy';

export interface AffiliateRegisterPayload {
  fullName: string;
  email: string;
  password: string;
  partnerType?: string;
  website?: string;
  country?: string;
  referralCode?: string;
  termsAccepted?: boolean;
}

@Injectable()
export class AffiliateAuthService {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly stateService: OAuthStateService,
  ) { }

  private async repositories() {
    const dataSource = await initializeDataSource();
    return {
      users: dataSource.getRepository(User),
      userIdentities: dataSource.getRepository(UserIdentity),
      affiliatePortalProfiles: dataSource.getRepository(AffiliatePortalProfile),
    };
  }

  async register(payload: AffiliateRegisterPayload, userAgent?: string, ipAddress?: string) {
    if (!payload?.termsAccepted) {
      throw new BadRequestException('Partner terms must be accepted.');
    }

    const normalizedEmail = payload.email.toLowerCase().trim();
    assertUserEligibleForAffiliate(normalizedEmail);

    const { users } = await this.repositories();
    const existing = await users.findOne({ where: { email: normalizedEmail, deletedAt: IsNull() } });
    if (existing) {
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
    const result = await this.authService.createSessionAndTokens(savedUser, userAgent, ipAddress);

    await this.ensureAffiliateProfile({
      userId: savedUser.id,
      email: normalizedEmail,
      fullName: payload.fullName,
      partnerType: payload.partnerType,
      country: payload.country,
      website: payload.website,
    });

    this.audit(savedUser.id, AuditAction.AFFILIATE_APPROVED, 'affiliate_profile', savedUser.id, {
      source: 'AFFILIATE_REGISTER',
      partnerType: payload.partnerType,
      referralCode: payload.referralCode,
    });

    return this.withAffiliateContext(result);
  }

  async login(email: string, password: string, userAgent?: string, ipAddress?: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const result = await this.authService.login(
      { email: normalizedEmail, password },
      userAgent,
      ipAddress,
      { allowAffiliate: true },
    );

    if ('accessToken' in result) {
      const userId = (result as any).user?.id;
      if (userId) {
        await this.ensureAffiliateProfile({ userId, email: normalizedEmail });
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

  async initiateGoogleAuth(query: { returnUrl?: string; flowType?: OAuthFlowType; invitationToken?: string; origin?: string }) {
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
      frontendOrigin: query.origin,
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

    return {
      ...(await this.withAffiliateContext(session)),
      returnUrl: this.sanitizeAffiliateReturnUrl(state.returnUrl) || '/dashboard',
      frontendOrigin: state.frontendOrigin,
      isNewUser,
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
      googleConnected: dbStore.userIdentities.some((item) => item.userId === user.id && item.provider === 'GOOGLE'),
      hasPassword: Boolean(user.passwordHash),
      affiliate: await this.getAffiliateContext(user.id, user.email),
    };
  }

  private async getAffiliateContext(userId: string, email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const affiliateRows = dbStore.affiliates.filter((item) => item.email.toLowerCase().trim() === normalizedEmail);
    const pendingInvitations = dbStore.affiliateInvitations.filter(
      (item) => item.email.toLowerCase().trim() === normalizedEmail && item.status === 'PENDING' && !item.revokedAt && new Date(item.expiresAt) > new Date(),
    );
    const storedProfile = await this.ensureAffiliateProfile({ userId, email });
    const isOnboarded = Boolean(
      storedProfile.onboardingCompleted ?? (storedProfile.primaryMarket && (storedProfile.bio || storedProfile.website))
    );

    return {
      profile: {
        id: storedProfile.id,
        userId,
        website: storedProfile.website || '',
        country: storedProfile.country || 'India',
        partnerType: storedProfile.partnerType || 'AFFILIATE',
        primaryMarket: storedProfile.primaryMarket || 'India',
        audienceSize: storedProfile.audienceSize || '0-1k',
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

    const created = affiliatePortalProfiles.create({
      userId: input.userId,
      email: input.email.toLowerCase().trim(),
      fullName: input.fullName,
      partnerType: input.partnerType || 'AFFILIATE',
      country: input.country || 'India',
      website: input.website || '',
      primaryMarket: 'India',
      audienceSize: '0-1k',
      socialProfiles: {},
      bio: '',
      onboardingCompleted: false,
      taxCountry: input.country || 'India',
      panOrTaxId: '',
      taxClassification: 'INDIVIDUAL',
      withholdingRate: 0,
      taxVerified: false,
      taxFormType: 'PAN_TDS',
    });
    return await affiliatePortalProfiles.save(created);
  }

  async forgotPassword(email: string, origin?: string) {
    return this.authService.forgotPassword(email, 'affiliate', origin);
  }

  async verifyResetToken(token: string) {
    return this.authService.verifyResetToken(token);
  }

  async resetPassword(dto: { token: string; newPassword: string }) {
    return this.authService.resetPassword(dto);
  }

  private sanitizeAffiliateReturnUrl(value?: string) {
    if (!value) return '/dashboard';
    const trimmed = value.trim();
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//') || trimmed.includes('\\')) {
      return '/dashboard';
    }
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }

  private audit(actorId: string, action: AuditAction, resourceType: string, resourceId: string, metadata?: Record<string, any>) {
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
