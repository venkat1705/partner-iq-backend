import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { dbStore, TrackingLinkEntity, ClickEntity, AttributionEntity } from '../../database/store';
import { AuditAction, EnvironmentType, FraudStatus, TrackingLinkStatus } from '../../common/enums';
import { SecurityUtils } from '../../common/utils/security.utils';
import { FraudService } from '../fraud/fraud.service';
import { PerformanceAggregationService } from '../gamification/performance/performance-aggregation.service';
import { AutomationEngineService } from '../automations/engine/automation-engine.service';
import { AutomationTriggerType } from '../../common/enums';
import { CreateTrackingLinkDto, BrowserClickDto, IdentifyCustomerDto } from './dto/tracking.dto';

@Injectable()
export class TrackingService {
  constructor(
    private readonly fraudService: FraudService,
    private readonly performanceAggregationService?: PerformanceAggregationService,
    private readonly automationEngineService?: AutomationEngineService,
  ) { }

  async createLink(organizationId: string, dto: CreateTrackingLinkDto, actorId?: string, environment: EnvironmentType = EnvironmentType.LIVE) {
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

    dbStore.auditLogs.push({
      id: uuidv4(),
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
      createdAt: new Date(),
    });
    return link;
  }

  async getLinks(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE, programId?: string) {
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
        const clicks = dbStore.clicks.filter((click) => click.trackingLinkId === link.id && (click.environment === environment || (!click.environment && environment === EnvironmentType.LIVE)));
        const conversions = dbStore.conversions.filter(
          (conversion) =>
            conversion.organizationId === organizationId &&
            (conversion.environment === environment || (!conversion.environment && environment === EnvironmentType.LIVE)) &&
            conversion.programId === link.programId &&
            conversion.affiliateId === link.affiliateId,
        );

        return {
          ...publicLink,
          clicks: clicks.length,
          conversions: conversions.length,
          revenue: conversions.reduce((total, conversion) => total + Number(conversion.amount || 0), 0) / 100,
        };
      });
  }

  // High Performance Redirect Handler
  async handleRedirect(
    shortCode: string,
    userAgent?: string,
    ipAddress?: string,
    referrer?: string,
    country?: string,
  ) {
    const link = dbStore.trackingLinks.find(
      (l) => l.shortCode === shortCode.toLowerCase() && l.status === 'ACTIVE',
    );

    if (!link) {
      throw new NotFoundException('Tracking link not found or inactive');
    }

    const program = dbStore.programs.find((p) => p.id === link.programId);
    const anonymousId = `anon_${uuidv4()}`;
    const ipHash = ipAddress ? crypto.createHmac('sha256', process.env.FRAUD_IP_HASH_SECRET || process.env.JWT_SECRET || 'partneriq-fraud-ip-salt').update(ipAddress).digest('hex') : 'unknown';

    // Record Click
    const click: ClickEntity = {
      id: uuidv4(),
      organizationId: link.organizationId,
      environment: link.environment || EnvironmentType.LIVE,
      programId: link.programId,
      affiliateId: link.affiliateId,
      trackingLinkId: link.id,
      anonymousId,
      ipHash,
      ipEncrypted: ipAddress && ipAddress !== 'unknown' ? SecurityUtils.encrypt(ipAddress) : undefined,
      userAgent: userAgent || 'unknown',
      referrer: referrer || 'direct',
      country: country || 'unknown',
      deviceType: this.getDeviceType(userAgent),
      browser: this.getBrowser(userAgent),
      os: this.getOperatingSystem(userAgent),
      fraudScore: 0,
      fraudStatus: FraudStatus.LOW,
      createdAt: new Date(),
    };
    dbStore.clicks.push(click);

    // Record click in performance summary
    this.performanceAggregationService?.recordClick(link.organizationId, link.programId, link.affiliateId);

    this.fraudService.evaluateClick(click.id, ipAddress).catch((error) => {
      console.error('click fraud assessment failed:', error?.message || error);
    });

    // Record Attribution Record
    const cookieDays = program?.cookieDurationDays || program?.attributionWindowDays || 30;
    const expiresAt = new Date(Date.now() + cookieDays * 24 * 3600 * 1000);

    const attribution: AttributionEntity = {
      id: uuidv4(),
      organizationId: link.organizationId,
      environment: link.environment || EnvironmentType.LIVE,
      programId: link.programId,
      affiliateId: link.affiliateId,
      clickId: click.id,
      anonymousId,
      model: program?.attributionModel || ('LAST_CLICK' as any),
      breakdown: [{
        affiliateId: link.affiliateId,
        clickId: click.id,
        model: program?.attributionModel || 'LAST_CLICK',
        weight: 1,
        createdAt: new Date().toISOString(),
      }],
      expiresAt,
      createdAt: new Date(),
    };
    dbStore.attributions.push(attribution);

    return {
      destinationUrl: link.destinationUrl,
      anonymousId,
      clickId: click.id,
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

  // Browser Tracking API
  async handleBrowserClick(dto: BrowserClickDto, userAgent?: string, ipAddress?: string) {
    const pubKey = dbStore.publicKeys.find((k) => k.key === dto.publicKey);
    if (!pubKey) {
      throw new BadRequestException('Invalid public tracking key');
    }

    return this.handleRedirect(dto.shortCode, userAgent, ipAddress);
  }

  // Identify Customer API
  async identifyCustomer(dto: IdentifyCustomerDto) {
    const pubKey = dbStore.publicKeys.find((k) => k.key === dto.publicKey);
    if (!pubKey) {
      throw new BadRequestException('Invalid public tracking key');
    }

    const attributions = dbStore.attributions.filter(
      (a) => a.organizationId === pubKey.organizationId && a.anonymousId === dto.anonymousId,
    );

    attributions.forEach((attr) => {
      attr.customerExternalId = dto.customerExternalId;
    });

    return { success: true, updatedAttributions: attributions.length };
  }
}
