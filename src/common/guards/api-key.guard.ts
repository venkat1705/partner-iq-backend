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

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer pi_')) {
      throw new UnauthorizedException('API key is required');
    }

    const rawKey = authHeader.split(' ')[1];
    const match = rawKey.match(/^pi_(test|live)_sk_/);
    if (!match) {
      throw new UnauthorizedException('A secret API key with pi_test_sk_ or pi_live_sk_ prefix is required');
    }

    const keyHash = SecurityUtils.hashToken(rawKey);

    const apiKey = dbStore.apiKeys.find(
      (k) => k.keyHash === keyHash && !k.revokedAt && (k as any).status !== 'REVOKED',
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

    const environment = ((apiKey as any).environment || match[1]) as 'test' | 'live';

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

    return true;
  }
}
