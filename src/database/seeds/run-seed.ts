import { dbStore } from '../store';
import { initializeDataSource } from '../data-source';
import {
  EmailDesignTemplate,
  EmailDesignSettings,
  FraudSettings,
  Integration,
  Organization,
  OrganizationMembership,
  Program,
  User,
  PartnerTier,
  Milestone,
  AutomationEmailTemplate,
  AutomationWorkflow,
  AffiliateTier,
} from '../schema';
import { RoleDefinition, PermissionDefinition, RolePermission } from '../schema-rbac';
import { IsNull } from 'typeorm';
import { SecurityUtils } from '../../common/utils/security.utils';
import {
  UserStatus,
  OrganizationStatus,
  PlatformRole,
  Role,
  ProgramType,
  ProgramStatus,
  CommissionType,
  AttributionModel,
  AffiliateStatus,
  TrackingLinkStatus,
  IntegrationCategory,
  IntegrationConnectionType,
  IntegrationStatus,
  FraudSensitivity,
  FraudSignalCode,
  EnvironmentType,
} from '../../common/enums';
import { MembershipStatus, RoleType, ProgramAccessType } from '../../common/enums/rbac';
import { PERMISSIONS, BUILT_IN_ROLES } from '../../common/constants/permission-catalog';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export async function runSeed() {
  console.log('🌱 Seeding PartnerIQ database...');

  const dataSource = await initializeDataSource();
  const users = dataSource.getRepository(User);
  const organizations = dataSource.getRepository(Organization);
  const memberships = dataSource.getRepository(OrganizationMembership);
  const programs = dataSource.getRepository(Program);
  const fraudSettings = dataSource.getRepository(FraudSettings);
  const integrations = dataSource.getRepository(Integration);
  const emailDesignTemplates = dataSource.getRepository(EmailDesignTemplate);
  const emailDesignSettings = dataSource.getRepository(EmailDesignSettings);
  const rolesRepo = dataSource.getRepository(RoleDefinition);
  const permissionsRepo = dataSource.getRepository(PermissionDefinition);
  const rolePermissionsRepo = dataSource.getRepository(RolePermission);

  // Seed permissions and built-in roles
  for (const permission of PERMISSIONS) {
    const existingPermission = await permissionsRepo.findOne({ where: { code: permission.code } });
    if (!existingPermission) {
      const permissionEntity = permissionsRepo.create({
        code: permission.code,
        resource: permission.resource,
        action: permission.action,
        description: permission.description,
      });
      await permissionsRepo.save(permissionEntity);
    }
  }

  // Check if admin already exists
  let admin = await users.findOne({ where: { email: 'admin@partneriq.demo' } });
  if (!admin) {
    const passwordHash = await SecurityUtils.hashPassword('PartnerIQ@123');
    admin = users.create({
      email: 'admin@partneriq.demo',
      passwordHash,
      firstName: 'Admin',
      lastName: 'PartnerIQ',
      status: UserStatus.ACTIVE,
      emailVerified: true,
      platformRole: PlatformRole.SUPER_ADMIN,
      failedLoginAttempts: 0,
    });
    admin = await users.save(admin);
  } else if (admin.platformRole !== PlatformRole.SUPER_ADMIN) {
    admin.platformRole = PlatformRole.SUPER_ADMIN;
    admin = await users.save(admin);
  }

  let superAdmin = await users.findOne({ where: { email: 'superadmin@partneriq.demo' } });
  if (!superAdmin) {
    const passwordHash = await SecurityUtils.hashPassword('PartnerIQAdmin@123');
    superAdmin = users.create({
      email: 'superadmin@partneriq.demo',
      passwordHash,
      firstName: 'Super',
      lastName: 'Admin',
      status: UserStatus.ACTIVE,
      emailVerified: true,
      platformRole: PlatformRole.SUPER_ADMIN,
      failedLoginAttempts: 0,
    });
    superAdmin = await users.save(superAdmin);
  } else if (superAdmin.platformRole !== PlatformRole.SUPER_ADMIN) {
    superAdmin.platformRole = PlatformRole.SUPER_ADMIN;
    superAdmin = await users.save(superAdmin);
  }

  for (const roleCode of Object.keys(BUILT_IN_ROLES) as Array<keyof typeof BUILT_IN_ROLES>) {
    const roleDef = BUILT_IN_ROLES[roleCode];
    const existingRole = await rolesRepo.findOne({ where: { code: roleDef.code } });
    let savedRole = existingRole;
    if (!existingRole) {
      const newRole = rolesRepo.create({
        organizationId: null,
        name: roleDef.name,
        code: roleDef.code,
        description: roleDef.description,
        type: RoleType.SYSTEM,
        isSystem: true,
        isEditable: false,
        createdBy: admin.id,
      });
      savedRole = await rolesRepo.save(newRole);
    }

    const permissionEntities = await permissionsRepo.findBy(roleDef.permissions.map((code) => ({ code })));
    for (const permissionEntity of permissionEntities) {
      const existingLink = await rolePermissionsRepo.findOne({
        where: { roleId: savedRole!.id, permissionId: permissionEntity.id },
      });
      if (!existingLink) {
        const rolePermission = rolePermissionsRepo.create({
          roleId: savedRole!.id,
          permissionId: permissionEntity.id,
        });
        await rolePermissionsRepo.save(rolePermission);
      }
    }
  }

  // Create Acme SaaS Organization
  let org = await organizations.findOne({ where: { slug: 'acme-saas' } });
  if (!org) {
    org = organizations.create({
      name: 'Acme SaaS',
      slug: 'acme-saas',
      website: 'https://acme.com',
      industry: 'Software',
      companySize: '50-200',
      country: 'US',
      defaultCurrency: 'USD',
      status: OrganizationStatus.ACTIVE,
      onboardingCompleted: true,
      createdBy: admin.id,
    });
    org = await organizations.save(org);

    // Add membership
    await memberships.save(memberships.create({
      organizationId: org.id,
      userId: admin.id,
      role: Role.OWNER,
      status: MembershipStatus.ACTIVE,
      programAccessType: ProgramAccessType.ALL,
      programIds: [],
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  }

  // Seed Programs
  const programData = [
    { name: 'Acme Affiliate Program', slug: 'acme-affiliate', type: ProgramType.AFFILIATE, defaultVal: 1500 },
    { name: 'Influencer Program', slug: 'influencer-program', type: ProgramType.INFLUENCER, defaultVal: 2000 },
    { name: 'Agency Partners', slug: 'agency-partners', type: ProgramType.AGENCY, defaultVal: 2500 },
    { name: 'Customer Referrals', slug: 'customer-referrals', type: ProgramType.REFERRAL, defaultVal: 5000 }, // $50.00
  ];

  const seedPrograms = [];
  for (const p of programData) {
    let prog = await programs.findOne({
      where: { slug: p.slug, organizationId: org.id },
    });
    if (!prog) {
      prog = programs.create({
        organizationId: org.id,
        name: p.name,
        slug: p.slug,
        type: p.type,
        status: ProgramStatus.ACTIVE,
        currency: 'USD',
        commissionType: p.slug === 'customer-referrals' ? CommissionType.FIXED_AMOUNT : CommissionType.PERCENTAGE,
        defaultCommissionValue: p.defaultVal,
        attributionModel: AttributionModel.LAST_CLICK,
        cookieDurationDays: 60,
        affiliateApprovalMode: 'AUTO',
        createdBy: admin.id,
      });
      prog = await programs.save(prog);
    }
    seedPrograms.push(prog);
  }

  // Seed an Affiliate
  let affiliate = dbStore.affiliates.find((a) => a.email === 'sarah@growthpartner.com');
  if (!affiliate) {
    affiliate = {
      id: uuidv4(),
      organizationId: org.id,
      displayName: 'Sarah Growth',
      email: 'sarah@growthpartner.com',
      companyName: 'Growth Partner LLC',
      website: 'https://growthpartner.com',
      country: 'US',
      status: AffiliateStatus.ACTIVE,
      trustScore: 95,
      payoutMethod: 'MANUAL',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    dbStore.affiliates.push(affiliate);

    // Link affiliate to primary program
    dbStore.programAffiliates.push({
      id: uuidv4(),
      organizationId: org.id,
      programId: seedPrograms[0].id,
      affiliateId: affiliate.id,
      status: AffiliateStatus.ACTIVE,
      referralCode: 'sarah',
      joinedAt: new Date(),
    });

    // Create tracking link
    dbStore.trackingLinks.push({
      id: uuidv4(),
      organizationId: org.id,
      programId: seedPrograms[0].id,
      affiliateId: affiliate.id,
      destinationUrl: 'https://acme.com/pricing',
      shortCode: 'sarah',
      status: TrackingLinkStatus.ACTIVE,
      createdAt: new Date(),
    });
  }

  // Seed API Keys for Acme (including default deterministic test & live keys for Postman)
  const defaultOrgKeys = [
    {
      key: 'pi_live_sk_acme_994a20bf1028e331b90c',
      name: 'Acme Production Server Key',
      environment: 'live' as const,
      prefix: 'pi_live_sk_',
    },
    {
      key: 'pi_test_sk_acme_7719f20108bb63e4110f',
      name: 'Acme Test Sandbox Server Key',
      environment: 'test' as const,
      prefix: 'pi_test_sk_',
    },
  ];

  for (const dk of defaultOrgKeys) {
    const hash = SecurityUtils.hashToken(dk.key);
    if (!dbStore.apiKeys.some((k) => k.keyHash === hash)) {
      dbStore.apiKeys.push({
        id: uuidv4(),
        organizationId: org.id,
        name: dk.name,
        prefix: dk.prefix,
        keyHash: hash,
        environment: dk.environment === 'test' ? EnvironmentType.TEST : EnvironmentType.LIVE,
        scopes: [
          'programs:read',
          'conversions:write',
          'conversions:read',
          'affiliates:write',
          'affiliates:read',
          'tracking_links:write',
          'tracking_links:read',
          'customers:write',
          'attributions:write',
          'refunds:write',
          'webhooks:write',
          'webhooks:read',
        ],
        status: 'ACTIVE',
        createdBy: admin.id,
        createdAt: new Date(),
      });
      console.log(`🔑 Seeded ${dk.environment.toUpperCase()} API Key: ${dk.key}`);
    }
  }

  const unsupportedIntegrationCodes = [
    'STRIPE',
    'PADDLE',
    'CHARGEBEE',
    'SHOPIFY',
    'WOOCOMMERCE',
    'SALESFORCE',
    'ZAPIER',
    'SLACK',
    'SEGMENT',
  ];
  for (const code of unsupportedIntegrationCodes) {
    const existing = await integrations.findOne({ where: { code } });
    if (existing && existing.status !== IntegrationStatus.DISABLED) {
      existing.status = IntegrationStatus.DISABLED;
      await integrations.save(existing);
    }
  }

  const integrationCatalog = [
    ['HUBSPOT', 'HubSpot CRM', 'hubspot', 'HubSpot', IntegrationCategory.CRM, IntegrationStatus.ACTIVE, [IntegrationConnectionType.OAUTH, IntegrationConnectionType.WEBHOOK], false, true, true, 'B2B partner deal registration, pipeline sync, closed-won attribution, and commission triggering from HubSpot.', 'hubspot'],
  ] as const;

  for (const [index, item] of integrationCatalog.entries()) {
    const [
      code,
      name,
      slug,
      provider,
      category,
      status,
      connectionTypes,
      supportsApiKey,
      supportsWebhooks,
      supportsOAuth,
      description,
      iconKey,
    ] = item;
    const existingIntegration = await integrations.findOne({ where: { code } });
    await integrations.save(integrations.create({
      ...(existingIntegration || {}),
      code,
      name,
      slug,
      provider,
      category,
      status,
      connectionTypes: [...connectionTypes],
      supportsApiKey,
      supportsWebhooks,
      supportsOAuth,
      description,
      iconKey,
      displayOrder: index + 1,
    }));
  }

  if (!(await fraudSettings.findOne({ where: { organizationId: org.id, programId: IsNull() } }))) {
    await fraudSettings.save(fraudSettings.create({
      organizationId: org.id,
      programId: null as any,
      enabled: true,
      sensitivity: FraudSensitivity.BALANCED,
      allowMaxScore: 30,
      reviewMaxScore: 70,
      blockMinScore: 71,
      payoutHoldScore: 71,
      enabledSignals: [
        FraudSignalCode.IP_VELOCITY,
        FraudSignalCode.AFFILIATE_VELOCITY,
        FraudSignalCode.DEVICE_VELOCITY,
        FraudSignalCode.DUPLICATE_DEVICE,
        FraudSignalCode.GEO_MISMATCH,
        FraudSignalCode.SELF_REFERRAL,
        FraudSignalCode.FAST_CONVERSION,
        FraudSignalCode.DUPLICATE_CONVERSION,
        FraudSignalCode.SUSPICIOUS_USER_AGENT,
        FraudSignalCode.AMOUNT_ANOMALY,
        FraudSignalCode.AFFILIATE_LOW_TRUST,
        FraudSignalCode.AFFILIATE_HIGH_REFUND_RATE,
        FraudSignalCode.PAYOUT_AMOUNT_ANOMALY,
      ],
      signalWeights: {
        NETWORK: 20,
        DEVICE: 20,
        TRAFFIC: 20,
        CONVERSION: 20,
        AFFILIATE: 20,
        IDENTITY: 15,
        BEHAVIOR: 15,
        PAYMENT: 15,
        PAYOUT: 30,
      },
      createdBy: admin.id,
    }));
  }

  // Seed Partner Tiers
  const partnerTiersRepo = dataSource.getRepository(PartnerTier);
  const existingTiers = await partnerTiersRepo.find({ where: { organizationId: org.id } });
  let bronzeTier = existingTiers.find((t) => t.code === 'BRONZE');
  let silverTier = existingTiers.find((t) => t.code === 'SILVER');
  let goldTier = existingTiers.find((t) => t.code === 'GOLD');

  if (!existingTiers.length) {
    bronzeTier = await partnerTiersRepo.save(partnerTiersRepo.create({
      id: uuidv4(),
      organizationId: org.id,
      name: 'Bronze Partner',
      code: 'BRONZE',
      description: 'Starting tier for all enrolled partners.',
      level: 1,
      displayOrder: 1,
      icon: 'shield',
      badge: 'Bronze Affiliate',
      colorToken: 'bronze',
      commissionRateOverride: 1500, // 15.00%
      isDefault: true,
      isActive: true,
      isVisibleToAffiliate: true,
      conditions: {
        minimumConversions: 0,
        minimumRevenue: 0,
      },
    }));

    silverTier = await partnerTiersRepo.save(partnerTiersRepo.create({
      id: uuidv4(),
      organizationId: org.id,
      name: 'Silver Partner',
      code: 'SILVER',
      description: 'Unlocked upon generating 10 approved conversions or $2,500 in revenue.',
      level: 2,
      displayOrder: 2,
      icon: 'award',
      badge: 'Silver Affiliate',
      colorToken: 'silver',
      commissionRateOverride: 2000, // 20.00%
      isDefault: false,
      isActive: true,
      isVisibleToAffiliate: true,
      conditions: {
        minimumConversions: 10,
        minimumRevenue: 2500,
      },
      rewardsConfig: {
        bonusAmount: 5000, // $50 bonus
        badgeName: 'Silver Partner',
        notificationTitle: '🌟 Promoted to Silver Tier!',
        notificationBody: 'You reached 10 conversions! Your commission rate has been increased to 20%.',
      },
    }));

    goldTier = await partnerTiersRepo.save(partnerTiersRepo.create({
      id: uuidv4(),
      organizationId: org.id,
      name: 'Gold Partner',
      code: 'GOLD',
      description: 'Elite tier for high volume partners with 50+ conversions or $10,000 in revenue.',
      level: 3,
      displayOrder: 3,
      icon: 'crown',
      badge: 'Gold Affiliate',
      colorToken: 'gold',
      commissionRateOverride: 2500, // 25.00%
      isDefault: false,
      isActive: true,
      isVisibleToAffiliate: true,
      conditions: {
        minimumConversions: 50,
        minimumRevenue: 10000,
      },
      rewardsConfig: {
        bonusAmount: 20000, // $200 bonus
        badgeName: 'Gold Partner',
        notificationTitle: '👑 Welcome to Gold Tier!',
        notificationBody: 'Congratulations on reaching Gold Tier! Enjoy 25% commission and VIP partner support.',
      },
    }));
  }

  // Seed Milestones
  const milestonesRepo = dataSource.getRepository(Milestone);
  const existingMilestones = await milestonesRepo.find({ where: { organizationId: org.id } });
  if (!existingMilestones.length) {
    await milestonesRepo.save([
      milestonesRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        name: 'First Sale Club',
        code: 'FIRST_SALE',
        description: 'Earn your very first approved customer conversion.',
        metric: 'APPROVED_CONVERSIONS' as any,
        operator: 'GREATER_THAN_OR_EQUAL',
        targetValue: 1,
        rewardType: 'MULTI_REWARD' as any,
        rewardConfig: {
          bonusAmount: 2500, // $25 bonus
          badgeName: 'First Sale Club',
          badgeIcon: 'sparkles',
        },
        badgeIcon: 'sparkles',
        badgeName: 'First Sale Club',
        isActive: true,
        displayOrder: 1,
      }),
      milestonesRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        name: '10 Conversions Milestone',
        code: 'TEN_CONVERSIONS',
        description: 'Achieve 10 approved referral sales.',
        metric: 'APPROVED_CONVERSIONS' as any,
        operator: 'GREATER_THAN_OR_EQUAL',
        targetValue: 10,
        rewardType: 'FIXED_BONUS' as any,
        rewardConfig: { bonusAmount: 5000 },
        badgeIcon: 'award',
        badgeName: '10 Sales Achiever',
        isActive: true,
        displayOrder: 2,
      }),
      milestonesRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        name: '$10k Revenue Champion',
        code: 'TEN_K_REVENUE',
        description: 'Generate over $10,000 in customer referral volume.',
        metric: 'REVENUE_GENERATED' as any,
        operator: 'GREATER_THAN_OR_EQUAL',
        targetValue: 10000,
        rewardType: 'FIXED_BONUS' as any,
        rewardConfig: { bonusAmount: 15000 },
        badgeIcon: 'crown',
        badgeName: '$10k Club',
        isActive: true,
        displayOrder: 3,
      }),
    ]);
  }

  // Seed Email Templates
  const emailTemplatesRepo = dataSource.getRepository(AutomationEmailTemplate);
  const existingTemplates = await emailTemplatesRepo.find({ where: { organizationId: org.id } });
  if (!existingTemplates.length) {
    await emailTemplatesRepo.save([
      emailTemplatesRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        code: 'WELCOME_AFFILIATE',
        name: 'Welcome to Partner Program',
        subject: 'Welcome to {{program_name}}! Here is your quickstart guide',
        preheader: 'Start earning commissions with your unique partner links today.',
        bodyHtml: '<p>Hi {{affiliate_first_name}},</p><p>Welcome to <strong>{{organization_name}}</strong>\'s partner program! Your starting tier is <strong>{{current_tier}}</strong> at <strong>{{current_commission_rate}}</strong> commission.</p><p><a href="{{tracking_link_url}}">Access Your Affiliate Dashboard</a> to generate your links and download marketing materials.</p>',
        bodyText: 'Welcome {{affiliate_first_name}} to {{program_name}}! Access your dashboard at {{affiliate_dashboard_url}}.',
        ctaText: 'Open Dashboard',
        ctaUrl: '{{affiliate_dashboard_url}}',
      }),
      emailTemplatesRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        code: 'CREATE_FIRST_LINK',
        name: 'Create Your First Tracking Link',
        subject: 'Quick reminder: Create your referral link to start earning',
        preheader: 'Generate tracking links in seconds to refer your audience.',
        bodyHtml: '<p>Hi {{affiliate_first_name}},</p><p>We noticed you haven\'t created a tracking link yet for <strong>{{program_name}}</strong>.</p><p>It only takes 10 seconds! <a href="{{affiliate_dashboard_url}}">Click here to generate your link</a> and start earning {{current_commission_rate}} on every sale.</p>',
        bodyText: 'Hi {{affiliate_first_name}}, create your tracking link at {{affiliate_dashboard_url}} to start earning.',
        ctaText: 'Create Tracking Link',
        ctaUrl: '{{affiliate_dashboard_url}}',
      }),
      emailTemplatesRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        code: 'MARKETING_ASSETS_TIPS',
        name: 'Marketing Assets & Promotion Tips',
        subject: 'Free marketing assets to boost your referral clicks',
        preheader: 'High-converting banners, email copy, and product kits.',
        bodyHtml: '<p>Hi {{affiliate_first_name}},</p><p>Want more clicks and conversions? Check out our official <a href="{{asset_library_url}}">Marketing Asset Library</a> for ready-to-use banners, social graphics, and product demos.</p>',
        bodyText: 'Download assets at {{asset_library_url}}.',
        ctaText: 'View Asset Library',
        ctaUrl: '{{asset_library_url}}',
      }),
      emailTemplatesRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        code: 'FIRST_CONVERSION_CONGRATS',
        name: 'First Sale Celebration',
        subject: '🎉 Congratulations on your first referral sale!',
        preheader: 'You just earned your first commission on {{organization_name}}.',
        bodyHtml: '<p>Hi {{affiliate_first_name}},</p><p>Awesome job! You just generated your first approved customer sale for <strong>{{program_name}}</strong>. Your commission is now recorded in your partner ledger.</p>',
        bodyText: 'Congratulations on your first sale! Check details at {{affiliate_dashboard_url}}.',
        ctaText: 'View Earnings',
        ctaUrl: '{{affiliate_dashboard_url}}',
      }),
      emailTemplatesRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        code: 'TIER_UPGRADE_CONGRATS',
        name: 'Tier Promotion Notice',
        subject: '🌟 You have been upgraded to {{current_tier}} Tier!',
        preheader: 'Your commission rate has increased to {{current_commission_rate}}.',
        bodyHtml: '<p>Hi {{affiliate_first_name}},</p><p>Congratulations! Based on your outstanding performance, you have advanced to <strong>{{current_tier}}</strong> Tier! Your new commission rate is <strong>{{current_commission_rate}}</strong>.</p>',
        bodyText: 'You reached {{current_tier}} tier at {{current_commission_rate}} commission rate!',
        ctaText: 'View Tier Journey',
        ctaUrl: '{{affiliate_dashboard_url}}',
      }),
      emailTemplatesRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        code: 'RE_ENGAGE_AFFILIATE',
        name: 'Inactive Partner Re-Engagement',
        subject: 'We miss you! Special rewards waiting in your partner portal',
        preheader: 'Unlock next tier commission rates and new campaign bonuses.',
        bodyHtml: '<p>Hi {{affiliate_first_name}},</p><p>We noticed you haven\'t promoted <strong>{{program_name}}</strong> recently. You are only {{conversions_remaining}} sales away from reaching {{next_tier}} Tier with {{next_commission_rate}} commission!</p>',
        bodyText: 'Re-engage and earn {{next_commission_rate}} at {{affiliate_dashboard_url}}.',
        ctaText: 'Explore New Campaigns',
        ctaUrl: '{{affiliate_dashboard_url}}',
      }),
    ]);
  }

  await seedEmailDesignDefaults(emailDesignTemplates);
  await seedEmailDesignSettings(emailDesignSettings);

  // Seed Default Automation Workflows
  const workflowsRepo = dataSource.getRepository(AutomationWorkflow);
  const existingWorkflows = await workflowsRepo.find({ where: { organizationId: org.id } });
  if (!existingWorkflows.length) {
    const { PREBUILT_WORKFLOW_TEMPLATES } = await import('../../modules/automations/workflows/workflow-templates.data');
    for (const t of PREBUILT_WORKFLOW_TEMPLATES) {
      await workflowsRepo.save(workflowsRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        name: t.name,
        description: t.description,
        triggerType: t.triggerType,
        status: 'ACTIVE' as any,
        version: 1,
        goalType: t.goalType,
        goalConfig: t.goalConfig,
        maxEmailsPerDay: 2,
        maxEmailsPerWeek: 5,
        quietHoursEnabled: true,
        nodes: t.nodes as any,
        edges: t.edges as any,
      }));
    }
  }

  // Assign demo affiliate to bronze tier
  if (affiliate && bronzeTier) {
    const affiliateTiersRepo = dataSource.getRepository(AffiliateTier);
    const existingAffiliateTier = await affiliateTiersRepo.findOne({ where: { affiliateId: affiliate.id } });
    if (!existingAffiliateTier) {
      await affiliateTiersRepo.save(affiliateTiersRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        programId: seedPrograms[0]?.id,
        affiliateId: affiliate.id,
        currentTierId: bronzeTier.id,
        effectiveFrom: new Date(),
        isLocked: false,
      }));
    }
  }

  return { admin, org, seedPrograms, affiliate };
}

async function seedEmailDesignSettings(emailDesignSettingsRepo: any) {
  const existing = await emailDesignSettingsRepo.findOne({ where: { settingsKey: 'default' } });
  if (existing) return;

  await emailDesignSettingsRepo.save(emailDesignSettingsRepo.create({
    id: uuidv4(),
    settingsKey: 'default',
    payload: {
      name: 'PartnerIQ',
      tagline: 'Partner & Affiliate Management Platform',
      signature: 'Built for better partnerships.',
      companyLegal: 'PartnerIQ Technologies Inc.',
      logoUrl:
        'https://res.cloudinary.com/bunny1705/image/upload/v1787584202/partneriq/92977d80-3e51-4a12-a382-64b42fb5466a/organization-logo/rrhwttefwtgrxico2rtv.png',
      websiteUrl: 'https://partneriq.io',
      docsUrl: 'https://docs.partneriq.io',
      helpCenterUrl: 'https://help.partneriq.io',
      privacyUrl: 'https://partneriq.io/privacy',
      termsUrl: 'https://partneriq.io/terms',
      supportEmail: 'support@partneriq.io',
      physicalAddress: '548 Market St, Suite 39201, San Francisco, CA 94104',
      updatedAt: new Date().toISOString(),
    },
  }));

  console.log('Seeded email design brand/footer settings');
}

async function seedEmailDesignDefaults(emailDesignTemplatesRepo: any) {
  const seedDir = path.dirname(fileURLToPath(import.meta.url));
  const registryUrl = pathToFileURL(
    path.resolve(seedDir, '..', '..', '..', '..', 'email-design', 'src', 'emails', 'templates', 'registry.ts'),
  ).href;

  try {
    const registry = await import(registryUrl);
    const defaults = Array.isArray(registry.ALL_TEMPLATES) ? registry.ALL_TEMPLATES : [];
    let savedCount = 0;

    for (const template of defaults) {
      if (!template?.id) continue;

      const existing = await emailDesignTemplatesRepo.findOne({ where: { templateId: template.id } });
      if (existing?.isCustom || existing?.isEdited) continue;

      const payload = {
        id: template.id,
        name: template.name,
        category: template.category,
        description: template.description,
        tags: template.tags || [],
        defaultSubject: template.defaultSubject,
        defaultPreheader: template.defaultPreheader,
        variables: template.variables || [],
        defaultData: template.defaultData || {},
        samplePresets: template.samplePresets,
        bodyTemplate: typeof template.renderBody === 'function' ? template.renderBody(template.defaultData || {}) : '',
        securityNotice: template.securityNotice,
        isCustom: false,
        isEdited: false,
        updatedAt: new Date().toISOString(),
      };

      await emailDesignTemplatesRepo.save(emailDesignTemplatesRepo.create({
        ...(existing || { id: uuidv4() }),
        templateId: template.id,
        name: template.name,
        category: template.category,
        isCustom: false,
        isEdited: false,
        payload,
      }));
      savedCount += 1;
    }

    if (savedCount > 0) {
      console.log(`Seeded ${savedCount} email design default templates`);
    }
  } catch (error) {
    console.warn('Unable to seed email design defaults from registry:', error instanceof Error ? error.message : error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed().catch(console.error);
}
