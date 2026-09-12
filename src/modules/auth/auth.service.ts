import {
  Injectable,
  Optional,
  Inject,
  forwardRef,
  Logger,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import jwtPkg, { SignOptions } from 'jsonwebtoken';
const jwt = (jwtPkg as any).default || jwtPkg;
import { IsNull, Not, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { initializeDataSource } from '../../database/data-source';
import {
  AuthSecurityEvent,
  AuthSession,
  MfaChallenge,
  MfaRateLimit,
  Organization,
  OrganizationMembership,
  OrganizationSecurityPolicy,
  User,
  UserDevice,
  UserMfaConfig,
  UserRecoveryCode,
} from '../../database/schema';
import { dbStore } from '../../database/store';
import { SecurityUtils } from '../../common/utils/security.utils';
import { lookupIp } from '../../common/utils/geo.utils';
import { generateQrCodeDataUrl } from '../../common/utils/qr.utils';
import { getJwtConfig } from '../../config/jwt.config';
import { getAppConfig } from '../../config/app.config';
import { AuthLevel, PlatformRole, Role, SecurityEventType, UserStatus } from '../../common/enums';
import { MembershipStatus, ProgramAccessType } from '../../common/enums/rbac';
import { getRolePermissions } from '../../common/constants/permissions';
import { RiskEngineService } from './risk-engine.service';
import { EmailQueueProducer } from '../email-design/queue/email-queue.producer';
import { EmailQueueWorker } from '../email-design/queue/email-queue.worker';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import { AUTH_EMAIL_TEMPLATES } from '../../config/auth-email-templates.config';
import {
  RegisterDto,
  LoginDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { assertUserEligibleForOrganization } from '../affiliates/affiliate-eligibility.policy';

// Sensitive roles that must be subject to org MFA policy for 'SENSITIVE_ROLES' scope
const SENSITIVE_ROLES = new Set([
  Role.OWNER,
  Role.ADMIN,
  Role.FINANCE,
  Role.DEVELOPER,
]);

const DEVICE_TRUST_DAYS = parseInt(process.env.DEVICE_TRUST_DAYS || '30', 10);
const STEP_UP_MAX_AGE_SECONDS = parseInt(process.env.MFA_STEP_UP_TTL_SECONDS || '600', 10);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly riskEngine: RiskEngineService,
    @Optional() @Inject(forwardRef(() => EmailQueueProducer)) private readonly emailQueueProducer?: EmailQueueProducer,
    @Optional() @Inject(forwardRef(() => EmailQueueWorker)) private readonly emailQueueWorker?: EmailQueueWorker,
  ) { }

  private async repositories() {
    const dataSource = await initializeDataSource();

    return {
      users: dataSource.getRepository(User),
      authSessions: dataSource.getRepository(AuthSession),
      memberships: dataSource.getRepository(OrganizationMembership),
      organizations: dataSource.getRepository(Organization),
      userDevices: dataSource.getRepository(UserDevice),
      userMfaConfigs: dataSource.getRepository(UserMfaConfig),
      userRecoveryCodes: dataSource.getRepository(UserRecoveryCode),
      mfaChallenges: dataSource.getRepository(MfaChallenge),
      securityEvents: dataSource.getRepository(AuthSecurityEvent),
      orgSecurityPolicies: dataSource.getRepository(OrganizationSecurityPolicy),
      mfaRateLimits: dataSource.getRepository(MfaRateLimit),
    };
  }

  // ─────────────────────────────────────────────────────────
  // Security Event Recording
  // ─────────────────────────────────────────────────────────

  private async recordSecurityEvent(params: {
    userId?: string;
    organizationId?: string;
    sessionId?: string;
    deviceId?: string;
    eventType: string;
    ipAddress?: string;
    country?: string;
    region?: string;
    city?: string;
    browser?: string;
    operatingSystem?: string;
    riskScore?: number;
    riskLevel?: string;
    metadata?: Record<string, any>;
  }) {
    const { securityEvents } = await this.repositories();
    const event = securityEvents.create({
      ...params,
      riskScore: params.riskScore ?? 0,
      riskLevel: params.riskLevel ?? 'LOW',
      metadata: params.metadata ? SecurityUtils.sanitizeForLogging(params.metadata) : undefined,
    });
    await securityEvents.save(event);
    return event;
  }

  // ─────────────────────────────────────────────────────────
  // MFA Config
  // ─────────────────────────────────────────────────────────

  private async findMfaConfig(userId: string) {
    const { userMfaConfigs } = await this.repositories();
    return userMfaConfigs.findOne({ where: { userId } });
  }

  // ─────────────────────────────────────────────────────────
  // User-Agent Parsing
  // ─────────────────────────────────────────────────────────

  private parseUserAgent(userAgent?: string): { browser: string; os: string; deviceType: string } {
    if (!userAgent) return { browser: 'Unknown', os: 'Unknown', deviceType: 'Desktop' };

    const browser =
      userAgent.match(/(Edg|Edge)\//)
        ? 'Edge'
        : userAgent.match(/OPR\//)
          ? 'Opera'
          : userAgent.match(/Chrome\//)
            ? 'Chrome'
            : userAgent.match(/Firefox\//)
              ? 'Firefox'
              : userAgent.match(/Safari\//)
                ? 'Safari'
                : 'Unknown';

    const os =
      userAgent.match(/Windows NT/)
        ? 'Windows'
        : userAgent.match(/Macintosh|Mac OS X/)
          ? 'macOS'
          : userAgent.match(/Android/)
            ? 'Android'
            : userAgent.match(/iPhone|iPad/)
              ? 'iOS'
              : userAgent.match(/Linux/)
                ? 'Linux'
                : 'Unknown';

    const isAndroid = /Android/.test(userAgent);
    const isIOS = /iPhone|iPad/.test(userAgent);
    const isMobile = isAndroid || isIOS;
    const isTablet = /iPad/.test(userAgent);

    const deviceType = isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop';

    return { browser, os, deviceType };
  }

  // ─────────────────────────────────────────────────────────
  // Device Management
  // ─────────────────────────────────────────────────────────

  private async upsertDeviceRecord(
    userId: string,
    userAgent?: string,
    ipAddress?: string,
    geoLocation?: { country?: string; region?: string; city?: string },
  ): Promise<{ device: UserDevice; isNew: boolean }> {
    const { userDevices } = await this.repositories();
    const { browser, os, deviceType } = this.parseUserAgent(userAgent);
    const deviceKey = SecurityUtils.hashToken(`${userAgent || 'unknown'}:${userId}`);

    const existing = await userDevices.findOne({ where: { userId, deviceIdentifierHash: deviceKey } });

    if (existing) {
      existing.lastSeenAt = new Date();
      existing.lastIpAddress = ipAddress;
      existing.displayName = `${browser} on ${os}`;
      existing.browser = browser;
      existing.operatingSystem = os;
      if (geoLocation?.country) existing.country = geoLocation.country;
      if (geoLocation?.region) existing.region = geoLocation.region;
      if (geoLocation?.city) existing.city = geoLocation.city;
      const saved = await userDevices.save(existing);
      return { device: saved, isNew: false };
    }

    const device = userDevices.create({
      userId,
      deviceIdentifierHash: deviceKey,
      displayName: `${browser} on ${os}`,
      deviceType,
      operatingSystem: os,
      browser,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      lastIpAddress: ipAddress,
      country: geoLocation?.country,
      region: geoLocation?.region,
      city: geoLocation?.city,
      isTrusted: false,
    });
    const saved = await userDevices.save(device);
    return { device: saved, isNew: true };
  }

  async getDevices(userId: string) {
    const { userDevices } = await this.repositories();
    const devices = await userDevices.find({
      where: { userId, revokedAt: IsNull() },
      order: { lastSeenAt: 'DESC' },
    });
    return devices.map((d) => ({
      id: d.id,
      displayName: d.displayName || 'Unknown Device',
      deviceType: d.deviceType,
      browser: d.browser,
      operatingSystem: d.operatingSystem,
      firstSeenAt: d.firstSeenAt,
      lastSeenAt: d.lastSeenAt,
      lastIpAddress: d.lastIpAddress,
      country: d.country,
      region: d.region,
      city: d.city,
      isTrusted: d.isTrusted && d.trustedUntil ? new Date() < new Date(d.trustedUntil) : false,
      trustedAt: d.trustedAt,
      trustedUntil: d.trustedUntil,
    }));
  }

  async trustDevice(userId: string, deviceId: string, sessionId?: string) {
    const { userDevices } = await this.repositories();
    const device = await userDevices.findOne({ where: { id: deviceId, userId, revokedAt: IsNull() } });
    if (!device) throw new NotFoundException('Device not found');

    device.isTrusted = true;
    device.trustedAt = new Date();
    device.trustedUntil = new Date(Date.now() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000);
    await userDevices.save(device);

    await this.recordSecurityEvent({
      userId,
      deviceId,
      sessionId,
      eventType: SecurityEventType.TRUSTED_DEVICE_ADDED,
      metadata: { deviceDisplayName: device.displayName, trustedUntil: device.trustedUntil },
    });

    return { success: true, device: { id: device.id, displayName: device.displayName, trustedUntil: device.trustedUntil } };
  }

  async revokeTrust(userId: string, deviceId: string, sessionId?: string) {
    const { userDevices } = await this.repositories();
    const device = await userDevices.findOne({ where: { id: deviceId, userId, revokedAt: IsNull() } });
    if (!device) throw new NotFoundException('Device not found');

    device.isTrusted = false;
    device.trustedAt = undefined;
    device.trustedUntil = undefined;
    await userDevices.save(device);

    await this.recordSecurityEvent({
      userId,
      deviceId,
      sessionId,
      eventType: SecurityEventType.TRUSTED_DEVICE_REMOVED,
      metadata: { deviceDisplayName: device.displayName },
    });

    return { success: true, message: 'Device trust removed' };
  }

  async deleteDevice(userId: string, deviceId: string, currentSessionId?: string) {
    const { userDevices, authSessions } = await this.repositories();
    const device = await userDevices.findOne({ where: { id: deviceId, userId, revokedAt: IsNull() } });
    if (!device) throw new NotFoundException('Device not found');

    // Revoke associated sessions (except current)
    const sessions = await authSessions.find({
      where: { userId, deviceId, revokedAt: IsNull() },
    });
    for (const session of sessions) {
      if (session.id !== currentSessionId) {
        session.revokedAt = new Date();
        session.revokeReason = 'DEVICE_REMOVED';
        await authSessions.save(session);
      }
    }

    device.revokedAt = new Date();
    device.isTrusted = false;
    await userDevices.save(device);

    await this.recordSecurityEvent({
      userId,
      deviceId,
      sessionId: currentSessionId,
      eventType: SecurityEventType.TRUSTED_DEVICE_REMOVED,
      metadata: { deviceDisplayName: device.displayName, action: 'device_deleted' },
    });

    return { success: true, message: 'Device removed and associated sessions revoked' };
  }

  // ─────────────────────────────────────────────────────────
  // Session Management
  // ─────────────────────────────────────────────────────────

  async getSessions(userId: string, currentSessionId?: string) {
    const { authSessions, userDevices } = await this.repositories();
    const sessions = await authSessions.find({
      where: { userId, revokedAt: IsNull() },
      order: { lastUsedAt: 'DESC' },
    });

    const deviceIds = [...new Set(sessions.map((s) => s.deviceId).filter(Boolean))] as string[];
    let devicesMap: Map<string, UserDevice> = new Map();
    if (deviceIds.length > 0) {
      const devices = await userDevices.find({ where: { id: In(deviceIds) } });
      devicesMap = new Map(devices.map((d) => [d.id, d]));
    }

    return sessions.map((s) => {
      const device = s.deviceId ? devicesMap.get(s.deviceId) : null;
      return {
        id: s.id,
        deviceName: device?.displayName || s.deviceName || 'Web Browser',
        browser: device?.browser,
        operatingSystem: device?.operatingSystem,
        deviceType: device?.deviceType,
        ipAddress: s.ipAddress,
        country: s.country,
        region: s.region,
        city: s.city,
        location: [s.city, s.region, s.country].filter(Boolean).join(', ') || 'Unknown location',
        authenticationLevel: s.authenticationLevel,
        isTrusted: device?.isTrusted && device.trustedUntil ? new Date() < new Date(device.trustedUntil) : false,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        isCurrent: s.id === currentSessionId,
        expiresAt: s.expiresAt,
      };
    });
  }

  async revokeSession(userId: string, sessionId: string, reason?: string) {
    const { authSessions } = await this.repositories();
    const session = await authSessions.findOne({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundException('Session not found');
    session.revokedAt = new Date();
    session.revokeReason = reason || 'USER_REVOKED';
    await authSessions.save(session);

    await this.recordSecurityEvent({
      userId,
      sessionId,
      eventType: SecurityEventType.SESSION_REVOKED,
      metadata: { reason: session.revokeReason },
    });

    return { success: true, message: 'Session revoked' };
  }

  async logoutOthers(userId: string, currentSessionId: string) {
    const { authSessions } = await this.repositories();
    const sessions = await authSessions.find({
      where: { userId, revokedAt: IsNull() },
    });

    let revokedCount = 0;
    for (const session of sessions) {
      if (session.id !== currentSessionId) {
        session.revokedAt = new Date();
        session.revokeReason = 'LOGOUT_OTHERS';
        await authSessions.save(session);
        revokedCount++;
      }
    }

    await this.recordSecurityEvent({
      userId,
      sessionId: currentSessionId,
      eventType: SecurityEventType.LOGOUT_OTHERS,
      metadata: { revokedCount },
    });

    return { success: true, message: `${revokedCount} other session(s) revoked`, revokedCount };
  }

  // ─────────────────────────────────────────────────────────
  // Security Events
  // ─────────────────────────────────────────────────────────

  async getSecurityEvents(userId: string, page = 1, limit = 20) {
    const { securityEvents } = await this.repositories();
    const [events, total] = await securityEvents.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        ipAddress: e.ipAddress,
        country: e.country,
        region: e.region,
        city: e.city,
        browser: e.browser,
        operatingSystem: e.operatingSystem,
        riskLevel: e.riskLevel,
        createdAt: e.createdAt,
        // Never expose metadata in list view — may contain partial sensitive hints
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // MFA Status
  // ─────────────────────────────────────────────────────────

  async getMfaStatus(userId: string) {
    const { userMfaConfigs, userRecoveryCodes } = await this.repositories();
    const config = await userMfaConfigs.findOne({ where: { userId } });
    const remainingCodes = config?.enabled
      ? await userRecoveryCodes.count({ where: { userId, usedAt: IsNull(), revokedAt: IsNull() } })
      : 0;

    return {
      enabled: config?.enabled ?? false,
      method: config?.method ?? null,
      enabledAt: config?.enabledAt ?? null,
      lastVerifiedAt: config?.lastVerifiedAt ?? null,
      remainingRecoveryCodes: remainingCodes,
    };
  }

  async getRemainingRecoveryCodes(userId: string): Promise<{ count: number }> {
    const { userRecoveryCodes } = await this.repositories();
    const count = await userRecoveryCodes.count({
      where: { userId, usedAt: IsNull(), revokedAt: IsNull() },
    });
    return { count };
  }

  // ─────────────────────────────────────────────────────────
  // Organization Security Policy
  // ─────────────────────────────────────────────────────────

  async getOrganizationSecurityPolicy(organizationId: string) {
    const { orgSecurityPolicies } = await this.repositories();
    const policy = await orgSecurityPolicies.findOne({ where: { organizationId } });
    return policy ?? {
      organizationId,
      requireMfa: false,
      mfaScope: 'ALL',
      sensitiveRoles: [],
      sessionIdleTimeoutMinutes: 10080,
    };
  }

  async updateOrganizationSecurityPolicy(
    organizationId: string,
    updatedBy: string,
    updates: {
      requireMfa?: boolean;
      mfaScope?: string;
      sensitiveRoles?: string[];
      sessionIdleTimeoutMinutes?: number;
    },
  ) {
    const { orgSecurityPolicies } = await this.repositories();
    let policy = await orgSecurityPolicies.findOne({ where: { organizationId } });

    if (!policy) {
      policy = orgSecurityPolicies.create({
        organizationId,
        requireMfa: false,
        mfaScope: 'ALL',
        sessionIdleTimeoutMinutes: 10080,
      });
    }

    if (updates.requireMfa !== undefined) policy.requireMfa = updates.requireMfa;
    if (updates.mfaScope !== undefined) policy.mfaScope = updates.mfaScope;
    if (updates.sensitiveRoles !== undefined) policy.sensitiveRoles = updates.sensitiveRoles;
    if (updates.sessionIdleTimeoutMinutes !== undefined)
      policy.sessionIdleTimeoutMinutes = updates.sessionIdleTimeoutMinutes;
    policy.updatedBy = updatedBy;

    const saved = await orgSecurityPolicies.save(policy);

    await this.recordSecurityEvent({
      userId: updatedBy,
      organizationId,
      eventType: SecurityEventType.ORGANIZATION_SECURITY_POLICY_CHANGED,
      metadata: updates,
    });

    return saved;
  }

  /**
   * Check if a user must complete MFA based on org policy.
   * Returns true if the user MUST configure/verify MFA.
   */
  async checkOrgMfaRequirement(userId: string, organizationId: string): Promise<{
    required: boolean;
    reason?: string;
  }> {
    const { orgSecurityPolicies, memberships, userMfaConfigs } = await this.repositories();

    const policy = await orgSecurityPolicies.findOne({ where: { organizationId } });
    if (!policy?.requireMfa) return { required: false };

    const mfaConfig = await userMfaConfigs.findOne({ where: { userId } });
    if (mfaConfig?.enabled) return { required: false }; // Already has MFA

    // Check scope
    if (policy.mfaScope === 'ALL') {
      return { required: true, reason: 'Organization requires all members to enable two-factor authentication.' };
    }

    const membership = await memberships.findOne({ where: { userId, organizationId } });
    if (!membership) return { required: false };

    if (policy.mfaScope === 'ADMINS') {
      const adminRoles = new Set([Role.OWNER, Role.ADMIN]);
      if (adminRoles.has(membership.role as Role)) {
        return { required: true, reason: 'Organization requires administrators to enable two-factor authentication.' };
      }
    }

    if (policy.mfaScope === 'SENSITIVE_ROLES') {
      const scopedRoles = policy.sensitiveRoles?.length
        ? new Set(policy.sensitiveRoles)
        : SENSITIVE_ROLES;
      if (scopedRoles.has(membership.role as any)) {
        return { required: true, reason: 'Your role requires two-factor authentication.' };
      }
    }

    return { required: false };
  }

  // ─────────────────────────────────────────────────────────
  // Step-Up Authentication
  // ─────────────────────────────────────────────────────────

  async createStepUpChallenge(userId: string, sessionId: string, userAgent?: string, ipAddress?: string) {
    const { mfaChallenges, userMfaConfigs } = await this.repositories();

    const mfaConfig = await userMfaConfigs.findOne({ where: { userId } });
    if (!mfaConfig?.enabled) {
      throw new BadRequestException('MFA is not enabled on this account. Enable MFA before using step-up authentication.');
    }

    const challenge = mfaChallenges.create({
      userId,
      challengeId: uuidv4(),
      method: 'STEP_UP_TOTP',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      ipAddress,
      userAgent,
      metadata: { sessionId, purpose: 'step_up' },
    });
    const saved = await mfaChallenges.save(challenge);

    await this.recordSecurityEvent({
      userId,
      sessionId,
      eventType: SecurityEventType.STEP_UP_CHALLENGE_CREATED,
      ipAddress,
      metadata: { challengeId: saved.challengeId },
    });

    return {
      challengeId: saved.challengeId,
      expiresAt: saved.expiresAt,
      method: 'TOTP',
    };
  }

  async verifyStepUp(
    userId: string,
    sessionId: string,
    challengeId: string,
    code: string,
    userAgent?: string,
    ipAddress?: string,
  ) {
    const { mfaChallenges, userMfaConfigs, authSessions } = await this.repositories();
    const { browser, os } = this.parseUserAgent(userAgent);

    const challenge = await mfaChallenges.findOne({ where: { challengeId, userId } });
    if (!challenge) throw new BadRequestException('Invalid step-up challenge');
    if (challenge.usedAt || challenge.expiresAt < new Date()) {
      throw new BadRequestException('Step-up challenge has expired or already been used');
    }
    if (!challenge.metadata?.purpose || challenge.metadata.purpose !== 'step_up') {
      throw new BadRequestException('Invalid step-up challenge type');
    }

    const mfaConfig = await userMfaConfigs.findOne({ where: { userId } });
    if (!mfaConfig?.enabled || !mfaConfig.secretEncrypted) {
      throw new BadRequestException('MFA is not available for this account');
    }

    const secret = SecurityUtils.decrypt(mfaConfig.secretEncrypted);
    const valid = SecurityUtils.verifyTotpCode(secret, code);

    if (!valid) {
      await this.recordSecurityEvent({
        userId,
        sessionId,
        eventType: SecurityEventType.STEP_UP_FAILED,
        ipAddress,
        browser,
        operatingSystem: os,
        metadata: { challengeId },
      });
      throw new BadRequestException('Invalid authenticator code');
    }

    // Mark challenge used
    challenge.usedAt = new Date();
    await mfaChallenges.save(challenge);

    // Update session mfaVerifiedAt
    const session = await authSessions.findOne({ where: { id: sessionId, userId, revokedAt: IsNull() } });
    if (session) {
      session.mfaVerifiedAt = new Date();
      session.authenticationLevel = AuthLevel.MFA;
      await authSessions.save(session);
    }

    await this.recordSecurityEvent({
      userId,
      sessionId,
      eventType: SecurityEventType.STEP_UP_VERIFIED,
      ipAddress,
      browser,
      operatingSystem: os,
      metadata: { challengeId },
    });

    return {
      success: true,
      mfaVerifiedAt: session?.mfaVerifiedAt,
      expiresAt: new Date(Date.now() + STEP_UP_MAX_AGE_SECONDS * 1000),
    };
  }

  // ─────────────────────────────────────────────────────────
  // Registration
  // ─────────────────────────────────────────────────────────

  async register(dto: RegisterDto, userAgent?: string, ipAddress?: string) {
    const { users } = await this.repositories();
    const normalizedEmail = dto.email.toLowerCase().trim();

    assertUserEligibleForOrganization(normalizedEmail);

    const existing = await users.findOne({
      where: { email: normalizedEmail, deletedAt: IsNull() },
    });
    if (existing) {
      if (existing.platformRole === PlatformRole.AFFILIATE) {
        throw new ForbiddenException(
          'An affiliate account is already registered with this email. Affiliate accounts cannot be registered as organization accounts.',
        );
      }
      throw new BadRequestException('User with this email already exists');
    }

    const passwordHash = await SecurityUtils.hashPassword(dto.password);
    const platformRole = this.isConfiguredSuperAdmin(normalizedEmail)
      ? PlatformRole.SUPER_ADMIN
      : PlatformRole.USER;
    const newUser = users.create({
      email: normalizedEmail,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      status: UserStatus.ACTIVE,
      emailVerified: false,
      platformRole,
      failedLoginAttempts: 0,
    });
    const savedUser = await users.save(newUser);
    if (!dbStore.users.some((item) => item.id === savedUser.id)) {
      dbStore.users.push(savedUser);
    }

    const tokens = await this.createSessionAndTokens(savedUser, userAgent, ipAddress);

    return {
      ...tokens,
      userId: savedUser.id,
      email: savedUser.email,
      firstName: savedUser.firstName,
      lastName: savedUser.lastName,
      platformRole: savedUser.platformRole,
      message: 'User registered successfully. Please verify your email.',
    };
  }

  // ─────────────────────────────────────────────────────────
  // Login
  // ─────────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    userAgent?: string,
    ipAddress?: string,
    options: { allowAffiliate?: boolean } = {},
  ) {
    const { users } = await this.repositories();
    const { browser, os } = this.parseUserAgent(userAgent);
    const normalizedEmail = dto.email.toLowerCase().trim();
    const user = await users.findOne({
      where: { email: normalizedEmail, deletedAt: IsNull() },
    });

    if (!user) {
      // Timing-safe: don't reveal whether email exists
      await SecurityUtils.hashPassword('dummy-timing-safe-hash');
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.platformRole !== PlatformRole.SUPER_ADMIN && this.isConfiguredSuperAdmin(normalizedEmail)) {
      user.platformRole = PlatformRole.SUPER_ADMIN;
      try {
        await users.save(user);
      } catch { }
    }

    if (user.platformRole === PlatformRole.AFFILIATE && !options.allowAffiliate) {
      throw new ForbiddenException(
        'This account is registered as an affiliate partner and cannot sign in to the organization portal. Please use the affiliate portal at /affiliate.',
      );
    }

    if (user.status === UserStatus.LOCKED && user.lockedUntil) {
      if (new Date() < new Date(user.lockedUntil)) {
        throw new ForbiddenException('Account is temporarily locked due to failed login attempts');
      } else {
        user.status = UserStatus.ACTIVE;
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        await users.save(user);
      }
    }

    const isValid = await SecurityUtils.verifyPassword(dto.password, user.passwordHash || '');
    if (!isValid) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= 5) {
        user.status = UserStatus.LOCKED;
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await users.save(user);
      await this.recordSecurityEvent({
        userId: user.id,
        eventType: SecurityEventType.LOGIN_FAILED,
        ipAddress,
        browser,
        operatingSystem: os,
        metadata: { email: user.email, failedAttempts: user.failedLoginAttempts },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    await users.save(user);

    // Geolocation lookup
    const geo = await lookupIp(ipAddress);

    // Device check
    const { device, isNew: isNewDevice } = await this.upsertDeviceRecord(
      user.id, userAgent, ipAddress, geo ?? undefined,
    );

    const isTrusted = device.isTrusted && device.trustedUntil
      ? new Date() < new Date(device.trustedUntil)
      : false;

    // Risk assessment
    const risk = this.riskEngine.evaluate({
      isNewDevice,
      isNewCountry: false, // TODO: compare against user's historical countries
      isKnownTrustedDevice: isTrusted,
      isPreviousKnownDevice: !isNewDevice,
      recentFailedAttempts: user.failedLoginAttempts,
      refreshTokenReuseDetected: false,
      recentPasswordChange: false,
      recentMfaChange: false,
      organizationRequiresMfa: false, // Checked post-login
      mfaEnabled: false,
    });

    const mfaConfig = await this.findMfaConfig(user.id);
    const mfaEnabled = mfaConfig?.enabled ?? false;

    // Determine if MFA verification is needed
    const needsMfa = mfaEnabled && (!isTrusted || risk.requiresMfa);

    if (needsMfa) {
      const challenge = await this.createMfaChallengeInternal(user, userAgent, ipAddress, device.id);
      return {
        requiresMfa: true,
        challengeId: challenge.challengeId,
        availableMethods: ['TOTP', 'RECOVERY_CODE'],
        expiresAt: challenge.expiresAt,
      };
    }

    // No MFA needed — create session directly
    const tokens = await this.createSessionAndTokens(
      user, userAgent, ipAddress,
      { deviceId: device.id, authLevel: AuthLevel.PASSWORD, geo: geo ?? undefined, isNewDevice },
    );

    await this.recordSecurityEvent({
      userId: user.id,
      sessionId: tokens.sessionId,
      deviceId: device.id,
      eventType: SecurityEventType.LOGIN_SUCCESS,
      ipAddress,
      country: geo?.country,
      region: geo?.region,
      city: geo?.city,
      browser,
      operatingSystem: os,
      riskScore: risk.score,
      riskLevel: risk.level,
      metadata: { email: user.email },
    });

    if (isNewDevice) {
      await this.recordSecurityEvent({
        userId: user.id,
        sessionId: tokens.sessionId,
        deviceId: device.id,
        eventType: SecurityEventType.NEW_DEVICE_LOGIN,
        ipAddress,
        country: geo?.country,
        region: geo?.region,
        city: geo?.city,
        browser,
        operatingSystem: os,
        riskScore: risk.score,
        riskLevel: risk.level,
        metadata: { deviceName: device.displayName },
      });

      // Send new device notification
      this.sendSecurityNotificationSafe(user.id, {
        title: 'New device logged in to PartnerIQ',
        body: `A new login was detected from ${device.displayName || 'an unknown device'}.${geo ? ` Approximate location: ${[geo.city, geo.country].filter(Boolean).join(', ')}.` : ''} If this wasn't you, review your active sessions immediately.`,
        actionUrl: '/app/settings?tab=security',
        metadata: {
          deviceName: device.displayName || browser || 'Web Browser',
          location: [geo?.city, geo?.country].filter(Boolean).join(', ') || 'Current Network Location',
          ipAddress: ipAddress || '127.0.0.1',
        },
      });
    }

    return tokens;
  }

  // ─────────────────────────────────────────────────────────
  // MFA Challenge Creation (Internal)
  // ─────────────────────────────────────────────────────────

  private async createMfaChallengeInternal(
    user: User,
    userAgent?: string,
    ipAddress?: string,
    deviceId?: string,
  ) {
    const { mfaChallenges } = await this.repositories();
    const challenge = mfaChallenges.create({
      userId: user.id,
      challengeId: uuidv4(),
      method: 'TOTP',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      ipAddress,
      userAgent,
      metadata: { userEmail: user.email, deviceId },
    });
    const saved = await mfaChallenges.save(challenge);
    const { browser, os } = this.parseUserAgent(userAgent);
    await this.recordSecurityEvent({
      userId: user.id,
      eventType: SecurityEventType.MFA_CHALLENGE_CREATED,
      ipAddress,
      browser,
      operatingSystem: os,
      metadata: { challengeId: saved.challengeId },
    });
    return saved;
  }

  async createMfaChallenge(email: string, password: string, userAgent?: string, ipAddress?: string) {
    const { users } = await this.repositories();
    const normalizedEmail = email.toLowerCase().trim();
    const user = await users.findOne({ where: { email: normalizedEmail, deletedAt: IsNull() } });
    if (!user) {
      return { requiresMfa: false };
    }
    const valid = await SecurityUtils.verifyPassword(password, user.passwordHash || '');
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const mfaConfig = await this.findMfaConfig(user.id);
    if (!mfaConfig?.enabled) {
      return { requiresMfa: false };
    }
    const challenge = await this.createMfaChallengeInternal(user, userAgent, ipAddress);
    return { requiresMfa: true, challengeId: challenge.challengeId, availableMethods: ['TOTP', 'RECOVERY_CODE'], expiresAt: challenge.expiresAt };
  }

  // ─────────────────────────────────────────────────────────
  // MFA Setup
  // ─────────────────────────────────────────────────────────

  async setupMfa(userId: string, email?: string) {
    const { userMfaConfigs, users } = await this.repositories();
    const user = await users.findOne({ where: { id: userId, deletedAt: IsNull() } });
    if (!user) throw new NotFoundException('User not found');

    const { secret, otpauthUri, manualKey } = SecurityUtils.generateTotpSecret(`${email || user.email}`);

    // Generate QR code
    const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUri);

    let config = await userMfaConfigs.findOne({ where: { userId } });
    if (!config) {
      config = userMfaConfigs.create({
        userId,
        method: 'TOTP',
        secretEncrypted: SecurityUtils.encrypt(secret),
        metadata: { pendingSetup: true },
      });
    } else {
      config.method = 'TOTP';
      config.secretEncrypted = SecurityUtils.encrypt(secret);
      config.metadata = { ...(config.metadata || {}), pendingSetup: true };
    }
    await userMfaConfigs.save(config);

    // Return QR code + manual key; never expose the raw secret after this call
    return { otpauthUri, qrCodeDataUrl, manualKey, issuer: 'PartnerIQ', method: 'TOTP' };
  }

  async verifyMfaSetup(userId: string, code: string) {
    const { userMfaConfigs, userRecoveryCodes } = await this.repositories();
    const config = await userMfaConfigs.findOne({ where: { userId } });
    if (!config?.secretEncrypted) {
      throw new BadRequestException('Authenticator setup has not been initiated');
    }
    const secret = SecurityUtils.decrypt(config.secretEncrypted);
    if (!SecurityUtils.verifyTotpCode(secret, code)) {
      throw new BadRequestException('Invalid authenticator code');
    }

    config.enabled = true;
    config.enabledAt = new Date();
    config.lastVerifiedAt = new Date();
    config.metadata = { ...(config.metadata || {}), pendingSetup: false };
    await userMfaConfigs.save(config);

    // Generate recovery codes
    const newRecoveryCodes = SecurityUtils.generateRecoveryCodes(10);
    const records = newRecoveryCodes.map((item) =>
      userRecoveryCodes.create({
        userId,
        codeHash: SecurityUtils.hashRecoveryCode(item),
      }),
    );
    await userRecoveryCodes.save(records);

    await this.recordSecurityEvent({
      userId,
      eventType: SecurityEventType.MFA_ENABLED,
      metadata: { method: 'TOTP' },
    });

    // Notify user
    this.sendSecurityNotificationSafe(userId, {
      title: 'Two-factor authentication enabled',
      body: 'Authenticator App has been successfully configured on your PartnerIQ account.',
      actionUrl: '/app/settings?tab=security',
    });

    return { success: true, recoveryCodes: newRecoveryCodes };
  }

  async regenerateRecoveryCodes(userId: string, code: string) {
    const { userRecoveryCodes, userMfaConfigs } = await this.repositories();
    const config = await userMfaConfigs.findOne({ where: { userId } });
    if (!config || !config.enabled || !config.secretEncrypted) {
      throw new BadRequestException('MFA is not enabled');
    }
    const secret = SecurityUtils.decrypt(config.secretEncrypted);
    if (!SecurityUtils.verifyTotpCode(secret, code)) {
      throw new BadRequestException('Invalid authenticator code');
    }

    // Invalidate all previous codes
    await userRecoveryCodes.update(
      { userId, usedAt: IsNull(), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    const newCodes = SecurityUtils.generateRecoveryCodes(10);
    const records = newCodes.map((item) =>
      userRecoveryCodes.create({
        userId,
        codeHash: SecurityUtils.hashRecoveryCode(item),
      }),
    );
    await userRecoveryCodes.save(records);

    await this.recordSecurityEvent({
      userId,
      eventType: SecurityEventType.RECOVERY_CODES_GENERATED,
      metadata: { count: newCodes.length },
    });

    return { success: true, recoveryCodes: newCodes };
  }

  async disableMfa(userId: string, password: string, code?: string) {
    const { users, userMfaConfigs, userRecoveryCodes, authSessions } = await this.repositories();
    const user = await users.findOne({ where: { id: userId, deletedAt: IsNull() } });
    if (!user) throw new NotFoundException('User not found');

    const valid = await SecurityUtils.verifyPassword(password, user.passwordHash || '');
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    const config = await userMfaConfigs.findOne({ where: { userId } });
    if (config?.enabled && config.secretEncrypted && code) {
      const secret = SecurityUtils.decrypt(config.secretEncrypted);
      if (!SecurityUtils.verifyTotpCode(secret, code)) {
        throw new BadRequestException('Invalid authenticator code');
      }
    } else if (config?.enabled && !code) {
      throw new BadRequestException('Authenticator code is required to disable MFA');
    }

    if (config) {
      config.enabled = false;
      config.secretEncrypted = undefined;
      config.enabledAt = undefined;
      config.metadata = { ...(config.metadata || {}), pendingSetup: false };
      await userMfaConfigs.save(config);
    }

    // Invalidate all recovery codes
    await userRecoveryCodes.update(
      { userId, usedAt: IsNull(), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    // Downgrade all active sessions to PASSWORD level (remove trusted MFA exemptions)
    await authSessions.update(
      { userId, revokedAt: IsNull() },
      { mfaVerifiedAt: undefined, authenticationLevel: AuthLevel.PASSWORD },
    );

    await this.recordSecurityEvent({
      userId,
      eventType: SecurityEventType.MFA_DISABLED,
      metadata: { method: 'TOTP' },
    });

    // Notify user
    this.sendSecurityNotificationSafe(userId, {
      title: 'Two-factor authentication disabled',
      body: 'Authenticator App has been disabled on your PartnerIQ account. If you did not do this, secure your account immediately.',
      actionUrl: '/app/settings?tab=security',
    });

    return { success: true, message: 'Authenticator App disabled.' };
  }

  // ─────────────────────────────────────────────────────────
  // MFA Challenge Verification (Login)
  // ─────────────────────────────────────────────────────────

  async verifyMfaChallenge(
    challengeId: string,
    code?: string,
    recoveryCode?: string,
    userAgent?: string,
    ipAddress?: string,
    trustDevice?: boolean,
  ) {
    const { mfaChallenges, users, userMfaConfigs, userRecoveryCodes } = await this.repositories();
    const { browser, os } = this.parseUserAgent(userAgent);

    const challenge = await mfaChallenges.findOne({ where: { challengeId } });
    if (!challenge) throw new BadRequestException('Invalid MFA challenge');
    if (challenge.usedAt || challenge.expiresAt < new Date()) {
      throw new BadRequestException('MFA challenge expired or already used');
    }

    const user = await users.findOne({ where: { id: challenge.userId, deletedAt: IsNull() } });
    if (!user) throw new NotFoundException('User not found');

    const config = await userMfaConfigs.findOne({ where: { userId: user.id } });
    if (!config || !config.enabled || !config.secretEncrypted) {
      throw new BadRequestException('MFA is unavailable for this account');
    }

    let verified = false;

    if (recoveryCode) {
      // Recovery code path
      const normalized = recoveryCode.trim().toUpperCase().replace(/\s/g, '');
      const candidates = await userRecoveryCodes.find({
        where: { userId: user.id, revokedAt: IsNull(), usedAt: IsNull() },
      });
      const match = candidates.find(
        (entry) => SecurityUtils.timingSafeCompare(
          entry.codeHash,
          SecurityUtils.hashRecoveryCode(normalized),
        ),
      );
      if (!match) throw new BadRequestException('Recovery code is invalid or already used');

      match.usedAt = new Date();
      await userRecoveryCodes.save(match);
      verified = true;

      await this.recordSecurityEvent({
        userId: user.id,
        eventType: SecurityEventType.RECOVERY_CODE_USED,
        ipAddress,
        browser,
        operatingSystem: os,
        metadata: { challengeId },
      });

      // Notify user that a recovery code was consumed
      this.sendSecurityNotificationSafe(user.id, {
        title: 'Recovery code used to sign in',
        body: 'A recovery code was used to access your PartnerIQ account. If this wasn\'t you, secure your account immediately.',
        actionUrl: '/app/settings?tab=security',
      });
    } else if (code) {
      const secret = SecurityUtils.decrypt(config.secretEncrypted);
      verified = SecurityUtils.verifyTotpCode(secret, code);
      if (!verified) {
        await this.recordSecurityEvent({
          userId: user.id,
          eventType: SecurityEventType.MFA_FAILED,
          ipAddress,
          browser,
          operatingSystem: os,
          metadata: { challengeId },
        });
        throw new BadRequestException('Invalid authenticator code');
      }
    } else {
      throw new BadRequestException('Verification code required');
    }

    // Mark challenge as consumed
    challenge.usedAt = new Date();
    await mfaChallenges.save(challenge);

    // Geolocation
    const geo = await lookupIp(ipAddress);

    // Device — use deviceId stored in challenge metadata if available
    const deviceId = challenge.metadata?.deviceId as string | undefined;
    let device: UserDevice | null = null;
    let isNewDevice = false;
    if (deviceId) {
      const { userDevices } = await this.repositories();
      device = await userDevices.findOne({ where: { id: deviceId, userId: user.id } }) ?? null;
    }
    if (!device) {
      const result = await this.upsertDeviceRecord(user.id, userAgent, ipAddress, geo ?? undefined);
      device = result.device;
      isNewDevice = result.isNew;
    }

    // Create authenticated session with MFA level
    const tokens = await this.createSessionAndTokens(
      user, userAgent, ipAddress,
      {
        deviceId: device.id,
        authLevel: AuthLevel.MFA,
        mfaVerifiedAt: new Date(),
        geo: geo ?? undefined,
        isNewDevice,
      },
    );

    // Record MFA success
    await this.recordSecurityEvent({
      userId: user.id,
      sessionId: tokens.sessionId,
      deviceId: device.id,
      eventType: SecurityEventType.MFA_SUCCESS,
      ipAddress,
      country: geo?.country,
      region: geo?.region,
      city: geo?.city,
      browser,
      operatingSystem: os,
      metadata: { challengeId },
    });

    await this.recordSecurityEvent({
      userId: user.id,
      sessionId: tokens.sessionId,
      deviceId: device.id,
      eventType: SecurityEventType.LOGIN_SUCCESS,
      ipAddress,
      country: geo?.country,
      region: geo?.region,
      city: geo?.city,
      browser,
      operatingSystem: os,
      metadata: { method: recoveryCode ? 'RECOVERY_CODE' : 'TOTP' },
    });

    if (isNewDevice) {
      await this.recordSecurityEvent({
        userId: user.id,
        sessionId: tokens.sessionId,
        deviceId: device.id,
        eventType: SecurityEventType.NEW_DEVICE_LOGIN,
        ipAddress,
        country: geo?.country,
        region: geo?.region,
        city: geo?.city,
        browser,
        operatingSystem: os,
        metadata: { deviceName: device.displayName },
      });

      this.sendSecurityNotificationSafe(user.id, {
        title: 'New device logged in to PartnerIQ',
        body: `A new login was detected from ${device.displayName || 'an unknown device'}.${geo ? ` Approximate location: ${[geo.city, geo.country].filter(Boolean).join(', ')}.` : ''} If this wasn't you, review your active sessions immediately.`,
        actionUrl: '/app/settings?tab=security',
      });
    }

    // Trust device if requested
    if (trustDevice && device) {
      await this.trustDevice(user.id, device.id, tokens.sessionId);
    }

    return tokens;
  }

  async verifyRecoveryCode(challengeId: string, recoveryCode?: string, userAgent?: string, ipAddress?: string) {
    return this.verifyMfaChallenge(challengeId, undefined, recoveryCode, userAgent, ipAddress);
  }

  // ─────────────────────────────────────────────────────────
  // Token Refresh
  // ─────────────────────────────────────────────────────────

  async refreshToken(rawRefreshToken: string, userAgent?: string, ipAddress?: string) {
    const { users, authSessions } = await this.repositories();
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }

    const jwtConfig = getJwtConfig();
    let decoded: any;
    try {
      decoded = jwt.verify(rawRefreshToken, jwtConfig.refreshSecret, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (decoded.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const incomingHash = SecurityUtils.hashToken(rawRefreshToken);
    const session = await authSessions.findOne({ where: { id: decoded.sid } });

    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    if (session.revokedAt || session.refreshTokenHash !== incomingHash) {
      // Rotation Grace Period: If the session was rotated recently (within 15 minutes),
      // allow concurrent requests from the same client to retrieve the active session tokens
      // instead of falsely triggering token reuse revocation.
      const ROTATION_GRACE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes
      if (
        session.revokedAt &&
        session.revokeReason === 'TOKEN_ROTATED' &&
        Date.now() - new Date(session.revokedAt).getTime() < ROTATION_GRACE_PERIOD_MS
      ) {
        const activeSession = await authSessions.findOne({
          where: { tokenFamilyId: decoded.tfid, revokedAt: IsNull() },
          order: { createdAt: 'DESC' },
        });

        if (activeSession) {
          const activeUser = await users.findOne({
            where: { id: activeSession.userId, deletedAt: IsNull() },
          });
          if (activeUser) {
            const freshAccessToken = jwt.sign(
              { sub: activeUser.id, sid: activeSession.id, type: 'access' },
              jwtConfig.accessSecret,
              { expiresIn: jwtConfig.accessTtl } as SignOptions,
            );
            const freshRefreshToken = jwt.sign(
              { sub: activeUser.id, sid: activeSession.id, tfid: activeSession.tokenFamilyId, type: 'refresh' },
              jwtConfig.refreshSecret,
              { expiresIn: jwtConfig.refreshTtl } as SignOptions,
            );
            activeSession.refreshTokenHash = SecurityUtils.hashToken(freshRefreshToken);
            activeSession.lastUsedAt = new Date();
            await authSessions.save(activeSession);

            return {
              accessToken: freshAccessToken,
              refreshToken: freshRefreshToken,
              sessionId: activeSession.id,
              user: {
                id: activeUser.id,
                email: activeUser.email,
                firstName: activeUser.firstName,
                lastName: activeUser.lastName,
              },
            };
          }
        }
      }

      // Token reuse detected — revoke entire family
      await authSessions.update(
        { tokenFamilyId: decoded.tfid },
        { revokedAt: new Date(), revokeReason: 'TOKEN_REUSE_DETECTED' },
      );
      await this.recordSecurityEvent({
        sessionId: session.id,
        userId: session.userId,
        eventType: SecurityEventType.REFRESH_TOKEN_REUSE_DETECTED,
        ipAddress,
        metadata: { tokenFamilyId: decoded.tfid },
      });

      // Notify user of potential token theft
      this.sendSecurityNotificationSafe(session.userId, {
        title: 'Security alert: suspicious session activity detected',
        body: 'An attempt was made to reuse an old session token. For your security, all sessions have been revoked. Please log in again.',
        actionUrl: '/app/settings?tab=security',
      });

      throw new UnauthorizedException('Session security violation detected. Please log in again.');
    }

    const user = await users.findOne({
      where: { id: session.userId, deletedAt: IsNull() },
    });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    // Rotate: create new session, revoke old
    const newSession = authSessions.create({
      userId: user.id,
      refreshTokenHash: '',
      tokenFamilyId: session.tokenFamilyId,
      userAgent: userAgent || session.userAgent,
      ipAddress: ipAddress || session.ipAddress,
      deviceId: session.deviceId,
      organizationContextId: session.organizationContextId,
      authenticationLevel: session.authenticationLevel,
      mfaVerifiedAt: session.mfaVerifiedAt,
      country: session.country,
      region: session.region,
      city: session.city,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      lastUsedAt: new Date(),
    });
    const savedSession = await authSessions.save(newSession);

    const newRawRefreshToken = jwt.sign(
      { sub: user.id, sid: savedSession.id, tfid: session.tokenFamilyId, type: 'refresh' },
      jwtConfig.refreshSecret,
      { expiresIn: jwtConfig.refreshTtl } as SignOptions,
    );

    const newAccessToken = jwt.sign(
      { sub: user.id, sid: savedSession.id, type: 'access' },
      jwtConfig.accessSecret,
      { expiresIn: jwtConfig.accessTtl } as SignOptions,
    );

    // Revoke old session after new is created
    session.revokedAt = new Date();
    session.revokeReason = 'TOKEN_ROTATED';
    savedSession.refreshTokenHash = SecurityUtils.hashToken(newRawRefreshToken);
    await authSessions.save([session, savedSession]);

    await this.recordSecurityEvent({
      userId: user.id,
      sessionId: savedSession.id,
      eventType: SecurityEventType.REFRESH_TOKEN_ROTATED,
      ipAddress,
      metadata: { tokenFamilyId: session.tokenFamilyId },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
      sessionId: savedSession.id,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // Logout
  // ─────────────────────────────────────────────────────────

  async logout(sessionId: string, userId?: string) {
    const { authSessions } = await this.repositories();
    const session = await authSessions.findOne({ where: { id: sessionId } });
    if (session) {
      session.revokedAt = new Date();
      session.revokeReason = 'USER_LOGOUT';
      await authSessions.save(session);
    }
    if (userId) {
      await this.recordSecurityEvent({
        userId,
        sessionId,
        eventType: SecurityEventType.LOGOUT,
        metadata: {},
      });
    }
    return { success: true, message: 'Logged out successfully' };
  }

  async logoutAll(userId: string) {
    const { authSessions } = await this.repositories();
    await authSessions.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokeReason: 'LOGOUT_ALL' },
    );
    await this.recordSecurityEvent({
      userId,
      eventType: SecurityEventType.LOGOUT_ALL,
      metadata: {},
    });
    return { success: true, message: 'All sessions revoked successfully' };
  }

  // ─────────────────────────────────────────────────────────
  // Current User
  // ─────────────────────────────────────────────────────────

  async getMe(userId?: string) {
    const { users, memberships, organizations } = await this.repositories();
    const user = await users.findOne({
      where: { id: userId, deletedAt: IsNull() },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    let isSuperAdmin = user.platformRole === PlatformRole.SUPER_ADMIN || this.isConfiguredSuperAdmin(user.email);
    if (isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      user.platformRole = PlatformRole.SUPER_ADMIN;
      try {
        await users.save(user);
      } catch { }
    }

    // 1. Fetch all existing organizations created by this user
    let userOwnedOrgs: Organization[] = [];
    try {
      userOwnedOrgs = await organizations.find({
        where: { createdBy: user?.id, deletedAt: IsNull() },
      });
    } catch (e) { }

    // 2. Fetch all active memberships for this user
    const activeMemberships = await memberships.find({
      where: { userId: user.id, status: MembershipStatus.ACTIVE },
    });

    // 3. For each membership, verify the organization exists in DB
    const validMemberships: Array<{
      organizationId: string;
      organizationName: string;
      role: Role;
      programAccessType: ProgramAccessType;
      programIds: string[];
      permissions: string[];
    }> = [];

    const checkedOrgIds = new Set<string>();

    for (const mem of activeMemberships) {
      let org = userOwnedOrgs.find((o) => o.id === mem.organizationId);
      if (!org) {
        try {
          org = (await organizations.findOne({
            where: { id: mem.organizationId, deletedAt: IsNull() },
          })) || undefined;
          if (org) {
            userOwnedOrgs.push(org);
          }
        } catch (e) { }
      }

      if (org) {
        checkedOrgIds.add(org.id);
        if (!dbStore.organizations.some((o) => o.id === org.id)) {
          dbStore.organizations.push(org);
        }
        if (!dbStore.organizationMemberships.some((m) => m.id === mem.id)) {
          dbStore.organizationMemberships.push(mem);
        }
        validMemberships.push({
          organizationId: org.id,
          organizationName: org.name,
          role: mem.role as Role,
          programAccessType: mem.programAccessType,
          programIds: mem.programIds || [],
          permissions: getRolePermissions(mem.role as Role),
        });
      } else {
        // Stale orphaned membership: purge from DB and dbStore
        try {
          await memberships.delete({ id: mem.id });
          dbStore.organizationMemberships = dbStore.organizationMemberships.filter((m) => m.id !== mem.id) as any;
        } catch (e) { }
      }
    }

    // 4. If user created an organization in DB but has no active membership record, restore OWNER membership
    for (const org of userOwnedOrgs) {
      if (!checkedOrgIds.has(org.id)) {
        try {
          const newMem = memberships.create({
            id: uuidv4(),
            organizationId: org.id,
            userId,
            role: Role.OWNER,
            status: MembershipStatus.ACTIVE,
            programAccessType: ProgramAccessType.ALL,
            programIds: [],
            joinedAt: new Date(),
          });
          await memberships.save(newMem);
          if (!dbStore.organizationMemberships.some((m) => m.id === newMem.id)) {
            dbStore.organizationMemberships.push(newMem);
          }
          if (!dbStore.organizations.some((o) => o.id === org.id)) {
            dbStore.organizations.push(org);
          }
          validMemberships.push({
            organizationId: org.id,
            organizationName: org.name,
            role: Role.OWNER,
            programAccessType: ProgramAccessType.ALL,
            programIds: [],
            permissions: getRolePermissions(Role.OWNER),
          });
        } catch (e) { }
      }
    }

    // 5. Super admin fallback to all organizations
    if (isSuperAdmin) {
      try {
        const allDbOrgs = await organizations.find({ where: { deletedAt: IsNull() } });
        for (const dbOrg of allDbOrgs) {
          if (!dbStore.organizations.some((o) => o.id === dbOrg.id)) {
            dbStore.organizations.push(dbOrg);
          }
        }
      } catch (e) { }

      const allOrgs = dbStore.organizations.filter((o) => !o.deletedAt);
      for (const org of allOrgs) {
        if (!validMemberships.some((m) => m.organizationId === org.id)) {
          validMemberships.push({
            organizationId: org.id,
            organizationName: org.name,
            role: Role.SUPER_ADMIN,
            programAccessType: ProgramAccessType.ALL,
            programIds: [],
            permissions: getRolePermissions(Role.SUPER_ADMIN),
          });
        }
      }
    }
    const userMemberships = validMemberships;

    // Get MFA status
    const mfaStatus = await this.getMfaStatus(user?.id);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      emailVerified: user.emailVerified,
      platformRole: user.platformRole,
      isSuperAdmin,
      memberships: userMemberships,
      mfa: {
        enabled: mfaStatus.enabled,
        method: mfaStatus.method,
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // Password Management
  // ─────────────────────────────────────────────────────────

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const { users } = await this.repositories();
    const user = await users.findOne({
      where: { id: userId, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException('User not found');

    const isValid = await SecurityUtils.verifyPassword(dto.currentPassword, user.passwordHash || '');
    if (!isValid) throw new BadRequestException('Current password is incorrect');

    user.passwordHash = await SecurityUtils.hashPassword(dto.newPassword);
    user.updatedAt = new Date();
    await users.save(user);

    // Revoke all sessions on password change
    await this.logoutAll(userId);

    await this.recordSecurityEvent({
      userId,
      eventType: SecurityEventType.PASSWORD_CHANGED,
      metadata: {},
    });

    // Notify user
    this.sendSecurityNotificationSafe(userId, {
      title: 'Your password was changed',
      body: 'Your PartnerIQ account password has been updated. All active sessions have been signed out. If you did not make this change, contact support immediately.',
      actionUrl: '/app/settings?tab=security',
    });

    return { success: true, message: 'Password changed successfully. Please log in again.' };
  }

  async forgotPassword(email: string, portalOrOrigin?: string, requestOrigin?: string) {
    const { users } = await this.repositories();
    const normalizedEmail = email ? email.toLowerCase().trim() : '';
    this.logger.log(`[ForgotPassword] Request received for: "${normalizedEmail}"`);

    let user = await users.findOne({ where: { email: normalizedEmail, deletedAt: IsNull() } });
    if (!user) {
      user = dbStore.users.find((u) => u.email?.toLowerCase().trim() === normalizedEmail && !u.deletedAt) as any;
    }

    if (user && user.status !== UserStatus.LOCKED) {
      this.logger.log(`[ForgotPassword] User found (ID: ${user.id}, Role: ${user.platformRole}). Generating password reset token...`);
      const jwtConfig = getJwtConfig();
      const appConfig = getAppConfig();
      const pwStamp = (user.passwordHash || '').substring(0, 12);

      const resetToken = jwt.sign(
        {
          sub: user.id,
          email: user.email,
          purpose: 'password_reset',
          pwStamp,
        },
        jwtConfig.accessSecret,
        { expiresIn: '1h' } as SignOptions,
      );

      // Resolve destination frontend url from env or origins
      let baseUrl = appConfig.frontendUrl;
      const isAffiliate =
        portalOrOrigin === 'affiliate' ||
        portalOrOrigin === 'affiliate-portal' ||
        (requestOrigin && (requestOrigin.includes('3005') || requestOrigin.includes('affiliate'))) ||
        (portalOrOrigin && (portalOrOrigin.includes('3005') || portalOrOrigin.includes('affiliate')));

      if (isAffiliate) {
        baseUrl = appConfig.affiliateFrontendUrl;
      } else if (portalOrOrigin && portalOrOrigin.startsWith('http')) {
        baseUrl = portalOrOrigin;
      } else if (requestOrigin && requestOrigin.startsWith('http')) {
        baseUrl = requestOrigin;
      }

      baseUrl = baseUrl.replace(/\/$/, '');
      const resetPasswordUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
      this.logger.log(`[ForgotPassword] Destination URL: ${resetPasswordUrl}`);

      await this.dispatchPasswordResetEmail(user, resetPasswordUrl);

      await this.recordSecurityEvent({
        userId: user.id,
        eventType: SecurityEventType.PASSWORD_RESET,
        metadata: { stage: 'requested', destination: isAffiliate ? 'affiliate' : 'frontend' },
      });
    } else {
      this.logger.warn(`[ForgotPassword] No eligible active user found for email: "${normalizedEmail}"`);
    }

    // Timing-safe response
    return { success: true, message: 'If an account exists for this email, a password reset link has been sent.' };
  }

  async verifyResetToken(token: string) {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('Reset token is required');
    }

    const jwtConfig = getJwtConfig();
    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtConfig.accessSecret);
    } catch {
      throw new BadRequestException('Password reset link is invalid or has expired.');
    }

    if (decoded.purpose !== 'password_reset' || !decoded.sub) {
      throw new BadRequestException('Invalid reset token.');
    }

    const { users } = await this.repositories();
    let user = await users.findOne({ where: { id: decoded.sub, deletedAt: IsNull() } });
    if (!user) {
      user = dbStore.users.find((u) => u.id === decoded.sub && !u.deletedAt) as any;
    }
    if (!user) {
      throw new NotFoundException('User account no longer exists.');
    }

    const currentPwStamp = (user.passwordHash || '').substring(0, 12);
    if (decoded.pwStamp !== currentPwStamp) {
      throw new BadRequestException('Password reset link has already been used or expired.');
    }

    return {
      valid: true,
      email: user.email,
      firstName: user.firstName,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const verified = await this.verifyResetToken(dto.token);
    const { users } = await this.repositories();

    const normalizedEmail = verified.email.toLowerCase().trim();
    let user = await users.findOne({ where: { email: normalizedEmail, deletedAt: IsNull() } });
    if (!user) {
      user = dbStore.users.find((u) => u.email?.toLowerCase().trim() === normalizedEmail && !u.deletedAt) as any;
    }
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!dto.newPassword || dto.newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters long');
    }

    user.passwordHash = await SecurityUtils.hashPassword(dto.newPassword);
    user.updatedAt = new Date();
    await users.save(user);

    // In-memory sync
    const memUser = dbStore.users.find((u) => u.id === user.id);
    if (memUser) {
      memUser.passwordHash = user.passwordHash;
      memUser.updatedAt = user.updatedAt;
    }

    // Revoke all existing sessions on password reset
    await this.logoutAll(user.id);

    await this.recordSecurityEvent({
      userId: user.id,
      eventType: SecurityEventType.PASSWORD_CHANGED,
      metadata: { source: 'password_reset_flow' },
    });

    // Send confirmation security notification
    this.sendSecurityNotificationSafe(user.id, {
      title: 'Your password was successfully reset',
      body: 'Your PartnerIQ account password has been updated. All previous active sessions have been signed out.',
      actionUrl: '/auth',
    });

    return { success: true, message: 'Password has been successfully reset. You can now sign in.' };
  }

  private async dispatchPasswordResetEmail(user: User, resetPasswordUrl: string) {
    const templateKey = AUTH_EMAIL_TEMPLATES.PASSWORD_RESET;
    const recipientEmail = user.email;
    const firstName = user.firstName || 'User';

    this.logger.log(`[DispatchEmail] Sending password reset email to ${recipientEmail} with templateKey: ${templateKey}`);

    const payload = {
      subject: 'Reset your PartnerIQ password',
      preheader: 'Click the secure link below to choose a new password.',
      user: { firstName, name: firstName, email: recipientEmail },
      userName: firstName,
      firstName,
      recipientEmail,
      email: recipientEmail,
      links: { resetPasswordUrl, actionUrl: resetPasswordUrl, resetUrl: resetPasswordUrl },
      resetPasswordUrl,
      actionUrl: resetPasswordUrl,
      resetUrl: resetPasswordUrl,
      url: resetPasswordUrl,
      expiryMinutes: 60,
      expiryTime: '60 minutes',
      organizationName: 'PartnerIQ',
    };

    let sent = false;

    // 1. Try queued worker path if available
    if (this.emailQueueProducer && this.emailQueueWorker) {
      try {
        const { jobId } = await this.emailQueueProducer.enqueue({
          templateKey,
          recipientEmail,
          payload,
          userId: user.id,
          metadata: { source: 'password-reset-request' },
        });
        const processedLog = await this.emailQueueWorker.processJob(jobId);
        if (processedLog.status === 'SENT') {
          sent = true;
          this.logger.log(`[DispatchEmail] Password reset email job [${jobId}] processed and SENT via ${processedLog.provider}`);
        } else {
          this.logger.warn(`[DispatchEmail] Queue job [${jobId}] returned status: ${processedLog.status} (${processedLog.failureMessage || 'Unknown issue'}). Invoking direct fallback.`);
        }
      } catch (queueErr: any) {
        this.logger.error(`[DispatchEmail] Error in queue processing: ${queueErr?.message}. Invoking direct fallback.`);
      }
    }

    // 2. Direct Delivery Fallback (if queue failed or wasn't available)
    if (!sent) {
      const apiKey = process.env.BREVO_API_KEY;
      const senderEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@partneriq.local';
      const senderName = process.env.BREVO_SENDER_NAME || 'PartnerIQ';

      const defaultHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><title>Reset your password</title></head>
<body style="margin:0;padding:24px;background:#F8FAFC;font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #E2E8F0;padding:36px 32px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
    <h1 style="margin:0 0 16px 0;font-size:24px;font-weight:800;color:#0F172A;letter-spacing:-0.5px;">Reset your password</h1>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#334155;">Hi ${firstName},</p>
    <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#334155;">We received a request to reset the password for your PartnerIQ account. Click the button below to choose a new secure password:</p>
    <div style="margin:0 0 28px 0;">
      <a href="${resetPasswordUrl}" target="_blank" style="display:inline-block;padding:14px 28px;background-color:#2563EB;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;letter-spacing:0.2px;">Reset Password &rarr;</a>
    </div>
    <p style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:#64748B;">This password reset link is valid for <strong>60 minutes</strong>. If you did not request this, you can safely ignore this email &mdash; your account remains secure.</p>
    <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0;"/>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#94A3B8;">If you're having trouble clicking the button, copy and paste this URL into your browser:<br/><a href="${resetPasswordUrl}" style="color:#2563EB;word-break:break-all;">${resetPasswordUrl}</a></p>
  </div>
</body>
</html>`;

      if (apiKey) {
        try {
          const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'api-key': apiKey,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              sender: { email: senderEmail, name: senderName },
              to: [{ email: recipientEmail }],
              subject: 'Reset your PartnerIQ password',
              htmlContent: defaultHtml,
              textContent: `Hi ${firstName},\n\nReset your PartnerIQ password using this link: ${resetPasswordUrl}\n\nThis link is valid for 60 minutes.`,
            }),
          });

          if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            this.logger.error(`[DispatchEmail] Brevo direct password reset email delivery failed (${response.status}): ${errBody}`);
          } else {
            const resJson = await response.json().catch(() => ({}));
            this.logger.log(`[DispatchEmail] Brevo direct password reset email delivered to ${recipientEmail} (MsgId: ${resJson?.messageId || resJson?.messageIds?.[0]})`);
            sent = true;
          }
        } catch (fetchErr: any) {
          this.logger.error(`[DispatchEmail] Brevo network request failed: ${fetchErr?.message}`);
        }
      } else {
        this.logger.warn(`[DispatchEmail] [DEV MODE] Password reset email simulated for ${recipientEmail}.\n👉 Reset Link: ${resetPasswordUrl}`);
        sent = true;
      }

      // Record in delivery logs
      const jobId = uuidv4();
      const [localPart, domain] = recipientEmail.split('@');
      const maskedEmail = `${localPart.substring(0, 2)}***@${domain || 'local'}`;
      dbStore.emailDeliveryLogs.unshift({
        id: jobId,
        messageId: jobId,
        templateKey,
        recipientEmail,
        recipientEmailMasked: maskedEmail,
        subject: 'Reset your PartnerIQ password',
        provider: apiKey ? 'brevo' : 'development',
        status: sent ? 'SENT' : 'FAILED',
        attemptCount: 1,
        sentAt: sent ? new Date() : undefined,
        failedAt: sent ? undefined : new Date(),
        metadata: {
          payload,
          userId: user.id,
        },
        queuedAt: new Date(),
        createdAt: new Date(),
      } as any);
    }
  }

  // ─────────────────────────────────────────────────────────
  // User cleanup (for onboarding rollback)
  // ─────────────────────────────────────────────────────────

  async removeNewlyRegisteredUser(userId: string) {
    const { users, authSessions } = await this.repositories();
    await authSessions.delete({ userId });
    await users.delete({ id: userId });

    const userIndex = dbStore.users.findIndex((item) => item.id === userId);
    if (userIndex >= 0) {
      dbStore.users.splice(userIndex, 1);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Session + Token Creation
  // ─────────────────────────────────────────────────────────

  public async createSessionAndTokens(
    user: User,
    userAgent?: string,
    ipAddress?: string,
    opts?: {
      deviceId?: string;
      authLevel?: AuthLevel;
      mfaVerifiedAt?: Date;
      geo?: { country?: string; region?: string; city?: string };
      organizationContextId?: string;
      isNewDevice?: boolean;
    },
  ) {
    const { authSessions } = await this.repositories();
    const jwtConfig = getJwtConfig();

    const session = authSessions.create({
      userId: user.id,
      refreshTokenHash: '',
      tokenFamilyId: uuidv4(),
      userAgent,
      ipAddress,
      deviceId: opts?.deviceId,
      organizationContextId: opts?.organizationContextId,
      authenticationLevel: opts?.authLevel ?? AuthLevel.PASSWORD,
      mfaVerifiedAt: opts?.mfaVerifiedAt,
      country: opts?.geo?.country,
      region: opts?.geo?.region,
      city: opts?.geo?.city,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      idleExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      lastUsedAt: new Date(),
    });
    const savedSession = await authSessions.save(session);

    const refreshToken = jwt.sign(
      { sub: user.id, sid: savedSession.id, tfid: savedSession.tokenFamilyId, type: 'refresh' },
      jwtConfig.refreshSecret,
      { expiresIn: jwtConfig.refreshTtl } as SignOptions,
    );

    const accessToken = jwt.sign(
      { sub: user.id, sid: savedSession.id, type: 'access' },
      jwtConfig.accessSecret,
      { expiresIn: jwtConfig.accessTtl } as SignOptions,
    );

    savedSession.refreshTokenHash = SecurityUtils.hashToken(refreshToken);
    await authSessions.save(savedSession);

    return {
      accessToken,
      refreshToken,
      sessionId: savedSession.id,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        platformRole: user.platformRole,
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // Security Notifications (fire-and-forget)
  // ─────────────────────────────────────────────────────────

  private sendSecurityNotificationSafe(
    userId: string,
    opts: { title: string; body: string; actionUrl?: string; metadata?: Record<string, any> },
  ) {
    try {
      const notification = {
        id: uuidv4(),
        userId,
        organizationId: undefined,
        type: 'security' as any,
        title: opts.title,
        body: opts.body,
        channel: 'in_app' as any,
        priority: 'high' as any,
        isRead: false,
        createdAt: new Date().toISOString(),
        actionUrl: opts.actionUrl,
        metadata: opts.metadata || {},
      };
      dbStore.notifications.unshift(notification as any);

      // Dispatch security email notification if user email is found
      const user = dbStore.users.find((u) => u.id === userId);
      if (user && user.email) {
        let templateKey: string = AUTH_EMAIL_TEMPLATES.PASSWORD_CHANGED;
        const titleLower = opts.title.toLowerCase();
        if (titleLower.includes('2fa') || titleLower.includes('two-factor')) {
          templateKey = titleLower.includes('disabled')
            ? AUTH_EMAIL_TEMPLATES.TWO_FACTOR_DISABLED
            : AUTH_EMAIL_TEMPLATES.TWO_FACTOR_ENABLED;
        } else if (titleLower.includes('login') || titleLower.includes('device')) {
          templateKey = AUTH_EMAIL_TEMPLATES.NEW_LOGIN_ALERT;
        }

        const securityPayload = {
          timestamp: new Date().toLocaleString(),
          details: opts.body,
          actionUrl: opts.actionUrl || '/app/settings?tab=security',
          deviceName: opts.metadata?.deviceName || 'Web Browser / Workstation',
          location: opts.metadata?.location || 'Current Network Location',
          ipAddress: opts.metadata?.ipAddress || 'Authorized Network IP',
          ...(opts.metadata || {}),
        };

        if (this.emailQueueProducer && this.emailQueueWorker) {
          this.emailQueueProducer.enqueue({
            templateKey,
            recipientEmail: user.email,
            payload: {
              subject: opts.title,
              preheader: opts.body,
              user: { firstName: user.firstName, lastName: user.lastName, email: user.email },
              security: securityPayload,
              links: {
                dashboardUrl: opts.actionUrl || '/app/settings?tab=security',
                securityUrl: opts.actionUrl || '/app/settings?tab=security',
              },
            },
            userId,
            metadata: { source: 'auth-security-notification', ...(opts.metadata || {}) },
          }).then(({ jobId }) => this.emailQueueWorker?.processJob(jobId)).catch(() => undefined);
        } else {
          const jobId = uuidv4();
          const [localPart, domain] = user.email.split('@');
          const maskedEmail = `${localPart.substring(0, 2)}***@${domain}`;
          dbStore.emailDeliveryLogs.unshift({
            id: jobId,
            messageId: jobId,
            templateKey,
            recipientEmail: user.email,
            recipientEmailMasked: maskedEmail,
            subject: opts.title,
            provider: process.env.BREVO_API_KEY ? 'brevo' : 'development',
            status: 'QUEUED',
            attemptCount: 0,
            metadata: {
              payload: {
                subject: opts.title,
                preheader: opts.body,
                user: { firstName: user.firstName, lastName: user.lastName, email: user.email },
                security: securityPayload,
              },
              userId,
            },
            queuedAt: new Date(),
            createdAt: new Date(),
          } as any);
        }
      }
    } catch {
      // Non-fatal — security event already recorded separately
    }
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  public isConfiguredSuperAdmin(email: string) {
    const superAdminEmails = (process.env.SUPER_ADMIN_EMAILS || 'admin@partneriq.demo,superadmin@partneriq.demo')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return superAdminEmails.includes((email || '').trim().toLowerCase());
  }
}
