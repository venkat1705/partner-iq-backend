import { describe, it, expect, beforeEach } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { TrackingService } from '../../src/modules/tracking/tracking.service';
import { dbStore } from '../../src/database/store';
import { EnvironmentType, TrackingLinkStatus, ProgramStatus, AffiliateStatus } from '../../src/common/enums';

describe('TrackingService', () => {
  let trackingService: TrackingService;
  let testOrgId: string;
  let testProgramId: string;
  let testAffiliateId: string;

  beforeEach(() => {
    testOrgId = uuidv4();
    testProgramId = uuidv4();
    testAffiliateId = uuidv4();

    dbStore.organizations.push({
      id: testOrgId,
      name: 'Enterprise Link Intelligence Corp',
      slug: 'link-corp',
      defaultCurrency: 'INR',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    dbStore.programs.push({
      id: testProgramId,
      organizationId: testOrgId,
      name: 'Global Link Attribution Program',
      slug: 'attribution-program',
      currency: 'INR',
      status: ProgramStatus.ACTIVE,
      cookieDays: 30,
      defaultAttributionModel: 'LAST_CLICK',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    dbStore.affiliates.push({
      id: testAffiliateId,
      organizationId: testOrgId,
      displayName: 'Nexus Media Partners',
      email: 'partners@nexusmedia.example.test',
      companyName: 'Nexus Media Group',
      country: 'IN',
      status: AffiliateStatus.ACTIVE,
      trustScore: 92,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const fraudService = {
      evaluateClick: async () => ({ decision: 'APPROVE', riskScore: 5 }),
    } as any;
    const performanceAggregationService = {
      recordTrackingLinkCreated: async () => { },
      recordClick: async () => { },
    } as any;
    const automationEngineService = {
      handleEvent: async () => { },
    } as any;

    trackingService = new TrackingService(
      fraudService,
      performanceAggregationService,
      automationEngineService,
    );
  });

  it('validates destination URLs and prevents open redirects / SSRF loopbacks', () => {
    const safeHttp = trackingService.validateDestinationUrl('https://example.test/products/enterprise');
    expect(safeHttp.valid).toBe(true);

    const unsafeProto = trackingService.validateDestinationUrl('javascript:alert(document.cookie)');
    expect(unsafeProto.valid).toBe(false);

    const unsafeLocal = trackingService.validateDestinationUrl('http://localhost:8080/admin');
    expect(unsafeLocal.valid).toBe(false);
  });

  it('starts with no auto-seeded tracking links for a brand-new organization', async () => {
    const analytics = await trackingService.getTrackingAnalytics(testOrgId, EnvironmentType.LIVE);
    expect(analytics.totalLinks).toBe(0);

    const paginated = await trackingService.getLinksPaginated(testOrgId, EnvironmentType.LIVE, {
      page: 1,
      limit: 10,
    });
    expect(paginated.data.length).toBe(0);
  });

  it('calculates tracking analytics baseline metrics from real created links', async () => {
    await trackingService.createLink(testOrgId, {
      programId: testProgramId,
      affiliateId: testAffiliateId,
      destinationUrl: 'https://example.test/analytics-check',
      customCode: 'analytics-check',
    }, 'ops-admin', EnvironmentType.LIVE);

    const analytics = await trackingService.getTrackingAnalytics(testOrgId, EnvironmentType.LIVE);
    expect(analytics.totalLinks).toBeGreaterThan(0);
    expect(analytics.trajectory.length).toBeGreaterThan(0);
  });

  it('lists paginated tracking links with sorting', async () => {
    await trackingService.createLink(testOrgId, {
      programId: testProgramId,
      affiliateId: testAffiliateId,
      destinationUrl: 'https://example.test/paginated-check',
      customCode: 'paginated-check',
    }, 'ops-admin', EnvironmentType.LIVE);

    const paginated = await trackingService.getLinksPaginated(testOrgId, EnvironmentType.LIVE, {
      page: 1,
      limit: 10,
      sortBy: 'clicks',
      sortOrder: 'desc',
    });
    expect(paginated.data.length).toBeGreaterThan(0);
  });

  it('retrieves detailed tracking link dossier', async () => {
    await trackingService.createLink(testOrgId, {
      programId: testProgramId,
      affiliateId: testAffiliateId,
      destinationUrl: 'https://example.test/dossier-check',
      customCode: 'dossier-check',
    }, 'ops-admin', EnvironmentType.LIVE);

    const paginated = await trackingService.getLinksPaginated(testOrgId, EnvironmentType.LIVE, {
      page: 1,
      limit: 10,
    });
    const sampleLink = paginated.data[0];
    const dossier = await trackingService.getLinkDetail(testOrgId, sampleLink.id, EnvironmentType.LIVE);
    expect(dossier.link.shortCode).toBe(sampleLink.shortCode);
    expect(dossier.health.destinationValid).toBeDefined();
  });

  it('creates links with collision protection and updates them', async () => {
    const newLink = await trackingService.createLink(testOrgId, {
      programId: testProgramId,
      affiliateId: testAffiliateId,
      destinationUrl: 'https://example.test/special-offer',
      customCode: 'nexus-vip',
      campaignId: 'vip-q4',
      utmSource: 'nexus_partner',
      utmMedium: 'blog',
      notes: 'Special Q4 influencer campaign',
    }, 'ops-admin', EnvironmentType.LIVE);

    expect(newLink.shortCode).toBe('nexus-vip');

    // Duplicate collision check
    await expect(
      trackingService.createLink(testOrgId, {
        programId: testProgramId,
        affiliateId: testAffiliateId,
        destinationUrl: 'https://example.test/duplicate',
        customCode: 'nexus-vip',
      }, 'ops-admin', EnvironmentType.LIVE)
    ).rejects.toThrow();

    // Update link
    const updated = await trackingService.updateLink(testOrgId, newLink.id, 'ops-admin', {
      destinationUrl: 'https://example.test/special-offer-v2',
      notes: 'Updated landing page destination',
    }, EnvironmentType.LIVE);
    expect(updated.destinationUrl).toBe('https://example.test/special-offer-v2');

    // Bulk actions
    const bulkRes = await trackingService.bulkUpdateLinks(testOrgId, 'ops-admin', {
      linkIds: [newLink.id],
      action: 'DEACTIVATE',
    }, EnvironmentType.LIVE);
    expect(bulkRes.updatedCount).toBe(1);
  });

  it('generates CSV export data with proper headers', async () => {
    const csvData = await trackingService.generateCsvExport(testOrgId, EnvironmentType.LIVE);
    expect(csvData.length).toBeGreaterThan(0);
    expect(csvData.includes('short_code')).toBe(true);
  });
});

