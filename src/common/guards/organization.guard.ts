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
import { EnvironmentUtils } from '../utils/environment.utils';

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
    const hasAnyOrgMembership = dbStore.organizationMemberships.some(
      (m) => m.userId === user.userId && m.status === MembershipStatus.ACTIVE,
    );

    if (!hasAnyOrgMembership) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ORGANIZATION_MEMBERSHIP_REQUIRED',
        message: 'This account does not have access to an organization workspace.',
      });
    }

    const membership = dbStore.organizationMemberships.find(
      (m) =>
        m.organizationId === organizationId &&
        m.userId === user.userId &&
        m.status === MembershipStatus.ACTIVE,
    );

    if (!membership) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ORGANIZATION_MEMBERSHIP_REQUIRED',
        message: 'User does not belong to this organization',
      });
    }

    // Attach role and tenantId to user payload
    const headerEnvRaw = (request.headers['x-partneriq-environment'] || request.query?.environment) as string | undefined;
    const environment = EnvironmentUtils.normalizeEnvironment(headerEnvRaw || 'LIVE');

    request.user.organizationId = organizationId;
    request.user.role = membership.role;
    request.user.programAccessType = membership.programAccessType;
    request.user.programIds = membership.programIds || [];
    request.tenantId = organizationId;
    request.environment = environment;

    request.partnerIqContext = {
      userId: user.userId,
      email: user.email,
      organizationId,
      environment,
      isApiKey: false,
      role: membership.role,
      roles: [membership.role],
      programAccessType: membership.programAccessType,
      programIds: membership.programIds || [],
    };

    return true;
  }
}
