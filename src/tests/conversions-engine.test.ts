import { ConversionsService } from '../modules/conversions/conversions.service';
import { dbStore } from '../database/store';
import { EnvironmentType, ConversionStatus } from '../common/enums';
import { v4 as uuidv4 } from 'uuid';

export async function runConversionsTest() {
  console.log('--- Starting Conversions Engine & Intelligence Verification ---');

  const testOrgId = uuidv4();
  const testAffiliateId = uuidv4();
  const testProgramId = uuidv4();

  // 1. Seed test organization, program & affiliate
  dbStore.organizations.push({
    id: testOrgId,
    name: 'Enterprise Commerce Labs',
    slug: 'commerce-labs',
    defaultCurrency: 'INR',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  dbStore.programs.push({
    id: testProgramId,
    organizationId: testOrgId,
    name: 'Global Enterprise Partners',
    currency: 'INR',
    status: 'ACTIVE' as any,
    defaultAttributionModel: 'LAST_CLICK',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  dbStore.affiliates.push({
    id: testAffiliateId,
    organizationId: testOrgId,
    displayName: 'Growth Tech Alpha',
    email: 'growth@techalpha.io',
    companyName: 'Tech Alpha Media',
    country: 'IN',
    status: 'ACTIVE' as any,
    trustScore: 95,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  const ledgerService = {
    recordTransaction: async () => ({ id: uuidv4() }),
  } as any;
  const fraudService = {
    evaluateConversion: async () => ({ decision: 'APPROVE', riskScore: 5 }),
    recordConversionVelocity: async () => { },
  } as any;
  const webhooksService = {
    triggerEvent: async () => { },
  } as any;
  const commissionsService = {
    calculateAndRecordCommission: async (orgId: string, conversion: any, affiliateId: string) => {
      const commId = uuidv4();
      const commRecord = {
        id: commId,
        organizationId: orgId,
        conversionId: conversion.id,
        affiliateId: affiliateId,
        commissionAmount: 25000,
        currency: 'INR',
        status: 'APPROVED',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.commissions.push(commRecord as any);
      return commRecord;
    },
  } as any;

  const conversionsService = new ConversionsService(
    fraudService,
    commissionsService,
    ledgerService,
    webhooksService,
  );

  // 2. Test Analytics & Default Baseline Seeding
  console.log('1. Testing getConversionAnalytics...');
  const analytics = await conversionsService.getConversionAnalytics(testOrgId, EnvironmentType.LIVE);
  console.log('   Total Conversions:', analytics.totalConversions);
  console.log('   Approved Count:', analytics.approvedConversions);
  console.log('   Pending Count:', analytics.pendingValidation);
  console.log('   Gross Revenue:', analytics.grossRevenue / 100);
  console.log('   Net Revenue:', analytics.netRevenue / 100);
  console.log('   Attribution Coverage:', analytics.attributionCoverage + '%');
  console.log('   Trajectory points:', analytics.trajectory.length);

  if (analytics.totalConversions <= 0) {
    throw new Error('Analytics failed to seed deterministic baseline');
  }

  // 3. Test Paginated Listing
  console.log('\n2. Testing getConversionsPaginated...');
  const paginated = await conversionsService.getConversionsPaginated(testOrgId, EnvironmentType.LIVE, {
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  console.log(`   Fetched ${paginated.data.length} conversions out of ${paginated.meta.total} total.`);
  for (const conv of paginated.data.slice(0, 3)) {
    console.log(`   * ${conv.id.slice(0, 8)} | Ext: ${conv.externalId} | Customer: ${conv.customerExternalId} | ₹${conv.amount / 100} | Status: ${conv.status}`);
  }
  if (paginated.data.length === 0) {
    throw new Error('Paginated listing returned empty array');
  }

  // 4. Test Conversion Detail Dossier
  console.log('\n3. Testing getConversionDetail...');
  const sampleConv = paginated.data[0];
  const dossier = await conversionsService.getConversionDetail(testOrgId, sampleConv.id, EnvironmentType.LIVE);
  console.log('   Conversion ID:', dossier.conversion.id);
  console.log('   Masked Customer:', dossier.conversion.customerExternalId);
  console.log('   Validation Checks:', dossier.validation.checks.length);
  console.log('   Attribution Model:', dossier.attributionJourney.model);
  console.log('   Audit Logs:', dossier.auditLogs.length);

  // 5. Test Approval Workflow
  console.log('\n4. Testing approveConversion...');
  const pendingConv = paginated.data.find(c => c.status === ConversionStatus.PENDING);
  if (pendingConv) {
    const approvedRes = await conversionsService.approveConversion(testOrgId, pendingConv.id, 'lead-auditor', {
      notes: 'Passed manual verification',
    });
    console.log('   Approved Conversion Status:', approvedRes.conversion.status);
    console.log('   Validation Status:', approvedRes.conversion.validationStatus);
    if (approvedRes.conversion.status !== ConversionStatus.APPROVED) {
      throw new Error(`Expected conversion status to be APPROVED but got ${approvedRes.conversion.status}`);
    }
  }

  // 6. Test Manual Conversion Creation
  console.log('\n5. Testing createManualConversion...');
  const manualRes = await conversionsService.createManualConversion(testOrgId, 'ops-lead', {
    programId: testProgramId,
    affiliateId: testAffiliateId,
    externalId: `OFFLINE-INV-${Date.now()}`,
    customerExternalId: 'CUS-OFFLINE-99',
    amount: 150000,
    productId: 'enterprise-custom-tier',
    notes: 'Direct B2B referral close',
  }, EnvironmentType.LIVE);
  console.log('   Created Manual Conversion ID:', manualRes.conversion.id);
  console.log('   Generated Commission Amount: ₹', (manualRes.commission?.amount || 0) / 100);

  // 7. Test Refund Handling with Clawback
  console.log('\n6. Testing refundConversion...');
  const refundRes = await conversionsService.refundConversion(testOrgId, manualRes.conversion.id, {
    reason: 'Customer initiated trial refund',
    amount: 75000,
  }, EnvironmentType.LIVE);
  console.log('   Refund Status:', refundRes.conversion.status);
  console.log('   Clawback Amount: ₹', (refundRes.clawbackAmount || 0) / 100);

  // 8. Test CSV Export Generation
  console.log('\n7. Testing generateCsvExport...');
  const csvData = await conversionsService.generateCsvExport(testOrgId, EnvironmentType.LIVE);
  console.log('   CSV Data Length (bytes):', csvData.length);
  console.log('   CSV Header:', csvData.split('\n')[0]);
  if (!csvData.includes('conversion_id')) {
    throw new Error('CSV output does not contain expected header row');
  }

  console.log('\n [ALL CONVERSION ENGINE & INTELLIGENCE TESTS PASSED]');
}

runConversionsTest().catch(err => {
  console.error('Conversions test failed:', err);
  process.exit(1);
});
