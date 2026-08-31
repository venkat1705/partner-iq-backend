import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SecurityUtils } from '../utils/security.utils';
import { dbStore } from '../../database/store';
import { RequestWithUser } from '../interfaces/request-with-user.interface';
import { API_SCOPES_KEY } from '../decorators/require-api-scopes.decorator';
import { EnvironmentType } from '../enums';
import { EnvironmentUtils } from '../utils/environment.utils';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    if (!authHeader || (!authHeader.startsWith('Bearer pi_') && !authHeader.startsWith('Bearer sk_') && !authHeader.startsWith('Bearer pk_'))) {
      throw new UnauthorizedException('API key is required in Authorization header');
    }

    const rawKey = authHeader.split(' ')[1];
    const match = rawKey.match(/^(?:pi_|sk_|pk_)(test|live)_/i);
    if (!match) {
      throw new UnauthorizedException('A valid API key with test or live environment prefix is required');
    }

    const keyHash = SecurityUtils.hashToken(rawKey);

    const apiKey = dbStore.apiKeys.find(
      (k) => (k.keyHash === keyHash || k.prefix === rawKey.substring(0, 16)) && !k.revokedAt && (k as any).status !== 'REVOKED',
    );

    if (!apiKey) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    const requiredScopes = this.reflector.getAllAndOverride<string[]>(API_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) || [];
    const grantedScopes = apiKey.scopes || [];
    const missingScope = requiredScopes.find((scope) => !grantedScopes.includes(scope));
    if (missingScope) {
      throw new ForbiddenException(`Missing API key scope: ${missingScope}`);
    }

    const environment = EnvironmentUtils.normalizeEnvironment(apiKey.environment || match[1]);

    // Check if client tried to override with X-PartnerIQ-Environment header
    const headerEnvRaw = request.headers['x-partneriq-environment'] as string | undefined;
    if (headerEnvRaw) {
      const headerEnv = EnvironmentUtils.normalizeEnvironment(headerEnvRaw);
      if (headerEnv !== environment) {
        throw new ForbiddenException({
          code: 'API_KEY_ENVIRONMENT_MISMATCH',
          message: `This API key cannot access the requested '${headerEnv}' environment (Key is bound to '${environment}').`,
        });
      }
    }

    apiKey.lastUsedAt = new Date();
    (apiKey as any).lastUsedIpHash = request.ip ? SecurityUtils.hashToken(request.ip) : undefined;

    request.user = {
      userId: `apikey_${apiKey.id}`,
      email: `apikey_${apiKey.name}@partneriq.system`,
      organizationId: apiKey.organizationId,
      apiKeyId: apiKey.id,
      apiKeyEnvironment: environment,
      scopes: apiKey.scopes,
      isApiKey: true,
    };
    request.tenantId = apiKey.organizationId;
    request.environment = environment;

    request.partnerIqContext = {
      userId: request.user.userId,
      email: request.user.email,
      organizationId: apiKey.organizationId,
      environment,
      apiKeyId: apiKey.id,
      isApiKey: true,
      scopes: apiKey.scopes,
    };

    return true;
  }
}

