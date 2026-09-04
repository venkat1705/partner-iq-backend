import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } from '../decorators/require-permissions.decorator';
import { hasPermission } from '../constants/permissions';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const permissionsMode = this.reflector.getAllAndOverride<string>(
      PERMISSIONS_MODE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User context missing');
    }

    // API Key Scope validation
    if (user.isApiKey) {
      const userScopes = user.scopes || [];
      const hasAllScopes = requiredPermissions.every((p) => userScopes.includes(p));
      if (!hasAllScopes) {
        throw new ForbiddenException(`API key lacks required scopes: ${requiredPermissions.join(', ')}`);
      }
      return true;
    }

    if (!user.role) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: 'User role is not defined for this organization context',
      });
    }

    const comparisons = requiredPermissions.map((permission) => hasPermission(user.role!, permission));
    const allowed = permissionsMode === 'ANY' ? comparisons.some(Boolean) : comparisons.every(Boolean);

    if (!allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        message: `Insufficient permissions for role '${user.role}'. Required: ${requiredPermissions.join(', ')}`,
      });
    }

    return true;
  }
}
