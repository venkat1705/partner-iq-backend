import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { dbStore, TrackingLinkEntity, ClickEntity, AttributionEntity, awaitPersist } from '../../database/store';
import {
  AuditAction,
  EnvironmentType,
  FraudStatus,
  TrackingLinkStatus,
  ProgramStatus,
  AffiliateStatus,
  ConversionStatus,
} from '../../common/enums';
import { SecurityUtils } from '../../common/utils/security.utils';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import { FraudService } from '../fraud/fraud.service';
import { PerformanceAggregationService } from '../gamification/performance/performance-aggregation.service';
import { AutomationEngineService } from '../automations/engine/automation-engine.service';
import { AutomationTriggerType } from '../../common/enums';
import {
  CreateTrackingLinkDto,
  UpdateTrackingLinkDto,
  ListTrackingLinksQueryDto,
  TrackingLinkAnalyticsQueryDto,
  BulkUpdateTrackingLinksDto,
  BrowserClickDto,
  IdentifyCustomerDto,
} from './dto/tracking.dto';
import { AuditService } from '../audit/audit.service';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { netCommissionAmount } from '../../common/utils/commission.utils';

/** Upper bound on a single page of tracking links. */
const MAX_PAGE_SIZE = 100;

interface UtmContext {
  landingUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  affiliateId?: string;
  /** Host the redirect was served on â€” carries the org slug that scopes the short code. */
  host?: string;
  /**
   * Authoritative tenant for the lookup. The browser SDK knows the org from its
   * public key, which beats inferring it from the host.
   */
  organizationId?: string;
  /** `pi_anon_id` from the inbound request, so a returning visitor keeps one identity. */
  existingAnonymousId?: string;
  /** Extra inbound query params (sub_id and friends) to carry to the destination. */
  passthroughParams?: Record<string, string>;
  /** Deep-link target from `?url=`, resolved against the link's own destination. */
  deepLinkTarget?: string;
}

export interface HydratedTrackingLink extends TrackingLinkEntity {
  affiliateName: string;
  affiliateEmail: string;
  programName: string;
  programSlug?: string;
  clicks: number;
  uniqueVisitors: number;
  conversions: number;
  conversionRate: number;
  revenue: number; // in cents
  commission: number; // in cents
  shortUrl: string;
  fullTrackingUrl: string;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

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

  /**
   * Validates destination URL security, preventing open redirects, SSRF, and dangerous protocols.
   */
  validateDestinationUrl(urlStr: string): { valid: boolean; reason?: string } {
    if (!urlStr || typeof urlStr !== 'string') {
      return { valid: false, reason: 'Destination URL is required' };
    }

    const trimmed = urlStr.trim();
    if (
      trimmed.toLowerCase().startsWith('javascript:') ||
      trimmed.toLowerCase().startsWith('data:') ||
      trimmed.toLowerCase().startsWith('vbscript:') ||
      trimmed.toLowerCase().startsWith('file:')
    ) {
      return { valid: false, reason: 'Unsafe URL protocol detected' };
    }

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, reason: 'Destination protocol must be http or https' };
      }

      // Disallow localhost / loopback in production
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '::1'
      ) {
        return { valid: false, reason: 'Loopback and localhost destinations are prohibited' };
      }

      return { valid: true };
    } catch {
      return { valid: false, reason: 'Malformed URL format' };
    }
  }

  /**
   * Deterministic baseline seeding for tracking links, clicks, and attributions.
   */
  /**
   * Public redirect URL for a short code. Mirrors the org-slug host used by the
   * affiliate portal so a link copied from either surface resolves identically.
   */
  private buildShortUrl(organizationId: string, shortCode: string): string {
    const org = dbStore.organizations.find((o) => o.id === organizationId);
    return `https://${org?.slug || 'go'}.partneriq.in/r/${shortCode}`;
  }


  /**
   * 360-Degree Tracking Link Analytics Aggregations
   */
  async getTrackingAnalytics(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query: TrackingLinkAnalyticsQueryDto = {},
  ) {

    const links = dbStore.trackingLinks.filter(
      (l) =>
        l.organizationId === organizationId &&
        (l.environment === environment || (!l.environment && environment === EnvironmentType.LIVE)) &&
        (!query.programId || l.programId === query.programId) &&
        (!query.affiliateId || l.affiliateId === query.affiliateId) &&
        (!query.linkId || l.id === query.linkId),
    );

    const linkIds = new Set(links.map((l) => l.id));

    const clicks = dbStore.clicks.filter(
      (c) =>
        c.organizationId === organizationId &&
        (c.environment === environment || (!c.environment && environment === EnvironmentType.LIVE)) &&
        c.trackingLinkId &&
        linkIds.has(c.trackingLinkId),
    );

    const conversions = dbStore.conversions.filter(
      (conv) =>
        conv.organizationId === organizationId &&
        (conv.environment === environment || (!conv.environment && environment === EnvironmentType.LIVE)) &&
        conv.status === ConversionStatus.APPROVED,
    );

    const commissions = dbStore.commissions.filter(
      (comm) =>
        comm.organizationId === organizationId &&
        (comm.environment === environment || (!comm.environment && environment === EnvironmentType.LIVE)),
    );

    const totalLinks = links.length;
    const activeLinks = links.filter((l) => l.status === TrackingLinkStatus.ACTIVE).length;
    const pausedLinks = links.filter((l) => l.status === TrackingLinkStatus.PAUSED).length;
    const inactiveLinks = links.filter((l) => l.status === TrackingLinkStatus.INACTIVE).length;
    const totalClicks = clicks.length;

    // Unique visitors calculation (distinct anon IDs)
    const uniqueVisitors = new Set(clicks.map((c) => c.anonymousId)).size;

    // Attributed conversions: match clickId or affiliateId + programId
    const clickIdsSet = new Set(clicks.map((c) => c.id));
    const attributedConversions = conversions.filter((c) => c.clickId && clickIdsSet.has(c.clickId));
    const totalConversions = attributedConversions.length;

    const grossRevenue = attributedConversions.reduce((sum, c) => sum + (c.amount || 0), 0);
    const convIdsSet = new Set(attributedConversions.map((c) => c.id));
    const totalCommission = commissions
      .filter((comm) => comm.conversionId && convIdsSet.has(comm.conversionId))
      .reduce((sum, comm) => sum + netCommissionAmount(comm), 0);

    const conversionRate = totalClicks > 0
      ? Number(((totalConversions / totalClicks) * 100).toFixed(1))
      : 0;

    // 14-day trajectory
    const trajectoryMap: Record<string, { clicks: number; conversions: number; revenue: number; commission: number }> = {};
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      trajectoryMap[key] = { clicks: 0, conversions: 0, revenue: 0, commission: 0 };
    }

    for (const clk of clicks) {
      const d = new Date(clk.createdAt);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (trajectoryMap[key]) {
        trajectoryMap[key].clicks++;
      }
    }

    for (const conv of attributedConversions) {
      const d = new Date(conv.occurredAt || conv.createdAt);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (trajectoryMap[key]) {
        trajectoryMap[key].conversions++;
        trajectoryMap[key].revenue += conv.amount || 0;
        const comm = commissions.find((c) => c.conversionId === conv.id);
        if (comm) trajectoryMap[key].commission += netCommissionAmount(comm);
      }
    }

    const trajectory = Object.entries(trajectoryMap).map(([date, val]) => ({
      date,
      clicks: val.clicks,
      conversions: val.conversions,
      revenue: val.revenue,
      commission: val.commission,
    }));

    // Status distribution
    const statusMap: Record<string, number> = {
      ACTIVE: activeLinks,
      PAUSED: pausedLinks,
      INACTIVE: inactiveLinks,
      EXPIRED: links.filter((l) => l.status === TrackingLinkStatus.EXPIRED).length,
      ARCHIVED: links.filter((l) => l.status === TrackingLinkStatus.ARCHIVED).length,
    };
    const statusDistribution = Object.entries(statusMap)
      .filter(([_, count]) => count > 0)
      .map(([status, count]) => ({
        status,
        count,
        percentage: totalLinks > 0 ? Number(((count / totalLinks) * 100).toFixed(1)) : 0,
      }));

    // Program performance breakdown
    const programMap: Record<string, { name: string; links: number; clicks: number; conversions: number; revenue: number }> = {};
    for (const l of links) {
      if (!programMap[l.programId]) {
        const prog = dbStore.programs.find((p) => p.id === l.programId);
        programMap[l.programId] = {
          name: prog?.name || 'Standard Program',
          links: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0,
        };
      }
      programMap[l.programId].links++;
    }

    for (const clk of clicks) {
      if (programMap[clk.programId]) {
        programMap[clk.programId].clicks++;
      }
    }

    for (const conv of attributedConversions) {
      if (programMap[conv.programId]) {
        programMap[conv.programId].conversions++;
        programMap[conv.programId].revenue += conv.amount || 0;
      }
    }

    const programBreakdown = Object.entries(programMap).map(([programId, val]) => ({
      programId,
      programName: val.name,
      links: val.links,
      clicks: val.clicks,
      conversions: val.conversions,
      revenue: val.revenue,
      conversionRate: val.clicks > 0 ? Number(((val.conversions / val.clicks) * 100).toFixed(1)) : 0,
    }));

    // Affiliate performance breakdown
    const affiliateMap: Record<string, { name: string; links: number; clicks: number; conversions: number; revenue: number }> = {};
    for (const l of links) {
      if (!affiliateMap[l.affiliateId]) {
        const aff = dbStore.affiliates.find((a) => a.id === l.affiliateId);
        affiliateMap[l.affiliateId] = {
          name: aff?.displayName || aff?.email || 'Affiliate Partner',
          links: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0,
        };
      }
      affiliateMap[l.affiliateId].links++;
    }

    for (const clk of clicks) {
      if (affiliateMap[clk.affiliateId]) {
        affiliateMap[clk.affiliateId].clicks++;
      }
    }

    for (const conv of attributedConversions) {
      if (conv.affiliateId && affiliateMap[conv.affiliateId]) {
        affiliateMap[conv.affiliateId].conversions++;
        affiliateMap[conv.affiliateId].revenue += conv.amount || 0;
      }
    }

    const affiliateBreakdown = Object.entries(affiliateMap)
      .map(([affiliateId, val]) => ({
        affiliateId,
        affiliateName: val.name,
        links: val.links,
        clicks: val.clicks,
        conversions: val.conversions,
        revenue: val.revenue,
        conversionRate: val.clicks > 0 ? Number(((val.conversions / val.clicks) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Source breakdowns are keyed on the link's configured source, not the
    // effective one. An inbound `?utm_source=` legitimately overrides what gets
    // forwarded to the merchant, but letting it also drive the organization's
    // own reporting would let a partner relabel their traffic at will.
    const canonicalSource = (clk: ClickEntity) =>
      clk.canonicalUtmSource || clk.utmSource || 'direct';

    const utmSourceMap: Record<string, number> = {};
    for (const clk of clicks) {
      const src = canonicalSource(clk);
      utmSourceMap[src] = (utmSourceMap[src] || 0) + 1;
    }
    const utmSources = Object.entries(utmSourceMap).map(([source, count]) => ({
      source,
      count,
      percentage: totalClicks > 0 ? Number(((count / totalClicks) * 100).toFixed(1)) : 0,
    }));

    // Traffic source breakdown (clicks + attributed conversions per UTM source)
    const clickSourceById = new Map(clicks.map((c) => [c.id, canonicalSource(c)]));
    const sourceConversionMap: Record<string, number> = {};
    for (const conv of attributedConversions) {
      const src = clickSourceById.get(conv.clickId as string) || 'direct';
      sourceConversionMap[src] = (sourceConversionMap[src] || 0) + 1;
    }
    const sourceBreakdown = Object.entries(utmSourceMap)
      .map(([source, count]) => ({
        source,
        clicks: count,
        conversions: sourceConversionMap[source] || 0,
      }))
      .sort((a, b) => b.clicks - a.clicks);

    // Link health checks
    const healthyCount = links.filter((l) => (l as any).healthStatus === 'HEALTHY' || !(l as any).healthStatus).length;
    const degradedCount = links.filter((l) => (l as any).healthStatus === 'DEGRADED').length;
    const brokenCount = links.filter((l) => (l as any).healthStatus === 'BROKEN').length;
    const unusedLinks = links.filter((l) => !clicks.some((c) => c.trackingLinkId === l.id)).length;

    // Operational alerts
    const needsAttention: string[] = [];
    if (brokenCount > 0) {
      needsAttention.push(`${brokenCount} tracking links point to unreachable or prohibited destination URLs.`);
    }
    const inactiveWithTraffic = links.filter(
      (l) => l.status !== TrackingLinkStatus.ACTIVE && clicks.some((c) => c.trackingLinkId === l.id),
    ).length;
    if (inactiveWithTraffic > 0) {
      needsAttention.push(`${inactiveWithTraffic} inactive links are still receiving inbound traffic.`);
    }
    if (unusedLinks > 0) {
      needsAttention.push(`${unusedLinks} campaign links have zero recorded visits in this period.`);
    }

    const org = dbStore.organizations.find((o) => o.id === organizationId);
    const currency = org?.defaultCurrency || PLATFORM_CURRENCY;

    return {
      totalLinks,
      activeLinks,
      pausedLinks,
      inactiveLinks,
      unusedLinks,
      totalClicks,
      uniqueVisitors,
      totalConversions,
      conversionRate,
      grossRevenue,
      totalCommission,
      trajectory,
      statusDistribution,
      programBreakdown,
      affiliateBreakdown,
      utmSources,
      sourceBreakdown,
      // Flattened aliases of healthSummary â€” the portal's health cards and the
      // Link Health Center tab badge read these directly.
      healthyLinks: healthyCount,
      warningLinks: degradedCount,
      brokenLinks: brokenCount,
      healthSummary: {
        healthyCount,
        degradedCount,
        brokenCount,
        inactiveCount: inactiveLinks,
      },
      needsAttention,
      currency,
    };
  }

  /**
   * Paginated listing of tracking links with server-side search, filtering, and metrics.
   */
  async getLinksPaginated(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query: ListTrackingLinksQueryDto = {},
  ) {

    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(query.limit || 20)));

    let links = dbStore.trackingLinks.filter(
      (l) =>
        l.organizationId === organizationId &&
        (l.environment === environment || (!l.environment && environment === EnvironmentType.LIVE)),
    );

    // Filter by Program
    if (query.programId && query.programId !== 'ALL') {
      links = links.filter((l) => l.programId === query.programId);
    }

    // Filter by Affiliate
    if (query.affiliateId && query.affiliateId !== 'ALL') {
      links = links.filter((l) => l.affiliateId === query.affiliateId);
    }

    // Filter by Status
    if (query.status && query.status !== 'ALL') {
      links = links.filter((l) => l.status === query.status);
    }

    // Filter by Health Status
    if (query.healthStatus && query.healthStatus !== 'ALL') {
      links = links.filter((l) => (l as any).healthStatus === query.healthStatus);
    }

    // Filter by UTM tags
    if (query.utmSource && query.utmSource !== 'ALL') {
      links = links.filter((l) => (l as any).utmSource === query.utmSource);
    }

    // Substring search
    if (query.search) {
      const q = query.search.toLowerCase().trim();
      links = links.filter((l) => {
        const aff = dbStore.affiliates.find((a) => a.id === l.affiliateId);
        const prog = dbStore.programs.find((p) => p.id === l.programId);
        return (
          l.shortCode.toLowerCase().includes(q) ||
          (l.campaignId && l.campaignId.toLowerCase().includes(q)) ||
          l.destinationUrl.toLowerCase().includes(q) ||
          (aff?.displayName && aff.displayName.toLowerCase().includes(q)) ||
          (prog?.name && prog.name.toLowerCase().includes(q))
        );
      });
    }

    // Hydrate links with clicks and conversion totals
    const clicks = dbStore.clicks.filter((c) => c.organizationId === organizationId);
    const conversions = dbStore.conversions.filter((c) => c.organizationId === organizationId && c.status === ConversionStatus.APPROVED);
    const commissions = dbStore.commissions.filter((c) => c.organizationId === organizationId);

    const hydrated: HydratedTrackingLink[] = links.map((link) => {
      const aff = dbStore.affiliates.find((a) => a.id === link.affiliateId);
      const prog = dbStore.programs.find((p) => p.id === link.programId);

      const linkClicks = clicks.filter((c) => c.trackingLinkId === link.id);
      const clickIds = new Set(linkClicks.map((c) => c.id));
      const uniqueVisitors = new Set(linkClicks.map((c) => c.anonymousId)).size;

      const linkConversions = conversions.filter((c) => c.clickId && clickIds.has(c.clickId));
      const revenue = linkConversions.reduce((sum, c) => sum + (c.amount || 0), 0);

      const convIds = new Set(linkConversions.map((c) => c.id));
      const commission = commissions
        .filter((comm) => comm.conversionId && convIds.has(comm.conversionId))
        .reduce((sum, comm) => sum + netCommissionAmount(comm), 0);

      const conversionRate = linkClicks.length > 0
        ? Number(((linkConversions.length / linkClicks.length) * 100).toFixed(1))
        : 0;

      const shortUrl = this.buildShortUrl(organizationId, link.shortCode);

      return {
        ...link,
        affiliateName: aff?.displayName || aff?.companyName || 'Affiliate Partner',
        affiliateEmail: aff?.email || '',
        programName: prog?.name || 'Standard Program',
        programSlug: prog?.slug,
        clicks: linkClicks.length,
        uniqueVisitors,
        conversions: linkConversions.length,
        conversionRate,
        revenue,
        commission,
        shortUrl,
        fullTrackingUrl: shortUrl,
      };
    });

    // Sorting
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    hydrated.sort((a: any, b: any) => {
      const valA = a[sortBy] ?? '';
      const valB = b[sortBy] ?? '';
      if (typeof valA === 'number' && typeof valB === 'number') {
        return (valA - valB) * sortOrder;
      }
      return String(valA).localeCompare(String(valB)) * sortOrder;
    });

    const total = hydrated.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginatedData = hydrated.slice(startIndex, startIndex + limit);

    return {
      data: paginatedData,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * 360-Degree Link Detail Dossier
   */
  async getLinkDetail(
    organizationId: string,
    linkId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {

    const link = dbStore.trackingLinks.find(
      (l) =>
        (l.id === linkId || l.shortCode === linkId.toLowerCase()) &&
        l.organizationId === organizationId,
    );

    if (!link) {
      throw new NotFoundException('Tracking link not found');
    }

    const aff = dbStore.affiliates.find((a) => a.id === link.affiliateId);
    const prog = dbStore.programs.find((p) => p.id === link.programId);

    const clicks = dbStore.clicks.filter((c) => c.trackingLinkId === link.id);
    const clickIds = new Set(clicks.map((c) => c.id));
    const uniqueVisitors = new Set(clicks.map((c) => c.anonymousId)).size;

    const conversions = dbStore.conversions.filter(
      (c) => c.clickId && clickIds.has(c.clickId) && c.status === ConversionStatus.APPROVED,
    );
    const convIds = new Set(conversions.map((c) => c.id));

    const commissions = dbStore.commissions.filter(
      (comm) => comm.conversionId && convIds.has(comm.conversionId),
    );

    const revenue = conversions.reduce((sum, c) => sum + (c.amount || 0), 0);
    const commission = commissions.reduce((sum, comm) => sum + netCommissionAmount(comm), 0);
    const conversionRate = clicks.length > 0 ? Number(((conversions.length / clicks.length) * 100).toFixed(1)) : 0;

    // Recent clicks (up to 10)
    const recentClicks = clicks
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        country: c.country,
        deviceType: c.deviceType,
        browser: c.browser,
        referrer: c.referrer,
        utmSource: c.utmSource,
        createdAt: c.createdAt,
      }));

    // Recent conversions (up to 10)
    const recentConversions = conversions
      .sort((a, b) => new Date(b.occurredAt || b.createdAt).getTime() - new Date(a.occurredAt || a.createdAt).getTime())
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        externalId: c.externalId,
        amount: c.amount,
        currency: c.currency,
        status: c.status,
        createdAt: c.occurredAt || c.createdAt,
      }));

    // Audit trail
    const auditLogs = dbStore.auditLogs.filter(
      (a) => a.organizationId === organizationId && a.resourceId === link.id,
    );

    // Destination validation result
    const destinationValidation = this.validateDestinationUrl(link.destinationUrl);

    return {
      link: {
        ...link,
        shortUrl: this.buildShortUrl(organizationId, link.shortCode),
        fullTrackingUrl: this.buildShortUrl(organizationId, link.shortCode),
      },
      partner: {
        id: aff?.id,
        name: aff?.displayName || 'Affiliate Partner',
        email: aff?.email || '',
        company: aff?.companyName,
        status: aff?.status,
        trustScore: aff?.trustScore ?? 90,
      },
      program: {
        id: prog?.id,
        name: prog?.name || 'Standard Program',
        cookieDays: prog?.cookieDurationDays || 30,
        attributionModel: prog?.attributionModel || 'LAST_CLICK',
      },
      performance: {
        clicks: clicks.length,
        uniqueVisitors,
        conversions: conversions.length,
        conversionRate,
        revenue,
        commission,
      },
      campaign: {
        utmSource: (link as any).utmSource,
        utmMedium: (link as any).utmMedium,
        utmCampaign: (link as any).utmCampaign,
        utmTerm: (link as any).utmTerm,
        utmContent: (link as any).utmContent,
        customParameters: (link as any).customParameters || {},
      },
      health: {
        status: (link as any).healthStatus || (destinationValidation.valid ? 'HEALTHY' : 'BROKEN'),
        destinationValid: destinationValidation.valid,
        validationReason: destinationValidation.reason,
        expiresAt: (link as any).expiresAt,
        lastActivityAt: (link as any).lastActivityAt || (clicks[0]?.createdAt),
      },
      recentClicks,
      recentConversions,
      auditLogs,
    };
  }

  /**
   * Create Tracking Link with security & collision-safe codes
   */
  async createLink(
    organizationId: string,
    dto: CreateTrackingLinkDto,
    actorId?: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    // Resolve program â€” use the provided programId or fall back to the first active program in the org
    const program = dto.programId
      ? dbStore.programs.find((p) => p.id === dto.programId && !p.deletedAt)
      : dbStore.programs.find((p) => p.organizationId === organizationId && p.status === ProgramStatus.ACTIVE && !p.deletedAt);
    if (!program) {
      throw new BadRequestException('Program not found. Please select a valid program or create one first.');
    }
    EnvironmentUtils.assertEnvironmentIntegrity(
      { organizationId, environment },
      { organizationId: program.organizationId, environment: program.environment },
      'Program',
    );
    if (program.status !== ProgramStatus.ACTIVE) {
      throw new BadRequestException('Cannot create tracking links for an inactive program');
    }

    // Resolve affiliate â€” use the provided affiliateId or fall back to the first active affiliate in the org
    const affiliate = dto.affiliateId
      ? dbStore.affiliates.find((a) => a.id === dto.affiliateId && a.organizationId === organizationId)
      : dbStore.affiliates.find((a) => a.organizationId === organizationId && a.status === AffiliateStatus.ACTIVE);
    if (!affiliate) {
      throw new BadRequestException('Affiliate partner not found. Please select a valid partner or invite one first.');
    }
    if (affiliate.status !== AffiliateStatus.ACTIVE) {
      throw new BadRequestException('Cannot create tracking links for an inactive affiliate');
    }

    // Validate destination URL security
    const destValidation = this.validateDestinationUrl(dto.destinationUrl);
    if (!destValidation.valid) {
      throw new BadRequestException(`Destination URL validation failed: ${destValidation.reason}`);
    }

    const shortCode = (
      dto.customCode || SecurityUtils.generateRandomCode(6)
    ).toLowerCase().trim();

    // Check collision within same tenant & environment
    const existing = dbStore.trackingLinks.find(
      (l) =>
        l.shortCode === shortCode &&
        l.organizationId === organizationId &&
        (l.environment === environment || (!l.environment && environment === EnvironmentType.LIVE)),
    );
    if (existing) {
      throw new BadRequestException(`Short code '${shortCode}' is already taken. Please choose another.`);
    }

    const link: TrackingLinkEntity = {
      id: uuidv4(),
      organizationId,
      environment,
      programId: program.id,
      affiliateId: affiliate.id,
      campaignId: dto.campaignId,
      destinationUrl: dto.destinationUrl.trim(),
      shortCode,
      status: TrackingLinkStatus.ACTIVE,
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      utmTerm: dto.utmTerm,
      utmContent: dto.utmContent,
      customParameters: dto.customParameters,
      healthStatus: 'HEALTHY',
      notes: dto.notes,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdAt: new Date(),
    } as any;

    dbStore.trackingLinks.push(link);
    await awaitPersist(link);

    // Performance Aggregation & Automations
    await this.performanceAggregationService?.recordTrackingLinkCreated(
      organizationId,
      program.id,
      affiliate.id,
    );

    await this.automationEngineService?.handleEvent(
      AutomationTriggerType.TRACKING_LINK_CREATED,
      organizationId,
      program.id,
      affiliate.id,
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

    return {
      ...link,
      shortUrl: this.buildShortUrl(organizationId, link.shortCode),
      fullTrackingUrl: this.buildShortUrl(organizationId, link.shortCode),
    };
  }

  /**
   * Update Tracking Link
   */
  async updateLink(
    organizationId: string,
    linkId: string,
    actorId: string,
    dto: UpdateTrackingLinkDto,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    const link = dbStore.trackingLinks.find(
      (l) => (l.id === linkId || l.shortCode === linkId.toLowerCase()) && l.organizationId === organizationId,
    );

    if (!link) {
      throw new NotFoundException('Tracking link not found');
    }

    if (dto.destinationUrl) {
      const val = this.validateDestinationUrl(dto.destinationUrl);
      if (!val.valid) {
        throw new BadRequestException(`Destination URL validation failed: ${val.reason}`);
      }
      link.destinationUrl = dto.destinationUrl.trim();
    }

    if (dto.status) {
      link.status = dto.status;
    }

    if (dto.utmSource !== undefined) (link as any).utmSource = dto.utmSource;
    if (dto.utmMedium !== undefined) (link as any).utmMedium = dto.utmMedium;
    if (dto.utmCampaign !== undefined) (link as any).utmCampaign = dto.utmCampaign;
    if (dto.utmTerm !== undefined) (link as any).utmTerm = dto.utmTerm;
    if (dto.utmContent !== undefined) (link as any).utmContent = dto.utmContent;
    if (dto.notes !== undefined) (link as any).notes = dto.notes;
    if (dto.expiresAt !== undefined) (link as any).expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    (link as any).updatedAt = new Date();

    this.audit({
      organizationId,
      actorType: 'user',
      actorId,
      action: 'TRACKING_LINK_UPDATED' as AuditAction,
      resourceType: 'tracking_link',
      resourceId: link.id,
      metadata: { changes: dto },
    });

    await awaitPersist(link);
    return link;
  }

  /**
   * Bulk link actions: activate, deactivate, archive
   */
  async bulkUpdateLinks(
    organizationId: string,
    actorId: string,
    dto: BulkUpdateTrackingLinksDto,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    const links = dbStore.trackingLinks.filter(
      (l) => l.organizationId === organizationId && dto.linkIds.includes(l.id),
    );

    let updatedCount = 0;
    const pendingPersist: Promise<unknown>[] = [];
    for (const link of links) {
      if (dto.action === 'ACTIVATE') {
        link.status = TrackingLinkStatus.ACTIVE;
        (link as any).healthStatus = 'HEALTHY';
        updatedCount++;
      } else if (dto.action === 'DEACTIVATE') {
        link.status = TrackingLinkStatus.INACTIVE;
        (link as any).healthStatus = 'INACTIVE';
        updatedCount++;
      } else if (dto.action === 'ARCHIVE') {
        link.status = TrackingLinkStatus.ARCHIVED;
        updatedCount++;
      }
      (link as any).updatedAt = new Date();
      pendingPersist.push(awaitPersist(link));
    }

    this.audit({
      organizationId,
      actorType: 'user',
      actorId,
      action: 'TRACKING_LINK_BULK_UPDATE' as AuditAction,
      resourceType: 'tracking_link',
      resourceId: 'multiple',
      metadata: { action: dto.action, updatedCount, linkIds: dto.linkIds },
    });

    await Promise.all(pendingPersist);
    return { success: true, updatedCount, action: dto.action };
  }

  /**
   * Sanitized CSV Export with formula injection prevention
   */
  async generateCsvExport(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query: ListTrackingLinksQueryDto = {},
  ): Promise<string> {
    const res = await this.getLinksPaginated(organizationId, environment, {
      ...query,
      page: 1,
      limit: 10000,
    });

    const headers = [
      'short_code',
      'full_tracking_url',
      'program',
      'affiliate',
      'destination_url',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'clicks',
      'unique_visitors',
      'conversions',
      'conversion_rate_pct',
      'revenue',
      'commission',
      'status',
      'created_at',
    ];

    const sanitizeCell = (val: unknown): string => {
      if (val === null || val === undefined) return '';
      let str = String(val);
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = res.data.map((l) => [
      sanitizeCell(l.shortCode),
      sanitizeCell(l.fullTrackingUrl),
      sanitizeCell(l.programName),
      sanitizeCell(l.affiliateName),
      sanitizeCell(l.destinationUrl),
      sanitizeCell((l as any).utmSource || ''),
      sanitizeCell((l as any).utmMedium || ''),
      sanitizeCell((l as any).utmCampaign || ''),
      sanitizeCell(l.clicks),
      sanitizeCell(l.uniqueVisitors),
      sanitizeCell(l.conversions),
      sanitizeCell(l.conversionRate),
      sanitizeCell((l.revenue / 100).toFixed(2)),
      sanitizeCell((l.commission / 100).toFixed(2)),
      sanitizeCell(l.status),
      sanitizeCell(new Date(l.createdAt).toISOString()),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  /**
   * Legacy Get Links compatibility
   */
  async getLinks(organizationId: string, environment: EnvironmentType = EnvironmentType.LIVE, programId?: string) {
    // getLinksPaginated caps `limit` at 100 to bound public page sizes, so asking
    // for 1000 in one call silently returned only the first 100 links. This is an
    // unpaginated endpoint by contract, so it walks the pages instead of
    // pretending a single oversized request works.
    const first = await this.getLinksPaginated(organizationId, environment, {
      programId,
      page: 1,
      limit: MAX_PAGE_SIZE,
    });

    const all = [...first.data];
    for (let page = 2; page <= first.meta.totalPages; page++) {
      const next = await this.getLinksPaginated(organizationId, environment, {
        programId,
        page,
        limit: MAX_PAGE_SIZE,
      });
      all.push(...next.data);
    }

    return all;
  }

  /**
   * High-Performance Redirect Handler (GET /r/:shortCode)
   */
  async handleRedirect(
    shortCode: string,
    userAgent?: string,
    ipAddress?: string,
    referrer?: string,
    country?: string,
    utm?: UtmContext,
  ) {
    // Short codes are unique per (organizationId, environment), not globally, so a
    // bare `find` by code can serve one tenant's link to another tenant's traffic.
    // The redirect host carries the org slug ({slug}.partneriq.in), which is the
    // only tenant signal a public redirect has â€” when it resolves, it is binding.
    const matches = dbStore.trackingLinks.filter(
      (l) => l.shortCode === shortCode.toLowerCase() && l.status === TrackingLinkStatus.ACTIVE,
    );

    const { organizationId: hostOrganizationId, unknownTenant } =
      this.resolveOrganizationIdFromHost(utm?.host);

    if (unknownTenant) {
      throw new NotFoundException('Tracking link not found or inactive');
    }

    // An explicit tenant (the SDK's public key) always wins over the host slug.
    const scopeOrganizationId = utm?.organizationId || hostOrganizationId;
    const scoped = scopeOrganizationId
      ? matches.filter((l) => l.organizationId === scopeOrganizationId)
      : matches;

    // A public redirect has no environment header, so LIVE always wins; a TEST
    // link is only served when no LIVE link claims the code.
    const liveOnly = scoped.filter(
      (l) => !l.environment || l.environment === EnvironmentType.LIVE,
    );
    const pool = liveOnly.length ? liveOnly : scoped;

    if (pool.length > 1) {
      this.logger.warn(
        `Short code '${shortCode}' is claimed by ${pool.length} links across tenants and the host ` +
        `('${utm?.host || 'unknown'}') did not identify one. Serving the earliest-created link.`,
      );
    }

    const link = [...pool].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )[0];

    if (!link) {
      throw new NotFoundException('Tracking link not found or inactive');
    }

    const program = dbStore.programs.find((p) => p.id === link.programId && !p.deletedAt);

    let affiliate = utm?.affiliateId
      ? dbStore.affiliates.find(
        (a) =>
          (a.id === utm.affiliateId || (a as any).referralCode === utm.affiliateId || a.email === utm.affiliateId) &&
          a.organizationId === link.organizationId,
      )
      : undefined;

    if (!affiliate && link.affiliateId) {
      affiliate = dbStore.affiliates.find((a) => a.id === link.affiliateId);
    }

    // No arbitrary fallback here on purpose: picking "any active affiliate in the
    // org" would attribute real revenue â€” and real commission â€” to a partner who
    // had nothing to do with the click, and the old code also wrote that guess
    // back onto the link permanently. An unresolvable affiliate is a tracking
    // failure, not something to guess at.
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
          reason: !program || program.status !== ProgramStatus.ACTIVE
            ? 'PROGRAM_INACTIVE'
            : !affiliate
              ? 'AFFILIATE_UNRESOLVED'
              : 'AFFILIATE_INACTIVE',
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

    // Reuse the visitor's existing identity when they already carry one for this
    // org. Minting a fresh id on every click orphaned the earlier attribution
    // rows â€” nothing could ever match them again â€” which quietly collapsed
    // FIRST_CLICK and the weighted multi-touch models down to last-click.
    const anonymousId =
      this.resolveExistingAnonymousId(utm?.existingAnonymousId, link.organizationId) ||
      `anon_${uuidv4()}`;
    const ipHash = ipAddress ? crypto.createHmac('sha256', process.env.FRAUD_IP_HASH_SECRET || process.env.JWT_SECRET || 'partneriq-fraud-ip-salt').update(ipAddress).digest('hex') : 'unknown';

    // Record Click
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
      utmSource: utm?.utmSource || (link as any).utmSource,
      utmMedium: utm?.utmMedium || (link as any).utmMedium,
      utmCampaign: utm?.utmCampaign || (link as any).utmCampaign,
      utmTerm: utm?.utmTerm || (link as any).utmTerm,
      utmContent: utm?.utmContent || (link as any).utmContent,
      // Effective UTMs above honour an inbound override so the partner can tag
      // placements; this records how the link itself was configured, which is
      // what source reporting is based on.
      canonicalUtmSource: (link as any).utmSource || 'direct',
      country: country || 'unknown',
      deviceType: this.getDeviceType(userAgent),
      browser: this.getBrowser(userAgent),
      os: this.getOperatingSystem(userAgent),
      fraudScore: 0,
      fraudStatus: FraudStatus.LOW,
      createdAt: new Date(),
    };
    dbStore.clicks.push(click);
    (link as any).lastActivityAt = new Date();
    const pendingPersist: Promise<unknown>[] = [awaitPersist(click), awaitPersist(link)];

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

    this.performanceAggregationService?.recordClick(link.organizationId, link.programId, affiliate.id);

    this.fraudService.evaluateClick(click.id, ipAddress).catch((error) => {
      this.logger.error(`click fraud assessment failed: ${error?.message || error}`);
    });

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
    pendingPersist.push(awaitPersist(attribution));

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

    const destinationUrl = this.buildResolvedDestination(
      link,
      click,
      anonymousId,
      utm?.passthroughParams,
      utm?.deepLinkTarget,
    );

    await Promise.all(pendingPersist);
    return {
      destinationUrl,
      anonymousId,
      clickId: click.id,
      cookieMaxAgeMs: cookieDays * 24 * 3600 * 1000,
      tracked: true,
    };
  }

  /**
   * The cookie this redirect sets belongs to the PartnerIQ redirect host, so the
   * merchant's own site can never read it â€” different origin, and `SameSite`
   * keeps it off cross-site XHR regardless. The identifiers therefore have to
   * travel to the destination in the URL, where the merchant page (or the
   * browser SDK's `captureReferral()`) can pick them up and persist them in
   * first-party storage. This is also where the UTM and custom parameters the
   * Link Builder previews actually get applied â€” previously they were recorded
   * on the click but never forwarded, so the merchant's own analytics saw the
   * traffic as direct.
   */
  private buildResolvedDestination(
    link: TrackingLinkEntity,
    click: ClickEntity,
    anonymousId: string,
    passthroughParams?: Record<string, string>,
    deepLinkTarget?: string,
  ): string {
    try {
      const url = this.applyDeepLink(link.destinationUrl, deepLinkTarget);
      if (click.utmSource) url.searchParams.set('utm_source', click.utmSource);
      if (click.utmMedium) url.searchParams.set('utm_medium', click.utmMedium);
      if (click.utmCampaign) url.searchParams.set('utm_campaign', click.utmCampaign);
      if (click.utmTerm) url.searchParams.set('utm_term', click.utmTerm);
      if (click.utmContent) url.searchParams.set('utm_content', click.utmContent);

      const customParameters = (link as any).customParameters as Record<string, string> | undefined;
      for (const [key, value] of Object.entries(customParameters || {})) {
        if (key.trim()) url.searchParams.set(key.trim(), String(value ?? ''));
      }

      // Anything else the affiliate appended at click time (sub_id, placement
      // tags, and so on) rides along â€” but only into keys nothing has claimed,
      // so a visitor-supplied value can never overwrite the link's own
      // configuration or the destination URL's existing parameters.
      for (const [key, value] of Object.entries(passthroughParams || {})) {
        if (!url.searchParams.has(key)) url.searchParams.set(key, value);
      }

      // clickId is the primary, durable attribution identifier; anonymousId is
      // the fallback the identify endpoint keys on.
      url.searchParams.set('pi_click_id', click.id);
      url.searchParams.set('pi_anon_id', anonymousId);
      return url.toString();
    } catch {
      // A destination that isn't a parseable absolute URL should still redirect
      // rather than 500 â€” it just goes out without the attribution parameters.
      return link.destinationUrl;
    }
  }

  /**
   * Applies a `?url=` deep-link target on top of the link's own destination.
   *
   * This is an open-redirect surface: the target arrives in a URL that anyone
   * can craft and share, so it is constrained to the destination's own origin.
   * A relative path (`/pricing`) is resolved against the destination; an
   * absolute URL is honoured only when its origin matches exactly. Anything
   * else â€” another host, a protocol-relative `//evil.com`, a `javascript:`
   * payload â€” is discarded and the visitor lands on the configured destination,
   * which is the safe outcome rather than an error page.
   */
  private applyDeepLink(destinationUrl: string, deepLinkTarget?: string): URL {
    const destination = new URL(destinationUrl);
    if (!deepLinkTarget) return destination;

    const target = deepLinkTarget.trim();
    // `//host` is protocol-relative and would resolve to a foreign origin.
    if (!target || target.startsWith('//')) return destination;

    let resolved: URL;
    try {
      resolved = new URL(target, destination);
    } catch {
      return destination;
    }

    if (resolved.origin !== destination.origin) {
      this.logger.warn(
        `Rejected cross-origin deep link '${target}' for destination '${destination.origin}'.`,
      );
      return destination;
    }

    // Keep query parameters the link author configured on the destination;
    // the deep link chooses the path, not the campaign wiring.
    for (const [key, value] of destination.searchParams) {
      if (!resolved.searchParams.has(key)) resolved.searchParams.set(key, value);
    }

    return resolved;
  }

  /**
   * Accepts an inbound `pi_anon_id` only when it is one this organization has
   * actually issued, so a hand-crafted cookie cannot graft a visitor onto
   * someone else's attribution history.
   */
  private resolveExistingAnonymousId(
    candidate: string | undefined,
    organizationId: string,
  ): string | undefined {
    if (!candidate || !/^anon_[0-9a-f-]{36}$/i.test(candidate)) return undefined;
    const known = dbStore.attributions.some(
      (a) => a.anonymousId === candidate && a.organizationId === organizationId,
    );
    return known ? candidate : undefined;
  }

  /**
   * Maps the redirect host's leading label ({slug}.partneriq.in) to an org.
   * Returns undefined for apex/localhost hosts and for the generic `go.` host,
   * which name no tenant.
   */
  private resolveOrganizationIdFromHost(host?: string): { organizationId?: string; unknownTenant: boolean } {
    if (!host) return { unknownTenant: false };
    const hostname = host.split(':')[0].toLowerCase();
    const labels = hostname.split('.');
    if (labels.length < 3) return { unknownTenant: false };

    const slug = labels[0];
    if (!slug || slug === 'www' || slug === 'go') return { unknownTenant: false };

    const organizationId = dbStore.organizations.find((o) => o.slug === slug)?.id;
    if (organizationId) return { organizationId, unknownTenant: false };

    // Only a partneriq.in subdomain is guaranteed to be a tenant host. An
    // unrecognised slug there is a bad host, not an invitation to fall back to
    // matching across every tenant â€” otherwise anyone who can set a Host header
    // reopens the collision. Other hosts (custom domains) stay unscoped.
    const isPlatformHost = labels.slice(-2).join('.') === 'partneriq.in';
    return { unknownTenant: isPlatformHost };
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

  /**
   * Browser SDK click tracking
   */
  async handleBrowserClick(dto: BrowserClickDto, userAgent?: string, ipAddress?: string) {
    const pubKey = dbStore.publicKeys.find((k) => k.key === dto.publicKey);
    if (!pubKey) {
      throw new BadRequestException('Invalid public tracking key');
    }

    // Scope the lookup to the key's own organization rather than pre-checking a
    // globally-found link. Short codes are unique per tenant, not globally, so
    // the old `find` could land on another tenant's link and reject a legitimate
    // click â€” or, once it passed, leave the resolution unscoped entirely.
    return this.handleRedirect(dto.shortCode, userAgent, ipAddress, undefined, undefined, {
      organizationId: pubKey.organizationId,
      landingUrl: dto.landingUrl,
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      utmTerm: dto.utmTerm,
      utmContent: dto.utmContent,
      // The SDK reports the visitor's existing id; honouring it keeps one
      // identity across touchpoints exactly as the redirect path does.
      existingAnonymousId: dto.anonymousId,
    });
  }

  /**
   * Customer identity resolution API
   */
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
    await Promise.all(toUpdate.map((attr) => awaitPersist(attr)));

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
