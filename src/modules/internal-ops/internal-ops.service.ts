import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { initializeDataSource } from '../../database/data-source';
import {
  User,
  Organization,
  Program,
  Affiliate,
  TrackingLink,
  Conversion,
  Commission,
  GeneratedDocument,
  Notification,
} from '../../database/schema';
import { dbStore } from '../../database/store';
import { SecurityUtils } from '../../common/utils/security.utils';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import {
  UserStatus,
  PlatformRole,
  Role,
  OrganizationStatus,
  ProgramType,
  ProgramStatus,
  CommissionType,
  AttributionModel,
  AffiliateStatus,
  TrackingLinkStatus,
  ConversionStatus,
  DocumentType,
} from '../../common/enums';
import { EmailDesignService } from '../email-design/email-design.service';
import { PdfGeneratorService } from '../email-design/services/pdf-generator.service';
import { EmailQueueProducer } from '../email-design/queue/email-queue.producer';
import {
  CreateSuperAdminDto,
  UpdateSuperAdminDto,
  TriggerTestEmailDto,
  GenerateTestDocumentDto,
  SeedSandboxOrgDto,
} from './dto/internal-ops.dto';
import { runSeed } from '../../database/seeds/run-seed';

@Injectable()
export class InternalOpsService {
  private readonly logger = new Logger(InternalOpsService.name);

  constructor(
    @Optional() private readonly emailDesignService?: EmailDesignService,
    @Optional() private readonly pdfGenerator?: PdfGeneratorService,
    @Optional() private readonly emailQueueProducer?: EmailQueueProducer,
  ) { }

  private async getRepositories() {
    const dataSource = await initializeDataSource();
    return {
      users: dataSource.getRepository(User),
      organizations: dataSource.getRepository(Organization),
      programs: dataSource.getRepository(Program),
      affiliates: dataSource.getRepository(Affiliate),
      trackingLinks: dataSource.getRepository(TrackingLink),
      conversions: dataSource.getRepository(Conversion),
      commissions: dataSource.getRepository(Commission),
      generatedDocs: dataSource.getRepository(GeneratedDocument),
      notifications: dataSource.getRepository(Notification),
    };
  }

  // ─────────────────────────────────────────────────────────
  // SUPERADMIN PROVISIONING & MANAGEMENT
  // ─────────────────────────────────────────────────────────

  async provisionSuperAdmin(dto: CreateSuperAdminDto) {
    const repos = await this.getRepositories();
    const email = dto.email.trim().toLowerCase();

    const passwordHash = await SecurityUtils.hashPassword(dto.password);
    let user = await repos.users.findOne({ where: { email } });

    let isNew = false;
    if (user) {
      this.logger.log(`Upgrading existing user ${email} (${user.id}) to SUPER_ADMIN`);
      user.platformRole = PlatformRole.SUPER_ADMIN;
      user.status = UserStatus.ACTIVE;
      user.emailVerified = dto.autoVerifyEmail !== false;
      user.firstName = dto.firstName || user.firstName;
      user.lastName = dto.lastName || user.lastName;
      user.passwordHash = passwordHash;
      user.failedLoginAttempts = 0;
      user = await repos.users.save(user);

      // Sync in dbStore
      const storeIdx = dbStore.users.findIndex((u) => u.id === user!.id);
      if (storeIdx !== -1) {
        dbStore.users[storeIdx] = user;
      } else {
        dbStore.users.push(user);
      }
    } else {
      this.logger.log(`Creating brand new SUPER_ADMIN account for ${email}`);
      isNew = true;
      user = repos.users.create({
        id: uuidv4(),
        email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        status: UserStatus.ACTIVE,
        emailVerified: dto.autoVerifyEmail !== false,
        platformRole: PlatformRole.SUPER_ADMIN,
        failedLoginAttempts: 0,
      });
      user = await repos.users.save(user);
      dbStore.users.push(user);
    }

    return {
      success: true,
      message: isNew
        ? `Superadmin created successfully for ${email}`
        : `User ${email} upgraded to Superadmin successfully with updated password and active status`,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        platformRole: user.platformRole,
        status: user.status,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      },
    };
  }

  async listSuperAdmins() {
    const repos = await this.getRepositories();
    const superAdmins = await repos.users.find({
      where: { platformRole: PlatformRole.SUPER_ADMIN },
      order: { createdAt: 'DESC' },
    });

    return {
      success: true,
      count: superAdmins.length,
      superAdmins: superAdmins.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        avatarUrl: u.avatarUrl,
        status: u.status,
        emailVerified: u.emailVerified,
        platformRole: u.platformRole,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      })),
    };
  }

  async getSuperAdminById(id: string) {
    const repos = await this.getRepositories();
    const user = await repos.users.findOne({ where: { id } });

    if (!user || user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new NotFoundException(`Superadmin with ID ${id} not found`);
    }

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        emailVerified: user.emailVerified,
        platformRole: user.platformRole,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      },
    };
  }

  async updateSuperAdmin(id: string, dto: UpdateSuperAdminDto) {
    const repos = await this.getRepositories();
    const user = await repos.users.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (dto.password) {
      user.passwordHash = await SecurityUtils.hashPassword(dto.password);
    }
    if (dto.firstName) user.firstName = dto.firstName;
    if (dto.lastName) user.lastName = dto.lastName;
    if (dto.status) user.status = dto.status;
    if (dto.emailVerified !== undefined) user.emailVerified = dto.emailVerified;

    const saved = await repos.users.save(user);

    // Sync in dbStore
    const idx = dbStore.users.findIndex((u) => u.id === id);
    if (idx !== -1) {
      dbStore.users[idx] = saved;
    }

    return {
      success: true,
      message: `Superadmin ${user.email} updated successfully`,
      user: {
        id: saved.id,
        email: saved.email,
        firstName: saved.firstName,
        lastName: saved.lastName,
        status: saved.status,
        emailVerified: saved.emailVerified,
        platformRole: saved.platformRole,
      },
    };
  }

  async revokeSuperAdmin(id: string, deletePermanently = false) {
    const repos = await this.getRepositories();
    const user = await repos.users.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (deletePermanently) {
      await repos.users.remove(user);
      dbStore.users = dbStore.users.filter((u) => u.id !== id);
      return {
        success: true,
        message: `Superadmin account ${user.email} permanently deleted`,
      };
    } else {
      user.platformRole = PlatformRole.USER;
      await repos.users.save(user);

      const idx = dbStore.users.findIndex((u) => u.id === id);
      if (idx !== -1) {
        dbStore.users[idx].platformRole = PlatformRole.USER;
      }

      return {
        success: true,
        message: `Superadmin privileges revoked for ${user.email} (demoted to standard user)`,
      };
    }
  }

  // ─────────────────────────────────────────────────────────
  // TEST DATA & EMAIL GENERATOR
  // ─────────────────────────────────────────────────────────

  async triggerTestEmail(dto: TriggerTestEmailDto) {
    this.logger.log(`Triggering test email for template '${dto.templateKey}' to ${dto.recipientEmail}`);

    const brandSettings = this.emailDesignService
      ? await this.emailDesignService.getSettings()
      : {
        name: 'PartnerIQ Technologies',
        supportEmail: 'info@partneriq.in',
        websiteUrl: 'https://partneriq.in',
      };

    const mergedVariables = {
      recipientName: dto.recipientName || 'Test User',
      recipientEmail: dto.recipientEmail,
      affiliateName: dto.recipientName || 'Sarah Jenkins',
      organizationName: brandSettings.name || 'PartnerIQ Technologies',
      supportEmail: brandSettings.supportEmail || 'info@partneriq.in',
      websiteUrl: brandSettings.websiteUrl || 'https://partneriq.in',
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }),
      ...(dto.variables || {}),
    };

    let subject = dto.subject || `[PartnerIQ Test] ${dto.templateKey} Notification`;
    let html = `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 24px;">
      <h2>PartnerIQ Test Notification</h2>
      <p>Template: <strong>${dto.templateKey}</strong></p>
      <p>Recipient: ${dto.recipientEmail}</p>
      <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-top: 16px;">
        <pre>${JSON.stringify(mergedVariables, null, 2)}</pre>
      </div>
    </body></html>`;

    // If EmailDesignService is available, resolve and render real visual template
    if (this.emailDesignService) {
      try {
        const preview = await (this.emailDesignService as any).renderPreview?.(dto.templateKey, mergedVariables);
        if (preview?.html) {
          html = preview.html;
          subject = dto.subject || preview.subject || subject;
        }
      } catch (err: any) {
        this.logger.warn(`Template render fallback: ${err?.message}`);
      }
    }

    let dispatched = false;
    let dispatchError: string | null = null;

    if (dto.sendViaProvider && this.emailQueueProducer) {
      try {
        await this.emailQueueProducer.enqueue({
          templateKey: dto.templateKey,
          recipientEmail: dto.recipientEmail,
          payload: {
            ...mergedVariables,
            subject,
          },
          metadata: {
            triggeredBy: 'INTERNAL_OPS_API',
          },
        });
        dispatched = true;
      } catch (err: any) {
        dispatchError = err?.message || 'Failed to dispatch via provider queue';
      }
    }

    return {
      success: true,
      message: dispatched
        ? `Test email queued and sent via provider to ${dto.recipientEmail}`
        : `Test email snapshot generated successfully for ${dto.recipientEmail}`,
      templateKey: dto.templateKey,
      recipientEmail: dto.recipientEmail,
      recipientName: dto.recipientName || 'Test User',
      subject,
      dispatched,
      dispatchError,
      renderedVariables: mergedVariables,
      renderedHtmlPreview: html,
      generatedAt: new Date().toISOString(),
    };
  }

  async generateTestDocument(dto: GenerateTestDocumentDto) {
    this.logger.log(`Generating test document snapshot for '${dto.templateKey}'`);

    const templateKey = dto.templateKey || 'CUSTOMER_SUBSCRIPTION_INVOICE';

    let generatedDocRecord: any = null;

    if (this.pdfGenerator) {
      generatedDocRecord = await this.pdfGenerator.generateAndRecordDocument({
        templateKey,
        documentType: templateKey.includes('INVOICE')
          ? DocumentType.INVOICE
          : templateKey.includes('STATEMENT')
            ? DocumentType.COMMISSION_STATEMENT
            : templateKey.includes('CERTIFICATE')
              ? DocumentType.CERTIFICATE
              : DocumentType.CUSTOM,
        documentNumber: `TEST-DOC-${Date.now().toString().slice(-6)}`,
        recipientName: dto.recipientName || 'Acme Growth Labs LLC',
        recipientEmail: dto.recipientEmail || 'billing@acmegrowth.com',
        renderOptions: {
          pageSize: 'A4',
          orientation: templateKey.includes('CERTIFICATE') ? 'landscape' : 'portrait',
          margins: { top: 20, right: 20, bottom: 20, left: 20, unit: 'mm' },
          bodyHtml: '',
          data: dto.customData || {},
          isTest: true,
        },
        isTest: true,
      });
    }

    return {
      success: true,
      message: `Test document '${templateKey}' generated and saved in database`,
      document: generatedDocRecord || {
        id: uuidv4(),
        templateKey,
        documentNumber: `TEST-DOC-${Date.now().toString().slice(-6)}`,
        recipientName: dto.recipientName || 'Acme Growth Labs LLC',
        recipientEmail: dto.recipientEmail || 'billing@acmegrowth.com',
        fontFamily: 'Montserrat',
        generatedAt: new Date().toISOString(),
      },
    };
  }

  async seedSandboxOrg(dto: SeedSandboxOrgDto) {
    const repos = await this.getRepositories();
    const orgName = dto.organizationName.trim();
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const ownerEmail = dto.ownerEmail.trim().toLowerCase();

    // 1. Ensure Owner User
    let owner = await repos.users.findOne({ where: { email: ownerEmail } });
    if (!owner) {
      const passwordHash = await SecurityUtils.hashPassword('SandboxPass@2026');
      owner = repos.users.create({
        id: uuidv4(),
        email: ownerEmail,
        passwordHash,
        firstName: 'Sandbox',
        lastName: 'Admin',
        status: UserStatus.ACTIVE,
        emailVerified: true,
        platformRole: PlatformRole.USER,
      });
      owner = await repos.users.save(owner);
      dbStore.users.push(owner);
    }

    // 2. Create Organization
    let org = await repos.organizations.findOne({ where: { slug } });
    if (!org) {
      org = repos.organizations.create({
        name: orgName,
        slug,
        website: `https://${slug}.demo`,
        country: 'IN',
        defaultCurrency: PLATFORM_CURRENCY,
        status: OrganizationStatus.ACTIVE,
        onboardingCompleted: true,
        createdBy: owner.id,
      });
      org = await repos.organizations.save(org);
      dbStore.organizations.push(org);
    }

    // 3. Create Default Program
    let program = await repos.programs.findOne({ where: { slug: `${slug}-growth` } });
    if (!program) {
      program = repos.programs.create({
        organizationId: org.id,
        name: `${orgName} Partner Growth Program`,
        slug: `${slug}-growth`,
        status: ProgramStatus.ACTIVE,
        commissionType: CommissionType.PERCENTAGE,
        defaultCommissionValue: 20.0,
        cookieDurationDays: 60,
        attributionModel: AttributionModel.LAST_CLICK,
        affiliateApprovalMode: 'AUTO',
        createdBy: owner.id,
      });
      program = await repos.programs.save(program);
      dbStore.programs.push(program);
    }

    // 4. Generate Affiliates in in-memory store and DB
    const affiliatesCount = dto.generateAffiliatesCount || 5;
    const createdAffiliates: any[] = [];

    for (let i = 1; i <= affiliatesCount; i++) {
      const affEmail = `partner${i}.${slug}@creators.io`;
      let affUser = await repos.users.findOne({ where: { email: affEmail } });
      if (!affUser) {
        affUser = repos.users.create({
          id: uuidv4(),
          email: affEmail,
          passwordHash: await SecurityUtils.hashPassword('PartnerPass@2026'),
          firstName: `Partner`,
          lastName: `${i}`,
          status: UserStatus.ACTIVE,
          emailVerified: true,
          platformRole: PlatformRole.USER,
        });
        affUser = await repos.users.save(affUser);
        dbStore.users.push(affUser);
      }

      const referralCode = `PIQ-${slug.toUpperCase().slice(0, 4)}-${i}${Math.floor(100 + Math.random() * 900)}`;
      const affId = uuidv4();

      const affObj = {
        id: affId,
        organizationId: org.id,
        displayName: `Partner ${i} (${orgName})`,
        email: affEmail,
        companyName: `${orgName} Growth Partner ${i}`,
        website: `https://partner${i}-${slug}.io`,
        country: 'US',
        status: AffiliateStatus.ACTIVE,
        trustScore: 90,
        payoutMethod: 'MANUAL',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.affiliates.push(affObj as any);

      dbStore.programAffiliates.push({
        id: uuidv4(),
        organizationId: org.id,
        programId: program.id,
        affiliateId: affId,
        status: AffiliateStatus.ACTIVE,
        referralCode,
        joinedAt: new Date(),
      });

      const trackingLink = {
        id: uuidv4(),
        organizationId: org.id,
        programId: program.id,
        affiliateId: affId,
        destinationUrl: `https://${slug}.demo/?ref=${referralCode}`,
        shortCode: referralCode.toLowerCase(),
        status: TrackingLinkStatus.ACTIVE,
        title: `${orgName} Primary Tracking Link`,
        campaign: 'direct_referral',
        clicks: 120 * i,
        createdAt: new Date(),
      };
      dbStore.trackingLinks.push(trackingLink as any);

      createdAffiliates.push({
        id: affId,
        email: affEmail,
        referralCode,
        trackingLink: trackingLink.destinationUrl,
      });
    }

    return {
      success: true,
      message: `Sandbox organization '${orgName}' provisioned with ${createdAffiliates.length} affiliates and tracking links`,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        ownerEmail: owner.email,
        programId: program.id,
        programName: program.name,
      },
      affiliates: createdAffiliates,
    };
  }

  async purgeAllDemoData() {
    this.logger.log('Purging all legacy demo organizations, demo users, and mock data...');
    const repos = await this.getRepositories();

    const demoOrgSlugs = ['acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp'];
    const demoUserEmails = [
      'admin@partneriq.demo',
      'superadmin@partneriq.demo',
      'venkataramireddyvenky@gmail.com',
      'sarah.lin@growthscale.agency',
      'sarah@growthpartner.com',
    ];

    let purgedOrgsCount = 0;
    let purgedUsersCount = 0;

    // 1. Purge Demo Organizations & Cascading Data
    for (const slug of demoOrgSlugs) {
      const org = await repos.organizations.findOne({ where: { slug } });
      if (org) {
        await repos.organizations.remove(org);
        purgedOrgsCount++;
      }
    }

    // 2. Purge Demo Users (except custom provisioned superadmins)
    for (const email of demoUserEmails) {
      const user = await repos.users.findOne({ where: { email } });
      if (user) {
        await repos.users.remove(user);
        purgedUsersCount++;
      }
    }

    // 3. Clean In-Memory Store
    dbStore.organizations = dbStore.organizations.filter((o) => !demoOrgSlugs.includes(o.slug));
    dbStore.users = dbStore.users.filter((u) => !demoUserEmails.includes(u.email));
    dbStore.programs = dbStore.programs.filter((p) => !demoOrgSlugs.some((s) => p.slug?.includes(s)));
    dbStore.affiliates = dbStore.affiliates.filter((a) => !demoUserEmails.includes(a.email));

    return {
      success: true,
      message: `Purged ${purgedOrgsCount} demo organizations and ${purgedUsersCount} demo users from the database.`,
      purged: {
        organizations: purgedOrgsCount,
        users: purgedUsersCount,
      },
      remaining: {
        totalUsers: await repos.users.count(),
        totalSuperAdmins: await repos.users.count({ where: { platformRole: PlatformRole.SUPER_ADMIN } }),
        totalOrganizations: await repos.organizations.count(),
      },
    };
  }

  async runFullSeedOnDemand() {
    this.logger.log('Triggering full seed on demand via internal ops API...');
    try {
      await runSeed();
      return {
        success: true,
        message: 'Database full seed completed successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      this.logger.error(`Full seed failed: ${err?.message}`, err?.stack);
      throw new InternalServerErrorException(`Seeding failed: ${err?.message}`);
    }
  }

  async getSystemOverview() {
    const repos = await this.getRepositories();

    const [
      totalUsers,
      totalSuperAdmins,
      totalOrgs,
      totalPrograms,
      totalAffiliates,
      totalConversions,
      totalGeneratedDocs,
    ] = await Promise.all([
      repos.users.count(),
      repos.users.count({ where: { platformRole: PlatformRole.SUPER_ADMIN } }),
      repos.organizations.count(),
      repos.programs.count(),
      repos.affiliates.count(),
      repos.conversions.count(),
      repos.generatedDocs.count(),
    ]);

    return {
      success: true,
      database: 'Connected (MySQL / TypeORM)',
      stats: {
        totalUsers,
        totalSuperAdmins,
        totalOrganizations: totalOrgs,
        totalPrograms,
        totalAffiliates,
        totalConversions,
        totalGeneratedDocuments: totalGeneratedDocs,
        inMemoryStoreSynced: {
          usersCount: dbStore.users.length,
          orgsCount: dbStore.organizations.length,
          programsCount: dbStore.programs.length,
        },
      },
      serverTime: new Date().toISOString(),
    };
  }
}
