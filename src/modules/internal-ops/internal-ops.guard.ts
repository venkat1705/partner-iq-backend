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
import { v4 as uuidv4 } from 'uuid';
import { getJwtConfig } from '../../config/jwt.config';
import { PlatformRole, AuditAction } from '../../common/enums';
import { dbStore } from '../../database/store';
import { AppDataSource } from '../../database/data-source';
import { AuditLog } from '../../database/schema';

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
        await this.recordInternalAuditLog(request);
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
        await this.recordInternalAuditLog(request);
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
            await this.recordInternalAuditLog(request);
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

  private async recordInternalAuditLog(request: any) {
    try {
      const caller = request.internalCaller || {};
      const callerIdentity =
        caller.type === 'SUPER_ADMIN_JWT'
          ? `superadmin:${caller.email || caller.userId}`
          : `internal_key:${caller.type || 'SECRET'}`;

      const target =
        request.params?.id ||
        request.body?.recipientEmail ||
        request.body?.organizationName ||
        request.body?.templateKey ||
        request.query?.id ||
        'global';

      const route = `${request.method} ${request.originalUrl || request.url}`;

      const entry = {
        id: uuidv4(),
        actorType: caller.type === 'SUPER_ADMIN_JWT' ? 'user' : 'api_key',
        actorId: callerIdentity,
        action: AuditAction.INTERNAL_API_CALLED,
        resourceType: 'internal_ops',
        resourceId: request.originalUrl || request.url,
        ipAddress: request.ip || '127.0.0.1',
        userAgent: request.headers?.['user-agent'] || 'internal-ops-client',
        metadata: {
          caller: callerIdentity,
          callerType: caller.type,
          route,
          target: String(target),
          authorizedAt: caller.authorizedAt,
        },
        createdAt: new Date(),
      };

      dbStore.auditLogs.push(entry as any);

      if (AppDataSource.isInitialized) {
        await AppDataSource.getRepository(AuditLog).save(entry as any);
      }
    } catch (err: any) {
      this.logger.error(`Failed to record internal ops audit log: ${err?.message || err}`);
    }
  }
}

