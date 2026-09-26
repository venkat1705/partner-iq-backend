import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { verifyAccessToken } from '../auth/verify-access-token';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

// A user bootstrapped with a generated password (e.g. by `create-super-admin`)
// is locked out of everything else until they set their own password —
// these are the only endpoints that remain reachable in the meantime.
const MUST_CHANGE_PASSWORD_ALLOWED_PATHS = [
  '/api/v1/auth/set-password',
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.split(' ')[1];
    request.user = await verifyAccessToken(token);

    if (
      request.user.mustChangePassword &&
      !MUST_CHANGE_PASSWORD_ALLOWED_PATHS.includes(request.path)
    ) {
      throw new ForbiddenException('Password change required before continuing.');
    }

    return true;
  }
}
