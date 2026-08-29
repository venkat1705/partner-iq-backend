import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  dbStore,
  AffiliatePerformanceSummaryEntity,
  ConversionEntity,
} from '../../../database/store';
import { TierEvaluatorService } from '../tiers/tier-evaluator.service';
import { MilestoneEvaluatorService } from '../milestones/milestone-evaluator.service';

@Injectable()
export class PerformanceAggregationService {
  private readonly logger = new Logger(PerformanceAggregationService.name);

  constructor(
    private readonly tierEvaluator: TierEvaluatorService,
    private readonly milestoneEvaluator: MilestoneEvaluatorService,
  ) {}

  /**
   * Called in real-time when a conversion is approved.
   */
  async recordApprovedConversion(
    organizationId: string,
    programId: string,
    affiliateId: string,
    conversion: ConversionEntity,
    commissionAmountCents: number,
  ) {
    const now = new Date();
    const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    // 1. Update/create LIFETIME summary
    this.incrementSummary(organizationId, programId, affiliateId, 'LIFETIME', 'LIFETIME', {
      approvedConversions: 1,
      revenue: conversion.amount || 0,
      attributedRevenue: conversion.amount || 0,
      commissionEarned: commissionAmountCents || 0,
    });

    // 2. Update/create MONTHLY summary
    this.incrementSummary(organizationId, programId, affiliateId, 'MONTHLY', currentMonthKey, {
      approvedConversions: 1,
      revenue: conversion.amount || 0,
      attributedRevenue: conversion.amount || 0,
      commissionEarned: commissionAmountCents || 0,
    });

    // 3. Real-time evaluation of milestones & tiers
    await this.milestoneEvaluator.evaluateMilestonesForAffiliate(organizationId, programId, affiliateId);
    await this.tierEvaluator.evaluateAffiliateTier(organizationId, programId, affiliateId);
  }

  /**
   * Called in real-time when an affiliate creates a tracking link.
   */
  async recordTrackingLinkCreated(organizationId: string, programId: string, affiliateId: string) {
    const now = new Date();
    const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    this.incrementSummary(organizationId, programId, affiliateId, 'LIFETIME', 'LIFETIME', {
      trackingLinksCreated: 1,
    });
    this.incrementSummary(organizationId, programId, affiliateId, 'MONTHLY', currentMonthKey, {
      trackingLinksCreated: 1,
    });

    await this.milestoneEvaluator.evaluateMilestonesForAffiliate(organizationId, programId, affiliateId);
    await this.tierEvaluator.evaluateAffiliateTier(organizationId, programId, affiliateId);
  }

  /**
   * Called in real-time when an affiliate link receives a click.
   */
  async recordClick(organizationId: string, programId: string, affiliateId: string) {
    const now = new Date();
    const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    this.incrementSummary(organizationId, programId, affiliateId, 'LIFETIME', 'LIFETIME', {
      clicks: 1,
    });
    this.incrementSummary(organizationId, programId, affiliateId, 'MONTHLY', currentMonthKey, {
      clicks: 1,
    });
  }

  /**
   * Called when a B2B deal is Closed-Won.
   */
  async recordClosedWonDeal(
    organizationId: string,
    programId: string,
    affiliateId: string,
    dealValueCents: number,
  ) {
    const now = new Date();
    const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    this.incrementSummary(organizationId, programId, affiliateId, 'LIFETIME', 'LIFETIME', {
      closedWonDeals: 1,
      closedWonRevenue: dealValueCents,
      revenue: dealValueCents,
    });
    this.incrementSummary(organizationId, programId, affiliateId, 'MONTHLY', currentMonthKey, {
      closedWonDeals: 1,
      closedWonRevenue: dealValueCents,
      revenue: dealValueCents,
    });

    await this.milestoneEvaluator.evaluateMilestonesForAffiliate(organizationId, programId, affiliateId);
    await this.tierEvaluator.evaluateAffiliateTier(organizationId, programId, affiliateId);
  }

  private incrementSummary(
    organizationId: string,
    programId: string,
    affiliateId: string,
    periodType: string,
    periodKey: string,
    increments: {
      clicks?: number;
      trackingLinksCreated?: number;
      approvedConversions?: number;
      revenue?: number;
      attributedRevenue?: number;
      commissionEarned?: number;
      qualifiedLeads?: number;
      closedWonDeals?: number;
      closedWonRevenue?: number;
    },
  ): AffiliatePerformanceSummaryEntity {
    let summary = dbStore.affiliatePerformanceSummaries.find(
      (s) =>
        s.organizationId === organizationId &&
        s.programId === programId &&
        s.affiliateId === affiliateId &&
        s.periodType === periodType &&
        s.periodKey === periodKey,
    );

    const now = new Date();

    if (!summary) {
      summary = {
        id: uuidv4(),
        organizationId,
        programId,
        affiliateId,
        periodType,
        periodKey,
        periodStart: periodType === 'LIFETIME' ? new Date(0) : new Date(now.getFullYear(), now.getMonth(), 1),
        periodEnd: periodType === 'LIFETIME' ? new Date(9999, 11, 31) : new Date(now.getFullYear(), now.getMonth() + 1, 0),
        clicks: increments.clicks || 0,
        trackingLinksCreated: increments.trackingLinksCreated || 0,
        approvedConversions: increments.approvedConversions || 0,
        revenue: increments.revenue || 0,
        attributedRevenue: increments.attributedRevenue || 0,
        commissionEarned: increments.commissionEarned || 0,
        qualifiedLeads: increments.qualifiedLeads || 0,
        closedWonDeals: increments.closedWonDeals || 0,
        closedWonRevenue: increments.closedWonRevenue || 0,
        lastActivityAt: now,
        updatedAt: now,
      };
      dbStore.affiliatePerformanceSummaries.push(summary);
    } else {
      if (increments.clicks) summary.clicks += increments.clicks;
      if (increments.trackingLinksCreated) summary.trackingLinksCreated += increments.trackingLinksCreated;
      if (increments.approvedConversions) summary.approvedConversions += increments.approvedConversions;
      if (increments.revenue) summary.revenue += increments.revenue;
      if (increments.attributedRevenue) summary.attributedRevenue += increments.attributedRevenue;
      if (increments.commissionEarned) summary.commissionEarned += increments.commissionEarned;
      if (increments.qualifiedLeads) summary.qualifiedLeads += increments.qualifiedLeads;
      if (increments.closedWonDeals) summary.closedWonDeals += increments.closedWonDeals;
      if (increments.closedWonRevenue) summary.closedWonRevenue += increments.closedWonRevenue;
      summary.lastActivityAt = now;
      summary.updatedAt = now;
    }

    return summary;
  }
}
