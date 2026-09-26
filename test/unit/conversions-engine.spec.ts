import { describe, it, expect, beforeEach } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { ConversionsService } from '../../src/modules/conversions/conversions.service';
import { dbStore } from '../../src/database/store';
import { EnvironmentType, ConversionStatus, ProgramStatus } from '../../src/common/enums';

describe('ConversionsService', () => {
  let conversionsService: ConversionsService;
  let testOrgId: string;
  let testProgramId: string;
  let testAffiliateId: string;

  beforeEach(() => {
    testOrgId = uuidv4();
    testProgramId = uuidv4();
    testAffiliateId = uuidv4();

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
      status: ProgramStatus.ACTIVE,
      defaultAttributionModel: 'LAST_CLICK',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    dbStore.affiliates.push({
      id: testAffiliateId,
      organizationId: testOrgId,
      displayName: 'Growth Tech Alpha',
      email: 'growth@techalpha.example.test',
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
          affiliateId,
          amount: 25000,
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

    conversionsService = new ConversionsService(
      fraudService,
      commissionsService,
      ledgerService,
      webhooksService,
    );
  });

  it('starts with no auto-seeded conversions for a brand-new organization', async () => {
    const analytics = await conversionsService.getConversionAnalytics(testOrgId, EnvironmentType.LIVE);
    expect(analytics.totalConversions).toBe(0);

    const paginated = await conversionsService.getConversionsPaginated(testOrgId, EnvironmentType.LIVE, {
      page: 1,
      limit: 10,
    });
    expect(paginated.data.length).toBe(0);
    expect(paginated.meta.total).toBe(0);
  });

  it('calculates conversion analytics baseline from a real recorded conversion', async () => {
    await conversionsService.createManualConversion(testOrgId, 'ops-lead', {
      programId: testProgramId,
      affiliateId: testAffiliateId,
      externalId: `ANALYTICS-${Date.now()}`,
      customerExternalId: 'CUS-ANALYTICS-1',
      amount: 50000,
      notes: 'Baseline analytics fixture',
    }, EnvironmentType.LIVE);

    const analytics = await conversionsService.getConversionAnalytics(testOrgId, EnvironmentType.LIVE);
    expect(analytics.totalConversions).toBeGreaterThan(0);
    expect(analytics.trajectory.length).toBeGreaterThan(0);
  });

  it('returns paginated conversion listings', async () => {
    await conversionsService.createManualConversion(testOrgId, 'ops-lead', {
      programId: testProgramId,
      affiliateId: testAffiliateId,
      externalId: `PAGINATED-${Date.now()}`,
      customerExternalId: 'CUS-PAGINATED-1',
      amount: 50000,
      notes: 'Pagination fixture',
    }, EnvironmentType.LIVE);

    const paginated = await conversionsService.getConversionsPaginated(testOrgId, EnvironmentType.LIVE, {
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(paginated.data.length).toBeGreaterThan(0);
    expect(paginated.meta.total).toBeGreaterThan(0);
  });

  it('retrieves conversion detail dossier with audit logs and journey', async () => {
    await conversionsService.createManualConversion(testOrgId, 'ops-lead', {
      programId: testProgramId,
      affiliateId: testAffiliateId,
      externalId: `DOSSIER-${Date.now()}`,
      customerExternalId: 'CUS-DOSSIER-1',
      amount: 50000,
      notes: 'Dossier fixture',
    }, EnvironmentType.LIVE);

    const paginated = await conversionsService.getConversionsPaginated(testOrgId, EnvironmentType.LIVE, {
      page: 1,
      limit: 10,
    });
    const sampleConv = paginated.data[0];
    const dossier = await conversionsService.getConversionDetail(testOrgId, sampleConv.id, EnvironmentType.LIVE);
    expect(dossier.conversion.id).toBe(sampleConv.id);
    expect(dossier.validation.checks.length).toBeGreaterThanOrEqual(0);
    expect(dossier.attributionJourney.model).toBeTruthy();
  });

  it('supports approve conversion workflow', async () => {
    // Fixture a PENDING conversion directly (mirrors the real ingestion path's
    // initial status) the way this suite already fixtures org/program/affiliate
    // rows, rather than relying on the service to auto-generate one.
    const pendingId = uuidv4();
    dbStore.conversions.push({
      id: pendingId,
      organizationId: testOrgId,
      environment: EnvironmentType.LIVE,
      programId: testProgramId,
      affiliateId: testAffiliateId,
      externalId: `PENDING-${Date.now()}`,
      customerExternalId: 'CUS-PENDING-1',
      amount: 50000,
      refundedAmount: 0,
      currency: 'INR',
      type: 'PURCHASE',
      status: ConversionStatus.PENDING,
      source: 'WEBHOOK',
      occurredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const approvedRes = await conversionsService.approveConversion(testOrgId, pendingId, 'lead-auditor', {
      notes: 'Passed manual verification',
    });
    expect(approvedRes.conversion.status).toBe(ConversionStatus.APPROVED);
  });

  it('creates manual conversions and generates commissions', async () => {
    const manualRes = await conversionsService.createManualConversion(testOrgId, 'ops-lead', {
      programId: testProgramId,
      affiliateId: testAffiliateId,
      externalId: `OFFLINE-INV-${Date.now()}`,
      customerExternalId: 'CUS-OFFLINE-99',
      amount: 150000,
      productId: 'enterprise-custom-tier',
      notes: 'Direct B2B referral close',
    }, EnvironmentType.LIVE);

    expect(manualRes.conversion.id).toBeTruthy();
    expect(manualRes.commission?.amount).toBe(25000);

    // Test refund handling with clawback
    const refundRes = await conversionsService.refundConversion(testOrgId, manualRes.conversion.id, {
      reason: 'Customer initiated trial refund',
      amount: 75000,
    }, EnvironmentType.LIVE);

    expect(refundRes.conversion.status).toBe(ConversionStatus.PARTIALLY_REFUNDED);
  });

  it('generates CSV export data with correct headers', async () => {
    const csvData = await conversionsService.generateCsvExport(testOrgId, EnvironmentType.LIVE);
    expect(csvData.length).toBeGreaterThan(0);
    expect(csvData.includes('conversion_id')).toBe(true);
  });
});

