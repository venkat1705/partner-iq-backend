import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AppDataSource } from '../../database/data-source';
import { OrganizationMembership } from '../../database/schema';
import { RequestWithUser } from '../interfaces/request-with-user.interface';
import { MembershipStatus } from '../enums/rbac';
import { Role } from '../enums';

@Injectable()
export class OrganizationMembershipGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User is not authenticated');
    }

    const organizationId =
      request.params?.organizationId || request.body?.organizationId || request.query?.organizationId;

    if (!organizationId) {
      throw new ForbiddenException('Organization context is required for this action');
    }

    if (user.isSuperAdmin) {
      request.user.organizationId = organizationId;
      request.user.role = Role.SUPER_ADMIN;
      request.tenantId = organizationId;
      return true;
    }

    const membership = await AppDataSource.getRepository(OrganizationMembership).findOne({
      where: {
        organizationId,
        userId: user.userId,
        status: MembershipStatus.ACTIVE,
      },
    });

    if (!membership) {
      throw new ForbiddenException('User does not belong to this organization');
    }

    request.user.organizationId = organizationId;
    request.user.role = membership.role;
    request.user.programAccessType = membership.programAccessType;
    request.user.programIds = membership.programIds || [];
    request.tenantId = organizationId;

    return true;
  }
}
