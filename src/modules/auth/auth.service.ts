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
import { AuthSession, Organization, OrganizationMembership, User } from '../../database/schema';
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
    };
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
        // Unlock
        user.status = UserStatus.ACTIVE;
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        await users.save(user);
      }
    }

    const isValid = await SecurityUtils.verifyPassword(dto.password, user.passwordHash);
    if (!isValid) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= 5) {
        user.status = UserStatus.LOCKED;
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // Lock 15 mins
      }
      await users.save(user);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Reset login failures on success
    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    await users.save(user);

    // Create session & tokens
    const tokens = await this.createSessionAndTokens(user, userAgent, ipAddress);

    return tokens;
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

    // REUSE DETECTION / THEFT PREVENTION
    if (session.revokedAt || session.refreshTokenHash !== incomingHash) {
      // Possible theft! Revoke all sessions in this token family
      await authSessions.update({ tokenFamilyId: decoded.tfid }, { revokedAt: new Date() });

      throw new UnauthorizedException('Refresh token theft detected. Session revoked.');
    }

    const user = await users.findOne({
      where: { id: session.userId, deletedAt: IsNull() },
    });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    // Rotate refresh token
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

    // Update session
    session.revokedAt = new Date(); // Revoke old session
    savedSession.refreshTokenHash = SecurityUtils.hashToken(newRawRefreshToken);
    await authSessions.save([session, savedSession]);

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

    const isValid = await SecurityUtils.verifyPassword(dto.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    user.passwordHash = await SecurityUtils.hashPassword(dto.newPassword);
    user.updatedAt = new Date();
    await users.save(user);

    // Revoke all existing sessions
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
