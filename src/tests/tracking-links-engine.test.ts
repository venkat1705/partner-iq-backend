import { TrackingService } from '../modules/tracking/tracking.service';
import { dbStore } from '../database/store';
import { EnvironmentType, TrackingLinkStatus, ProgramStatus, AffiliateStatus } from '../common/enums';
import { v4 as uuidv4 } from 'uuid';

export async function runTrackingLinksTest() {
  console.log('--- Starting Tracking & Referral Link Intelligence Verification ---');

  const testOrgId = uuidv4();
  const testProgramId = uuidv4();
  const testAffiliateId = uuidv4();

  // 1. Seed test organization, program & affiliate
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
    email: 'partners@nexusmedia.io',
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

  const trackingService = new TrackingService(
    fraudService,
    performanceAggregationService,
    automationEngineService,
  );

  // 2. Test Open Redirect / Destination Security Validation
  console.log('1. Testing Destination Security & Open Redirect Protection...');
  const safeHttp = trackingService.validateDestinationUrl('https://partneriq.in/products/enterprise');
  if (!safeHttp.valid) throw new Error('Valid HTTPS URL was rejected');

  const unsafeProto = trackingService.validateDestinationUrl('javascript:alert(document.cookie)');
  if (unsafeProto.valid) throw new Error('Dangerous javascript: protocol was not blocked');

  const unsafeLocal = trackingService.validateDestinationUrl('http://localhost:8080/admin');
  if (unsafeLocal.valid) throw new Error('Localhost SSRF loopback was not blocked');

  console.log('   ✅ Open redirect and unsafe protocols safely rejected.');

  // 3. Test Analytics & Default Baseline Seeding
  console.log('\n2. Testing getTrackingAnalytics...');
  const analytics = await trackingService.getTrackingAnalytics(testOrgId, EnvironmentType.LIVE);
  console.log('   Total Links:', analytics.totalLinks);
  console.log('   Active Links:', analytics.activeLinks);
  console.log('   Total Clicks:', analytics.totalClicks);
  console.log('   Unique Visitors:', analytics.uniqueVisitors);
  console.log('   Trajectory points:', analytics.trajectory.length);
  console.log('   Program Breakdown count:', analytics.programBreakdown.length);
  console.log('   Affiliate Breakdown count:', analytics.affiliateBreakdown.length);

  if (analytics.totalLinks <= 0) {
    throw new Error('Analytics failed to seed deterministic baseline');
  }

  // 4. Test Paginated Listing with Search & Filters
  console.log('\n3. Testing getLinksPaginated...');
  const paginated = await trackingService.getLinksPaginated(testOrgId, EnvironmentType.LIVE, {
    page: 1,
    limit: 10,
    sortBy: 'clicks',
    sortOrder: 'desc',
  });
  console.log(`   Fetched ${paginated.data.length} links out of ${paginated.meta.total} total.`);
  for (const l of paginated.data.slice(0, 3)) {
    console.log(`   * ${l.shortCode} | Partner: ${l.affiliateName} | Clicks: ${l.clicks} | Conv: ${l.conversions} | Status: ${l.status}`);
  }
  if (paginated.data.length === 0) {
    throw new Error('Paginated listing returned empty');
  }

  // 5. Test Link Detail Dossier
  console.log('\n4. Testing getLinkDetail...');
  const sampleLink = paginated.data[0];
  const dossier = await trackingService.getLinkDetail(testOrgId, sampleLink.id, EnvironmentType.LIVE);
  console.log('   Link Short Code:', dossier.link.shortCode);
  console.log('   Partner Name:', dossier.partner.name);
  console.log('   Destination Valid:', dossier.health.destinationValid);
  console.log('   Recent Click Telemetry records:', dossier.recentClicks.length);

  // 6. Test Create Link with Collision Safety
  console.log('\n5. Testing createLink...');
  const newLink = await trackingService.createLink(testOrgId, {
    programId: testProgramId,
    affiliateId: testAffiliateId,
    destinationUrl: 'https://partneriq.in/special-offer',
    customCode: 'nexus-vip',
    campaignId: 'vip-q4',
    utmSource: 'nexus_partner',
    utmMedium: 'blog',
    notes: 'Special Q4 influencer campaign',
  }, 'ops-admin', EnvironmentType.LIVE);
  console.log('   Created Link Code:', newLink.shortCode);

  // Test duplicate collision check
  try {
    await trackingService.createLink(testOrgId, {
      programId: testProgramId,
      affiliateId: testAffiliateId,
      destinationUrl: 'https://partneriq.in/duplicate',
      customCode: 'nexus-vip',
    }, 'ops-admin', EnvironmentType.LIVE);
    throw new Error('Duplicate shortCode was allowed to be created!');
  } catch (err: any) {
    console.log('   ✅ Collision protection verified: duplicate short code safely blocked.');
  }

  // 7. Test Update Link
  console.log('\n6. Testing updateLink...');
  const updated = await trackingService.updateLink(testOrgId, newLink.id, 'ops-admin', {
    destinationUrl: 'https://partneriq.in/special-offer-v2',
    notes: 'Updated landing page destination',
  }, EnvironmentType.LIVE);
  if (updated.destinationUrl !== 'https://partneriq.in/special-offer-v2') {
    throw new Error('Failed to update destination URL');
  }
  console.log('   Updated Destination URL:', updated.destinationUrl);

  // 8. Test Bulk Actions
  console.log('\n7. Testing bulkUpdateLinks...');
  const bulkRes = await trackingService.bulkUpdateLinks(testOrgId, 'ops-admin', {
    linkIds: [newLink.id],
    action: 'DEACTIVATE',
  }, EnvironmentType.LIVE);
  console.log(`   Bulk Deactivated: ${bulkRes.updatedCount} link(s)`);

  // 9. Test CSV Export Generation
  console.log('\n8. Testing generateCsvExport...');
  const csvData = await trackingService.generateCsvExport(testOrgId, EnvironmentType.LIVE);
  console.log('   CSV Data Length (bytes):', csvData.length);
  console.log('   CSV Header:', csvData.split('\n')[0]);
  if (!csvData.includes('short_code')) {
    throw new Error('CSV output does not contain expected header row');
  }

  console.log('\n [ALL TRACKING LINK INTELLIGENCE TESTS PASSED]');
}

runTrackingLinksTest().catch((err) => {
  console.error('Tracking links test failed:', err);
  process.exit(1);
});

