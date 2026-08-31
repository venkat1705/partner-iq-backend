import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EnvironmentType } from '../enums';
import { RequestWithUser, PartnerIqRequestContext } from '../interfaces/request-with-user.interface';
import { REQUIRE_ENVIRONMENT_KEY } from '../decorators/environment.decorator';
import { EnvironmentUtils } from '../utils/environment.utils';

@Injectable()
export class EnvironmentGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    let currentEnvironment: EnvironmentType;

    // 1. If request is using API Key, environment is derived authoritatively from the key
    if (request.user?.isApiKey && request.user.apiKeyEnvironment) {
      currentEnvironment = EnvironmentUtils.normalizeEnvironment(request.user.apiKeyEnvironment);

      // Check if client tried to override with X-PartnerIQ-Environment header
      const headerEnvRaw = request.headers['x-partneriq-environment'] as string | undefined;
      if (headerEnvRaw) {
        const headerEnv = EnvironmentUtils.normalizeEnvironment(headerEnvRaw);
        if (headerEnv !== currentEnvironment) {
          throw new ForbiddenException({
            code: 'API_KEY_ENVIRONMENT_MISMATCH',
            message: `This API key is bound to '${currentEnvironment}' environment and cannot access '${headerEnv}' requests.`,
          });
        }
      }
    } else {
      // 2. Dashboard / JWT Authenticated requests use X-PartnerIQ-Environment header (defaults to LIVE)
      const headerEnvRaw = (request.headers['x-partneriq-environment'] || request.query?.environment) as string | undefined;
      currentEnvironment = EnvironmentUtils.normalizeEnvironment(headerEnvRaw || 'LIVE');
    }

    request.environment = currentEnvironment;

    // Attach complete request context
    const partnerIqContext: PartnerIqRequestContext = {
      userId: request.user?.userId,
      email: request.user?.email,
      organizationId: request.tenantId || request.user?.organizationId || '',
      environment: currentEnvironment,
      apiKeyId: request.user?.apiKeyId,
      isApiKey: Boolean(request.user?.isApiKey),
      role: request.user?.role,
      roles: request.user?.role ? [request.user.role] : [],
      permissions: [],
      programAccessType: request.user?.programAccessType,
      programIds: request.user?.programIds,
      scopes: request.user?.scopes,
    };
    request.partnerIqContext = partnerIqContext;

    // Check @RequireEnvironment metadata
    const requiredEnv = this.reflector.getAllAndOverride<'TEST' | 'LIVE' | EnvironmentType>(
      REQUIRE_ENVIRONMENT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredEnv) {
      const normalizedRequired = EnvironmentUtils.normalizeEnvironment(requiredEnv);
      if (currentEnvironment !== normalizedRequired) {
        throw new ForbiddenException({
          code: 'ENVIRONMENT_RESTRICTED',
          message: `This action requires '${normalizedRequired}' environment but current request is in '${currentEnvironment}' mode.`,
        });
      }
    }

    return true;
  }
}
