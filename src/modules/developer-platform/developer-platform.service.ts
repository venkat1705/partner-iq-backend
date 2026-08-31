import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, PublicKeyEntity } from '../../database/store';
import { SecurityUtils } from '../../common/utils/security.utils';
import { AuditAction, EnvironmentType, TrackingLinkStatus } from '../../common/enums';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import {
  AttachOrderDto,
  BrowserReferralDto,
  CreatePublicBrowserKeyDto,
  PublicIdentifyCustomerDto,
} from './dto/developer-platform.dto';

@Injectable()
export class DeveloperPlatformService {
  listPrograms(organizationId: string, environment: 'test' | 'live' | EnvironmentType) {
    const currentEnvironment = EnvironmentUtils.normalizeEnvironment(environment);
    return this.withCursor(
      dbStore.programs
        .filter((p) =>
          p.organizationId === organizationId &&
          (p.environment === currentEnvironment || (!p.environment && currentEnvironment === EnvironmentType.LIVE)) &&
          !p.deletedAt,
        )
        .map((program) => ({ ...program, environment: currentEnvironment === EnvironmentType.TEST ? 'test' : 'live' })),
    );
  }

  getAffiliate(organizationId: string, affiliateId: string) {
    const affiliate = dbStore.affiliates.find((a) => a.organizationId === organizationId && a.id === affiliateId);
    if (!affiliate) throw new NotFoundException('Affiliate not found');
    return affiliate;
  }

  identifyCustomer(organizationId: string, dto: PublicIdentifyCustomerDto) {
    const attributions = dbStore.attributions.filter(
      (a) =>
        a.organizationId === organizationId &&
        (a.id === dto.attributionId || a.anonymousId === dto.anonymousId),
    );
    if (!attributions.length) {
      return { customerExternalId: dto.customerId, updatedAttributions: 0 };
    }
    attributions.forEach((attribution) => {
      attribution.customerExternalId = dto.customerId;
    });
    return { customerExternalId: dto.customerId, updatedAttributions: attributions.length };
  }

  attachOrder(organizationId: string, dto: AttachOrderDto) {
    const attribution = dbStore.attributions.find((a) => a.organizationId === organizationId && a.id === dto.attributionId);
    if (!attribution) throw new NotFoundException('Attribution not found');
    const existing = dbStore.integrationEvents.find(
      (event) => event.organizationId === organizationId && event.externalEventId === dto.externalOrderId,
    );
    if (existing) return { attached: true, duplicate: true, attributionId: attribution.id };

    dbStore.integrationEvents.push({
      id: uuidv4(),
      organizationId,
      integrationId: dto.provider,
      organizationIntegrationId: dto.provider,
      externalEventId: dto.externalOrderId,
      eventType: 'payment_order.attached',
      normalizedType: 'ATTRIBUTION_ORDER_ATTACHED',
      payloadHash: SecurityUtils.hashToken(JSON.stringify(dto)),
      status: 'PROCESSED' as any,
      processingMs: 0,
      metadata: {
        attributionId: dto.attributionId,
        provider: dto.provider,
        amount: dto.amount,
        currency: dto.currency,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    return { attached: true, attributionId: attribution.id, provider: dto.provider, externalOrderId: dto.externalOrderId };
  }

  createPublicBrowserKey(organizationId: string, actorId: string, dto: CreatePublicBrowserKeyDto) {
    const { key } = SecurityUtils.generateApiKey(dto.environment, 'pk');
    const publicKey: PublicKeyEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      key,
      publicKey: key,
      allowedDomains: dto.allowedDomains.map((domain) => this.normalizeDomain(domain)),
      environment: dto.environment,
      status: 'ACTIVE',
      createdAt: new Date(),
    } as any;
    dbStore.publicKeys.push(publicKey);
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: AuditAction.API_KEY_CREATED,
      resourceType: 'public_browser_key',
      resourceId: publicKey.id,
      metadata: { environment: dto.environment, allowedDomains: publicKey.allowedDomains },
      createdAt: new Date(),
    });
    return publicKey;
  }

  listPublicBrowserKeys(organizationId: string) {
    return dbStore.publicKeys.filter((key) => key.organizationId === organizationId);
  }

  trackBrowserReferral(dto: BrowserReferralDto, origin?: string, referer?: string) {
    const publicKey = dbStore.publicKeys.find((key) => (key.publicKey || key.key) === dto.publicKey);
    if (!publicKey || (publicKey as any).status === 'REVOKED') throw new BadRequestException('Invalid public browser key');
    this.assertAllowedOrigin(publicKey, origin, referer);

    const programAff = dbStore.programAffiliates.find(
      (pa) => pa.organizationId === publicKey.organizationId && pa.referralCode === dto.ref,
    );
    const link = dbStore.trackingLinks.find(
      (trackingLink) =>
        trackingLink.organizationId === publicKey.organizationId &&
        trackingLink.shortCode === dto.ref.toLowerCase() &&
        trackingLink.status === TrackingLinkStatus.ACTIVE,
    );
    const programId = publicKey.programId || programAff?.programId || link?.programId;
    const affiliateId = programAff?.affiliateId || link?.affiliateId;
    if (!programId || !affiliateId) throw new BadRequestException('Referral code is not valid for this organization');

    const anonymousId = dto.anonymousId || `anon_${uuidv4()}`;
    const clickId = uuidv4();
    dbStore.clicks.push({
      id: clickId,
      organizationId: publicKey.organizationId,
      programId,
      affiliateId,
      trackingLinkId: link?.id || clickId,
      anonymousId,
      ipHash: 'browser',
      userAgent: 'browser-sdk',
      referrer: referer || dto.landingPageUrl,
      fraudScore: 0,
      fraudStatus: 'LOW' as any,
      createdAt: new Date(),
    } as any);

    const attribution = {
      id: uuidv4(),
      organizationId: publicKey.organizationId,
      programId,
      affiliateId,
      clickId,
      anonymousId,
      model: 'LAST_CLICK' as any,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      createdAt: new Date(),
    };
    dbStore.attributions.push(attribution);
    return { anonymousId, attributionId: attribution.id, expiresAt: attribution.expiresAt };
  }

  private withCursor<T>(items: T[]) {
    return { data: items.slice(0, 100), meta: { limit: 100, nextCursor: null } };
  }

  private assertAllowedOrigin(publicKey: PublicKeyEntity, origin?: string, referer?: string) {
    const host = this.extractHost(origin || referer);
    if (!host) throw new ForbiddenException('Origin or Referer header is required for browser tracking');
    const allowed = (publicKey.allowedDomains || []).map((domain) => this.normalizeDomain(domain));
    if (!allowed.includes(host)) throw new ForbiddenException('Origin is not allowed for this public key');
  }

  private extractHost(value?: string) {
    if (!value) return '';
    try {
      return this.normalizeDomain(new URL(value).hostname);
    } catch {
      return this.normalizeDomain(value);
    }
  }

  private normalizeDomain(domain: string) {
    return domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  }
}
