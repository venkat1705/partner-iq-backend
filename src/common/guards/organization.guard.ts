import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { dbStore } from '../../database/store';
import { RequestWithUser } from '../interfaces/request-with-user.interface';
import { MembershipStatus } from '../enums/rbac';
import { Role } from '../enums';

@Injectable()
export class OrganizationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User is not authenticated');
    }

    // If request is using API key, organization is already validated
    if (user.isApiKey) {
      const requestedOrgId = request.params?.organizationId;
      if (requestedOrgId && requestedOrgId !== user.organizationId) {
        throw new ForbiddenException('API Key cannot access other organization data (IDOR prevention)');
      }
      return true;
    }

    const organizationId =
      request.params?.organizationId ||
      request.body?.organizationId ||
      request.query?.organizationId;

    if (!organizationId) {
      throw new ForbiddenException('Organization context is required for this action');
    }

    // Verify organization exists and is active
    const org = dbStore.organizations.find((o) => o.id === organizationId && !o.deletedAt);
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    if (org.status === 'SUSPENDED' || org.status === 'CLOSED') {
      throw new ForbiddenException(`Organization account is ${org.status.toLowerCase()}`);
    }

    if (user.isSuperAdmin) {
      request.user.organizationId = organizationId;
      request.user.role = Role.SUPER_ADMIN;
      request.tenantId = organizationId;
      return true;
    }

    // Verify user membership in organization
    const membership = dbStore.organizationMemberships.find(
      (m) =>
        m.organizationId === organizationId &&
        m.userId === user.userId &&
        m.status === MembershipStatus.ACTIVE,
    );

    if (!membership) {
      throw new ForbiddenException('User does not belong to this organization');
    }

    // Attach role and tenantId to user payload
    request.user.organizationId = organizationId;
    request.user.role = membership.role;
    request.user.programAccessType = membership.programAccessType;
    request.user.programIds = membership.programIds || [];
    request.tenantId = organizationId;

    return true;
  }
}
