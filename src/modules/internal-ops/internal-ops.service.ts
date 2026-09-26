import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
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
import { dbStore, awaitPersist } from '../../database/store';
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
import { seedSystemDefaults } from '../../database/seeds/run-seed';
import {
  UpdateSuperAdminDto,
  TriggerTestEmailDto,
  GenerateTestDocumentDto,
} from './dto/internal-ops.dto';

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

  // Super admin CREATION moved to `npm run create-super-admin` (see the
  // controller for why); this service no longer accepts a caller-supplied
  // password over HTTP for a brand-new or upgraded super admin.

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

    // Password changes are deliberately prohibited through this route.
    // They must be performed via CLI (`npm run create-super-admin`) or the user's password reset flow.
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

    // Guard: Refuse to delete or demote the last remaining SuperAdmin
    if (user.platformRole === PlatformRole.SUPER_ADMIN) {
      const activeSuperAdmins = repos.users
        ? await repos.users.count({ where: { platformRole: PlatformRole.SUPER_ADMIN, status: UserStatus.ACTIVE } })
        : dbStore.users.filter((u) => u.platformRole === PlatformRole.SUPER_ADMIN && u.status === UserStatus.ACTIVE).length;

      if (activeSuperAdmins <= 1) {
        throw new BadRequestException(
          'Cannot delete or revoke the last remaining active SuperAdmin account. The system requires at least one active SuperAdmin.',
        );
      }
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
        await awaitPersist(dbStore.users[idx]);
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
    if (process.env.ENABLE_DEV_FIXTURES !== 'true') {
      throw new ForbiddenException(
        'Test email triggering is disabled in production and requires ENABLE_DEV_FIXTURES=true.',
      );
    }

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
    if (process.env.ENABLE_DEV_FIXTURES !== 'true') {
      throw new ForbiddenException(
        'Test document generation is disabled in production and requires ENABLE_DEV_FIXTURES=true.',
      );
    }

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

  async purgeAllDemoData() {
    // The reviewed, dry-run-first SQL script (backend/scripts/cleanup-demo-data.sql)
    // is now the recommended way to do this against a real database — it lets
    // you see exactly what will be deleted before committing. This endpoint
    // stays available for local dev convenience only.
    if (process.env.ENABLE_DEV_FIXTURES !== 'true') {
      throw new ForbiddenException(
        'Use backend/scripts/cleanup-demo-data.sql instead — this endpoint requires ENABLE_DEV_FIXTURES=true.',
      );
    }

    this.logger.log('Purging all legacy demo organizations, demo users, and mock data...');
    const repos = await this.getRepositories();

    const demoOrgSlugs = ['acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp'];
    const demoUserEmails = [
      // NOTE: these must only ever be fake/placeholder addresses that seed
      // scripts create. A real user's personal email was hardcoded here
      // before — deleting "demo" data by a real customer's email is exactly
      // the kind of bug this purge is supposed to protect against.
      'demo-owner@partneriq.local',
      'demo.partner@partneriq.local',
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
    // Reassigning dbStore.X = dbStore.X.filter(...) would silently replace the
    // tracked, auto-persisting DBBackedArray instance with a plain array,
    // breaking future writes to that store for the rest of the process. Remove
    // matching rows in place via splice() instead, which keeps the array's
    // persistence wrapper intact and cascades the delete to the real repo.
    for (let i = dbStore.organizations.length - 1; i >= 0; i--) {
      if (demoOrgSlugs.includes(dbStore.organizations[i]?.slug || '')) {
        dbStore.organizations.splice(i, 1);
      }
    }
    for (let i = dbStore.users.length - 1; i >= 0; i--) {
      if (demoUserEmails.includes(dbStore.users[i]?.email)) {
        dbStore.users.splice(i, 1);
      }
    }
    for (let i = dbStore.programs.length - 1; i >= 0; i--) {
      if (demoOrgSlugs.some((s) => dbStore.programs[i]?.slug?.includes(s))) {
        dbStore.programs.splice(i, 1);
      }
    }
    for (let i = dbStore.affiliates.length - 1; i >= 0; i--) {
      if (demoUserEmails.includes(dbStore.affiliates[i]?.email)) {
        dbStore.affiliates.splice(i, 1);
      }
    }

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
    this.logger.log('Triggering system defaults seed on demand via internal ops API...');
    try {
      await seedSystemDefaults();
      return {
        success: true,
        message: 'System defaults seeded successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      this.logger.error(`System defaults seed failed: ${err?.message}`, err?.stack);
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
