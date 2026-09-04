import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, AffiliateEntity, ProgramAffiliateEntity, AffiliateApplicationEntity, TrackingLinkEntity } from '../../database/store';
import { AffiliateStatus, AffiliateInvitationStatus, ApplicationStatus, AuditAction, ProgramStatus, TrackingLinkStatus, AutomationTriggerType, TierTransitionType, EnvironmentType } from '../../common/enums';
import { MembershipStatus } from '../../common/enums/rbac';
import { SecurityUtils } from '../../common/utils/security.utils';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import { getAppConfig } from '../../config/app.config';
import { AcceptAffiliateInvitationDto, CreateAffiliateDto, CreateAffiliateInvitationDto, InvitationCommissionType, PublicApplyDto } from './dto/affiliate.dto';
import { BrevoEmailService } from '../memberships/brevo-email.service';
import { TierService } from '../gamification/tiers/tier.service';
import { AutomationEngineService } from '../automations/engine/automation-engine.service';

@Injectable()
export class AffiliatesService {
  constructor(
    private readonly brevoEmail: BrevoEmailService,
    private readonly tierService: TierService,
    private readonly automationEngineService: AutomationEngineService,
  ) {}

  private assertUserEligibleForAffiliate(email: string) {
    const setting = dbStore.platformSettings?.find(
      (s) => s.key === 'affiliateEligibility.allowOrganizationMembers',
    );
    const allowOrganizationMembers = setting ? Boolean(setting.value) : false;

    if (allowOrganizationMembers) {
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = dbStore.users.find(
      (u) => u.email.toLowerCase().trim() === normalizedEmail && !u.deletedAt,
    );

    if (!existingUser) {
      return;
    }

    const activeOrgMembership = dbStore.organizationMemberships.find((m) => {
      if (m.userId !== existingUser.id) return false;
      if (m.status !== MembershipStatus.ACTIVE) return false;
      const org = dbStore.organizations.find((o) => o.id === m.organizationId && !o.deletedAt);
      if (org && (org.status === 'SUSPENDED' || org.status === 'CLOSED')) return false;
      const role = String(m.role).toUpperCase();
      return role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER' || role === 'MANAGER';
    });

    if (activeOrgMembership) {
      throw new ConflictException({
        statusCode: 409,
        code: 'AFFILIATE_INELIGIBLE_ORGANIZATION_MEMBER',
        message: 'This user is already associated with an organization account and cannot be invited as an affiliate at this time.',
      });
    }
  }

  async create(organizationId: string, dto: CreateAffiliateDto, actorId?: string, skipAudit = false, environment: EnvironmentType = EnvironmentType.LIVE) {
    const email = dto.email.toLowerCase().trim();
    this.assertUserEligibleForAffiliate(email);

    let affiliate = dbStore.affiliates.find(
      (a) => a.organizationId === organizationId && a.email === email,
    );

    if (!affiliate) {
      affiliate = {
        id: uuidv4(),
        organizationId,
        displayName: dto.displayName,
        email,
        companyName: dto.companyName,
        website: dto.website,
        country: dto.country || 'US',
        status: AffiliateStatus.ACTIVE,
        trustScore: 80,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.affiliates.push(affiliate);
    }

    const referralCode = SecurityUtils.generateRandomCode(10).toLowerCase();

    const program = dbStore.programs.find((p) => p.id === dto.programId && p.organizationId === organizationId && !p.deletedAt);
    if (!program) {
      throw new NotFoundException('Program not found');
    }
    EnvironmentUtils.assertEnvironmentIntegrity(program, { organizationId, environment }, 'affiliate membership');

    const progAffiliate: ProgramAffiliateEntity = {
      id: uuidv4(),
      organizationId,
      environment,
      programId: dto.programId,
      affiliateId: affiliate.id,
      status: AffiliateStatus.ACTIVE,
      referralCode,
      joinedAt: new Date(),
    };

    dbStore.programAffiliates.push(progAffiliate);

    // Assign initial default partner tier if not already assigned
    const existingTier = dbStore.affiliateTiers.find(
      (at) => at.organizationId === organizationId && at.programId === dto.programId && at.affiliateId === affiliate!.id,
    );
    if (!existingTier) {
      const defaultTier = dbStore.partnerTiers.find(
        (t) => t.organizationId === organizationId && (!t.programId || t.programId === dto.programId) && t.isDefault && t.isActive && !t.deletedAt,
      ) || dbStore.partnerTiers.find((t) => t.organizationId === organizationId && t.isActive && !t.deletedAt);

      if (defaultTier) {
        dbStore.affiliateTiers.push({
          id: uuidv4(),
          organizationId,
          environment,
          programId: dto.programId,
          affiliateId: affiliate.id,
          currentTierId: defaultTier.id,
          effectiveFrom: new Date(),
          isLocked: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        dbStore.affiliateTierHistories.push({
          id: uuidv4(),
          organizationId,
          environment,
          programId: dto.programId,
          affiliateId: affiliate.id,
          newTierId: defaultTier.id,
          transitionType: TierTransitionType.INITIAL_ASSIGNMENT,
          reason: 'Initial default tier assignment on program enrollment',
          metricSnapshot: {},
          ruleSnapshot: { tierCode: defaultTier.code, name: defaultTier.name },
          effectiveCommissionRate: defaultTier.commissionRateOverride,
          createdAt: new Date(),
        });
      }
    }

    // Auto-create tracking link
    const trackingLink: TrackingLinkEntity = {
      id: uuidv4(),
      organizationId,
      environment,
      programId: dto.programId,
      affiliateId: affiliate.id,
      destinationUrl: 'https://example.com',
      shortCode: referralCode,
      status: TrackingLinkStatus.ACTIVE,
      createdAt: new Date(),
    };
    dbStore.trackingLinks.push(trackingLink);

    // Trigger onboarding automations
    await this.automationEngineService.handleEvent(
      AutomationTriggerType.AFFILIATE_JOINED_PROGRAM,
      organizationId,
      dto.programId,
      affiliate.id,
    );

    if (!skipAudit) {
      dbStore.auditLogs.push({
        id: uuidv4(),
        organizationId,
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId || 'system',
        action: 'AFFILIATE_CREATED' as AuditAction,
        resourceType: 'affiliate',
        resourceId: affiliate.id,
        metadata: {
          email: affiliate.email,
          displayName: affiliate.displayName,
          programId: dto.programId,
          programAffiliateId: progAffiliate.id,
          trackingLinkId: trackingLink.id,
        },
        createdAt: new Date(),
      });
    }

    return { affiliate, programAffiliate: progAffiliate, trackingLink };
  }

  async inviteAffiliate(organizationId: string, dto: CreateAffiliateInvitationDto, actorId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    const email = dto.email.toLowerCase().trim();
    this.assertUserEligibleForAffiliate(email);
    const partnerName = dto.partnerName.trim();
    const program = dbStore.programs.find((item) =>
      item.id === dto.programId &&
      item.organizationId === organizationId &&
      (item.environment === environment || (!item.environment && environment === EnvironmentType.LIVE)) &&
      !item.deletedAt,
    );
    if (!program) {
      throw new NotFoundException('Program not found');
    }

    const affiliate = dbStore.affiliates.find((item) => item.organizationId === organizationId && item.email === email);
    const activeMembership = affiliate && dbStore.programAffiliates.find(
      (item) => item.organizationId === organizationId && item.programId === program.id && item.affiliateId === affiliate.id && item.status === AffiliateStatus.ACTIVE,
    );
    if (activeMembership) {
      throw new BadRequestException('This partner is already a member of this program.');
    }

    const existingInvitation = dbStore.affiliateInvitations.find(
      (item) =>
        item.organizationId === organizationId &&
        item.programId === program.id &&
        item.email === email &&
        item.status === AffiliateInvitationStatus.PENDING &&
        !item.revokedAt &&
        new Date(item.expiresAt) > new Date(),
    );
    if (existingInvitation) {
      throw new BadRequestException('Invitation already sent. Resend the existing invitation instead.');
    }

    const token = `${uuidv4()}${uuidv4()}`.replace(/-/g, '');
    const invitation = {
      id: uuidv4(),
      organizationId,
      environment,
      programId: program.id,
      email,
      partnerName,
      affiliateType: dto.affiliateType,
      primaryChannel: dto.primaryChannel,
      customChannel: dto.customChannel?.trim() || undefined,
      commissionOverrideType: dto.commissionOverride?.type,
      commissionOverrideValue: dto.commissionOverride ? this.normalizeCommissionOverride(dto.commissionOverride.type, dto.commissionOverride.value) : undefined,
      personalMessage: dto.personalMessage?.trim() || undefined,
      status: AffiliateInvitationStatus.PENDING,
      tokenHash: SecurityUtils.hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      invitedBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.affiliateInvitations.push(invitation);
    this.audit(organizationId, actorId, 'AFFILIATE_INVITATION_SENT', 'affiliate_invitation', invitation.id, {
      programId: program.id,
      email,
      affiliateType: invitation.affiliateType,
      primaryChannel: invitation.primaryChannel,
      commissionOverrideType: invitation.commissionOverrideType,
    });

    if (invitation.commissionOverrideType) {
      this.audit(organizationId, actorId, 'AFFILIATE_COMMISSION_OVERRIDE_SET', 'affiliate_invitation', invitation.id, {
        programId: program.id,
        email,
        commissionOverrideType: invitation.commissionOverrideType,
      });
    }

    const inviteUrl = `${getAppConfig().frontendUrl.replace(/\/$/, '')}/invitations/affiliate/${token}`;
    await this.sendAffiliateInvitationEmail(inviteUrl, invitation, program);

    return {
      ...this.serializeInvitation(invitation),
      inviteUrl: process.env.BREVO_API_KEY ? undefined : inviteUrl,
    };
  }

  async listInvitations(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    this.expireOldInvitations();
    return dbStore.affiliateInvitations
      .filter((item) => item.organizationId === organizationId && (item.environment === environment || (!item.environment && environment === EnvironmentType.LIVE)))
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .map((item) => this.serializeInvitation(item));
  }

  async resendInvitation(organizationId: string, invitationId: string, actorId: string) {
    const invitation = this.findInvitation(organizationId, invitationId);
    if (invitation.status !== AffiliateInvitationStatus.PENDING || invitation.revokedAt) {
      throw new BadRequestException('Only pending invitations can be resent.');
    }
    const program = dbStore.programs.find((item) => item.id === invitation.programId && item.organizationId === organizationId);
    if (!program) throw new NotFoundException('Program not found');

    const token = `${uuidv4()}${uuidv4()}`.replace(/-/g, '');
    invitation.tokenHash = SecurityUtils.hashToken(token);
    invitation.expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    invitation.updatedAt = new Date();
    const inviteUrl = `${getAppConfig().frontendUrl.replace(/\/$/, '')}/invitations/affiliate/${token}`;
    this.audit(organizationId, actorId, 'AFFILIATE_INVITATION_RESENT', 'affiliate_invitation', invitation.id, {
      programId: invitation.programId,
      email: invitation.email,
    });
    await this.sendAffiliateInvitationEmail(inviteUrl, invitation, program);
    return { ...this.serializeInvitation(invitation), inviteUrl: process.env.BREVO_API_KEY ? undefined : inviteUrl };
  }

  async revokeInvitation(organizationId: string, invitationId: string, actorId: string) {
    const invitation = this.findInvitation(organizationId, invitationId);
    if (invitation.status !== AffiliateInvitationStatus.PENDING) {
      throw new BadRequestException('Only pending invitations can be revoked.');
    }
    invitation.status = AffiliateInvitationStatus.REVOKED;
    invitation.revokedAt = new Date();
    invitation.updatedAt = new Date();
    this.audit(organizationId, actorId, 'AFFILIATE_INVITATION_REVOKED', 'affiliate_invitation', invitation.id, {
      programId: invitation.programId,
      email: invitation.email,
    });
    return this.serializeInvitation(invitation);
  }

  getPublicInvitation(token: string) {
    const invitation = this.findValidInvitationByToken(token);
    const program = dbStore.programs.find((item) => item.id === invitation.programId && item.organizationId === invitation.organizationId);
    const organization = dbStore.organizations.find((item) => item.id === invitation.organizationId);
    if (!program || !organization) {
      throw new NotFoundException('Invitation not found');
    }
    return {
      id: invitation.id,
      email: invitation.email,
      partnerName: invitation.partnerName,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      programId: program.id,
      programName: program.name,
      programSlug: program.slug,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      personalMessage: invitation.personalMessage,
      commission: invitation.commissionOverrideType
        ? { type: invitation.commissionOverrideType, value: invitation.commissionOverrideValue, override: true }
        : { type: program.commissionType, value: program.defaultCommissionValue, override: false },
      attributionWindowDays: program.cookieDurationDays,
      payoutSchedule: 'Monthly',
      minimumPayoutAmount: 100000,
      currency: program.currency,
      terms: {
        version: 1,
        content: `${program.name} partners must follow approved promotional practices and avoid self-referrals, spam, misleading advertising, and brand bidding unless explicitly permitted.`,
      },
    };
  }

  async acceptAffiliateInvitation(token: string, dto: AcceptAffiliateInvitationDto, userId?: string) {
    if (!dto.acceptedTerms) {
      throw new BadRequestException('Program terms must be accepted.');
    }
    const invitation = this.findValidInvitationByToken(token);
    const program = dbStore.programs.find((item) => item.id === invitation.programId && item.organizationId === invitation.organizationId && !item.deletedAt);
    if (!program || program.status === ProgramStatus.PAUSED || program.status === ProgramStatus.ARCHIVED) {
      throw new BadRequestException('This program is currently unavailable.');
    }

    const existingAffiliate = dbStore.affiliates.find((item) => item.organizationId === invitation.organizationId && item.email === invitation.email);
    const existingMembership = existingAffiliate && dbStore.programAffiliates.find(
      (item) => item.organizationId === invitation.organizationId && item.programId === invitation.programId && item.affiliateId === existingAffiliate.id && item.status === AffiliateStatus.ACTIVE,
    );
    if (existingMembership) {
      invitation.status = AffiliateInvitationStatus.ACCEPTED;
      invitation.acceptedAt = new Date();
      invitation.acceptedBy = userId;
      return { alreadyMember: true, affiliate: existingAffiliate, programAffiliate: existingMembership };
    }

    const created = await this.create(invitation.organizationId, {
      displayName: invitation.partnerName,
      email: invitation.email,
      programId: invitation.programId,
    }, invitation.invitedBy, true);

    created.programAffiliate.source = 'INVITATION';
    created.programAffiliate.primaryChannel = invitation.primaryChannel;
    created.programAffiliate.commissionOverrideType = invitation.commissionOverrideType;
    created.programAffiliate.commissionOverride = invitation.commissionOverrideValue;
    created.programAffiliate.termsVersionAccepted = dto.termsVersionAccepted || 1;
    created.programAffiliate.termsAcceptedAt = new Date();
    created.programAffiliate.invitedBy = invitation.invitedBy;

    invitation.status = AffiliateInvitationStatus.ACCEPTED;
    invitation.acceptedAt = new Date();
    invitation.acceptedBy = userId;
    invitation.updatedAt = new Date();

    this.audit(invitation.organizationId, userId || invitation.invitedBy, 'AFFILIATE_INVITATION_ACCEPTED', 'affiliate_invitation', invitation.id, {
      programId: invitation.programId,
      affiliateId: created.affiliate.id,
    });
    this.audit(invitation.organizationId, userId || invitation.invitedBy, 'AFFILIATE_MEMBERSHIP_CREATED', 'program_affiliate', created.programAffiliate.id, {
      programId: invitation.programId,
      affiliateId: created.affiliate.id,
      source: 'INVITATION',
      termsVersionAccepted: created.programAffiliate.termsVersionAccepted,
    });

    return {
      affiliate: created.affiliate,
      programAffiliate: created.programAffiliate,
      trackingLink: created.trackingLink,
      program: {
        id: program.id,
        name: program.name,
        currency: program.currency,
        defaultCommissionValue: program.defaultCommissionValue,
        attributionWindowDays: program.cookieDurationDays,
      },
    };
  }

  async findAll(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    const affiliateIds = new Set(
      dbStore.programAffiliates
        .filter((pa) => pa.organizationId === organizationId && (pa.environment === environment || (!pa.environment && environment === EnvironmentType.LIVE)))
        .map((pa) => pa.affiliateId),
    );
    return dbStore.affiliates.filter((a) => a.organizationId === organizationId && affiliateIds.has(a.id));
  }

  async findOne(organizationId: string, affiliateId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    const affiliate = dbStore.affiliates.find(
      (a) => a.id === affiliateId && a.organizationId === organizationId,
    );

    if (!affiliate) {
      throw new NotFoundException('Affiliate not found');
    }

    const programs = dbStore.programAffiliates.filter(
      (pa) => pa.affiliateId === affiliate.id && pa.organizationId === organizationId && (pa.environment === environment || (!pa.environment && environment === EnvironmentType.LIVE)),
    );

    const links = dbStore.trackingLinks.filter(
      (tl) => tl.affiliateId === affiliate.id && tl.organizationId === organizationId && (tl.environment === environment || (!tl.environment && environment === EnvironmentType.LIVE)),
    );

    return { ...affiliate, programs, links };
  }

  // Public Application endpoint
  async submitApplication(dto: PublicApplyDto) {
    const app: AffiliateApplicationEntity = {
      id: uuidv4(),
      organizationId: dto.organizationId,
      environment: EnvironmentType.LIVE,
      programId: dto.programId,
      email: dto.email.toLowerCase().trim(),
      name: dto.name,
      website: dto.website,
      promotionMethod: dto.promotionMethod,
      country: 'US',
      status: ApplicationStatus.PENDING,
      createdAt: new Date(),
    };

    dbStore.affiliateApplications.push(app);
    return { success: true, message: 'Application submitted for review', applicationId: app.id };
  }

  async getApplications(organizationId: string) {
    return dbStore.affiliateApplications.filter((a) => a.organizationId === organizationId);
  }

  async approveApplication(organizationId: string, applicationId: string, reviewerId: string) {
    const app = dbStore.affiliateApplications.find(
      (a) => a.id === applicationId && a.organizationId === organizationId,
    );

    if (!app) {
      throw new NotFoundException('Application not found');
    }

    app.status = ApplicationStatus.APPROVED;
    app.reviewedBy = reviewerId;
    app.reviewedAt = new Date();

    // Create affiliate
    const created = await this.create(organizationId, {
      displayName: app.name,
      email: app.email,
      website: app.website,
      programId: app.programId,
    }, reviewerId, true);

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: reviewerId,
      action: AuditAction.AFFILIATE_APPROVED,
      resourceType: 'affiliate_application',
      resourceId: app.id,
      createdAt: new Date(),
    });

    return { application: app, ...created };
  }

  private normalizeCommissionOverride(type: string, value: number) {
    if (type === InvitationCommissionType.PERCENTAGE && value > 100) {
      throw new BadRequestException('Percentage commission override cannot exceed 100%.');
    }
    return value;
  }

  private findInvitation(organizationId: string, invitationId: string) {
    const invitation = dbStore.affiliateInvitations.find((item) => item.id === invitationId && item.organizationId === organizationId);
    if (!invitation) throw new NotFoundException('Invitation not found');
    return invitation;
  }

  private findValidInvitationByToken(token: string) {
    this.expireOldInvitations();
    const tokenHash = SecurityUtils.hashToken(token);
    const invitation = dbStore.affiliateInvitations.find((item) => item.tokenHash === tokenHash);
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status === AffiliateInvitationStatus.REVOKED || invitation.revokedAt) throw new BadRequestException('This invitation is no longer valid.');
    if (invitation.status === AffiliateInvitationStatus.ACCEPTED || invitation.acceptedAt) throw new BadRequestException("You've already joined this program.");
    if (new Date(invitation.expiresAt) <= new Date()) {
      invitation.status = AffiliateInvitationStatus.EXPIRED;
      throw new BadRequestException('This invitation has expired.');
    }
    return invitation;
  }

  private expireOldInvitations() {
    const now = new Date();
    dbStore.affiliateInvitations.forEach((item) => {
      if (item.status === AffiliateInvitationStatus.PENDING && !item.revokedAt && new Date(item.expiresAt) <= now) {
        item.status = AffiliateInvitationStatus.EXPIRED;
        item.updatedAt = now;
      }
    });
  }

  private serializeInvitation(invitation: any) {
    const program = dbStore.programs.find((item) => item.id === invitation.programId);
    const inviter = dbStore.users.find((item) => item.id === invitation.invitedBy);
    return {
      id: invitation.id,
      organizationId: invitation.organizationId,
      programId: invitation.programId,
      programName: program?.name || 'Unknown Program',
      email: invitation.email,
      partnerName: invitation.partnerName,
      affiliateType: invitation.affiliateType,
      primaryChannel: invitation.primaryChannel,
      customChannel: invitation.customChannel,
      commissionOverrideType: invitation.commissionOverrideType,
      commissionOverrideValue: invitation.commissionOverrideValue,
      status: invitation.status,
      invitedBy: invitation.invitedBy,
      invitedByLabel: inviter ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || inviter.email : 'Unknown',
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
    };
  }

  private async sendAffiliateInvitationEmail(inviteUrl: string, invitation: any, program: any) {
    const organization = dbStore.organizations.find((item) => item.id === invitation.organizationId);
    const inviter = dbStore.users.find((item) => item.id === invitation.invitedBy);
    const result = await this.brevoEmail.sendAffiliateInvitationEmail({
      toEmail: invitation.email,
      partnerName: invitation.partnerName,
      organizationName: organization?.name || 'PartnerIQ',
      programName: program.name,
      commissionLabel: this.formatCommissionLabel(invitation, program),
      attributionWindowDays: program.cookieDurationDays || 30,
      payoutSchedule: this.formatPayoutSchedule(program.payoutSchedule || 'MONTHLY'),
      inviteUrl,
      personalMessage: invitation.personalMessage,
      inviterEmail: inviter?.email,
    });

    if (result.sent) {
      console.log(`Affiliate invitation email sent to ${invitation.email} for ${program.name}`);
      return;
    }

    console.log(
      [
        `Affiliate invitation email prepared for ${invitation.email}`,
        `Reason: ${(result as any).reason || (result as any).error || result.status || 'delivery not sent'}`,
        `Subject: You're invited to join ${program.name}`,
        `Accept Invitation: ${inviteUrl}`,
        `Expires: ${invitation.expiresAt.toISOString()}`,
      ].filter(Boolean).join('\n'),
    );
  }

  private formatCommissionLabel(invitation: any, program: any) {
    if (invitation.commissionOverrideType === InvitationCommissionType.PERCENTAGE) {
      return `${Number(invitation.commissionOverrideValue)}%`;
    }
    if (invitation.commissionOverrideType === InvitationCommissionType.FIXED) {
      return `${program.currency || 'USD'} ${Number(invitation.commissionOverrideValue).toLocaleString()}`;
    }
    if (program.commissionType === 'PERCENTAGE') {
      return `${Number(program.defaultCommissionValue) / 100}%`;
    }
    return `${program.currency || 'USD'} ${(Number(program.defaultCommissionValue) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private formatPayoutSchedule(value: string) {
    return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
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
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorId: actorId || 'system',
      action: action as AuditAction,
      resourceType,
      resourceId,
      metadata,
      createdAt: new Date(),
    });
  }
}
