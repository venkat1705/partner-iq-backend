import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, AffiliateEntity, ProgramAffiliateEntity, AffiliateApplicationEntity, TrackingLinkEntity } from '../../database/store';
import { AffiliateStatus, AffiliateInvitationStatus, ApplicationStatus, AuditAction, ProgramStatus, TrackingLinkStatus, AutomationTriggerType, TierTransitionType, EnvironmentType, PlatformRole } from '../../common/enums';
import { SecurityUtils } from '../../common/utils/security.utils';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import { getAppConfig } from '../../config/app.config';
import * as XLSX from 'xlsx';
import { AcceptAffiliateInvitationDto, BulkUploadAffiliateInvitationsDto, CreateAffiliateDto, CreateAffiliateInvitationDto, InvitationCommissionType, PublicApplyDto } from './dto/affiliate.dto';
import { BrevoEmailService } from '../memberships/brevo-email.service';
import { TierService } from '../gamification/tiers/tier.service';
import { AutomationEngineService } from '../automations/engine/automation-engine.service';
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
} from '../../database/schema';
import { IsNull, In } from 'typeorm';
import { assertUserEligibleForAffiliate } from './affiliate-eligibility.policy';

@Injectable()
export class AffiliatesService {
  constructor(
    private readonly brevoEmail: BrevoEmailService,
    private readonly tierService: TierService,
    private readonly automationEngineService: AutomationEngineService,
  ) { }

  async create(organizationId: string, dto: CreateAffiliateDto, actorId?: string, skipAudit = false, environment: EnvironmentType = EnvironmentType.LIVE) {
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

    return { affiliate, programAffiliate: progAffiliate, trackingLink };
  }

  async inviteAffiliate(organizationId: string, dto: CreateAffiliateInvitationDto, actorId: string, environment: EnvironmentType = EnvironmentType.LIVE) {
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

    const inviteUrl = `${getAppConfig().frontendUrl.replace(/\/$/, '')}/invitations/affiliate/${token}`;
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

      // 6. Check Active Program Membership
      const existingAffiliate = dbStore.affiliates.find(
        (item) => item.organizationId === organizationId && item.email === email,
      );
      const activeMembership =
        existingAffiliate &&
        dbStore.programAffiliates.find(
          (item) =>
            item.organizationId === organizationId &&
            item.programId === program.id &&
            item.affiliateId === existingAffiliate.id &&
            item.status === AffiliateStatus.ACTIVE,
        );

      if (activeMembership) {
        failed.push({
          rowNumber,
          partnerName,
          email,
          program: program.name,
          reason: 'This partner is already an active enrolled member of this program.',
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
      const inviteUrl = `${getAppConfig().frontendUrl.replace(/\/$/, '')}/invitations/affiliate/${token}`;
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
    if (invitation.status !== AffiliateInvitationStatus.PENDING || invitation.revokedAt) {
      throw new BadRequestException('Only pending invitations can be resent.');
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

    const token = `${uuidv4()}${uuidv4()}`.replace(/-/g, '');
    invitation.tokenHash = SecurityUtils.hashToken(token);
    invitation.expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    invitation.updatedAt = new Date();
    try {
      const dataSource = await initializeDataSource();
      await dataSource.getRepository(AffiliateInvitation).save(invitation);
    } catch { }
    const inviteUrl = `${getAppConfig().frontendUrl.replace(/\/$/, '')}/invitations/affiliate/${token}`;
    this.audit(organizationId, actorId, 'AFFILIATE_INVITATION_RESENT', 'affiliate_invitation', invitation.id, {
      programId: invitation.programId,
      email: invitation.email,
    });
    await this.sendAffiliateInvitationEmail(inviteUrl, invitation, program);
    return { ...this.serializeInvitation(invitation), inviteUrl: process.env.BREVO_API_KEY ? undefined : inviteUrl };
  }

  async revokeInvitation(organizationId: string, invitationId: string, actorId: string) {
    const invitation = await this.findInvitation(organizationId, invitationId);
    if (invitation.status !== AffiliateInvitationStatus.PENDING) {
      throw new BadRequestException('Only pending invitations can be revoked.');
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

  async acceptAffiliateInvitation(token: string, dto: AcceptAffiliateInvitationDto, userId?: string) {
    if (!dto.acceptedTerms) {
      throw new BadRequestException('Program terms must be accepted.');
    }
    const invitation = await this.findValidInvitationByToken(token);
    return this.acceptInvitationRecord(invitation, dto, userId);
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
    if (invitation.status !== AffiliateInvitationStatus.PENDING) {
      throw new BadRequestException('Only pending invitations can be declined.');
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
      invitation.status = AffiliateInvitationStatus.ACCEPTED;
      invitation.acceptedAt = new Date();
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

    invitation.status = AffiliateInvitationStatus.ACCEPTED;
    invitation.acceptedAt = new Date();
    invitation.acceptedBy = userId;
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
    } catch {}

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

    if (isAutoApproval) {
      const created = await this.create(dto.organizationId, {
        displayName: app.name,
        email: app.email,
        website: app.website,
        programId: app.programId,
      }, 'system-auto-approval', true);

      return {
        success: true,
        autoApproved: true,
        status: ApplicationStatus.APPROVED,
        message: 'Application automatically approved! Welcome to the program.',
        applicationId: app.id,
        ...created,
      };
    }

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
    if (invitation.status === AffiliateInvitationStatus.REVOKED || invitation.revokedAt) throw new BadRequestException('This invitation is no longer valid.');
    if (invitation.status === AffiliateInvitationStatus.ACCEPTED || invitation.acceptedAt) throw new BadRequestException("You've already joined this program.");
    if (invitation.status === AffiliateInvitationStatus.DECLINED) throw new BadRequestException('This invitation was declined.');
    if (new Date(invitation.expiresAt) <= new Date()) {
      invitation.status = AffiliateInvitationStatus.EXPIRED;
      throw new BadRequestException('This invitation has expired.');
    }
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

  private serializeInvitationForAffiliate(invitation: any) {
    const organization = dbStore.organizations.find((item) => item.id === invitation.organizationId);
    const program = dbStore.programs.find((item) => item.id === invitation.programId);
    const serialized = this.serializeInvitation(invitation);
    const commissionValue = invitation.commissionOverrideValue ?? program?.defaultCommissionValue ?? 0;
    const commissionType = invitation.commissionOverrideType ?? program?.commissionType;
    const commissionSummary = commissionType === InvitationCommissionType.PERCENTAGE
      ? `${commissionValue / 100}% Recurring`
      : `${program?.currency || 'USD'} ${(commissionValue / 100).toFixed(2)} per conversion`;

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

      // Tier strictly based on real DB stats
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
          currency: 'USD',
        },
        relationship: {
          isAlreadyEnrolledInOrg,
          enrolledProgramNames,
          isEnrolledInProgram,
          hasPendingInvitation,
          pendingInvitationProgramName,
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
}
