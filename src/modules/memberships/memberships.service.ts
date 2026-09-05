import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, OrganizationMembershipEntity } from '../../database/store';
import { initializeDataSource } from '../../database/data-source';
import { User } from '../../database/schema';
import { InviteMemberDto, UpdateMemberRoleDto } from './dto/membership.dto';
import { MembershipStatus, ProgramAccessType } from '../../common/enums/rbac';
import { AuditAction, Role } from '../../common/enums';
import { SecurityUtils } from '../../common/utils/security.utils';
import { getAppConfig } from '../../config/app.config';
import { BrevoEmailService } from './brevo-email.service';
import { assertUserEligibleForOrganization } from '../affiliates/affiliate-eligibility.policy';

@Injectable()
export class MembershipsService {
  constructor(private readonly brevoEmail: BrevoEmailService) { }

  async getMembers(organizationId: string) {
    const memberships = dbStore.organizationMemberships.filter(
      (m) => m.organizationId === organizationId && m.status === MembershipStatus.ACTIVE,
    );

    const activeMembers = memberships.map((m) => {
      const user = dbStore.users.find((u) => u.id === m.userId);
      return {
        id: m.id,
        organizationId: m.organizationId,
        userId: m.userId,
        email: user?.email,
        firstName: user?.firstName,
        lastName: user?.lastName,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt,
      };
    });

    const pendingInvites = dbStore.organizationInvitations
      .filter(
        (invite) =>
          invite.organizationId === organizationId &&
          !invite.acceptedAt &&
          !invite.revokedAt &&
          new Date(invite.expiresAt) > new Date(),
      )
      .map((invite) => ({
        id: invite.id,
        userId: undefined,
        email: invite.email,
        firstName: undefined,
        lastName: undefined,
        role: this.roleForInvitation(invite.roleId),
        status: 'Pending',
        joinedAt: undefined,
        invitedAt: invite.createdAt,
        expiresAt: invite.expiresAt,
      }));

    return [...pendingInvites, ...activeMembers];
  }

  async inviteMember(organizationId: string, invitedByUserId: string, dto: InviteMemberDto) {
    const email = dto.email.toLowerCase().trim();
    assertUserEligibleForOrganization(email);
    const organization = dbStore.organizations.find((item) => item.id === organizationId && !item.deletedAt);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const user = dbStore.users.find((u) => u.email === email && !u.deletedAt);

    const existingMembership = user && dbStore.organizationMemberships.find(
      (m) => m.organizationId === organizationId && m.userId === user.id && m.status === MembershipStatus.ACTIVE,
    );

    if (existingMembership) {
      throw new BadRequestException('User is already a member of this organization');
    }

    const existingInvite = dbStore.organizationInvitations.find(
      (invite) =>
        invite.organizationId === organizationId &&
        invite.email === email &&
        !invite.acceptedAt &&
        !invite.revokedAt &&
        new Date(invite.expiresAt) > new Date(),
    );
    if (existingInvite) {
      throw new BadRequestException('An active invitation already exists for this email');
    }

    const role = this.normalizeRole(dto.role);
    const roleDefinition = dbStore.roles.find((item) => item.code === role && !item.organizationId);
    if (!roleDefinition) {
      throw new BadRequestException('Role definition not found. Run database seed before inviting members.');
    }

    const token = `${uuidv4()}${uuidv4()}`.replace(/-/g, '');
    const inviteUrl = `${getAppConfig().frontendUrl.replace(/\/$/, '')}/invite/accept?token=${token}`;
    const invitation = {
      id: uuidv4(),
      organizationId,
      email,
      roleId: roleDefinition.id,
      programAccessType: ProgramAccessType.ALL,
      programIds: [],
      tokenHash: SecurityUtils.hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      invitedBy: invitedByUserId,
      createdAt: new Date(),
    };

    dbStore.organizationInvitations.push(invitation);
    this.audit(organizationId, invitedByUserId, 'MEMBER_INVITED', 'organization_invitation', invitation.id, {
      email,
      role,
    });

    const inviter = dbStore.users.find((item) => item.id === invitedByUserId);
    try {
      await this.brevoEmail.sendInvitationEmail({
        toEmail: email,
        organizationName: organization.name,
        inviterEmail: inviter?.email,
        role,
        inviteUrl,
      });
    } catch {
      // Non-blocking email dispatch
    }

    return {
      id: invitation.id,
      organizationId,
      email,
      role,
      status: 'INVITED',
      token,
      invitedAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      inviteUrl,
    };
  }

  async revokeInvitation(organizationId: string, invitationId: string, actorId?: string) {
    const invitation = dbStore.organizationInvitations.find(
      (invite) => invite.id === invitationId && invite.organizationId === organizationId,
    );

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    invitation.revokedAt = new Date();
    this.audit(organizationId, actorId || invitation.invitedBy, 'MEMBER_INVITATION_REVOKED', 'organization_invitation', invitationId, {
      email: invitation.email,
    });
    return { success: true, message: 'Invitation revoked' };
  }

  getInvitation(token: string) {
    const invitation = this.findValidInvitation(token);
    const organization = dbStore.organizations.find((item) => item.id === invitation.organizationId);
    const role = this.roleForInvitation(invitation.roleId);

    return {
      id: invitation.id,
      email: invitation.email,
      organizationId: invitation.organizationId,
      organizationName: organization?.name,
      role,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitationForUser(token: string, userId: string) {
    assertUserEligibleForOrganization(userId);
    const invitation = this.findValidInvitation(token);
    const dataSource = await initializeDataSource();
    const user = await dataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new BadRequestException('Invitation email does not match authenticated user');
    }

    const existing = dbStore.organizationMemberships.find(
      (item) =>
        item.organizationId === invitation.organizationId &&
        item.userId === user.id &&
        item.status === MembershipStatus.ACTIVE,
    );
    if (existing) {
      invitation.acceptedAt = new Date();
      return existing;
    }

    const membership: OrganizationMembershipEntity = {
      id: uuidv4(),
      organizationId: invitation.organizationId,
      userId: user.id,
      role: this.roleForInvitation(invitation.roleId),
      status: MembershipStatus.ACTIVE,
      programAccessType: invitation.programAccessType,
      programIds: invitation.programIds || [],
      invitedBy: invitation.invitedBy,
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.organizationMemberships.push(membership);
    invitation.acceptedAt = new Date();
    this.audit(invitation.organizationId, user.id, 'MEMBER_INVITATION_ACCEPTED', 'organization_membership', membership.id, {
      email: user.email,
      role: membership.role,
      invitedBy: invitation.invitedBy,
    });
    return membership;
  }

  async updateMemberRole(organizationId: string, memberId: string, dto: UpdateMemberRoleDto, actorId?: string) {
    const membership = dbStore.organizationMemberships.find(
      (m) => m.id === memberId && m.organizationId === organizationId,
    );

    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    const previousRole = membership.role;
    membership.role = dto.role;
    membership.updatedAt = new Date();
    this.audit(organizationId, actorId || membership.userId, 'MEMBER_ROLE_UPDATED', 'organization_membership', memberId, {
      memberUserId: membership.userId,
      previousRole,
      nextRole: dto.role,
    });
    return membership;
  }

  async removeMember(organizationId: string, memberId: string, actorId?: string) {
    const membership = dbStore.organizationMemberships.find(
      (m) => m.id === memberId && m.organizationId === organizationId,
    );

    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    membership.status = MembershipStatus.REMOVED;
    membership.updatedAt = new Date();
    this.audit(organizationId, actorId || membership.userId, 'MEMBER_REMOVED', 'organization_membership', memberId, {
      memberUserId: membership.userId,
      role: membership.role,
    });
    return { success: true, message: 'Member access revoked' };
  }

  private findValidInvitation(token: string) {
    const tokenHash = SecurityUtils.hashToken(token);
    const invitation = dbStore.organizationInvitations.find(
      (item) => item.tokenHash === tokenHash && !item.acceptedAt && !item.revokedAt,
    );
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (new Date(invitation.expiresAt) <= new Date()) {
      throw new BadRequestException('Invitation has expired');
    }
    return invitation;
  }

  private roleForInvitation(roleId: string): Role {
    const roleDefinition = dbStore.roles.find((item) => item.id === roleId);
    return this.normalizeRole(roleDefinition?.code || Role.VIEWER);
  }

  private normalizeRole(role: string): Role {
    if (!Object.values(Role).includes(role as Role) || role === Role.SUPER_ADMIN || role === Role.OWNER) {
      throw new BadRequestException('Invalid invitation role');
    }
    return role as Role;
  }

  private audit(
    organizationId: string,
    actorId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, any>,
  ) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'user',
      actorId,
      action: action as AuditAction,
      resourceType,
      resourceId,
      metadata,
      createdAt: new Date(),
    });
  }
}
