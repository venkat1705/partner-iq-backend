import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, OrganizationEntity, OrganizationSettingsEntity, OrganizationBrandingEntity, AuditLogEntity } from '../../../database/store';
import { AppDataSource } from '../../../database/data-source';
import { Organization, OrganizationBranding, OrganizationSettings, OrganizationSecurityPolicy } from '../../../database/schema';
import { OrganizationStatus, AuditAction } from '../../../common/enums';
import {
  UpdateGeneralSettingsDto,
  UpdateProfileSettingsDto,
  UpdateLocalizationSettingsDto,
  UpdateTrackingSettingsDto,
  UpdateCommissionSettingsDto,
  UpdatePayoutSettingsDto,
  UpdateEmailSettingsDto,
  UpdateDocumentsSettingsDto,
  UpdateDomainsSettingsDto,
  UpdateDeveloperSettingsDto,
  UpdateSecuritySettingsDto,
  UpdatePrivacySettingsDto,
  ExportDataDto,
  DeactivateOrgDto,
  DeleteOrgDto,
} from './dto/organization-settings.dto';

export interface SettingsCompleteness {
  score: number; // 0 - 100
  completedItems: number;
  totalItems: number;
  checklist: {
    key: string;
    label: string;
    completed: boolean;
    section: string;
  }[];
}

@Injectable()
export class OrganizationSettingsService {
  /**
   * Fetch consolidated organization settings with branding and completeness score
   */
  async getSettings(organizationId: string) {
    const org = await this.resolveOrganization(organizationId);
    let settings = await this.resolveSettings(organizationId);
    let branding = await this.resolveBranding(organizationId);

    const completeness = this.calculateCompleteness(org, settings, branding);

    return {
      organization: org,
      branding,
      settings,
      completeness,
    };
  }

  /**
   * Update specific configuration section
   */
  async updateSection(
    organizationId: string,
    section: string,
    dto: any,
    actorId: string = 'system'
  ) {
    const org = await this.resolveOrganization(organizationId);
    const settings = await this.resolveSettings(organizationId);

    const beforeState = { ...settings };

    switch (section) {
      case 'general':
        await this.handleGeneralUpdate(org, settings, dto as UpdateGeneralSettingsDto);
        break;
      case 'profile':
        this.handleProfileUpdate(settings, dto as UpdateProfileSettingsDto);
        break;
      case 'localization':
        await this.handleLocalizationUpdate(org, settings, dto as UpdateLocalizationSettingsDto);
        break;
      case 'tracking':
        this.handleTrackingUpdate(settings, dto as UpdateTrackingSettingsDto);
        break;
      case 'commissions':
        this.handleCommissionsUpdate(settings, dto as UpdateCommissionSettingsDto);
        break;
      case 'payouts':
        this.handlePayoutsUpdate(settings, dto as UpdatePayoutSettingsDto);
        break;
      case 'email':
        this.handleEmailUpdate(settings, dto as UpdateEmailSettingsDto);
        break;
      case 'documents':
        this.handleDocumentsUpdate(settings, dto as UpdateDocumentsSettingsDto);
        break;
      case 'domains':
        this.handleDomainsUpdate(settings, dto as UpdateDomainsSettingsDto);
        break;
      case 'developer':
        this.handleDeveloperUpdate(settings, dto as UpdateDeveloperSettingsDto);
        break;
      case 'security':
        await this.handleSecurityUpdate(organizationId, settings, dto as UpdateSecuritySettingsDto, actorId);
        break;
      case 'privacy':
        this.handlePrivacyUpdate(settings, dto as UpdatePrivacySettingsDto);
        break;
      default:
        throw new BadRequestException(`Unknown settings section '${section}'`);
    }

    settings.version = (settings.version || 1) + 1;
    settings.updatedBy = actorId;
    settings.updatedAt = new Date();

    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(OrganizationSettings).save(settings);
    }

    // Persist in dbStore
    const idx = dbStore.organizationSettings.findIndex((s) => s.organizationId === organizationId);
    if (idx !== -1) {
      dbStore.organizationSettings[idx] = settings;
    } else {
      dbStore.organizationSettings.push(settings);
    }

    // Record audit log
    this.recordAudit(
      organizationId,
      actorId,
      `organization.settings.${section}.updated` as any,
      'organization_settings',
      settings.id,
      { before: beforeState, after: settings }
    );

    return this.getSettings(organizationId);
  }

  /**
   * Request full organization data export
   */
  async exportData(organizationId: string, actorId: string, dto: ExportDataDto) {
    const org = await this.resolveOrganization(organizationId);
    const settings = await this.resolveSettings(organizationId);
    const branding = await this.resolveBranding(organizationId);

    const programs = dbStore.programs.filter((p) => p.organizationId === organizationId);
    const links = dbStore.trackingLinks.filter((l) => l.organizationId === organizationId);

    const exportBundle = {
      exportId: uuidv4(),
      format: dto.format,
      generatedAt: new Date().toISOString(),
      requestedBy: actorId,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        country: org.country,
        currency: org.defaultCurrency,
      },
      branding,
      settings,
      programsCount: programs.length,
      trackingLinksCount: links.length,
    };

    this.recordAudit(
      organizationId,
      actorId,
      'organization.data_exported' as any,
      'organization',
      org.id,
      { format: dto.format }
    );

    return exportBundle;
  }

  /**
   * Deactivate organization
   */
  async deactivateOrganization(organizationId: string, actorId: string, dto: DeactivateOrgDto) {
    const org = await this.resolveOrganization(organizationId);
    org.status = OrganizationStatus.SUSPENDED;
    org.updatedAt = new Date();

    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(Organization).save(org);
    }

    this.recordAudit(
      organizationId,
      actorId,
      'organization.deactivated' as any,
      'organization',
      org.id,
      { reason: dto.reason }
    );

    return org;
  }

  /**
   * Soft-delete organization with strict slug match confirmation
   */
  async deleteOrganization(organizationId: string, actorId: string, dto: DeleteOrgDto) {
    const org = await this.resolveOrganization(organizationId);

    if (dto.confirmSlug !== org.slug) {
      throw new BadRequestException(
        `Confirmation slug '${dto.confirmSlug}' does not match organization slug '${org.slug}'. Deletion aborted.`
      );
    }

    org.status = OrganizationStatus.CLOSED;
    org.deletedAt = new Date();
    org.updatedAt = new Date();

    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(Organization).save(org);
    }

    this.recordAudit(
      organizationId,
      actorId,
      'organization.deleted' as any,
      'organization',
      org.id,
      { deletedAt: org.deletedAt }
    );

    return {
      success: true,
      message: `Organization '${org.name}' has been safely closed and scheduled for purge.`,
    };
  }

  // ---------------------------------------------------------------------------
  // SECTION UPDATE HANDLERS
  // ---------------------------------------------------------------------------

  private async handleGeneralUpdate(
    org: OrganizationEntity,
    settings: OrganizationSettingsEntity,
    dto: UpdateGeneralSettingsDto
  ) {
    if (dto.name) org.name = dto.name.trim();
    if (dto.website !== undefined) org.website = dto.website.trim();
    if (dto.industry !== undefined) org.industry = dto.industry.trim();
    if (dto.companySize !== undefined) org.companySize = dto.companySize.trim();

    if (dto.slug && dto.slug.trim() !== org.slug) {
      const normalizedSlug = dto.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      // Verify uniqueness
      const conflict = dbStore.organizations.find(
        (o) => o.slug === normalizedSlug && o.id !== org.id && !o.deletedAt
      );
      if (conflict) {
        throw new ConflictException(`Slug '${normalizedSlug}' is already taken by another organization.`);
      }
      org.slug = normalizedSlug;
    }

    org.updatedAt = new Date();
    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(Organization).save(org);
    }

    if (dto.description !== undefined) settings.description = dto.description.trim();
    if (dto.supportEmail !== undefined) settings.supportEmail = dto.supportEmail.trim();
    if (dto.contactEmail !== undefined) settings.contactEmail = dto.contactEmail.trim();
    if (dto.phone !== undefined) settings.phone = dto.phone.trim();
  }

  private handleProfileUpdate(settings: OrganizationSettingsEntity, dto: UpdateProfileSettingsDto) {
    if (dto.legalName !== undefined) settings.legalName = dto.legalName.trim();
    if (dto.addressLine1 !== undefined) settings.addressLine1 = dto.addressLine1.trim();
    if (dto.addressLine2 !== undefined) settings.addressLine2 = dto.addressLine2.trim();
    if (dto.city !== undefined) settings.city = dto.city.trim();
    if (dto.state !== undefined) settings.state = dto.state.trim();
    if (dto.postalCode !== undefined) settings.postalCode = dto.postalCode.trim();
    if (dto.country !== undefined) settings.country = dto.country.trim();
    if (dto.taxId !== undefined) settings.taxId = dto.taxId.trim();
  }

  private async handleLocalizationUpdate(
    org: OrganizationEntity,
    settings: OrganizationSettingsEntity,
    dto: UpdateLocalizationSettingsDto
  ) {
    if (dto.defaultCurrency) {
      org.defaultCurrency = dto.defaultCurrency.toUpperCase().trim();
      org.updatedAt = new Date();
      if (AppDataSource.isInitialized) {
        await AppDataSource.getRepository(Organization).save(org);
      }
    }
    if (dto.language) settings.language = dto.language.trim();
    if (dto.timezone) settings.timezone = dto.timezone.trim();
    if (dto.dateFormat) settings.dateFormat = dto.dateFormat.trim();
    if (dto.numberFormat) settings.numberFormat = dto.numberFormat.trim();
    if (dto.weekStartsOn) settings.weekStartsOn = dto.weekStartsOn;
  }

  private handleTrackingUpdate(settings: OrganizationSettingsEntity, dto: UpdateTrackingSettingsDto) {
    if (dto.defaultAttributionModel) settings.defaultAttributionModel = dto.defaultAttributionModel;
    if (dto.cookieDurationDays !== undefined) settings.cookieDurationDays = dto.cookieDurationDays;
    if (dto.attributionWindowDays !== undefined) settings.attributionWindowDays = dto.attributionWindowDays;
    if (dto.referralParam !== undefined) settings.referralParam = dto.referralParam.trim();
    if (dto.trackingDomain !== undefined) settings.trackingDomain = dto.trackingDomain.trim();
    if (dto.crossDomainTracking !== undefined) settings.crossDomainTracking = dto.crossDomainTracking;
    if (dto.deduplicationWindowHours !== undefined) settings.deduplicationWindowHours = dto.deduplicationWindowHours;
  }

  private handleCommissionsUpdate(settings: OrganizationSettingsEntity, dto: UpdateCommissionSettingsDto) {
    if (dto.defaultCommissionType) settings.defaultCommissionType = dto.defaultCommissionType;
    if (dto.defaultCommissionValue !== undefined) settings.defaultCommissionValue = dto.defaultCommissionValue;
    if (dto.holdPeriodDays !== undefined) settings.holdPeriodDays = dto.holdPeriodDays;
    if (dto.minimumThreshold !== undefined) settings.minimumThreshold = dto.minimumThreshold;
    if (dto.refundDeduction !== undefined) settings.refundDeduction = dto.refundDeduction;
    if (dto.reversalPolicy !== undefined) settings.reversalPolicy = dto.reversalPolicy;
  }

  private handlePayoutsUpdate(settings: OrganizationSettingsEntity, dto: UpdatePayoutSettingsDto) {
    if (dto.defaultPayoutSchedule) settings.defaultPayoutSchedule = dto.defaultPayoutSchedule;
    if (dto.minimumPayoutAmount !== undefined) settings.minimumPayoutAmount = dto.minimumPayoutAmount;
    if (dto.autoApprovePayouts !== undefined) settings.autoApprovePayouts = dto.autoApprovePayouts;
    if (dto.payoutHoldingDays !== undefined) settings.payoutHoldingDays = dto.payoutHoldingDays;
    if (dto.supportedPayoutMethods) settings.supportedPayoutMethods = dto.supportedPayoutMethods;
  }

  private handleEmailUpdate(settings: OrganizationSettingsEntity, dto: UpdateEmailSettingsDto) {
    if (dto.fromName !== undefined) settings.fromName = dto.fromName.trim();
    if (dto.fromEmail !== undefined) settings.fromEmail = dto.fromEmail.trim();
    if (dto.replyToEmail !== undefined) settings.replyToEmail = dto.replyToEmail.trim();
  }

  private handleDocumentsUpdate(settings: OrganizationSettingsEntity, dto: UpdateDocumentsSettingsDto) {
    if (dto.legalEntityName !== undefined) settings.legalEntityName = dto.legalEntityName.trim();
    if (dto.registeredAddress !== undefined) settings.registeredAddress = dto.registeredAddress.trim();
    if (dto.taxNumber !== undefined) settings.taxNumber = dto.taxNumber.trim();
    if (dto.invoiceFooterNote !== undefined) settings.invoiceFooterNote = dto.invoiceFooterNote.trim();
  }

  private handleDomainsUpdate(settings: OrganizationSettingsEntity, dto: UpdateDomainsSettingsDto) {
    if (dto.customDomain !== undefined) {
      settings.customDomain = dto.customDomain ? dto.customDomain.trim().toLowerCase() : undefined;
      settings.customDomainStatus = settings.customDomain ? 'VERIFIED' : 'NOT_CONFIGURED';
      settings.sslStatus = settings.customDomain ? 'ACTIVE' : 'PENDING';
      settings.dnsConfigured = Boolean(settings.customDomain);
    }
    if (dto.trackingCustomDomain !== undefined) {
      settings.trackingCustomDomain = dto.trackingCustomDomain ? dto.trackingCustomDomain.trim().toLowerCase() : undefined;
    }
  }

  private handleDeveloperUpdate(settings: OrganizationSettingsEntity, dto: UpdateDeveloperSettingsDto) {
    if (dto.apiAccessEnabled !== undefined) settings.apiAccessEnabled = dto.apiAccessEnabled;
    if (dto.apiRateLimitPerMinute !== undefined) settings.apiRateLimitPerMinute = dto.apiRateLimitPerMinute;
    if (dto.webhookDefaultTimeoutSeconds !== undefined) settings.webhookDefaultTimeoutSeconds = dto.webhookDefaultTimeoutSeconds;
    if (dto.webhookRetryLimit !== undefined) settings.webhookRetryLimit = dto.webhookRetryLimit;
    if (dto.webhookSignatureRequired !== undefined) settings.webhookSignatureRequired = dto.webhookSignatureRequired;
  }

  private async handleSecurityUpdate(
    organizationId: string,
    settings: OrganizationSettingsEntity,
    dto: UpdateSecuritySettingsDto,
    actorId: string
  ) {
    if (dto.allowGoogleLogin !== undefined) settings.allowGoogleLogin = dto.allowGoogleLogin;
    if (dto.allowPasswordLogin !== undefined) settings.allowPasswordLogin = dto.allowPasswordLogin;
    if (dto.singleSessionOnly !== undefined) settings.singleSessionOnly = dto.singleSessionOnly;
    if (dto.sessionTimeoutMinutes !== undefined) settings.sessionTimeoutMinutes = dto.sessionTimeoutMinutes;
    if (dto.require2fa !== undefined) settings.require2fa = dto.require2fa;
    if (dto.securityAlertEmail !== undefined) settings.securityAlertEmail = dto.securityAlertEmail.trim();

    // Sync with OrganizationSecurityPolicy table
    if (AppDataSource.isInitialized) {
      const secRepo = AppDataSource.getRepository(OrganizationSecurityPolicy);
      let secPolicy = await secRepo.findOne({ where: { organizationId } });
      if (!secPolicy) {
        secPolicy = new OrganizationSecurityPolicy();
        secPolicy.id = uuidv4();
        secPolicy.organizationId = organizationId;
      }
      if (dto.require2fa !== undefined) secPolicy.requireMfa = dto.require2fa;
      if (dto.sessionTimeoutMinutes !== undefined) secPolicy.sessionIdleTimeoutMinutes = dto.sessionTimeoutMinutes;
      secPolicy.updatedBy = actorId;
      await secRepo.save(secPolicy);
    }
  }

  private handlePrivacyUpdate(settings: OrganizationSettingsEntity, dto: UpdatePrivacySettingsDto) {
    if (dto.dataRetentionDays !== undefined) settings.dataRetentionDays = dto.dataRetentionDays;
    if (dto.analyticsCollection !== undefined) settings.analyticsCollection = dto.analyticsCollection;
    if (dto.ipLoggingEnabled !== undefined) settings.ipLoggingEnabled = dto.ipLoggingEnabled;
    if (dto.deviceMetadataEnabled !== undefined) settings.deviceMetadataEnabled = dto.deviceMetadataEnabled;
    if (dto.privacyContactEmail !== undefined) settings.privacyContactEmail = dto.privacyContactEmail.trim();
  }

  // ---------------------------------------------------------------------------
  // RESOLUTION & COMPLETENESS HELPERS
  // ---------------------------------------------------------------------------

  private async resolveOrganization(organizationId: string): Promise<OrganizationEntity> {
    let org = dbStore.organizations.find((o) => o.id === organizationId && !o.deletedAt);
    if (!org && AppDataSource.isInitialized) {
      const found = await AppDataSource.getRepository(Organization).findOne({ where: { id: organizationId } });
      if (found && !found.deletedAt) {
        org = found;
        if (!dbStore.organizations.some((o) => o.id === org!.id)) {
          dbStore.organizations.push(org);
        }
      }
    }
    if (!org) {
      throw new NotFoundException(`Organization '${organizationId}' not found.`);
    }
    return org;
  }

  private async resolveSettings(organizationId: string): Promise<OrganizationSettingsEntity> {
    let settings = dbStore.organizationSettings.find((s) => s.organizationId === organizationId);
    if (!settings && AppDataSource.isInitialized) {
      const found = await AppDataSource.getRepository(OrganizationSettings).findOne({ where: { organizationId } });
      if (found) {
        settings = found;
        dbStore.organizationSettings.push(settings);
      }
    }

    if (!settings) {
      // Seed default settings
      settings = new OrganizationSettings();
      settings.id = uuidv4();
      settings.organizationId = organizationId;
      settings.language = 'en';
      settings.timezone = 'America/New_York';
      settings.dateFormat = 'YYYY-MM-DD';
      settings.numberFormat = 'standard';
      settings.weekStartsOn = 'MONDAY';
      settings.defaultAttributionModel = 'LAST_TOUCH';
      settings.cookieDurationDays = 30;
      settings.attributionWindowDays = 30;
      settings.referralParam = 'via';
      settings.crossDomainTracking = false;
      settings.deduplicationWindowHours = 24;
      settings.defaultCommissionType = 'PERCENTAGE';
      settings.defaultCommissionValue = 1500;
      settings.holdPeriodDays = 30;
      settings.minimumThreshold = 5000;
      settings.refundDeduction = true;
      settings.reversalPolicy = 'AUTOMATIC';
      settings.defaultPayoutSchedule = 'MONTHLY';
      settings.minimumPayoutAmount = 5000;
      settings.autoApprovePayouts = false;
      settings.payoutHoldingDays = 14;
      settings.supportedPayoutMethods = ['PAYPAL', 'STRIPE', 'WISE', 'WIRE'];
      settings.providerName = 'Amazon SES';
      settings.providerStatus = 'CONNECTED';
      settings.customDomainStatus = 'NOT_CONFIGURED';
      settings.sslStatus = 'PENDING';
      settings.dnsConfigured = false;
      settings.apiAccessEnabled = true;
      settings.apiRateLimitPerMinute = 600;
      settings.webhookDefaultTimeoutSeconds = 10;
      settings.webhookRetryLimit = 5;
      settings.webhookSignatureRequired = true;
      settings.allowGoogleLogin = true;
      settings.allowPasswordLogin = true;
      settings.singleSessionOnly = false;
      settings.sessionTimeoutMinutes = 10080;
      settings.require2fa = false;
      settings.dataRetentionDays = 365;
      settings.analyticsCollection = true;
      settings.ipLoggingEnabled = true;
      settings.deviceMetadataEnabled = true;
      settings.version = 1;
      settings.updatedBy = 'system';
      settings.createdAt = new Date();
      settings.updatedAt = new Date();

      if (AppDataSource.isInitialized) {
        await AppDataSource.getRepository(OrganizationSettings).save(settings);
      }
      dbStore.organizationSettings.push(settings);
    }

    return settings;
  }

  private async resolveBranding(organizationId: string): Promise<OrganizationBrandingEntity | null> {
    let branding = dbStore.organizationBrandings.find((b) => b.organizationId === organizationId);
    if (!branding && AppDataSource.isInitialized) {
      const found = await AppDataSource.getRepository(OrganizationBranding).findOne({ where: { organizationId } });
      if (found) {
        branding = found;
        dbStore.organizationBrandings.push(branding);
      }
    }
    return branding || null;
  }

  private calculateCompleteness(
    org: OrganizationEntity,
    settings: OrganizationSettingsEntity,
    branding: OrganizationBrandingEntity | null
  ): SettingsCompleteness {
    const checklist = [
      {
        key: 'general',
        label: 'Organization Profile & Contact Information',
        completed: Boolean(org.name && (settings.supportEmail || settings.contactEmail || org.website)),
        section: 'general',
      },
      {
        key: 'branding',
        label: 'Brand Assets & Color Theme',
        completed: Boolean(branding?.logoUrl || branding?.primaryColor),
        section: 'branding',
      },
      {
        key: 'localization',
        label: 'Currency & Timezone Configuration',
        completed: Boolean(org.defaultCurrency && settings.timezone),
        section: 'localization',
      },
      {
        key: 'tracking',
        label: 'Attribution & Cookie Duration',
        completed: Boolean(settings.defaultAttributionModel && settings.cookieDurationDays > 0),
        section: 'tracking',
      },
      {
        key: 'commissions',
        label: 'Default Commission Structure',
        completed: Boolean(settings.defaultCommissionValue > 0),
        section: 'commissions',
      },
      {
        key: 'payouts',
        label: 'Payout Rails & Settlement Rules',
        completed: Boolean(settings.supportedPayoutMethods && settings.supportedPayoutMethods.length > 0),
        section: 'payouts',
      },
      {
        key: 'domains',
        label: 'Custom Domain or Tracking Domain',
        completed: settings.customDomainStatus === 'VERIFIED' || Boolean(settings.trackingDomain),
        section: 'domains',
      },
      {
        key: 'security',
        label: 'Security & Access Safeguards',
        completed: Boolean(settings.sessionTimeoutMinutes > 0),
        section: 'security',
      },
    ];

    const completedItems = checklist.filter((item) => item.completed).length;
    const totalItems = checklist.length;
    const score = Math.round((completedItems / totalItems) * 100);

    return {
      score,
      completedItems,
      totalItems,
      checklist,
    };
  }

  private recordAudit(
    organizationId: string,
    actorId: string,
    action: AuditAction,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, any>
  ) {
    const entry: AuditLogEntity = {
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action,
      resourceType,
      resourceId,
      metadata,
      createdAt: new Date(),
    };

    dbStore.auditLogs.push(entry);
  }
}

