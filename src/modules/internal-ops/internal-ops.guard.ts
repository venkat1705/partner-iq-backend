import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { timingSafeEqual, createHash } from 'crypto';
import jwtPkg from 'jsonwebtoken';
const jwt = (jwtPkg as any).default || jwtPkg;
import { getJwtConfig } from '../../config/jwt.config';
import { PlatformRole } from '../../common/enums';
import { dbStore } from '../../database/store';

function getConfiguredOpsSecret(): string {
  const secret = process.env.INTERNAL_OPS_KEY || process.env.PRIVATE_API_KEY;
  if (!secret || secret.trim().length < 16) {
    throw new Error(
      'INTERNAL_OPS_KEY (or PRIVATE_API_KEY) must be set to a strong secret (>=16 chars). Refusing to start with a missing/weak internal ops secret.',
    );
  }
  return secret.trim();
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aHash = createHash('sha256').update(a).digest();
  const bHash = createHash('sha256').update(b).digest();
  return timingSafeEqual(aHash, bHash);
}

@Injectable()
export class InternalOpsGuard implements CanActivate {
  private readonly logger = new Logger(InternalOpsGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const headers = request.headers || {};

    const configuredSecret = getConfiguredOpsSecret();

    // 1. Check custom internal secret headers
    const headerSecret =
      headers['x-internal-secret'] ||
      headers['x-ops-secret'] ||
      headers['x-master-key'] ||
      headers['x-api-key'];

    if (headerSecret && typeof headerSecret === 'string') {
      if (timingSafeStringEqual(headerSecret.trim(), configuredSecret)) {
        request.internalCaller = {
          type: 'INTERNAL_SECRET_HEADER',
          authorizedAt: new Date().toISOString(),
        };
        return true;
      }
    }

    // 2. Check Authorization Bearer header
    const authHeader = headers['authorization'];
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();

      // Case 2a: Bearer token is the secret key directly
      if (timingSafeStringEqual(token, configuredSecret)) {
        request.internalCaller = {
          type: 'INTERNAL_SECRET_BEARER',
          authorizedAt: new Date().toISOString(),
        };
        return true;
      }

      // Case 2b: Bearer token is a JWT of a SuperAdmin user
      try {
        const jwtConfig = getJwtConfig();
        const payload: any = jwt.verify(token, jwtConfig.accessSecret);

        if (
          payload &&
          (payload.platformRole === PlatformRole.SUPER_ADMIN ||
            payload.isSuperAdmin === true ||
            payload.role === 'SUPER_ADMIN')
        ) {
          // Double check database/store
          const user = dbStore.users.find((u) => u.id === payload.sub || u.id === payload.userId);
          if (user && user.platformRole === PlatformRole.SUPER_ADMIN) {
            request.user = user;
            request.internalCaller = {
              type: 'SUPER_ADMIN_JWT',
              userId: user.id,
              email: user.email,
              authorizedAt: new Date().toISOString(),
            };
            return true;
          }
        }
      } catch (err: any) {
        this.logger.debug(`JWT verification in InternalOpsGuard failed: ${err?.message}`);
      }
    }

    this.logger.warn(
      `Unauthorized attempt to access internal private API from IP ${request.ip || 'unknown'}`,
    );

    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message:
        'Access denied. Valid x-internal-secret header or SuperAdmin credentials required to access internal APIs.',
    });
  }
}

