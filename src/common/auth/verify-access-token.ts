import { UnauthorizedException } from '@nestjs/common';
import jwtPkg from 'jsonwebtoken';
const jwt = (jwtPkg as any).default || jwtPkg;
import { IsNull } from 'typeorm';
import { getJwtConfig } from '../../config/jwt.config';
import { initializeDataSource } from '../../database/data-source';
import { User } from '../../database/schema';
import { PlatformRole } from '../enums';

export interface VerifiedAccessToken {
  userId: string;
  email: string;
  sessionId?: string;
  platformRole: PlatformRole;
  isSuperAdmin: boolean;
  isApiKey: false;
}

export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
  const jwtConfig = getJwtConfig();

  try {
    const decoded = jwt.verify(token, jwtConfig.accessSecret, { algorithms: ['HS256'] }) as any;

    if (decoded.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    const dataSource = await initializeDataSource();
    const user = await dataSource.getRepository(User).findOne({
      where: { id: decoded.sub, deletedAt: IsNull() },
    });
    if (!user || user.status === 'LOCKED') {
      throw new UnauthorizedException('User account is invalid or locked');
    }

    return {
      userId: user.id,
      email: user.email,
      sessionId: decoded.sid,
      platformRole: user.platformRole,
      isSuperAdmin: user.platformRole === PlatformRole.SUPER_ADMIN,
      isApiKey: false,
    };
  } catch (err: any) {
    if (err instanceof UnauthorizedException) {
      throw err;
    }
    if (err?.name === 'TokenExpiredError') {
      throw new UnauthorizedException('Session token expired. Please sign in again.');
    }
    throw new UnauthorizedException(err?.message || 'Token verification failed or expired');
  }
}
