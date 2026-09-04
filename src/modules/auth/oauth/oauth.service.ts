import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { IsNull } from 'typeorm';
import { initializeDataSource } from '../../../database/data-source';
import { User, UserIdentity, AuthSession, Organization, OrganizationMembership } from '../../../database/schema';
import { dbStore } from '../../../database/store';
import { SecurityUtils } from '../../../common/utils/security.utils';
import { getAppConfig } from '../../../config/app.config';
import { AuditAction, PlatformRole, UserStatus, Role } from '../../../common/enums';
import { MembershipStatus, ProgramAccessType } from '../../../common/enums/rbac';
import { GoogleOAuthService } from './providers/google/google-oauth.service';
import { OAuthStateService, OAuthFlowType, OAuthStateRecord } from './state/oauth-state.service';
import { ExternalIdentity, OAuthTokens } from './providers/oauth-provider.interface';
import { InitiateGoogleAuthDto, GoogleCallbackQueryDto, GoogleTokenExchangeDto, SetPasswordDto } from './dto/oauth.dto';
import { AuthService } from '../auth.service';
import { MembershipsService } from '../../memberships/memberships.service';
import { NotificationsService } from '../../notifications/notifications.service';

export interface OAuthAuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
    platformRole: PlatformRole;
  };
  returnUrl: string;
  isNewUser: boolean;
  flowType: OAuthFlowType;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly stateService: OAuthStateService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    @Inject(forwardRef(() => MembershipsService))
    private readonly membershipsService: MembershipsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async repositories() {
    const dataSource = await initializeDataSource();
    return {
      users: dataSource.getRepository(User),
      userIdentities: dataSource.getRepository(UserIdentity),
      authSessions: dataSource.getRepository(AuthSession),
      memberships: dataSource.getRepository(OrganizationMembership),
      organizations: dataSource.getRepository(Organization),
    };
  }

  /**
   * Initiates Google OAuth 2.0 / OpenID Connect authorization.
   * Generates PKCE code challenge and cryptographically secure state with nonce.
   */
  async initiateGoogleAuth(
    dto: InitiateGoogleAuthDto = {},
    currentUserId?: string,
    reqMeta: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<{ url: string; state: string }> {
    const config = getAppConfig();
    if (config.googleOAuthEnabled === false) {
      throw new BadRequestException('Google OAuth authentication is currently disabled.');
    }

    const stateRecord = this.stateService.createState({
      flowType: dto.flowType || 'LOGIN',
      returnUrl: dto.returnUrl,
      invitationToken: dto.invitationToken,
      currentUserId,
    });

    const authorizationUrl = await this.googleOAuthService.getAuthorizationUrl({
      state: stateRecord.state,
      nonce: stateRecord.nonce,
      codeChallenge: stateRecord.codeChallenge,
      codeChallengeMethod: 'S256',
      redirectUri: config.googleRedirectUri,
    });

    this.recordAuditLog({
      actorId: currentUserId || 'unauthenticated',
      action: AuditAction.GOOGLE_LOGIN_STARTED,
      resourceType: 'oauth_flow',
      resourceId: stateRecord.state.slice(0, 12),
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: {
        flowType: stateRecord.flowType,
        hasInvitation: Boolean(dto.invitationToken),
      },
    });

    return {
      url: authorizationUrl,
      state: stateRecord.state,
    };
  }

  /**
   * Handles the Google OAuth callback, code exchange, and transactional account resolution.
   */
  async handleGoogleCallback(
    query: GoogleCallbackQueryDto,
    reqMeta: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<OAuthAuthResult | { returnUrl: string; linked: boolean; message: string }> {
    // Check if Google returned an error query (e.g. user cancelled consent)
    if (query.error) {
      this.logger.warn(`Google OAuth error callback: ${query.error} - ${query.error_description}`);
      this.recordAuditLog({
        actorId: 'unauthenticated',
        action: AuditAction.GOOGLE_LOGIN_FAILED,
        resourceType: 'oauth_flow',
        resourceId: query.state ? query.state.slice(0, 12) : 'unknown',
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: { error: query.error, errorDescription: query.error_description },
      });

      if (query.error === 'access_denied') {
        throw new UnauthorizedException('Google sign-in was cancelled.');
      }
      throw new UnauthorizedException(query.error_description || 'Google authentication was not completed.');
    }

    if (!query.state) {
      throw new BadRequestException('OAuth state parameter is missing.');
    }

    if (!query.code) {
      throw new BadRequestException('OAuth authorization code is missing.');
    }

    // Atomically consume state (single-use validation)
    const stateRecord = this.stateService.consumeState(query.state);
    if (!stateRecord) {
      this.recordAuditLog({
        actorId: 'unauthenticated',
        action: AuditAction.OAUTH_STATE_REJECTED,
        resourceType: 'oauth_flow',
        resourceId: query.state.slice(0, 12),
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
      });
      throw new UnauthorizedException('Your Google sign-in session expired or was already used. Please try again.');
    }

    // Exchange authorization code for Google tokens using PKCE verifier
    const tokens = await this.googleOAuthService.exchangeCode({
      code: query.code,
      codeVerifier: stateRecord.codeVerifier,
      redirectUri: getAppConfig().googleRedirectUri,
    });

    // Validate Google OpenID Connect ID token and extract identity
    const externalIdentity = await this.googleOAuthService.verifyAndExtractIdentity(tokens, stateRecord.nonce);

    // Route flow based on flowType in validated state record
    if (stateRecord.flowType === 'LINK_ACCOUNT') {
      return this.handleLinkAccountFlow(externalIdentity, stateRecord, reqMeta);
    }

    if (stateRecord.flowType === 'ACCEPT_INVITATION') {
      return this.handleAcceptInvitationFlow(externalIdentity, stateRecord, reqMeta);
    }

    return this.handleLoginOrRegisterFlow(externalIdentity, stateRecord, reqMeta);
  }

  /**
   * Directly exchanges authorization code and state token from a client application.
   */
  async exchangeToken(
    dto: GoogleTokenExchangeDto,
    reqMeta: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<OAuthAuthResult | { returnUrl: string; linked: boolean; message: string }> {
    return this.handleGoogleCallback(
      { code: dto.code, state: dto.state },
      reqMeta,
    );
  }

  /**
   * Flow: Account Linking for an already authenticated user.
   */
  private async handleLinkAccountFlow(
    identity: ExternalIdentity,
    state: OAuthStateRecord,
    reqMeta: { ipAddress?: string; userAgent?: string },
  ) {
    const { users, userIdentities } = await this.repositories();

    if (!state.currentUserId) {
      throw new UnauthorizedException('Authentication required for account linking.');
    }

    const currentUser = await users.findOne({
      where: { id: state.currentUserId, deletedAt: IsNull() },
    });
    if (!currentUser) {
      throw new NotFoundException('Authenticated user account not found.');
    }

    // Verify Google account is not already linked to a different PartnerIQ user
    const existingIdentity = await userIdentities.findOne({
      where: { provider: identity.provider, providerUserId: identity.providerUserId },
    });

    if (existingIdentity && existingIdentity.userId !== currentUser.id) {
      this.recordAuditLog({
        actorId: currentUser.id,
        action: AuditAction.GOOGLE_LINK_FAILED,
        resourceType: 'user_identity',
        resourceId: identity.providerUserId,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: { reason: 'GOOGLE_ACCOUNT_ALREADY_LINKED' },
      });
      throw new BadRequestException('This Google account is already connected to another PartnerIQ account.');
    }

    if (!existingIdentity) {
      const newIdentity = userIdentities.create({
        userId: currentUser.id,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        email: identity.email,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        providerMetadata: identity.metadata,
        linkedAt: new Date(),
        lastLoginAt: new Date(),
      });
      const saved = await userIdentities.save(newIdentity);
      if (!dbStore.userIdentities.some((i) => i.id === saved.id)) {
        dbStore.userIdentities.push(saved);
      }
    } else {
      existingIdentity.lastLoginAt = new Date();
      existingIdentity.email = identity.email;
      existingIdentity.emailVerified = identity.emailVerified;
      if (identity.avatarUrl) existingIdentity.avatarUrl = identity.avatarUrl;
      await userIdentities.save(existingIdentity);
    }

    if (!currentUser.avatarUrl && identity.avatarUrl) {
      currentUser.avatarUrl = identity.avatarUrl;
      await users.save(currentUser);
    }

    // Emit audit log & security notification
    this.recordAuditLog({
      actorId: currentUser.id,
      action: AuditAction.GOOGLE_IDENTITY_LINKED,
      resourceType: 'user_identity',
      resourceId: identity.providerUserId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { email: identity.email },
    });

    await this.notificationsService.createNotification({
      userId: currentUser.id,
      type: 'security',
      title: 'Google Account Connected',
      body: `Your Google account (${identity.email}) has been connected to your PartnerIQ account.`,
      priority: 'normal',
    });

    return {
      returnUrl: state.returnUrl || '/app/settings',
      linked: true,
      message: 'Google account linked successfully.',
    };
  }

  /**
   * Flow: Organization Invitation with Google OAuth authentication.
   */
  private async handleAcceptInvitationFlow(
    identity: ExternalIdentity,
    state: OAuthStateRecord,
    reqMeta: { ipAddress?: string; userAgent?: string },
  ): Promise<OAuthAuthResult> {
    if (!state.invitationToken) {
      throw new BadRequestException('Invitation token is required.');
    }

    const invitation = this.membershipsService.getInvitation(state.invitationToken);
    if (!invitation) {
      throw new NotFoundException('Invitation not found or expired.');
    }

    // Validate that Google verified email matches invitation email
    const googleEmail = identity.email.toLowerCase().trim();
    const invitationEmail = invitation.email.toLowerCase().trim();

    if (googleEmail !== invitationEmail) {
      this.recordAuditLog({
        actorId: 'unauthenticated',
        action: AuditAction.OAUTH_EMAIL_MISMATCH,
        resourceType: 'invitation',
        resourceId: state.invitationToken.slice(0, 10),
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: { googleEmail, invitationEmail },
      });
      throw new BadRequestException(
        `This invitation was sent to ${invitation.email}. Please sign in using that Google account.`,
      );
    }

    // Resolve or create user
    const { user, isNewUser } = await this.resolveOrCreateUser(identity);

    // Accept membership invitation for user
    await this.membershipsService.acceptInvitationForUser(state.invitationToken, user.id);

    this.recordAuditLog({
      actorId: user.id,
      action: AuditAction.OAUTH_INVITATION_ACCEPTED,
      resourceType: 'invitation',
      resourceId: invitation.organizationId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { organizationId: invitation.organizationId, role: invitation.role },
    });

    // Create session & tokens
    const tokens = await this.authService.createSessionAndTokens(user, reqMeta.userAgent, reqMeta.ipAddress);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        platformRole: user.platformRole,
      },
      returnUrl: state.returnUrl || '/app/dashboard',
      isNewUser,
      flowType: 'ACCEPT_INVITATION',
    };
  }

  /**
   * Flow: Standard Google Login or Registration.
   */
  private async handleLoginOrRegisterFlow(
    identity: ExternalIdentity,
    state: OAuthStateRecord,
    reqMeta: { ipAddress?: string; userAgent?: string },
  ): Promise<OAuthAuthResult> {
    const { user, isNewUser } = await this.resolveOrCreateUser(identity);

    // Validate account status (defense against suspended or locked users)
    if (user.status === UserStatus.LOCKED && user.lockedUntil) {
      if (new Date() < new Date(user.lockedUntil)) {
        throw new ForbiddenException('Account is temporarily locked. Please try again later.');
      } else {
        user.status = UserStatus.ACTIVE;
        user.lockedUntil = undefined;
        user.failedLoginAttempts = 0;
      }
    }

    if (user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException('Your PartnerIQ account is inactive. Please contact support.');
    }

    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    const { users } = await this.repositories();
    await users.save(user);

    this.recordAuditLog({
      actorId: user.id,
      action: isNewUser ? AuditAction.GOOGLE_ACCOUNT_CREATED : AuditAction.GOOGLE_LOGIN_SUCCESS,
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { email: user.email, isNewUser },
    });

    // Issue PartnerIQ session & access/refresh tokens
    const tokens = await this.authService.createSessionAndTokens(user, reqMeta.userAgent, reqMeta.ipAddress);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        platformRole: user.platformRole,
      },
      returnUrl: state.returnUrl || (isNewUser ? '/onboarding' : '/app/dashboard'),
      isNewUser,
      flowType: state.flowType,
    };
  }

  /**
   * Account matching algorithm:
   * Rule 1: Find existing UserIdentity where provider = 'GOOGLE' and providerUserId = sub.
   * Rule 2: If not found, find User by verified email. Link UserIdentity to existing user.
   * Rule 3: If no user found, create new User with nullable passwordHash + UserIdentity.
   */
  private async resolveOrCreateUser(
    identity: ExternalIdentity,
  ): Promise<{ user: User; isNewUser: boolean }> {
    const { users, userIdentities } = await this.repositories();
    const normalizedEmail = identity.email.toLowerCase().trim();

    // Rule 1: Match by stable Google sub identity
    const existingIdentity = await userIdentities.findOne({
      where: { provider: identity.provider, providerUserId: identity.providerUserId },
    });

    if (existingIdentity) {
      const user = await users.findOne({
        where: { id: existingIdentity.userId, deletedAt: IsNull() },
      });
      if (user) {
        existingIdentity.lastLoginAt = new Date();
        existingIdentity.email = normalizedEmail;
        existingIdentity.emailVerified = identity.emailVerified;
        if (identity.avatarUrl && !existingIdentity.avatarUrl) {
          existingIdentity.avatarUrl = identity.avatarUrl;
        }
        await userIdentities.save(existingIdentity);

        if (identity.avatarUrl && !user.avatarUrl) {
          user.avatarUrl = identity.avatarUrl;
          await users.save(user);
        }

        return { user, isNewUser: false };
      }
    }

    // Rule 2: Match by verified email in PartnerIQ users table
    const existingUserByEmail = await users.findOne({
      where: { email: normalizedEmail, deletedAt: IsNull() },
    });

    if (existingUserByEmail) {
      // Safe verified-email linking
      if (!identity.emailVerified) {
        throw new UnauthorizedException('Unverified Google email cannot be linked to existing account.');
      }

      const newIdentity = userIdentities.create({
        userId: existingUserByEmail.id,
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
      const savedIdentity = await userIdentities.save(newIdentity);
      if (!dbStore.userIdentities.some((i) => i.id === savedIdentity.id)) {
        dbStore.userIdentities.push(savedIdentity);
      }

      if (!existingUserByEmail.emailVerified) {
        existingUserByEmail.emailVerified = true;
      }
      if (!existingUserByEmail.avatarUrl && identity.avatarUrl) {
        existingUserByEmail.avatarUrl = identity.avatarUrl;
      }
      await users.save(existingUserByEmail);

      return { user: existingUserByEmail, isNewUser: false };
    }

    // Rule 3: Create new User and UserIdentity
    const isSuperAdmin = this.authService.isConfiguredSuperAdmin(normalizedEmail);
    const newUser = users.create({
      email: normalizedEmail,
      firstName: identity.firstName || 'User',
      lastName: identity.lastName || '',
      avatarUrl: identity.avatarUrl,
      status: UserStatus.ACTIVE,
      emailVerified: Boolean(identity.emailVerified),
      platformRole: isSuperAdmin ? PlatformRole.SUPER_ADMIN : PlatformRole.USER,
      failedLoginAttempts: 0,
      passwordHash: undefined, // Google-only signup has no password initially
    });

    const savedUser = await users.save(newUser);
    if (!dbStore.users.some((u) => u.id === savedUser.id)) {
      dbStore.users.push(savedUser);
    }

    const newIdentity = userIdentities.create({
      userId: savedUser.id,
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      email: normalizedEmail,
      emailVerified: Boolean(identity.emailVerified),
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      providerMetadata: identity.metadata,
      linkedAt: new Date(),
      lastLoginAt: new Date(),
    });
    const savedIdentity = await userIdentities.save(newIdentity);
    if (!dbStore.userIdentities.some((i) => i.id === savedIdentity.id)) {
      dbStore.userIdentities.push(savedIdentity);
    }

    return { user: savedUser, isNewUser: true };
  }

  /**
   * Retrieves connected identity providers and password status for the authenticated user.
   */
  async getUserIdentities(userId: string) {
    const { users, userIdentities } = await this.repositories();
    const user = await users.findOne({ where: { id: userId, deletedAt: IsNull() } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const identities = await userIdentities.find({ where: { userId } });

    return {
      hasPassword: Boolean(user.passwordHash && user.passwordHash.length > 0),
      identities: identities.map((item) => ({
        id: item.id,
        provider: item.provider,
        providerUserId: item.providerUserId,
        email: item.email,
        emailVerified: item.emailVerified,
        displayName: item.displayName,
        avatarUrl: item.avatarUrl,
        linkedAt: item.linkedAt,
        lastLoginAt: item.lastLoginAt,
      })),
    };
  }

  /**
   * Safely unlinks a Google identity with lockout prevention check.
   */
  async unlinkIdentity(
    userId: string,
    identityId: string,
    reqMeta: { ipAddress?: string; userAgent?: string } = {},
  ) {
    const { users, userIdentities } = await this.repositories();
    const user = await users.findOne({ where: { id: userId, deletedAt: IsNull() } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const targetIdentity = await userIdentities.findOne({
      where: { id: identityId, userId },
    });
    if (!targetIdentity) {
      throw new NotFoundException('Connected login method not found.');
    }

    // LOCKOUT PREVENTION: Check alternative login methods
    const allIdentities = await userIdentities.find({ where: { userId } });
    const otherIdentities = allIdentities.filter((i) => i.id !== identityId);
    const hasPassword = Boolean(user.passwordHash && user.passwordHash.length > 0);

    if (!hasPassword && otherIdentities.length === 0) {
      throw new BadRequestException(
        'You cannot disconnect Google because it is your only login method. Please set a password before disconnecting.',
      );
    }

    await userIdentities.delete({ id: identityId });
    const storeIdx = dbStore.userIdentities.findIndex((i) => i.id === identityId);
    if (storeIdx >= 0) {
      dbStore.userIdentities.splice(storeIdx, 1);
    }

    this.recordAuditLog({
      actorId: user.id,
      action: AuditAction.GOOGLE_IDENTITY_UNLINKED,
      resourceType: 'user_identity',
      resourceId: targetIdentity.providerUserId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { email: targetIdentity.email },
    });

    await this.notificationsService.createNotification({
      userId: user.id,
      type: 'security',
      title: 'Google Account Disconnected',
      body: `Your Google account (${targetIdentity.email}) was disconnected from your PartnerIQ account.`,
      priority: 'high',
    });

    return {
      success: true,
      message: 'Google login method disconnected successfully.',
    };
  }

  /**
   * Adds a password for an external-auth-only user.
   */
  async setPassword(userId: string, dto: SetPasswordDto, reqMeta: { ipAddress?: string; userAgent?: string } = {}) {
    const { users } = await this.repositories();
    const user = await users.findOne({ where: { id: userId, deletedAt: IsNull() } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.passwordHash = await SecurityUtils.hashPassword(dto.password);
    user.updatedAt = new Date();
    await users.save(user);

    this.recordAuditLog({
      actorId: user.id,
      action: AuditAction.PASSWORD_ADDED,
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
    });

    await this.notificationsService.createNotification({
      userId: user.id,
      type: 'security',
      title: 'Password Configured',
      body: 'A password has been successfully configured for your PartnerIQ account.',
      priority: 'normal',
    });

    return {
      success: true,
      message: 'Password configured successfully. You can now log in with either Google or your password.',
    };
  }

  /**
   * Reports Google OAuth configuration diagnostics without exposing secrets.
   */
  getStatus() {
    const config = getAppConfig();
    return {
      enabled: config.googleOAuthEnabled,
      configured: Boolean(config.googleClientId && config.googleClientSecret),
      clientIdConfigured: Boolean(config.googleClientId),
      redirectUriConfigured: Boolean(config.googleRedirectUri),
      redirectUri: config.googleRedirectUri,
    };
  }

  private recordAuditLog(params: {
    actorId: string;
    action: AuditAction;
    resourceType: string;
    resourceId: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }) {
    const sanitizedMetadata = SecurityUtils.sanitizeForLogging(params.metadata);
    dbStore.auditLogs.unshift({
      id: uuidv4(),
      organizationId: undefined,
      actorType: 'user',
      actorId: params.actorId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: sanitizedMetadata,
      createdAt: new Date(),
    });
  }
}
