import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { EnvironmentType } from '../enums';
import { PartnerIqRequestContext, RequestWithUser } from '../interfaces/request-with-user.interface';
import { EnvironmentUtils } from '../utils/environment.utils';

export const REQUIRE_ENVIRONMENT_KEY = 'require_environment';

/**
 * Enforces that an endpoint is only accessible in a specific environment (e.g. 'LIVE' for payouts)
 */
export const RequireEnvironment = (environment: 'TEST' | 'LIVE' | EnvironmentType) =>
  SetMetadata(REQUIRE_ENVIRONMENT_KEY, environment);

/**
 * Extracts current EnvironmentType from request context
 */
export const CurrentEnvironment = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): EnvironmentType => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (request.partnerIqContext?.environment) {
      return request.partnerIqContext.environment;
    }
    if (request.environment) {
      return request.environment;
    }
    if (request.user?.apiKeyEnvironment) {
      return EnvironmentUtils.normalizeEnvironment(request.user.apiKeyEnvironment);
    }
    const headerEnv = request.headers['x-partneriq-environment'] as string | undefined;
    return EnvironmentUtils.normalizeEnvironment(headerEnv || 'LIVE');
  },
);

/**
 * Extracts complete PartnerIqRequestContext from request
 */
export const PartnerIqContext = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): PartnerIqRequestContext => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (request.partnerIqContext) {
      return request.partnerIqContext;
    }

    const orgId = request.tenantId || request.user?.organizationId || '';
    const env = request.environment ||
      (request.user?.apiKeyEnvironment
        ? EnvironmentUtils.normalizeEnvironment(request.user.apiKeyEnvironment)
        : EnvironmentUtils.normalizeEnvironment(request.headers['x-partneriq-environment'] as string));

    const context: PartnerIqRequestContext = {
      userId: request.user?.userId,
      email: request.user?.email,
      organizationId: orgId,
      environment: env,
      apiKeyId: request.user?.apiKeyId,
      isApiKey: Boolean(request.user?.isApiKey),
      role: request.user?.role,
      scopes: request.user?.scopes,
      programAccessType: request.user?.programAccessType,
      programIds: request.user?.programIds,
    };

    request.partnerIqContext = context;
    return context;
  },
);
