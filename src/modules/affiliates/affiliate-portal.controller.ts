import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { v4 as uuidv4 } from 'uuid';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { dbStore } from '../../database/store';
import { AffiliateStatus, TrackingLinkStatus, EnvironmentType, PayoutStatus } from '../../common/enums';
import { SecurityUtils } from '../../common/utils/security.utils';
import { AuthService } from '../auth/auth.service';
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
} from '../../database/schema';
import { IsNull, In } from 'typeorm';
import { UserStatus, PlatformRole } from '../../common/enums';
import { assertUserEligibleForAffiliate } from './affiliate-eligibility.policy';
import { AffiliatesService } from './affiliates.service';

@ApiTags('Affiliate Self Portal')
@Controller()
export class AffiliatePortalController {
  constructor(
    @Optional() private readonly authService?: AuthService,
    private readonly affiliatesService?: AffiliatesService,
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
    };
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
        country: 'India',
        partnerType: 'AFFILIATE',
        primaryMarket: 'India',
        audienceSize: '0-1k',
        socialProfiles: {},
        bio: '',
        onboardingCompleted: false,
        taxCountry: 'India',
        panOrTaxId: '',
        taxClassification: 'INDIVIDUAL',
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
  @Post('api/v1/affiliate/legacy/auth/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new affiliate account' })
  async affiliateRegister(@Body() body: any, @Req() req: any) {
    const { fullName, email, password, partnerType } = body || {};

    if (!email || !password || !fullName) {
      throw new BadRequestException('fullName, email, and password are required.');
    }

    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    const normalizedEmail = (email as string).toLowerCase().trim();
    assertUserEligibleForAffiliate(normalizedEmail);

    const nameParts = (fullName as string).trim().split(/\s+/);
    const firstName = nameParts[0] || 'Partner';
    const lastName = nameParts.slice(1).join(' ') || '';

    const { users, affiliatePortalProfiles } = await this.repositories();

    const existing = await users.findOne({
      where: { email: normalizedEmail, deletedAt: IsNull() },
    });
    if (existing) {
      throw new BadRequestException('An account with this email already exists.');
    }

    const passwordHash = await SecurityUtils.hashPassword(password);
    const newUser = users.create({
      email: normalizedEmail,
      passwordHash,
      firstName,
      lastName,
      status: UserStatus.ACTIVE,
      emailVerified: false,
      platformRole: PlatformRole.AFFILIATE,
      failedLoginAttempts: 0,
    });
    const savedUser = await users.save(newUser);

    if (dbStore.users && !dbStore.users.some((item) => item.id === savedUser.id)) {
      dbStore.users.push(savedUser);
    }

    await affiliatePortalProfiles.save(affiliatePortalProfiles.create({
      userId: savedUser.id,
      email: normalizedEmail,
      fullName,
      partnerType: partnerType || 'AFFILIATE',
      country: 'India',
      primaryMarket: 'India',
      audienceSize: '0-1k',
      socialProfiles: {},
      onboardingCompleted: false,
      taxCountry: 'India',
      taxClassification: 'INDIVIDUAL',
      withholdingRate: 0,
      taxVerified: false,
      taxFormType: 'PAN_TDS',
    }));

    if (this.authService) {
      const loginResult = await this.authService.login(
        { email: normalizedEmail, password },
        req.headers['user-agent'],
        req.ip || req.headers['x-forwarded-for'],
        { allowAffiliate: true },
      );
      return {
        success: true,
        data: {
          ...loginResult,
          userId: savedUser.id,
          email: savedUser.email,
          firstName: savedUser.firstName,
          lastName: savedUser.lastName,
          fullName: `${savedUser.firstName} ${savedUser.lastName}`.trim(),
          message: 'Affiliate account created successfully.',
        },
      };
    }

    return {
      success: true,
      data: {
        userId: savedUser.id,
        email: savedUser.email,
        firstName: savedUser.firstName,
        lastName: savedUser.lastName,
        fullName: `${savedUser.firstName} ${savedUser.lastName}`.trim(),
        message: 'Affiliate account created successfully.',
      },
    };
  }

  @Get('api/v1/affiliate/me/profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current affiliate user profile' })
  async getProfile(@Req() req: any) {
    return this.serializeAffiliateProfile(req);
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

    if (user && user.id) {
      if (body.fullName) {
        const parts = body.fullName.trim().split(' ');
        user.firstName = parts[0] || user.firstName;
        user.lastName = parts.slice(1).join(' ') || user.lastName;
      }
      if (body.avatarUrl !== undefined) {
        user.avatarUrl = body.avatarUrl;
      }
      if (body.password) {
        if (body.password.length < 8) {
          throw new BadRequestException('Password must be at least 8 characters long.');
        }
        user.passwordHash = await SecurityUtils.hashPassword(body.password);
      }
      await users.save(user);
    }
    await affiliatePortalProfiles.save(profile);

    return this.serializeAffiliateProfile(req);
  }

  @Get('api/v1/affiliate/me/dashboard')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aggregated affiliate dashboard metrics' })
  async getDashboard(@Req() req: any, @Query('organizationId') organizationId?: string) {
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

    const { trackingLinks, conversions, commissions, payoutItems, programAffiliates } = await this.repositories();

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

    const totalEarnings = commList.reduce((sum, c: any) => sum + Number(c.amount || c.commissionAmount || 0), 0);
    const pendingCommission = commList
      .filter((c: any) => c.status === 'PENDING')
      .reduce((sum, c: any) => sum + Number(c.amount || c.commissionAmount || 0), 0);
    const payableCommission = commList
      .filter((c: any) => c.status === 'PAYABLE' || c.status === 'APPROVED')
      .reduce((sum, c: any) => sum + Number(c.amount || c.commissionAmount || 0), 0);
    const paidCommission = poList.reduce((sum, item: any) => sum + Number(item.amount || (item as any).netAmount || 0), 0);
    const clicks = links.reduce((sum, link: any) => sum + Number((link as any).clickCount || (link as any).clicks || 0), 0);
    const revenue = convList.reduce((sum, conversion: any) => sum + Number(conversion.amount || (conversion as any).value || 0), 0);

    return {
      totalEarnings,
      pendingCommission,
      payableCommission,
      paidCommission,
      clicks,
      uniqueVisitors: Math.round(clicks * 0.82),
      conversions: convList.length,
      conversionRate: clicks > 0 ? Number(((convList.length / clicks) * 100).toFixed(2)) : 0,
      revenue,
      currentTier: {
        name: scopedAffiliates.length ? 'Standard Partner' : 'Not enrolled',
        tierLevel: scopedAffiliates.length ? 1 : 0,
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
            defaultCurrency: 'USD',
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
      const totalEarnings = comms.reduce((acc, c: any) => acc + Number(c.amount || c.commissionAmount || 0), 0);
      const pendingCommission = comms
        .filter((c: any) => c.status === 'PENDING')
        .reduce((acc, c: any) => acc + Number(c.amount || c.commissionAmount || 0), 0);
      const payableCommission = comms
        .filter((c: any) => c.status === 'PAYABLE' || c.status === 'APPROVED')
        .reduce((acc, c: any) => acc + Number(c.amount || c.commissionAmount || 0), 0);
      const paidCommission = pos.reduce((acc, p: any) => acc + Number(p.amount || (p as any).netAmount || 0), 0);
      const attributedRevenue = convs.reduce((acc, c: any) => acc + Number(c.amount || (c as any).value || 0), 0);

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
          currency: (org as any).defaultCurrency || (org as any).currency || 'USD',
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
          perks: [
            `${(t.conditions as any)?.minimumConversions || 0}+ conversions threshold`,
            t.description || 'Tier reward benefits',
            'Automated monthly payouts',
          ],
        }));

      return {
        id: p.id,
        organizationId: p.organizationId,
        organizationName: org?.name,
        name: p.name,
        slug: p.slug,
        description: (p as any).description || `Official ${p.name} for content creators and partners.`,
        type: (p as any).type || 'RECURRING',
        commissionSummary: isFlat ? `$${rate} per activation` : `${rate}% recurring lifetime`,
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
        tiers: tiers.length > 0 ? tiers : [
          { id: 'tier_1', name: 'Standard Partner', minMonthlyRevenue: 0, commissionRateBonus: 0, perks: ['Standard cookie attribution', 'Monthly payouts'] },
          { id: 'tier_2', name: 'Gold Partner', minMonthlyRevenue: 5000, commissionRateBonus: 5, perks: ['+5% commission bonus', 'Dedicated Partner Manager'] },
        ],
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
  ) {
    const { programs, organizations, organizationBrandings } = await this.repositories();
    let targetOrgId = organizationId;
    if (!targetOrgId && slug) {
      const cleanSlug = slug.toLowerCase().trim();
      const matchedOrg = await organizations.findOne({ where: { slug: cleanSlug } });
      if (matchedOrg) targetOrgId = matchedOrg.id;
    }

    const whereClause: any = { deletedAt: IsNull() };
    if (targetOrgId) {
      whereClause.organizationId = targetOrgId;
    }
    const programList = await programs.find({ where: whereClause });
    const orgIds = [...new Set(programList.map((p) => p.organizationId))];
    const orgList = orgIds.length ? await organizations.find({ where: { id: In(orgIds) } }) : [];
    const brandingList = orgIds.length ? await organizationBrandings.find({ where: { organizationId: In(orgIds) } }) : [];
    const brandingMap: Record<string, any> = {};
    for (const b of brandingList) brandingMap[b.organizationId] = b;

    return programList.map((p) => {
      const org = orgList.find((o) => o.id === p.organizationId);
      const isFlat = (p as any).commissionType === 'FIXED_AMOUNT';
      const rate = p.defaultCommissionValue ? (isFlat ? p.defaultCommissionValue / 100 : p.defaultCommissionValue / 100) : 25;

      return {
        id: p.id,
        organizationId: p.organizationId,
        brandName: org?.name || 'PartnerIQ Brand',
        brandLogo: (brandingMap[org?.id]?.logoUrl) || (org as any)?.branding?.logoUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80',
        title: p.name,
        slug: p.slug,
        category: (p as any).category || 'SAAS',
        commission: isFlat ? `$${rate} Flat` : `${rate}% Recurring`,
        cookieWindow: `${p.cookieDurationDays || 60} Days`,
        avgEpc: '$4.20',
        featured: (p as any).featured ?? true,
        affiliateApprovalMode: p.affiliateApprovalMode || 'AUTO',
        instantApproval: p.affiliateApprovalMode === 'AUTO',
        description: (p as any).description || `Earn high-converting commissions with ${org?.name || p.name}.`,
      };
    });
  }

  @Get('api/v1/public/organizations/:slug/programs')
  @ApiOperation({ summary: 'Public programs for specific organization by slug' })
  async getPublicProgramsByOrg(
    @Param('slug') slug: string,
    @Query('category') category?: string,
  ) {
    return this.getPublicPrograms(category, undefined, slug);
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
        commissionSummary: isFlat ? `$${rate} Flat` : `${rate}% Recurring`,
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
      commissionSummary: isFlat ? `$${rate} Flat` : `${rate}% Recurring`,
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
        .reduce((acc, c: any) => acc + Number(c.amount || c.commissionAmount || 0), 0);

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

    const link = trackingLinks.create({
      id: uuidv4(),
      organizationId: orgId,
      environment: EnvironmentType.LIVE,
      programId: prog.id,
      affiliateId: affiliate.id,
      destinationUrl: body.destinationUrl || (prog as any)?.landingPageUrl || '',
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
    }
    return { success: true };
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
        currency: (org as any)?.defaultCurrency || (org as any)?.currency || 'USD',
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
        currency: batch?.currency || (org as any)?.defaultCurrency || 'USD',
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
    const { organizations, affiliates, commissions, payoutBatches, payoutItems } = await this.repositories();

    const org = await organizations.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');

    const affiliate = await affiliates.findOne({
      where: { organizationId: org.id, email: email.toLowerCase().trim() },
    });
    if (!affiliate) throw new BadRequestException('Join this organization before requesting a payout.');

    const payableCommissions = await commissions.find({
      where: {
        organizationId: org.id,
        affiliateId: affiliate.id,
        status: In(['PAYABLE', 'APPROVED']),
      },
    });

    const grossAmount = payableCommissions.reduce(
      (sum, commission: any) => sum + Number(commission.amount || commission.commissionAmount || 0),
      0,
    );
    if (grossAmount <= 0) throw new BadRequestException('No payable balance is available.');

    const batch = payoutBatches.create({
      id: uuidv4(),
      organizationId: org.id,
      environment: EnvironmentType.LIVE,
      totalAmount: grossAmount,
      currency: (org as any).defaultCurrency || 'USD',
      status: PayoutStatus.PROCESSING,
      createdBy: affiliate.id,
      createdAt: new Date(),
    });
    await payoutBatches.save(batch);

    const newPayout = payoutItems.create({
      id: uuidv4(),
      batchId: batch.id,
      organizationId: org.id,
      environment: EnvironmentType.LIVE,
      affiliateId: affiliate.id,
      amount: grossAmount,
      currency: (org as any).defaultCurrency || 'USD',
      status: PayoutStatus.PROCESSING,
      providerReference: `instant_${uuidv4().slice(0, 8)}`,
      createdAt: new Date(),
    });
    await payoutItems.save(newPayout);

    if (dbStore.payoutItems) {
      dbStore.payoutItems.unshift(newPayout as any);
    }

    return {
      id: newPayout.id,
      organizationId: org.id,
      organizationName: org.name,
      amount: grossAmount,
      currency: (org as any).defaultCurrency || (org as any).currency || 'USD',
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
      commissionCount: payableCommissions.length,
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

    return this.serializePayoutMethod(await affiliatePayoutMethods.save(newMethod));
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
    if (method) await affiliatePayoutMethods.remove(method);
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
    return this.affiliatesService?.acceptInvitationForEmail(invitationId, email, {
      acceptedTerms: true,
      termsVersionAccepted: body?.termsVersionAccepted || 1,
    }, req.user?.userId || req.user?.sub);
  }

  @Post('api/v1/affiliate/me/invitations/:invitationId/decline')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Decline affiliate invitation' })
  async declineInvitation(@Req() req: any, @Param('invitationId') invitationId: string) {
    const email = this.resolveAffiliateEmail(req);
    return this.affiliatesService?.declineInvitationForEmail(invitationId, email, req.user?.userId || req.user?.sub);
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
        commissions: dayCommissions.reduce((sum, commission: any) => sum + Number(commission.amount || (commission as any).commissionAmount || 0), 0),
      });
    }

    return result;
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

    return affiliateSupportTickets.save(ticket);
  }
}
