import { initializeDataSource } from '../data-source';
import {
  EmailDesignTemplate,
  EmailDesignSettings,
  Integration,
  BlogPost,
} from '../schema';
import { DEFAULT_BLOG_POSTS } from '../../modules/blogs/constants/default-blogs';
import { RoleDefinition, PermissionDefinition, RolePermission } from '../schema-rbac';
import { DataSource } from 'typeorm';
import {
  IntegrationCategory,
  IntegrationConnectionType,
  IntegrationStatus,
} from '../../common/enums';
import { RoleType } from '../../common/enums/rbac';
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
  const blogPostsRepo = dataSource.getRepository(BlogPost);

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
  await seedDefaultBlogs(blogPostsRepo);

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
 * This is core system catalog data, not demo data.
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

async function seedDefaultBlogs(blogPostsRepo: any) {
  let count = 0;
  for (const post of DEFAULT_BLOG_POSTS) {
    const existing = await blogPostsRepo.findOne({ where: { slug: post.slug } });
    if (existing) continue;

    await blogPostsRepo.save(blogPostsRepo.create({
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      content: post.content,
      coverImage: (post as any).coverImage,
      ogImage: (post as any).ogImage || `/og/blog-${post.slug}.svg`,
      category: post.category,
      tags: [...post.tags],
      author: { ...post.author },
      status: 'PUBLISHED',
      scopeType: 'GLOBAL',
      organizationId: null,
      readingTime: post.readingTime || '10 min read',
      featured: Boolean((post as any).featured),
      seoTitle: post.seoTitle || post.title,
      seoDescription: post.seoDescription || post.excerpt,
      canonicalUrl: post.canonicalUrl || `https://affiliate.partneriq.in/blog/${post.slug}`,
      publishedAt: post.publishedAt ? new Date(post.publishedAt) : new Date(),
      version: 1,
      createdAt: new Date(),
      updatedAt: post.updatedAt ? new Date(post.updatedAt) : new Date(),
    }));
    count++;
  }
  if (count > 0) {
    console.log(`Seeded ${count} global default educational blogs`);
  }
}

// `npm run seed` executes this file directly and applies only the
// production-safe system defaults (RBAC, templates, integration catalog, blogs).
//
// pathToFileURL() normalizes both sides the same way, so this guard works on
// Windows as well as macOS/Linux.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedSystemDefaults().catch(console.error);
}