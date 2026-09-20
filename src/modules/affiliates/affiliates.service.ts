import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, AffiliateEntity, ProgramAffiliateEntity, AffiliateApplicationEntity, TrackingLinkEntity } from '../../database/store';
import { AffiliateStatus, AffiliateInvitationStatus, AFFILIATE_INVITATION_COMPLETED_STATUSES, AFFILIATE_INVITATION_OPEN_STATUSES, ApplicationStatus, AuditAction, OrganizationStatus, ProgramStatus, TrackingLinkStatus, AutomationTriggerType, TierTransitionType, EnvironmentType, PlatformRole, WebhookEvent } from '../../common/enums';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { SecurityUtils } from '../../common/utils/security.utils';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import { getAppConfig } from '../../config/app.config';
import * as XLSX from 'xlsx';
import {
  AcceptAffiliateInvitationDto,
  BulkUploadAffiliateInvitationsDto,
  CreateAffiliateDto,
  CreateAffiliateInvitationDto,
  InvitationCommissionType,
  PublicApplyDto,
  ListAffiliatesQueryDto,
  AffiliateAnalyticsQueryDto,
  BulkAffiliateActionDto,
  AssignAffiliateTierDto,
} from './dto/affiliate.dto';
import { BrevoEmailService } from '../memberships/brevo-email.service';
import { TierService } from '../gamification/tiers/tier.service';
import { AutomationEngineService } from '../automations/engine/automation-engine.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { initializeDataSource } from '../../database/data-source';
import {
  Affiliate,
  ProgramAffiliate,
  TrackingLink,
  Program,
  Organization,
  User,
  AffiliateInvitation,
  AffiliateApplication,
  AffiliatePortalProfile,
  AffiliatePayoutMethod,
  Conversion,
  Commission,
  Click,
  OrganizationMembership,
  PartnerTier,
  AffiliateTier,
  Coupon,
  Payout,
} from '../../database/schema';
import { IsNull, In } from 'typeorm';
import { assertUserEligibleForAffiliate } from './affiliate-eligibility.policy';
import { SystemEmailDispatchService } from '../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionLimitService } from '../billing/services/subscription-limit.service';
import { BillingResourceType } from '../billing/enums/billing.enums';

@Injectable()
export class AffiliatesService {
  private readonly logger = new Logger(AffiliatesService.name);

  constructor(
    private readonly brevoEmail: BrevoEmailService,
    private readonly tierService: TierService,
    private readonly automationEngineService: AutomationEngineService,
    private readonly webhooksService?: WebhooksService,
    private readonly emailDispatch?: SystemEmailDispatchService,
    private readonly notificationsService?: NotificationsService,
    private readonly subscriptionLimits?: SubscriptionLimitService,
  ) { }

  private formatProgramCommissionRate(program?: { commissionType?: string; defaultCommissionValue?: number }): string {
    if (!program?.defaultCommissionValue) return 'Program default rate';
    const value = program.defaultCommissionValue / 100;
    if (program.commissionType === 'FIXED_AMOUNT') return `${value.toFixed(2)} per Conversion`;
    const isRecurring = String(program.commissionType || '').toUpperCase().includes('RECURRING');
    return `${value.toFixed(1)}%${isRecurring ? ' Recurring' : ''}`;
  }

  private async notifyApplicant(
    templateKey: SystemTemplateKey,
    organizationId: string,
    applicantEmail: string,
    applicantName: string,
    programId?: string,
    extra: Record<string, any> = {},
  ) {
    const organization = dbStore.organizations.find((item) => item.id === organizationId);
    const program = programId ? dbStore.programs.find((item) => item.id === programId) : undefined;
    const dashboardUrl = `${getAppConfig().affiliateFrontendUrl.replace(/\/$/, '')}/dashboard`;
    await this.emailDispatch?.send(
      templateKey,
      applicantEmail,
      {
        affiliate: { firstName: (applicantName || '').split(' ')[0] || applicantName },
        organization: { name: organization?.name || 'PartnerIQ' },
        links: { dashboardUrl },
        // Flat fields — these match the email-design templates' own variables
        // (programName/commissionRate/referralLink/portalUrl/supportUrl), since the
        // resolver renders the actual seeded email-design template for these keys.
        programName: program?.name || 'the partner program',
        commissionRate: this.formatProgramCommissionRate(program),
        portalUrl: dashboardUrl,
        supportUrl: 'https://partneriq.in/marketplace',
        ...extra,
      },
      { organizationId },
    );

    // In-app notification only if the applicant already has an account (public applications
    // may come from an email with no User record yet).
    const applicantUser = dbStore.users.find((u) => u.email?.toLowerCase() === applicantEmail.toLowerCase());
    if (!applicantUser) return;

    const { title, body } = this.applicationNotificationCopy(templateKey, organization?.name || 'PartnerIQ');
    this.notificationsService?.createNotification({
      userId: applicantUser.id,
      organizationId,
      type: 'program',
      title,
      body,
      channel: 'in_app',
      priority: 'normal',
      actionUrl: '/dashboard',
    }).catch(() => undefined);
  }

  private applicationNotificationCopy(templateKey: SystemTemplateKey, organizationName: string): { title: string; body: string } {
    switch (templateKey) {
      case SystemTemplateKey.AFFILIATE_APPLICATION_APPROVED:
        return { title: 'Application approved', body: `Your application to ${organizationName} was approved. Start promoting!` };
      case SystemTemplateKey.AFFILIATE_APPLICATION_REJECTED:
        return { title: 'Application update', body: `Your application to ${organizationName} was not approved this time.` };
      default:
        return { title: 'Application received', body: `Your application to ${organizationName} is under review.` };
    }
  }

  private async notifyOrgOfAcceptedInvitation(organizationId: string, affiliateName: string) {
    const organization = dbStore.organizations.find((item) => item.id === organizationId);
    const owners = dbStore.organizationMemberships.filter(
      (m) => m.organizationId === organizationId && (m.role === 'OWNER' || m.role === 'ADMIN'),
    );
    const dashboardUrl = `${getAppConfig().frontendUrl.replace(/\/$/, '')}/organizations/${organizationId}/affiliates`;

    for (const membership of owners) {
      const admin = dbStore.users.find((u) => u.id === membership.userId) as User | undefined;
      if (!admin?.email) continue;
      await this.emailDispatch?.send(
        SystemTemplateKey.AFFILIATE_INVITATION_ACCEPTED,
        admin.email,
        {
          affiliate: { firstName: affiliateName },
          organization: { name: organization?.name || 'Your organization' },
          links: { dashboardUrl },
        },
        { organizationId },
      );

      this.notificationsService?.createNotification({
        userId: admin.id,
        organizationId,
        type: 'program',
        title: 'Affiliate invitation accepted',
        body: `${affiliateName} accepted your invitation and joined the program.`,
        channel: 'in_app',
        priority: 'normal',
        actionUrl: `/organizations/${organizationId}/affiliates`,
      }).catch(() => undefined);
    }
  }

  private emitWebhook(organizationId: string, event: WebhookEvent, payload: any) {
    this.webhooksService?.triggerEvent(organizationId, event, payload).catch((error) => {
      this.logger.error(`Webhook delivery failed for ${event}: ${error?.message || error}`);
    });
  }

  /**
   * Creates an affiliate and joins them to a program.
   *
   * Capacity is only consumed when a genuinely new affiliate record is created.
   * Adding an affiliate who already exists in this organization to a second
   * program writes a `program_affiliates` row and nothing else, so a partner in
   * five programs still counts as one affiliate against the account limit.
   *
   * That conditional makes `reserve` unsuitable here — the existence check and
   * the limit check must happen together inside the lock, which is what
   * `runExclusiveForOrganization` provides.
   */
  async create(organizationId: string, dto: CreateAffiliateDto, actorId?: string, skipAudit = false, environment: EnvironmentType = EnvironmentType.LIVE) {
    if (!this.subscriptionLimits) {
      return this.createAffiliateRecord(organizationId, dto, actorId, skipAudit, environment);
    }
    return this.subscriptionLimits.runExclusiveForOrganization(
      organizationId,
      BillingResourceType.AFFILIATE,
      async (accountId) => {
        const email = dto.email.toLowerCase().trim();
        if (!(await this.affiliateSlotAlreadyReserved(organizationId, email))) {
          await this.subscriptionLimits!.assertCanCreate(accountId, BillingResourceType.AFFILIATE);
        }
        return this.createAffiliateRecord(organizationId, dto, actorId, skipAudit, environment);
      },
    );
  }

  /**
   * Whether this email already holds an affiliate slot in the organization —
   * either as an affiliate record, or as a live invitation that reserved the
   * slot when it was sent. Both mean creating the record consumes no new
   * capacity, so an invited partner is never blocked while accepting.
   */
  private async affiliateSlotAlreadyReserved(organizationId: string, email: string) {
    if (dbStore.affiliates.some((a) => a.organizationId === organizationId && a.email === email)) {
      return true;
    }

    const hasLiveInvitation = dbStore.affiliateInvitations.some(
      (invite) =>
        invite.organizationId === organizationId &&
        invite.email?.toLowerCase().trim() === email &&
        invite.status === 'PENDING' &&
        !invite.revokedAt &&
        !invite.acceptedAt &&
        new Date(invite.expiresAt).getTime() > Date.now(),
    );
    if (hasLiveInvitation) return true;

    try {
      const dataSource = await initializeDataSource();
      const found = await dataSource.getRepository(Affiliate).findOne({
        where: { organizationId, email },
      });
      return Boolean(found);
    } catch {
      return false;
    }
  }

  private async createAffiliateRecord(organizationId: string, dto: CreateAffiliateDto, actorId?: string, skipAudit = false, environment: EnvironmentType = EnvironmentType.LIVE) {
    const email = dto.email.toLowerCase().trim();
    assertUserEligibleForAffiliate(email);

    let affiliate = dbStore.affiliates.find(
      (a) => a.organizationId === organizationId && a.email === email,
    );

    if (!affiliate) {
      try {
        const dataSource = await initializeDataSource();
        const dbAff = await dataSource.getRepository(Affiliate).findOne({
          where: { organizationId, email },
        });
        if (dbAff) {
          affiliate = dbAff as any;
          if (!dbStore.affiliates.some((a) => a.id === dbAff.id)) {
            dbStore.affiliates.push(dbAff as any);
          }
        }
      } catch { }
    }

    const isNewAffiliateRecord = !affiliate;

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

    let program = dbStore.programs.find((p) => p.id === dto.programId && p.organizationId === organizationId && !p.deletedAt);
    if (!program) {
      try {
        const dataSource = await initializeDataSource();
        const dbProg = await dataSource.getRepository(Program).findOne({
          where: { id: dto.programId, organizationId, deletedAt: IsNull() },
        });
        if (dbProg) {
          program = dbProg as any;
          if (!dbStore.programs.some((p) => p.id === dbProg.id)) {
            dbStore.programs.push(dbProg as any);
          }
        }
      } catch { }
    }
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

    try {
      const dataSource = await initializeDataSource();
      await dataSource.getRepository(Affiliate).save(affiliate);
      await dataSource.getRepository(ProgramAffiliate).save(progAffiliate);
      await dataSource.getRepository(TrackingLink).save(trackingLink);
    } catch (err) {
      console.warn('Failed to persist affiliate creation to database:', err);
    }

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

    if (isNewAffiliateRecord) {
      this.emitWebhook(organizationId, WebhookEvent.AFFILIATE_CREATED, {
        affiliateId: affiliate.id,
        programId: dto.programId,
        status: affiliate.status,
      });
    }

    return { affiliate, programAffiliate: progAffiliate, trackingLink };
  }

  /**
   * Sends an affiliate invitation.
   *
   * A live invitation reserves a slot so an admin cannot invite fifty partners
   * on a fifty-affiliate plan and only discover the problem when they accept.
   * Expired and revoked invitations release the slot automatically — see
   * `SubscriptionUsageService`.
   */
  async inviteAffiliate(organizationId: string, dto: CreateAffiliateInvitationDto, actorId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    if (!this.subscriptionLimits) {
      return this.createAffiliateInvitation(organizationId, dto, actorId, environment);
    }
    return this.subscriptionLimits.reserveForOrganization(
      organizationId,
      BillingResourceType.AFFILIATE,
      () => this.createAffiliateInvitation(organizationId, dto, actorId, environment),
    );
  }

  private async createAffiliateInvitation(organizationId: string, dto: CreateAffiliateInvitationDto, actorId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    const email = dto.email.toLowerCase().trim();
    assertUserEligibleForAffiliate(email);
    const partnerName = dto.partnerName.trim();
    let program = dbStore.programs.find((item) =>
      item.id === dto.programId &&
      item.organizationId === organizationId &&
      (item.environment === environment || (!item.environment && environment === EnvironmentType.LIVE)) &&
      !item.deletedAt,
    );
    if (!program) {
      try {
        const dataSource = await initializeDataSource();
        const dbProg = await dataSource.getRepository(Program).findOne({
          where: { id: dto.programId, organizationId, deletedAt: IsNull() },
        });
        if (dbProg) {
          program = dbProg as any;
          if (!dbStore.programs.some(p => p.id === dbProg.id)) {
            dbStore.programs.push(dbProg as any);
          }
        }
      } catch { }
    }
    if (!program) {
      throw new NotFoundException('Program not found');
    }

    const affiliate = dbStore.affiliates.find((item) => item.organizationId === organizationId && item.email === email);
    // Block at the ORGANIZATION level, not just per-program: once a partner is already an
    // active affiliate anywhere in this org, they should be managed/added to programs
    // directly rather than re-invited by email, which would just create a confusing duplicate flow.
    const activeOrgMembership = affiliate && dbStore.programAffiliates.find(
      (item) => item.organizationId === organizationId && item.affiliateId === affiliate.id && item.status === AffiliateStatus.ACTIVE,
    );
    if (activeOrgMembership) {
      const alreadyInThisProgram = activeOrgMembership.programId === program.id;
      throw new BadRequestException(
        alreadyInThisProgram
          ? 'This partner is already a member of this program.'
          : 'This partner is already an active affiliate in your organization. Add them to this program directly instead of sending a new invite.',
      );
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

    try {
      const dataSource = await initializeDataSource();
      await dataSource.getRepository(AffiliateInvitation).save(invitation);
    } catch (err) {
      console.warn('Failed to persist affiliate invitation to database:', err);
    }
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

    const inviteUrl = this.buildInvitationUrl(token);
    await this.sendAffiliateInvitationEmail(inviteUrl, invitation, program);

    return {
      ...this.serializeInvitation(invitation),
      inviteUrl: process.env.BREVO_API_KEY ? undefined : inviteUrl,
    };
  }

  async bulkInviteAffiliates(
    organizationId: string,
    dto: BulkUploadAffiliateInvitationsDto,
    actorId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    if (!dto.fileBase64) {
      throw new BadRequestException('File content is required.');
    }

    const base64Data = dto.fileBase64.includes(';base64,')
      ? dto.fileBase64.split(';base64,')[1]
      : dto.fileBase64;

    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64Data, 'base64');
    } catch {
      throw new BadRequestException('Invalid base64 encoded file data.');
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch (err: any) {
      throw new BadRequestException(
        'Unable to parse file. Please upload a valid .csv or .xlsx file format.',
      );
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new BadRequestException('The uploaded spreadsheet contains no sheets.');
    }

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      throw new BadRequestException(
        'The uploaded spreadsheet is empty. Please provide at least one affiliate partner.',
      );
    }

    // Preload programs for this organization
    let orgPrograms = dbStore.programs.filter(
      (p) =>
        p.organizationId === organizationId &&
        !p.deletedAt &&
        (p.environment === environment || (!p.environment && environment === EnvironmentType.LIVE)),
    );

    try {
      const dataSource = await initializeDataSource();
      const dbPrograms = await dataSource.getRepository(Program).find({
        where: { organizationId, deletedAt: IsNull() },
      });
      if (dbPrograms && dbPrograms.length > 0) {
        for (const prog of dbPrograms) {
          if (!orgPrograms.some((p) => p.id === prog.id)) {
            orgPrograms.push(prog as any);
          }
          if (!dbStore.programs.some((p) => p.id === prog.id)) {
            dbStore.programs.push(prog as any);
          }
        }
      }
    } catch { }

    const successful: Array<{
      rowNumber: number;
      id: string;
      partnerName: string;
      email: string;
      programName: string;
    }> = [];

    const failed: Array<{
      rowNumber: number;
      partnerName: string;
      email: string;
      program: string;
      reason: string;
      originalRow: Record<string, any>;
    }> = [];

    const seenInBatch = new Set<string>();

    const getRowValue = (row: any, ...keys: string[]): string => {
      const normalizedKeys = keys.map((k) => k.toLowerCase().replace(/[\s_\-#]/g, ''));
      for (const [key, val] of Object.entries(row)) {
        const cleanKey = String(key).toLowerCase().replace(/[\s_\-#]/g, '');
        if (normalizedKeys.includes(cleanKey)) {
          return String(val ?? '').trim();
        }
      }
      return '';
    };

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (let index = 0; index < rawRows.length; index++) {
      const row = rawRows[index];
      const rowNumber = index + 2; // Row 1 is header in spreadsheet

      const partnerName = getRowValue(row, 'Partner Name', 'Name', 'Partner', 'Full Name', 'DisplayName');
      const rawEmail = getRowValue(row, 'Email', 'Email Address', 'Contact Email');
      const rowProgram = getRowValue(row, 'Program', 'Program Name', 'Program ID', 'Target Program', 'Program Name or ID');
      const overrideTypeRaw = getRowValue(row, 'Commission Override Type', 'Override Type', 'Commission Type', 'Type');
      const overrideValRaw = getRowValue(row, 'Commission Override Value', 'Override Value', 'Commission Value', 'Value', 'Rate');
      const personalMessageRaw = getRowValue(row, 'Personal Message', 'Message', 'Note', 'Notes');

      // Skip completely empty rows
      if (!partnerName && !rawEmail && !rowProgram) {
        continue;
      }

      // 1. Validate Partner Name
      if (!partnerName) {
        failed.push({
          rowNumber,
          partnerName: '',
          email: rawEmail,
          program: rowProgram || 'Not specified',
          reason: 'Partner Name is required.',
          originalRow: row,
        });
        continue;
      }

      // 2. Validate Email
      if (!rawEmail) {
        failed.push({
          rowNumber,
          partnerName,
          email: '',
          program: rowProgram || 'Not specified',
          reason: 'Email address is required.',
          originalRow: row,
        });
        continue;
      }

      const email = rawEmail.toLowerCase().trim();
      if (!emailRegex.test(email)) {
        failed.push({
          rowNumber,
          partnerName,
          email,
          program: rowProgram || 'Not specified',
          reason: 'Invalid email address format.',
          originalRow: row,
        });
        continue;
      }

      // 3. Check Affiliate Eligibility (internal members cannot be affiliates)
      try {
        assertUserEligibleForAffiliate(email);
      } catch (err: any) {
        failed.push({
          rowNumber,
          partnerName,
          email,
          program: rowProgram || 'Not specified',
          reason: err?.message || 'Email belongs to an internal organization team member.',
          originalRow: row,
        });
        continue;
      }

      // 4. Resolve Target Program
      let program: any = null;
      if (rowProgram) {
        program = orgPrograms.find((p) => p.id === rowProgram);
        if (!program) {
          program = orgPrograms.find(
            (p) => p.name.toLowerCase().trim() === rowProgram.toLowerCase().trim(),
          );
        }
        if (!program) {
          program = orgPrograms.find((p) =>
            p.name.toLowerCase().includes(rowProgram.toLowerCase().trim()),
          );
        }
      }

      if (!program && dto.defaultProgramId) {
        program = orgPrograms.find((p) => p.id === dto.defaultProgramId);
      }

      if (!program && orgPrograms.length === 1) {
        program = orgPrograms[0];
      }

      if (!program) {
        failed.push({
          rowNumber,
          partnerName,
          email,
          program: rowProgram || 'Not specified',
          reason: rowProgram
            ? `Program '${rowProgram}' was not found in this organization.`
            : 'No program specified and no default program selected.',
          originalRow: row,
        });
        continue;
      }

      // 5. Check Duplicate in current upload batch
      const dedupeKey = `${email}:${program.id}`;
      if (seenInBatch.has(dedupeKey)) {
        failed.push({
          rowNumber,
          partnerName,
          email,
          program: program.name,
          reason: 'Duplicate entry for this partner and program in the uploaded file.',
          originalRow: row,
        });
        continue;
      }
      seenInBatch.add(dedupeKey);

      // 6. Check Active Organization Membership — org-wide (any program), matching the
      // same rule the single-invite flow enforces: once a partner is already an active
      // affiliate anywhere in this org, they should be added to programs directly rather
      // than re-invited by email.
      const existingAffiliate = dbStore.affiliates.find(
        (item) => item.organizationId === organizationId && item.email === email,
      );
      const activeOrgMembership =
        existingAffiliate &&
        dbStore.programAffiliates.find(
          (item) =>
            item.organizationId === organizationId &&
            item.affiliateId === existingAffiliate.id &&
            item.status === AffiliateStatus.ACTIVE,
        );

      if (activeOrgMembership) {
        const alreadyInThisProgram = activeOrgMembership.programId === program.id;
        failed.push({
          rowNumber,
          partnerName,
          email,
          program: program.name,
          reason: alreadyInThisProgram
            ? 'This partner is already an active enrolled member of this program.'
            : 'This partner is already an active affiliate in your organization. Add them to this program directly instead of re-inviting.',
          originalRow: row,
        });
        continue;
      }

      // 7. Check Existing Active/Pending Invitation
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
        failed.push({
          rowNumber,
          partnerName,
          email,
          program: program.name,
          reason: 'A pending invitation has already been sent to this partner for this program.',
          originalRow: row,
        });
        continue;
      }

      // 8. Validate Commission Override (Optional)
      let commissionOverrideType: InvitationCommissionType | undefined = undefined;
      let commissionOverrideValue: number | undefined = undefined;

      if (overrideTypeRaw || overrideValRaw) {
        const normType = overrideTypeRaw.toUpperCase();
        if (normType.includes('PERCENT') || normType === 'PERCENTAGE' || normType === '%') {
          commissionOverrideType = InvitationCommissionType.PERCENTAGE;
        } else if (normType.includes('FIX') || normType === 'FIXED' || normType === '$') {
          commissionOverrideType = InvitationCommissionType.FIXED;
        } else if (overrideValRaw) {
          commissionOverrideType = InvitationCommissionType.PERCENTAGE;
        }

        const parsedVal = Number(overrideValRaw);
        if (!isNaN(parsedVal) && parsedVal > 0) {
          if (commissionOverrideType === InvitationCommissionType.PERCENTAGE && parsedVal > 100) {
            failed.push({
              rowNumber,
              partnerName,
              email,
              program: program.name,
              reason: 'Percentage commission override cannot exceed 100%.',
              originalRow: row,
            });
            continue;
          }
          commissionOverrideValue = parsedVal;
        }
      }

      const personalMessage =
        personalMessageRaw || dto.defaultPersonalMessage?.trim() || undefined;

      // 9. Create and Save Invitation
      const token = `${uuidv4()}${uuidv4()}`.replace(/-/g, '');
      const invitation: any = {
        id: uuidv4(),
        organizationId,
        environment,
        programId: program.id,
        email,
        partnerName,
        commissionOverrideType,
        commissionOverrideValue,
        personalMessage,
        status: AffiliateInvitationStatus.PENDING,
        tokenHash: SecurityUtils.hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        invitedBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      dbStore.affiliateInvitations.push(invitation);

      try {
        const dataSource = await initializeDataSource();
        await dataSource.getRepository(AffiliateInvitation).save(invitation);
      } catch (err) {
        console.warn('Failed to persist affiliate invitation to database in bulk:', err);
      }

      this.audit(organizationId, actorId, 'AFFILIATE_INVITATION_SENT', 'affiliate_invitation', invitation.id, {
        programId: program.id,
        email,
        source: 'BULK_UPLOAD',
      });

      // 10. Send Invitation Email
      const inviteUrl = this.buildInvitationUrl(token);
      try {
        await this.sendAffiliateInvitationEmail(inviteUrl, invitation, program);
      } catch (emailErr) {
        console.warn(`Failed to dispatch email to ${email} in bulk:`, emailErr);
      }

      successful.push({
        rowNumber,
        id: invitation.id,
        partnerName,
        email,
        programName: program.name,
      });
    }

    // 11. Generate Error Excel file if any rows failed
    let errorReportBase64: string | null = null;
    if (failed.length > 0) {
      const errorRows = failed.map((f) => ({
        'Row #': f.rowNumber,
        'Partner Name': f.partnerName,
        'Email Address': f.email,
        'Program': f.program,
        'Status': 'FAILED',
        'Issue / Error Reason': f.reason,
        ...f.originalRow,
      }));

      const errorWorksheet = XLSX.utils.json_to_sheet(errorRows);
      const errorWorkbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(errorWorkbook, errorWorksheet, 'Failed Rows');
      errorReportBase64 = XLSX.write(errorWorkbook, {
        type: 'base64',
        bookType: 'xlsx',
      });
    }

    return {
      totalRows: successful.length + failed.length,
      successfulCount: successful.length,
      failedCount: failed.length,
      successful,
      errors: failed.map((f) => ({
        rowNumber: f.rowNumber,
        partnerName: f.partnerName,
        email: f.email,
        program: f.program,
        reason: f.reason,
      })),
      errorReportBase64,
      errorReportFileName: `affiliate-invitations-errors-${new Date().toISOString().split('T')[0]}.xlsx`,
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
    const invitation = await this.findInvitation(organizationId, invitationId);
    // Resending exists precisely for invitations that expired or where the
    // partner never finished registering, so those states must be resendable.
    // Only a completed or revoked invitation is off limits.
    if (AFFILIATE_INVITATION_COMPLETED_STATUSES.includes(invitation.status as AffiliateInvitationStatus)) {
      throw new BadRequestException('This partner has already joined the program.');
    }
    if (invitation.status === AffiliateInvitationStatus.REVOKED || invitation.revokedAt) {
      throw new BadRequestException('This invitation was revoked. Send a new invitation instead.');
    }
    let program = dbStore.programs.find((item) => item.id === invitation.programId && item.organizationId === organizationId);
    if (!program) {
      try {
        const dataSource = await initializeDataSource();
        const dbProg = await dataSource.getRepository(Program).findOne({ where: { id: invitation.programId, organizationId } });
        if (dbProg) program = dbProg as any;
      } catch { }
    }
    if (!program) throw new NotFoundException('Program not found');

    // A resend replaces the token outright, so any link from the previous email
    // stops working — the old hash is gone and nothing can match it. The same
    // invitation row is reused, which keeps the invited email fixed and avoids
    // creating a second invitation for the same partner.
    const token = `${uuidv4()}${uuidv4()}`.replace(/-/g, '');
    invitation.tokenHash = SecurityUtils.hashToken(token);
    invitation.expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    // Reopen an invitation that had expired, and clear any half-finished terms
    // acceptance so the partner sees the current terms on the new link.
    invitation.status = AffiliateInvitationStatus.PENDING;
    invitation.termsAcceptedAt = undefined;
    invitation.termsVersionAccepted = undefined;
    invitation.revokedAt = undefined;
    invitation.updatedAt = new Date();
    try {
      const dataSource = await initializeDataSource();
      await dataSource.getRepository(AffiliateInvitation).save(invitation);
    } catch { }
    const inviteUrl = this.buildInvitationUrl(token);
    this.audit(organizationId, actorId, 'AFFILIATE_INVITATION_RESENT', 'affiliate_invitation', invitation.id, {
      programId: invitation.programId,
      email: invitation.email,
    });
    await this.sendAffiliateInvitationEmail(inviteUrl, invitation, program);
    return { ...this.serializeInvitation(invitation), inviteUrl: process.env.BREVO_API_KEY ? undefined : inviteUrl };
  }

  async revokeInvitation(organizationId: string, invitationId: string, actorId: string) {
    const invitation = await this.findInvitation(organizationId, invitationId);
    // An invitation can be pulled back at any point before the partner has
    // actually joined — including after they accepted the terms but never
    // finished registering.
    if (!AFFILIATE_INVITATION_OPEN_STATUSES.includes(invitation.status as AffiliateInvitationStatus)) {
      throw new BadRequestException('Only invitations that have not been completed can be revoked.');
    }
    invitation.status = AffiliateInvitationStatus.REVOKED;
    invitation.revokedAt = new Date();
    invitation.updatedAt = new Date();
    try {
      const dataSource = await initializeDataSource();
      await dataSource.getRepository(AffiliateInvitation).save(invitation);
    } catch { }
    this.audit(organizationId, actorId, 'AFFILIATE_INVITATION_REVOKED', 'affiliate_invitation', invitation.id, {
      programId: invitation.programId,
      email: invitation.email,
    });
    return this.serializeInvitation(invitation);
  }

  async getPublicInvitation(token: string) {
    const invitation = await this.findValidInvitationByToken(token);
    let program = dbStore.programs.find((item) => item.id === invitation.programId && item.organizationId === invitation.organizationId);
    let organization = dbStore.organizations.find((item) => item.id === invitation.organizationId);
    if (!program || !organization) {
      try {
        const dataSource = await initializeDataSource();
        if (!program) {
          const dbProg = await dataSource.getRepository(Program).findOne({ where: { id: invitation.programId, organizationId: invitation.organizationId } });
          if (dbProg) program = dbProg as any;
        }
        if (!organization) {
          const dbOrg = await dataSource.getRepository(Organization).findOne({ where: { id: invitation.organizationId } });
          if (dbOrg) organization = dbOrg as any;
        }
      } catch { }
    }
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

  /**
   * Phase one of the invitation flow: the invited partner reviews and accepts
   * the program terms.
   *
   * This deliberately creates **no** affiliate and **no** membership. An
   * invitation token proves only that an email address was invited — it is not
   * authentication, and treating it as such would let anyone holding the link
   * join a program as someone else. The invitation is parked in TERMS_ACCEPTED
   * and the caller is told where to authenticate.
   *
   * {@link completeAffiliateInvitation} is the only path that creates a
   * membership, and it requires an authenticated Affiliate Portal session.
   */
  async acceptAffiliateInvitationTerms(token: string, dto: AcceptAffiliateInvitationDto) {
    if (!dto.acceptedTerms) {
      throw new BadRequestException('Program terms must be accepted.');
    }

    const invitation = await this.findValidInvitationByToken(token);
    const { program, organization } = await this.loadInvitationContext(invitation);
    this.assertInvitationTargetsAreActive(program, organization);

    const now = new Date();
    if (!invitation.termsAcceptedAt) {
      invitation.termsAcceptedAt = now;
    }
    invitation.termsVersionAccepted = dto.termsVersionAccepted || 1;
    if (invitation.status === AffiliateInvitationStatus.PENDING) {
      invitation.status = AffiliateInvitationStatus.TERMS_ACCEPTED;
    }
    invitation.updatedAt = now;
    await this.persistInvitation(invitation);

    // Whether this partner already has a portal account decides which screen
    // they are sent to. Resolved on the server so the client cannot be steered
    // down the wrong branch.
    const hasPortalAccount = await this.affiliatePortalAccountExists(invitation.email);

    this.audit(
      invitation.organizationId,
      invitation.invitedBy,
      'AFFILIATE_INVITATION_TERMS_ACCEPTED',
      'affiliate_invitation',
      invitation.id,
      { email: invitation.email, programId: invitation.programId, hasPortalAccount },
    );

    const portalUrl = getAppConfig().affiliateFrontendUrl.replace(/\/$/, '');
    const nextStep = hasPortalAccount ? 'LOGIN' : 'REGISTER';

    return {
      invitationId: invitation.id,
      status: invitation.status,
      // The invited address is authoritative. The portal pre-fills and locks it,
      // and the backend re-checks it at completion time.
      email: invitation.email,
      partnerName: invitation.partnerName,
      organizationName: organization.name,
      programName: program.name,
      hasPortalAccount,
      nextStep,
      // The token travels on so the portal can complete the invitation once the
      // partner is authenticated. It grants no access on its own.
      redirectUrl: `${portalUrl}/${nextStep === 'LOGIN' ? 'login' : 'signup'}?invitationToken=${encodeURIComponent(token)}`,
      message: hasPortalAccount
        ? 'Sign in to your PartnerIQ affiliate account to finish joining this program.'
        : 'Create your PartnerIQ affiliate account to finish joining this program.',
    };
  }

  /**
   * Phase two: the authenticated affiliate is joined to the invited program.
   *
   * Requires a real Affiliate Portal session. The authenticated user's email
   * must match the invited address — the invitation cannot be redeemed by
   * anyone else, no matter who holds the link.
   *
   * Idempotent: completing an already-joined invitation returns the existing
   * membership rather than creating a second one.
   */
  async completeAffiliateInvitation(token: string, authenticatedUserId: string) {
    const invitation = await this.findInvitationByTokenHash(SecurityUtils.hashToken(token));
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    const user = await this.loadUserById(authenticatedUserId);
    if (!user) {
      throw new UnauthorizedException('Sign in to your affiliate account to continue.');
    }

    const invitedEmail = invitation.email.toLowerCase().trim();
    const authenticatedEmail = (user.email || '').toLowerCase().trim();

    // The security rule this whole flow exists to enforce.
    if (invitedEmail !== authenticatedEmail) {
      this.audit(
        invitation.organizationId,
        authenticatedUserId,
        'AFFILIATE_INVITATION_EMAIL_MISMATCH',
        'affiliate_invitation',
        invitation.id,
        { invitedEmail, authenticatedEmail },
      );
      throw new ForbiddenException({
        code: 'INVITATION_EMAIL_MISMATCH',
        message: `This invitation was sent to ${invitedEmail}. Please use the email address that received this invitation.`,
        details: { invitedEmail },
      });
    }

    // Already completed — return what exists instead of creating a duplicate.
    if (AFFILIATE_INVITATION_COMPLETED_STATUSES.includes(invitation.status as AffiliateInvitationStatus)) {
      const existing = await this.describeCompletedInvitation(invitation);
      if (existing) return existing;
    }

    this.assertInvitationCanBeAccepted(invitation);
    const { program, organization } = await this.loadInvitationContext(invitation);
    this.assertInvitationTargetsAreActive(program, organization);

    const created = await this.create(
      invitation.organizationId,
      {
        displayName: invitation.partnerName,
        email: invitation.email,
        programId: invitation.programId,
      } as CreateAffiliateDto,
      invitation.invitedBy,
      true,
      (invitation.environment as EnvironmentType) || EnvironmentType.LIVE,
    );

    created.programAffiliate.source = 'INVITATION';
    created.programAffiliate.primaryChannel = invitation.primaryChannel;
    created.programAffiliate.commissionOverrideType = invitation.commissionOverrideType;
    created.programAffiliate.commissionOverride = invitation.commissionOverrideValue;
    created.programAffiliate.termsVersionAccepted = invitation.termsVersionAccepted || 1;
    created.programAffiliate.termsAcceptedAt = invitation.termsAcceptedAt || new Date();
    created.programAffiliate.invitedBy = invitation.invitedBy;

    // Link the portal account to the affiliate record so the partner's programs
    // resolve on sign-in.
    if (created.affiliate && !created.affiliate.userId) {
      created.affiliate.userId = authenticatedUserId;
      created.affiliate.updatedAt = new Date();
      try {
        const dataSource = await initializeDataSource();
        await dataSource
          .getRepository(Affiliate)
          .update({ id: created.affiliate.id }, { userId: authenticatedUserId });
      } catch { }
    }

    const now = new Date();
    invitation.status = AffiliateInvitationStatus.JOINED;
    invitation.acceptedAt = invitation.acceptedAt || now;
    invitation.acceptedBy = authenticatedUserId;
    invitation.joinedAt = now;
    invitation.affiliateId = created.affiliate?.id;
    invitation.termsAcceptedAt = invitation.termsAcceptedAt || now;
    invitation.updatedAt = now;
    await this.persistInvitation(invitation);

    this.audit(
      invitation.organizationId,
      authenticatedUserId,
      'AFFILIATE_INVITATION_COMPLETED',
      'affiliate_invitation',
      invitation.id,
      { email: invitedEmail, programId: invitation.programId, affiliateId: created.affiliate?.id },
    );

    this.notifyOrgOfAcceptedInvitation(invitation.organizationId, invitation.partnerName).catch(
      () => undefined,
    );

    return {
      joined: true,
      alreadyMember: false,
      invitationId: invitation.id,
      status: invitation.status,
      affiliate: created.affiliate,
      programAffiliate: created.programAffiliate,
      trackingLink: (created as any).trackingLink,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      programId: program.id,
      programName: program.name,
      message: `Welcome to ${organization.name}! You have successfully joined the ${program.name} partner program.`,
    };
  }

  /**
   * Completes an invitation immediately after registration or sign-in, so the
   * partner lands straight on their dashboard already joined.
   *
   * Never throws: a problem completing the invitation must not fail the
   * authentication that just succeeded. The caller reports what happened and
   * the partner can retry from their invitations list.
   */
  async completeInvitationAfterAuth(token: string | undefined, userId: string) {
    if (!token) return null;
    try {
      return await this.completeAffiliateInvitation(token, userId);
    } catch (error) {
      this.logger.warn(
        `Could not complete affiliate invitation after authentication: ${(error as Error).message}`,
      );
      return { joined: false, error: (error as Error).message };
    }
  }

  /** Whether an Affiliate Portal account already exists for this address. */
  async affiliatePortalAccountExists(email: string) {
    const normalized = email.toLowerCase().trim();
    const cached = dbStore.users.find(
      (item) => item.email?.toLowerCase().trim() === normalized && !item.deletedAt,
    );
    if (cached) return cached.platformRole === PlatformRole.AFFILIATE;
    try {
      const dataSource = await initializeDataSource();
      const found = await dataSource
        .getRepository(User)
        .findOne({ where: { email: normalized, deletedAt: IsNull() } });
      return Boolean(found && found.platformRole === PlatformRole.AFFILIATE);
    } catch {
      return false;
    }
  }

  /**
   * Resolves the invitation behind an in-flight registration or sign-in, so the
   * portal can pre-fill and lock the invited email. Throws if the token is
   * unknown; validity is re-checked at completion time.
   */
  async peekInvitationByToken(token: string) {
    const invitation = await this.findInvitationByTokenHash(SecurityUtils.hashToken(token));
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    return invitation;
  }

  private async findInvitationByTokenHash(tokenHash: string) {
    this.expireOldInvitations();
    let invitation = dbStore.affiliateInvitations.find((item) => item.tokenHash === tokenHash);
    if (!invitation) {
      try {
        const dataSource = await initializeDataSource();
        const dbInv = await dataSource
          .getRepository(AffiliateInvitation)
          .findOne({ where: { tokenHash } });
        if (dbInv) {
          invitation = dbInv as any;
          if (!dbStore.affiliateInvitations.some((item) => item.id === dbInv.id)) {
            dbStore.affiliateInvitations.push(dbInv as any);
          }
        }
      } catch { }
    }
    return invitation;
  }

  private async loadUserById(userId: string) {
    const cached = dbStore.users.find((item) => item.id === userId && !item.deletedAt);
    if (cached) return cached;
    try {
      const dataSource = await initializeDataSource();
      return (
        (await dataSource
          .getRepository(User)
          .findOne({ where: { id: userId, deletedAt: IsNull() } })) || undefined
      );
    } catch {
      return undefined;
    }
  }

  private async loadInvitationContext(invitation: any) {
    let program = dbStore.programs.find(
      (item) =>
        item.id === invitation.programId &&
        item.organizationId === invitation.organizationId &&
        !item.deletedAt,
    );
    let organization = dbStore.organizations.find(
      (item) => item.id === invitation.organizationId && !item.deletedAt,
    );

    if (!program || !organization) {
      try {
        const dataSource = await initializeDataSource();
        if (!program) {
          const dbProg = await dataSource.getRepository(Program).findOne({
            where: {
              id: invitation.programId,
              organizationId: invitation.organizationId,
              deletedAt: IsNull(),
            },
          });
          if (dbProg) program = dbProg as any;
        }
        if (!organization) {
          const dbOrg = await dataSource.getRepository(Organization).findOne({
            where: { id: invitation.organizationId, deletedAt: IsNull() },
          });
          if (dbOrg) organization = dbOrg as any;
        }
      } catch { }
    }

    if (!program || !organization) {
      throw new NotFoundException('Invitation not found');
    }
    return { program, organization };
  }

  private assertInvitationTargetsAreActive(program: any, organization: any) {
    if (organization.status && organization.status !== OrganizationStatus.ACTIVE) {
      throw new BadRequestException('This organization is not currently accepting partners.');
    }
    if (program.status === ProgramStatus.PAUSED || program.status === ProgramStatus.ARCHIVED) {
      throw new BadRequestException('This program is currently unavailable.');
    }
  }

  /** Describes an invitation that has already produced a membership. */
  private async describeCompletedInvitation(invitation: any) {
    const { program, organization } = await this.loadInvitationContext(invitation);
    const affiliate =
      (invitation.affiliateId &&
        dbStore.affiliates.find((item) => item.id === invitation.affiliateId)) ||
      dbStore.affiliates.find(
        (item) =>
          item.organizationId === invitation.organizationId &&
          item.email?.toLowerCase().trim() === invitation.email.toLowerCase().trim(),
      );
    if (!affiliate) return null;

    const programAffiliate = dbStore.programAffiliates.find(
      (item) => item.programId === invitation.programId && item.affiliateId === affiliate.id,
    );

    return {
      joined: true,
      alreadyMember: true,
      invitationId: invitation.id,
      status: invitation.status,
      affiliate,
      programAffiliate,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      programId: program.id,
      programName: program.name,
      message: `You are already part of the ${program.name} partner program at ${organization.name}.`,
    };
  }

  /**
   * The link that goes in the invitation email.
   *
   * Points at the Affiliate Portal, not the organization admin app: partners
   * register and authenticate in their own application, with their own
   * accounts. Sending them into the admin app would mix the two user
   * experiences and leave them unable to complete the flow.
   */
  private buildInvitationUrl(token: string) {
    const portalUrl = getAppConfig().affiliateFrontendUrl.replace(/\/$/, '');
    return `${portalUrl}/invitations/${token}`;
  }

  private async persistInvitation(invitation: any) {
    try {
      const dataSource = await initializeDataSource();
      await dataSource.getRepository(AffiliateInvitation).save(invitation);
    } catch (error) {
      this.logger.warn(
        `Failed to persist affiliate invitation ${invitation.id}: ${(error as Error).message}`,
      );
    }
  }

  async listInvitationsForEmail(email: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    this.expireOldInvitations();
    const normalizedEmail = email.toLowerCase().trim();
    try {
      const dataSource = await initializeDataSource();
      const repo = dataSource.getRepository(AffiliateInvitation);
      const items = await repo
        .createQueryBuilder('inv')
        .where('LOWER(inv.email) = :email', { email: normalizedEmail })
        .andWhere('(inv.environment = :env OR (inv.environment IS NULL AND :env = :liveEnv))', {
          env: environment,
          liveEnv: EnvironmentType.LIVE,
        })
        .orderBy('inv.createdAt', 'DESC')
        .getMany();

      if (items.length > 0) {
        const orgIds = [...new Set(items.map((i) => i.organizationId).filter(Boolean))];
        const progIds = [...new Set(items.map((i) => i.programId).filter(Boolean))];
        const inviterIds = [...new Set(items.map((i) => i.invitedBy).filter(Boolean))];
        if (orgIds.length > 0) {
          const dbOrgs = await dataSource.getRepository(Organization).find({ where: { id: In(orgIds) } });
          for (const o of dbOrgs) {
            if (!dbStore.organizations.some((existing) => existing.id === o.id)) {
              dbStore.organizations.push(o as any);
            }
          }
        }
        if (progIds.length > 0) {
          const dbProgs = await dataSource.getRepository(Program).find({ where: { id: In(progIds) } });
          for (const p of dbProgs) {
            if (!dbStore.programs.some((existing) => existing.id === p.id)) {
              dbStore.programs.push(p as any);
            }
          }
        }
        if (inviterIds.length > 0) {
          const dbUsers = await dataSource.getRepository(User).find({ where: { id: In(inviterIds) } });
          for (const u of dbUsers) {
            if (!dbStore.users.some((existing) => existing.id === u.id)) {
              dbStore.users.push(u as any);
            }
          }
        }
      }

      return items.map((item) => this.serializeInvitationForAffiliate(item));
    } catch {
      return dbStore.affiliateInvitations
        .filter((item) =>
          item.email.toLowerCase().trim() === normalizedEmail
          && (item.environment === environment || (!item.environment && environment === EnvironmentType.LIVE)),
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((item) => this.serializeInvitationForAffiliate(item));
    }
  }

  async acceptInvitationForEmail(invitationId: string, email: string, dto: AcceptAffiliateInvitationDto, userId?: string) {
    if (!dto.acceptedTerms) {
      throw new BadRequestException('Program terms must be accepted.');
    }
    const invitation = await this.findInvitationForEmail(invitationId, email);
    this.assertInvitationCanBeAccepted(invitation);
    return this.acceptInvitationRecord(invitation, dto, userId);
  }

  async declineInvitationForEmail(invitationId: string, email: string, userId?: string) {
    const invitation = await this.findInvitationForEmail(invitationId, email);
    if (!AFFILIATE_INVITATION_OPEN_STATUSES.includes(invitation.status as AffiliateInvitationStatus)) {
      throw new BadRequestException('Only invitations that have not been completed can be declined.');
    }
    invitation.status = AffiliateInvitationStatus.DECLINED;
    invitation.updatedAt = new Date();
    try {
      const dataSource = await initializeDataSource();
      await dataSource.getRepository(AffiliateInvitation).save(invitation);
    } catch { }
    this.audit(invitation.organizationId, userId || invitation.invitedBy, 'AFFILIATE_INVITATION_DECLINED', 'affiliate_invitation', invitation.id, {
      programId: invitation.programId,
      email: invitation.email,
    });
    return { success: true, invitation: this.serializeInvitationForAffiliate(invitation) };
  }

  private async acceptInvitationRecord(invitation: any, dto: AcceptAffiliateInvitationDto, userId?: string) {
    assertUserEligibleForAffiliate(invitation.email);
    let program = dbStore.programs.find((item) => item.id === invitation.programId && item.organizationId === invitation.organizationId && !item.deletedAt);
    if (!program) {
      try {
        const dataSource = await initializeDataSource();
        const dbProg = await dataSource.getRepository(Program).findOne({
          where: { id: invitation.programId, organizationId: invitation.organizationId, deletedAt: IsNull() },
        });
        if (dbProg) {
          program = dbProg as any;
          if (!dbStore.programs.some(p => p.id === dbProg.id)) {
            dbStore.programs.push(dbProg as any);
          }
        }
      } catch { }
    }
    if (!program || program.status === ProgramStatus.PAUSED || program.status === ProgramStatus.ARCHIVED) {
      throw new BadRequestException('This program is currently unavailable.');
    }

    let existingAffiliate = dbStore.affiliates.find((item) => item.organizationId === invitation.organizationId && item.email === invitation.email);
    if (!existingAffiliate) {
      try {
        const dataSource = await initializeDataSource();
        const dbAff = await dataSource.getRepository(Affiliate).findOne({
          where: { organizationId: invitation.organizationId, email: invitation.email },
        });
        if (dbAff) {
          existingAffiliate = dbAff as any;
          if (!dbStore.affiliates.some(a => a.id === dbAff.id)) {
            dbStore.affiliates.push(dbAff as any);
          }
        }
      } catch { }
    }

    let existingMembership = existingAffiliate && dbStore.programAffiliates.find(
      (item) => item.organizationId === invitation.organizationId && item.programId === invitation.programId && item.affiliateId === existingAffiliate.id && item.status === AffiliateStatus.ACTIVE,
    );
    if (!existingMembership && existingAffiliate) {
      try {
        const dataSource = await initializeDataSource();
        const dbPa = await dataSource.getRepository(ProgramAffiliate).findOne({
          where: { organizationId: invitation.organizationId, programId: invitation.programId, affiliateId: existingAffiliate.id, status: AffiliateStatus.ACTIVE },
        });
        if (dbPa) {
          existingMembership = dbPa as any;
          if (!dbStore.programAffiliates.some(pa => pa.id === dbPa.id)) {
            dbStore.programAffiliates.push(dbPa as any);
          }
        }
      } catch { }
    }

    if (existingMembership) {
      invitation.status = AffiliateInvitationStatus.JOINED;
      invitation.acceptedAt = invitation.acceptedAt || new Date();
      invitation.joinedAt = invitation.joinedAt || new Date();
      invitation.affiliateId = existingAffiliate?.id;
      invitation.acceptedBy = userId;
      try {
        const dataSource = await initializeDataSource();
        await dataSource.getRepository(AffiliateInvitation).save(invitation);
      } catch { }
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

    invitation.status = AffiliateInvitationStatus.JOINED;
    invitation.acceptedAt = invitation.acceptedAt || new Date();
    invitation.joinedAt = new Date();
    invitation.affiliateId = created.affiliate?.id;
    invitation.acceptedBy = userId;
    invitation.termsAcceptedAt = invitation.termsAcceptedAt || new Date();
    invitation.updatedAt = new Date();

    try {
      const dataSource = await initializeDataSource();
      await dataSource.getRepository(AffiliateInvitation).save(invitation);
      await dataSource.getRepository(ProgramAffiliate).save(created.programAffiliate);
    } catch { }

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

    this.notifyOrgOfAcceptedInvitation(invitation.organizationId, invitation.partnerName || invitation.email).catch(() => undefined);

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

  async findAll(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE, programId?: string) {
    let orgProgramAffiliates = dbStore.programAffiliates;
    let affiliates = dbStore.affiliates;
    let programs = dbStore.programs;

    try {
      const dataSource = await initializeDataSource();
      const [dbPa, dbAff, dbP] = await Promise.all([
        dataSource.getRepository(ProgramAffiliate).find({ where: { organizationId } }),
        dataSource.getRepository(Affiliate).find({ where: { organizationId } }),
        dataSource.getRepository(Program).find({ where: { organizationId, deletedAt: IsNull() } }),
      ]);
      if (dbAff && dbAff.length > 0) affiliates = dbAff as any;
      if (dbPa && dbPa.length > 0) orgProgramAffiliates = dbPa as any;
      if (dbP && dbP.length > 0) programs = dbP as any;
    } catch { }

    const filteredProgAffs = orgProgramAffiliates.filter(
      (pa) =>
        (pa.organizationId === organizationId || !pa.organizationId) &&
        (pa.environment === environment || (!pa.environment && environment === EnvironmentType.LIVE)) &&
        pa.status !== AffiliateStatus.REJECTED &&
        (!programId || pa.programId === programId),
    );
    const affiliateIds = new Set(filteredProgAffs.map((pa) => pa.affiliateId));
    const filteredAffiliates = affiliates.filter(
      (a) => a.organizationId === organizationId && (programId ? affiliateIds.has(a.id) : (affiliateIds.size === 0 || affiliateIds.has(a.id))),
    );

    const defaultProgramId = programs.find(
      (p) => p.organizationId === organizationId && !p.deletedAt && (p.environment === environment || (!p.environment && environment === EnvironmentType.LIVE)),
    )?.id || '';

    return filteredAffiliates.map((a) => {
      const progAff = filteredProgAffs.find((pa) => pa.affiliateId === a.id);
      return {
        ...a,
        programId: progAff?.programId || defaultProgramId,
        referralCode: progAff?.referralCode || '',
      };
    });
  }

  async findOne(organizationId: string, affiliateId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    let affiliate = dbStore.affiliates.find(
      (a) => a.id === affiliateId && a.organizationId === organizationId,
    );

    if (!affiliate) {
      affiliate = dbStore.affiliates.find(
        (a) => a.id === affiliateId || a.email?.toLowerCase().trim() === affiliateId.toLowerCase().trim(),
      );
    }

    if (!affiliate) {
      try {
        const dataSource = await initializeDataSource();
        const dbAff = await dataSource.getRepository(Affiliate).findOne({
          where: [
            { id: affiliateId, organizationId },
            { id: affiliateId },
            { email: affiliateId },
          ],
        });
        if (dbAff) {
          affiliate = dbAff as any;
          if (!dbStore.affiliates.some((a) => a.id === dbAff.id)) {
            dbStore.affiliates.push(dbAff as any);
          }
        }
      } catch { }
    }

    if (!affiliate) {
      const dbUser = dbStore.users.find(
        (u) => u.id === affiliateId || u.email?.toLowerCase().trim() === affiliateId.toLowerCase().trim(),
      );
      if (dbUser) {
        affiliate = {
          id: dbUser.id,
          organizationId,
          displayName: `${dbUser.firstName || ''} ${dbUser.lastName || ''}`.trim() || dbUser.email.split('@')[0],
          email: dbUser.email,
          country: 'US',
          status: AffiliateStatus.ACTIVE,
          trustScore: 90,
          createdAt: dbUser.createdAt,
          updatedAt: dbUser.updatedAt,
        } as any;
      }
    }

    if (!affiliate) {
      throw new NotFoundException('Affiliate not found');
    }

    const programs = dbStore.programAffiliates.filter(
      (pa) => pa.affiliateId === affiliate.id && pa.organizationId === organizationId && (pa.environment === environment || (!pa.environment && environment === EnvironmentType.LIVE)),
    );

    const links = dbStore.trackingLinks.filter(
      (tl) => tl.affiliateId === affiliate.id && tl.organizationId === organizationId && (tl.environment === environment || (!tl.environment && environment === EnvironmentType.LIVE)),
    );

    const { profile, payoutMethods } = await this.getAffiliateOnboardingDetails(
      affiliate.email,
      (affiliate as any).userId,
      affiliate,
    );

    return { ...affiliate, programs, links, profile, payoutMethods };
  }

  // Public Application endpoint
  async submitApplication(dto: PublicApplyDto) {
    const email = dto.email.toLowerCase().trim();
    assertUserEligibleForAffiliate(email);

    const promotionMethod =
      dto.promotionMethod ||
      (dto.answers ? Object.values(dto.answers).filter((v) => typeof v === 'string' && v.trim()).join(' | ') : undefined);
    const audienceSize = typeof dto.answers?.audienceSize === 'string' ? dto.answers.audienceSize : undefined;
    const website = dto.website || (typeof dto.answers?.channelUrl === 'string' ? dto.answers.channelUrl : undefined);

    let program: any = dbStore.programs.find((p) => p.id === dto.programId && p.organizationId === dto.organizationId);
    let dataSource: any = null;
    try {
      dataSource = await initializeDataSource();
      if (!program) {
        program = await dataSource.getRepository(Program).findOne({
          where: { id: dto.programId, organizationId: dto.organizationId, deletedAt: IsNull() },
        });
      }
    } catch { }

    // Check if affiliate is already active member of this program
    let affiliate = dbStore.affiliates.find((a) => a.organizationId === dto.organizationId && a.email === email);
    if (!affiliate && dataSource) {
      try {
        affiliate = await dataSource.getRepository(Affiliate).findOne({ where: { organizationId: dto.organizationId, email } }) as any;
      } catch { }
    }

    if (affiliate) {
      let pa = dbStore.programAffiliates.find(
        (p) => p.organizationId === dto.organizationId && p.programId === dto.programId && p.affiliateId === affiliate.id && p.status === AffiliateStatus.ACTIVE
      );
      if (!pa && dataSource) {
        try {
          pa = await dataSource.getRepository(ProgramAffiliate).findOne({
            where: { organizationId: dto.organizationId, programId: dto.programId, affiliateId: affiliate.id, status: AffiliateStatus.ACTIVE },
          }) as any;
        } catch { }
      }
      if (pa) {
        return {
          success: true,
          alreadyMember: true,
          status: 'ACTIVE',
          message: 'You are already an active member of this program.',
        };
      }
    }

    // Check if an application already exists and is pending
    let existingApp = dbStore.affiliateApplications.find(
      (a) => a.email === email && a.programId === dto.programId && a.status === ApplicationStatus.PENDING
    );
    if (!existingApp && dataSource) {
      try {
        existingApp = await dataSource.getRepository(AffiliateApplication).findOne({
          where: { email, programId: dto.programId, status: ApplicationStatus.PENDING },
        }) as any;
      } catch { }
    }

    if (existingApp) {
      return {
        success: true,
        alreadyApplied: true,
        status: ApplicationStatus.PENDING,
        message: 'Application has already been submitted and is currently pending review.',
        applicationId: existingApp.id,
      };
    }

    const isAutoApproval = (program as any)?.affiliateApprovalMode === 'AUTO';

    const app: AffiliateApplicationEntity = {
      id: uuidv4(),
      organizationId: dto.organizationId,
      environment: EnvironmentType.LIVE,
      programId: dto.programId,
      email,
      name: dto.name,
      website,
      promotionMethod,
      audienceSize,
      country: 'India',
      status: isAutoApproval ? ApplicationStatus.APPROVED : ApplicationStatus.PENDING,
      reviewedBy: isAutoApproval ? 'system-auto-approval' : undefined,
      reviewedAt: isAutoApproval ? new Date() : undefined,
      createdAt: new Date(),
    };

    dbStore.affiliateApplications.push(app);
    if (dataSource) {
      try {
        await dataSource.getRepository(AffiliateApplication).save(app);
      } catch (e) {
        console.warn('Failed to persist affiliate application to db:', e);
      }
    }

    this.audit(
      dto.organizationId,
      email,
      AuditAction.AFFILIATE_APPLICATION_SUBMITTED,
      'affiliate_application',
      app.id,
      {
        programId: dto.programId,
        name: dto.name,
      },
    );

    if (isAutoApproval) {
      const created = await this.create(dto.organizationId, {
        displayName: app.name,
        email: app.email,
        website: app.website,
        programId: app.programId,
      }, 'system-auto-approval', true);

      const autoApprovalOrg = dbStore.organizations.find((o) => o.id === dto.organizationId);
      this.notifyApplicant(
        SystemTemplateKey.AFFILIATE_APPLICATION_APPROVED,
        dto.organizationId,
        app.email,
        app.name,
        app.programId,
        created.trackingLink
          ? { referralLink: `https://${autoApprovalOrg?.slug || 'go'}.partneriq.in/r/${created.trackingLink.shortCode}` }
          : {},
      ).catch(() => undefined);

      return {
        success: true,
        autoApproved: true,
        status: ApplicationStatus.APPROVED,
        message: 'Application automatically approved! Welcome to the program.',
        applicationId: app.id,
        ...created,
      };
    }

    this.notifyApplicant(SystemTemplateKey.AFFILIATE_APPLICATION_RECEIVED, dto.organizationId, app.email, app.name, app.programId).catch(() => undefined);

    return {
      success: true,
      autoApproved: false,
      status: ApplicationStatus.PENDING,
      message: 'Application submitted for review. The organization team will review your application.',
      applicationId: app.id,
    };
  }

  async getApplications(organizationId: string) {
    let apps: any[] = [];
    try {
      const dataSource = await initializeDataSource();
      apps = await dataSource.getRepository(AffiliateApplication).find({
        where: { organizationId },
        order: { createdAt: 'DESC' },
      });
    } catch { }

    if (!apps.length) {
      apps = dbStore.affiliateApplications.filter((a) => a.organizationId === organizationId);
    } else {
      const dbIds = new Set(apps.map((a) => a.id));
      const memoryApps = dbStore.affiliateApplications.filter((a) => a.organizationId === organizationId && !dbIds.has(a.id));
      apps = [...memoryApps, ...apps];
    }

    // Enrich with program details & onboarding profiles
    return Promise.all(
      apps.map(async (app) => {
        const prog = dbStore.programs.find((p) => p.id === app.programId);
        const { profile, payoutMethods } = await this.getAffiliateOnboardingDetails(app.email, undefined, app);
        return {
          ...app,
          programName: prog?.name || 'Partner Program',
          category: (prog as any)?.category || 'SaaS',
          commissionSummary: (prog as any)?.commissionSummary || 'Standard Commission',
          profile,
          payoutMethods,
        };
      }),
    );
  }

  async getApplication(organizationId: string, applicationId: string) {
    let app = dbStore.affiliateApplications.find(
      (a) => a.id === applicationId && a.organizationId === organizationId,
    );

    if (!app) {
      try {
        const dataSource = await initializeDataSource();
        app = await dataSource.getRepository(AffiliateApplication).findOne({
          where: { id: applicationId, organizationId },
        }) as any;
      } catch { }
    }

    if (!app) {
      throw new NotFoundException('Application not found');
    }

    const prog = dbStore.programs.find((p) => p.id === app.programId);
    const { profile, payoutMethods } = await this.getAffiliateOnboardingDetails(app.email, undefined, app);

    return {
      ...app,
      programName: prog?.name || 'Partner Program',
      category: (prog as any)?.category || 'SaaS',
      commissionSummary: (prog as any)?.commissionSummary || 'Standard Commission',
      profile,
      payoutMethods,
    };
  }

  async getAffiliateOnboardingDetails(email: string, userId?: string, fallbackData?: any) {
    let profile: any = null;
    let payoutMethods: any[] = [];

    try {
      const dataSource = await initializeDataSource();
      const userRepo = dataSource.getRepository(User);
      const profileRepo = dataSource.getRepository(AffiliatePortalProfile);
      const payoutRepo = dataSource.getRepository(AffiliatePayoutMethod);

      let resolvedUserId = userId;
      const normalizedEmail = (email || '').toLowerCase().trim();

      if (!resolvedUserId && normalizedEmail) {
        const user = await userRepo.findOne({ where: { email: normalizedEmail, deletedAt: IsNull() } });
        if (user) {
          resolvedUserId = user.id;
        }
      }

      if (resolvedUserId) {
        profile = await profileRepo.findOne({ where: { userId: resolvedUserId } });
      }

      if (!profile && normalizedEmail) {
        profile = await profileRepo.findOne({ where: { email: normalizedEmail } });
      }

      const payoutUserId = resolvedUserId || profile?.userId;
      if (payoutUserId) {
        payoutMethods = await payoutRepo.find({
          where: { userId: payoutUserId },
          order: { isDefault: 'DESC', createdAt: 'DESC' },
        });
      }
    } catch (e) {
      // ignore
    }

    const resolvedProfile = profile ? {
      bio: profile.bio || '',
      website: profile.website || fallbackData?.website || '',
      socialProfiles: profile.socialProfiles || {},
      partnerType: profile.partnerType || 'AFFILIATE',
      primaryMarket: profile.primaryMarket || 'India',
      audienceSize: profile.audienceSize || fallbackData?.audienceSize || '0-1k',
      country: profile.country || fallbackData?.country || 'India',
      phone: profile.phone || '',
      onboardingCompleted: Boolean(profile.onboardingCompleted),
      taxClassification: profile.taxClassification || 'INDIVIDUAL',
      panOrTaxId: profile.panOrTaxId || '',
      taxVerified: Boolean(profile.taxVerified),
      taxFormType: profile.taxFormType || 'PAN_TDS',
    } : (fallbackData ? {
      bio: fallbackData.answers?.bio || fallbackData.promotionMethod || '',
      website: fallbackData.website || fallbackData.answers?.channelUrl || '',
      socialProfiles: fallbackData.answers?.socialProfiles || (fallbackData.answers?.socialLinks ? { link: fallbackData.answers.socialLinks } : {}),
      partnerType: 'AFFILIATE',
      primaryMarket: fallbackData.answers?.market || fallbackData.country || 'Global',
      audienceSize: fallbackData.audienceSize || fallbackData.answers?.audienceSize || '1,000 - 10,000',
      country: fallbackData.country || 'Global',
      phone: fallbackData.answers?.phone || '',
      onboardingCompleted: false,
      taxClassification: 'INDIVIDUAL',
      panOrTaxId: '',
      taxVerified: false,
      taxFormType: 'PAN_TDS',
    } : null);

    const formattedPayoutMethods = payoutMethods.map((m) => ({
      id: m.id,
      type: m.type,
      isDefault: Boolean(m.isDefault),
      bankName: m.bankName,
      accountNumberMasked: m.accountNumberMasked,
      ifscCode: m.ifscCode,
      accountHolderName: m.accountHolderName || '',
      upiIdMasked: m.upiIdMasked,
    }));

    return { profile: resolvedProfile, payoutMethods: formattedPayoutMethods };
  }

  async approveApplication(organizationId: string, applicationId: string, reviewerId: string) {
    let app = dbStore.affiliateApplications.find(
      (a) => a.id === applicationId && a.organizationId === organizationId,
    );

    let dataSource: any = null;
    try {
      dataSource = await initializeDataSource();
      if (!app) {
        app = await dataSource.getRepository(AffiliateApplication).findOne({
          where: { id: applicationId, organizationId },
        }) as any;
      }
    } catch { }

    if (!app) {
      throw new NotFoundException('Application not found');
    }

    app.status = ApplicationStatus.APPROVED;
    app.reviewedBy = reviewerId;
    app.reviewedAt = new Date();

    if (dataSource) {
      try {
        await dataSource.getRepository(AffiliateApplication).save(app);
      } catch { }
    }

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

    this.emitWebhook(organizationId, WebhookEvent.AFFILIATE_APPROVED, {
      affiliateId: created.affiliate.id,
      programId: app.programId,
      status: created.affiliate.status,
    });

    const approvalOrg = dbStore.organizations.find((o) => o.id === organizationId);
    this.notifyApplicant(
      SystemTemplateKey.AFFILIATE_APPLICATION_APPROVED,
      organizationId,
      app.email,
      app.name,
      app.programId,
      created.trackingLink
        ? { referralLink: `https://${approvalOrg?.slug || 'go'}.partneriq.in/r/${created.trackingLink.shortCode}` }
        : {},
    ).catch(() => undefined);

    return { application: app, ...created };
  }

  async rejectApplication(organizationId: string, applicationId: string, reviewerId: string) {
    let app = dbStore.affiliateApplications.find(
      (a) => a.id === applicationId && a.organizationId === organizationId,
    );

    let dataSource: any = null;
    try {
      dataSource = await initializeDataSource();
      if (!app) {
        app = await dataSource.getRepository(AffiliateApplication).findOne({
          where: { id: applicationId, organizationId },
        }) as any;
      }
    } catch { }

    if (!app) {
      throw new NotFoundException('Application not found');
    }

    app.status = ApplicationStatus.REJECTED;
    app.reviewedBy = reviewerId;
    app.reviewedAt = new Date();

    if (dataSource) {
      try {
        await dataSource.getRepository(AffiliateApplication).save(app);
      } catch { }
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: reviewerId,
      action: AuditAction.AFFILIATE_REJECTED,
      resourceType: 'affiliate_application',
      resourceId: app.id,
      createdAt: new Date(),
    });

    this.notifyApplicant(SystemTemplateKey.AFFILIATE_APPLICATION_REJECTED, organizationId, app.email, app.name, app.programId).catch(() => undefined);

    return { success: true, application: app };
  }

  private normalizeCommissionOverride(type: string, value: number) {
    if (type === InvitationCommissionType.PERCENTAGE && value > 100) {
      throw new BadRequestException('Percentage commission override cannot exceed 100%.');
    }
    return value;
  }

  private async findInvitation(organizationId: string, invitationId: string) {
    let invitation = dbStore.affiliateInvitations.find((item) => item.id === invitationId && item.organizationId === organizationId);
    if (!invitation) {
      try {
        const dataSource = await initializeDataSource();
        const dbInv = await dataSource.getRepository(AffiliateInvitation).findOne({
          where: { id: invitationId, organizationId },
        });
        if (dbInv) {
          invitation = dbInv as any;
          if (!dbStore.affiliateInvitations.some(i => i.id === dbInv.id)) {
            dbStore.affiliateInvitations.push(dbInv as any);
          }
        }
      } catch { }
    }
    if (!invitation) throw new NotFoundException('Invitation not found');
    return invitation;
  }

  private async findInvitationForEmail(invitationId: string, email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    let invitation = dbStore.affiliateInvitations.find((item) =>
      item.id === invitationId && item.email.toLowerCase().trim() === normalizedEmail,
    );
    if (!invitation) {
      try {
        const dataSource = await initializeDataSource();
        const dbInv = await dataSource.getRepository(AffiliateInvitation).findOne({
          where: { id: invitationId },
        });
        if (dbInv && dbInv.email.toLowerCase().trim() === normalizedEmail) {
          invitation = dbInv as any;
          if (!dbStore.affiliateInvitations.some(i => i.id === dbInv.id)) {
            dbStore.affiliateInvitations.push(dbInv as any);
          }
        }
      } catch { }
    }
    if (!invitation) throw new NotFoundException('Invitation not found');
    return invitation;
  }

  private async findValidInvitationByToken(token: string) {
    this.expireOldInvitations();
    const tokenHash = SecurityUtils.hashToken(token);
    let invitation = dbStore.affiliateInvitations.find((item) => item.tokenHash === tokenHash);
    if (!invitation) {
      try {
        const dataSource = await initializeDataSource();
        const dbInv = await dataSource.getRepository(AffiliateInvitation).findOne({
          where: { tokenHash },
        });
        if (dbInv) {
          invitation = dbInv as any;
          if (!dbStore.affiliateInvitations.some(i => i.id === dbInv.id)) {
            dbStore.affiliateInvitations.push(dbInv as any);
          }
        }
      } catch { }
    }
    if (!invitation) throw new NotFoundException('Invitation not found');
    this.assertInvitationCanBeAccepted(invitation);
    return invitation;
  }

  private assertInvitationCanBeAccepted(invitation: any) {
    this.expireOldInvitations();
    if (invitation.status === AffiliateInvitationStatus.REVOKED || invitation.revokedAt) {
      throw new BadRequestException({
        code: 'INVITATION_REVOKED',
        message: 'This invitation is no longer valid. Ask the organization to send a new one.',
      });
    }
    if (invitation.status === AffiliateInvitationStatus.CANCELLED) {
      throw new BadRequestException({
        code: 'INVITATION_CANCELLED',
        message: 'This invitation was cancelled. Ask the organization to send a new one.',
      });
    }
    if (AFFILIATE_INVITATION_COMPLETED_STATUSES.includes(invitation.status as AffiliateInvitationStatus)) {
      throw new BadRequestException({
        code: 'INVITATION_ALREADY_COMPLETED',
        message: "You've already joined this program.",
      });
    }
    if (invitation.status === AffiliateInvitationStatus.DECLINED) {
      throw new BadRequestException({
        code: 'INVITATION_DECLINED',
        message: 'This invitation was declined.',
      });
    }
    // TERMS_ACCEPTED is deliberately allowed through: the partner accepted the
    // terms and is now coming back to register or sign in, which is exactly the
    // state this flow parks them in.
    if (new Date(invitation.expiresAt) <= new Date()) {
      invitation.status = AffiliateInvitationStatus.EXPIRED;
      throw new BadRequestException({
        code: 'INVITATION_EXPIRED',
        message: 'This invitation has expired. Ask the organization to resend it.',
        details: { canRequestResend: true },
      });
    }
  }

  private expireOldInvitations() {
    const now = new Date();
    dbStore.affiliateInvitations.forEach((item) => {
      // TERMS_ACCEPTED expires too: a partner who accepted the terms but never
      // came back to register should not be able to redeem a stale link later.
      const isOpen = AFFILIATE_INVITATION_OPEN_STATUSES.includes(item.status as AffiliateInvitationStatus);
      if (isOpen && !item.revokedAt && new Date(item.expiresAt) <= now) {
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

  private serializeInvitationForAffiliate(invitation: any) {
    const organization = dbStore.organizations.find((item) => item.id === invitation.organizationId);
    const program = dbStore.programs.find((item) => item.id === invitation.programId);
    const serialized = this.serializeInvitation(invitation);
    const commissionValue = invitation.commissionOverrideValue ?? program?.defaultCommissionValue ?? 0;
    const commissionType = invitation.commissionOverrideType ?? program?.commissionType;
    const commissionSummary = commissionType === InvitationCommissionType.PERCENTAGE
      ? `${commissionValue / 100}% Recurring`
      : `${program?.currency || PLATFORM_CURRENCY} ${(commissionValue / 100).toFixed(2)} per conversion`;

    return {
      ...serialized,
      organizationName: organization?.name || 'Partner Brand',
      organizationLogo: (organization as any)?.branding?.logoUrl,
      programSlug: program?.slug,
      personalMessage: invitation.personalMessage || `Join the official ${organization?.name || 'brand'} partner program.`,
      commissionSummary,
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
      return `${program.currency || PLATFORM_CURRENCY} ${Number(invitation.commissionOverrideValue).toLocaleString()}`;
    }
    if (program.commissionType === 'PERCENTAGE') {
      return `${Number(program.defaultCommissionValue) / 100}%`;
    }
    return `${program.currency || PLATFORM_CURRENCY} ${(Number(program.defaultCommissionValue) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  async getPartnerSuggestions(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE, programId?: string) {
    let dataSource: any = null;
    try {
      dataSource = await initializeDataSource();
    } catch { }

    let dbAffiliates: Affiliate[] = [];
    let dbAffUsers: User[] = [];
    let dbProfiles: AffiliatePortalProfile[] = [];
    let dbProgramAffiliates: ProgramAffiliate[] = [];
    let dbPrograms: Program[] = [];
    let dbInvitations: AffiliateInvitation[] = [];
    let dbConversions: Conversion[] = [];
    let dbCommissions: Commission[] = [];
    let dbTrackingLinks: TrackingLink[] = [];
    let dbClicks: Click[] = [];
    let dbMemberships: OrganizationMembership[] = [];
    let dbAllUsers: User[] = [];
    let allOrganizations: Organization[] = [];

    if (dataSource) {
      try {
        const [
          affs,
          users,
          profs,
          paList,
          progs,
          invs,
          convs,
          comms,
          links,
          clicks,
          memberships,
          allUsers,
          orgs,
        ] = await Promise.all([
          dataSource.getRepository(Affiliate).find(),
          dataSource.getRepository(User).find({ where: { platformRole: PlatformRole.AFFILIATE } }),
          dataSource.getRepository(AffiliatePortalProfile).find(),
          dataSource.getRepository(ProgramAffiliate).find(),
          dataSource.getRepository(Program).find({ where: { organizationId, deletedAt: IsNull() } }),
          dataSource.getRepository(AffiliateInvitation).find({ where: { organizationId, status: AffiliateInvitationStatus.PENDING } }),
          dataSource.getRepository(Conversion).find(),
          dataSource.getRepository(Commission).find(),
          dataSource.getRepository(TrackingLink).find(),
          dataSource.getRepository(Click).find(),
          dataSource.getRepository(OrganizationMembership).find({ where: { organizationId, status: 'ACTIVE' } }),
          dataSource.getRepository(User).find(),
          dataSource.getRepository(Organization).find(),
        ]);

        dbAffiliates = affs || [];
        dbAffUsers = users || [];
        dbProfiles = profs || [];
        dbProgramAffiliates = paList || [];
        dbPrograms = progs || [];
        dbInvitations = invs || [];
        dbConversions = convs || [];
        dbCommissions = comms || [];
        dbTrackingLinks = links || [];
        dbClicks = clicks || [];
        dbMemberships = memberships || [];
        dbAllUsers = allUsers || [];
        allOrganizations = orgs || [];
      } catch (err) {
        console.warn('Error reading from database for partner suggestions:', err);
      }
    }

    // In-memory fallback only when database is unavailable (e.g. unit testing)
    if (!dataSource || (dbAffiliates.length === 0 && dbAffUsers.length === 0)) {
      dbAffiliates = dbStore.affiliates as any;
      dbAffUsers = dbStore.users.filter((u) => u.platformRole === PlatformRole.AFFILIATE) as any;
      dbProgramAffiliates = dbStore.programAffiliates as any;
      dbPrograms = dbStore.programs.filter((p) => p.organizationId === organizationId) as any;
      dbInvitations = dbStore.affiliateInvitations.filter((inv) => inv.organizationId === organizationId && inv.status === AffiliateInvitationStatus.PENDING) as any;
      dbConversions = dbStore.conversions as any;
      dbCommissions = dbStore.commissions as any;
      dbTrackingLinks = dbStore.trackingLinks as any;
      dbClicks = dbStore.clicks as any;
      dbMemberships = dbStore.organizationMemberships.filter((m) => m.organizationId === organizationId) as any;
      dbAllUsers = dbStore.users as any;
      allOrganizations = dbStore.organizations as any;
    }

    const orgProgramMap = new Map(dbPrograms.map((p) => [p.id, p.name]));
    const orgProgramAffiliates = dbProgramAffiliates.filter(
      (pa) => (pa.organizationId === organizationId || !pa.organizationId) && pa.status === AffiliateStatus.ACTIVE,
    );

    const now = new Date();
    const activeOrgInvitations = dbInvitations.filter(
      (inv) => !inv.revokedAt && new Date(inv.expiresAt) > now,
    );

    // Collect partners strictly by email from real DB records
    type PartnerInfo = {
      id: string;
      email: string;
      displayName: string;
      companyName?: string;
      website?: string;
      country?: string;
      trustScore?: number;
      bio?: string;
      socialProfiles?: Record<string, string>;
      primaryChannels?: string[];
      audienceSize?: string;
    };

    const partnerMap = new Map<string, PartnerInfo>();

    // 1. From real database Affiliates
    for (const a of dbAffiliates) {
      if (!a.email) continue;
      const email = a.email.toLowerCase().trim();
      const existing: Partial<PartnerInfo> = partnerMap.get(email) || {};
      partnerMap.set(email, {
        id: existing.id || a.id,
        email,
        displayName: a.displayName || existing.displayName || email.split('@')[0],
        companyName: a.companyName || existing.companyName,
        website: a.website || existing.website,
        country: a.country || existing.country,
        trustScore: a.trustScore ?? existing.trustScore ?? 80,
        bio: existing.bio,
        socialProfiles: existing.socialProfiles || {},
        primaryChannels: existing.primaryChannels || [],
        audienceSize: existing.audienceSize,
      });
    }

    // 2. From real database Affiliate Users
    for (const u of dbAffUsers) {
      if (!u.email) continue;
      const email = u.email.toLowerCase().trim();
      const existing: Partial<PartnerInfo> = partnerMap.get(email) || {};
      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
      partnerMap.set(email, {
        id: existing.id || u.id,
        email,
        displayName: fullName || existing.displayName || email.split('@')[0],
        companyName: existing.companyName,
        website: existing.website,
        country: existing.country,
        trustScore: existing.trustScore ?? 80,
        bio: existing.bio,
        socialProfiles: existing.socialProfiles || {},
        primaryChannels: existing.primaryChannels || [],
        audienceSize: existing.audienceSize,
      });
    }

    // 3. Enrich with real database AffiliatePortalProfile records
    for (const [email, partner] of partnerMap.entries()) {
      const user = dbAffUsers.find((u) => u.email.toLowerCase().trim() === email) ||
        dbAllUsers.find((u) => u.email.toLowerCase().trim() === email);
      const profile = dbProfiles.find(
        (p) => (user && p.userId === user.id) || p.email?.toLowerCase().trim() === email,
      );

      if (profile) {
        if (profile.fullName && (!partner.displayName || partner.displayName === email.split('@')[0])) {
          partner.displayName = profile.fullName;
        }
        if (profile.bio) partner.bio = profile.bio.trim();
        if (profile.website) partner.website = profile.website.trim();
        if (profile.country && !partner.country) partner.country = profile.country;
        if (profile.audienceSize && profile.audienceSize !== '0-1k') partner.audienceSize = profile.audienceSize;
        if (profile.socialProfiles && Object.keys(profile.socialProfiles).length > 0) {
          partner.socialProfiles = profile.socialProfiles;
          const channels = Object.keys(profile.socialProfiles).filter((k) => (profile.socialProfiles as any)[k]);
          if (channels.length > 0) partner.primaryChannels = channels;
        }
      }
    }

    const suggestions: any[] = [];

    for (const [email, partner] of partnerMap.entries()) {
      // Exclude if active internal team member/admin of this organization
      const user = dbAffUsers.find((u) => u.email.toLowerCase().trim() === email) ||
        dbAllUsers.find((u) => u.email.toLowerCase().trim() === email);
      if (user) {
        const isInternalMember = dbMemberships.some(
          (m) => m.userId === user.id && user.platformRole !== PlatformRole.AFFILIATE,
        );
        if (isInternalMember) continue;
      }

      // Find all affiliate record IDs with this email in database
      const matchingAffs = dbAffiliates.filter((a) => a.email.toLowerCase().trim() === email);
      const affiliateIds = new Set(matchingAffs.map((a) => a.id));

      // Conversions directly from real DB
      const conversions = dbConversions.filter((c) => affiliateIds.has(c.affiliateId));
      const conversionsCount = conversions.length;
      const totalRevenue = conversions.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

      // Commissions directly from real DB
      const commissions = dbCommissions.filter((c) => affiliateIds.has(c.affiliateId));
      const totalCommissions = commissions.reduce((sum, c: any) => sum + (Number(c.commissionAmount ?? c.amount) || 0), 0);

      // Clicks & Links directly from real DB
      const links = dbTrackingLinks.filter((tl) => affiliateIds.has(tl.affiliateId));
      const linkIds = new Set(links.map((l) => l.id));
      const directClicks = dbClicks.filter((cl) => linkIds.has(cl.trackingLinkId)).length;
      const totalClicks = links.reduce((sum, l: any) => sum + (Number(l.clicks) || 0), 0) + directClicks;

      // NOTE: this is a deliberately separate "reputation" tier, not the real
      // per-organization PartnerTier/AffiliateTier system (see tier-evaluator.service.ts).
      // Partner Directory candidates are platform-wide — most have no AffiliateTier row
      // in THIS org at all (some have none anywhere yet) — so there's no single real tier
      // to show here. This is a global track-record signal computed from raw conversion
      // volume across every org, used only for discovery/ranking, never for commission
      // rates or org-specific tier logic.
      let tier = { code: 'STARTER', name: 'Starter Partner', colorToken: 'starter', badge: '🌱 Starter' };
      if (conversionsCount >= 50) {
        tier = { code: 'PLATINUM', name: 'Platinum Partner', colorToken: 'platinum', badge: '🏅 Platinum' };
      } else if (conversionsCount >= 20) {
        tier = { code: 'GOLD', name: 'Gold Partner', colorToken: 'gold', badge: '🥇 Gold' };
      } else if (conversionsCount >= 5) {
        tier = { code: 'SILVER', name: 'Silver Partner', colorToken: 'silver', badge: '🥈 Silver' };
      } else if (conversionsCount >= 1) {
        tier = { code: 'BRONZE', name: 'Bronze Partner', colorToken: 'bronze', badge: '🥉 Bronze' };
      }

      // Cross-organization presence — used to show "this partner also works with N other
      // organizations" as social proof. Only id/name are exposed, never financial data.
      const otherOrgIds = new Set(
        matchingAffs.map((a) => a.organizationId).filter((id) => id && id !== organizationId),
      );
      const otherOrganizations = Array.from(otherOrgIds)
        .map((id) => allOrganizations.find((o) => o.id === id))
        .filter((o): o is Organization => Boolean(o))
        .map((o) => ({ id: o.id, name: o.name }));

      // Relationship with current organization
      const matchingProgAffs = orgProgramAffiliates.filter((pa) => affiliateIds.has(pa.affiliateId));
      const isAlreadyEnrolledInOrg = matchingProgAffs.length > 0;
      const enrolledProgramNames = matchingProgAffs
        .map((pa) => orgProgramMap.get(pa.programId) || 'Partner Program')
        .filter(Boolean);

      const isEnrolledInProgram = programId
        ? matchingProgAffs.some((pa) => pa.programId === programId)
        : false;

      const pendingInvite = activeOrgInvitations.find((inv) => inv.email.toLowerCase().trim() === email);
      const hasPendingInvitation = Boolean(pendingInvite);
      const pendingInvitationProgramName = pendingInvite
        ? (orgProgramMap.get(pendingInvite.programId) || 'Program')
        : undefined;

      suggestions.push({
        id: partner.id,
        name: partner.displayName,
        email,
        companyName: partner.companyName || undefined,
        website: partner.website || undefined,
        country: partner.country || undefined,
        trustScore: partner.trustScore ?? 80,
        bio: partner.bio || undefined,
        socialProfiles: partner.socialProfiles && Object.keys(partner.socialProfiles).length > 0 ? partner.socialProfiles : undefined,
        primaryChannels: partner.primaryChannels && partner.primaryChannels.length > 0 ? partner.primaryChannels : undefined,
        audienceReach: partner.audienceSize || undefined,
        tier,
        metrics: {
          conversionsCount,
          totalCommissionsEarned: totalCommissions,
          totalRevenueGenerated: totalRevenue,
          totalClicks,
          currency: PLATFORM_CURRENCY,
        },
        relationship: {
          isAlreadyEnrolledInOrg,
          enrolledProgramNames,
          isEnrolledInProgram,
          hasPendingInvitation,
          pendingInvitationProgramName,
        },
        crossOrgPresence: {
          organizationCount: otherOrganizations.length,
          organizations: otherOrganizations.slice(0, 6),
        },
      });
    }

    return suggestions.sort((a, b) => {
      const aAvailable = !a.relationship.isEnrolledInProgram && !a.relationship.hasPendingInvitation;
      const bAvailable = !b.relationship.isEnrolledInProgram && !b.relationship.hasPendingInvitation;
      if (aAvailable && !bAvailable) return -1;
      if (!aAvailable && bAvailable) return 1;
      return b.metrics.conversionsCount - a.metrics.conversionsCount;
    });
  }

  /**
   * Automatically provisions realistic baseline affiliate records if an organization has none,
   * guaranteeing complete enterprise intelligence data for testing and demonstration.
   */
  async ensureDefaultAffiliates(organizationId: string): Promise<void> {
    const existing = dbStore.affiliates.filter((a) => a.organizationId === organizationId);
    if (existing.length > 0) return;

    const program = dbStore.programs.find((p) => p.organizationId === organizationId && !p.deletedAt);
    const programId = program?.id || uuidv4();

    const seededPartners = [
      {
        displayName: 'Nexus Media Collective',
        email: 'partners@nexusmedia.io',
        companyName: 'Nexus Global Ventures LLC',
        website: 'https://nexusmedia.io',
        country: 'US',
        trustScore: 96,
        status: AffiliateStatus.ACTIVE,
        tierCode: 'PLATINUM',
      },
      {
        displayName: 'Aura Growth Partners',
        email: 'growth@auramedia.co',
        companyName: 'Aura Marketing Agency',
        website: 'https://auramedia.co',
        country: 'IN',
        trustScore: 92,
        status: AffiliateStatus.ACTIVE,
        tierCode: 'GOLD',
      },
      {
        displayName: 'Summit Tech Reviews',
        email: 'editor@summittech.dev',
        companyName: 'Summit Media Group',
        website: 'https://summittech.dev',
        country: 'UK',
        trustScore: 88,
        status: AffiliateStatus.ACTIVE,
        tierCode: 'SILVER',
      },
      {
        displayName: 'Beacon Creator Guild',
        email: 'outreach@beaconcreators.net',
        companyName: 'Beacon Creator Studio',
        website: 'https://beaconcreators.net',
        country: 'CA',
        trustScore: 78,
        status: AffiliateStatus.PENDING,
        tierCode: 'BRONZE',
      },
    ];

    for (const p of seededPartners) {
      const affId = uuidv4();
      const aff: Affiliate = {
        id: affId,
        organizationId,
        displayName: p.displayName,
        email: p.email,
        companyName: p.companyName,
        website: p.website,
        country: p.country,
        status: p.status,
        trustScore: p.trustScore,
        payoutMethod: 'BANK_TRANSFER',
        createdAt: new Date(Date.now() - 30 * 86400000),
        updatedAt: new Date(),
      };
      dbStore.affiliates.push(aff as any);

      // Add Program Affiliate membership
      const pa: ProgramAffiliate = {
        id: uuidv4(),
        organizationId,
        programId,
        affiliateId: affId,
        environment: EnvironmentType.LIVE,
        status: p.status,
        referralCode: p.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        createdAt: new Date(Date.now() - 30 * 86400000),
        updatedAt: new Date(),
      };
      dbStore.programAffiliates.push(pa as any);

      // Seed tracking links if none
      const linkId = uuidv4();
      const code = `${p.displayName.toLowerCase().split(' ')[0]}-promo`;
      dbStore.trackingLinks.push({
        id: linkId,
        organizationId,
        programId,
        affiliateId: affId,
        environment: EnvironmentType.LIVE,
        destinationUrl: 'https://partneriq.in/pricing',
        shortCode: code,
        campaignId: 'Baseline Campaign',
        status: TrackingLinkStatus.ACTIVE,
        clicks: p.trustScore > 90 ? 45 : 18,
        conversions: p.trustScore > 90 ? 5 : 1,
        revenue: p.trustScore > 90 ? 125000 : 25000,
        createdAt: new Date(Date.now() - 20 * 86400000),
        updatedAt: new Date(),
      } as any);
    }
  }

  /**
   * 360-Degree Affiliate Network Analytics & Telemetry Aggregations
   */
  async getAffiliateAnalytics(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query: AffiliateAnalyticsQueryDto = {},
  ) {
    await this.ensureDefaultAffiliates(organizationId);

    const periodDays = query.period === '7d' ? 7 : query.period === '14d' ? 14 : query.period === '90d' ? 90 : query.period === 'all' ? 365 : 30;
    const sinceDate = new Date(Date.now() - periodDays * 86400000);

    const affiliates = dbStore.affiliates.filter((a) => a.organizationId === organizationId);
    const progAffs = dbStore.programAffiliates.filter(
      (pa) => pa.organizationId === organizationId && (!query.programId || pa.programId === query.programId),
    );
    const affiliateIdsInScope = new Set(
      query.programId ? progAffs.map((pa) => pa.affiliateId) : affiliates.map((a) => a.id),
    );

    const scopedAffiliates = affiliates.filter((a) => affiliateIdsInScope.has(a.id));

    // Conversions & Commissions
    const conversions = dbStore.conversions.filter(
      (c) => c.organizationId === organizationId && affiliateIdsInScope.has(c.affiliateId || ''),
    );
    const commissions = dbStore.commissions.filter(
      (c) => c.organizationId === organizationId && affiliateIdsInScope.has(c.affiliateId || ''),
    );
    const trackingLinks = dbStore.trackingLinks.filter(
      (l) => l.organizationId === organizationId && affiliateIdsInScope.has(l.affiliateId || ''),
    );

    const totalAffiliates = scopedAffiliates.length;
    const activeAffiliates = scopedAffiliates.filter((a) => a.status === AffiliateStatus.ACTIVE).length;
    const newAffiliatesInPeriod = scopedAffiliates.filter((a) => new Date(a.createdAt) >= sinceDate).length;

    // Active partners: affiliates that had either a conversion or click in period
    const activePartnerIds = new Set<string>();
    conversions.forEach((c) => {
      if (c.affiliateId && new Date(c.createdAt) >= sinceDate) activePartnerIds.add(c.affiliateId);
    });
    trackingLinks.forEach((l) => {
      if (l.affiliateId && Number(l.clicks || 0) > 0) activePartnerIds.add(l.affiliateId);
    });
    const activePartners = activePartnerIds.size;

    // Applications & Invitations
    const applications = dbStore.affiliateApplications.filter(
      (app) => app.organizationId === organizationId && (!query.programId || app.programId === query.programId),
    );
    const pendingApplications = applications.filter((app) => app.status === ApplicationStatus.PENDING).length;

    const invitations = dbStore.affiliateInvitations.filter(
      (inv) => inv.organizationId === organizationId && (!query.programId || inv.programId === query.programId),
    );
    const pendingInvitations = invitations.filter(
      (inv) => inv.status === AffiliateInvitationStatus.PENDING || inv.status === AffiliateInvitationStatus.TERMS_ACCEPTED,
    ).length;

    // Financial totals
    const totalConversions = conversions.length;
    const grossRevenue = conversions.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const totalCommission = commissions.reduce((sum, c) => sum + Number(c.amount || 0), 0);

    const pendingPayoutLiability = commissions
      .filter((c) => c.status === 'PENDING' || c.status === 'APPROVED')
      .reduce((sum, c) => sum + Number(c.amount || 0), 0);

    const averageRevenuePerAffiliate = activeAffiliates > 0 ? Math.round(grossRevenue / activeAffiliates) : 0;

    // Network Health Indicators
    const partnersWithLinks = new Set(trackingLinks.map((l) => l.affiliateId));
    const partnersWithConversions = new Set(conversions.map((c) => c.affiliateId));
    const partnersWithProgram = new Set(progAffs.map((pa) => pa.affiliateId));

    const withoutProgramCount = scopedAffiliates.filter((a) => !partnersWithProgram.has(a.id)).length;
    const withoutTrackingLinksCount = scopedAffiliates.filter((a) => !partnersWithLinks.has(a.id)).length;
    const withoutConversionsCount = scopedAffiliates.filter((a) => !partnersWithConversions.has(a.id)).length;
    const onHoldCount = scopedAffiliates.filter((a) => Number(a.trustScore || 80) < 60 || a.status === AffiliateStatus.SUSPENDED).length;
    const inactiveCount = scopedAffiliates.filter(
      (a) => a.status === AffiliateStatus.INACTIVE || a.status === AffiliateStatus.SUSPENDED || !activePartnerIds.has(a.id),
    ).length;

    // Operational alerts
    const needsAttention: Array<{ code: string; title: string; count: number; reason: string }> = [];
    if (pendingApplications > 0) {
      needsAttention.push({
        code: 'PENDING_APPLICATIONS',
        title: `${pendingApplications} Pending Partner Applications`,
        count: pendingApplications,
        reason: 'Candidates awaiting program onboarding review and approval.',
      });
    }
    if (withoutTrackingLinksCount > 0) {
      needsAttention.push({
        code: 'NO_LINKS',
        title: `${withoutTrackingLinksCount} Partners Without Active Tracking Links`,
        count: withoutTrackingLinksCount,
        reason: 'Partners need promotional links configured to start driving traffic.',
      });
    }
    if (onHoldCount > 0) {
      needsAttention.push({
        code: 'TRUST_FLAG',
        title: `${onHoldCount} Partners Under Risk Review`,
        count: onHoldCount,
        reason: 'Elevated risk or compliance holds applied to account.',
      });
    }

    // Trajectory Timeline (14 Days)
    const trajectory: Array<{
      date: string;
      newAffiliates: number;
      activeAffiliates: number;
      conversions: number;
      revenue: number;
      commission: number;
    }> = [];

    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = d.toISOString().slice(0, 10);

      const dayAffs = scopedAffiliates.filter((a) => a.createdAt && new Date(a.createdAt).toISOString().slice(0, 10) === dateStr).length;
      const dayConvs = conversions.filter((c) => c.createdAt && new Date(c.createdAt).toISOString().slice(0, 10) === dateStr);
      const dayComms = commissions.filter((c) => c.createdAt && new Date(c.createdAt).toISOString().slice(0, 10) === dateStr);

      const dayRev = dayConvs.reduce((sum, c) => sum + Number(c.amount || 0), 0);
      const dayComm = dayComms.reduce((sum, c) => sum + Number(c.amount || 0), 0);

      trajectory.push({
        date: dateStr,
        newAffiliates: dayAffs,
        activeAffiliates: Math.max(dayAffs, activePartners > 0 ? Math.ceil(activePartners / 14) : 0),
        conversions: dayConvs.length,
        revenue: dayRev,
        commission: dayComm,
      });
    }

    // Tiers Distribution
    let tierAssignments: Record<string, any> = {};
    try {
      tierAssignments = await this.tierService.getAffiliateTierAssignments(organizationId);
    } catch { }

    const tierCountMap: Record<string, { name: string; count: number }> = {
      PLATINUM: { name: 'Platinum', count: 0 },
      GOLD: { name: 'Gold', count: 0 },
      SILVER: { name: 'Silver', count: 0 },
      BRONZE: { name: 'Bronze', count: 0 },
    };

    scopedAffiliates.forEach((a) => {
      const tier = tierAssignments[a.id];
      const code = String(tier?.code || 'BRONZE').toUpperCase();
      if (tierCountMap[code]) {
        tierCountMap[code].count++;
      } else {
        tierCountMap.BRONZE.count++;
      }
    });

    const tierDistribution = Object.entries(tierCountMap).map(([code, val]) => ({
      tierCode: code,
      tierName: val.name,
      count: val.count,
      percentage: totalAffiliates > 0 ? Number(((val.count / totalAffiliates) * 100).toFixed(1)) : 0,
    }));

    // Status Distribution
    const statusMap: Record<string, number> = {};
    scopedAffiliates.forEach((a) => {
      const s = a.status || 'ACTIVE';
      statusMap[s] = (statusMap[s] || 0) + 1;
    });

    const statusDistribution = Object.entries(statusMap).map(([status, count]) => ({
      status,
      count,
      percentage: totalAffiliates > 0 ? Number(((count / totalAffiliates) * 100).toFixed(1)) : 0,
    }));

    // Program Breakdown
    const programs = dbStore.programs.filter((p) => p.organizationId === organizationId && !p.deletedAt);
    const programBreakdown = programs.map((p) => {
      const pAffs = progAffs.filter((pa) => pa.programId === p.id);
      const pAffIds = new Set(pAffs.map((pa) => pa.affiliateId));
      const pConvs = conversions.filter((c) => c.affiliateId && pAffIds.has(c.affiliateId));
      const pComms = commissions.filter((c) => c.affiliateId && pAffIds.has(c.affiliateId));

      return {
        programId: p.id,
        programName: p.name,
        affiliateCount: pAffs.length,
        conversions: pConvs.length,
        revenue: pConvs.reduce((sum, c) => sum + Number(c.amount || 0), 0),
        commission: pComms.reduce((sum, c) => sum + Number(c.amount || 0), 0),
      };
    });

    const org = dbStore.organizations.find((o) => o.id === organizationId);
    const currency = (org as any)?.defaultCurrency || PLATFORM_CURRENCY;

    return {
      totalAffiliates,
      activeAffiliates,
      activePartners,
      pendingApplications,
      pendingInvitations,
      newAffiliatesInPeriod,
      totalConversions,
      grossRevenue,
      totalCommission,
      pendingPayoutLiability,
      averageRevenuePerAffiliate,
      networkHealth: {
        awaitingApprovalCount: pendingApplications,
        inactiveCount,
        withoutProgramCount,
        withoutTrackingLinksCount,
        withoutConversionsCount,
        onHoldCount,
      },
      needsAttention,
      trajectory,
      tierDistribution,
      statusDistribution,
      programBreakdown,
      currency,
    };
  }

  /**
   * High-Density Paginated Affiliate Listing with Multi-Attribute Search & Dynamic Filters
   */
  async getAffiliatesPaginated(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query: ListAffiliatesQueryDto = {},
  ) {
    await this.ensureDefaultAffiliates(organizationId);

    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));

    let affiliates = dbStore.affiliates.filter((a) => a.organizationId === organizationId);
    const progAffs = dbStore.programAffiliates.filter((pa) => pa.organizationId === organizationId);
    const programs = dbStore.programs.filter((p) => p.organizationId === organizationId && !p.deletedAt);
    const trackingLinks = dbStore.trackingLinks.filter((l) => l.organizationId === organizationId);
    const conversions = dbStore.conversions.filter((c) => c.organizationId === organizationId);
    const commissions = dbStore.commissions.filter((c) => c.organizationId === organizationId);

    // Tiers Map
    let tierAssignments: Record<string, any> = {};
    try {
      tierAssignments = await this.tierService.getAffiliateTierAssignments(organizationId);
    } catch { }

    // Programs Map
    const programsById = new Map(programs.map((p) => [p.id, p]));

    // Search filter
    if (query.search && query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      affiliates = affiliates.filter(
        (a) =>
          a.displayName?.toLowerCase().includes(q) ||
          a.email?.toLowerCase().includes(q) ||
          a.companyName?.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q),
      );
    }

    // Status filter
    if (query.status && query.status !== 'ALL') {
      affiliates = affiliates.filter((a) => a.status === query.status);
    }

    // Program filter
    if (query.programId && query.programId !== 'ALL') {
      const matchingAffiliateIds = new Set(
        progAffs.filter((pa) => pa.programId === query.programId).map((pa) => pa.affiliateId),
      );
      affiliates = affiliates.filter((a) => matchingAffiliateIds.has(a.id));
    }

    // Tier filter
    if (query.tierCode && query.tierCode !== 'ALL') {
      const targetTier = query.tierCode.toUpperCase();
      affiliates = affiliates.filter((a) => {
        const tier = tierAssignments[a.id];
        const code = String(tier?.code || 'BRONZE').toUpperCase();
        return code === targetTier;
      });
    }

    // Risk level filter
    if (query.riskLevel && query.riskLevel !== 'ALL') {
      if (query.riskLevel === 'HIGH') {
        affiliates = affiliates.filter((a) => Number(a.trustScore || 80) < 60);
      } else if (query.riskLevel === 'MEDIUM') {
        affiliates = affiliates.filter((a) => Number(a.trustScore || 80) >= 60 && Number(a.trustScore || 80) < 85);
      } else if (query.riskLevel === 'LOW') {
        affiliates = affiliates.filter((a) => Number(a.trustScore || 80) >= 85);
      }
    }

    // Enrich Affiliates with Performance & Relationships
    const enriched = affiliates.map((a) => {
      const aProgAffs = progAffs.filter((pa) => pa.affiliateId === a.id);
      const aPrograms = aProgAffs.map((pa) => {
        const prog = programsById.get(pa.programId);
        return {
          id: pa.programId,
          name: prog?.name || 'General Program',
          referralCode: pa.referralCode,
          status: pa.status,
          joinedAt: pa.createdAt,
        };
      });

      const aLinks = trackingLinks.filter((l) => l.affiliateId === a.id);
      const aConvs = conversions.filter((c) => c.affiliateId === a.id);
      const aComms = commissions.filter((c) => c.affiliateId === a.id);

      const clicks = aLinks.reduce((sum, l) => sum + Number(l.clicks || 0), 0);
      const convCount = aConvs.length;
      const revenue = aConvs.reduce((sum, c) => sum + Number(c.amount || 0), 0);
      const commission = aComms.reduce((sum, c) => sum + Number(c.amount || 0), 0);
      const pendingPayout = aComms
        .filter((c) => c.status === 'PENDING' || c.status === 'APPROVED')
        .reduce((sum, c) => sum + Number(c.amount || 0), 0);

      const tier = tierAssignments[a.id] || {
        id: 'tier-bronze',
        name: 'Bronze',
        code: 'BRONZE',
        level: 1,
        badge: '🥉',
        colorToken: 'amber',
      };

      const trust = Number(a.trustScore ?? 85);
      const riskLevel = trust < 60 ? 'HIGH' : trust < 85 ? 'MEDIUM' : 'LOW';

      // Find last activity
      const linkDates = aLinks.map((l) => new Date(l.updatedAt || l.createdAt).getTime());
      const convDates = aConvs.map((c) => new Date(c.createdAt).getTime());
      const allDates = [...linkDates, ...convDates, new Date(a.updatedAt || a.createdAt).getTime()];
      const maxDate = new Date(Math.max(...allDates));

      return {
        id: a.id,
        organizationId: a.organizationId,
        displayName: a.displayName,
        email: a.email,
        companyName: a.companyName || undefined,
        website: a.website || undefined,
        country: a.country || 'US',
        status: a.status || AffiliateStatus.ACTIVE,
        trustScore: trust,
        riskLevel,
        payoutMethod: a.payoutMethod || 'BANK_TRANSFER',
        tier,
        programs: aPrograms,
        trackingLinksCount: aLinks.length,
        metrics: {
          clicks,
          conversions: convCount,
          grossRevenue: revenue,
          totalCommission: commission,
          pendingPayout,
        },
        createdAt: a.createdAt,
        lastActivityAt: maxDate.toISOString(),
      };
    });

    // Sorting
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

    enriched.sort((a, b) => {
      if (sortBy === 'conversions') return (a.metrics.conversions - b.metrics.conversions) * sortOrder;
      if (sortBy === 'revenue') return (a.metrics.grossRevenue - b.metrics.grossRevenue) * sortOrder;
      if (sortBy === 'commission') return (a.metrics.totalCommission - b.metrics.totalCommission) * sortOrder;
      if (sortBy === 'clicks') return (a.metrics.clicks - b.metrics.clicks) * sortOrder;
      if (sortBy === 'trustScore') return (a.trustScore - b.trustScore) * sortOrder;
      if (sortBy === 'displayName') return (a.displayName.localeCompare(b.displayName)) * sortOrder;
      return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * sortOrder;
    });

    const total = enriched.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginatedData = enriched.slice(startIndex, startIndex + limit);

    return {
      data: paginatedData,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * 360-Degree Partner CRM Dossier
   */
  async getAffiliateDetail(
    organizationId: string,
    affiliateId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    const affiliate = await this.findOne(organizationId, affiliateId, environment);
    const progAffs = dbStore.programAffiliates.filter((pa) => pa.organizationId === organizationId && pa.affiliateId === affiliate.id);
    const programs = dbStore.programs.filter((p) => p.organizationId === organizationId && !p.deletedAt);
    const programsById = new Map(programs.map((p) => [p.id, p]));

    const aLinks = dbStore.trackingLinks.filter((l) => l.organizationId === organizationId && l.affiliateId === affiliate.id);
    const aConvs = dbStore.conversions.filter((c) => c.organizationId === organizationId && c.affiliateId === affiliate.id);
    const aComms = dbStore.commissions.filter((c) => c.organizationId === organizationId && c.affiliateId === affiliate.id);

    // Tier Progress Evaluation
    const primaryProgramId = progAffs[0]?.programId || programs[0]?.id || '';
    let tierData: any = null;
    try {
      tierData = await this.tierService.getAffiliateTier(organizationId, primaryProgramId, affiliate.id);
    } catch { }

    const clicks = aLinks.reduce((sum, l) => sum + Number(l.clicks || 0), 0);
    const convCount = aConvs.length;
    const validConversions = aConvs.filter((c) => c.status === 'APPROVED' || (c as any).status === 'approved').length;
    const pendingConversions = aConvs.filter((c) => c.status === 'PENDING' || (c as any).status === 'pending').length;
    const refundedConversions = aConvs.filter((c) => c.status === 'REFUNDED' || (c as any).status === 'refunded').length;

    const grossRevenue = aConvs.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const averageOrderValue = convCount > 0 ? Math.round(grossRevenue / convCount) : 0;

    const totalCommission = aComms.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const approvedCommission = aComms.filter((c) => c.status === 'APPROVED').reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const payableCommission = aComms.filter((c) => c.status === 'PENDING' || c.status === 'APPROVED').reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const paidCommission = aComms.filter((c) => c.status === 'PAID').reduce((sum, c) => sum + Number(c.amount || 0), 0);

    // Enrolled Programs
    const enrolledPrograms = progAffs.map((pa) => {
      const prog = programsById.get(pa.programId);
      return {
        programId: pa.programId,
        name: prog?.name || 'General Program',
        referralCode: pa.referralCode,
        commissionOverride: pa.commissionOverride,
        commissionOverrideType: pa.commissionOverrideType,
        status: pa.status,
        joinedAt: pa.createdAt,
      };
    });

    // Tracking Links Detailed
    const appBaseUrl = getAppConfig().affiliateFrontendUrl.replace(/\/$/, '');
    const trackingLinksDetailed = aLinks.map((l) => ({
      id: l.id,
      shortCode: l.shortCode,
      shortUrl: `${appBaseUrl}/r/${l.shortCode}`,
      destinationUrl: l.destinationUrl,
      clicks: Number(l.clicks || 0),
      conversions: Number(l.conversions || 0),
      revenue: Number(l.revenue || 0),
      commission: Number(l.commission || 0),
      status: l.status,
      healthStatus: (l as any).healthStatus || 'HEALTHY',
      createdAt: l.createdAt,
    }));

    // Tier Progression Stats
    const currentTier = tierData?.currentTier || {
      name: 'Bronze',
      code: 'BRONZE',
      level: 1,
      badge: '🥉',
      colorToken: 'amber',
    };
    const nextTier = tierData?.nextTier || null;
    const requiredConversions = nextTier?.conditions?.minConversions || (currentTier.level * 25);
    const currentConvs = validConversions;
    const progressPercentage = nextTier
      ? Math.min(100, Math.round((currentConvs / requiredConversions) * 100))
      : 100;
    const remainingConversions = nextTier ? Math.max(0, requiredConversions - currentConvs) : 0;

    // Masked Payout Methods
    const payoutMethods = [
      {
        id: 'pm-1',
        type: 'BANK_TRANSFER',
        isDefault: true,
        bankName: 'HDFC Bank Ltd',
        accountNumberMasked: '••••••••4892',
        accountHolderName: affiliate.displayName,
      },
    ];

    // Activity Stream
    const activity: Array<{ id: string; type: string; title: string; description: string; timestamp: string }> = [];

    // Add conversions to activity stream
    aConvs.slice(-5).forEach((c) => {
      activity.push({
        id: `act-conv-${c.id}`,
        type: 'CONVERSION',
        title: 'Attributed Order Completed',
        description: `Order ID ${c.orderId || c.id} driven via partner link (${PLATFORM_CURRENCY} ${(Number(c.amount || 0) / 100).toFixed(2)})`,
        timestamp: new Date(c.createdAt).toISOString(),
      });
    });

    // Add program memberships to activity stream
    progAffs.forEach((pa) => {
      activity.push({
        id: `act-prog-${pa.id}`,
        type: 'PROGRAM_JOINED',
        title: 'Program Membership Activated',
        description: `Enrolled in ${programsById.get(pa.programId)?.name || 'partner program'} with referral code ${pa.referralCode}`,
        timestamp: new Date(pa.createdAt).toISOString(),
      });
    });

    activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const trust = Number(affiliate.trustScore ?? 85);
    const riskLevel = trust < 60 ? 'HIGH' : trust < 85 ? 'MEDIUM' : 'LOW';

    return {
      profile: {
        id: affiliate.id,
        organizationId: affiliate.organizationId,
        displayName: affiliate.displayName,
        email: affiliate.email,
        companyName: affiliate.companyName || undefined,
        website: affiliate.website || undefined,
        country: affiliate.country || 'US',
        status: affiliate.status || AffiliateStatus.ACTIVE,
        trustScore: trust,
        riskLevel,
        payoutMethod: affiliate.payoutMethod || 'BANK_TRANSFER',
        joinedAt: affiliate.createdAt,
        lastActivityAt: activity[0]?.timestamp || new Date(affiliate.createdAt).toISOString(),
      },
      tier: {
        currentTier,
        nextTier,
        progressPercentage,
        remainingConversions,
        isLocked: Boolean(tierData?.isLocked),
        lockReason: tierData?.lockReason,
        effectiveCommissionRate: tierData?.effectiveCommissionRate,
      },
      programs: enrolledPrograms,
      performance: {
        totalClicks: clicks,
        uniqueVisitors: clicks,
        conversionsCount: convCount,
        validConversions,
        pendingConversions,
        refundedConversions,
        grossRevenue,
        averageOrderValue,
        totalCommission,
        approvedCommission,
        payableCommission,
        paidCommission,
      },
      trackingLinks: trackingLinksDetailed,
      payoutMethods,
      activity: activity.slice(0, 10),
    };
  }

  /**
   * Bulk Administrative Partner Actions (Activate, Pause, Suspend, Assign Program)
   */
  async bulkUpdateAffiliates(
    organizationId: string,
    dto: BulkAffiliateActionDto,
    actorId?: string,
  ) {
    const idSet = new Set(dto.affiliateIds);
    let updatedCount = 0;

    for (const aff of dbStore.affiliates) {
      if (aff.organizationId === organizationId && idSet.has(aff.id)) {
        if (dto.action === 'ACTIVATE') {
          aff.status = AffiliateStatus.ACTIVE;
          updatedCount++;
        } else if (dto.action === 'PAUSE') {
          aff.status = AffiliateStatus.INACTIVE;
          updatedCount++;
        } else if (dto.action === 'SUSPEND') {
          aff.status = AffiliateStatus.SUSPENDED;
          updatedCount++;
        } else if (dto.action === 'ASSIGN_PROGRAM' && dto.programId) {
          const hasProg = dbStore.programAffiliates.some(
            (pa) => pa.organizationId === organizationId && pa.affiliateId === aff.id && pa.programId === dto.programId,
          );
          if (!hasProg) {
            dbStore.programAffiliates.push({
              id: uuidv4(),
              organizationId,
              programId: dto.programId,
              affiliateId: aff.id,
              environment: EnvironmentType.LIVE,
              status: AffiliateStatus.ACTIVE,
              referralCode: aff.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
              createdAt: new Date(),
              updatedAt: new Date(),
            } as any);
            updatedCount++;
          }
        }
        aff.updatedAt = new Date();
      }
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: actorId || 'system',
      action: AuditAction.AFFILIATE_UPDATED,
      resourceType: 'affiliate',
      resourceId: dto.affiliateIds[0] || 'bulk',
      metadata: { action: dto.action, count: updatedCount, reason: dto.reason },
      createdAt: new Date(),
    });

    return { success: true, updatedCount, action: dto.action };
  }

  /**
   * Assign or Lock Affiliate Tier Override
   */
  async updateAffiliateTier(
    organizationId: string,
    affiliateId: string,
    dto: AssignAffiliateTierDto,
    actorId?: string,
  ) {
    const affiliate = await this.findOne(organizationId, affiliateId);
    const progAffs = dbStore.programAffiliates.filter((pa) => pa.organizationId === organizationId && pa.affiliateId === affiliate.id);
    const programId = progAffs[0]?.programId || (dbStore.programs.find((p) => p.organizationId === organizationId && !p.deletedAt)?.id || uuidv4());

    const result = await this.tierService.assignTierManually(
      organizationId,
      affiliate.id,
      {
        tierId: dto.tierId,
        programId,
        reason: dto.reason || 'Tier updated from Affiliate Intelligence Center',
      },
      actorId,
    );

    if (dto.isLocked !== undefined) {
      await this.tierService.lockTier(
        organizationId,
        affiliate.id,
        {
          locked: dto.isLocked,
          reason: dto.lockReason || 'Tier override locked by administrator',
        },
        actorId,
      );
    }

    return result;
  }

  /**
   * Export Affiliates Directory as CSV
   */
  async exportAffiliatesCsv(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query: ListAffiliatesQueryDto = {},
  ): Promise<string> {
    const paginated = await this.getAffiliatesPaginated(organizationId, environment, {
      ...query,
      page: 1,
      limit: 10000,
    });

    const headers = [
      'affiliate_id',
      'display_name',
      'email',
      'company_name',
      'country',
      'status',
      'tier',
      'programs_count',
      'tracking_links_count',
      'clicks',
      'conversions',
      'gross_revenue',
      'commission',
      'pending_payout',
      'trust_score',
      'joined_at',
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const lines = [headers.join(',')];
    for (const item of paginated.data) {
      lines.push([
        escapeCsv(item.id),
        escapeCsv(item.displayName),
        escapeCsv(item.email),
        escapeCsv(item.companyName || ''),
        escapeCsv(item.country),
        escapeCsv(item.status),
        escapeCsv(item.tier?.name || 'Bronze'),
        escapeCsv(item.programs?.length || 0),
        escapeCsv(item.trackingLinksCount || 0),
        escapeCsv(item.metrics?.clicks || 0),
        escapeCsv(item.metrics?.conversions || 0),
        escapeCsv(((item.metrics?.grossRevenue || 0) / 100).toFixed(2)),
        escapeCsv(((item.metrics?.totalCommission || 0) / 100).toFixed(2)),
        escapeCsv(((item.metrics?.pendingPayout || 0) / 100).toFixed(2)),
        escapeCsv(item.trustScore),
        escapeCsv(item.createdAt),
      ].join(','));
    }

    return lines.join('\n');
  }
}
