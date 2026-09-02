import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import jwtPkg, { SignOptions } from 'jsonwebtoken';
const jwt = (jwtPkg as any).default || jwtPkg;
import { IsNull } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { initializeDataSource } from '../../database/data-source';
import {
  AuthSecurityEvent,
  AuthSession,
  MfaChallenge,
  Organization,
  OrganizationMembership,
  User,
  UserDevice,
  UserMfaConfig,
  UserRecoveryCode,
} from '../../database/schema';
import { dbStore } from '../../database/store';
import { SecurityUtils } from '../../common/utils/security.utils';
import { getJwtConfig } from '../../config/jwt.config';
import { PlatformRole, Role, UserStatus } from '../../common/enums';
import { MembershipStatus, ProgramAccessType } from '../../common/enums/rbac';
import { getRolePermissions } from '../../common/constants/permissions';
import {
  RegisterDto,
  LoginDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
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
    };
  }

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

  private async findMfaConfig(userId: string) {
    const { userMfaConfigs } = await this.repositories();
    return userMfaConfigs.findOne({ where: { userId } });
  }

  private async upsertDeviceRecord(userId: string, userAgent?: string, ipAddress?: string) {
    const { userDevices } = await this.repositories();
    const deviceKey = SecurityUtils.hashToken(`${userAgent || 'unknown'}:${ipAddress || 'unknown'}`);
    const existing = await userDevices.findOne({ where: { userId, deviceIdentifierHash: deviceKey } });
    const browser = userAgent?.match(/(Chrome|Firefox|Safari|Edge|Opera)\//)?.[1] || 'Unknown';
    const os = userAgent?.match(/(Windows|Mac OS|Android|iPhone|iPad|Linux)/)?.[1] || 'Unknown';
    if (existing) {
      existing.lastSeenAt = new Date();
      existing.lastIpAddress = ipAddress;
      existing.displayName = `${browser} on ${os}`;
      existing.browser = browser;
      existing.operatingSystem = os;
      await userDevices.save(existing);
      return existing;
    }

    const device = userDevices.create({
      userId,
      deviceIdentifierHash: deviceKey,
      displayName: `${browser} on ${os}`,
      deviceType: browser === 'Safari' && os.includes('iPhone') ? 'Mobile' : 'Desktop',
      operatingSystem: os,
      browser,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      lastIpAddress: ipAddress,
      isTrusted: false,
    });
    return userDevices.save(device);
  }

  async register(dto: RegisterDto, userAgent?: string, ipAddress?: string) {
    const { users } = await this.repositories();
    const normalizedEmail = dto.email.toLowerCase().trim();

    const existing = await users.findOne({
      where: { email: normalizedEmail, deletedAt: IsNull() },
    });
    if (existing) {
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

  async login(dto: LoginDto, userAgent?: string, ipAddress?: string) {
    const { users } = await this.repositories();
    const normalizedEmail = dto.email.toLowerCase().trim();
    const user = await users.findOne({
      where: { email: normalizedEmail, deletedAt: IsNull() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
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
        eventType: 'LOGIN_FAILED',
        ipAddress,
        browser: userAgent?.match(/(Chrome|Firefox|Safari|Edge|Opera)\//)?.[1],
        operatingSystem: userAgent?.match(/(Windows|Mac OS|Android|iPhone|iPad|Linux)/)?.[1],
        metadata: { email: user.email },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    await users.save(user);

    const mfaConfig = await this.findMfaConfig(user.id);
    if (mfaConfig?.enabled) {
      const challenge = await this.createMfaChallengeInternal(user, userAgent, ipAddress);
      return { requiresMfa: true, challengeId: challenge.challengeId, availableMethods: ['TOTP', 'RECOVERY_CODE'], expiresAt: challenge.expiresAt };
    }

    const tokens = await this.createSessionAndTokens(user, userAgent, ipAddress);
    await this.recordSecurityEvent({
      userId: user.id,
      eventType: 'LOGIN_SUCCESS',
      ipAddress,
      browser: userAgent?.match(/(Chrome|Firefox|Safari|Edge|Opera)\//)?.[1],
      operatingSystem: userAgent?.match(/(Windows|Mac OS|Android|iPhone|iPad|Linux)/)?.[1],
      metadata: { email: user.email },
    });
    return tokens;
  }

  private async createMfaChallengeInternal(user: User, userAgent?: string, ipAddress?: string) {
    const { mfaChallenges } = await this.repositories();
    const challenge = mfaChallenges.create({
      userId: user.id,
      challengeId: uuidv4(),
      method: 'TOTP',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      ipAddress,
      userAgent,
      metadata: { userEmail: user.email },
    });
    const saved = await mfaChallenges.save(challenge);
    await this.recordSecurityEvent({
      userId: user.id,
      eventType: 'MFA_CHALLENGE_CREATED',
      ipAddress,
      browser: userAgent?.match(/(Chrome|Firefox|Safari|Edge|Opera)\//)?.[1],
      operatingSystem: userAgent?.match(/(Windows|Mac OS|Android|iPhone|iPad|Linux)/)?.[1],
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

  async setupMfa(userId: string, email?: string) {
    const { userMfaConfigs, users } = await this.repositories();
    const user = await users.findOne({ where: { id: userId, deletedAt: IsNull() } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const { secret, otpauthUri, manualKey } = SecurityUtils.generateTotpSecret(`${email || user.email}`);
    let config = await userMfaConfigs.findOne({ where: { userId } });
    if (!config) {
      config = userMfaConfigs.create({ userId, method: 'TOTP', secretEncrypted: SecurityUtils.encrypt(secret), metadata: { pendingSetup: true } });
    } else {
      config.method = 'TOTP';
      config.secretEncrypted = SecurityUtils.encrypt(secret);
      config.metadata = { ...(config.metadata || {}), pendingSetup: true };
    }
    await userMfaConfigs.save(config);
    return { otpauthUri, secret, manualKey, issuer: 'PartnerIQ', method: 'TOTP' };
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

    const newRecoveryCodes = SecurityUtils.generateRecoveryCodes(10);
    const records = newRecoveryCodes.map((item) => userRecoveryCodes.create({
      userId,
      codeHash: SecurityUtils.hashRecoveryCode(item),
    }));
    await userRecoveryCodes.save(records);

    await this.recordSecurityEvent({ userId, eventType: 'MFA_ENABLED', metadata: { method: 'TOTP' } });
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

    await userRecoveryCodes.delete({ userId });
    const newCodes = SecurityUtils.generateRecoveryCodes(10);
    const records = newCodes.map((item) => userRecoveryCodes.create({
      userId,
      codeHash: SecurityUtils.hashRecoveryCode(item),
    }));
    await userRecoveryCodes.save(records);
    await this.recordSecurityEvent({ userId, eventType: 'RECOVERY_CODES_GENERATED', metadata: { count: newCodes.length } });
    return { success: true, recoveryCodes: newCodes };
  }

  async disableMfa(userId: string, password: string, code?: string) {
    const { users, userMfaConfigs, userRecoveryCodes } = await this.repositories();
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
    }

    if (config) {
      config.enabled = false;
      config.secretEncrypted = undefined;
      config.metadata = { ...(config.metadata || {}), pendingSetup: false };
      await userMfaConfigs.save(config);
    }
    await userRecoveryCodes.delete({ userId });
    await this.recordSecurityEvent({ userId, eventType: 'MFA_DISABLED', metadata: { method: 'TOTP' } });
    return { success: true, message: 'Authenticator App disabled.' };
  }

  async verifyMfaChallenge(challengeId: string, code?: string, recoveryCode?: string, userAgent?: string, ipAddress?: string) {
    const { mfaChallenges, users, userMfaConfigs, userRecoveryCodes, authSessions } = await this.repositories();
    const challenge = await mfaChallenges.findOne({ where: { challengeId } });
    if (!challenge) throw new BadRequestException('Invalid MFA challenge');
    if (challenge.usedAt || challenge.expiresAt < new Date()) { throw new BadRequestException('MFA challenge expired or already used'); }

    const user = await users.findOne({ where: { id: challenge.userId, deletedAt: IsNull() } });
    if (!user) throw new NotFoundException('User not found');

    const config = await userMfaConfigs.findOne({ where: { userId: user.id } });
    if (!config || !config.enabled || !config.secretEncrypted) {
      throw new BadRequestException('MFA is unavailable for this account');
    }

    let verified = false;
    if (recoveryCode) {
      const normalized = recoveryCode.trim().toUpperCase();
      const codeRecord = await userRecoveryCodes.findOne({ where: { userId: user.id, revokedAt: IsNull(), usedAt: IsNull() } });
      if (!codeRecord) throw new BadRequestException('No valid recovery codes remain');
      const candidate = await userRecoveryCodes.findOne({
        where: { userId: user.id, revokedAt: IsNull() },
      });
      const candidates = await userRecoveryCodes.find({ where: { userId: user.id, revokedAt: IsNull() } });
      const match = candidates.find((entry) => entry.codeHash === SecurityUtils.hashRecoveryCode(normalized));
      if (!match) throw new BadRequestException('Recovery code is invalid');
      match.usedAt = new Date();
      await userRecoveryCodes.save(match);
      verified = true;
      await this.recordSecurityEvent({ userId: user.id, eventType: 'RECOVERY_CODE_USED', ipAddress, metadata: { recoveryCodeHash: match.codeHash } });
    } else if (code) {
      const secret = SecurityUtils.decrypt(config.secretEncrypted);
      verified = SecurityUtils.verifyTotpCode(secret, code);
      if (!verified) throw new BadRequestException('Invalid authenticator code');
    } else {
      throw new BadRequestException('Verification code required');
    }

    challenge.usedAt = new Date();
    await mfaChallenges.save(challenge);

    const tokens = await this.createSessionAndTokens(user, userAgent, ipAddress);
    await authSessions.update({ userId: user.id }, { revokedAt: new Date() });
    await this.recordSecurityEvent({
      userId: user.id,
      eventType: 'MFA_SUCCESS',
      ipAddress,
      browser: userAgent?.match(/(Chrome|Firefox|Safari|Edge|Opera)\//)?.[1],
      operatingSystem: userAgent?.match(/(Windows|Mac OS|Android|iPhone|iPad|Linux)/)?.[1],
      metadata: { challengeId },
    });
    await this.recordSecurityEvent({
      userId: user.id,
      eventType: 'LOGIN_SUCCESS',
      ipAddress,
      browser: userAgent?.match(/(Chrome|Firefox|Safari|Edge|Opera)\//)?.[1],
      operatingSystem: userAgent?.match(/(Windows|Mac OS|Android|iPhone|iPad|Linux)/)?.[1],
      metadata: { challengeId },
    });
    return tokens;
  }

  async verifyRecoveryCode(challengeId: string, recoveryCode?: string, userAgent?: string, ipAddress?: string) {
    return this.verifyMfaChallenge(challengeId, undefined, recoveryCode, userAgent, ipAddress);
  }

  async refreshToken(rawRefreshToken: string, userAgent?: string, ipAddress?: string) {
    const { users, authSessions } = await this.repositories();
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }

    const jwtConfig = getJwtConfig();
    let decoded: any;
    try {
      decoded = jwt.verify(rawRefreshToken, jwtConfig.refreshSecret, { algorithms: ['HS256'] });
    } catch (err) {
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
      await authSessions.update({ tokenFamilyId: decoded.tfid }, { revokedAt: new Date() });
      await this.recordSecurityEvent({ sessionId: session.id, userId: session.userId, eventType: 'REFRESH_TOKEN_REUSE_DETECTED', ipAddress, metadata: { tokenFamilyId: decoded.tfid } });
      throw new UnauthorizedException('Refresh token theft detected. Session revoked.');
    }

    const user = await users.findOne({
      where: { id: session.userId, deletedAt: IsNull() },
    });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const newSession = authSessions.create({
      userId: user.id,
      refreshTokenHash: '',
      tokenFamilyId: session.tokenFamilyId,
      userAgent: userAgent || session.userAgent,
      ipAddress: ipAddress || session.ipAddress,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
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

    session.revokedAt = new Date();
    savedSession.refreshTokenHash = SecurityUtils.hashToken(newRawRefreshToken);
    await authSessions.save([session, savedSession]);
    await this.recordSecurityEvent({
      userId: user.id,
      sessionId: savedSession.id,
      eventType: 'REFRESH_TOKEN_ROTATED',
      ipAddress,
      metadata: { tokenFamilyId: session.tokenFamilyId },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  async logout(sessionId: string) {
    const { authSessions } = await this.repositories();
    const session = await authSessions.findOne({ where: { id: sessionId } });
    if (session) {
      session.revokedAt = new Date();
      await authSessions.save(session);
    }
    return { success: true, message: 'Logged out successfully' };
  }

  async logoutAll(userId: string) {
    const { authSessions } = await this.repositories();
    await authSessions.update({ userId }, { revokedAt: new Date() });
    return { success: true, message: 'All sessions revoked successfully' };
  }

  async getMe(userId: string) {
    const { users, memberships, organizations } = await this.repositories();
    const user = await users.findOne({
      where: { id: userId, deletedAt: IsNull() },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const activeMemberships = await memberships.find({
      where: { userId, status: MembershipStatus.ACTIVE },
    });
    const isSuperAdmin = user.platformRole === PlatformRole.SUPER_ADMIN;
    const orgs = isSuperAdmin
      ? await organizations.find({ where: { deletedAt: IsNull() } })
      : activeMemberships.length
      ? await organizations.findBy(activeMemberships.map((m) => ({ id: m.organizationId })))
      : [];
    const userMemberships = isSuperAdmin
      ? orgs.map((org) => ({
        organizationId: org.id,
        organizationName: org.name,
        role: Role.SUPER_ADMIN,
        programAccessType: ProgramAccessType.ALL,
        programIds: [],
        permissions: getRolePermissions(Role.SUPER_ADMIN),
      }))
      : activeMemberships.map((m) => {
      const org = orgs.find((o) => o.id === m.organizationId);
      return {
        organizationId: m.organizationId,
        organizationName: org?.name,
        role: m.role,
        programAccessType: m.programAccessType,
        programIds: m.programIds || [],
        permissions: getRolePermissions(m.role),
      };
    });

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
    };
  }

  async getSessions(userId: string, currentSessionId?: string) {
    const { authSessions } = await this.repositories();
    const sessions = await authSessions.find({
      where: { userId, revokedAt: IsNull() },
    });

    return sessions.map((s) => ({
        id: s.id,
        deviceName: s.deviceName || 'Web Browser',
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        isCurrent: s.id === currentSessionId,
      }));
  }

  async removeNewlyRegisteredUser(userId: string) {
    const { users, authSessions } = await this.repositories();
    await authSessions.delete({ userId });
    await users.delete({ id: userId });

    const userIndex = dbStore.users.findIndex((item) => item.id === userId);
    if (userIndex >= 0) {
      dbStore.users.splice(userIndex, 1);
    }
  }

  async revokeSession(userId: string, sessionId: string) {
    const { authSessions } = await this.repositories();
    const session = await authSessions.findOne({ where: { id: sessionId, userId } });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    session.revokedAt = new Date();
    await authSessions.save(session);
    return { success: true, message: 'Session revoked' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const { users } = await this.repositories();
    const user = await users.findOne({
      where: { id: userId, deletedAt: IsNull() },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isValid = await SecurityUtils.verifyPassword(dto.currentPassword, user.passwordHash || '');
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    user.passwordHash = await SecurityUtils.hashPassword(dto.newPassword);
    user.updatedAt = new Date();
    await users.save(user);

    await this.logoutAll(userId);

    return { success: true, message: 'Password changed successfully. Please log in again.' };
  }

  public async createSessionAndTokens(user: User, userAgent?: string, ipAddress?: string) {
    const { authSessions } = await this.repositories();
    const jwtConfig = getJwtConfig();
    const session = authSessions.create({
      userId: user.id,
      refreshTokenHash: '',
      tokenFamilyId: uuidv4(),
      userAgent,
      ipAddress,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
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
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        platformRole: user.platformRole,
      },
    };
  }

  public isConfiguredSuperAdmin(email: string) {
    const superAdminEmails = (process.env.SUPER_ADMIN_EMAILS || 'admin@partneriq.demo')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    return superAdminEmails.includes(email);
  }
}
