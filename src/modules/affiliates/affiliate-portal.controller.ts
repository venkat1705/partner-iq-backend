import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { dbStore, IdempotencyKeyEntity } from '../../database/store';
import { AffiliateStatus, TrackingLinkStatus, EnvironmentType, PayoutStatus, ProgramStatus, ConversionStatus, CommissionType, AuditAction } from '../../common/enums';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { MediaService } from '../media/media.service';
import { UploadImageDto } from '../media/dto/media.dto';
import { SecurityUtils } from '../../common/utils/security.utils';
import {
  PAYOUT_SCHEDULE_TIMEZONE,
  resolveNextPayoutDate,
} from '../../common/utils/payout-schedule.utils';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { initializeDataSource } from '../../database/data-source';
import {
  User,
  UserIdentity,
  AuthSession,
  Affiliate,
  AffiliatePortalProfile,
  AffiliatePayoutMethod,
  AffiliateSupportTicket,
  AffiliateInvitation,
  Program,
  ProgramAffiliate,
  Organization,
  OrganizationBranding,
  TrackingLink,
  Click,
  Conversion,
  Commission,
  PayoutBatch,
  PayoutItem,
  BillingCoupon,
  BillingCouponOrganization,
  Asset,
  PartnerTier,
  AffiliateTier,
  AffiliateApplication,
  Milestone,
} from '../../database/schema';
import { IsNull, In } from 'typeorm';
import { UserStatus, PlatformRole } from '../../common/enums';
import { assertUserEligibleForAffiliate } from './affiliate-eligibility.policy';
import { evaluateProfileCompleteness } from './profile-completeness';
import { AffiliatesService } from './affiliates.service';
import { AffiliateAuthService } from './auth/affiliate-auth.service';
import { netCommissionAmount, sumNetCommissions } from '../../common/utils/commission.utils';

@ApiTags('Affiliate Self Portal')
@Controller()
export class AffiliatePortalController {
  constructor(
    @Optional() @Inject(forwardRef(() => AuthService)) private readonly authService?: AuthService,
    @Inject(forwardRef(() => AffiliatesService)) private readonly affiliatesService?: AffiliatesService,
    @Optional()
    @Inject(forwardRef(() => AffiliateAuthService))
    private readonly affiliateAuthService?: AffiliateAuthService,
    @Optional() @Inject(forwardRef(() => MediaService)) private readonly mediaService?: MediaService,
    @Optional() @Inject(forwardRef(() => AuditService)) private readonly auditService?: AuditService,
  ) { }

  private resolveAffiliateEmail(req: any): string {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (email) return email;
    throw new BadRequestException('Authenticated affiliate email is required.');
  }

  private async repositories() {
    const dataSource = await initializeDataSource();
    return {
      users: dataSource.getRepository(User),
      userIdentities: dataSource.getRepository(UserIdentity),
      authSessions: dataSource.getRepository(AuthSession),
      affiliates: dataSource.getRepository(Affiliate),
      affiliatePortalProfiles: dataSource.getRepository(AffiliatePortalProfile),
      affiliatePayoutMethods: dataSource.getRepository(AffiliatePayoutMethod),
      affiliateSupportTickets: dataSource.getRepository(AffiliateSupportTicket),
      affiliateInvitations: dataSource.getRepository(AffiliateInvitation),
      programs: dataSource.getRepository(Program),
      programAffiliates: dataSource.getRepository(ProgramAffiliate),
      organizations: dataSource.getRepository(Organization),
      organizationBrandings: dataSource.getRepository(OrganizationBranding),
      trackingLinks: dataSource.getRepository(TrackingLink),
      clicks: dataSource.getRepository(Click),
      conversions: dataSource.getRepository(Conversion),
      commissions: dataSource.getRepository(Commission),
      payoutBatches: dataSource.getRepository(PayoutBatch),
      payoutItems: dataSource.getRepository(PayoutItem),
      billingCoupons: dataSource.getRepository(BillingCoupon),
      billingCouponOrganizations: dataSource.getRepository(BillingCouponOrganization),
      assets: dataSource.getRepository(Asset),
      partnerTiers: dataSource.getRepository(PartnerTier),
      affiliateTiers: dataSource.getRepository(AffiliateTier),
      affiliateApplications: dataSource.getRepository(AffiliateApplication),
      milestones: dataSource.getRepository(Milestone),
    };
  }


  /** Days covered by a timeRange token, used for both the current and prior window. */
  private static rangeDays(timeRange?: string): number {
    switch (timeRange) {
      case '7d': return 7;
      case '90d': return 90;
      case '1y': return 365;
      default: return 30;
    }
  }

  /**
   * Percentage change between the current window and the one immediately before
   * it, to one decimal place. Returns undefined when there is no prior activity
   * to compare against — the card then shows no trend rather than a fabricated
   * one, which is what "+14.2%" used to be regardless of the real numbers.
   */
  private static pctChange(current: number, previous: number): number | undefined {
    if (!previous) return undefined;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  private static sumInWindow<T>(
    rows: T[],
    from: Date,
    to: Date,
    value: (row: T) => number,
    dateOf: (row: T) => any = (row: any) => row.createdAt,
  ): number {
    return rows.reduce((sum, row) => {
      const at = new Date(dateOf(row));
      return at >= from && at < to ? sum + value(row) : sum;
    }, 0);
  }

  private async resolveAffiliateUser(req: any) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const { users } = await this.repositories();
    const user = (userId ? await users.findOne({ where: { id: userId, deletedAt: IsNull() } }) : null)
      || await users.findOne({ where: { email, deletedAt: IsNull() } });
    return {
      user: user || {
        id: userId || `aff_user_${email}`,
        email,
        firstName: 'Partner',
        lastName: 'User',
        createdAt: new Date(),
      } as any,
      email,
    };
  }

  private async resolveAffiliateProfile(req: any) {
    const { user, email } = await this.resolveAffiliateUser(req);
    const { affiliatePortalProfiles } = await this.repositories();
    const userId = user.id || req.user?.userId || req.user?.sub;

    let profile = await affiliatePortalProfiles.findOne({ where: { userId } });
    if (!profile) {
      profile = affiliatePortalProfiles.create({
        userId,
        email,
        fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || email.split('@')[0],
        website: '',
        phone: '',
        // Left blank on purpose. These are facts only the partner can supply,
        // and seeding them with platform guesses would make a brand-new profile
        // register as complete. The serializer still substitutes display
        // defaults on read, so nothing downstream sees an empty value.
        country: '',
        partnerType: '',
        primaryMarket: '',
        audienceSize: '',
        socialProfiles: {},
        bio: '',
        onboardingCompleted: false,
        taxCountry: '',
        panOrTaxId: '',
        taxClassification: '',
        withholdingRate: 0,
        taxVerified: false,
        taxFormType: 'PAN_TDS',
      });
      profile = await affiliatePortalProfiles.save(profile);
    } else if (profile.email !== email) {
      profile.email = email;
      profile = await affiliatePortalProfiles.save(profile);
    }

    return { user, email, profile };
  }

  private async serializeAffiliateProfile(req: any) {
    const { user, profile } = await this.resolveAffiliateProfile(req);
    const { userIdentities } = await this.repositories();
    const isOnboarded = Boolean(
      profile.onboardingCompleted ?? (profile.primaryMarket && (profile.bio || profile.website))
    );

    const googleIdentity = user?.id
      ? await userIdentities.findOne({ where: { userId: user.id, provider: 'GOOGLE' } })
      : null;

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email.split('@')[0],
        avatarUrl: user.avatarUrl || '',
        is2faEnabled: Boolean((user as any).mfa?.enabled || (user as any).mfaEnabled),
        googleConnected: Boolean(googleIdentity),
        hasPassword: Boolean((user as any).passwordHash),
        createdAt: user.createdAt,
      },
      profile: {
        id: profile.id || `aff_profile_${user.id}`,
        userId: user.id,
        website: profile.website || '',
        phone: profile.phone || '',
        country: profile.country || 'India',
        partnerType: profile.partnerType || 'AFFILIATE',
        primaryMarket: profile.primaryMarket || 'India',
        audienceSize: profile.audienceSize || '0-1k',
        socialProfiles: profile.socialProfiles || {},
        bio: profile.bio || '',
        onboardingCompleted: isOnboarded,
        createdAt: profile.createdAt || user.createdAt,
      },
      taxProfile: this.serializeTaxProfile(profile),
    };
  }

  private serializeTaxProfile(profile: AffiliatePortalProfile) {
    return {
      userId: profile.userId,
      country: profile.taxCountry || profile.country || 'India',
      panOrTaxId: profile.panOrTaxId || '',
      taxClassification: profile.taxClassification || 'INDIVIDUAL',
      withholdingRate: profile.withholdingRate || 0,
      isVerified: Boolean(profile.taxVerified),
      formType: profile.taxFormType || 'PAN_TDS',
      submittedAt: profile.taxSubmittedAt ? profile.taxSubmittedAt.toISOString() : '',
    };
  }

  private serializePayoutMethod(method: AffiliatePayoutMethod) {
    return {
      id: method.id,
      userId: method.userId,
      type: method.type,
      isDefault: method.isDefault,
      bankName: method.bankName,
      accountNumberMasked: method.accountNumberMasked,
      ifscCode: method.ifscCode,
      accountHolderName: method.accountHolderName || '',
      upiIdMasked: method.upiIdMasked,
      paypalEmailMasked: method.paypalEmailMasked,
      authorizedOrgIds: method.authorizedOrgIds || ['*'],
      createdAt: method.createdAt?.toISOString?.() || method.createdAt,
    };
  }

  private pickProfileUpdates(body: any) {
    const updates: Record<string, any> = {};
    ['website', 'phone', 'country', 'partnerType', 'primaryMarket', 'audienceSize', 'bio', 'onboardingCompleted'].forEach((key) => {
      if (body[key] !== undefined) updates[key] = typeof body[key] === 'string' ? body[key].trim() : body[key];
    });
    if (body.socialProfiles && typeof body.socialProfiles === 'object') {
      updates.socialProfiles = body.socialProfiles;
    }
    return updates;
  }

  private async resolveAffiliatesForUser(email: string, userId?: string) {
    const { affiliates } = await this.repositories();
    const normalized = email.toLowerCase().trim();
    const qb = affiliates.createQueryBuilder('affiliate');
    if (userId) {
      qb.where('(LOWER(affiliate.email) = :email OR affiliate.userId = :userId)', { email: normalized, userId });
    } else {
      qb.where('LOWER(affiliate.email) = :email', { email: normalized });
    }
    const list = await qb.getMany();
    if (userId && list.length > 0) {
      const missingUserId = list.filter((a) => !a.userId);
      if (missingUserId.length > 0) {
        for (const a of missingUserId) {
          a.userId = userId;
          try {
            await affiliates.save(a);
          } catch { }
        }
      }
    }
    return list;
  }

  // ----------------------------------------------------
  // Affiliate Auth — Register
  // ----------------------------------------------------
  /**
   * Legacy affiliate registration.
   *
   * This used to be a second, independent registration implementation: it
   * accepted 8-character passwords where the canonical path requires 12, wrote
   * its own profile row, and knew nothing about invitation binding or legal
   * acceptance. Anything posting here could sidestep every control on the real
   * registration path.
   *
   * No client calls it, so rather than leave a weaker duplicate reachable, the
   * route now delegates to the canonical `AffiliateAuthService.register`. The
   * URL keeps working for any caller we do not know about, and gets the same
   * checks as everyone else.
   */
  @Post('api/v1/affiliate/legacy/auth/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new affiliate account (delegates to the canonical flow)' })
  async affiliateRegister(@Body() body: any, @Req() req: any) {
    if (!this.affiliateAuthService) {
      throw new BadRequestException('Affiliate registration is unavailable.');
    }

    const result = await this.affiliateAuthService.register(
      {
        fullName: body?.fullName,
        email: body?.email,
        password: body?.password,
        partnerType: body?.partnerType,
        country: body?.country,
        website: body?.website,
        invitationToken: body?.invitationToken,
        termsAccepted: body?.termsAccepted,
      },
      req.headers['user-agent'],
      req.ip || req.headers['x-forwarded-for'],
    );

    return { success: true, data: result };
  }

  @Get('api/v1/affiliate/me/profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current affiliate user profile' })
  async getProfile(@Req() req: any) {
    return this.serializeAffiliateProfile(req);
  }

  /**
   * Authoritative profile-completion state for the signed-in partner.
   *
   * The portal gates restricted features on this rather than on its own view of
   * the profile: the serialized profile substitutes display defaults for unset
   * fields, so only the server can tell a supplied value from a placeholder.
   */
  @Get('api/v1/affiliate/me/profile-completeness')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Profile completion state computed from persisted data' })
  async getProfileCompleteness(@Req() req: any) {
    const { user, profile } = await this.resolveAffiliateProfile(req);
    const { affiliatePayoutMethods } = await this.repositories();

    // Scoped to this user's own payout methods; no identifier is taken from the
    // request body.
    const methods = await affiliatePayoutMethods.find({ where: { userId: user.id } });

    return evaluateProfileCompleteness(user, profile, methods);
  }

  @Post('api/v1/affiliate/me/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload a profile photo for the current affiliate' })
  async uploadAvatar(@Req() req: any, @Body() body: UploadImageDto) {
    if (!this.mediaService) {
      throw new BadRequestException('Image uploads are not available on this deployment.');
    }

    const { user } = await this.resolveAffiliateProfile(req);
    const { users } = await this.repositories();

    // Scoped to the partner's own user id, so one partner's uploads can never
    // land in another's folder. Size and MIME checks live in MediaService.
    const uploaded = await this.mediaService.uploadImage(user.id, {
      ...body,
      purpose: 'affiliate-avatar',
    });

    user.avatarUrl = uploaded.secureUrl;
    await users.save(user);
    const stored = dbStore.users.find((item) => item.id === user.id);
    if (stored) stored.avatarUrl = uploaded.secureUrl;

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    const clientUserAgent = req.headers['user-agent'];

    this.auditService?.log({
      actorType: 'affiliate',
      actorId: user.id,
      action: AuditAction.AFFILIATE_AVATAR_UPLOADED,
      resourceType: 'affiliate_profile',
      resourceId: user.id,
      ipAddress: clientIp,
      userAgent: clientUserAgent,
      metadata: {
        avatarUrl: uploaded.secureUrl,
      },
    });

    return { avatarUrl: uploaded.secureUrl };
  }

  @Patch('api/v1/affiliate/me/profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current affiliate user profile' })
  async updateProfile(@Req() req: any, @Body() body: any) {
    const { user, profile } = await this.resolveAffiliateProfile(req);
    const { users, affiliatePortalProfiles } = await this.repositories();
    const profileUpdates = this.pickProfileUpdates(body || {});
    Object.assign(profile, profileUpdates);
    profile.socialProfiles = {
      ...(profile.socialProfiles || {}),
      ...(profileUpdates.socialProfiles || {}),
    };

    let passwordChanged = false;
    let nameChanged = false;
    if (user && user.id) {
      if (body.fullName) {
        const parts = body.fullName.trim().split(' ');
        user.firstName = parts[0] || user.firstName;
        user.lastName = parts.slice(1).join(' ') || user.lastName;
        nameChanged = true;
      }
      if (body.avatarUrl !== undefined) {
        user.avatarUrl = body.avatarUrl;
      }
      if (body.password) {
        if (body.password.length < 8) {
          throw new BadRequestException('Password must be at least 8 characters long.');
        }
        user.passwordHash = await SecurityUtils.hashPassword(body.password);
        passwordChanged = true;
      }
      await users.save(user);
    }
    await affiliatePortalProfiles.save(profile);

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    const clientUserAgent = req.headers['user-agent'];

    const fieldsUpdated: string[] = Object.keys(profileUpdates);
    if (nameChanged) fieldsUpdated.push('fullName');
    if (body.avatarUrl !== undefined) fieldsUpdated.push('avatarUrl');
    if (passwordChanged) fieldsUpdated.push('password');

    const updatedSummary: Record<string, any> = {};
    if (body.fullName) updatedSummary.fullName = body.fullName;
    if (profileUpdates.partnerType) updatedSummary.partnerType = profileUpdates.partnerType;
    if (profileUpdates.phone) updatedSummary.phone = profileUpdates.phone;
    if (profileUpdates.country) updatedSummary.country = profileUpdates.country;
    if (profileUpdates.primaryMarket) updatedSummary.primaryMarket = profileUpdates.primaryMarket;
    if (profileUpdates.audienceSize) updatedSummary.audienceSize = profileUpdates.audienceSize;
    if (profileUpdates.website) updatedSummary.website = profileUpdates.website;
    if (profileUpdates.bio) updatedSummary.bio = profileUpdates.bio.slice(0, 100);
    if (passwordChanged) updatedSummary.passwordChanged = true;

    this.auditService?.log({
      actorType: 'affiliate',
      actorId: user.id,
      action: AuditAction.AFFILIATE_PROFILE_UPDATED,
      resourceType: 'affiliate_profile',
      resourceId: profile.id,
      ipAddress: clientIp,
      userAgent: clientUserAgent,
      metadata: {
        fieldsUpdated,
        ...updatedSummary,
      },
    });

    return this.serializeAffiliateProfile(req);
  }

  @Get('api/v1/affiliate/me/dashboard')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aggregated affiliate dashboard metrics' })
  async getDashboard(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
    @Query('timeRange') timeRange = '30d',
  ) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    const scopedAffiliates = organizationId ? affiliates.filter((a) => a.organizationId === organizationId) : affiliates;
    const affiliateIds = scopedAffiliates.map((a) => a.id);

    if (affiliateIds.length === 0) {
      return {
        totalEarnings: 0,
        pendingCommission: 0,
        payableCommission: 0,
        paidCommission: 0,
        clicks: 0,
        uniqueVisitors: 0,
        conversions: 0,
        conversionRate: 0,
        revenue: 0,
        trends: { rangeDays: AffiliatePortalController.rangeDays(timeRange) },
        currentTier: {
          name: 'Not enrolled',
          tierLevel: 0,
          minEarnings: 0,
        },
        topLinks: [],
        topPrograms: [],
        recentConversions: [],
        recentPayouts: [],
      };
    }

    const { trackingLinks, clicks: clicksRepo, conversions, commissions, payoutItems, programAffiliates, affiliateTiers, partnerTiers, programs } = await this.repositories();

    const linksQuery = trackingLinks.createQueryBuilder('tl')
      .where('tl.affiliateId IN (:...affiliateIds)', { affiliateIds });
    if (organizationId) {
      linksQuery.andWhere('tl.organizationId = :organizationId', { organizationId });
    }
    const links = await linksQuery.orderBy('tl.createdAt', 'DESC').getMany();

    const convQuery = conversions.createQueryBuilder('c')
      .where('c.affiliateId IN (:...affiliateIds)', { affiliateIds });
    if (organizationId) {
      convQuery.andWhere('c.organizationId = :organizationId', { organizationId });
    }
    const convList = await convQuery.orderBy('c.createdAt', 'DESC').getMany();

    const commQuery = commissions.createQueryBuilder('comm')
      .where('comm.affiliateId IN (:...affiliateIds)', { affiliateIds });
    if (organizationId) {
      commQuery.andWhere('comm.organizationId = :organizationId', { organizationId });
    }
    const commList = await commQuery.orderBy('comm.createdAt', 'DESC').getMany();

    const poList = await payoutItems.createQueryBuilder('po')
      .where('po.affiliateId IN (:...affiliateIds)', { affiliateIds })
      .orderBy('po.createdAt', 'DESC')
      .getMany();

    const progAffs = await programAffiliates.createQueryBuilder('pa')
      .where('pa.affiliateId IN (:...affiliateIds)', { affiliateIds })
      .take(5)
      .getMany();

    // Net of any refund/chargeback clawback — a commission's status only ever becomes
    // REFUNDED/PARTIALLY_REFUNDED/PROCESSING after it was created as APPROVED (commissions
    // are never created in any other status), so summing raw commissionAmount here counted
    // money that was later reversed as still "earned" forever.
    const totalEarnings = commList.reduce(
      (sum, c: any) => sum + netCommissionAmount(c),
      0,
    );
    // Conversions held for fraud review never get a Commission row in the first place (one
    // is only created once the conversion is APPROVED), so filtering commList for a
    // 'PENDING' status here can never match anything — this bucket always showed $0
    // regardless of how much was actually awaiting review. Estimate it from the conversions
    // themselves instead, using each program's default commission rate as a placeholder
    // until the real commission is calculated on approval.
    const pendingConversions = convList.filter((c: any) => c.status === ConversionStatus.PENDING);
    const pendingProgramIds = [...new Set(pendingConversions.map((c: any) => c.programId).filter(Boolean))];
    const pendingPrograms = pendingProgramIds.length
      ? await programs.createQueryBuilder('p').where('p.id IN (:...ids)', { ids: pendingProgramIds }).getMany()
      : [];
    const pendingProgramById = new Map(pendingPrograms.map((p: any) => [p.id, p]));
    const pendingCommission = pendingConversions.reduce((sum, c: any) => {
      const program = pendingProgramById.get(c.programId);
      const commissionValue = program?.defaultCommissionValue ?? 1000; // 10.00% fallback, matches CommissionsService default
      const estimated =
        program?.commissionType === CommissionType.FIXED_AMOUNT
          ? commissionValue
          : Math.round((Number(c.amount || 0) * commissionValue) / 10000);
      return sum + estimated;
    }, 0);
    const payableCommission = commList
      .filter((c: any) => c.status === ConversionStatus.APPROVED)
      .reduce((sum, c: any) => sum + netCommissionAmount(c), 0);
    const paidCommission = poList.reduce((sum, item: any) => sum + Number(item.amount || (item as any).netAmount || 0), 0);
    const clicks = links.reduce((sum, link: any) => sum + Number((link as any).clickCount || (link as any).clicks || 0), 0);

    // Individual click rows, needed because a tracking link only stores a running
    // total — a total cannot be split into "this period" and "the one before".
    const clickQuery = clicksRepo.createQueryBuilder('ck')
      .where('ck.affiliateId IN (:...affiliateIds)', { affiliateIds });
    if (organizationId) {
      clickQuery.andWhere('ck.organizationId = :organizationId', { organizationId });
    }
    const clickList = await clickQuery.getMany();
    // Rejected (fraud-blocked) conversions never earned anything and shouldn't inflate the
    // "Attributed Revenue" shown to the affiliate; pending ones are kept since they're real,
    // just not yet confirmed — mirroring pendingCommission above.
    const attributedConvList = convList.filter((c: any) => c.status !== ConversionStatus.REJECTED);
    const revenue = attributedConvList.reduce((sum, conversion: any) => sum + Number(conversion.amount || (conversion as any).value || 0), 0);

    // Real current tier — the highest tier held across the affiliate's (possibly
    // multi-org) enrollments, not a hardcoded "Standard Partner" placeholder.
    let currentTier: { id: string; name: string; code: string; tierLevel: number; icon?: string; badge?: string; colorToken?: string } | null = null;
    for (const aff of scopedAffiliates) {
      const affTier = await affiliateTiers.findOne({ where: { organizationId: aff.organizationId, affiliateId: aff.id } });
      if (!affTier?.currentTierId) continue;
      const tierDef = await partnerTiers.findOne({ where: { id: affTier.currentTierId } });
      if (!tierDef) continue;
      if (!currentTier || tierDef.level > currentTier.tierLevel) {
        currentTier = {
          id: tierDef.id,
          name: tierDef.name,
          code: tierDef.code,
          tierLevel: tierDef.level,
          icon: tierDef.icon,
          badge: tierDef.badge,
          colorToken: tierDef.colorToken,
        };
      }
    }

    // Two equal, adjacent windows: [prevFrom, from) and [from, now]. Everything
    // compared below is measured the same way on both sides.
    const days = AffiliatePortalController.rangeDays(timeRange);
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const prevFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000);

    const netCommission = (c: any) => Number(c.amount || c.commissionAmount || 0) - Number(c.reversedAmount || 0);
    const conversionValue = (c: any) => Number(c.amount || c.value || 0);
    const one = () => 1;

    const currentEarnings = AffiliatePortalController.sumInWindow(commList, from, now, netCommission);
    const previousEarnings = AffiliatePortalController.sumInWindow(commList, prevFrom, from, netCommission);
    const currentRevenue = AffiliatePortalController.sumInWindow(attributedConvList, from, now, conversionValue);
    const previousRevenue = AffiliatePortalController.sumInWindow(attributedConvList, prevFrom, from, conversionValue);
    const currentClicks = AffiliatePortalController.sumInWindow(clickList, from, now, one);
    const previousClicks = AffiliatePortalController.sumInWindow(clickList, prevFrom, from, one);
    const currentConversions = AffiliatePortalController.sumInWindow(convList, from, now, one);
    const previousConversions = AffiliatePortalController.sumInWindow(convList, prevFrom, from, one);

    const currentRate = currentClicks > 0 ? (currentConversions / currentClicks) * 100 : 0;
    const previousRate = previousClicks > 0 ? (previousConversions / previousClicks) * 100 : 0;

    // Real distinct visitors, not a fixed 82% of clicks.
    const uniqueVisitors = new Set(
      clickList.map((c: any) => c.anonymousId || c.ipHash).filter(Boolean),
    ).size;

    return {
      totalEarnings,
      pendingCommission,
      payableCommission,
      paidCommission,
      clicks,
      uniqueVisitors,
      conversions: convList.length,
      conversionRate: clicks > 0 ? Number(((convList.length / clicks) * 100).toFixed(2)) : 0,
      revenue,
      /**
       * Period-over-period movement for the cards that show a trend. Each key is
       * undefined when the prior window had nothing to compare against, so the UI
       * can omit the indicator instead of inventing one.
       */
      trends: {
        rangeDays: days,
        earnings: AffiliatePortalController.pctChange(currentEarnings, previousEarnings),
        revenue: AffiliatePortalController.pctChange(currentRevenue, previousRevenue),
        clicks: AffiliatePortalController.pctChange(currentClicks, previousClicks),
        conversions: AffiliatePortalController.pctChange(currentConversions, previousConversions),
        conversionRate: AffiliatePortalController.pctChange(currentRate, previousRate),
      },
      currentTier: currentTier || {
        name: 'Bronze',
        tierLevel: 1,
        minEarnings: 0,
      },
      topLinks: links.slice(0, 5),
      topPrograms: progAffs,
      recentConversions: convList.slice(0, 5),
      recentPayouts: poList.slice(0, 5),
    };
  }

  // ----------------------------------------------------
  // Partnerships / Joined Organizations
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/partnerships')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all organization partnerships for current affiliate' })
  async getPartnerships(@Req() req: any) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    if (affiliates.length === 0) return [];

    const orgIds = affiliates.map((a) => a.organizationId).filter(Boolean);
    const {
      organizations,
      organizationBrandings,
      programAffiliates,
      trackingLinks,
      conversions,
      commissions,
      payoutItems,
      affiliateTiers,
      partnerTiers,
      programs,
    } = await this.repositories();

    const orgList = orgIds.length > 0 ? await organizations.createQueryBuilder('o')
      .where('o.id IN (:...orgIds) AND o.deletedAt IS NULL', { orgIds })
      .getMany() : [];

    // load brandings for the organizations
    const brandingList = orgIds.length > 0 ? await organizationBrandings.find({ where: { organizationId: In(orgIds) } }) : [];
    const brandingMap: Record<string, any> = {};
    for (const b of brandingList) brandingMap[b.organizationId] = b;

    const partnerships = [];

    for (const aff of affiliates) {
      let org = orgList.find((o) => o.id === aff.organizationId);
      if (!org && aff.organizationId) {
        org = await organizations.findOne({ where: { id: aff.organizationId } }) as any;
        if (!org) {
          org = {
            id: aff.organizationId,
            name: aff.displayName || 'Partner Brand',
            slug: 'partner-brand',
            status: 'ACTIVE',
            defaultCurrency: PLATFORM_CURRENCY,
          } as any;
        }
      }
      if (!org) continue;

      const progAffs = await programAffiliates.find({
        where: { organizationId: org.id, affiliateId: aff.id },
      });

      const links = await trackingLinks.find({
        where: { organizationId: org.id, affiliateId: aff.id },
      });

      const convs = await conversions.find({
        where: { organizationId: org.id, affiliateId: aff.id },
      });

      const comms = await commissions.find({
        where: { organizationId: org.id, affiliateId: aff.id },
      });

      const pos = await payoutItems.find({
        where: { affiliateId: aff.id },
      });

      const totalClicks = links.reduce((acc, l: any) => acc + Number(l.clickCount || l.clicks || 0), 0);
      // See getDashboard() above for why these need to be net-of-reversal / estimated from
      // pending conversions rather than filtered by commission status — the same duplicated
      // aggregation bug (commissions are never created with status 'PENDING', so that filter
      // always matched nothing; and raw commissionAmount ignores later refunds/chargebacks).
      const totalEarnings = comms.reduce(
        (acc, c: any) => acc + (Number(c.amount || c.commissionAmount || 0) - Number(c.reversedAmount || 0)),
        0,
      );
      const pendingConvs = convs.filter((c: any) => c.status === ConversionStatus.PENDING);
      const pendingProgIds = [...new Set(pendingConvs.map((c: any) => c.programId).filter(Boolean))];
      const pendingProgs = pendingProgIds.length
        ? await programs.createQueryBuilder('p').where('p.id IN (:...ids)', { ids: pendingProgIds }).getMany()
        : [];
      const pendingProgById = new Map(pendingProgs.map((p: any) => [p.id, p]));
      const pendingCommission = pendingConvs.reduce((acc, c: any) => {
        const prog = pendingProgById.get(c.programId);
        const commissionValue = prog?.defaultCommissionValue ?? 1000; // 10.00% fallback, matches CommissionsService default
        const estimated =
          prog?.commissionType === CommissionType.FIXED_AMOUNT
            ? commissionValue
            : Math.round((Number(c.amount || 0) * commissionValue) / 10000);
        return acc + estimated;
      }, 0);
      const payableCommission = comms
        .filter((c: any) => c.status === ConversionStatus.APPROVED)
        .reduce((acc, c: any) => acc + netCommissionAmount(c), 0);
      const paidCommission = pos.reduce((acc, p: any) => acc + Number(p.amount || (p as any).netAmount || 0), 0);
      const attributedRevenue = convs
        .filter((c: any) => c.status !== ConversionStatus.REJECTED)
        .reduce((acc, c: any) => acc + Number(c.amount || (c as any).value || 0), 0);

      const affTier = await affiliateTiers.findOne({
        where: { organizationId: org.id, affiliateId: aff.id },
      });
      const tierDef = affTier?.currentTierId
        ? await partnerTiers.findOne({ where: { id: affTier.currentTierId } })
        : null;

      partnerships.push({
        id: `orgaff_${org.id}`,
        organizationId: org.id,
        affiliateProfileId: aff.id,
        status: aff.status === AffiliateStatus.ACTIVE ? 'APPROVED' : (aff.status === AffiliateStatus.PENDING ? 'UNDER_REVIEW' : aff.status),
        joinedAt: aff.createdAt,
        totalEarnings,
        pendingCommission,
        payableCommission,
        paidCommission,
        clicks: totalClicks,
        conversions: convs.length,
        attributedRevenue,
        activeProgramsCount: progAffs.length || 1,
        currentTierName: tierDef?.name || 'Standard Partner',
        onboardingStepsCompleted: {
          profile: true,
          payoutMethod: true,
          taxInfo: true,
          termsReviewed: true,
          linkGenerated: links.length > 0,
        },
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          subdomain: org.slug,
          currency: (org as any).defaultCurrency || (org as any).currency || PLATFORM_CURRENCY,
          industry: (org as any).industry || 'Software',
          description: (org as any).description || `${org.name} Official Partner Network`,
          branding: {
            primaryColor: (brandingMap[org.id]?.primaryColor) || (org.slug === 'zenpay' ? '158 64% 40%' : '221 83% 53%'),
            accentColor: (brandingMap[org.id]?.secondaryColor) || (org.slug === 'zenpay' ? '173 80% 36%' : '262 83% 58%'),
            logoUrl: (brandingMap[org.id]?.logoUrl) || (org.slug === 'zenpay'
              ? 'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=120&auto=format&fit=crop&q=80'
              : 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80'),
            coverImageUrl: (brandingMap[org.id]?.heroImageUrl),
            headline: (brandingMap[org.id]?.heroTitle) || `Partner with ${org.name}`,
            tagline: (brandingMap[org.id]?.heroDescription) || `Earn competitive recurring commissions with ${org.name}.`,
          },
        },
      });
    }

    return partnerships;
  }

  // ----------------------------------------------------
  // Programs
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/programs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List programs available to or joined by current affiliate' })
  async getPrograms(@Req() req: any, @Query('organizationId') organizationId?: string) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    const { programs, organizations, programAffiliates, partnerTiers, affiliateApplications } = await this.repositories();

    const programList = await programs.find({
      where: {
        deletedAt: IsNull(),
        ...(organizationId ? { organizationId } : {}),
      },
    });

    const orgIds = [...new Set(programList.map((p) => p.organizationId))];
    const orgList = orgIds.length ? await organizations.find({ where: { id: In(orgIds) } }) : [];

    const programAffList = affiliates.length
      ? await programAffiliates.find({ where: { affiliateId: In(affiliates.map((a) => a.id)) } })
      : [];

    let dbApps: any[] = [];
    try {
      dbApps = await affiliateApplications.find({ where: { email: email.toLowerCase().trim() } });
    } catch { }
    const memApps = dbStore.affiliateApplications.filter(
      (a) => a.email.toLowerCase().trim() === email.toLowerCase().trim()
    );
    const allUserApps = [...memApps, ...dbApps];

    const allTiers = orgIds.length
      ? await partnerTiers.find({ where: { organizationId: In(orgIds), isActive: true, deletedAt: IsNull() } })
      : [];

    return programList.map((p) => {
      const org = orgList.find((o) => o.id === p.organizationId);
      const aff = affiliates.find((a) => a.organizationId === p.organizationId);
      const progAff = aff ? programAffList.find((pa) => pa.programId === p.id && pa.affiliateId === aff.id) : null;
      const userApp = allUserApps.find((a) => a.programId === p.id);
      const isFlat = (p as any).commissionType === 'FIXED_AMOUNT';
      const rate = p.defaultCommissionValue ? (isFlat ? p.defaultCommissionValue / 100 : p.defaultCommissionValue / 100) : 20;

      const tiers = allTiers
        .filter((t) => t.organizationId === p.organizationId && (!t.programId || t.programId === p.id))
        .map((t) => ({
          id: t.id,
          name: t.name,
          minMonthlyRevenue: (t.conditions as any)?.minimumRevenue || 0,
          commissionRateBonus: t.commissionRateOverride ? (t.commissionRateOverride - (p.defaultCommissionValue || 1500)) / 100 : 0,
          // Only facts drawn from the tier record itself. The third entry used to
          // promise "Automated monthly payouts" regardless of what the program
          // actually scheduled.
          perks: [
            `${(t.conditions as any)?.minimumConversions || 0}+ conversions threshold`,
            t.description,
          ].filter((perk): perk is string => !!perk),
        }));

      return {
        id: p.id,
        organizationId: p.organizationId,
        organizationName: org?.name,
        name: p.name,
        slug: p.slug,
        description: (p as any).description || `Official ${p.name} for content creators and partners.`,
        type: (p as any).type || 'RECURRING',
        commissionSummary: isFlat ? `₹${rate} per activation` : `${rate}% recurring lifetime`,
        commissionRate: rate,
        isFlat,
        attributionWindowDays: p.cookieDurationDays || 60,
        cookieLifetimeDays: p.cookieDurationDays || 60,
        isPublic: true,
        featured: (p as any).featured || false,
        category: (p as any).category || 'Software & Tech',
        landingPageUrl: (p as any).landingPageUrl || (org?.website ? `${org.website}/partners` : 'https://partneriq.in'),
        termsAndConditions: (p as any).termsAndConditions || 'Brand bidding on search ads is strictly prohibited.',
        affiliateApprovalMode: p.affiliateApprovalMode || 'AUTO',
        applicationStatus: userApp?.status || (progAff ? (progAff.status === 'ACTIVE' ? 'APPROVED' : 'PENDING') : null),
        applicationId: userApp?.id || null,
        // Settlement terms the partner is actually bound by. The portal showed a
        // fixed "15th Monthly" and no threshold; these are the real per-program
        // values the organization configured.
        payoutSchedule: p.payoutSchedule || null,
        payoutDay: p.payoutDay || null,
        minimumPayoutAmount: Number(p.minimumPayoutAmount || 0),
        currency: p.currency || PLATFORM_CURRENCY,
        // Computed server-side from those terms so the portal and any
        // notification quote the same date. Null when the terms do not pin the
        // run to a calendar date, e.g. a pay-on-request program.
        nextPayoutDate: resolveNextPayoutDate({
          payoutSchedule: p.payoutSchedule,
          payoutDay: p.payoutDay,
        }),
        payoutTimezone: PAYOUT_SCHEDULE_TIMEZONE,
        // No invented tiers: an empty list means this program has none, which is
        // a fact the UI can state, rather than two fabricated ones.
        tiers,
        isEnrolled: !!progAff,
        programAffiliate: progAff ? {
          id: progAff.id,
          status: progAff.status,
          joinedAt: progAff.joinedAt,
          referralCode: progAff.referralCode,
        } : null,
      };
    });
  }

  // ----------------------------------------------------
  // Public Programs Directory (Marketplace)
  // ----------------------------------------------------
  @Get('api/v1/public/programs')
  @ApiOperation({ summary: 'Public marketplace programs' })
  async getPublicPrograms(
    @Query('category') category?: string,
    @Query('organizationId') organizationId?: string,
    @Query('slug') slug?: string,
    @Query('search') search?: string,
  ) {
    const { programs, organizations, organizationBrandings } = await this.repositories();
    let targetOrgId = organizationId;
    if (!targetOrgId && slug) {
      const cleanSlug = slug.toLowerCase().trim();
      const matchedOrg = await organizations.findOne({ where: { slug: cleanSlug } });
      if (matchedOrg) targetOrgId = matchedOrg.id;
    }

    // Public marketplace endpoint:
    // When organizationId/slug is provided, returns that organization's public programs.
    // When omitted, returns all active, public partner programs across the marketplace.
    // In both cases, strictly enforces status = ACTIVE, deletedAt IS NULL, and excludes PRIVATE/UNLISTED programs.
    const whereClause: any = {
      deletedAt: IsNull(),
      status: ProgramStatus.ACTIVE,
      ...(targetOrgId ? { organizationId: targetOrgId } : {}),
    };

    let programList: any[] = [];
    try {
      programList = await programs.find({ where: whereClause, take: 100 });
    } catch {
      programList = [];
    }

    // In-memory / dbStore fallback
    if (!programList.length && dbStore.programs?.length) {
      programList = dbStore.programs.filter((p: any) =>
        !p.deletedAt &&
        p.status === ProgramStatus.ACTIVE &&
        (!targetOrgId || p.organizationId === targetOrgId)
      );
    }

    // Strictly exclude draft, paused, private, and unlisted programs
    programList = programList.filter((p: any) => {
      const v = String(p.visibility || 'PUBLIC').toUpperCase();
      return v !== 'PRIVATE' && v !== 'UNLISTED';
    });

    if (category && category !== 'ALL') {
      const c = category.toLowerCase().trim();
      programList = programList.filter((p: any) => String(p.category || '').toLowerCase().trim() === c);
    }

    if (search && search.trim()) {
      const s = search.toLowerCase().trim();
      programList = programList.filter((p: any) =>
        String(p.name || '').toLowerCase().includes(s) ||
        String(p.description || '').toLowerCase().includes(s)
      );
    }

    const orgIds = [...new Set(programList.map((p) => p.organizationId))];
    let orgList: any[] = [];
    try {
      orgList = orgIds.length ? await organizations.find({ where: { id: In(orgIds) } }) : [];
    } catch {
      orgList = [];
    }
    if (!orgList.length && dbStore.organizations?.length) {
      orgList = dbStore.organizations.filter((o: any) => orgIds.includes(o.id));
    }

    let brandingList: any[] = [];
    try {
      brandingList = orgIds.length ? await organizationBrandings.find({ where: { organizationId: In(orgIds) } }) : [];
    } catch {
      brandingList = [];
    }
    const brandingMap: Record<string, any> = {};
    for (const b of brandingList) brandingMap[b.organizationId] = b;

    const { partnerTiers, milestones } = await this.repositories();
    let tierList: any[] = [];
    let milestoneList: any[] = [];
    try {
      tierList = orgIds.length ? await partnerTiers.find({ where: { organizationId: In(orgIds), isActive: true, deletedAt: IsNull() } }) : [];
    } catch { }
    try {
      milestoneList = orgIds.length ? await milestones.find({ where: { organizationId: In(orgIds), isActive: true } }) : [];
    } catch { }

    return programList.map((p) => this.mapProgramForPublic(p, orgList, brandingMap, tierList, milestoneList));
  }

  @Get('api/v1/public/organizations/:slug/programs')
  @ApiOperation({ summary: 'Public programs for specific organization by slug' })
  async getPublicProgramsByOrg(
    @Param('slug') slug: string,
    @Query('category') category?: string,
  ) {
    return this.getPublicPrograms(category, undefined, slug);
  }

  /**
   * Single public program detail — the marketplace card's click-through target.
   * Reuses the exact same real-data mapping as the list endpoint (mapProgramForPublic)
   * plus the fuller fields (policy/terms, tiers, milestones) a detail page needs, and
   * enforces the same ACTIVE / not-deleted / not-PRIVATE-or-UNLISTED guard so a direct
   * link to a paused or private program 404s instead of leaking its data.
   */
  @Get('api/v1/public/programs/:id')
  @ApiOperation({ summary: 'Public marketplace program detail' })
  async getPublicProgramById(@Param('id') id: string) {
    const { programs, organizations, organizationBrandings, partnerTiers, milestones } = await this.repositories();

    let p: any = null;
    try {
      p = await programs.findOne({ where: { id } });
    } catch { }
    if (!p) {
      p = dbStore.programs.find((prog: any) => prog.id === id);
    }

    if (
      !p ||
      p.deletedAt ||
      p.status !== ProgramStatus.ACTIVE ||
      ['PRIVATE', 'UNLISTED'].includes(String(p.visibility || 'PUBLIC').toUpperCase())
    ) {
      throw new NotFoundException('Program not found');
    }

    let org: any = null;
    try {
      org = await organizations.findOne({ where: { id: p.organizationId } });
    } catch { }
    if (!org) org = dbStore.organizations?.find((o: any) => o.id === p.organizationId);

    let branding: any = null;
    try {
      branding = await organizationBrandings.findOne({ where: { organizationId: p.organizationId } });
    } catch { }
    const brandingMap: Record<string, any> = branding ? { [p.organizationId]: branding } : {};

    let tierList: any[] = [];
    let milestoneList: any[] = [];
    try {
      tierList = await partnerTiers.find({ where: { organizationId: p.organizationId, isActive: true, deletedAt: IsNull() } });
    } catch { }
    try {
      milestoneList = await milestones.find({ where: { organizationId: p.organizationId, isActive: true } });
    } catch { }

    const base = this.mapProgramForPublic(p, org ? [org] : [], brandingMap, tierList, milestoneList);

    return {
      ...base,
      // Detail-only fields not needed on a marketplace tile.
      longDescription: p.description || base.description,
      websiteUrl: p.websiteUrl || null,
      landingUrl: p.landingUrl || null,
      attributionModel: p.attributionModel || null,
      payoutSchedule: p.payoutSchedule || null,
      payoutDay: p.payoutDay || null,
      minimumPayoutAmount: Number(p.minimumPayoutAmount || 0),
      payoutMethods: Array.isArray(p.payoutMethods) ? p.payoutMethods : [],
      tags: Array.isArray(p.tags) ? p.tags : [],
      termsContent: p.termsContent || null,
      termsUrl: p.termsUrl || null,
      privacyPolicyUrl: p.privacyPolicyUrl || null,
      promotionRules: p.promotionRules || null,
      allowedAffiliateTypes: Array.isArray(p.allowedAffiliateTypes) ? p.allowedAffiliateTypes : [],
      tierOverrides: Array.isArray(p.tierOverrides) ? p.tierOverrides : [],
      tiers: tierList
        .filter((t) => !t.programId || t.programId === p.id)
        .map((t) => ({
          id: t.id,
          name: t.name,
          level: t.level,
          colorToken: t.colorToken,
          commissionRateOverride: t.commissionRateOverride ? t.commissionRateOverride / 100 : null,
          fixedCommissionOverride: t.fixedCommissionOverride ? t.fixedCommissionOverride / 100 : null,
        })),
      milestones: milestoneList
        .filter((m) => !m.programId || m.programId === p.id)
        .map((m) => ({
          id: m.id,
          name: m.name,
          metric: m.metric,
          targetValue: m.targetValue,
          rewardType: m.rewardType,
          rewardConfig: m.rewardConfig || null,
          period: m.period,
        })),
    };
  }

  /**
   * Shared public-program mapping used by both the marketplace list and the single-
   * program detail endpoint, so a program never displays differently depending on
   * which endpoint fetched it. Only maps facts the org actually configured — no
   * fabricated rating, no "always featured", no generic tier copy.
   */
  private mapProgramForPublic(p: any, orgList: any[], brandingMap: Record<string, any>, tierList: any[], milestoneList: any[]) {
    const org = orgList.find((o) => o.id === p.organizationId) || dbStore.organizations?.find((o: any) => o.id === p.organizationId);
    const isFlat = (p as any).commissionType === 'FIXED_AMOUNT' || (p as any).commissionType === 'flat';
    const rawVal = p.defaultCommissionValue ?? (p as any).commissionValue ?? 2500;
    // defaultCommissionValue is ALWAYS stored as percent*100 (basis points) for
    // PERCENTAGE/RECURRING_PERCENTAGE, or rupees*100 (paise) for FIXED_AMOUNT — never a
    // bare percent — so the conversion is unconditional. A conditional `>= 100 ? /100 : as-is`
    // here previously corrupted any program with a sub-1% commission (e.g. 50 -> "50%").
    const rate = rawVal / 100;
    const currency = (p as any).currency || (org as any)?.currency || 'INR';
    const currencySymbol = currency === 'INR' ? '₹' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
    // Commission is always stated per qualified conversion — the unit matters, because a bare
    // "25%" or "₹500" on a marketplace tile is what lets a partner assume they are paid for traffic.
    const commissionFormatted = isFlat ? `${currencySymbol}${rate} per conversion` : `${rate}% per conversion`;
    const commissionBasis = isFlat
      ? `${currencySymbol}${rate} for every qualified conversion`
      : `${rate}% of every qualified conversion's value`;
    const brandName = org?.name || (p as any).brandName || 'PartnerIQ Brand';
    const brandLogo = (brandingMap[org?.id]?.logoUrl) || (org as any)?.branding?.logoUrl || (p as any).logoUrl || null;
    const cookieDays = p.cookieDurationDays || (p as any).cookieWindowDays || (p as any).attributionWindowDays || 60;

    // Real tier/milestone summary: only state a fact the org actually configured for
    // THIS program (or org-wide, if the tier/milestone has no programId of its own).
    // No programs configured -> tierRewards is omitted entirely, not a generic string.
    const programTiers = tierList.filter((t) => t.organizationId === p.organizationId && (!t.programId || t.programId === p.id));
    const programMilestones = milestoneList.filter((m) => m.organizationId === p.organizationId && (!m.programId || m.programId === p.id));
    let tierRewards: string | null = null;
    if (programTiers.length > 0) {
      tierRewards = `${programTiers.length} Partner Tier${programTiers.length > 1 ? 's' : ''}`;
    } else if (programMilestones.length > 0) {
      tierRewards = `${programMilestones.length} Milestone Reward${programMilestones.length > 1 ? 's' : ''}`;
    }

    return {
      id: p.id,
      organizationId: p.organizationId,
      brandName,
      brandLogo,
      name: p.name,
      title: p.name,
      slug: p.slug,
      category: (p as any).category || 'SAAS',
      commission: commissionFormatted,
      commissionSummary: commissionFormatted,
      commissionType: isFlat ? 'flat' : 'percentage',
      commissionValue: rate,
      cookieWindow: `${cookieDays} Days`,
      attributionWindowDays: cookieDays,
      cookieDurationDays: cookieDays,
      currency,
      commissionBasis,
      commissionUnit: 'QUALIFIED_CONVERSION',
      /**
       * @deprecated Retained only so older marketplace clients do not break on a missing key.
       * It previously served a hardcoded placeholder figure that read as a guaranteed
       * per-click rate — affiliates are paid per qualified conversion, never per click.
       * Always null; never use it for a calculation or present it as earnings.
       */
      avgEpc: null,
      // Only true when the org actually flagged this program as featured — never a
      // default, since a default of "true" makes every program equally "featured".
      featured: (p as any).featured === true,
      tierRewards,
      affiliateApprovalMode: p.affiliateApprovalMode || 'AUTO',
      instantApproval: p.affiliateApprovalMode === 'AUTO',
      description: (p as any).description || `Earn commission on every qualified conversion you refer to ${brandName}.`,
      status: p.status,
    };
  }

  // ----------------------------------------------------
  // Applications
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/applications')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List program applications submitted by current affiliate' })
  async getMyApplications(@Req() req: any, @Query('organizationId') organizationId?: string) {
    const email = this.resolveAffiliateEmail(req);
    const { affiliateApplications, programs, organizations } = await this.repositories();

    let apps: any[] = [];
    try {
      apps = await affiliateApplications.find({
        where: {
          email: email.toLowerCase().trim(),
          ...(organizationId ? { organizationId } : {}),
        },
        order: { createdAt: 'DESC' },
      });
    } catch { }

    if (!apps.length) {
      apps = dbStore.affiliateApplications.filter(
        (a) => a.email.toLowerCase().trim() === email.toLowerCase().trim() && (!organizationId || a.organizationId === organizationId)
      );
    } else {
      const dbIds = new Set(apps.map((a) => a.id));
      const memoryApps = dbStore.affiliateApplications.filter(
        (a) => a.email.toLowerCase().trim() === email.toLowerCase().trim() && (!organizationId || a.organizationId === organizationId) && !dbIds.has(a.id)
      );
      apps = [...memoryApps, ...apps];
    }

    const progIds = [...new Set(apps.map((a) => a.programId))];
    const orgIds = [...new Set(apps.map((a) => a.organizationId))];
    const progList = progIds.length ? await programs.find({ where: { id: In(progIds) } }) : [];
    const orgList = orgIds.length ? await organizations.find({ where: { id: In(orgIds) } }) : [];

    return apps.map((app) => {
      const prog = progList.find((p) => p.id === app.programId) || dbStore.programs.find((p) => p.id === app.programId);
      const org = orgList.find((o) => o.id === app.organizationId) || dbStore.organizations.find((o) => o.id === app.organizationId);
      const isFlat = (prog as any)?.commissionType === 'FIXED_AMOUNT';
      const rate = prog?.defaultCommissionValue ? (isFlat ? prog.defaultCommissionValue / 100 : prog.defaultCommissionValue / 100) : 20;

      return {
        id: app.id,
        organizationId: app.organizationId,
        organizationName: org?.name || 'Partner Organization',
        programId: app.programId,
        programName: prog?.name || 'Affiliate Program',
        programCategory: (prog as any)?.category || 'SaaS',
        programDescription: (prog as any)?.description || '',
        commissionSummary: isFlat ? `₹${rate} Flat` : `${rate}% Recurring`,
        cookieWindow: `${prog?.cookieDurationDays || 60} Days`,
        affiliateApprovalMode: prog?.affiliateApprovalMode || 'AUTO',
        name: app.name,
        email: app.email,
        website: app.website,
        promotionMethod: app.promotionMethod,
        audienceSize: app.audienceSize,
        country: app.country,
        status: app.status,
        reviewedBy: app.reviewedBy,
        reviewedAt: app.reviewedAt,
        createdAt: app.createdAt,
      };
    });
  }

  @Get('api/v1/affiliate/me/applications/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a specific program application for current affiliate' })
  async getMyApplicationById(@Req() req: any, @Param('id') id: string) {
    const email = this.resolveAffiliateEmail(req);
    const { affiliateApplications, programs, organizations } = await this.repositories();

    let app: any = null;
    try {
      app = await affiliateApplications.findOne({
        where: { id, email: email.toLowerCase().trim() },
      });
    } catch { }

    if (!app) {
      app = dbStore.affiliateApplications.find(
        (a) => a.id === id && a.email.toLowerCase().trim() === email.toLowerCase().trim()
      );
    }

    if (!app) {
      throw new NotFoundException('Application not found');
    }

    const prog = await programs.findOne({ where: { id: app.programId } }) || dbStore.programs.find((p) => p.id === app.programId);
    const org = await organizations.findOne({ where: { id: app.organizationId } }) || dbStore.organizations.find((o) => o.id === app.organizationId);
    const isFlat = (prog as any)?.commissionType === 'FIXED_AMOUNT';
    const rate = prog?.defaultCommissionValue ? (isFlat ? prog.defaultCommissionValue / 100 : prog.defaultCommissionValue / 100) : 20;

    return {
      id: app.id,
      organizationId: app.organizationId,
      organizationName: org?.name || 'Partner Organization',
      programId: app.programId,
      programName: prog?.name || 'Affiliate Program',
      programCategory: (prog as any)?.category || 'SaaS',
      programDescription: (prog as any)?.description || '',
      commissionSummary: isFlat ? `₹${rate} Flat` : `${rate}% Recurring`,
      cookieWindow: `${prog?.cookieDurationDays || 60} Days`,
      affiliateApprovalMode: prog?.affiliateApprovalMode || 'AUTO',
      name: app.name,
      email: app.email,
      website: app.website,
      promotionMethod: app.promotionMethod,
      audienceSize: app.audienceSize,
      country: app.country,
      status: app.status,
      reviewedBy: app.reviewedBy,
      reviewedAt: app.reviewedAt,
      createdAt: app.createdAt,
    };
  }

  // ----------------------------------------------------
  // Tracking Links
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/links')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List tracking links for current affiliate' })
  async getLinks(@Req() req: any, @Query('organizationId') organizationId?: string) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    const affiliateIds = affiliates.map((a) => a.id);
    if (affiliateIds.length === 0) return [];

    const { trackingLinks, programs, organizations, conversions, commissions } = await this.repositories();

    const linkList = await trackingLinks.find({
      where: {
        affiliateId: In(affiliateIds),
        ...(organizationId ? { organizationId } : {}),
      },
      order: { createdAt: 'DESC' },
    });

    const progIds = [...new Set(linkList.map((l) => l.programId).filter(Boolean))];
    const orgIds = [...new Set(linkList.map((l) => l.organizationId).filter(Boolean))];
    const progList = progIds.length ? await programs.find({ where: { id: In(progIds) } }) : [];
    const orgList = orgIds.length ? await organizations.find({ where: { id: In(orgIds) } }) : [];

    const convList = await conversions.find({
      where: { affiliateId: In(affiliateIds) },
    });
    const commList = await commissions.find({
      where: { affiliateId: In(affiliateIds) },
    });

    return linkList.map((l) => {
      const prog = progList.find((p) => p.id === l.programId);
      const org = orgList.find((o) => o.id === l.organizationId);
      const clicks = Number((l as any).clickCount || (l as any).clicks || 0);
      const linkConversions = convList.filter((c: any) => (c.trackingLinkId === l.id || c.metadata?.trackingLinkId === l.id)).length;
      const commissionEarned = commList
        .filter((c: any) => (c.trackingLinkId === l.id || (c as any).linkId === l.id))
        .reduce((acc, c: any) => acc + netCommissionAmount(c), 0);

      return {
        id: l.id,
        organizationId: l.organizationId,
        programId: l.programId,
        programName: prog?.name || 'Partner Program',
        title: (l as any).title || `${prog?.name || 'Referral'} Link`,
        slug: l.shortCode,
        destinationUrl: l.destinationUrl,
        trackingUrl: `https://${org?.slug || 'go'}.partneriq.in/r/${l.shortCode}`,
        customAlias: (l as any).customAlias || l.shortCode,
        campaign: (l as any).campaign || (l as any).campaignId || '',
        subId: l.subId || '',
        clicks,
        uniqueVisitors: Math.round(clicks * 0.82),
        conversions: linkConversions,
        revenue: linkConversions * 120,
        commissionEarned,
        isArchived: l.status !== TrackingLinkStatus.ACTIVE,
        createdAt: l.createdAt,
      };
    });
  }

  @Post('api/v1/affiliate/me/links')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a tracking link' })
  async createLink(@Req() req: any, @Body() body: any) {
    const email = this.resolveAffiliateEmail(req);
    const orgId = body.organizationId;
    if (!orgId || !body.programId) {
      throw new BadRequestException('organizationId and programId are required.');
    }

    const { affiliates, programs, programAffiliates, trackingLinks, organizations } = await this.repositories();

    const affiliate = await affiliates.findOne({
      where: { organizationId: orgId, email: email.toLowerCase().trim() },
    });

    if (!affiliate) {
      throw new BadRequestException('Join this organization as an affiliate before creating links.');
    }

    const prog = await programs.findOne({
      where: { id: body.programId, organizationId: orgId },
    });
    if (!prog) throw new NotFoundException('Program not found');

    const membership = await programAffiliates.findOne({
      where: {
        organizationId: orgId,
        programId: prog.id,
        affiliateId: affiliate.id,
        status: AffiliateStatus.ACTIVE,
      },
    });
    if (!membership) {
      throw new BadRequestException('You must be an active member of this program before creating links.');
    }

    const shortCode = body.slug || body.customAlias || SecurityUtils.generateRandomCode(8).toLowerCase();

    // Reject any destination that isn't a plain http(s) URL — otherwise an affiliate could
    // register a tracking link (or reachable via the public /r/:code redirect) pointing at a
    // javascript: URI or other dangerous scheme to attack visitors who click it.
    const resolvedDestinationUrl = body.destinationUrl || (prog as any)?.landingPageUrl || '';
    if (resolvedDestinationUrl) {
      let isValidHttpUrl = false;
      try {
        const parsed = new URL(resolvedDestinationUrl);
        isValidHttpUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        isValidHttpUrl = false;
      }
      if (!isValidHttpUrl) {
        throw new BadRequestException('destinationUrl must be a valid http:// or https:// URL.');
      }
    }

    const link = trackingLinks.create({
      id: uuidv4(),
      organizationId: orgId,
      environment: EnvironmentType.LIVE,
      programId: prog.id,
      affiliateId: affiliate.id,
      destinationUrl: resolvedDestinationUrl,
      shortCode,
      status: TrackingLinkStatus.ACTIVE,
      subId: body.subId,
      campaignId: body.campaign || body.campaignId,
    });
    (link as any).title = body.title || 'Custom Tracking Link';
    (link as any).customAlias = body.customAlias;

    const saved = await trackingLinks.save(link);

    if (dbStore.trackingLinks) {
      dbStore.trackingLinks.unshift(saved as any);
    }

    this.auditService?.log({
      organizationId: orgId,
      actorType: 'affiliate',
      actorId: affiliate.userId || affiliate.id,
      action: AuditAction.AFFILIATE_LINK_CREATED,
      resourceType: 'tracking_link',
      resourceId: saved.id,
      metadata: {
        programId: prog.id,
        programName: prog.name,
        shortCode: saved.shortCode,
        affiliateId: affiliate.id,
      },
    });

    const org = await organizations.findOne({ where: { id: orgId } });
    return {
      id: saved.id,
      organizationId: saved.organizationId,
      programId: saved.programId,
      programName: prog.name,
      title: (saved as any).title,
      slug: saved.shortCode,
      destinationUrl: saved.destinationUrl,
      trackingUrl: `https://${org?.slug || 'go'}.partneriq.in/r/${saved.shortCode}`,
      customAlias: (saved as any).customAlias,
      campaign: (saved as any).campaign || saved.campaignId || '',
      subId: saved.subId || '',
      clicks: 0,
      uniqueVisitors: 0,
      conversions: 0,
      revenue: 0,
      commissionEarned: 0,
      isArchived: false,
      createdAt: saved.createdAt,
    };
  }

  @Delete('api/v1/affiliate/me/links/:linkId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Archive/delete tracking link' })
  async deleteLink(@Req() req: any, @Param('linkId') linkId: string) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    const affiliateIds = affiliates.map((a) => a.id);

    const { trackingLinks } = await this.repositories();
    const link = await trackingLinks.findOne({ where: { id: linkId } });
    if (link && affiliateIds.includes(link.affiliateId)) {
      await trackingLinks.update({ id: linkId }, { status: TrackingLinkStatus.INACTIVE });
      if (dbStore.trackingLinks) {
        const storeLink = dbStore.trackingLinks.find((l) => l.id === linkId);
        if (storeLink) storeLink.status = TrackingLinkStatus.INACTIVE;
      }
      this.auditService?.log({
        organizationId: link.organizationId,
        actorType: 'affiliate',
        actorId: link.affiliateId,
        action: AuditAction.AFFILIATE_LINK_DELETED,
        resourceType: 'tracking_link',
        resourceId: link.id,
        metadata: {
          affiliateId: link.affiliateId,
          programId: link.programId,
        },
      });
    }
    return { success: true };
  }

  // ----------------------------------------------------
  // Program Default Tracking Links
  //
  // A single, auto-generated canonical link per (affiliate, program) — the
  // "View Links" flow on the programs page. Distinct from the free-form
  // custom links above (title/alias/campaign/subId), which affiliates still
  // create by hand via POST /affiliate/me/links.
  // ----------------------------------------------------

  /**
   * Resolves and authorizes the (program, affiliate, membership) context for
   * the endpoints below. organizationId/affiliateId are never taken from the
   * request — both are derived from the JWT-resolved affiliate identity and
   * the program's own organizationId, so one affiliate can never address
   * another affiliate's or another organization's data by guessing IDs.
   */
  private async resolveAffiliateProgramContext(req: any, programId: string) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);

    const { programs, programAffiliates } = await this.repositories();

    const program = await programs.findOne({ where: { id: programId, deletedAt: IsNull() } });
    if (!program) {
      throw new NotFoundException('Program not found');
    }

    const affiliate = affiliates.find((a) => a.organizationId === program.organizationId);
    if (!affiliate) {
      throw new ForbiddenException('You are not a member of this organization.');
    }

    if (program.status !== ProgramStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'PROGRAM_NOT_ACTIVE',
        message: 'This program is not currently accepting new tracking links.',
      });
    }

    const membership = await programAffiliates.findOne({
      where: { organizationId: program.organizationId, programId: program.id, affiliateId: affiliate.id },
    });
    if (!membership || membership.status !== AffiliateStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'AFFILIATE_NOT_APPROVED_FOR_PROGRAM',
        message: 'You must be an approved, active member of this program to view or generate its tracking links.',
      });
    }

    return { program, affiliate, environment: EnvironmentType.LIVE };
  }

  private serializeProgramLink(link: TrackingLink, program: Program, orgSlug?: string) {
    return {
      id: link.id,
      destinationName: program.name,
      destinationUrl: link.destinationUrl,
      trackingUrl: `https://${orgSlug || 'go'}.partneriq.in/r/${link.shortCode}`,
      status: link.status,
      createdAt: link.createdAt,
    };
  }

  @Get('api/v1/affiliate/me/programs/:programId/links')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the current affiliate's tracking link(s) for a program" })
  async getProgramLinks(@Req() req: any, @Param('programId') programId: string) {
    const { program, affiliate } = await this.resolveAffiliateProgramContext(req, programId);
    const { trackingLinks, organizations } = await this.repositories();

    const link = await trackingLinks.findOne({
      where: {
        organizationId: program.organizationId,
        programId: program.id,
        affiliateId: affiliate.id,
        linkKind: 'PROGRAM_DEFAULT',
      },
    });

    const org = await organizations.findOne({ where: { id: program.organizationId } });

    return {
      success: true,
      data: {
        programId: program.id,
        links: link ? [this.serializeProgramLink(link, program, org?.slug)] : [],
      },
    };
  }

  @Post('api/v1/affiliate/me/programs/:programId/links')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Generate (or retrieve) the current affiliate's canonical tracking link for a program" })
  async createProgramLink(
    @Req() req: any,
    @Param('programId') programId: string,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
  ) {
    const { program, affiliate, environment } = await this.resolveAffiliateProgramContext(req, programId);
    const { trackingLinks, organizations } = await this.repositories();

    const idempotencyKey = (idempotencyKeyHeader || '').trim();
    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 255)) {
      throw new BadRequestException('Idempotency-Key must be between 8 and 255 characters.');
    }

    // The logical operation is fully determined by who is asking and for what
    // program — there is no other client-suppliable input — so the hash keys
    // off exactly those three server-resolved values.
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ organizationId: program.organizationId, programId: program.id, affiliateId: affiliate.id }))
      .digest('hex');

    if (idempotencyKey) {
      const existingKey = dbStore.idempotencyKeys.find(
        (k) =>
          k.organizationId === program.organizationId &&
          (k as any).environment === environment &&
          !(k as any).apiKeyId &&
          k.key === idempotencyKey &&
          k.expiresAt > new Date(),
      );
      if (existingKey) {
        if (existingKey.requestHash !== requestHash) {
          // Same key, different logical request (e.g. a different affiliate or
          // program) — reject rather than silently returning the wrong payload.
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'This Idempotency-Key was already used for a different request.',
          });
        }
        return existingKey.responseBody;
      }
    }

    const org = await organizations.findOne({ where: { id: program.organizationId } });
    const affiliateProgramDefaultKey = `${program.organizationId}:${environment}:${program.id}:${affiliate.id}`;

    let link = await trackingLinks.findOne({
      where: {
        organizationId: program.organizationId,
        programId: program.id,
        affiliateId: affiliate.id,
        linkKind: 'PROGRAM_DEFAULT',
      },
    });

    if (!link) {
      const destinationUrl = program.landingUrl || program.websiteUrl || (org?.website ? `${org.website}/partners` : '');
      let isValidHttpUrl = false;
      try {
        const parsed = new URL(destinationUrl);
        isValidHttpUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        isValidHttpUrl = false;
      }
      if (!isValidHttpUrl) {
        throw new BadRequestException('This program has no valid landing page configured to generate a link for.');
      }

      const created = trackingLinks.create({
        id: uuidv4(),
        organizationId: program.organizationId,
        environment,
        programId: program.id,
        affiliateId: affiliate.id,
        destinationUrl,
        shortCode: SecurityUtils.generateRandomCode(10).toLowerCase(),
        status: TrackingLinkStatus.ACTIVE,
        linkKind: 'PROGRAM_DEFAULT',
        affiliateProgramDefaultKey,
      });

      try {
        link = await trackingLinks.save(created);
        if (dbStore.trackingLinks) {
          dbStore.trackingLinks.unshift(link as any);
        }
      } catch (err: any) {
        const isDuplicateKey =
          err?.code === 'ER_DUP_ENTRY' || err?.code === '23505' || /duplicate/i.test(err?.message || '');
        if (!isDuplicateKey) throw err;
        // Lost the race to a concurrent request for the same affiliate+program:
        // re-read the row the other request just created instead of failing, so
        // two near-simultaneous clicks never surface an error or produce a
        // second link.
        link = await trackingLinks.findOne({
          where: {
            organizationId: program.organizationId,
            programId: program.id,
            affiliateId: affiliate.id,
            linkKind: 'PROGRAM_DEFAULT',
          },
        });
        if (!link) throw err;
      }
    }

    const responseBody = {
      success: true,
      data: {
        programId: program.id,
        links: [this.serializeProgramLink(link, program, org?.slug)],
      },
    };

    if (idempotencyKey) {
      const ikRecord: IdempotencyKeyEntity = {
        id: uuidv4(),
        organizationId: program.organizationId,
        environment,
        apiKeyId: undefined,
        key: idempotencyKey,
        requestHash,
        responseStatus: 200,
        responseBody,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        createdAt: new Date(),
      };
      dbStore.idempotencyKeys.push(ikRecord);
    }

    return responseBody;
  }

  // ----------------------------------------------------
  // Coupons / Promo Codes
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/coupons')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List coupons for current affiliate' })
  async getCoupons(@Req() req: any, @Query('organizationId') organizationId?: string) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    const orgIds = affiliates.map((a) => a.organizationId);
    if (orgIds.length === 0) return [];

    const scopedOrgIds = organizationId ? orgIds.filter((id) => id === organizationId) : orgIds;
    if (scopedOrgIds.length === 0) return [];

    const { billingCoupons, billingCouponOrganizations } = await this.repositories();
    const couponOrgs = await billingCouponOrganizations.find({
      where: { organizationId: In(scopedOrgIds) },
    });
    const couponIds = [...new Set(couponOrgs.map((co) => co.couponId))];
    const couponList = couponIds.length
      ? await billingCoupons.find({ where: { id: In(couponIds) } })
      : [];

    return couponList.map((c: any) => {
      const co = couponOrgs.find((item) => item.couponId === c.id);
      return {
        id: c.id,
        organizationId: co?.organizationId || scopedOrgIds[0],
        programId: c.programId || '',
        code: c.code,
        discountSummary: c.description || (c.discountType === 'PERCENTAGE' ? `${c.discountValue || 0}% off` : `$${(c.discountValue || 0) / 100} discount`),
        discountType: c.discountType || 'PERCENTAGE',
        discountValue: c.discountValue || 0,
        uses: (c as any).timesRedeemed || 0,
        conversions: (c as any).timesRedeemed || 0,
        revenueGenerated: 0,
        commissionEarned: 0,
        status: c.status || 'ACTIVE',
      };
    });
  }

  // ----------------------------------------------------
  // Marketing Assets
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/assets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List marketing assets for current affiliate' })
  async getAssets(@Req() req: any, @Query('organizationId') organizationId?: string) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    const orgIds = affiliates.map((a) => a.organizationId);
    if (orgIds.length === 0) return [];

    const scopedOrgIds = organizationId ? orgIds.filter((id) => id === organizationId) : orgIds;
    if (scopedOrgIds.length === 0) return [];

    const { assets } = await this.repositories();
    const assetList = await assets.find({
      where: { organizationId: In(scopedOrgIds) },
    });

    return assetList.map((a: any) => ({
      id: a.id,
      organizationId: a.organizationId,
      programId: a.programId,
      title: a.name || a.title || 'Marketing Asset',
      type: a.type || 'BANNER',
      fileSize: (a as any).fileSize || (a as any).sizeBytes,
      dimensions: (a as any).dimensions,
      previewUrl: a.previewUrl || a.fileUrl || '',
      downloadUrl: a.fileUrl || '',
      copyContent: (a as any).copyContent || (a as any).bodyContent || null,
      tags: (a as any).tags || [],
      createdAt: a.createdAt,
    }));
  }

  // ----------------------------------------------------
  // Conversions
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/conversions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List conversions for current affiliate' })
  async getConversions(@Req() req: any, @Query('organizationId') organizationId?: string) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    const affiliateIds = affiliates.map((a) => a.id);
    if (affiliateIds.length === 0) return [];

    const { conversions, programs, trackingLinks, commissions } = await this.repositories();

    const convList = await conversions.find({
      where: {
        affiliateId: In(affiliateIds),
        ...(organizationId ? { organizationId } : {}),
      },
      order: { createdAt: 'DESC' },
    });

    const progIds = [...new Set(convList.map((c) => c.programId).filter(Boolean))];
    const linkIds = [...new Set(convList.map((c) => (c as any).trackingLinkId || c.metadata?.trackingLinkId).filter(Boolean))];
    const progList = progIds.length ? await programs.find({ where: { id: In(progIds) } }) : [];
    const linkList = linkIds.length ? await trackingLinks.find({ where: { id: In(linkIds) } }) : [];
    const convIds = convList.map((c) => c.id);
    const commList = convIds.length ? await commissions.find({ where: { conversionId: In(convIds) } }) : [];

    return convList.map((c: any) => {
      const prog = progList.find((p) => p.id === c.programId);
      const linkId = c.trackingLinkId || c.metadata?.trackingLinkId;
      const link = linkList.find((l) => l.id === linkId);
      const comm = commList.find((cm) => cm.conversionId === c.id);

      return {
        id: c.id,
        organizationId: c.organizationId,
        programId: c.programId,
        programName: prog?.name || 'Partner Program',
        orderId: c.externalOrderId || c.externalId || `ORD-${c.id.slice(0, 6).toUpperCase()}`,
        source: link?.shortCode || (c as any).source || 'direct-referral',
        customerMasked: (c as any).customerMasked || ((c as any).customerEmail ? `${(c as any).customerEmail.slice(0, 2)}***@${(c as any).customerEmail.split('@')[1] || 'domain.com'}` : 'Customer'),
        value: c.amount || 0,
        attributedValue: c.amount || 0,
        commissionAmount: (comm as any)?.amount || (comm as any)?.commissionAmount || 0,
        status: c.status,
        clickTimestamp: (c as any).clickTimestamp || new Date(new Date(c.createdAt).getTime() - 3600000).toISOString(),
        convertedTimestamp: c.createdAt,
        expectedApprovalDate: new Date(new Date(c.createdAt).getTime() + 14 * 86400000).toISOString(),
      };
    });
  }

  // ----------------------------------------------------
  // Commissions
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/commissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List commissions for current affiliate' })
  async getCommissions(@Req() req: any, @Query('organizationId') organizationId?: string) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    const affiliateIds = affiliates.map((a) => a.id);
    if (affiliateIds.length === 0) return [];

    const { commissions, organizations, programs, conversions } = await this.repositories();

    const commList = await commissions.find({
      where: {
        affiliateId: In(affiliateIds),
        ...(organizationId ? { organizationId } : {}),
      },
      order: { createdAt: 'DESC' },
    });

    const orgIds = [...new Set(commList.map((c) => c.organizationId).filter(Boolean))];
    const progIds = [...new Set(commList.map((c) => c.programId).filter(Boolean))];
    const convIds = [...new Set(commList.map((c) => c.conversionId).filter(Boolean))];

    const orgList = orgIds.length ? await organizations.find({ where: { id: In(orgIds) } }) : [];
    const progList = progIds.length ? await programs.find({ where: { id: In(progIds) } }) : [];
    const convList = convIds.length ? await conversions.find({ where: { id: In(convIds) } }) : [];

    return commList.map((c: any) => {
      const org = orgList.find((o) => o.id === c.organizationId);
      const prog = progList.find((p) => p.id === c.programId);
      const conv = convList.find((cv) => cv.id === c.conversionId);

      return {
        id: c.id,
        organizationId: c.organizationId,
        programId: c.programId,
        programName: prog?.name || 'Partner Program',
        conversionId: c.conversionId || `conv_${c.id.slice(0, 6)}`,
        saleValue: conv?.amount || c.saleValue || 0,
        rateDescription: c.rateDescription || '',
        amount: c.amount || c.commissionAmount || 0,
        currency: (org as any)?.defaultCurrency || (org as any)?.currency || PLATFORM_CURRENCY,
        status: c.status,
        createdAt: c.createdAt,
        expectedPayableDate: new Date(new Date(c.createdAt).getTime() + 14 * 86400000).toISOString(),
        timeline: [
          { status: 'PENDING', timestamp: c.createdAt, note: 'Conversion recorded' },
          ...((c.status === 'APPROVED' || c.status === 'PAYABLE' || c.status === 'PAID')
            ? [{ status: 'APPROVED', timestamp: new Date(new Date(c.createdAt).getTime() + 86400000).toISOString(), note: 'Review window passed' }]
            : []),
          ...((c.status === 'PAYABLE' || c.status === 'PAID')
            ? [{ status: 'PAYABLE', timestamp: new Date(new Date(c.createdAt).getTime() + 2 * 86400000).toISOString(), note: 'Scheduled for payout' }]
            : []),
          ...((c.status === 'PAID')
            ? [{ status: 'PAID', timestamp: new Date(new Date(c.createdAt).getTime() + 5 * 86400000).toISOString(), note: 'Settled to payout method' }]
            : []),
        ],
      };
    });
  }

  // ----------------------------------------------------
  // Payouts
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/payouts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List payouts for current affiliate' })
  async getPayouts(@Req() req: any, @Query('organizationId') organizationId?: string) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    const affiliateIds = affiliates.map((a) => a.id);
    if (affiliateIds.length === 0) return [];

    const { payoutItems, payoutBatches, organizations } = await this.repositories();

    const poList = await payoutItems.find({
      where: { affiliateId: In(affiliateIds) },
      order: { createdAt: 'DESC' },
    });

    const batchIds = [...new Set(poList.map((pi) => pi.batchId).filter(Boolean))];
    const batchList = batchIds.length ? await payoutBatches.find({ where: { id: In(batchIds) } }) : [];

    const filteredPayouts = organizationId
      ? poList.filter((pi) => {
        const batch = batchList.find((b) => b.id === pi.batchId);
        return batch?.organizationId === organizationId;
      })
      : poList;

    const orgIds = [...new Set(batchList.map((b) => b.organizationId).filter(Boolean))];
    const orgList = orgIds.length ? await organizations.find({ where: { id: In(orgIds) } }) : [];

    return filteredPayouts.map((pi: any) => {
      const batch = batchList.find((b) => b.id === pi.batchId);
      const org = orgList.find((o) => o.id === (batch?.organizationId || organizationId));
      const gross = Number(pi.amount || (pi as any).grossAmount || 0);
      const taxWithheld = Number((pi as any).taxWithheld || 0);
      const net = Number(pi.amount || (gross - taxWithheld));

      return {
        id: pi.id,
        organizationId: batch?.organizationId || organizationId || org?.id,
        organizationName: org?.name || 'Partner',
        amount: net,
        currency: batch?.currency || (org as any)?.defaultCurrency || PLATFORM_CURRENCY,
        provider: (pi as any).provider || '',
        providerReference: pi.providerReference || `po_${pi.id.slice(0, 8)}`,
        payoutMethodMasked: (pi as any).payoutMethodMasked || '',
        payoutMethodType: (pi as any).payoutMethodType || 'BANK_ACCOUNT',
        status: pi.status || 'PAID',
        scheduledDate: batch?.createdAt || pi.createdAt,
        completedDate: pi.createdAt,
        grossAmount: gross,
        taxWithheld,
        feeDeduction: 0,
        netAmount: net,
        commissionCount: (pi as any).commissionCount || 0,
        timeline: [
          { status: 'PENDING', timestamp: batch?.createdAt || pi.createdAt, message: 'Batch initiated' },
          { status: 'PROCESSING', timestamp: pi.createdAt, message: 'Processed via payment provider' },
          { status: 'PAID', timestamp: pi.createdAt, message: 'Settlement completed' },
        ],
      };
    });
  }

  @Post('api/v1/affiliate/me/payouts/request-instant')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request instant settlement payout' })
  async requestInstantPayout(@Req() req: any, @Body('organizationId') organizationId: string) {
    const email = this.resolveAffiliateEmail(req);
    const { organizations, affiliates } = await this.repositories();

    const org = await organizations.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');

    const affiliate = await affiliates.findOne({
      where: { organizationId: org.id, email: email.toLowerCase().trim() },
    });
    if (!affiliate) throw new BadRequestException('Join this organization before requesting a payout.');
    if (affiliate.status !== AffiliateStatus.ACTIVE) {
      throw new BadRequestException('Your affiliate account is not active and cannot request payouts.');
    }

    const dataSource = await initializeDataSource();

    // Run the read-reserve-write sequence inside one serializable transaction with a
    // pessimistic row lock on the affiliate's payable commissions. This prevents concurrent
    // /request-instant calls (or a race with admin batch creation) from reading the same
    // "payable" commissions twice and creating multiple payout batches against one balance.
    const { batch, newPayout, grossAmount, commissionCount } = await dataSource.transaction(async (manager) => {
      const payableCommissions = await manager
        .getRepository(Commission)
        .createQueryBuilder('commission')
        .setLock('pessimistic_write')
        .where('commission.organizationId = :organizationId', { organizationId: org.id })
        .andWhere('commission.affiliateId = :affiliateId', { affiliateId: affiliate.id })
        .andWhere('commission.status IN (:...statuses)', { statuses: ['PAYABLE', 'APPROVED'] })
        .getMany();

      const grossAmount = payableCommissions.reduce(
        (sum, commission: any) => sum + netCommissionAmount(commission),
        0,
      );
      if (grossAmount <= 0) throw new BadRequestException('No payable balance is available.');

      const batchRepo = manager.getRepository(PayoutBatch);
      const itemRepo = manager.getRepository(PayoutItem);
      const commissionRepo = manager.getRepository(Commission);

      const batch = batchRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        environment: EnvironmentType.LIVE,
        totalAmount: grossAmount,
        currency: (org as any).defaultCurrency || PLATFORM_CURRENCY,
        status: PayoutStatus.PROCESSING,
        createdBy: affiliate.id,
        createdAt: new Date(),
      });
      await batchRepo.save(batch);

      const newPayout = itemRepo.create({
        id: uuidv4(),
        batchId: batch.id,
        organizationId: org.id,
        environment: EnvironmentType.LIVE,
        affiliateId: affiliate.id,
        amount: grossAmount,
        currency: (org as any).defaultCurrency || PLATFORM_CURRENCY,
        status: PayoutStatus.PROCESSING,
        providerReference: `instant_${uuidv4().slice(0, 8)}`,
        createdAt: new Date(),
      });
      await itemRepo.save(newPayout);

      // Reserve the commissions against this batch so they can never be selected again by
      // a concurrent instant payout request or an admin payout batch draft.
      const commissionIds = payableCommissions.map((c: any) => c.id);
      if (commissionIds.length > 0) {
        await commissionRepo
          .createQueryBuilder()
          .update(Commission)
          .set({ status: 'PROCESSING' as any })
          .whereInIds(commissionIds)
          .execute();
      }

      return { batch, newPayout, grossAmount, commissionCount: payableCommissions.length };
    });

    if (dbStore.payoutItems) {
      dbStore.payoutItems.unshift(newPayout as any);
    }

    this.auditService?.log({
      organizationId: org.id,
      actorType: 'affiliate',
      actorId: affiliate.userId || affiliate.id,
      action: AuditAction.AFFILIATE_PAYOUT_REQUESTED,
      resourceType: 'payout_item',
      resourceId: newPayout.id,
      metadata: {
        organizationId: org.id,
        grossAmount,
        commissionCount,
        affiliateId: affiliate.id,
      },
    });

    return {
      id: newPayout.id,
      organizationId: org.id,
      organizationName: org.name,
      amount: batch.totalAmount,
      currency: (org as any).defaultCurrency || (org as any).currency || PLATFORM_CURRENCY,
      provider: '',
      providerReference: newPayout.providerReference,
      payoutMethodMasked: '',
      payoutMethodType: 'BANK_ACCOUNT',
      status: 'PENDING',
      scheduledDate: new Date().toISOString(),
      completedDate: undefined,
      grossAmount,
      taxWithheld: 0,
      feeDeduction: 0,
      netAmount: grossAmount,
      commissionCount,
    };
  }

  // ----------------------------------------------------
  // Payout Methods CRUD
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/payout-methods')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List payout methods for current affiliate' })
  async getPayoutMethods(@Req() req: any) {
    const { user } = await this.resolveAffiliateUser(req);
    const { affiliatePayoutMethods } = await this.repositories();
    const methods = await affiliatePayoutMethods.find({ where: { userId: user.id }, order: { createdAt: 'DESC' } });
    return methods.map((method) => this.serializePayoutMethod(method));
  }

  @Post('api/v1/affiliate/me/payout-methods')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a new payout method' })
  async addPayoutMethod(@Req() req: any, @Body() body: any) {
    const { user } = await this.resolveAffiliateUser(req);
    const { affiliatePayoutMethods } = await this.repositories();
    const userId = user.id;
    const details = body?.details || {};
    const type = body?.type;
    if (!['BANK_ACCOUNT', 'UPI', 'PAYPAL', 'WISE'].includes(type)) {
      throw new BadRequestException('Unsupported payout method type.');
    }
    const existingMethods = await affiliatePayoutMethods.find({ where: { userId } });
    const accountNumber = String(details.accountNumber || body.accountNumber || '').trim();
    const upiId = String(details.upiId || body.upiId || '').trim();
    const paypalEmail = String(details.paypalEmail || body.paypalEmail || '').trim();

    const newMethod = affiliatePayoutMethods.create({
      userId,
      type,
      isDefault: existingMethods.length === 0 || Boolean(body.isDefault),
      bankName: details.bankName || body.bankName,
      accountNumberMasked: accountNumber ? `**** ${accountNumber.slice(-4)}` : undefined,
      ifscCode: String(details.ifscCode || body.ifscCode || '').trim().toUpperCase() || undefined,
      accountHolderName: String(details.accountHolderName || body.accountHolderName || '').trim(),
      upiIdMasked: upiId || undefined,
      paypalEmailMasked: paypalEmail ? paypalEmail.replace(/^(.{2}).*(@.*)$/, '$1***$2') : undefined,
      authorizedOrgIds: body.authorizedOrgIds || ['*'],
    });

    if (newMethod.isDefault) {
      await affiliatePayoutMethods.update({ userId }, { isDefault: false });
    }

    const saved = await affiliatePayoutMethods.save(newMethod);

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    const clientUserAgent = req.headers['user-agent'];

    this.auditService?.log({
      actorType: 'affiliate',
      actorId: userId,
      action: AuditAction.AFFILIATE_PAYOUT_METHOD_ADDED,
      resourceType: 'payout_method',
      resourceId: saved.id,
      ipAddress: clientIp,
      userAgent: clientUserAgent,
      metadata: {
        type: newMethod.type,
        isDefault: newMethod.isDefault,
        accountHolder: newMethod.accountHolderName,
      },
    });

    return this.serializePayoutMethod(saved);
  }

  @Patch('api/v1/affiliate/me/payout-methods/:methodId/default')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set default payout method' })
  async setDefaultPayoutMethod(@Req() req: any, @Param('methodId') methodId: string) {
    const { user } = await this.resolveAffiliateUser(req);
    const { affiliatePayoutMethods } = await this.repositories();
    const method = await affiliatePayoutMethods.findOne({ where: { id: methodId, userId: user.id } });
    if (!method) throw new NotFoundException('Payout method not found');
    await affiliatePayoutMethods.update({ userId: user.id }, { isDefault: false });
    method.isDefault = true;
    await affiliatePayoutMethods.save(method);

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    const clientUserAgent = req.headers['user-agent'];

    this.auditService?.log({
      actorType: 'affiliate',
      actorId: user.id,
      action: AuditAction.AFFILIATE_PAYOUT_METHOD_DEFAULT_SET,
      resourceType: 'payout_method',
      resourceId: methodId,
      ipAddress: clientIp,
      userAgent: clientUserAgent,
    });

    return { success: true };
  }

  @Delete('api/v1/affiliate/me/payout-methods/:methodId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete payout method' })
  async deletePayoutMethod(@Req() req: any, @Param('methodId') methodId: string) {
    const { user } = await this.resolveAffiliateUser(req);
    const { affiliatePayoutMethods } = await this.repositories();
    const method = await affiliatePayoutMethods.findOne({ where: { id: methodId, userId: user.id } });
    if (method) {
      await affiliatePayoutMethods.remove(method);
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
      const clientUserAgent = req.headers['user-agent'];

      this.auditService?.log({
        actorType: 'affiliate',
        actorId: user.id,
        action: AuditAction.AFFILIATE_PAYOUT_METHOD_DELETED,
        resourceType: 'payout_method',
        resourceId: methodId,
        ipAddress: clientIp,
        userAgent: clientUserAgent,
        metadata: {
          type: method.type,
        },
      });
    }
    return { success: true };
  }

  // ----------------------------------------------------
  // Tax Profile
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/tax-profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current tax profile' })
  async getTaxProfile(@Req() req: any) {
    const { profile } = await this.resolveAffiliateProfile(req);
    return this.serializeTaxProfile(profile);
  }

  @Patch('api/v1/affiliate/me/tax-profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update tax profile' })
  async updateTaxProfile(@Req() req: any, @Body() body: any) {
    const { profile } = await this.resolveAffiliateProfile(req);
    const { affiliatePortalProfiles } = await this.repositories();
    profile.taxCountry = body.country || profile.country || 'India';
    profile.panOrTaxId = body.panOrTaxId ? String(body.panOrTaxId).trim().toUpperCase() : profile.panOrTaxId || '';
    profile.taxClassification = body.taxClassification || profile.taxClassification || 'INDIVIDUAL';
    profile.withholdingRate = body.withholdingRate ?? profile.withholdingRate ?? 0;
    profile.taxVerified = Boolean(body.isVerified ?? profile.taxVerified ?? false);
    profile.taxFormType = body.formType || profile.taxFormType || 'PAN_TDS';
    profile.taxSubmittedAt = new Date();
    await affiliatePortalProfiles.save(profile);

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    const clientUserAgent = req.headers['user-agent'];

    this.auditService?.log({
      actorType: 'affiliate',
      actorId: profile.userId,
      action: AuditAction.AFFILIATE_TAX_PROFILE_UPDATED,
      resourceType: 'tax_profile',
      resourceId: profile.id,
      ipAddress: clientIp,
      userAgent: clientUserAgent,
      metadata: {
        country: profile.taxCountry,
        formType: profile.taxFormType,
        taxClassification: profile.taxClassification,
        withholdingRate: profile.withholdingRate,
      },
    });

    return this.serializeTaxProfile(profile);
  }

  // ----------------------------------------------------
  // Invitations
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/invitations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List invitations for current affiliate' })
  async getInvitations(@Req() req: any) {
    const email = this.resolveAffiliateEmail(req);
    return (await this.affiliatesService?.listInvitationsForEmail(email)) || [];
  }

  @Post('api/v1/affiliate/me/invitations/:invitationId/accept')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept affiliate invitation for current affiliate' })
  async acceptInvitation(@Req() req: any, @Param('invitationId') invitationId: string, @Body() body: any) {
    const email = this.resolveAffiliateEmail(req);
    const result = await this.affiliatesService?.acceptInvitationForEmail(invitationId, email, {
      acceptedTerms: true,
      termsVersionAccepted: body?.termsVersionAccepted || 1,
    }, req.user?.userId || req.user?.sub);

    this.auditService?.log({
      actorType: 'affiliate',
      actorId: req.user?.userId || req.user?.sub || email,
      action: AuditAction.AFFILIATE_INVITATION_ACCEPTED,
      resourceType: 'affiliate_invitation',
      resourceId: invitationId,
    });

    return result;
  }

  @Post('api/v1/affiliate/me/invitations/:invitationId/decline')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Decline affiliate invitation' })
  async declineInvitation(@Req() req: any, @Param('invitationId') invitationId: string) {
    const email = this.resolveAffiliateEmail(req);
    const result = await this.affiliatesService?.declineInvitationForEmail(invitationId, email, req.user?.userId || req.user?.sub);

    this.auditService?.log({
      actorType: 'affiliate',
      actorId: req.user?.userId || req.user?.sub || email,
      action: AuditAction.AFFILIATE_INVITATION_DECLINED,
      resourceType: 'affiliate_invitation',
      resourceId: invitationId,
    });

    return result;
  }

  // ----------------------------------------------------
  // Active Sessions
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active sessions for security' })
  async getSessions(@Req() req: any) {
    const { user } = await this.resolveAffiliateUser(req);
    if (!user?.id) return [];

    const { authSessions } = await this.repositories();
    const sessions = await authSessions.find({
      where: { userId: user.id, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    const currentSessionId = req.user?.sessionId;

    return sessions.map((s) => ({
      id: s.id,
      device: s.userAgent ? (s.userAgent.includes('Mobile') ? 'Mobile Browser' : 'Desktop Browser') : 'Unknown Device',
      browser: s.userAgent || 'Web Browser',
      ipAddress: s.ipAddress || 'Unknown IP',
      location: 'Detected Session',
      isCurrent: s.id === currentSessionId,
      lastActiveAt: s.lastUsedAt ? s.lastUsedAt.toISOString() : (s.createdAt ? s.createdAt.toISOString() : new Date().toISOString()),
      createdAt: s.createdAt ? s.createdAt.toISOString() : new Date().toISOString(),
    }));
  }

  // ----------------------------------------------------
  // Time Series Metrics (Analytics & Dashboard Charts)
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/timeseries')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Time-series chart data for analytics and dashboard' })
  async getTimeSeries(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
    @Query('timeRange') timeRange = '7d',
  ) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    const scopedAffiliates = organizationId ? affiliates.filter((a) => a.organizationId === organizationId) : affiliates;
    const affiliateIds = scopedAffiliates.map((a) => a.id);

    const count = timeRange === '90d' ? 12 : (timeRange === '30d' ? 10 : 7);
    const result = [];
    const now = new Date();

    if (affiliateIds.length === 0) {
      for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        result.push({ date: dateStr, clicks: 0, conversions: 0, revenue: 0, commissions: 0 });
      }
      return result;
    }

    const { trackingLinks, conversions, commissions } = await this.repositories();

    const startDate = new Date(now.getTime() - (count + 1) * 86400000);

    const linksQuery = trackingLinks.createQueryBuilder('tl')
      .where('tl.affiliateId IN (:...affiliateIds)', { affiliateIds })
      .andWhere('tl.createdAt >= :startDate', { startDate });
    if (organizationId) {
      linksQuery.andWhere('tl.organizationId = :organizationId', { organizationId });
    }
    const links = await linksQuery.getMany();

    const convQuery = conversions.createQueryBuilder('c')
      .where('c.affiliateId IN (:...affiliateIds)', { affiliateIds })
      .andWhere('c.createdAt >= :startDate', { startDate });
    if (organizationId) {
      convQuery.andWhere('c.organizationId = :organizationId', { organizationId });
    }
    const convList = await convQuery.getMany();

    const commQuery = commissions.createQueryBuilder('comm')
      .where('comm.affiliateId IN (:...affiliateIds)', { affiliateIds })
      .andWhere('comm.createdAt >= :startDate', { startDate });
    if (organizationId) {
      commQuery.andWhere('comm.organizationId = :organizationId', { organizationId });
    }
    const commList = await commQuery.getMany();

    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const dayKey = d.toISOString().slice(0, 10);

      const dayLinks = links.filter(
        (link: any) => new Date(link.createdAt).toISOString().slice(0, 10) === dayKey,
      );
      const dayConversions = convList.filter(
        (conversion: any) => new Date(conversion.createdAt).toISOString().slice(0, 10) === dayKey,
      );
      const dayCommissions = commList.filter(
        (commission: any) => new Date(commission.createdAt).toISOString().slice(0, 10) === dayKey,
      );

      result.push({
        date: dateStr,
        clicks: dayLinks.reduce((sum, link: any) => sum + Number((link as any).clickCount || (link as any).clicks || 0), 0),
        conversions: dayConversions.length,
        revenue: dayConversions.reduce((sum, conversion: any) => sum + Number(conversion.amount || (conversion as any).value || 0), 0),
        commissions: sumNetCommissions(dayCommissions),
      });
    }

    return result;
  }

  // ----------------------------------------------------
  // Traffic Sources
  // ----------------------------------------------------
  /**
   * Breakdown of where this partner's tracked clicks came from.
   *
   * The metric is deliberately a single, named one — recorded clicks — rather
   * than a blend of clicks, sessions and conversions, so the percentages on the
   * chart always add up against one denominator. A click's source is its UTM
   * source when the link carried one, otherwise the referrer's host. Clicks with
   * neither are grouped under a real "Unknown" bucket; no bucket is invented to
   * make the chart look fuller, so an affiliate with no tracked clicks gets an
   * empty list and the portal shows an empty state.
   */
  @Get('api/v1/affiliate/me/traffic-sources')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Click volume grouped by traffic source' })
  async getTrafficSources(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
    @Query('timeRange') timeRange = '30d',
  ) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    // Ownership is derived from the token, never from a client-supplied
    // affiliateId, and an organizationId filter can only ever narrow the set of
    // affiliate rows that already belong to this user.
    const scopedAffiliates = organizationId
      ? affiliates.filter((a) => a.organizationId === organizationId)
      : affiliates;
    const affiliateIds = scopedAffiliates.map((a) => a.id);

    const rangeDays = AffiliatePortalController.rangeDays(timeRange);
    const since = new Date(Date.now() - rangeDays * 86400000);

    if (affiliateIds.length === 0) {
      return { metric: 'clicks', rangeDays, total: 0, sources: [] };
    }

    const { clicks: clicksRepo } = await this.repositories();
    const clicksQuery = clicksRepo.createQueryBuilder('click')
      .where('click.affiliateId IN (:...affiliateIds)', { affiliateIds })
      .andWhere('click.createdAt >= :since', { since });
    if (organizationId) {
      clicksQuery.andWhere('click.organizationId = :organizationId', { organizationId });
    }
    const clickRows = await clicksQuery.getMany();

    const counts = new Map<string, number>();
    for (const click of clickRows) {
      const label = AffiliatePortalController.resolveTrafficSourceLabel(click as any);
      counts.set(label, (counts.get(label) || 0) + 1);
    }

    const total = clickRows.length;
    const sources = Array.from(counts.entries())
      .map(([source, count]) => ({
        source,
        count,
        // Rounded to one decimal, matching how the portal renders every other
        // percentage. Guarded so an empty window can never divide by zero.
        percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return { metric: 'clicks', rangeDays, total, sources };
  }

  /** UTM source wins; otherwise the referrer host; otherwise a real Unknown bucket. */
  static resolveTrafficSourceLabel(click: {
    utmSource?: string | null;
    referrer?: string | null;
  }): string {
    const utm = (click.utmSource || '').trim();
    if (utm) return utm.toLowerCase();

    const referrer = (click.referrer || '').trim();
    if (referrer) {
      try {
        const host = new URL(referrer).hostname.replace(/^www\./i, '');
        if (host) return host.toLowerCase();
      } catch {
        // A referrer that is not a parseable URL is still real data; keep it
        // rather than discarding the click or relabelling it as something else.
        return referrer.slice(0, 64).toLowerCase();
      }
    }

    return 'Unknown';
  }

  // ----------------------------------------------------
  // Support Tickets
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/support-tickets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List support tickets' })
  async getSupportTickets(@Req() req: any) {
    const { user } = await this.resolveAffiliateUser(req);
    const { affiliateSupportTickets } = await this.repositories();
    return affiliateSupportTickets.find({ where: { userId: user.id }, order: { createdAt: 'DESC' } });
  }

  @Post('api/v1/affiliate/me/support-tickets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit support ticket' })
  async createSupportTicket(@Req() req: any, @Body() body: any) {
    const { user } = await this.resolveAffiliateUser(req);
    const { affiliateSupportTickets, organizations } = await this.repositories();
    const org = body.organizationId ? await organizations.findOne({ where: { id: body.organizationId } }) : null;

    const ticket = affiliateSupportTickets.create({
      userId: user.id,
      organizationId: body.organizationId,
      organizationName: org?.name || 'Global Partner Support',
      subject: body.subject,
      category: body.category || 'General Support',
      priority: body.priority || 'NORMAL',
      status: 'OPEN',
      message: body.message,
      lastReply: 'Ticket registered. Partner manager assigned.',
    });

    const saved = await affiliateSupportTickets.save(ticket);

    this.auditService?.log({
      organizationId: body.organizationId,
      actorType: 'affiliate',
      actorId: user.id,
      action: AuditAction.AFFILIATE_SUPPORT_TICKET_CREATED,
      resourceType: 'support_ticket',
      resourceId: saved.id,
      metadata: {
        category: ticket.category,
        priority: ticket.priority,
      },
    });

    return saved;
  }

  // ----------------------------------------------------
  // Audit Logs
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/audit-logs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List scoped audit logs for current affiliate user' })
  async getAuditLogs(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const { user, email } = await this.resolveAffiliateUser(req);
    const affiliates = await this.resolveAffiliatesForUser(email, user.id);
    const affiliateIds = affiliates.map((a) => a.id);

    // If an organization is specified, verify the affiliate has an active partnership
    if (organizationId) {
      const isMember = affiliates.some((a) => a.organizationId === organizationId);
      if (!isMember) {
        return {
          data: [],
          total: 0,
          page: Math.max(1, Number(page) || 1),
          limit: Math.min(100, Math.max(1, Number(limit) || 20)),
          totalPages: 0,
        };
      }
    }

    if (!this.auditService) {
      return {
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      };
    }

    return this.auditService.getAffiliateAuditLogs({
      actorId: user.id,
      affiliateIds,
      organizationId,
      page,
      limit,
      search,
      action,
      resourceType,
      startDate,
      endDate,
    });
  }

  // ----------------------------------------------------
  // Detailed Analytics & Performance Metrics
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/analytics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Comprehensive affiliate performance analytics' })
  async getAnalytics(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
    @Query('programId') programId?: string,
    @Query('timeRange') timeRange = '30d',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const email = this.resolveAffiliateEmail(req);
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const affiliates = await this.resolveAffiliatesForUser(email, userId);
    const scopedAffiliates = organizationId
      ? affiliates.filter((a) => a.organizationId === organizationId)
      : affiliates;
    const affiliateIds = scopedAffiliates.map((a) => a.id);

    const now = new Date();
    let from: Date;
    let to = now;
    let prevFrom: Date;

    if (startDate && endDate) {
      from = new Date(startDate);
      to = new Date(endDate);
      const duration = to.getTime() - from.getTime();
      prevFrom = new Date(from.getTime() - duration);
    } else if (timeRange === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      to = now;
      prevFrom = new Date(from.getTime() - 24 * 60 * 60 * 1000);
    } else if (timeRange === 'yesterday') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      from = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      to = todayStart;
      prevFrom = new Date(from.getTime() - 24 * 60 * 60 * 1000);
    } else if (timeRange === 'all') {
      from = new Date(0);
      to = now;
      prevFrom = from;
    } else {
      const days = AffiliatePortalController.rangeDays(timeRange);
      to = now;
      from = new Date(to.getTime() - days * 86400000);
      prevFrom = new Date(from.getTime() - days * 86400000);
    }

    const {
      trackingLinks,
      clicks: clicksRepo,
      conversions,
      commissions,
      payoutItems,
      programAffiliates,
      affiliateTiers,
      partnerTiers,
      programs,
      organizations,
    } = await this.repositories();

    // If no affiliate IDs, return clean empty structure
    if (affiliateIds.length === 0) {
      return {
        summary: {
          totalClicks: 0,
          uniqueClicks: 0,
          totalConversions: 0,
          conversionRate: 0,
          totalCommission: 0,
          pendingCommission: 0,
          approvedCommission: 0,
          paidCommission: 0,
          reversedCommission: 0,
          averageCommission: 0,
          activePrograms: 0,
          totalReferralLinks: 0,
          attributedRevenue: 0,
        },
        trends: { rangeDays: AffiliatePortalController.rangeDays(timeRange) },
        conversionFunnel: {
          clicks: 0,
          conversions: 0,
          conversionRate: 0,
          approvedConversions: 0,
          approvalRate: 0,
          paidConversions: 0,
          paidRate: 0,
          reversedConversions: 0,
          reversalRate: 0,
        },
        commissionBreakdown: {
          pending: { count: 0, amount: 0 },
          approved: { count: 0, amount: 0 },
          paid: { count: 0, amount: 0 },
          reversed: { count: 0, amount: 0 },
        },
        programPerformance: [],
        referralLinkPerformance: [],
        campaignPerformance: [],
        earningsByProgram: [],
        topPerformers: {
          topPrograms: [],
          topLinks: [],
          topCampaigns: [],
        },
        insights: [],
        tierProgress: null,
      };
    }

    // 1. Fetch Tracking Links
    const linksQb = trackingLinks.createQueryBuilder('tl')
      .where('tl.affiliateId IN (:...affiliateIds)', { affiliateIds });
    if (organizationId) {
      linksQb.andWhere('tl.organizationId = :organizationId', { organizationId });
    }
    if (programId) {
      linksQb.andWhere('tl.programId = :programId', { programId });
    }
    const linkList = await linksQb.orderBy('tl.createdAt', 'DESC').getMany();

    // 2. Fetch Clicks (both previous window and current window)
    const clicksQb = clicksRepo.createQueryBuilder('ck')
      .where('ck.affiliateId IN (:...affiliateIds)', { affiliateIds });
    if (organizationId) {
      clicksQb.andWhere('ck.organizationId = :organizationId', { organizationId });
    }
    if (programId) {
      clicksQb.andWhere('ck.programId = :programId', { programId });
    }
    if (timeRange !== 'all') {
      clicksQb.andWhere('ck.createdAt >= :prevFrom AND ck.createdAt <= :to', { prevFrom, to });
    }
    const allClicks = await clicksQb.getMany();

    // 3. Fetch Conversions
    const convQb = conversions.createQueryBuilder('c')
      .where('c.affiliateId IN (:...affiliateIds)', { affiliateIds });
    if (organizationId) {
      convQb.andWhere('c.organizationId = :organizationId', { organizationId });
    }
    if (programId) {
      convQb.andWhere('c.programId = :programId', { programId });
    }
    if (timeRange !== 'all') {
      convQb.andWhere('c.createdAt >= :prevFrom AND c.createdAt <= :to', { prevFrom, to });
    }
    const allConversions = await convQb.getMany();

    // 4. Fetch Commissions
    const commQb = commissions.createQueryBuilder('comm')
      .where('comm.affiliateId IN (:...affiliateIds)', { affiliateIds });
    if (organizationId) {
      commQb.andWhere('comm.organizationId = :organizationId', { organizationId });
    }
    if (programId) {
      commQb.andWhere('comm.programId = :programId', { programId });
    }
    if (timeRange !== 'all') {
      commQb.andWhere('comm.createdAt >= :prevFrom AND comm.createdAt <= :to', { prevFrom, to });
    }
    const allCommissions = await commQb.getMany();

    // 5. Fetch Programs & Organizations
    const programIdsFromData = [
      ...new Set([
        ...linkList.map((l) => l.programId),
        ...allClicks.map((c) => c.programId),
        ...allConversions.map((c) => c.programId),
        ...allCommissions.map((c) => c.programId),
        ...(programId ? [programId] : []),
      ].filter(Boolean)),
    ];
    const progList = programIdsFromData.length > 0
      ? await programs.find({ where: { id: In(programIdsFromData) } })
      : [];
    const progMap = new Map(progList.map((p) => [p.id, p]));

    const orgIdsFromData = [
      ...new Set([
        ...scopedAffiliates.map((a) => a.organizationId),
        ...linkList.map((l) => l.organizationId),
        ...progList.map((p) => p.organizationId),
      ].filter(Boolean)),
    ];
    const orgList = orgIdsFromData.length > 0
      ? await organizations.find({ where: { id: In(orgIdsFromData) } })
      : [];
    const orgMap = new Map(orgList.map((o) => [o.id, o]));

    // Helper: is in window
    const isInCurr = (d: Date | string) => {
      const t = new Date(d).getTime();
      return t >= from.getTime() && t <= to.getTime();
    };
    const isInPrev = (d: Date | string) => {
      const t = new Date(d).getTime();
      return t >= prevFrom.getTime() && t < from.getTime();
    };

    const currentClicks = allClicks.filter((c) => isInCurr(c.createdAt));
    const prevClicks = allClicks.filter((c) => isInPrev(c.createdAt));

    const currentConversions = allConversions.filter((c) => isInCurr(c.createdAt));
    const prevConversions = allConversions.filter((c) => isInPrev(c.createdAt));

    const currentCommissions = allCommissions.filter((c) => isInCurr(c.createdAt));
    const prevCommissions = allCommissions.filter((c) => isInPrev(c.createdAt));

    // Summary calculations
    const totalClicks = currentClicks.length;
    const uniqueClicks = new Set(currentClicks.map((c: any) => c.anonymousId || c.ipHash).filter(Boolean)).size;
    const totalConversions = currentConversions.length;
    const conversionRate = totalClicks > 0 ? Number(((totalConversions / totalClicks) * 100).toFixed(2)) : 0;

    // Commission buckets
    const getNet = netCommissionAmount;

    const approvedCommission = currentCommissions
      .filter((c: any) => c.status === ConversionStatus.APPROVED || (c.status as any) === 'PAYABLE')
      .reduce((sum, c: any) => sum + getNet(c), 0);

    const paidCommission = currentCommissions
      .filter((c: any) => (c.status as any) === 'PAID')
      .reduce((sum, c: any) => sum + getNet(c), 0);

    const reversedCommission = currentCommissions
      .filter((c: any) => c.status === ConversionStatus.REFUNDED || c.status === ConversionStatus.PARTIALLY_REFUNDED || c.status === ConversionStatus.CHARGEBACK)
      .reduce((sum, c: any) => sum + Number(c.reversedAmount || c.amount || c.commissionAmount || 0), 0)
      + currentCommissions.reduce((sum, c: any) => sum + Number(c.reversedAmount || 0), 0);

    // Pending conversions estimation
    const pendingConversions = currentConversions.filter((c: any) => c.status === ConversionStatus.PENDING);
    const pendingFromConversions = pendingConversions.reduce((sum, c: any) => {
      const prog = progMap.get(c.programId);
      const commissionValue = prog?.defaultCommissionValue ?? 1000;
      const estimated =
        prog?.commissionType === CommissionType.FIXED_AMOUNT
          ? commissionValue
          : Math.round((Number(c.amount || 0) * commissionValue) / 10000);
      return sum + estimated;
    }, 0);
    const pendingFromCommissions = currentCommissions
      .filter((c: any) => c.status === ConversionStatus.PENDING)
      .reduce((sum, c: any) => sum + getNet(c), 0);
    const pendingCommission = pendingFromConversions + pendingFromCommissions;

    const totalCommission = approvedCommission + paidCommission;

    const averageCommission = totalConversions > 0
      ? Number((totalCommission / totalConversions).toFixed(2))
      : 0;

    const attributedRevenue = currentConversions
      .filter((c: any) => c.status !== ConversionStatus.REJECTED)
      .reduce((sum, c: any) => sum + Number(c.amount || (c as any).value || 0), 0);

    const activeProgramsSet = new Set([
      ...linkList.map((l) => l.programId),
      ...currentConversions.map((c) => c.programId),
    ].filter(Boolean));
    const activePrograms = activeProgramsSet.size;
    const totalReferralLinks = linkList.length;

    // Previous window metrics for trends
    const prevClicksCount = prevClicks.length;
    const prevConvCount = prevConversions.length;
    const prevEarnings = prevCommissions
      .filter((c: any) => c.status === ConversionStatus.APPROVED || (c.status as any) === 'PAYABLE' || (c.status as any) === 'PAID')
      .reduce((sum, c: any) => sum + getNet(c), 0);
    const prevRevenue = prevConversions
      .filter((c: any) => c.status !== ConversionStatus.REJECTED)
      .reduce((sum, c: any) => sum + Number(c.amount || (c as any).value || 0), 0);
    const prevRate = prevClicksCount > 0 ? (prevConvCount / prevClicksCount) * 100 : 0;

    const daysCount = timeRange === 'all' ? 0 : AffiliatePortalController.rangeDays(timeRange);

    const trends = {
      rangeDays: daysCount,
      clicks: AffiliatePortalController.pctChange(totalClicks, prevClicksCount),
      conversions: AffiliatePortalController.pctChange(totalConversions, prevConvCount),
      earnings: AffiliatePortalController.pctChange(totalCommission, prevEarnings),
      revenue: AffiliatePortalController.pctChange(attributedRevenue, prevRevenue),
      conversionRate: AffiliatePortalController.pctChange(conversionRate, prevRate),
    };

    // Conversion Funnel
    const approvedConvCount = currentConversions.filter((c: any) => c.status === ConversionStatus.APPROVED).length;
    const paidConvCount = currentConversions.filter((c: any) => {
      const comm = currentCommissions.find((cm) => cm.conversionId === c.id);
      return (comm?.status as any) === 'PAID';
    }).length;
    const reversedConvCount = currentConversions.filter(
      (c: any) => c.status === ConversionStatus.REFUNDED || c.status === ConversionStatus.PARTIALLY_REFUNDED || c.status === ConversionStatus.CHARGEBACK,
    ).length;

    const conversionFunnel = {
      clicks: totalClicks,
      conversions: totalConversions,
      conversionRate,
      approvedConversions: approvedConvCount,
      approvalRate: totalConversions > 0 ? Number(((approvedConvCount / totalConversions) * 100).toFixed(1)) : 0,
      paidConversions: paidConvCount,
      paidRate: totalConversions > 0 ? Number(((paidConvCount / totalConversions) * 100).toFixed(1)) : 0,
      reversedConversions: reversedConvCount,
      reversalRate: totalConversions > 0 ? Number(((reversedConvCount / totalConversions) * 100).toFixed(1)) : 0,
    };

    // Commission Status Breakdown
    const commissionBreakdown = {
      pending: {
        count: pendingConversions.length + currentCommissions.filter((c: any) => c.status === ConversionStatus.PENDING).length,
        amount: pendingCommission,
      },
      approved: {
        count: currentCommissions.filter((c: any) => c.status === ConversionStatus.APPROVED || (c.status as any) === 'PAYABLE').length,
        amount: approvedCommission,
      },
      paid: {
        count: currentCommissions.filter((c: any) => (c.status as any) === 'PAID').length,
        amount: paidCommission,
      },
      reversed: {
        count: currentCommissions.filter((c: any) => c.status === ConversionStatus.REFUNDED || c.status === ConversionStatus.PARTIALLY_REFUNDED || c.status === ConversionStatus.CHARGEBACK).length,
        amount: reversedCommission,
      },
    };

    // Referral Link Performance
    const clicksByLink = new Map<string, any[]>();
    for (const ck of currentClicks) {
      if (ck.trackingLinkId) {
        if (!clicksByLink.has(ck.trackingLinkId)) clicksByLink.set(ck.trackingLinkId, []);
        clicksByLink.get(ck.trackingLinkId)!.push(ck);
      }
    }

    const clickLinkMap = new Map<string, string>();
    for (const ck of allClicks) {
      if (ck.id && ck.trackingLinkId) clickLinkMap.set(ck.id, ck.trackingLinkId);
    }

    const convByLink = new Map<string, any[]>();
    for (const c of currentConversions) {
      const lid = (c as any).trackingLinkId || c.metadata?.trackingLinkId || (c.clickId ? clickLinkMap.get(c.clickId) : null);
      if (lid) {
        if (!convByLink.has(lid)) convByLink.set(lid, []);
        convByLink.get(lid)!.push(c);
      }
    }

    const convIdToLink = new Map<string, string>();
    for (const c of allConversions) {
      const lid = (c as any).trackingLinkId || c.metadata?.trackingLinkId || (c.clickId ? clickLinkMap.get(c.clickId) : null);
      if (lid) convIdToLink.set(c.id, lid);
    }
    const commByLink = new Map<string, number>();
    for (const cm of currentCommissions) {
      const lid = convIdToLink.get(cm.conversionId) || (cm as any).trackingLinkId;
      if (lid) {
        commByLink.set(lid, (commByLink.get(lid) || 0) + getNet(cm));
      }
    }

    const referralLinkPerformance = linkList.map((l) => {
      const p = progMap.get(l.programId);
      const o = orgMap.get(l.organizationId);
      const lClicks = clicksByLink.get(l.id) || [];
      const lConvs = convByLink.get(l.id) || [];
      const lCommission = commByLink.get(l.id) || 0;
      const lUnique = new Set(lClicks.map((c: any) => c.anonymousId || c.ipHash).filter(Boolean)).size;
      const lRate = lClicks.length > 0 ? Number(((lConvs.length / lClicks.length) * 100).toFixed(2)) : 0;
      const lastClick = lClicks.length > 0
        ? lClicks.reduce((max, c) => (new Date(c.createdAt) > new Date(max) ? c.createdAt : max), lClicks[0].createdAt)
        : null;

      return {
        id: l.id,
        title: (l as any).title || `${p?.name || 'Referral'} Link`,
        shortCode: l.shortCode,
        destinationUrl: l.destinationUrl,
        trackingUrl: `https://${o?.slug || 'go'}.partneriq.in/r/${l.shortCode}`,
        programId: l.programId,
        programName: p?.name || 'Partner Program',
        organizationId: l.organizationId,
        organizationName: o?.name || 'Organization',
        clicks: lClicks.length,
        uniqueClicks: lUnique,
        conversions: lConvs.length,
        conversionRate: lRate,
        commissionEarned: lCommission,
        lastClickDate: lastClick,
        campaign: (l as any).campaign || (l as any).campaignId || l.subId || '',
        status: l.status,
        createdAt: l.createdAt,
      };
    });

    // Program Performance
    const programIdsForReport = progList.map((p) => p.id);
    const programPerformance = programIdsForReport.map((pid) => {
      const p = progMap.get(pid);
      const o = p ? orgMap.get(p.organizationId) : null;
      const pLinks = linkList.filter((l) => l.programId === pid);
      const pClicks = currentClicks.filter((c) => c.programId === pid);
      const pUnique = new Set(pClicks.map((c: any) => c.anonymousId || c.ipHash).filter(Boolean)).size;
      const pConvs = currentConversions.filter((c) => c.programId === pid);
      const pComms = currentCommissions.filter((c) => c.programId === pid);

      const pApproved = pComms
        .filter((c: any) => c.status === ConversionStatus.APPROVED || (c.status as any) === 'PAYABLE')
        .reduce((sum, c: any) => sum + getNet(c), 0);
      const pPaid = pComms
        .filter((c: any) => (c.status as any) === 'PAID')
        .reduce((sum, c: any) => sum + getNet(c), 0);
      const pReversed = pComms
        .filter((c: any) => c.status === ConversionStatus.REFUNDED || c.status === ConversionStatus.PARTIALLY_REFUNDED || c.status === ConversionStatus.CHARGEBACK)
        .reduce((sum, c: any) => sum + Number(c.reversedAmount || c.amount || 0), 0)
        + pComms.reduce((sum, c: any) => sum + Number(c.reversedAmount || 0), 0);

      const pPendingConvs = pConvs.filter((c: any) => c.status === ConversionStatus.PENDING);
      const pPending = pPendingConvs.reduce((sum, c: any) => {
        const commissionValue = p?.defaultCommissionValue ?? 1000;
        const estimated =
          p?.commissionType === CommissionType.FIXED_AMOUNT
            ? commissionValue
            : Math.round((Number(c.amount || 0) * commissionValue) / 10000);
        return sum + estimated;
      }, 0);

      const pCommission = pApproved + pPaid;
      const pConvRate = pClicks.length > 0 ? Number(((pConvs.length / pClicks.length) * 100).toFixed(2)) : 0;

      let topLinkName: string | undefined;
      let maxLinkEarnings = -1;
      for (const pl of pLinks) {
        const plComm = commByLink.get(pl.id) || 0;
        if (plComm > maxLinkEarnings) {
          maxLinkEarnings = plComm;
          topLinkName = pl.shortCode;
        }
      }

      return {
        programId: pid,
        programName: p?.name || 'Partner Program',
        organizationId: p?.organizationId || '',
        organizationName: o?.name || 'Organization',
        currency: (o as any)?.defaultCurrency || (o as any)?.currency || p?.currency || PLATFORM_CURRENCY,
        clicks: pClicks.length,
        uniqueClicks: pUnique,
        conversions: pConvs.length,
        conversionRate: pConvRate,
        commissionEarned: pCommission,
        pendingCommission: pPending,
        approvedCommission: pApproved,
        paidCommission: pPaid,
        reversedCommission: pReversed,
        referralLinksCount: pLinks.length,
        topPerformingLink: topLinkName || (pLinks[0]?.shortCode ?? '—'),
      };
    }).filter((item) => item.clicks > 0 || item.conversions > 0 || item.commissionEarned > 0 || item.referralLinksCount > 0);

    // Earnings by program (for charts)
    const earningsByProgram = programPerformance.map((p) => ({
      programId: p.programId,
      programName: p.programName,
      commissionEarned: p.commissionEarned,
      conversions: p.conversions,
      currency: p.currency,
    }));

    // Campaign & UTM Performance
    const campaignMap = new Map<string, {
      campaignName: string;
      utmSource: string;
      utmMedium: string;
      utmCampaign: string;
      utmContent: string;
      clicks: number;
      uniqueClicksSet: Set<string>;
      conversions: number;
      commissionEarned: number;
    }>();

    for (const ck of currentClicks) {
      const source = (ck.utmSource || '').trim();
      const medium = (ck.utmMedium || '').trim();
      const campaign = (ck.utmCampaign || '').trim();
      const content = (ck.utmContent || '').trim();

      if (source || medium || campaign || content) {
        const key = `${source}|${medium}|${campaign}|${content}`.toLowerCase();
        if (!campaignMap.has(key)) {
          campaignMap.set(key, {
            campaignName: campaign || source || 'Campaign',
            utmSource: source || '—',
            utmMedium: medium || '—',
            utmCampaign: campaign || '—',
            utmContent: content || '—',
            clicks: 0,
            uniqueClicksSet: new Set<string>(),
            conversions: 0,
            commissionEarned: 0,
          });
        }
        const entry = campaignMap.get(key)!;
        entry.clicks += 1;
        if (ck.anonymousId || ck.ipHash) entry.uniqueClicksSet.add(ck.anonymousId || ck.ipHash);
      }
    }

    // Add conversions & commissions to campaigns
    for (const c of currentConversions) {
      if (c.clickId) {
        const matchedClick = allClicks.find((ck) => ck.id === c.clickId);
        if (matchedClick) {
          const source = (matchedClick.utmSource || '').trim();
          const medium = (matchedClick.utmMedium || '').trim();
          const campaign = (matchedClick.utmCampaign || '').trim();
          const content = (matchedClick.utmContent || '').trim();
          if (source || medium || campaign || content) {
            const key = `${source}|${medium}|${campaign}|${content}`.toLowerCase();
            const entry = campaignMap.get(key);
            if (entry) {
              entry.conversions += 1;
              const comm = currentCommissions.find((cm) => cm.conversionId === c.id);
              if (comm) {
                entry.commissionEarned += getNet(comm);
              }
            }
          }
        }
      }
    }

    const campaignPerformance = Array.from(campaignMap.values()).map((camp) => ({
      campaignName: camp.campaignName,
      utmSource: camp.utmSource,
      utmMedium: camp.utmMedium,
      utmCampaign: camp.utmCampaign,
      utmContent: camp.utmContent,
      clicks: camp.clicks,
      uniqueClicks: camp.uniqueClicksSet.size,
      conversions: camp.conversions,
      conversionRate: camp.clicks > 0 ? Number(((camp.conversions / camp.clicks) * 100).toFixed(2)) : 0,
      commissionEarned: camp.commissionEarned,
    })).sort((a, b) => b.commissionEarned - a.commissionEarned || b.clicks - a.clicks);

    // Top Performers
    const topPrograms = [...programPerformance]
      .sort((a, b) => b.commissionEarned - a.commissionEarned || b.conversions - a.conversions)
      .slice(0, 5);

    const topLinks = [...referralLinkPerformance]
      .sort((a, b) => b.commissionEarned - a.commissionEarned || b.clicks - a.clicks)
      .slice(0, 5);

    const topCampaigns = [...campaignPerformance].slice(0, 5);

    // Dynamic Insights
    const insights: Array<{ type: 'positive' | 'neutral' | 'warning' | 'info'; title: string; message: string }> = [];

    if (trends.clicks !== undefined) {
      if (trends.clicks > 0) {
        insights.push({
          type: 'positive',
          title: 'Traffic Velocity Surge',
          message: `Referral traffic grew by ${trends.clicks}% compared to the prior window (${totalClicks} vs ${prevClicksCount} clicks).`,
        });
      } else if (trends.clicks < 0) {
        insights.push({
          type: 'neutral',
          title: 'Traffic Dip',
          message: `Click volume decreased by ${Math.abs(trends.clicks)}% compared to the prior window. Sharing new links or assets could re-engage visitors.`,
        });
      }
    }

    if (topPrograms.length > 0 && topPrograms[0].commissionEarned > 0) {
      insights.push({
        type: 'info',
        title: 'Top Contributing Program',
        message: `"${topPrograms[0].programName}" is currently your highest-yield program, generating ${topPrograms[0].commissionEarned} in earned commissions.`,
      });
    }

    if (pendingCommission > 0) {
      insights.push({
        type: 'info',
        title: 'Pending Review Balance',
        message: `You have estimated pending commissions awaiting review/approval. These will become payable once the hold window concludes.`,
      });
    }

    if (totalClicks > 0 && totalConversions === 0) {
      insights.push({
        type: 'warning',
        title: 'Conversion Optimization',
        message: `You have recorded ${totalClicks} clicks with no checkouts yet. Consider pointing links directly to high-converting product or promotional landing pages.`,
      });
    } else if (conversionRate >= 5) {
      insights.push({
        type: 'positive',
        title: 'High Conversion Efficiency',
        message: `Your conversion rate of ${conversionRate}% is strong. Your traffic sources are converting effectively.`,
      });
    }

    // Tier Progress & Milestones
    let currentTierDef: any = null;
    let orgTiers: any[] = [];
    const orgIdForTier = organizationId || scopedAffiliates[0]?.organizationId;

    if (orgIdForTier) {
      orgTiers = await partnerTiers.find({
        where: { organizationId: orgIdForTier, isActive: true },
        order: { level: 'ASC' },
      });
    }

    const DEFAULT_TIER_LADDER = [
      {
        id: 'tier_bronze',
        name: 'Bronze Partner',
        code: 'BRONZE',
        level: 1,
        badge: 'Bronze Affiliate',
        colorToken: 'bronze',
        description: 'Entry-level tier for all enrolled partners. Start driving conversions to level up.',
        commissionRateOverride: 1500,
        conditions: { minimumConversions: 0 },
      },
      {
        id: 'tier_silver',
        name: 'Silver Partner',
        code: 'SILVER',
        level: 2,
        badge: 'Silver Affiliate',
        colorToken: 'silver',
        description: 'Accelerated tier for active partners with higher commissions and faster review windows.',
        commissionRateOverride: 1750,
        conditions: { minimumConversions: 10 },
      },
      {
        id: 'tier_gold',
        name: 'Gold Partner',
        code: 'GOLD',
        level: 3,
        badge: 'Gold Affiliate',
        colorToken: 'gold',
        description: 'Premier tier offering enhanced commission rates, exclusive marketing assets, and priority support.',
        commissionRateOverride: 2000,
        conditions: { minimumConversions: 50 },
      },
      {
        id: 'tier_platinum',
        name: 'Platinum Partner',
        code: 'PLATINUM',
        level: 4,
        badge: 'Platinum Affiliate',
        colorToken: 'platinum',
        description: 'Top-tier VIP status with highest commission rates, dedicated affiliate manager, and custom terms.',
        commissionRateOverride: 2500,
        conditions: { minimumConversions: 100 },
      },
    ];

    const effectiveOrgTiers = orgTiers.length > 0 ? orgTiers : DEFAULT_TIER_LADDER;

    for (const aff of scopedAffiliates) {
      const affTier = await affiliateTiers.findOne({ where: { organizationId: aff.organizationId, affiliateId: aff.id } });
      if (!affTier?.currentTierId) continue;
      const tierDef = await partnerTiers.findOne({ where: { id: affTier.currentTierId } });
      if (!tierDef) continue;
      if (!currentTierDef || tierDef.level > currentTierDef.level) {
        currentTierDef = tierDef;
      }
    }

    const qualifiedConversions = currentConversions.filter((c: any) => c.status !== ConversionStatus.REJECTED).length;

    if (!currentTierDef) {
      // Pick highest eligible tier based on qualified conversions
      const eligible = effectiveOrgTiers.filter((t) => {
        const req = t.conditions?.minimumConversions ?? 0;
        return qualifiedConversions >= req;
      });
      currentTierDef = eligible.length > 0 ? eligible[eligible.length - 1] : effectiveOrgTiers[0];
    }

    const currentLevel = currentTierDef?.level || 1;
    const nextTierDef = effectiveOrgTiers.find((t) => t.level > currentLevel);

    const nextTierRequiredConversions = nextTierDef?.conditions?.minimumConversions ?? (currentLevel === 1 ? 10 : currentLevel === 2 ? 50 : 100);
    const conversionsRemaining = nextTierDef ? Math.max(0, nextTierRequiredConversions - qualifiedConversions) : 0;
    const progressPercentage = nextTierDef
      ? (nextTierRequiredConversions > 0
        ? Math.min(100, Math.round((qualifiedConversions / nextTierRequiredConversions) * 100))
        : 100)
      : 100;

    const tierProgress = {
      currentTier: {
        id: currentTierDef?.id || 'tier_bronze',
        name: currentTierDef?.name || 'Bronze Partner',
        code: currentTierDef?.code || 'BRONZE',
        level: currentLevel,
        badge: currentTierDef?.badge || 'Bronze Affiliate',
        colorToken: currentTierDef?.colorToken || 'bronze',
        description: currentTierDef?.description || 'Starting tier for enrolled partners.',
        commissionRateOverride: currentTierDef?.commissionRateOverride || 1500,
      },
      nextTier: nextTierDef ? {
        id: nextTierDef.id,
        name: nextTierDef.name,
        code: nextTierDef.code,
        level: nextTierDef.level,
        badge: nextTierDef.badge,
        colorToken: nextTierDef.colorToken,
        description: nextTierDef.description,
        requiredConversions: nextTierRequiredConversions,
      } : null,
      progressPercentage,
      currentConversions: qualifiedConversions,
      nextTierRequiredConversions,
      conversionsRemaining,
      effectiveCommissionRate: currentTierDef?.commissionRateOverride || 1500,
    };

    return {
      summary: {
        totalClicks,
        uniqueClicks,
        totalConversions,
        conversionRate,
        totalCommission,
        pendingCommission,
        approvedCommission,
        paidCommission,
        reversedCommission,
        averageCommission,
        activePrograms,
        totalReferralLinks,
        attributedRevenue,
      },
      trends,
      conversionFunnel,
      commissionBreakdown,
      programPerformance,
      referralLinkPerformance,
      campaignPerformance,
      earningsByProgram,
      topPerformers: {
        topPrograms,
        topLinks,
        topCampaigns,
      },
      insights,
      tierProgress,
    };
  }
}

