import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PlatformRole } from '../enums';
import type { RequestWithUser } from '../interfaces/request-with-user.interface';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (user?.isSuperAdmin || user?.platformRole === PlatformRole.SUPER_ADMIN) {
      return true;
    }
    throw new ForbiddenException('Super admin access is required');
  }
}
