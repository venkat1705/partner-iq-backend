import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { dbStore, TrackingLinkEntity, ClickEntity, AttributionEntity } from '../../database/store';
import { AuditAction, EnvironmentType, FraudStatus, TrackingLinkStatus, ProgramStatus, AffiliateStatus } from '../../common/enums';
import { SecurityUtils } from '../../common/utils/security.utils';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import { FraudService } from '../fraud/fraud.service';
import { PerformanceAggregationService } from '../gamification/performance/performance-aggregation.service';
import { AutomationEngineService } from '../automations/engine/automation-engine.service';
import { AutomationTriggerType } from '../../common/enums';
import { CreateTrackingLinkDto, BrowserClickDto, IdentifyCustomerDto } from './dto/tracking.dto';
import { AuditService } from '../audit/audit.service';

interface UtmContext {
  landingUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  affiliateId?: string;
}

@Injectable()
export class TrackingService {
  constructor(
    private readonly fraudService: FraudService,
    private readonly performanceAggregationService?: PerformanceAggregationService,
    private readonly automationEngineService?: AutomationEngineService,
    private readonly auditService?: AuditService,
  ) { }

  private audit(entry: {
    organizationId?: string;
    actorType: 'user' | 'system' | 'api_key';
    actorId: string;
    action: AuditAction;
    resourceType: string;
    resourceId: string;
    metadata?: any;
  }) {
    if (this.auditService) {
      this.auditService.log(entry);
      return;
    }
    // Fallback for call sites that construct TrackingService directly without DI (e.g. tests).
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId: entry.organizationId,
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: entry.metadata,
      createdAt: new Date(),
    });
  }

  async createLink(organizationId: string, dto: CreateTrackingLinkDto, actorId?: string, environment: EnvironmentType = EnvironmentType.LIVE) {
    const program = dbStore.programs.find((p) => p.id === dto.programId && !p.deletedAt);
    if (!program) {
      throw new BadRequestException('Program not found');
    }
    EnvironmentUtils.assertEnvironmentIntegrity(
      { organizationId, environment },
      { organizationId: program.organizationId, environment: program.environment },
      'Program',
    );
    if (program.status !== ProgramStatus.ACTIVE) {
      throw new BadRequestException('Cannot create tracking links for a program that is not active');
    }

    const affiliate = dbStore.affiliates.find((a) => a.id === dto.affiliateId && a.organizationId === organizationId);
    if (!affiliate) {
      throw new BadRequestException('Affiliate not found');
    }
    if (affiliate.status !== AffiliateStatus.ACTIVE) {
      throw new BadRequestException('Cannot create tracking links for an affiliate that is not active');
    }

    const shortCode = (
      dto.customCode || SecurityUtils.generateRandomCode(6)
    ).toLowerCase();

    const existing = dbStore.trackingLinks.find(
      (l) => l.shortCode === shortCode && l.organizationId === organizationId && (l.environment === environment || (!l.environment && environment === EnvironmentType.LIVE)),
    );

    if (existing) {
      throw new BadRequestException('Short code is already taken');
    }

    const link: TrackingLinkEntity = {
      id: uuidv4(),
      organizationId,
      environment,
      programId: dto.programId,
      affiliateId: dto.affiliateId,
      campaignId: dto.campaignId,
      destinationUrl: dto.destinationUrl,
      shortCode,
      status: TrackingLinkStatus.ACTIVE,
      createdAt: new Date(),
    };

    dbStore.trackingLinks.push(link);

    // 1. Performance Aggregation
    await this.performanceAggregationService?.recordTrackingLinkCreated(
      organizationId,
      dto.programId,
      dto.affiliateId,
    );

    // 2. Trigger Automations
    await this.automationEngineService?.handleEvent(
      AutomationTriggerType.TRACKING_LINK_CREATED,
      organizationId,
      dto.programId,
      dto.affiliateId,
      { trackingLinkId: link.id, shortCode },
    );

    this.audit({
      organizationId,
      actorType: 'user',
      actorId: actorId || 'system',
      action: 'TRACKING_LINK_CREATED' as AuditAction,
      resourceType: 'tracking_link',
      resourceId: link.id,
      metadata: {
        programId: link.programId,
        affiliateId: link.affiliateId,
        campaignId: link.campaignId,
        shortCode: link.shortCode,
        destinationUrl: link.destinationUrl,
      },
    });
    return link;
  }

  async getLinks(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE, programId?: string) {
    const orgAffiliates = dbStore.affiliates.filter(
      (a) => a.organizationId === organizationId,
    );
    const isSingleAffiliateOrg = orgAffiliates.length === 1;
    const singleAffiliate = isSingleAffiliateOrg ? orgAffiliates[0] : undefined;

    return dbStore.trackingLinks
      .filter((l) =>
        l.organizationId === organizationId &&
        (l.environment === environment || (!l.environment && environment === EnvironmentType.LIVE)) &&
        (!programId || l.programId === programId),
      )
      .map((link) => {
        const {
          __dbStoreProxy: _proxyMarker,
          ...publicLink
        } = link as TrackingLinkEntity & { __dbStoreProxy?: boolean };

        const targetAffiliateId = link.affiliateId || (isSingleAffiliateOrg ? singleAffiliate?.id : undefined);

        const clicks = dbStore.clicks.filter((click) =>
          click.organizationId === organizationId &&
          (click.environment === environment || (!click.environment && environment === EnvironmentType.LIVE)) &&
          (
            click.trackingLinkId === link.id ||
            (targetAffiliateId && click.affiliateId === targetAffiliateId && click.programId === link.programId) ||
            (isSingleAffiliateOrg && singleAffiliate && (click.affiliateId === singleAffiliate.id || !click.affiliateId))
          ),
        );
        const clickIds = new Set(clicks.map((c) => c.id));
        const clickAffiliateIds = new Set(clicks.map((c) => c.affiliateId).filter(Boolean));

        const conversions = dbStore.conversions.filter(
          (conversion) =>
            conversion.organizationId === organizationId &&
            (conversion.environment === environment || (!conversion.environment && environment === EnvironmentType.LIVE)) &&
            (
              (conversion.clickId && clickIds.has(conversion.clickId)) ||
              (conversion.programId === link.programId && (
                (targetAffiliateId && conversion.affiliateId === targetAffiliateId) ||
                clickAffiliateIds.has(conversion.affiliateId) ||
                (isSingleAffiliateOrg && singleAffiliate && (conversion.affiliateId === singleAffiliate.id || !conversion.affiliateId))
              )) ||
              (isSingleAffiliateOrg && singleAffiliate && conversion.affiliateId === singleAffiliate.id)
            ),
        );

        return {
          ...publicLink,
          affiliateId: targetAffiliateId || link.affiliateId,
          clicks: clicks.length,
          conversions: conversions.length,
          revenue: conversions.reduce((total, conversion) => total + Number(conversion.amount || 0), 0) / 100,
        };
      });
  }

  // High Performance Redirect Handler
  // Click ID (the resulting Click.id) is the primary, durable attribution identifier.
  // The browser cookie set by the caller is only a transport convenience layered on top of it.
  async handleRedirect(
    shortCode: string,
    userAgent?: string,
    ipAddress?: string,
    referrer?: string,
    country?: string,
    utm?: UtmContext,
  ) {
    const link = dbStore.trackingLinks.find(
      (l) => l.shortCode === shortCode.toLowerCase() && l.status === TrackingLinkStatus.ACTIVE,
    );

    if (!link) {
      throw new NotFoundException('Tracking link not found or inactive');
    }

    const program = dbStore.programs.find((p) => p.id === link.programId && !p.deletedAt);

    // Resolve the intended affiliate:
    // 1. Explicitly passed in query parameter (e.g. ?aff=... or ?ref=...)
    let affiliate = utm?.affiliateId
      ? dbStore.affiliates.find(
        (a) =>
          (a.id === utm.affiliateId || (a as any).referralCode === utm.affiliateId || a.email === utm.affiliateId) &&
          a.organizationId === link.organizationId,
      )
      : undefined;

    // 2. Or look up affiliate directly attached to the tracking link
    if (!affiliate && link.affiliateId) {
      affiliate = dbStore.affiliates.find((a) => a.id === link.affiliateId);
    }

    // 3. Fallback: if link's affiliate was unassigned or belongs to another record,
    // resolve to the active affiliate for this organization and program
    if (!affiliate) {
      affiliate =
        dbStore.affiliates.find(
          (a) => a.organizationId === link.organizationId && a.status === AffiliateStatus.ACTIVE,
        ) ||
        dbStore.affiliates.find((a) => a.organizationId === link.organizationId);

      // Auto-bind to link so subsequent lookups are immediately aligned
      if (affiliate && !link.affiliateId) {
        link.affiliateId = affiliate.id;
      }
    }

    // A link whose program/affiliate is no longer active still redirects (avoid breaking a
    // customer-facing URL that may be published elsewhere), but must not manufacture a click,
    // attribution, or commission opportunity for a suspended affiliate / paused program.
    const isEligibleForTracking =
      !!program && program.status === ProgramStatus.ACTIVE &&
      !!affiliate && affiliate.status === AffiliateStatus.ACTIVE;

    if (!isEligibleForTracking) {
      this.audit({
        organizationId: link.organizationId,
        actorType: 'system',
        actorId: 'system',
        action: AuditAction.CLICK_REJECTED,
        resourceType: 'tracking_link',
        resourceId: link.id,
        metadata: {
          reason: !program || program.status !== ProgramStatus.ACTIVE ? 'PROGRAM_INACTIVE' : 'AFFILIATE_INACTIVE',
          programId: link.programId,
          affiliateId: affiliate?.id || link.affiliateId,
        },
      });
      return {
        destinationUrl: link.destinationUrl,
        anonymousId: undefined,
        clickId: undefined,
        cookieMaxAgeMs: 0,
        tracked: false,
      };
    }

    EnvironmentUtils.assertEnvironmentIntegrity(
      { organizationId: link.organizationId, environment: link.environment },
      { organizationId: program!.organizationId, environment: program!.environment },
      'Program',
    );

    const anonymousId = `anon_${uuidv4()}`;
    const ipHash = ipAddress ? crypto.createHmac('sha256', process.env.FRAUD_IP_HASH_SECRET || process.env.JWT_SECRET || 'partneriq-fraud-ip-salt').update(ipAddress).digest('hex') : 'unknown';

    // Record Click - this Click.id is the authoritative, server-side attribution identifier.
    const click: ClickEntity = {
      id: uuidv4(),
      organizationId: link.organizationId,
      environment: link.environment || EnvironmentType.LIVE,
      programId: link.programId,
      affiliateId: affiliate.id,
      trackingLinkId: link.id,
      anonymousId,
      ipHash,
      ipEncrypted: ipAddress && ipAddress !== 'unknown' ? SecurityUtils.encrypt(ipAddress) : undefined,
      userAgent: userAgent || 'unknown',
      referrer: referrer || 'direct',
      landingUrl: utm?.landingUrl,
      utmSource: utm?.utmSource,
      utmMedium: utm?.utmMedium,
      utmCampaign: utm?.utmCampaign,
      utmTerm: utm?.utmTerm,
      utmContent: utm?.utmContent,
      country: country || 'unknown',
      deviceType: this.getDeviceType(userAgent),
      browser: this.getBrowser(userAgent),
      os: this.getOperatingSystem(userAgent),
      fraudScore: 0,
      fraudStatus: FraudStatus.LOW,
      createdAt: new Date(),
    };
    dbStore.clicks.push(click);

    this.audit({
      organizationId: link.organizationId,
      actorType: 'system',
      actorId: 'system',
      action: AuditAction.CLICK_CREATED,
      resourceType: 'click',
      resourceId: click.id,
      metadata: {
        programId: link.programId,
        affiliateId: affiliate.id,
        trackingLinkId: link.id,
        utmSource: click.utmSource,
        utmMedium: click.utmMedium,
        utmCampaign: click.utmCampaign,
      },
    });

    // Record click in performance summary
    this.performanceAggregationService?.recordClick(link.organizationId, link.programId, affiliate.id);

    this.fraudService.evaluateClick(click.id, ipAddress).catch((error) => {
      console.error('click fraud assessment failed:', error?.message || error);
    });

    // Record Attribution Record. The attribution window is fully program-configurable;
    // this same duration also drives the first-party cookie's maxAge (see handleRedirect callers)
    // so the two never drift apart.
    const cookieDays = program!.cookieDurationDays || program!.attributionWindowDays || 30;
    const expiresAt = new Date(Date.now() + cookieDays * 24 * 3600 * 1000);

    const attribution: AttributionEntity = {
      id: uuidv4(),
      organizationId: link.organizationId,
      environment: link.environment || EnvironmentType.LIVE,
      programId: link.programId,
      affiliateId: affiliate.id,
      clickId: click.id,
      anonymousId,
      model: program!.attributionModel || ('LAST_CLICK' as any),
      breakdown: [{
        affiliateId: affiliate.id,
        clickId: click.id,
        model: program!.attributionModel || 'LAST_CLICK',
        weight: 1,
        createdAt: new Date().toISOString(),
      }],
      expiresAt,
      createdAt: new Date(),
    };
    dbStore.attributions.push(attribution);

    this.audit({
      organizationId: link.organizationId,
      actorType: 'system',
      actorId: 'system',
      action: AuditAction.ATTRIBUTION_CREATED,
      resourceType: 'attribution',
      resourceId: attribution.id,
      metadata: {
        clickId: click.id,
        affiliateId: affiliate.id,
        programId: link.programId,
        expiresAt: attribution.expiresAt,
      },
    });

    return {
      destinationUrl: link.destinationUrl,
      anonymousId,
      clickId: click.id,
      cookieMaxAgeMs: cookieDays * 24 * 3600 * 1000,
      tracked: true,
    };
  }

  private getDeviceType(userAgent?: string) {
    if (!userAgent) return 'unknown';
    if (/mobile|android|iphone|ipad/i.test(userAgent)) return 'mobile';
    return 'desktop';
  }

  private getBrowser(userAgent?: string) {
    if (!userAgent) return 'unknown';
    if (/edg\//i.test(userAgent)) return 'Edge';
    if (/chrome\//i.test(userAgent)) return 'Chrome';
    if (/firefox\//i.test(userAgent)) return 'Firefox';
    if (/safari\//i.test(userAgent)) return 'Safari';
    return 'unknown';
  }

  private getOperatingSystem(userAgent?: string) {
    if (!userAgent) return 'unknown';
    if (/windows/i.test(userAgent)) return 'Windows';
    if (/android/i.test(userAgent)) return 'Android';
    if (/iphone|ipad|ios/i.test(userAgent)) return 'iOS';
    if (/mac os/i.test(userAgent)) return 'macOS';
    if (/linux/i.test(userAgent)) return 'Linux';
    return 'unknown';
  }

  // Browser SDK click tracking API. Gated only by a per-org public key, which is intentionally
  // embeddable in client-side JS (like a publishable/publicly-readable key) - it authorizes
  // "record a click for this org", nothing more sensitive.
  async handleBrowserClick(dto: BrowserClickDto, userAgent?: string, ipAddress?: string) {
    const pubKey = dbStore.publicKeys.find((k) => k.key === dto.publicKey);
    if (!pubKey) {
      throw new BadRequestException('Invalid public tracking key');
    }

    const link = dbStore.trackingLinks.find((l) => l.shortCode === dto.shortCode.toLowerCase());
    if (link && link.organizationId !== pubKey.organizationId) {
      // The public key must belong to the same tenant as the tracking link it is trying to record
      // a click for - otherwise org A's public key could be used to mint clicks against org B's links.
      throw new BadRequestException('Public key does not match tracking link organization');
    }

    return this.handleRedirect(dto.shortCode, userAgent, ipAddress, undefined, undefined, {
      landingUrl: dto.landingUrl,
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      utmTerm: dto.utmTerm,
      utmContent: dto.utmContent,
    });
  }

  // Customer identity resolution API. This is the mechanism that lets attribution survive
  // cookie deletion: once a customer becomes identifiable (signup/login/checkout), the merchant's
  // site calls this to durably link customerExternalId -> the anonymous click's attribution record
  // server-side, independent of whatever happens to the browser cookie afterwards.
  async identifyCustomer(dto: IdentifyCustomerDto) {
    const pubKey = dbStore.publicKeys.find((k) => k.key === dto.publicKey);
    if (!pubKey) {
      throw new BadRequestException('Invalid public tracking key');
    }

    const attributions = dbStore.attributions.filter(
      (a) => a.organizationId === pubKey.organizationId && a.anonymousId === dto.anonymousId,
    );

    if (!attributions.length) {
      this.audit({
        organizationId: pubKey.organizationId,
        actorType: 'system',
        actorId: 'system',
        action: AuditAction.CUSTOMER_IDENTITY_LINK_REJECTED,
        resourceType: 'attribution',
        resourceId: dto.anonymousId,
        metadata: { reason: 'NO_MATCHING_ATTRIBUTION' },
      });
      return { success: false, updatedAttributions: 0 };
    }

    // Identity is a claim, not a re-assignment tool: once an attribution is durably linked to a
    // customer, a later call with a *different* customerExternalId for the same anonymousId is
    // rejected rather than silently overwritten - this is the main lever an attacker holding a
    // leaked/guessed anonymousId would otherwise have to hijack another customer's attribution.
    const conflicting = attributions.filter(
      (a) => a.customerExternalId && a.customerExternalId !== dto.customerExternalId,
    );
    if (conflicting.length) {
      this.audit({
        organizationId: pubKey.organizationId,
        actorType: 'system',
        actorId: 'system',
        action: AuditAction.CUSTOMER_IDENTITY_LINK_REJECTED,
        resourceType: 'attribution',
        resourceId: dto.anonymousId,
        metadata: { reason: 'ALREADY_LINKED_TO_DIFFERENT_CUSTOMER' },
      });
      throw new BadRequestException('This click is already associated with a different customer');
    }

    const toUpdate = attributions.filter((a) => a.customerExternalId !== dto.customerExternalId);
    toUpdate.forEach((attr) => {
      attr.customerExternalId = dto.customerExternalId;
    });

    if (toUpdate.length) {
      this.audit({
        organizationId: pubKey.organizationId,
        actorType: 'system',
        actorId: 'system',
        action: AuditAction.CUSTOMER_IDENTITY_LINKED,
        resourceType: 'attribution',
        resourceId: dto.anonymousId,
        metadata: {
          updatedAttributions: toUpdate.map((a) => a.id),
          affiliateIds: [...new Set(toUpdate.map((a) => a.affiliateId))],
        },
      });
    }

    return { success: true, updatedAttributions: attributions.length };
  }
}
