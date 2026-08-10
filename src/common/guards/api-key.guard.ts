import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { SecurityUtils } from '../utils/security.utils';
import { dbStore } from '../../database/store';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer pi_')) {
      return false;
    }

    const rawKey = authHeader.split(' ')[1];
    const keyHash = SecurityUtils.hashToken(rawKey);

    const apiKey = dbStore.apiKeys.find(
      (k) => k.keyHash === keyHash && !k.revokedAt,
    );

    if (!apiKey) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    // Update lastUsedAt
    apiKey.lastUsedAt = new Date();

    request.user = {
      userId: `apikey_${apiKey.id}`,
      email: `apikey_${apiKey.name}@partneriq.system`,
      organizationId: apiKey.organizationId,
      apiKeyId: apiKey.id,
      scopes: apiKey.scopes,
      isApiKey: true,
    };
    request.tenantId = apiKey.organizationId;

    return true;
  }
}
