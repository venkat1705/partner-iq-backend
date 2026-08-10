import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import jwtPkg from 'jsonwebtoken';
const jwt = (jwtPkg as any).default || jwtPkg;
import { IsNull } from 'typeorm';
import { getJwtConfig } from '../../config/jwt.config';
import { initializeDataSource } from '../../database/data-source';
import { User } from '../../database/schema';
import { PlatformRole } from '../enums';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.split(' ')[1];
    const jwtConfig = getJwtConfig();

    try {
      const decoded = jwt.verify(token, jwtConfig.accessSecret) as any;

      if (decoded.type !== 'access') {
        throw new UnauthorizedException('Invalid token type');
      }

      // Verify user exists and is active
      const dataSource = await initializeDataSource();
      const user = await dataSource.getRepository(User).findOne({
        where: { id: decoded.sub, deletedAt: IsNull() },
      });
      if (!user || user.status === 'LOCKED') {
        throw new UnauthorizedException('User account is invalid or locked');
      }

      request.user = {
        userId: user.id,
        email: user.email,
        sessionId: decoded.sid,
        platformRole: user.platformRole,
        isSuperAdmin: user.platformRole === PlatformRole.SUPER_ADMIN,
        isApiKey: false,
      };

      return true;
    } catch (err) {
      throw new UnauthorizedException('Token verification failed or expired');
    }
  }
}
