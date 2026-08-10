import { dbStore } from '../store';
import { initializeDataSource } from '../data-source';
import { FraudSettings, Integration, Organization, OrganizationMembership, Program, User } from '../schema';
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
} from '../../common/enums';
import { MembershipStatus, RoleType, ProgramAccessType } from '../../common/enums/rbac';
import { PERMISSIONS, BUILT_IN_ROLES } from '../../common/constants/permission-catalog';
import { v4 as uuidv4 } from 'uuid';

export async function runSeed() {
  console.log('🌱 Seeding PartnerIQ database...');

  const dataSource = await initializeDataSource();
  const users = dataSource.getRepository(User);
  const organizations = dataSource.getRepository(Organization);
  const memberships = dataSource.getRepository(OrganizationMembership);
  const programs = dataSource.getRepository(Program);
  const fraudSettings = dataSource.getRepository(FraudSettings);
  const integrations = dataSource.getRepository(Integration);
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

  // Seed API Key for Acme
  if (!dbStore.apiKeys.some((k) => k.organizationId === org.id)) {
    const { key, prefix, hash } = SecurityUtils.generateApiKey('live');
    dbStore.apiKeys.push({
      id: uuidv4(),
      organizationId: org.id,
      name: 'Default Live Key',
      prefix,
      keyHash: hash,
      scopes: [
        'conversions:write',
        'conversions:read',
        'affiliates:write',
        'affiliates:read',
        'links:write',
        'links:read',
        'webhooks:manage',
      ],
      createdBy: admin.id,
      createdAt: new Date(),
    });
    console.log(`🔑 Seeded Live API Key for Acme SaaS: ${key}`);
  }

  const integrationCatalog = [
    ['STRIPE', 'Stripe', 'stripe', 'Stripe', IntegrationCategory.PAYMENTS, IntegrationStatus.ACTIVE, [IntegrationConnectionType.API_KEY, IntegrationConnectionType.WEBHOOK], true, true, false, 'Payment, subscription, refund, dispute, and checkout events from Stripe.', 'stripe'],
    ['PADDLE', 'Paddle', 'paddle', 'Paddle', IntegrationCategory.BILLING, IntegrationStatus.ACTIVE, [IntegrationConnectionType.API_KEY, IntegrationConnectionType.WEBHOOK], true, true, false, 'Merchant of record billing events for SaaS subscriptions and payments.', 'paddle'],
    ['CHARGEBEE', 'Chargebee', 'chargebee', 'Chargebee', IntegrationCategory.BILLING, IntegrationStatus.BETA, [IntegrationConnectionType.API_KEY, IntegrationConnectionType.WEBHOOK], true, true, false, 'Subscription lifecycle and invoice sync for Chargebee billing.', 'chargebee'],
    ['SHOPIFY', 'Shopify', 'shopify', 'Shopify', IntegrationCategory.COMMERCE, IntegrationStatus.BETA, [IntegrationConnectionType.OAUTH, IntegrationConnectionType.WEBHOOK], false, true, true, 'Order, customer, refund, and storefront purchase events from Shopify.', 'shopify'],
    ['WOOCOMMERCE', 'WooCommerce', 'woocommerce', 'WooCommerce', IntegrationCategory.COMMERCE, IntegrationStatus.BETA, [IntegrationConnectionType.API_KEY, IntegrationConnectionType.WEBHOOK], true, true, false, 'Commerce conversion and refund data from WooCommerce stores.', 'woocommerce'],
    ['HUBSPOT', 'HubSpot', 'hubspot', 'HubSpot', IntegrationCategory.CRM, IntegrationStatus.BETA, [IntegrationConnectionType.OAUTH, IntegrationConnectionType.WEBHOOK], false, true, true, 'CRM lifecycle and deal-stage events from HubSpot.', 'hubspot'],
    ['SALESFORCE', 'Salesforce', 'salesforce', 'Salesforce', IntegrationCategory.CRM, IntegrationStatus.COMING_SOON, [IntegrationConnectionType.OAUTH], false, false, true, 'Opportunity and account sync for Salesforce CRM.', 'salesforce'],
    ['ZAPIER', 'Zapier', 'zapier', 'Zapier', IntegrationCategory.AUTOMATION, IntegrationStatus.COMING_SOON, [IntegrationConnectionType.WEBHOOK], false, true, false, 'No-code workflow automation triggers and actions.', 'zapier'],
    ['SLACK', 'Slack', 'slack', 'Slack', IntegrationCategory.NOTIFICATIONS, IntegrationStatus.COMING_SOON, [IntegrationConnectionType.OAUTH, IntegrationConnectionType.WEBHOOK], false, true, true, 'Operational alerts for fraud, payouts, approvals, and system status.', 'slack'],
    ['PARTNERIQ_API', 'PartnerIQ API', 'partneriq-api', 'PartnerIQ', IntegrationCategory.DEVELOPER, IntegrationStatus.ACTIVE, [IntegrationConnectionType.API_KEY], true, false, false, 'Native REST API access for server-side integrations.', 'api'],
    ['PARTNERIQ_WEBHOOKS', 'PartnerIQ Webhooks', 'partneriq-webhooks', 'PartnerIQ', IntegrationCategory.DEVELOPER, IntegrationStatus.ACTIVE, [IntegrationConnectionType.WEBHOOK], false, true, false, 'Outbound webhook delivery for partner lifecycle and revenue events.', 'webhooks'],
    ['PARTNERIQ_NODE_SDK', 'Node SDK', 'partneriq-node-sdk', 'PartnerIQ', IntegrationCategory.DEVELOPER, IntegrationStatus.ACTIVE, [IntegrationConnectionType.SDK], false, false, false, 'Official Node.js SDK for conversion and affiliate event ingestion.', 'node'],
    ['PARTNERIQ_BROWSER_SDK', 'Browser SDK', 'partneriq-browser-sdk', 'PartnerIQ', IntegrationCategory.DEVELOPER, IntegrationStatus.ACTIVE, [IntegrationConnectionType.SDK], false, false, false, 'Browser-side tracking SDK for clicks and attribution signals.', 'browser'],
    ['SEGMENT', 'Segment', 'segment', 'Segment', IntegrationCategory.AUTOMATION, IntegrationStatus.COMING_SOON, [IntegrationConnectionType.WEBHOOK], false, true, false, 'Customer data routing into PartnerIQ events.', 'segment'],
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

  console.log('✅ Seed completed successfully!');
  console.log(`👤 Admin: admin@partneriq.demo | Password: PartnerIQ@123`);
  console.log(`👑 Super Admin: superadmin@partneriq.demo | Password: PartnerIQAdmin@123`);
  console.log(`🏢 Organization ID: ${org.id}`);
  return { admin, superAdmin, org, seedPrograms, affiliate };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed().catch(console.error);
}
