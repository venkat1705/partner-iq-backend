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
import { AffiliateStatus, TrackingLinkStatus, EnvironmentType } from '../../common/enums';
import { SecurityUtils } from '../../common/utils/security.utils';
import { AuthService } from '../auth/auth.service';
import { initializeDataSource } from '../../database/data-source';
import { AffiliatePayoutMethod, AffiliatePortalProfile, AffiliateSupportTicket, User } from '../../database/schema';
import { IsNull } from 'typeorm';
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
      affiliatePortalProfiles: dataSource.getRepository(AffiliatePortalProfile),
      affiliatePayoutMethods: dataSource.getRepository(AffiliatePayoutMethod),
      affiliateSupportTickets: dataSource.getRepository(AffiliateSupportTicket),
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
    const isOnboarded = Boolean(
      profile.onboardingCompleted ?? (profile.primaryMarket && (profile.bio || profile.website))
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email.split('@')[0],
        avatarUrl: user.avatarUrl || '',
        is2faEnabled: Boolean((user as any).mfa?.enabled || (user as any).mfaEnabled),
        googleConnected: dbStore.userIdentities.some((item) => item.userId === user.id && item.provider === 'GOOGLE'),
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

  private resolveAffiliatesForUser(email: string) {
    const matched = dbStore.affiliates.filter((a) => a.email.toLowerCase() === email);
    return matched;
  }

  // ----------------------------------------------------
  // Affiliate Auth — Register (relaxed rules for affiliates)
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

    const dataSource = await initializeDataSource();
    const users = dataSource.getRepository(User);

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

    if (!dbStore.users.some((item) => item.id === savedUser.id)) {
      dbStore.users.push(savedUser);
    }

    const { affiliatePortalProfiles } = await this.repositories();
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

    // Use AuthService to create session tokens if available
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

    if (user) {
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
    const affiliates = this.resolveAffiliatesForUser(email);
    const scopedAffiliates = organizationId ? affiliates.filter((affiliate) => affiliate.organizationId === organizationId) : affiliates;
    const affiliateIds = scopedAffiliates.map((affiliate) => affiliate.id);
    const links = dbStore.trackingLinks.filter((link) => affiliateIds.includes(link.affiliateId));
    const conversions = dbStore.conversions.filter((conversion) => affiliateIds.includes(conversion.affiliateId));
    const commissions = dbStore.commissions.filter((commission) => affiliateIds.includes(commission.affiliateId));
    const payoutItems = dbStore.payoutItems.filter((item) => affiliateIds.includes(item.affiliateId));

    const totalEarnings = commissions.reduce((sum, commission: any) => sum + (commission.amount || commission.commissionAmount || 0), 0);
    const pendingCommission = commissions
      .filter((commission: any) => commission.status === 'PENDING')
      .reduce((sum, commission: any) => sum + (commission.amount || commission.commissionAmount || 0), 0);
    const payableCommission = commissions
      .filter((commission: any) => commission.status === 'PAYABLE' || commission.status === 'APPROVED')
      .reduce((sum, commission: any) => sum + (commission.amount || commission.commissionAmount || 0), 0);
    const paidCommission = payoutItems.reduce((sum, item: any) => sum + (item.netAmount || item.amount || 0), 0);
    const clicks = links.reduce((sum, link: any) => sum + (link.clickCount || link.clicks || 0), 0);
    const revenue = conversions.reduce((sum, conversion: any) => sum + (conversion.amount || conversion.value || 0), 0);

    return {
      totalEarnings,
      pendingCommission,
      payableCommission,
      paidCommission,
      clicks,
      uniqueVisitors: Math.round(clicks * 0.82),
      conversions: conversions.length,
      conversionRate: clicks > 0 ? Number(((conversions.length / clicks) * 100).toFixed(2)) : 0,
      revenue,
      currentTier: {
        name: scopedAffiliates.length ? 'Standard Partner' : 'Not enrolled',
        tierLevel: scopedAffiliates.length ? 1 : 0,
        minEarnings: 0,
      },
      topLinks: links.slice(0, 5),
      topPrograms: dbStore.programAffiliates.filter((item) => affiliateIds.includes(item.affiliateId)).slice(0, 5),
      recentConversions: conversions.slice(0, 5),
      recentPayouts: payoutItems.slice(0, 5),
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
    const affiliates = this.resolveAffiliatesForUser(email);

    const partnerships = [];

    for (const org of dbStore.organizations) {
      const aff = affiliates.find((a) => a.organizationId === org.id);
      if (!aff) continue;

      // Find program affiliations
      const progAffs = dbStore.programAffiliates.filter(
        (pa) => pa.organizationId === org.id && pa.affiliateId === aff.id,
      );

      // Find tracking links
      const links = dbStore.trackingLinks.filter(
        (tl) => tl.organizationId === org.id && tl.affiliateId === aff.id,
      );

      // Find conversions
      const conversions = dbStore.conversions.filter(
        (c) => c.organizationId === org.id && c.affiliateId === aff.id,
      );

      // Find commissions
      const commissions = dbStore.commissions.filter(
        (c) => c.organizationId === org.id && c.affiliateId === aff.id,
      );

      // Find payouts
      const payoutItems = dbStore.payoutItems.filter(
        (pi) => pi.affiliateId === aff.id,
      );

      const totalClicks = links.reduce((acc, l) => acc + ((l as any).clickCount || (l as any).clicks || 0), 0);
      const totalEarnings = commissions.reduce((acc, c) => acc + ((c as any).amount || (c as any).commissionAmount || 0), 0);
      const pendingCommission = commissions
        .filter((c: any) => c.status === 'PENDING')
        .reduce((acc, c) => acc + ((c as any).amount || (c as any).commissionAmount || 0), 0);
      const payableCommission = commissions
        .filter((c: any) => c.status === 'PAYABLE' || c.status === 'APPROVED')
        .reduce((acc, c) => acc + ((c as any).amount || (c as any).commissionAmount || 0), 0);
      const paidCommission = payoutItems.reduce((acc, p) => acc + ((p as any).netAmount || p.amount || 0), 0);
      const attributedRevenue = conversions.reduce((acc, c) => acc + (c.amount || (c as any).value || 0), 0);

      // Tier name
      const affTier = dbStore.affiliateTiers.find(
        (at) => at.organizationId === org.id && at.affiliateId === aff.id,
      );
      const tierDef = affTier ? dbStore.partnerTiers.find((t) => t.id === affTier.currentTierId) : null;

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
        conversions: conversions.length,
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
            primaryColor: (org as any).branding?.primaryColor || (org.slug === 'zenpay' ? '158 64% 40%' : '221 83% 53%'),
            accentColor: (org as any).branding?.accentColor || (org.slug === 'zenpay' ? '173 80% 36%' : '262 83% 58%'),
            logoUrl: (org as any).branding?.logoUrl || (org.slug === 'zenpay'
              ? 'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=120&auto=format&fit=crop&q=80'
              : 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80'),
            coverImageUrl: (org as any).branding?.coverImageUrl,
            headline: (org as any).branding?.headline || `Partner with ${org.name}`,
            tagline: (org as any).branding?.tagline || `Earn competitive recurring commissions with ${org.name}.`,
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
    const affiliates = this.resolveAffiliatesForUser(email);

    let programs = dbStore.programs.filter((p) => !p.deletedAt);
    if (organizationId) {
      programs = programs.filter((p) => p.organizationId === organizationId);
    }

    return programs.map((p) => {
      const org = dbStore.organizations.find((o) => o.id === p.organizationId);
      const aff = affiliates.find((a) => a.organizationId === p.organizationId);
      const progAff = aff ? dbStore.programAffiliates.find((pa) => pa.programId === p.id && pa.affiliateId === aff.id) : null;
      const isFlat = (p as any).commissionType === 'FIXED_AMOUNT';
      const rate = p.defaultCommissionValue ? (isFlat ? p.defaultCommissionValue / 100 : p.defaultCommissionValue / 100) : 20;

      // Partner Tiers
      const tiers = dbStore.partnerTiers
        .filter((t) => t.organizationId === p.organizationId && (!t.programId || t.programId === p.id) && t.isActive && !t.deletedAt)
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
  async getPublicPrograms(@Query('category') category?: string) {
    let programs = dbStore.programs.filter((p) => !p.deletedAt);
    return programs.map((p) => {
      const org = dbStore.organizations.find((o) => o.id === p.organizationId);
      const isFlat = (p as any).commissionType === 'FIXED_AMOUNT';
      const rate = p.defaultCommissionValue ? (isFlat ? p.defaultCommissionValue / 100 : p.defaultCommissionValue / 100) : 25;

      return {
        id: p.id,
        organizationId: p.organizationId,
        brandName: org?.name || 'PartnerIQ Brand',
        brandLogo: (org as any)?.branding?.logoUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80',
        title: p.name,
        slug: p.slug,
        category: (p as any).category || 'SAAS',
        commission: isFlat ? `$${rate} Flat` : `${rate}% Recurring`,
        cookieWindow: `${p.cookieDurationDays || 60} Days`,
        avgEpc: '$4.20',
        featured: (p as any).featured ?? true,
        instantApproval: p.affiliateApprovalMode === 'AUTO',
        description: (p as any).description || `Earn high-converting commissions with ${org?.name || p.name}.`,
      };
    });
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
    const affiliates = this.resolveAffiliatesForUser(email);
    const affiliateIds = affiliates.map((a) => a.id);

    let links = dbStore.trackingLinks.filter((tl) => affiliateIds.includes(tl.affiliateId));
    if (organizationId) {
      links = links.filter((tl) => tl.organizationId === organizationId);
    }

    return links.map((l) => {
      const prog = dbStore.programs.find((p) => p.id === l.programId);
      const org = dbStore.organizations.find((o) => o.id === l.organizationId);
      const clicks = (l as any).clickCount || (l as any).clicks || 0;
      const conversions = dbStore.conversions.filter((c: any) => c.trackingLinkId === l.id).length;
      const commissionEarned = dbStore.commissions
        .filter((c: any) => c.trackingLinkId === l.id)
        .reduce((acc, c) => acc + ((c as any).amount || (c as any).commissionAmount || 0), 0);

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
        campaign: (l as any).campaign || '',
        subId: (l as any).subId || '',
        clicks,
        uniqueVisitors: Math.round(clicks * 0.82),
        conversions,
        revenue: conversions * 120,
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
    let affiliate = dbStore.affiliates.find((a) => a.organizationId === orgId && a.email.toLowerCase() === email);

    if (!affiliate) {
      throw new BadRequestException('Join this organization as an affiliate before creating links.');
    }

    const shortCode = body.slug || body.customAlias || SecurityUtils.generateRandomCode(8).toLowerCase();
    const prog = dbStore.programs.find((p) => p.id === body.programId && p.organizationId === orgId);
    if (!prog) throw new NotFoundException('Program not found');
    const membership = dbStore.programAffiliates.find((item) => item.organizationId === orgId && item.programId === prog.id && item.affiliateId === affiliate.id && item.status === AffiliateStatus.ACTIVE);
    if (!membership) {
      throw new BadRequestException('You must be an active member of this program before creating links.');
    }

    const link = {
      id: uuidv4(),
      organizationId: orgId,
      environment: EnvironmentType.LIVE,
      programId: prog.id,
      affiliateId: affiliate.id,
      destinationUrl: body.destinationUrl || (prog as any)?.landingPageUrl || '',
      shortCode,
      status: TrackingLinkStatus.ACTIVE,
      title: body.title || 'Custom Tracking Link',
      customAlias: body.customAlias,
      campaign: body.campaign,
      subId: body.subId,
      clicks: 0,
      createdAt: new Date(),
    };

    dbStore.trackingLinks.unshift(link as any);

    const org = dbStore.organizations.find((o) => o.id === orgId);
    return {
      id: link.id,
      organizationId: link.organizationId,
      programId: link.programId,
      programName: prog.name,
      title: link.title,
      slug: link.shortCode,
      destinationUrl: link.destinationUrl,
      trackingUrl: `https://${org?.slug || 'go'}.partneriq.in/r/${link.shortCode}`,
      customAlias: link.customAlias,
      campaign: link.campaign,
      subId: link.subId,
      clicks: 0,
      uniqueVisitors: 0,
      conversions: 0,
      revenue: 0,
      commissionEarned: 0,
      isArchived: false,
      createdAt: link.createdAt,
    };
  }

  @Delete('api/v1/affiliate/me/links/:linkId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Archive/delete tracking link' })
  async deleteLink(@Req() req: any, @Param('linkId') linkId: string) {
    const email = this.resolveAffiliateEmail(req);
    const affiliateIds = this.resolveAffiliatesForUser(email).map((affiliate) => affiliate.id);
    const idx = dbStore.trackingLinks.findIndex((l) => l.id === linkId && affiliateIds.includes(l.affiliateId));
    if (idx !== -1) {
      dbStore.trackingLinks[idx].status = TrackingLinkStatus.INACTIVE;
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
    const orgIds = this.resolveAffiliatesForUser(email).map((affiliate) => affiliate.organizationId);
    let coupons = dbStore.billingCoupons.filter((coupon: any) => coupon.organizationId && orgIds.includes(coupon.organizationId));
    if (organizationId) {
      coupons = coupons.filter((c: any) => c.organizationId === organizationId);
    }

    return coupons.map((c: any) => ({
      id: c.id,
      organizationId: c.organizationId,
      programId: c.programId || '',
      code: c.code,
      discountSummary: c.discountSummary || (c.type === 'PERCENTAGE' ? `${c.amountOrPercentage || 0}% off` : `$${(c.amountOrPercentage || 0) / 100} discount`),
      discountType: c.type || 'PERCENTAGE',
      discountValue: c.amountOrPercentage || 0,
      uses: c.timesRedeemed || 0,
      conversions: c.timesRedeemed || 0,
      revenueGenerated: c.revenueGenerated || 0,
      commissionEarned: c.commissionEarned || 0,
      status: c.status || 'ACTIVE',
    }));
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
    const orgIds = this.resolveAffiliatesForUser(email).map((affiliate) => affiliate.organizationId);
    let assets = dbStore.assets.filter((asset) => orgIds.includes(asset.organizationId));
    if (organizationId) {
      assets = assets.filter((a) => a.organizationId === organizationId);
    }

    return assets.map((a: any) => ({
      id: a.id,
      organizationId: a.organizationId,
      programId: a.programId,
      title: a.title || 'Marketing Asset',
      type: a.type || 'BANNER',
      fileSize: a.fileSize,
      dimensions: a.dimensions,
      previewUrl: a.previewUrl || a.fileUrl || '',
      downloadUrl: a.fileUrl || '',
      copyContent: a.copyContent || a.bodyContent || null,
      tags: a.tags || [],
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
    const affiliates = this.resolveAffiliatesForUser(email);
    const affiliateIds = affiliates.map((a) => a.id);

    let conversions = dbStore.conversions.filter((c) => affiliateIds.includes(c.affiliateId));
    if (organizationId) {
      conversions = conversions.filter((c) => c.organizationId === organizationId);
    }

    return conversions.map((c: any) => {
      const prog = dbStore.programs.find((p) => p.id === c.programId);
      const link = dbStore.trackingLinks.find((l) => l.id === c.trackingLinkId);
      const comm = dbStore.commissions.find((cm) => cm.conversionId === c.id);

      return {
        id: c.id,
        organizationId: c.organizationId,
        programId: c.programId,
        programName: prog?.name || 'Partner Program',
        orderId: c.externalOrderId || c.externalId || `ORD-${c.id.slice(0, 6).toUpperCase()}`,
        source: link?.shortCode || c.source || 'direct-referral',
        customerMasked: c.customerMasked || (c.customerEmail ? `${c.customerEmail.slice(0, 2)}***@${c.customerEmail.split('@')[1] || 'domain.com'}` : 'Customer'),
        value: c.amount || 0,
        attributedValue: c.amount || 0,
        commissionAmount: (comm as any)?.amount || (comm as any)?.commissionAmount || 0,
        status: c.status,
        clickTimestamp: c.clickTimestamp || new Date(new Date(c.createdAt).getTime() - 3600000).toISOString(),
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
    const affiliates = this.resolveAffiliatesForUser(email);
    const affiliateIds = affiliates.map((a) => a.id);

    let commissions = dbStore.commissions.filter((c) => affiliateIds.includes(c.affiliateId));
    if (organizationId) {
      commissions = commissions.filter((c) => c.organizationId === organizationId);
    }

    return commissions.map((c: any) => {
      const org = dbStore.organizations.find((o) => o.id === c.organizationId);
      const prog = dbStore.programs.find((p) => p.id === c.programId);
      const conv = dbStore.conversions.find((cv) => cv.id === c.conversionId);

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
    const affiliates = this.resolveAffiliatesForUser(email);
    const affiliateIds = affiliates.map((a) => a.id);

    let payoutItems = dbStore.payoutItems.filter((pi) => affiliateIds.includes(pi.affiliateId));
    if (organizationId) {
      payoutItems = payoutItems.filter((pi: any) => {
        const batch = dbStore.payoutBatches.find((b) => b.id === pi.payoutBatchId);
        return batch?.organizationId === organizationId;
      });
    }

    return payoutItems.map((pi: any) => {
      const batch = dbStore.payoutBatches.find((b) => b.id === pi.payoutBatchId);
      const org = dbStore.organizations.find((o) => o.id === (batch?.organizationId || organizationId));
      const gross = pi.grossAmount || pi.amount || 0;
      const taxWithheld = pi.taxWithheld || 0;
      const net = pi.netAmount || (gross - taxWithheld);

      return {
        id: pi.id,
        organizationId: batch?.organizationId || organizationId || org?.id,
        organizationName: org?.name || 'Partner',
        amount: net,
        currency: (batch as any)?.currency || (org as any)?.defaultCurrency || 'USD',
        provider: pi.provider || '',
        providerReference: pi.providerReference || `po_${pi.id.slice(0, 8)}`,
        payoutMethodMasked: pi.payoutMethodMasked || '',
        payoutMethodType: pi.payoutMethodType || 'BANK_ACCOUNT',
        status: pi.status || 'PAID',
        scheduledDate: batch?.createdAt || pi.createdAt,
        completedDate: pi.createdAt,
        grossAmount: gross,
        taxWithheld,
        feeDeduction: 0,
        netAmount: net,
        commissionCount: pi.commissionCount || 0,
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
    const org = dbStore.organizations.find((item) => item.id === organizationId);
    if (!org) throw new NotFoundException('Organization not found');
    const affiliate = dbStore.affiliates.find((item) => item.organizationId === org.id && item.email.toLowerCase() === email);
    if (!affiliate) throw new BadRequestException('Join this organization before requesting a payout.');

    const payableCommissions = dbStore.commissions.filter((commission: any) =>
      commission.organizationId === org.id
      && commission.affiliateId === affiliate.id
      && (commission.status === 'PAYABLE' || commission.status === 'APPROVED'),
    );
    const grossAmount = payableCommissions.reduce((sum, commission: any) => sum + (commission.amount || commission.commissionAmount || 0), 0);
    if (grossAmount <= 0) throw new BadRequestException('No payable balance is available.');

    const newPayout = {
      id: `pay_${uuidv4().slice(0, 8)}`,
      payoutBatchId: `batch_${uuidv4().slice(0, 8)}`,
      affiliateId: affiliate.id,
      amount: grossAmount,
      netAmount: grossAmount,
      grossAmount,
      taxWithheld: 0,
      status: 'PENDING',
      commissionCount: payableCommissions.length,
      createdAt: new Date(),
    };

    dbStore.payoutItems.unshift(newPayout as any);

    return {
      id: newPayout.id,
      organizationId: org.id,
      organizationName: org.name,
      amount: grossAmount,
      currency: (org as any).defaultCurrency || (org as any).currency || 'USD',
      provider: '',
      providerReference: `instant_${newPayout.id}`,
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
    return this.affiliatesService?.listInvitationsForEmail(email) || [];
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
  async getSessions() {
    return [];
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
    const count = timeRange === '90d' ? 12 : (timeRange === '30d' ? 10 : 7);
    const affiliates = this.resolveAffiliatesForUser(email);
    const scopedAffiliates = organizationId ? affiliates.filter((affiliate) => affiliate.organizationId === organizationId) : affiliates;
    const affiliateIds = scopedAffiliates.map((affiliate) => affiliate.id);
    const result = [];
    const now = new Date();

    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const dayKey = d.toISOString().slice(0, 10);
      const dayLinks = dbStore.trackingLinks.filter((link: any) =>
        affiliateIds.includes(link.affiliateId)
        && (!organizationId || link.organizationId === organizationId)
        && new Date(link.createdAt).toISOString().slice(0, 10) === dayKey,
      );
      const dayConversions = dbStore.conversions.filter((conversion: any) =>
        affiliateIds.includes(conversion.affiliateId)
        && (!organizationId || conversion.organizationId === organizationId)
        && new Date(conversion.createdAt).toISOString().slice(0, 10) === dayKey,
      );
      const dayCommissions = dbStore.commissions.filter((commission: any) =>
        affiliateIds.includes(commission.affiliateId)
        && (!organizationId || commission.organizationId === organizationId)
        && new Date(commission.createdAt).toISOString().slice(0, 10) === dayKey,
      );

      result.push({
        date: dateStr,
        clicks: dayLinks.reduce((sum, link: any) => sum + (link.clickCount || link.clicks || 0), 0),
        conversions: dayConversions.length,
        revenue: dayConversions.reduce((sum, conversion: any) => sum + (conversion.amount || conversion.value || 0), 0),
        commissions: dayCommissions.reduce((sum, commission: any) => sum + (commission.amount || commission.commissionAmount || 0), 0),
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
    const { affiliateSupportTickets } = await this.repositories();
    const org = dbStore.organizations.find((o) => o.id === body.organizationId);

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
