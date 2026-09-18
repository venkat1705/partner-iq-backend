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
import { DataSource, IsNull } from 'typeorm';
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
  AffiliateInvitationStatus,
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

/**
 * Seeds ONLY essential system definitions (RBAC permissions, built-in system roles, email/document templates, settings).
 * DOES NOT create any dummy organizations, users, programs, or affiliates.
 */
export async function seedSystemDefaults() {
  console.log('⚙️ Initializing essential PartnerIQ system defaults (RBAC & Templates)...');

  const dataSource = await initializeDataSource();
  const permissionsRepo = dataSource.getRepository(PermissionDefinition);
  const rolesRepo = dataSource.getRepository(RoleDefinition);
  const rolePermissionsRepo = dataSource.getRepository(RolePermission);
  const emailDesignTemplates = dataSource.getRepository(EmailDesignTemplate);
  const emailDesignSettings = dataSource.getRepository(EmailDesignSettings);

  // 1. Seed Permissions Catalog
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

  // 2. Seed Built-In System Roles
  for (const roleCode of Object.keys(BUILT_IN_ROLES) as Array<keyof typeof BUILT_IN_ROLES>) {
    const roleDef = BUILT_IN_ROLES[roleCode];
    const existingRole = await rolesRepo.findOne({ where: { code: roleDef.code } });
    let savedRole = existingRole;
    if (!existingRole) {
      const newRole = rolesRepo.create({
        organizationId: undefined,
        name: roleDef.name,
        code: roleDef.code,
        description: roleDef.description,
        type: RoleType.SYSTEM,
        isSystem: true,
        isEditable: false,
        createdBy: undefined,
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

  // 3. Seed Email Design Defaults & Brand Settings
  await seedEmailDesignDefaults(emailDesignTemplates);
  await seedEmailDesignSettings(emailDesignSettings);

  // 3b. Seed/sync the marketplace integration catalog (HubSpot, Zoho CRM, Razorpay, Cashfree, ...)
  await seedIntegrationCatalog(dataSource);

  // 4. Ensure organization_brandings table columns support large image URLs / data URLs
  try {
    await dataSource.query(`ALTER TABLE organization_brandings MODIFY COLUMN logoUrl MEDIUMTEXT NULL`);
    await dataSource.query(`ALTER TABLE organization_brandings MODIFY COLUMN logoDarkUrl MEDIUMTEXT NULL`);
    await dataSource.query(`ALTER TABLE organization_brandings MODIFY COLUMN faviconUrl MEDIUMTEXT NULL`);
    await dataSource.query(`ALTER TABLE organization_brandings MODIFY COLUMN heroImageUrl MEDIUMTEXT NULL`);
    await dataSource.query(`ALTER TABLE organization_brandings MODIFY COLUMN seoImageUrl MEDIUMTEXT NULL`);
  } catch (err) {
    // Ignore if table doesn't exist yet or columns already altered
  }

  console.log('✅ Essential PartnerIQ system defaults initialized (0 dummy orgs/users created).');
}

/**
 * Upserts the marketplace integration catalog (HubSpot, Zoho CRM, Razorpay, Cashfree, ...).
 * This is core system catalog data, not demo data, so it always runs as part of
 * seedSystemDefaults() rather than being gated behind SEED_DEMO_DATA.
 */
async function seedIntegrationCatalog(dataSource: DataSource) {
  const integrations = dataSource.getRepository(Integration);

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
    {
      code: 'HUBSPOT',
      name: 'HubSpot',
      slug: 'hubspot',
      provider: 'HUBSPOT',
      category: IntegrationCategory.CRM,
      status: IntegrationStatus.ACTIVE,
      connectionTypes: [IntegrationConnectionType.API_KEY, IntegrationConnectionType.WEBHOOK],
      supportsApiKey: true,
      supportsWebhooks: true,
      supportsOAuth: true,
      description: 'Connect HubSpot with PartnerIQ to synchronize your CRM data and partner-driven customer activity.',
      logo: '/integrations/hubspot.svg',
      iconKey: 'hubspot',
      capabilities: ['contacts', 'companies', 'deals', 'conversions'],
    },
    {
      code: 'ZOHO_CRM',
      name: 'Zoho CRM',
      slug: 'zoho-crm',
      provider: 'ZOHO_CRM',
      category: IntegrationCategory.CRM,
      status: IntegrationStatus.ACTIVE,
      connectionTypes: [IntegrationConnectionType.API_KEY, IntegrationConnectionType.WEBHOOK],
      supportsApiKey: true,
      supportsWebhooks: false,
      supportsOAuth: false,
      description: 'Sync leads, contacts, deals, and conversion data with Zoho CRM to power partner attribution.',
      logo: '/integrations/zoho.svg',
      iconKey: 'zoho',
      capabilities: ['leads', 'contacts', 'deals', 'conversions'],
    },
    {
      code: 'RAZORPAY',
      name: 'Razorpay',
      slug: 'razorpay',
      provider: 'RAZORPAY',
      category: IntegrationCategory.PAYMENTS,
      status: IntegrationStatus.ACTIVE,
      connectionTypes: [IntegrationConnectionType.API_KEY, IntegrationConnectionType.WEBHOOK],
      supportsApiKey: true,
      supportsWebhooks: true,
      supportsOAuth: true,
      description: 'Accept payments, track orders and refunds, and manage partner conversions with Razorpay.',
      logo: '/integrations/razorpay.svg',
      iconKey: 'razorpay',
      capabilities: ['payments', 'orders', 'refunds', 'customers', 'webhooks'],
    },
    {
      code: 'CASHFREE',
      name: 'Cashfree',
      slug: 'cashfree',
      provider: 'CASHFREE',
      category: IntegrationCategory.PAYMENTS,
      status: IntegrationStatus.ACTIVE,
      connectionTypes: [IntegrationConnectionType.API_KEY, IntegrationConnectionType.WEBHOOK],
      supportsApiKey: true,
      supportsWebhooks: true,
      supportsOAuth: false,
      description: 'Process payments, verify customer orders and refunds, and automate attribution with Cashfree.',
      logo: '/integrations/cashfree.svg',
      iconKey: 'cashfree',
      capabilities: ['payments', 'orders', 'refunds', 'customers', 'webhooks'],
    },
  ];

  for (const [index, item] of integrationCatalog.entries()) {
    const existingIntegration = await integrations.findOne({ where: { code: item.code } });
    await integrations.save(integrations.create({
      ...(existingIntegration || {}),
      code: item.code,
      name: item.name,
      slug: item.slug,
      provider: item.provider,
      category: item.category,
      status: item.status,
      connectionTypes: [...item.connectionTypes],
      supportsApiKey: item.supportsApiKey,
      supportsWebhooks: item.supportsWebhooks,
      supportsOAuth: item.supportsOAuth,
      description: item.description,
      logo: item.logo,
      iconKey: item.iconKey,
      capabilities: item.capabilities,
      displayOrder: index + 1,
    }));
  }
}

export async function runSeed() {
  console.log('🌱 Seeding PartnerIQ database with demo organizations & test data...');

  await seedSystemDefaults();

  const dataSource = await initializeDataSource();
  const users = dataSource.getRepository(User);
  const organizations = dataSource.getRepository(Organization);
  const memberships = dataSource.getRepository(OrganizationMembership);
  const programs = dataSource.getRepository(Program);
  const fraudSettings = dataSource.getRepository(FraudSettings);
  const emailDesignTemplates = dataSource.getRepository(EmailDesignTemplate);
  const emailDesignSettings = dataSource.getRepository(EmailDesignSettings);
  const rolesRepo = dataSource.getRepository(RoleDefinition);
  const permissionsRepo = dataSource.getRepository(PermissionDefinition);
  const rolePermissionsRepo = dataSource.getRepository(RolePermission);

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
      defaultCurrency: 'INR',
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
        currency: 'INR',
        commissionType: p.slug === 'customer-referrals' ? CommissionType.FIXED_AMOUNT : CommissionType.PERCENTAGE,
        defaultCommissionValue: p.defaultVal,
        attributionModel: AttributionModel.LAST_CLICK,
        cookieDurationDays: 60,
        affiliateApprovalMode: 'AUTO',
        visibility: 'PUBLIC',
        category: 'SAAS',
        createdBy: admin.id,
      });
      prog = await programs.save(prog);
    }
    // Programs seeded here go through the raw TypeORM repository (unlike affiliates/tracking
    // links below, which are pushed directly into dbStore) - mirror it into dbStore too so
    // in-process services reading dbStore.programs (which is how the real app always creates
    // programs, via ProgramsService) see these seeded programs as well.
    if (!dbStore.programs.find((p) => p.id === prog!.id)) {
      dbStore.programs.push(prog as any);
    }
    seedPrograms.push(prog);
  }

  // Seed Demo Affiliate Users
  let demoPartnerUser = await users.findOne({ where: { email: 'venkataramireddyvenky@gmail.com' } });
  if (!demoPartnerUser) {
    const passwordHash = await SecurityUtils.hashPassword('PartnerIQ@123');
    demoPartnerUser = users.create({
      email: 'venkataramireddyvenky@gmail.com',
      passwordHash,
      firstName: 'Venkata',
      lastName: 'Rami Reddy',
      status: UserStatus.ACTIVE,
      emailVerified: true,
      platformRole: PlatformRole.USER,
      failedLoginAttempts: 0,
    });
    demoPartnerUser = await users.save(demoPartnerUser);
  }

  let demoAgencyUser = await users.findOne({ where: { email: 'sarah.lin@growthscale.agency' } });
  if (!demoAgencyUser) {
    const passwordHash = await SecurityUtils.hashPassword('PartnerIQ@123');
    demoAgencyUser = users.create({
      email: 'sarah.lin@growthscale.agency',
      passwordHash,
      firstName: 'Sarah',
      lastName: 'Lin',
      status: UserStatus.ACTIVE,
      emailVerified: true,
      platformRole: PlatformRole.USER,
      failedLoginAttempts: 0,
    });
    demoAgencyUser = await users.save(demoAgencyUser);
  }

  // Seed ZenPay Payments Organization (INR)
  let orgZenpay = await organizations.findOne({ where: { slug: 'zenpay' } });
  if (!orgZenpay) {
    orgZenpay = organizations.create({
      name: 'ZenPay Payments',
      slug: 'zenpay',
      website: 'https://zenpay.in',
      industry: 'Fintech & Payment Gateway',
      companySize: '100-500',
      country: 'IN',
      defaultCurrency: 'INR',
      status: OrganizationStatus.ACTIVE,
      onboardingCompleted: true,
      createdBy: admin.id,
    });
    orgZenpay = await organizations.save(orgZenpay);
  }

  // Seed Nova AI Studio Organization (INR)
  let orgNova = await organizations.findOne({ where: { slug: 'nova' } });
  if (!orgNova) {
    orgNova = organizations.create({
      name: 'Nova AI Studio',
      slug: 'nova',
      website: 'https://nova-ai.io',
      industry: 'Artificial Intelligence',
      companySize: '20-50',
      country: 'US',
      defaultCurrency: 'INR',
      status: OrganizationStatus.ACTIVE,
      onboardingCompleted: true,
      createdBy: admin.id,
    });
    orgNova = await organizations.save(orgNova);
  }

  // Seed FitLife Pro Organization (INR)
  let orgFitlife = await organizations.findOne({ where: { slug: 'fitlife' } });
  if (!orgFitlife) {
    orgFitlife = organizations.create({
      name: 'FitLife Pro',
      slug: 'fitlife',
      website: 'https://fitlifepro.com',
      industry: 'Health & Fitness',
      companySize: '50-100',
      country: 'US',
      defaultCurrency: 'INR',
      status: OrganizationStatus.ACTIVE,
      onboardingCompleted: true,
      createdBy: admin.id,
    });
    orgFitlife = await organizations.save(orgFitlife);
  }

  // Seed ZenPay Programs
  const zenpayPrograms = [
    { name: 'ZenPay Merchant Partner Program', slug: 'merchant-referral', type: ProgramType.AFFILIATE, defaultVal: 500000, currency: 'INR' },
  ];
  const seedZenpayPrograms = [];
  for (const zp of zenpayPrograms) {
    let prog = await programs.findOne({ where: { slug: zp.slug, organizationId: orgZenpay.id } });
    if (!prog) {
      prog = programs.create({
        organizationId: orgZenpay.id,
        name: zp.name,
        slug: zp.slug,
        type: zp.type,
        status: ProgramStatus.ACTIVE,
        currency: 'INR',
        commissionType: CommissionType.FIXED_AMOUNT,
        defaultCommissionValue: zp.defaultVal,
        attributionModel: AttributionModel.LAST_CLICK,
        cookieDurationDays: 60,
        affiliateApprovalMode: 'AUTO',
        createdBy: admin.id,
      });
      prog = await programs.save(prog);
    }
    seedZenpayPrograms.push(prog);
  }

  // Seed Nova AI Programs
  let progNova = await programs.findOne({ where: { slug: 'ai-creator', organizationId: orgNova.id } });
  if (!progNova) {
    progNova = programs.create({
      organizationId: orgNova.id,
      name: 'Nova AI Creator Guild',
      slug: 'ai-creator',
      type: ProgramType.AFFILIATE,
      status: ProgramStatus.ACTIVE,
      currency: 'INR',
      commissionType: CommissionType.PERCENTAGE,
      defaultCommissionValue: 3000,
      attributionModel: AttributionModel.LAST_CLICK,
      cookieDurationDays: 60,
      affiliateApprovalMode: 'AUTO',
      createdBy: admin.id,
    });
    progNova = await programs.save(progNova);
  }

  // Seed Affiliates for Venkata in Acme, ZenPay, Nova
  const affiliateEmails = ['venkataramireddyvenky@gmail.com', 'sarah@growthpartner.com', 'sarah.lin@growthscale.agency'];
  for (const affEmail of affiliateEmails) {
    const isVenkat = affEmail.includes('venkat');
    const name = isVenkat ? 'Venkata Rami Reddy' : 'Sarah Lin';

    // 1. Acme affiliate
    let affAcme = dbStore.affiliates.find((a) => a.organizationId === org.id && a.email === affEmail);
    if (!affAcme) {
      affAcme = {
        id: uuidv4(),
        organizationId: org.id,
        displayName: name,
        email: affEmail,
        companyName: isVenkat ? 'TechGrowth Hub' : 'GrowthScale Agency',
        website: isVenkat ? 'https://techgrowthhub.io' : 'https://growthscale.agency',
        country: isVenkat ? 'IN' : 'US',
        status: AffiliateStatus.ACTIVE,
        trustScore: 95,
        payoutMethod: 'MANUAL',
        createdAt: new Date(Date.now() - 90 * 86400000),
        updatedAt: new Date(),
      };
      dbStore.affiliates.push(affAcme);

      dbStore.programAffiliates.push({
        id: uuidv4(),
        organizationId: org.id,
        programId: seedPrograms[0].id,
        affiliateId: affAcme.id,
        status: AffiliateStatus.ACTIVE,
        referralCode: isVenkat ? 'k8s-deepdive' : 'sarah-acme',
        joinedAt: new Date(Date.now() - 90 * 86400000),
      });

      const link1 = {
        id: uuidv4(),
        organizationId: org.id,
        programId: seedPrograms[0].id,
        affiliateId: affAcme.id,
        destinationUrl: 'https://acmecloud.io/pricing',
        shortCode: isVenkat ? 'k8s-deepdive' : 'sarah-cloud',
        status: TrackingLinkStatus.ACTIVE,
        title: 'YouTube Video - K8s Deep Dive Bio Link',
        customAlias: isVenkat ? 'k8s-deepdive' : 'sarah-cloud',
        campaign: 'youtube_video_42',
        subId: 'yt_desc',
        clicks: 8420,
        createdAt: new Date(Date.now() - 60 * 86400000),
      };
      dbStore.trackingLinks.push(link1 as any);

      // Conversions & Commissions for Acme
      const conv1 = {
        id: uuidv4(),
        organizationId: org.id,
        programId: seedPrograms[0].id,
        affiliateId: affAcme.id,
        trackingLinkId: link1.id,
        externalOrderId: 'ORD-94812',
        customerEmail: 'david@fintechscale.io',
        amount: 1200,
        status: 'APPROVED',
        createdAt: new Date(Date.now() - 10 * 86400000),
      };
      dbStore.conversions.push(conv1 as any);

      dbStore.commissions.push({
        id: uuidv4(),
        organizationId: org.id,
        programId: seedPrograms[0].id,
        affiliateId: affAcme.id,
        conversionId: conv1.id,
        amount: 300,
        status: 'PAYABLE',
        createdAt: new Date(Date.now() - 10 * 86400000),
      } as any);

      const conv2 = {
        id: uuidv4(),
        organizationId: org.id,
        programId: seedPrograms[0].id,
        affiliateId: affAcme.id,
        trackingLinkId: link1.id,
        externalOrderId: 'ORD-94833',
        customerEmail: 'mike@datastream.co',
        amount: 850,
        status: 'APPROVED',
        createdAt: new Date(Date.now() - 6 * 86400000),
      };
      dbStore.conversions.push(conv2 as any);

      dbStore.commissions.push({
        id: uuidv4(),
        organizationId: org.id,
        programId: seedPrograms[0].id,
        affiliateId: affAcme.id,
        conversionId: conv2.id,
        amount: 212.5,
        status: 'PAYABLE',
        createdAt: new Date(Date.now() - 6 * 86400000),
      } as any);

      // Payout item
      const batchAcme = { id: uuidv4(), organizationId: org.id, currency: 'INR', createdAt: new Date(Date.now() - 20 * 86400000) };
      dbStore.payoutBatches.push(batchAcme as any);
      dbStore.payoutItems.push({
        id: uuidv4(),
        payoutBatchId: batchAcme.id,
        affiliateId: affAcme.id,
        amount: 2150,
        netAmount: 2150,
        grossAmount: 2150,
        taxWithheld: 0,
        status: 'PAID',
        createdAt: new Date(Date.now() - 20 * 86400000),
      } as any);
    }

    // 2. ZenPay affiliate (INR)
    let affZenpay = dbStore.affiliates.find((a) => a.organizationId === orgZenpay.id && a.email === affEmail);
    if (!affZenpay) {
      affZenpay = {
        id: uuidv4(),
        organizationId: orgZenpay.id,
        displayName: name,
        email: affEmail,
        companyName: isVenkat ? 'TechGrowth Hub India' : 'GrowthScale India',
        website: isVenkat ? 'https://techgrowthhub.io' : 'https://growthscale.agency',
        country: 'IN',
        status: AffiliateStatus.ACTIVE,
        trustScore: 92,
        payoutMethod: 'UPI',
        createdAt: new Date(Date.now() - 75 * 86400000),
        updatedAt: new Date(),
      };
      dbStore.affiliates.push(affZenpay);

      if (seedZenpayPrograms[0]) {
        dbStore.programAffiliates.push({
          id: uuidv4(),
          organizationId: orgZenpay.id,
          programId: seedZenpayPrograms[0].id,
          affiliateId: affZenpay.id,
          status: AffiliateStatus.ACTIVE,
          referralCode: isVenkat ? 'zenpay-ecom' : 'sarah-zenpay',
          joinedAt: new Date(Date.now() - 75 * 86400000),
        });

        const linkZenpay = {
          id: uuidv4(),
          organizationId: orgZenpay.id,
          programId: seedZenpayPrograms[0].id,
          affiliateId: affZenpay.id,
          destinationUrl: 'https://zenpay.in/business/signup',
          shortCode: isVenkat ? 'zenpay-ecom' : 'sarah-zenpay',
          status: TrackingLinkStatus.ACTIVE,
          title: 'E-Commerce Masterclass Resource Link',
          customAlias: isVenkat ? 'zenpay-ecom' : 'sarah-zenpay',
          clicks: 8900,
          createdAt: new Date(Date.now() - 70 * 86400000),
        };
        dbStore.trackingLinks.push(linkZenpay as any);

        // ZenPay Conversions (INR amounts)
        const convZen1 = {
          id: uuidv4(),
          organizationId: orgZenpay.id,
          programId: seedZenpayPrograms[0].id,
          affiliateId: affZenpay.id,
          trackingLinkId: linkZenpay.id,
          externalOrderId: 'MER-5521',
          customerEmail: 'anita@luxurysilks.in',
          amount: 150000,
          status: 'APPROVED',
          createdAt: new Date(Date.now() - 15 * 86400000),
        };
        dbStore.conversions.push(convZen1 as any);

        dbStore.commissions.push({
          id: uuidv4(),
          organizationId: orgZenpay.id,
          programId: seedZenpayPrograms[0].id,
          affiliateId: affZenpay.id,
          conversionId: convZen1.id,
          amount: 15000,
          status: 'PAYABLE',
          createdAt: new Date(Date.now() - 15 * 86400000),
        } as any);

        const batchZenpay = { id: uuidv4(), organizationId: orgZenpay.id, currency: 'INR', createdAt: new Date(Date.now() - 25 * 86400000) };
        dbStore.payoutBatches.push(batchZenpay as any);
        dbStore.payoutItems.push({
          id: uuidv4(),
          payoutBatchId: batchZenpay.id,
          affiliateId: affZenpay.id,
          amount: 104500,
          netAmount: 104500,
          grossAmount: 110000,
          taxWithheld: 5500,
          status: 'PAID',
          createdAt: new Date(Date.now() - 25 * 86400000),
        } as any);
      }
    }
  }

  // Seed Affiliate Invitations
  if (!dbStore.affiliateInvitations.some((i: any) => i.token === 'demo-cloudscale-token')) {
    dbStore.affiliateInvitations.push({
      id: uuidv4(),
      organizationId: org.id,
      programId: seedPrograms[0]?.id || uuidv4(),
      email: 'venkataramireddyvenky@gmail.com',
      partnerName: 'Venkata Rami Reddy',
      affiliateType: 'CONTENT_CREATOR',
      primaryChannel: 'YOUTUBE',
      commissionOverrideType: 'PERCENTAGE',
      commissionOverrideValue: 3500,
      token: 'demo-cloudscale-token',
      status: AffiliateInvitationStatus.PENDING,
      invitedByLabel: 'Acme Cloud Growth Team',
      personalMessage: 'Hey Venkata! We love your tutorials on Kubernetes and AI agents. We would love to partner with you with an elevated 35% revshare.',
      expiresAt: new Date(Date.now() + 14 * 86400000),
      createdAt: new Date(Date.now() - 2 * 86400000),
    } as any);
  }

  // Seed Marketing Assets for Acme and ZenPay
  if (!dbStore.assets.some((a: any) => a.title?.includes('Product Showcase Banner'))) {
    dbStore.assets.push(
      {
        id: uuidv4(),
        organizationId: org.id,
        programId: seedPrograms[0]?.id || uuidv4(),
        title: 'Dark Mode Product Showcase Banner (1200x630)',
        type: 'BANNER' as any,
        fileUrl: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1600&auto=format&fit=crop&q=80',
        tags: ['Twitter Card', 'Dark Mode'],
        createdAt: new Date(Date.now() - 40 * 86400000),
      } as any,
      {
        id: uuidv4(),
        organizationId: org.id,
        programId: seedPrograms[0]?.id || uuidv4(),
        title: 'Leaderboard Web Banner (728x90)',
        type: 'BANNER' as any,
        fileUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1600&auto=format&fit=crop&q=80',
        tags: ['Display Ad', 'DevOps'],
        createdAt: new Date(Date.now() - 35 * 86400000),
      } as any,
      {
        id: uuidv4(),
        organizationId: org.id,
        programId: seedPrograms[0]?.id || uuidv4(),
        title: 'High-Converting Newsletter Email Copy Template',
        type: 'EMAIL_TEMPLATE' as any,
        copyContent: `Subject: How we cut 42% off our monthly AWS Kubernetes bill ⚡\n\nHey {{subscriber_name}},\n\nGet 20% off your first 3 months using code {{coupon_code}}:\n{{affiliate_link}}\n\nCheers,\n{{partner_name}}`,
        tags: ['Email Template', 'Newsletter', 'Swipe Copy'],
        createdAt: new Date(Date.now() - 30 * 86400000),
      } as any,
      {
        id: uuidv4(),
        organizationId: orgZenpay.id,
        programId: seedZenpayPrograms[0]?.id || uuidv4(),
        title: 'ZenPay Instant UPI Checkout Video Teaser',
        type: 'VIDEO' as any,
        fileUrl: 'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=1600&auto=format&fit=crop&q=80',
        tags: ['Reel', 'Instagram', 'UPI'],
        createdAt: new Date(Date.now() - 25 * 86400000),
      } as any,
    );
  }

  // Seed Billing Coupons for Acme and ZenPay
  if (!dbStore.billingCoupons.some((c) => c.code === 'VENKAT20')) {
    dbStore.billingCoupons.push(
      {
        id: uuidv4(),
        organizationId: org.id,
        code: 'VENKAT20',
        type: 'PERCENTAGE' as any,
        amountOrPercentage: 20,
        status: 'ACTIVE' as any,
        timesRedeemed: 64,
        createdAt: new Date(Date.now() - 45 * 86400000),
      } as any,
      {
        id: uuidv4(),
        organizationId: orgZenpay.id,
        code: 'ZENFIRSTFREE',
        type: 'PERCENTAGE' as any,
        amountOrPercentage: 100,
        status: 'ACTIVE' as any,
        timesRedeemed: 35,
        createdAt: new Date(Date.now() - 40 * 86400000),
      } as any,
    );
  }

  let affiliate = dbStore.affiliates.find((a) => a.email === 'venkataramireddyvenky@gmail.com') || dbStore.affiliates[0];

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

  // Users, organizations, and organization memberships above are all created through raw TypeORM
  // repositories (dataSource.getRepository(...)), same as programs were before the dbStore.programs
  // mirroring above - which means services that read via dbStore (e.g. the affiliate eligibility
  // policy, which checks dbStore.users/dbStore.organizations/dbStore.organizationMemberships to
  // decide whether an invitee is already an active org member) would otherwise never see this seed
  // data at all. Mirror them into dbStore the same way, guarded against double-pushing on reseed.
  const seededUsers = await users.find();
  for (const u of seededUsers) {
    if (!dbStore.users.some((existing) => existing.id === u.id)) {
      dbStore.users.push(u as any);
    }
  }
  const seededOrganizations = await organizations.find();
  for (const o of seededOrganizations) {
    if (!dbStore.organizations.some((existing) => existing.id === o.id)) {
      dbStore.organizations.push(o as any);
    }
  }
  const seededMemberships = await memberships.find();
  for (const m of seededMemberships) {
    if (!dbStore.organizationMemberships.some((existing) => existing.id === m.id)) {
      dbStore.organizationMemberships.push(m as any);
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
      companyLegal: 'PartnerIQ',
      logoUrl:
        'https://res.cloudinary.com/bunny1705/image/upload/v1787584202/partneriq/92977d80-3e51-4a12-a382-64b42fb5466a/organization-logo/rrhwttefwtgrxico2rtv.png',
      websiteUrl: 'https://partneriq.in',
      docsUrl: 'https://docs.partneriq.in',
      privacyUrl: 'https://partneriq.in/privacy',
      termsUrl: 'https://partneriq.in/terms',
      supportEmail: 'info@partneriq.in',
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
