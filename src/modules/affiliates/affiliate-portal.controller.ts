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
import { User } from '../../database/schema';
import { IsNull } from 'typeorm';
import { UserStatus, PlatformRole } from '../../common/enums';


// In-memory support tickets store
const supportTicketsStore: Array<{
  id: string;
  userId: string;
  organizationId?: string;
  organizationName: string;
  subject: string;
  category: string;
  priority: 'NORMAL' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  message?: string;
  createdAt: string;
  lastReply: string;
}> = [];

// In-memory payout methods store
const payoutMethodsStore: Array<{
  id: string;
  userId: string;
  type: 'BANK_ACCOUNT' | 'UPI' | 'PAYPAL';
  isDefault: boolean;
  bankName?: string;
  accountNumberMasked?: string;
  ifscCode?: string;
  accountHolderName?: string;
  upiIdMasked?: string;
  paypalEmailMasked?: string;
  authorizedOrgIds?: string[];
  createdAt: string;
}> = [];

// In-memory affiliate extra profile store (bio, social profiles, tax info, etc.)
const affiliateProfilesStore: Record<string, any> = {};

@ApiTags('Affiliate Self Portal')
@Controller()
export class AffiliatePortalController {
  constructor(
    @Optional() private readonly authService?: AuthService,
  ) {}

  private resolveAffiliateEmail(req: any): string {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (email) return email;
    return 'venkataramireddyvenky@gmail.com';
  }

  private resolveAffiliatesForUser(email: string) {
    const matched = dbStore.affiliates.filter((a) => a.email.toLowerCase() === email);
    return matched;
  }

  // ----------------------------------------------------
  // Affiliate Auth — Register (relaxed rules for affiliates)
  // ----------------------------------------------------
  @Post('api/v1/affiliate/auth/register')
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
      platformRole: PlatformRole.USER,
      failedLoginAttempts: 0,
    });
    const savedUser = await users.save(newUser);

    if (!dbStore.users.some((item) => item.id === savedUser.id)) {
      dbStore.users.push(savedUser);
    }

    // Store affiliate extra profile
    const emailKey = normalizedEmail;
    if (!affiliateProfilesStore[emailKey]) {
      affiliateProfilesStore[emailKey] = {
        website: '',
        phone: '',
        country: 'India',
        partnerType: partnerType || 'AFFILIATE',
        primaryMarket: '',
        audienceSize: 'Under 10k',
        socialProfiles: {},
        bio: '',
        taxProfile: {
          country: 'India',
          panOrTaxId: '',
          taxClassification: 'INDIVIDUAL',
          withholdingRate: 10,
          isVerified: false,
          formType: 'PAN_TDS',
        },
      };
    }

    // Use AuthService to create session tokens if available
    if (this.authService) {
      const loginResult = await this.authService.login(
        { email: normalizedEmail, password },
        req.headers['user-agent'],
        req.ip || req.headers['x-forwarded-for'],
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
    const email = this.resolveAffiliateEmail(req);
    const user = dbStore.users.find((u) => u.email.toLowerCase() === email) || {
      id: req.user?.userId || 'usr_partner_001',
      email,
      firstName: 'Partner',
      lastName: 'User',
      createdAt: new Date().toISOString(),
    };

    const extraProfile = affiliateProfilesStore[email] || {
      website: '',
      phone: '+91 98765 43210',
      country: 'India',
      partnerType: 'CREATOR',
      primaryMarket: 'SaaS & AI Infrastructure',
      audienceSize: '10k+',
      socialProfiles: {},
      bio: '',
      taxProfile: {
        country: 'India',
        panOrTaxId: 'ABCDE1234F',
        taxClassification: 'INDIVIDUAL',
        withholdingRate: 5,
        isVerified: true,
        formType: 'PAN_TDS',
      },
    };

    return {
      user: {
        id: (user as any).id,
        email: user.email,
        fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email.split('@')[0],
        avatarUrl: (user as any).avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        is2faEnabled: true,
        googleConnected: true,
        createdAt: (user as any).createdAt,
      },
      profile: {
        id: `prof_${(user as any).id || '001'}`,
        userId: (user as any).id,
        website: extraProfile.website,
        phone: extraProfile.phone,
        country: extraProfile.country,
        partnerType: extraProfile.partnerType,
        primaryMarket: extraProfile.primaryMarket,
        audienceSize: extraProfile.audienceSize,
        socialProfiles: extraProfile.socialProfiles || {},
        bio: extraProfile.bio,
        createdAt: (user as any).createdAt,
      },
      taxProfile: extraProfile.taxProfile,
    };
  }

  @Patch('api/v1/affiliate/me/profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current affiliate user profile' })
  async updateProfile(@Req() req: any, @Body() body: any) {
    const email = this.resolveAffiliateEmail(req);
    const existing = affiliateProfilesStore[email] || {};
    affiliateProfilesStore[email] = {
      ...existing,
      ...body,
      socialProfiles: {
        ...(existing.socialProfiles || {}),
        ...(body.socialProfiles || {}),
      },
    };

    if (body.fullName) {
      const user = dbStore.users.find((u) => u.email.toLowerCase() === email);
      if (user) {
        const parts = body.fullName.trim().split(' ');
        user.firstName = parts[0] || user.firstName;
        user.lastName = parts.slice(1).join(' ') || user.lastName;
      }
    }

    return this.getProfile(req);
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
    const orgId = body.organizationId || dbStore.organizations[0]?.id;
    let affiliate = dbStore.affiliates.find((a) => a.organizationId === orgId && a.email.toLowerCase() === email);

    if (!affiliate) {
      affiliate = {
        id: uuidv4(),
        organizationId: orgId,
        displayName: body.title || 'Partner',
        email,
        country: 'US',
        status: AffiliateStatus.ACTIVE,
        trustScore: 85,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.affiliates.push(affiliate);
    }

    const shortCode = body.slug || body.customAlias || SecurityUtils.generateRandomCode(8).toLowerCase();
    const prog = dbStore.programs.find((p) => p.id === body.programId && p.organizationId === orgId) || dbStore.programs.find((p) => p.organizationId === orgId) || dbStore.programs[0];

    const link = {
      id: uuidv4(),
      organizationId: orgId,
      environment: EnvironmentType.LIVE,
      programId: prog.id,
      affiliateId: affiliate.id,
      destinationUrl: body.destinationUrl || (prog as any)?.landingPageUrl || 'https://example.com',
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
  async deleteLink(@Param('linkId') linkId: string) {
    const idx = dbStore.trackingLinks.findIndex((l) => l.id === linkId);
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
    let coupons = dbStore.billingCoupons;
    if (organizationId) {
      coupons = coupons.filter((c: any) => c.organizationId === organizationId || !c.organizationId);
    }

    return coupons.map((c: any) => ({
      id: c.id,
      organizationId: c.organizationId || organizationId || dbStore.organizations[0]?.id,
      programId: c.programId || 'prog_main',
      code: c.code,
      discountSummary: c.discountSummary || (c.type === 'PERCENTAGE' ? `${c.amountOrPercentage}% off` : `$${c.amountOrPercentage / 100} discount`),
      discountType: c.type || 'PERCENTAGE',
      discountValue: c.amountOrPercentage || 20,
      uses: c.timesRedeemed || 24,
      conversions: c.timesRedeemed || 24,
      revenueGenerated: (c.timesRedeemed || 24) * 150,
      commissionEarned: (c.timesRedeemed || 24) * 35,
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
    let assets = dbStore.assets;
    if (organizationId) {
      assets = assets.filter((a) => a.organizationId === organizationId);
    }

    return assets.map((a: any) => ({
      id: a.id,
      organizationId: a.organizationId,
      programId: a.programId,
      title: a.title || 'Marketing Asset',
      type: a.type || 'BANNER',
      fileSize: a.fileSize || '1.2 MB',
      dimensions: a.dimensions || '1200 x 630 px',
      previewUrl: a.previewUrl || a.fileUrl || 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&auto=format&fit=crop&q=80',
      downloadUrl: a.fileUrl || `https://assets.partneriq.in/download/${a.id}`,
      copyContent: a.copyContent || a.bodyContent || null,
      tags: a.tags || ['Banner', 'Marketing'],
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
        customerMasked: c.customerMasked || `${(c.customerEmail || 'user').slice(0, 2)}***@${(c.customerEmail || 'customer.com').split('@')[1] || 'domain.com'}`,
        value: c.amount || 500,
        attributedValue: c.amount || 500,
        commissionAmount: (comm as any)?.amount || (comm as any)?.commissionAmount || (c.amount ? c.amount * 0.25 : 125),
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
        saleValue: conv?.amount || c.saleValue || 850,
        rateDescription: c.rateDescription || '25% standard recurring',
        amount: c.amount || c.commissionAmount || 212.5,
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
      const gross = pi.grossAmount || pi.amount || 2150;
      const taxWithheld = pi.taxWithheld || (org?.slug === 'zenpay' ? gross * 0.05 : 0);
      const net = pi.netAmount || (gross - taxWithheld);

      return {
        id: pi.id,
        organizationId: batch?.organizationId || organizationId || org?.id || 'org_acme',
        organizationName: org?.name || 'PartnerIQ Partner',
        amount: net,
        currency: (batch as any)?.currency || (org as any)?.defaultCurrency || 'USD',
        provider: pi.provider || (org?.slug === 'zenpay' ? 'Razorpay' : 'Stripe'),
        providerReference: pi.providerReference || `po_${pi.id.slice(0, 8)}`,
        payoutMethodMasked: pi.payoutMethodMasked || (org?.slug === 'zenpay' ? 'venkat***@okaxis' : 'HDFC Bank •••• 4281'),
        payoutMethodType: pi.payoutMethodType || (org?.slug === 'zenpay' ? 'UPI' : 'BANK_ACCOUNT'),
        status: pi.status || 'PAID',
        scheduledDate: batch?.createdAt || pi.createdAt,
        completedDate: pi.createdAt,
        grossAmount: gross,
        taxWithheld,
        feeDeduction: 0,
        netAmount: net,
        commissionCount: pi.commissionCount || 5,
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
    const org = dbStore.organizations.find((o) => o.id === organizationId) || dbStore.organizations[0];
    const aff = dbStore.affiliates.find((a) => a.organizationId === org.id && a.email.toLowerCase() === email) || dbStore.affiliates[0];

    const newPayout = {
      id: `pay_${uuidv4().slice(0, 8)}`,
      payoutBatchId: `batch_${uuidv4().slice(0, 8)}`,
      affiliateId: aff.id,
      amount: 1500,
      netAmount: 1500,
      grossAmount: 1500,
      taxWithheld: 0,
      status: 'PAID',
      createdAt: new Date(),
    };

    dbStore.payoutItems.unshift(newPayout as any);

    return {
      id: newPayout.id,
      organizationId: org.id,
      organizationName: org.name,
      amount: 1500,
      currency: (org as any).defaultCurrency || 'USD',
      provider: org.slug === 'zenpay' ? 'Razorpay' : 'Stripe Connect',
      providerReference: `instant_${newPayout.id}`,
      payoutMethodMasked: org.slug === 'zenpay' ? 'venkat***@okaxis' : 'Bank •••• 4281',
      payoutMethodType: org.slug === 'zenpay' ? 'UPI' : 'BANK_ACCOUNT',
      status: 'PAID',
      scheduledDate: new Date().toISOString(),
      completedDate: new Date().toISOString(),
      grossAmount: 1500,
      taxWithheld: 0,
      feeDeduction: 0,
      netAmount: 1500,
      commissionCount: 3,
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
    const email = this.resolveAffiliateEmail(req);
    return payoutMethodsStore;
  }

  @Post('api/v1/affiliate/me/payout-methods')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a new payout method' })
  async addPayoutMethod(@Req() req: any, @Body() body: any) {
    const email = this.resolveAffiliateEmail(req);
    const newMethod = {
      id: `pm_${uuidv4().slice(0, 8)}`,
      userId: req.user?.userId || 'usr_partner_001',
      type: body.type,
      isDefault: payoutMethodsStore.length === 0 || body.isDefault,
      bankName: body.bankName,
      accountNumberMasked: body.accountNumber ? `•••• ${body.accountNumber.slice(-4)}` : undefined,
      ifscCode: body.ifscCode,
      accountHolderName: body.accountHolderName,
      upiIdMasked: body.upiId,
      paypalEmailMasked: body.paypalEmail,
      authorizedOrgIds: body.authorizedOrgIds || ['*'],
      createdAt: new Date().toISOString(),
    };

    if (newMethod.isDefault) {
      payoutMethodsStore.forEach((m) => (m.isDefault = false));
    }

    payoutMethodsStore.unshift(newMethod);
    return newMethod;
  }

  @Patch('api/v1/affiliate/me/payout-methods/:methodId/default')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set default payout method' })
  async setDefaultPayoutMethod(@Param('methodId') methodId: string) {
    payoutMethodsStore.forEach((m) => {
      m.isDefault = m.id === methodId;
    });
    return { success: true };
  }

  @Delete('api/v1/affiliate/me/payout-methods/:methodId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete payout method' })
  async deletePayoutMethod(@Param('methodId') methodId: string) {
    const idx = payoutMethodsStore.findIndex((m) => m.id === methodId);
    if (idx !== -1) {
      payoutMethodsStore.splice(idx, 1);
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
    const email = this.resolveAffiliateEmail(req);
    const profile = affiliateProfilesStore[email];
    return profile?.taxProfile || {
      country: 'India',
      panOrTaxId: 'ABCDE1234F',
      taxClassification: 'INDIVIDUAL',
      withholdingRate: 5,
      isVerified: true,
      formType: 'PAN_TDS',
      submittedAt: new Date().toISOString(),
    };
  }

  @Patch('api/v1/affiliate/me/tax-profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update tax profile' })
  async updateTaxProfile(@Req() req: any, @Body() body: any) {
    const email = this.resolveAffiliateEmail(req);
    const existing = affiliateProfilesStore[email] || {};
    affiliateProfilesStore[email] = {
      ...existing,
      taxProfile: {
        ...(existing.taxProfile || {}),
        ...body,
        submittedAt: new Date().toISOString(),
      },
    };
    return affiliateProfilesStore[email].taxProfile;
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
    const invitations = dbStore.affiliateInvitations.filter(
      (inv: any) => inv.email?.toLowerCase() === email || inv.email?.toLowerCase().includes('venkat') || inv.email?.toLowerCase().includes('sarah'),
    );

    return invitations.map((inv: any) => {
      const org = dbStore.organizations.find((o) => o.id === inv.organizationId);
      const prog = dbStore.programs.find((p) => p.id === inv.programId);

      return {
        id: inv.id,
        organizationId: inv.organizationId,
        organizationName: org?.name || 'Partner Brand',
        organizationLogo: (org as any)?.branding?.logoUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80',
        programId: inv.programId,
        programName: prog?.name || 'VIP Creator Program',
        programSlug: prog?.slug || 'creator-program',
        email: inv.email,
        partnerName: inv.partnerName || 'Partner',
        affiliateType: inv.affiliateType || 'CONTENT_CREATOR',
        primaryChannel: inv.primaryChannel || 'YOUTUBE',
        commissionOverrideType: inv.commissionOverrideType || 'PERCENTAGE',
        commissionOverrideValue: inv.commissionOverrideValue || 3000,
        commissionSummary: `${(inv.commissionOverrideValue || 3000) / 100}% Recurring`,
        status: inv.status,
        invitedByLabel: inv.invitedByLabel || `${org?.name || 'Partnership'} Team`,
        personalMessage: inv.personalMessage || `Join the official ${org?.name || 'Brand'} partner program!`,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        inviteUrl: `https://partners.partneriq.in/invitations/affiliate/${inv.token}`,
        token: inv.token,
      };
    });
  }

  @Post('api/v1/affiliate/me/invitations/:invitationId/decline')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Decline affiliate invitation' })
  async declineInvitation(@Param('invitationId') invitationId: string) {
    const inv = dbStore.affiliateInvitations.find((i: any) => i.id === invitationId || i.token === invitationId);
    if (inv) {
      inv.status = 'DECLINED' as any;
    }
    return { success: true };
  }

  // ----------------------------------------------------
  // Active Sessions
  // ----------------------------------------------------
  @Get('api/v1/affiliate/me/sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active sessions for security' })
  async getSessions() {
    return [
      {
        id: 'sess_001',
        device: 'MacBook Pro 16-inch',
        browser: 'Chrome 124.0',
        location: 'Bengaluru, India',
        ipMasked: '103.21.***.44',
        lastActive: 'Just now',
        isCurrent: true,
      },
      {
        id: 'sess_002',
        device: 'iPhone 15 Pro',
        browser: 'Mobile Safari 17.4',
        location: 'Bengaluru, India',
        ipMasked: '103.21.***.89',
        lastActive: '4 hours ago',
        isCurrent: false,
      },
    ];
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
    const org = organizationId ? dbStore.organizations.find((o) => o.id === organizationId) : null;
    const isZenPay = org?.slug === 'zenpay';

    const count = timeRange === '90d' ? 12 : (timeRange === '30d' ? 10 : 7);
    const result = [];
    const now = new Date();

    const mult = isZenPay ? 80 : 1;

    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const baseClicks = 400 + Math.floor(Math.sin(i * 0.8) * 150) + (count - i) * 60;
      const conversions = Math.max(1, Math.round(baseClicks * 0.015));
      const revenue = conversions * 220 * mult;
      const commissions = conversions * 55 * mult;

      result.push({
        date: dateStr,
        clicks: baseClicks,
        conversions,
        revenue,
        commissions,
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
    const email = this.resolveAffiliateEmail(req);
    return supportTicketsStore;
  }

  @Post('api/v1/affiliate/me/support-tickets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit support ticket' })
  async createSupportTicket(@Req() req: any, @Body() body: any) {
    const email = this.resolveAffiliateEmail(req);
    const org = dbStore.organizations.find((o) => o.id === body.organizationId);

    const ticket = {
      id: `TK-${Math.floor(1000 + Math.random() * 9000)}`,
      userId: req.user?.userId || 'usr_partner_001',
      organizationId: body.organizationId,
      organizationName: org?.name || 'Global Partner Support',
      subject: body.subject,
      category: body.category || 'General Support',
      priority: body.priority || 'NORMAL',
      status: 'OPEN' as const,
      message: body.message,
      createdAt: new Date().toISOString(),
      lastReply: 'Ticket registered. Partner manager assigned.',
    };

    supportTicketsStore.unshift(ticket);
    return ticket;
  }
}

