import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { AppDataSource } from '../../database/data-source';
import { dbStore, awaitPersist } from '../../database/store';
import { IntegrationEventStatus, IntegrationStatus, OrganizationIntegrationStatus, PlatformRole, PayoutStatus, AuditAction, ProgramStatus, AffiliateStatus, ConversionStatus } from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { netCommissionAmount } from '../../common/utils/commission.utils';
import { AdminOverviewQueryDto } from './dto/admin-query.dto';

@Injectable()
export class AdminService {
  async getOverview(user: AuthUserPayload, query?: AdminOverviewQueryDto) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const orgNameById = new Map(dbStore.organizations.map((org) => [org.id, org.name]));
    const orgById = new Map(dbStore.organizations.map((org) => [org.id, org]));
    const userById = new Map(dbStore.users.map((userRecord) => [userRecord.id, userRecord]));
    const programById = new Map(dbStore.programs.map((program) => [program.id, program]));
    const affiliateById = new Map(dbStore.affiliates.map((affiliate) => [affiliate.id, affiliate]));
    const conversionsByProgram = this.groupBy(dbStore.conversions, (conversion) => conversion.programId);
    const commissionsByConversion = this.groupBy(dbStore.commissions, (commission) => commission.conversionId);
    const payoutsByBatch = this.groupBy(dbStore.payoutItems, (item) => item.batchId);
    const conversionById = new Map(dbStore.conversions.map((c) => [c.id, c]));
    const commissionRuleById = new Map(dbStore.commissionRules.map((r) => [r.id, r]));
    const payoutItemById = new Map(dbStore.payoutItems.map((p) => [p.id, p]));

    const organizations = dbStore.organizations
      .filter((org) => !org.deletedAt)
      .map((org) => {
        const programs = dbStore.programs.filter((program) => program.organizationId === org.id && !program.deletedAt);
        const affiliates = dbStore.affiliates.filter((affiliate) => affiliate.organizationId === org.id);
        const conversions = dbStore.conversions.filter((conversion) => conversion.organizationId === org.id);
        const commissions = dbStore.commissions.filter((commission) => commission.organizationId === org.id);
        const ownerMembership = dbStore.organizationMemberships.find(
          (membership) => membership.organizationId === org.id && membership.role === 'OWNER',
        );
        const owner = ownerMembership ? userById.get(ownerMembership.userId) : undefined;

        const trackingLinks = dbStore.trackingLinks.filter((tl) => tl.organizationId === org.id);
        const members = dbStore.organizationMemberships.filter((m) => m.organizationId === org.id);
        const activeIntegrations = dbStore.organizationIntegrations.filter(
          (oi) => oi.organizationId === org.id && String(oi.status).toUpperCase() === 'CONNECTED',
        );
        const webhookEndpointIds = new Set(
          dbStore.webhookEndpoints.filter((we) => we.organizationId === org.id).map((we) => we.id),
        );
        const openFraudCount = dbStore.fraudReviews.filter(
          (fr) => fr.organizationId === org.id && String(fr.status).toUpperCase() === 'PENDING',
        ).length;
        const failedWebhooksCount = dbStore.webhookDeliveries.filter(
          (wd) => webhookEndpointIds.has(wd.endpointId) && String(wd.status).toUpperCase() === 'FAILED',
        ).length;

        const sub = dbStore.billingSubscriptions.find((s) => s.organizationId === org.id && s.rowStatus === 'ACTIVE');
        const planObj = sub ? dbStore.billingPlans.find((p) => p.id === sub.planId) : undefined;
        const isTrialOrg = dbStore.organizationTrials.some((t) => t.organizationId === org.id && !t.trialUsed);
        const resolvedPlanName = planObj?.name || (isTrialOrg ? 'Trial' : 'Starter');

        const subStatus = sub ? String(sub.status || 'ACTIVE').toUpperCase() : (isTrialOrg ? 'TRIAL' : 'NONE');
        const mrr = sub && planObj ? Math.round(this.centsToDollars(Number(planObj.price || 0))) : 0;

        let healthStatus: 'healthy' | 'attention' | 'critical' = 'healthy';
        if (org.status !== 'ACTIVE') {
          healthStatus = 'critical';
        } else if (subStatus === 'PAST_DUE' || (openFraudCount > 0 && conversions.length > 0 && openFraudCount / conversions.length > 0.15)) {
          healthStatus = 'critical';
        } else if (openFraudCount > 0 || failedWebhooksCount > 0 || isTrialOrg) {
          healthStatus = 'attention';
        }

        let lifecycleStage: 'onboarding' | 'trial' | 'active_paid' | 'at_risk' | 'churned' = 'active_paid';
        if (org.status === 'SUSPENDED' || org.status === 'CLOSED') {
          lifecycleStage = 'churned';
        } else if (sub && sub.status === 'ACTIVE' && planObj && Number(planObj.price || 0) > 0) {
          lifecycleStage = 'active_paid';
        } else if (isTrialOrg) {
          lifecycleStage = 'trial';
        } else if (programs.length === 0 || affiliates.length === 0) {
          lifecycleStage = 'onboarding';
        } else if (conversions.length === 0) {
          lifecycleStage = 'at_risk';
        }

        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          domain: this.domainFromWebsite(org.website),
          status: this.organizationStatus(org.status),
          plan: resolvedPlanName.toLowerCase(),
          programs: programs.length,
          affiliates: affiliates.length,
          trackingLinksCount: trackingLinks.length,
          conversionsCount: conversions.length,
          membersCount: members.length,
          activeIntegrationsCount: activeIntegrations.length,
          mrr,
          subscriptionStatus: subStatus,
          lifecycleStage,
          healthStatus,
          openFraudCount,
          failedWebhooksCount,
          trackedRevenue: this.centsToDollars(conversions.reduce((total, conversion) => total + Number(conversion.amount || 0), 0)),
          commissionVolume: this.centsToDollars(commissions.reduce((total, commission) => total + netCommissionAmount(commission), 0)),
          country: org.country || 'US',
          industry: org.industry || 'Software',
          createdAt: this.dateOnly(org.createdAt),
          lastActiveAt: this.relativeTime(org.updatedAt || org.createdAt),
          ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'Unknown Owner',
          ownerEmail: owner?.email || 'unknown@example.com',
          apiAccessEnabled: org.status === 'ACTIVE',
          payoutsEnabled: org.status === 'ACTIVE',
        };
      });

    const programs = dbStore.programs
      .filter((program) => !program.deletedAt)
      .map((program) => {
        const conversions = conversionsByProgram.get(program.id) || [];
        const commissions = dbStore.commissions.filter((commission) => commission.programId === program.id);
        const programAffiliateLinks = dbStore.programAffiliates.filter((link) => link.programId === program.id);
        const affiliateIds = new Set(programAffiliateLinks.map((link) => link.affiliateId));
        const trackingLinks = dbStore.trackingLinks.filter((tl) => tl.programId === program.id);
        const activeAffiliateIds = new Set(conversions.map((c) => c.affiliateId).filter(Boolean));
        const org = dbStore.organizations.find((o) => o.id === program.organizationId);
        const fraudRate = this.fraudRateForProgram(program.id);
        const status = this.programStatus(program.status);

        // Calculate lastActivityAt
        const dates: number[] = [new Date(program.updatedAt || program.createdAt).getTime()];
        for (const c of conversions) {
          if (c.createdAt) dates.push(new Date(c.createdAt).getTime());
        }
        for (const comm of commissions) {
          if (comm.createdAt) dates.push(new Date(comm.createdAt).getTime());
        }
        for (const tl of trackingLinks) {
          if (tl.createdAt) dates.push(new Date(tl.createdAt).getTime());
        }
        const maxActivityMs = Math.max(...dates);
        const lastActivityAt = this.relativeTime(new Date(maxActivityMs));
        const daysInactive = Math.floor((Date.now() - maxActivityMs) / (1000 * 60 * 60 * 24));

        const attentionFlags: string[] = [];
        if (affiliateIds.size === 0) attentionFlags.push('Zero Affiliates Enrolled');
        if (conversions.length === 0 && affiliateIds.size > 0) attentionFlags.push('Zero Conversions Recorded');
        if (fraudRate > 5) attentionFlags.push(`Elevated Fraud Rate (${fraudRate}%)`);
        if (daysInactive >= 30 && status === 'active') attentionFlags.push('Inactive for 30+ Days');
        if (status === 'draft') attentionFlags.push('Draft Status — Not Published');

        const orgIntegrations = dbStore.organizationIntegrations.filter(
          (oi) => oi.organizationId === program.organizationId && oi.status === OrganizationIntegrationStatus.CONNECTED
        );

        return {
          id: program.id,
          organizationId: program.organizationId,
          orgName: org?.name || orgNameById.get(program.organizationId) || 'Unknown Organization',
          orgDomain: this.domainFromWebsite(org?.website),
          name: program.name,
          slug: program.slug || '',
          type: String(program.type).toLowerCase(),
          status,
          currency: program.currency || 'USD',
          affiliatesCount: affiliateIds.size,
          activeAffiliatesCount: activeAffiliateIds.size,
          conversionsCount: conversions.length,
          trackingLinksCount: trackingLinks.length,
          revenue: this.centsToDollars(conversions.reduce((total, conversion) => total + Number(conversion.amount || 0), 0)),
          commission: this.centsToDollars(commissions.reduce((total, commission) => total + netCommissionAmount(commission), 0)),
          fraudRate,
          defaultCommission: this.formatCommission(program.commissionType, program.defaultCommissionValue),
          commissionType: program.commissionType,
          defaultCommissionValue: program.defaultCommissionValue,
          attributionModel: String(program.attributionModel).toLowerCase(),
          attributionWindowDays: program.attributionWindowDays || 30,
          cookieDays: program.cookieDurationDays || 30,
          approvalType: String(program.affiliateApprovalMode || 'AUTO').toLowerCase(),
          createdAt: this.dateOnly(program.createdAt),
          lastActivityAt,
          attentionFlags,
          adoption: {
            hasAffiliates: affiliateIds.size > 0,
            hasTracking: trackingLinks.length > 0,
            hasConversions: conversions.length > 0,
            hasCommissions: commissions.length > 0,
            hasIntegrations: orgIntegrations.length > 0,
          },
        };
      });

    const affiliates = dbStore.affiliates.map((affiliate) => {
      const programLinks = dbStore.programAffiliates.filter((link) => link.affiliateId === affiliate.id);
      const programs = programLinks.map((pl) => {
        const prog = programById.get(pl.programId);
        return {
          id: pl.programId,
          name: prog?.name || 'Unknown Program',
          joinedAt: this.dateOnly(pl.joinedAt),
          status: String(pl.status || 'ACTIVE').toLowerCase(),
        };
      });
      const primaryProgram = programLinks[0] ? programById.get(programLinks[0].programId) : undefined;
      const commissions = dbStore.commissions.filter((commission) => commission.affiliateId === affiliate.id);
      const conversions = dbStore.conversions.filter((conversion) => conversion.affiliateId === affiliate.id);
      const trackingLinks = dbStore.trackingLinks.filter((tl) => tl.affiliateId === affiliate.id);
      const payoutItems = dbStore.payoutItems.filter((pi) => pi.affiliateId === affiliate.id);
      const payoutPaid = this.centsToDollars(payoutItems.filter((pi) => pi.status === 'COMPLETED').reduce((acc, pi) => acc + Number(pi.amount || 0), 0));
      const payoutPending = this.centsToDollars(payoutItems.filter((pi) => pi.status !== 'COMPLETED').reduce((acc, pi) => acc + Number(pi.amount || 0), 0));
      const conversionIds = new Set(conversions.map((c) => c.id));
      const fraudReviews = dbStore.fraudReviews.filter((fr) => conversionIds.has(fr.conversionId));
      const openFraudReviewsCount = fraudReviews.filter((fr) => fr.status === 'PENDING').length;
      const fraudRate = this.fraudRateForAffiliate(affiliate.id);
      const status = this.affiliateStatus(affiliate.status);
      const org = dbStore.organizations.find((o) => o.id === affiliate.organizationId);

      // Last activity
      const dates: number[] = [new Date(affiliate.updatedAt || affiliate.createdAt).getTime()];
      for (const c of conversions) {
        if (c.createdAt) dates.push(new Date(c.createdAt).getTime());
      }
      for (const comm of commissions) {
        if (comm.createdAt) dates.push(new Date(comm.createdAt).getTime());
      }
      for (const tl of trackingLinks) {
        if (tl.createdAt) dates.push(new Date(tl.createdAt).getTime());
      }
      const maxActivityMs = Math.max(...dates);
      const lastActivityAt = this.relativeTime(new Date(maxActivityMs));
      const daysInactive = Math.floor((Date.now() - maxActivityMs) / (1000 * 60 * 60 * 24));

      // Deterministic attention flags
      const attentionFlags: string[] = [];
      if (status === 'Suspended' || status === 'Rejected') attentionFlags.push(`Partner is ${status}`);
      if (fraudRate > 5) attentionFlags.push(`Elevated Fraud Rate (${fraudRate}%)`);
      if (openFraudReviewsCount > 0) attentionFlags.push(`${openFraudReviewsCount} Pending Fraud Review(s)`);
      if (programLinks.length > 0 && conversions.length === 0) attentionFlags.push('Zero Conversions Recorded');
      if (programLinks.length === 0) attentionFlags.push('No Programs Joined');
      if (daysInactive >= 30 && status === 'Active') attentionFlags.push('Inactive for 30+ Days');

      // Lifecycle Stage
      let lifecycleStage: 'registered' | 'joined_program' | 'active_traffic' | 'generating_conversions' | 'suspended' = 'registered';
      if (status === 'Suspended' || status === 'Rejected') {
        lifecycleStage = 'suspended';
      } else if (conversions.length > 0) {
        lifecycleStage = 'generating_conversions';
      } else if (trackingLinks.length > 0) {
        lifecycleStage = 'active_traffic';
      } else if (programLinks.length > 0) {
        lifecycleStage = 'joined_program';
      }

      return {
        id: affiliate.id,
        organizationId: affiliate.organizationId,
        orgName: org?.name || orgNameById.get(affiliate.organizationId) || 'Unknown Organization',
        orgDomain: this.domainFromWebsite(org?.website),
        name: affiliate.displayName,
        email: affiliate.email,
        channel: affiliate.companyName || affiliate.website || 'Direct partner',
        trustScore: affiliate.trustScore,
        status,
        currency: primaryProgram?.currency || 'USD',
        revenue: this.centsToDollars(conversions.reduce((total, conversion) => total + Number(conversion.amount || 0), 0)),
        commissionEarned: this.centsToDollars(commissions.reduce((total, commission) => total + netCommissionAmount(commission), 0)),
        payoutPaid,
        payoutPending,
        fraudRate,
        openFraudReviewsCount,
        trackingLinksCount: trackingLinks.length,
        programsCount: programLinks.length,
        programs,
        programName: primaryProgram?.name || 'No program',
        payoutMethod: affiliate.payoutMethod || 'Direct Bank Wire',
        joinedDate: this.dateOnly(affiliate.createdAt),
        country: affiliate.country || 'US',
        lastActivityAt,
        attentionFlags,
        lifecycleStage,
        adoption: {
          hasPrograms: programLinks.length > 0,
          hasTracking: trackingLinks.length > 0,
          hasConversions: conversions.length > 0,
          hasCommissions: commissions.length > 0,
          hasPayouts: payoutItems.some((pi) => pi.status === 'COMPLETED'),
        },
      };
    });

    const conversions = dbStore.conversions.map((conversion) => {
      const commission = (commissionsByConversion.get(conversion.id) || [])[0];
      const program = programById.get(conversion.programId);
      const affiliate = conversion.affiliateId ? affiliateById.get(conversion.affiliateId) : undefined;
      const org = orgById.get(conversion.organizationId);

      // Fraud review and attention flags
      const fraudReview = dbStore.fraudReviews.find((review) => review.conversionId === conversion.id);
      const fraudScore = fraudReview?.fraudScore || 0;

      // Attribution details
      const attributionRecord = dbStore.attributions.find(
        (a) => a.id === conversion.resolvedAttributionId || a.clickId === conversion.clickId
      );
      const attributionModel = attributionRecord?.model || program?.attributionModel || 'last_click';
      const attributionStatus = conversion.affiliateId ? 'Attributed' : 'Unattributed';

      // Attention flags
      const attentionFlags: string[] = [];
      const ageInDays = (Date.now() - new Date(conversion.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (conversion.status === ConversionStatus.PENDING && ageInDays > 7) {
        attentionFlags.push('Pending Beyond 7 Days');
      }
      if (!conversion.affiliateId && conversion.status === ConversionStatus.PENDING) {
        attentionFlags.push('Attribution Missing');
      }
      if (fraudScore >= 70 || (fraudReview && String(fraudReview.status).toLowerCase() === 'pending')) {
        attentionFlags.push('High Fraud Risk');
      }
      if (
        (conversion.status === ConversionStatus.REFUNDED || conversion.status === ConversionStatus.CHARGEBACK) &&
        commission &&
        commission.status === ConversionStatus.APPROVED
      ) {
        attentionFlags.push('Commission Reconciliation Required');
      }

      return {
        id: conversion.id,
        orderId: conversion.externalId,
        externalId: conversion.externalId,
        customerExternalId: conversion.customerExternalId,
        organizationId: conversion.organizationId,
        orgName: org?.name || orgNameById.get(conversion.organizationId) || 'Unknown Organization',
        orgDomain: this.domainFromWebsite(org?.website),
        programId: conversion.programId,
        programName: program?.name || 'Unknown Program',
        affiliateId: conversion.affiliateId,
        affiliateName: affiliate?.displayName || (conversion.affiliateId ? 'Unknown Partner' : 'Unattributed'),
        revenue: this.centsToDollars(conversion.amount),
        currency: conversion.currency || program?.currency || 'USD',
        commission: this.centsToDollars(commission?.commissionAmount || 0),
        commissionId: commission?.id,
        commissionStatus: commission ? this.titleCase(commission.status) : 'None',
        refundedAmount: this.centsToDollars(conversion.refundedAmount || 0),
        type: conversion.type || 'PURCHASE',
        status: this.titleCase(conversion.status),
        rawStatus: conversion.status,
        validationStatus: conversion.validationStatus || 'VALID',
        validationNotes: conversion.validationNotes,
        rejectionReason: conversion.rejectionReason,
        source: conversion.source || 'API',
        attribution: this.titleCase(String(attributionModel).replace(/_/g, ' ')),
        attributionModel: String(attributionModel),
        attributionStatus,
        clickId: conversion.clickId || conversion.id,
        fraudScore,
        openFraudReview: Boolean(fraudReview && String(fraudReview.status).toLowerCase() === 'pending'),
        date: this.dateTime(conversion.createdAt),
        occurredAt: conversion.occurredAt ? this.dateTime(conversion.occurredAt) : undefined,
        createdAt: this.dateTime(conversion.createdAt),
        updatedAt: conversion.updatedAt ? this.dateTime(conversion.updatedAt) : undefined,
        attentionFlags,
      };
    });

    const commissions = dbStore.commissions.map((commission) => {
      const program = programById.get(commission.programId);
      const affiliate = affiliateById.get(commission.affiliateId);
      const org = orgById.get(commission.organizationId);
      const conversion = conversionById.get(commission.conversionId);
      const rule = commission.ruleId ? commissionRuleById.get(commission.ruleId) : undefined;
      const payoutItem = commission.payoutItemId ? payoutItemById.get(commission.payoutItemId) : undefined;
      const payoutBatch = payoutItem?.batchId ? dbStore.payoutBatches.find((b) => b.id === payoutItem.batchId) : undefined;

      // Calculate attention flags
      const attentionFlags: string[] = [];
      const ageInDays = (Date.now() - new Date(commission.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (commission.status === ConversionStatus.PENDING && ageInDays > 14) {
        attentionFlags.push('Pending Review > 14 Days');
      }
      if (!conversion) {
        attentionFlags.push('Unlinked Conversion');
      }
      if (
        conversion &&
        (conversion.status === ConversionStatus.REFUNDED || conversion.status === ConversionStatus.CHARGEBACK) &&
        commission.status === ConversionStatus.APPROVED
      ) {
        attentionFlags.push('Reversal Required');
      }
      if (commission.disputeStatus && commission.disputeStatus !== 'NONE') {
        attentionFlags.push(`Disputed: ${commission.disputeStatus}`);
      }
      if (commission.holdUntil && new Date(commission.holdUntil).getTime() > Date.now() && commission.status === ConversionStatus.APPROVED) {
        attentionFlags.push('Hold Period Active');
      }

      // Reconciliation status
      let reconciliationStatus = 'MATCHED';
      if (!conversion) {
        reconciliationStatus = 'UNLINKED_CONVERSION';
      } else if (
        conversion &&
        (conversion.status === ConversionStatus.REFUNDED || conversion.status === ConversionStatus.CHARGEBACK) &&
        commission.status === ConversionStatus.APPROVED
      ) {
        reconciliationStatus = 'REVERSAL_MISMATCH';
      } else if (
        commission.reversedAmount > 0 &&
        commission.reversedAmount !== commission.commissionAmount &&
        commission.status === ConversionStatus.REFUNDED
      ) {
        reconciliationStatus = 'PARTIAL_REVERSAL';
      }

      return {
        id: commission.id,
        organizationId: commission.organizationId,
        orgName: org?.name || orgNameById.get(commission.organizationId) || 'Unknown Organization',
        orgDomain: this.domainFromWebsite(org?.website),
        conversionId: commission.conversionId,
        externalOrderId: conversion?.externalId || 'Unknown Order',
        customerExternalId: conversion?.customerExternalId,
        programId: commission.programId,
        programName: program?.name || 'Unknown Program',
        affiliateId: commission.affiliateId,
        affiliateName: affiliate?.displayName || 'Unknown Affiliate',
        affiliateEmail: affiliate?.email,
        currency: conversion?.currency || program?.currency || 'USD',
        baseAmount: this.centsToDollars(commission.baseAmount),
        revenue: this.centsToDollars(commission.baseAmount),
        commissionAmount: this.centsToDollars(commission.commissionAmount),
        amount: this.centsToDollars(commission.commissionAmount),
        reversedAmount: this.centsToDollars(commission.reversedAmount || 0),
        netAmount: this.centsToDollars(Math.max(0, (commission.commissionAmount || 0) - (commission.reversedAmount || 0))),
        rate: typeof commission.rate === 'number' ? `${(commission.rate / 100).toFixed(2)}%` : '0%',
        rawRate: commission.rate,
        rateType: rule?.commissionType || program?.commissionType || 'PERCENTAGE',
        status: this.titleCase(commission.status),
        rawStatus: commission.status,
        approvalStatus: commission.approvalStatus || (commission.status === ConversionStatus.APPROVED ? 'APPROVED' : commission.status === ConversionStatus.REJECTED ? 'REJECTED' : 'PENDING'),
        approvedAt: commission.approvedAt ? this.dateTime(commission.approvedAt) : undefined,
        approvedBy: commission.approvedBy,
        payoutStatus: commission.payoutStatus || (commission.status === ConversionStatus.APPROVED ? 'ELIGIBLE' : 'NOT_READY'),
        payoutItemId: commission.payoutItemId,
        payoutBatchId: payoutBatch?.id,
        ruleId: commission.ruleId,
        rule: commission.ruleSnapshot?.ruleName || rule?.name || 'Default Program Rate',
        ruleSnapshot: commission.ruleSnapshot,
        calculationVersion: commission.calculationVersion || 'v1',
        disputeStatus: commission.disputeStatus || 'NONE',
        disputeReason: commission.disputeReason,
        adjustmentHistory: commission.adjustmentHistory || [],
        holdUntil: commission.holdUntil ? this.dateTime(commission.holdUntil) : undefined,
        riskScore: commission.riskScore || 0,
        created: this.dateTime(commission.createdAt),
        createdAt: this.dateTime(commission.createdAt),
        updatedAt: commission.updatedAt ? this.dateTime(commission.updatedAt) : undefined,
        attentionFlags,
        reconciliationStatus,
      };
    });

    const fraudReviews = dbStore.fraudReviews.map((review) => {
      const conversion = dbStore.conversions.find((item) => item.id === review.conversionId);
      const affiliate = conversion?.affiliateId ? affiliateById.get(conversion.affiliateId) : undefined;

      return {
        id: review.id,
        riskLevel: this.riskLevel(review.fraudScore),
        conversionId: conversion?.externalId || review.conversionId,
        orgName: orgNameById.get(review.organizationId) || 'Unknown Organization',
        affiliateName: affiliate?.displayName || 'Unassigned',
        amount: this.centsToDollars(conversion?.amount || 0),
        fraudScore: review.fraudScore,
        confidence: review.confidence || 0,
        decision: review.reviewDecision || 'REVIEW',
        assessmentId: review.assessmentId,
        signals: (review.signals || []).map((signal: any) => String(signal.code || signal.reason || signal.type || signal)),
        age: this.relativeTime(review.createdAt),
        status: review.status === 'APPROVED' ? 'cleared' : review.status === 'REJECTED' ? 'blocked' : 'pending',
        ip: 'n/a',
        country: affiliate?.country || 'n/a',
      };
    });

    const payoutBatches = dbStore.payoutBatches.map((batch) => ({
      id: batch.id,
      batchId: batch.id,
      organizationId: batch.organizationId,
      orgName: orgNameById.get(batch.organizationId) || 'Unknown Organization',
      period: `${this.dateOnly(batch.createdAt)} payout`,
      affiliatesCount: new Set((payoutsByBatch.get(batch.id) || []).map((item) => item.affiliateId)).size,
      amount: this.centsToDollars(batch.totalAmount),
      totalAmountRaw: batch.totalAmount,
      currency: batch.currency || 'USD',
      gateway: batch.gateway || 'Direct Bank Wire',
      provider: batch.gateway || 'Direct Bank Wire',
      status: this.payoutStatus(batch.status),
      rawStatus: batch.status,
      created: this.dateTime(batch.createdAt),
      processed: batch.status === PayoutStatus.COMPLETED ? this.dateTime(batch.updatedAt) : 'Pending',
    }));

    const payoutItems = dbStore.payoutItems.map((item) => {
      const aff = affiliateById.get(item.affiliateId);
      const batch = dbStore.payoutBatches.find((b) => b.id === item.batchId);
      const primaryLink = dbStore.programAffiliates.find((pa) => pa.affiliateId === item.affiliateId);
      const program = primaryLink ? programById.get(primaryLink.programId) : undefined;
      const commissions = dbStore.commissions.filter((c) => c.payoutItemId === item.id);

      return {
        id: item.id,
        batchId: item.batchId,
        organizationId: item.organizationId,
        orgName: orgNameById.get(item.organizationId) || 'Unknown Organization',
        affiliateId: item.affiliateId,
        affiliateName: aff?.displayName || aff?.companyName || 'Affiliate Partner',
        affiliateEmail: aff?.email || 'partner@affiliate.io',
        programId: program?.id,
        programName: program?.name || 'Primary Program',
        amount: this.centsToDollars(item.amount),
        amountCents: item.amount,
        currency: item.currency || batch?.currency || 'USD',
        status: item.status,
        gateway: item.gateway || batch?.gateway || 'Direct Bank Wire',
        provider: item.gateway || batch?.gateway || 'Direct Bank Wire',
        disbursementAccount: item.disbursementAccount || '••••4100',
        providerReference: item.providerReference || `pout_ref_${item.id.slice(0, 8)}`,
        failureReason: item.failureReason,
        retryCount: item.retryCount || 0,
        lastRetryAt: item.lastRetryAt ? this.dateTime(item.lastRetryAt) : undefined,
        idempotencyKey: item.idempotencyKey,
        beneficiaryName: item.beneficiaryName || aff?.displayName,
        payoutMethod: item.payoutMethod || aff?.payoutMethod || 'BANK_ACCOUNT',
        reconciliationStatus: item.reconciliationStatus || 'MATCHED',
        reconciledAt: item.reconciledAt ? this.dateTime(item.reconciledAt) : undefined,
        commissionsCount: commissions.length || 1,
        createdAt: this.dateTime(item.createdAt),
        processedAt: item.status === PayoutStatus.COMPLETED ? this.dateTime(item.createdAt) : undefined,
      };
    });

    const auditLogs = dbStore.auditLogs.map((log) => ({
      id: log.id,
      time: this.dateTime(log.createdAt),
      actor: userById.get(log.actorId)?.email || log.actorId,
      orgName: log.organizationId ? orgNameById.get(log.organizationId) || 'Unknown Organization' : 'PartnerIQ Platform',
      action: log.action,
      resource: log.resourceId,
      ip: log.ipAddress || 'n/a',
      requestId: log.id,
      metadata: log.metadata || {},
    }));

    const webhooks = dbStore.webhookDeliveries.map((delivery) => {
      const endpoint = dbStore.webhookEndpoints.find((item) => item.id === delivery.endpointId);
      return {
        id: delivery.id,
        deliveryId: delivery.eventId,
        orgName: endpoint ? orgNameById.get(endpoint.organizationId) || 'Unknown Organization' : 'Unknown Organization',
        endpoint: endpoint?.url || 'Unknown endpoint',
        event: delivery.eventId,
        httpStatus: delivery.responseCode,
        attempts: delivery.attempt,
        durationMs: delivery.durationMs,
        timestamp: this.dateTime(delivery.createdAt),
        payload: typeof delivery.requestBody === 'string' ? delivery.requestBody : JSON.stringify(delivery.requestBody, null, 2),
        response: delivery.responseBodyTruncated || '',
      };
    });

    return {
      adminUser: {
        id: user.userId,
        name: user.email,
        email: user.email,
        role: 'SUPER_ADMIN',
        lastLogin: 'Just now',
      },
      organizations,
      programs,
      affiliates,
      conversions,
      commissions,
      fraudReviews,
      payoutBatches,
      payoutItems,
      auditLogs,
      webhooks,
      integrations: this.getIntegrations(),
      integrationMetrics: this.getIntegrationMetrics(),
      systemComponents: await this.getSystemComponents(),
      queueJobs: this.getQueueJobs(),
      securityEvents: this.getSecurityEvents(),
      platformAnalytics: this.computePlatformAnalytics(query, orgNameById, userById),
    };
  }

  private computePlatformAnalytics(
    query?: AdminOverviewQueryDto,
    orgNameById?: Map<string, string>,
    userById?: Map<string, any>,
  ) {
    const rawPeriod = (query?.period || '30d').toLowerCase();
    const orgFilter = query?.organizationId && query.organizationId !== 'ALL' ? query.organizationId : null;

    const now = new Date();
    let periodMs = 30 * 24 * 60 * 60 * 1000;
    if (rawPeriod === 'today') periodMs = 24 * 60 * 60 * 1000;
    else if (rawPeriod === '7d' || rawPeriod === '7 days') periodMs = 7 * 24 * 60 * 60 * 1000;
    else if (rawPeriod === '30d' || rawPeriod === '30 days') periodMs = 30 * 24 * 60 * 60 * 1000;
    else if (rawPeriod === '90d' || rawPeriod === '90 days') periodMs = 90 * 24 * 60 * 60 * 1000;
    else if (rawPeriod === '1y' || rawPeriod === '1 year') periodMs = 365 * 24 * 60 * 60 * 1000;
    else if (rawPeriod === 'all' || rawPeriod === 'all time') periodMs = 5 * 365 * 24 * 60 * 60 * 1000;

    const currentPeriodStart = new Date(now.getTime() - periodMs);
    const priorPeriodStart = new Date(now.getTime() - 2 * periodMs);

    // Filter candidate collections by orgFilter if specified
    const orgs = dbStore.organizations.filter((o) => !o.deletedAt && (!orgFilter || o.id === orgFilter));
    const programs = dbStore.programs.filter((p) => !p.deletedAt && (!orgFilter || p.organizationId === orgFilter));
    const affiliates = dbStore.affiliates.filter((a) => !orgFilter || a.organizationId === orgFilter);
    const conversions = dbStore.conversions.filter((c) => !orgFilter || c.organizationId === orgFilter);
    const commissions = dbStore.commissions.filter((c) => !orgFilter || c.organizationId === orgFilter);
    const subscriptions = dbStore.billingSubscriptions.filter((s) => !orgFilter || s.organizationId === orgFilter);
    const payments = dbStore.billingPayments.filter((p) => !orgFilter || p.organizationId === orgFilter);
    const trackingLinks = dbStore.trackingLinks.filter((l) => !orgFilter || l.organizationId === orgFilter);
    const trials = dbStore.organizationTrials.filter((t) => !orgFilter || t.organizationId === orgFilter);

    // 1. KPIs
    const totalOrganizations = orgs.length;
    const newOrgsInPeriod = orgs.filter((o) => new Date(o.createdAt) >= currentPeriodStart).length;
    const newOrgsInPrior = orgs.filter((o) => {
      const d = new Date(o.createdAt);
      return d >= priorPeriodStart && d < currentPeriodStart;
    }).length;
    const newOrgsChangePct = newOrgsInPrior > 0
      ? Math.round(((newOrgsInPeriod - newOrgsInPrior) / newOrgsInPrior) * 1000) / 10
      : null;

    const activeOrgs = orgs.filter((o) => o.status === 'ACTIVE').length;

    const payingOrgs = new Set(
      subscriptions
        .filter((s) => s.status === 'ACTIVE' && s.rowStatus === 'ACTIVE')
        .map((s) => s.organizationId),
    ).size;

    const trialOrgs = trials.filter((t) => !t.trialUsed).length;

    const completedPayments = payments.filter(
      (p) => p.status === 'SUCCESS' || p.status === 'COMPLETED' || p.status === 'PAID',
    );
    const platformRevInPeriod = completedPayments
      .filter((p) => new Date(p.createdDate || p.paidAt || 0) >= currentPeriodStart)
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const platformRevInPrior = completedPayments
      .filter((p) => {
        const d = new Date(p.createdDate || p.paidAt || 0);
        return d >= priorPeriodStart && d < currentPeriodStart;
      })
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const platformRevChangePct = platformRevInPrior > 0
      ? Math.round(((platformRevInPeriod - platformRevInPrior) / platformRevInPrior) * 1000) / 10
      : null;

    let mrrInCents = 0;
    for (const sub of subscriptions.filter((s) => s.status === 'ACTIVE' && s.rowStatus === 'ACTIVE')) {
      const plan = dbStore.billingPlans.find((p) => p.id === sub.planId);
      if (plan && plan.price > 0) {
        if (sub.billingInterval === 'YEARLY' || plan.billingInterval === 'YEARLY') {
          mrrInCents += Math.round(plan.price / 12);
        } else {
          mrrInCents += plan.price;
        }
      }
    }
    const mrrDollars = Math.round(mrrInCents / 100);
    const arrDollars = mrrDollars * 12;

    const convsInPeriod = conversions.filter((c) => new Date(c.createdAt) >= currentPeriodStart);
    const convsInPrior = conversions.filter((c) => {
      const d = new Date(c.createdAt);
      return d >= priorPeriodStart && d < currentPeriodStart;
    });
    const ecosystemAttributedRevInPeriod = convsInPeriod.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const ecosystemAttributedRevInPrior = convsInPrior.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const ecosystemRevChangePct = ecosystemAttributedRevInPrior > 0
      ? Math.round(((ecosystemAttributedRevInPeriod - ecosystemAttributedRevInPrior) / ecosystemAttributedRevInPrior) * 1000) / 10
      : null;

    const commsInPeriod = commissions.filter((c) => new Date(c.createdAt) >= currentPeriodStart);
    const ecosystemCommissionsInPeriod = commsInPeriod.reduce((sum, c) => sum + netCommissionAmount(c), 0);

    const totalAffiliates = affiliates.length;
    const activeAffiliateIds = new Set([
      ...convsInPeriod.map((c) => c.affiliateId).filter(Boolean),
      ...affiliates.filter((a) => a.status === 'ACTIVE').map((a) => a.id),
    ]);
    const activeAffiliatesCount = activeAffiliateIds.size;

    const targetOrgIds = new Set(orgs.map((o) => o.id));
    const activeUserCount = new Set(
      dbStore.organizationMemberships
        .filter((m) => targetOrgIds.has(m.organizationId))
        .map((m) => m.userId),
    ).size;

    const failedWebhooks = dbStore.webhookDeliveries.filter((d) => d.responseCode >= 400).length;
    const lockedUsersCount = dbStore.users.filter((u) => u.status === 'LOCKED').length;
    const suspendedTenantsCount = dbStore.organizations.filter((o) => o.status === 'SUSPENDED').length;
    const pendingFraudReviewsCount = dbStore.fraudReviews.filter((r) => r.status === 'PENDING').length;
    const systemHealthScore = AppDataSource.isInitialized ? 99.8 : 85.0;

    // 2. Growth Series
    const pointsCount = rawPeriod === 'today' ? 12 : rawPeriod === '7d' ? 7 : rawPeriod === '30d' ? 15 : 12;
    const bucketDurationMs = periodMs / pointsCount;
    const growthSeries = [];
    for (let i = 0; i < pointsCount; i++) {
      const bStart = new Date(currentPeriodStart.getTime() + i * bucketDurationMs);
      const bEnd = new Date(currentPeriodStart.getTime() + (i + 1) * bucketDurationMs);
      const dateLabel = rawPeriod === 'today'
        ? bStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : bStart.toLocaleDateString([], { month: 'short', day: 'numeric' });

      const orgsUpToBucket = orgs.filter((o) => new Date(o.createdAt) <= bEnd).length;
      const newOrgsInBucket = orgs.filter((o) => {
        const d = new Date(o.createdAt);
        return d >= bStart && d < bEnd;
      }).length;
      const convsInBucket = conversions.filter((c) => {
        const d = new Date(c.createdAt);
        return d >= bStart && d < bEnd;
      });
      const convRevInBucket = convsInBucket.reduce((sum, c) => sum + Number(c.amount || 0), 0);
      const payInBucket = completedPayments.filter((p) => {
        const d = new Date(p.createdDate || p.paidAt || 0);
        return d >= bStart && d < bEnd;
      });
      const payRevInBucket = payInBucket.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      growthSeries.push({
        date: bStart.toISOString(),
        label: dateLabel,
        organizations: orgsUpToBucket,
        newOrgs: newOrgsInBucket,
        payingOrgs: Math.min(payingOrgs, orgsUpToBucket),
        conversions: convsInBucket.length,
        attributedRevenue: Math.round(convRevInBucket / 100),
        platformRevenue: Math.round(payRevInBucket / 100),
      });
    }

    // 3. Customer Lifecycle Distribution
    const lifecycleDistribution = [
      {
        status: 'Active',
        label: 'Active Paid',
        count: payingOrgs,
        percentage: totalOrganizations > 0 ? Math.round((payingOrgs / totalOrganizations) * 100) : 0,
        color: 'hsl(var(--chart-1))',
      },
      {
        status: 'Trial',
        label: 'In Trial',
        count: trialOrgs,
        percentage: totalOrganizations > 0 ? Math.round((trialOrgs / totalOrganizations) * 100) : 0,
        color: 'hsl(var(--chart-2))',
      },
      {
        status: 'Starter',
        label: 'Free / Starter',
        count: Math.max(0, totalOrganizations - payingOrgs - trialOrgs - suspendedTenantsCount),
        percentage:
          totalOrganizations > 0
            ? Math.round(
              (Math.max(0, totalOrganizations - payingOrgs - trialOrgs - suspendedTenantsCount) /
                totalOrganizations) *
              100,
            )
            : 0,
        color: 'hsl(var(--chart-3))',
      },
      {
        status: 'Suspended',
        label: 'Suspended',
        count: suspendedTenantsCount,
        percentage: totalOrganizations > 0 ? Math.round((suspendedTenantsCount / totalOrganizations) * 100) : 0,
        color: 'hsl(var(--destructive))',
      },
    ];

    // 4. Plan Distribution
    const planCounts: Record<string, { name: string; count: number; mrr: number }> = {};
    for (const plan of dbStore.billingPlans) {
      planCounts[plan.id] = { name: plan.name, count: 0, mrr: 0 };
    }
    for (const sub of subscriptions.filter((s) => s.rowStatus === 'ACTIVE')) {
      if (planCounts[sub.planId]) {
        planCounts[sub.planId].count++;
        const plan = dbStore.billingPlans.find((p) => p.id === sub.planId);
        if (plan && sub.status === 'ACTIVE') {
          planCounts[sub.planId].mrr += Math.round(plan.price / 100);
        }
      }
    }
    const planDistribution = Object.entries(planCounts).map(([planId, data]) => ({
      planId,
      planName: data.name,
      count: data.count,
      mrr: data.mrr,
      currency: 'INR',
    }));

    if (planDistribution.every((p) => p.count === 0) && totalOrganizations > 0) {
      planDistribution.push(
        { planId: 'starter', planName: 'Starter', count: Math.max(1, totalOrganizations - payingOrgs), mrr: 0, currency: 'INR' },
        { planId: 'growth', planName: 'Growth', count: payingOrgs, mrr: mrrDollars, currency: 'INR' },
      );
    }

    // 5. Product Adoption & Feature Engagement
    const eligibleCount = Math.max(1, totalOrganizations);
    const orgsWithPrograms = new Set(programs.map((p) => p.organizationId)).size;
    const orgsWithAffiliates = new Set(affiliates.map((a) => a.organizationId)).size;
    const orgsWithLinks = new Set(trackingLinks.map((l) => l.organizationId)).size;
    const orgsWithConversions = new Set(conversions.map((c) => c.organizationId)).size;
    const orgsWithCommissions = new Set(commissions.map((c) => c.organizationId)).size;
    const orgsWithPayouts = new Set(
      dbStore.payoutBatches.filter((b) => !orgFilter || b.organizationId === orgFilter).map((b) => b.organizationId),
    ).size;
    const orgsWithIntegrations = new Set(
      dbStore.organizationIntegrations
        .filter((i) => !orgFilter || i.organizationId === orgFilter)
        .map((i) => i.organizationId),
    ).size;
    const orgsWithDeals = new Set(
      dbStore.partnerDeals.filter((d) => !orgFilter || d.organizationId === orgFilter).map((d) => d.organizationId),
    ).size;

    const productAdoption = [
      {
        module: 'programs',
        label: 'Referral Programs',
        orgsUsing: orgsWithPrograms,
        totalEligibleOrgs: eligibleCount,
        adoptionPercent: Math.round((orgsWithPrograms / eligibleCount) * 100),
      },
      {
        module: 'tracking_links',
        label: 'Tracking Links',
        orgsUsing: orgsWithLinks,
        totalEligibleOrgs: eligibleCount,
        adoptionPercent: Math.round((orgsWithLinks / eligibleCount) * 100),
      },
      {
        module: 'affiliates',
        label: 'Partner Network',
        orgsUsing: orgsWithAffiliates,
        totalEligibleOrgs: eligibleCount,
        adoptionPercent: Math.round((orgsWithAffiliates / eligibleCount) * 100),
      },
      {
        module: 'conversions',
        label: 'Attributed Conversions',
        orgsUsing: orgsWithConversions,
        totalEligibleOrgs: eligibleCount,
        adoptionPercent: Math.round((orgsWithConversions / eligibleCount) * 100),
      },
      {
        module: 'commissions',
        label: 'Commission Engine',
        orgsUsing: orgsWithCommissions,
        totalEligibleOrgs: eligibleCount,
        adoptionPercent: Math.round((orgsWithCommissions / eligibleCount) * 100),
      },
      {
        module: 'payouts',
        label: 'Automated Payouts',
        orgsUsing: orgsWithPayouts,
        totalEligibleOrgs: eligibleCount,
        adoptionPercent: Math.round((orgsWithPayouts / eligibleCount) * 100),
      },
      {
        module: 'integrations',
        label: 'Ecosystem Integrations',
        orgsUsing: orgsWithIntegrations,
        totalEligibleOrgs: eligibleCount,
        adoptionPercent: Math.round((orgsWithIntegrations / eligibleCount) * 100),
      },
      {
        module: 'deals',
        label: 'Co-Selling & Deals',
        orgsUsing: orgsWithDeals,
        totalEligibleOrgs: eligibleCount,
        adoptionPercent: Math.round((orgsWithDeals / eligibleCount) * 100),
      },
    ];

    // 6. Activation Funnel
    const stage1 = eligibleCount;
    const stage2 = orgsWithPrograms;
    const stage3 = orgsWithAffiliates;
    const stage4 = orgsWithLinks;
    const stage5 = orgsWithConversions;
    const stage6 = orgsWithCommissions;

    const activationFunnel = [
      {
        stage: 'ORG_CREATED',
        label: 'Organization Created',
        count: stage1,
        conversionRateFromPrevious: 100,
        conversionRateFromStart: 100,
      },
      {
        stage: 'PROGRAM_CREATED',
        label: 'Program Launched',
        count: stage2,
        conversionRateFromPrevious: stage1 > 0 ? Math.round((stage2 / stage1) * 100) : 0,
        conversionRateFromStart: stage1 > 0 ? Math.round((stage2 / stage1) * 100) : 0,
      },
      {
        stage: 'AFFILIATE_ADDED',
        label: 'First Partner Enrolled',
        count: stage3,
        conversionRateFromPrevious: stage2 > 0 ? Math.round((stage3 / stage2) * 100) : 0,
        conversionRateFromStart: stage1 > 0 ? Math.round((stage3 / stage1) * 100) : 0,
      },
      {
        stage: 'LINK_GENERATED',
        label: 'Tracking Link Generated',
        count: stage4,
        conversionRateFromPrevious: stage3 > 0 ? Math.round((stage4 / stage3) * 100) : 0,
        conversionRateFromStart: stage1 > 0 ? Math.round((stage4 / stage1) * 100) : 0,
      },
      {
        stage: 'CONVERSION_RECORDED',
        label: 'First Conversion Recorded',
        count: stage5,
        conversionRateFromPrevious: stage4 > 0 ? Math.round((stage5 / stage4) * 100) : 0,
        conversionRateFromStart: stage1 > 0 ? Math.round((stage5 / stage1) * 100) : 0,
      },
      {
        stage: 'COMMISSION_ISSUED',
        label: 'First Commission Issued',
        count: stage6,
        conversionRateFromPrevious: stage5 > 0 ? Math.round((stage6 / stage5) * 100) : 0,
        conversionRateFromStart: stage1 > 0 ? Math.round((stage6 / stage1) * 100) : 0,
      },
    ];

    // 7. Attention Required
    const attentionItems = [];
    if (failedWebhooks > 0) {
      attentionItems.push({
        id: 'att_webhook_failures',
        severity: 'HIGH',
        title: 'Webhook Deliveries Failing',
        description: `${failedWebhooks} webhook events failed HTTP dispatch with status >= 400.`,
        count: failedWebhooks,
        actionLink: 'admin-webhooks',
        actionLabel: 'Inspect Webhooks',
      });
    }
    if (pendingFraudReviewsCount > 0) {
      attentionItems.push({
        id: 'att_fraud_reviews',
        severity: 'HIGH',
        title: 'Fraud Reviews Pending Triage',
        description: `${pendingFraudReviewsCount} conversions flagged by security heuristics require super admin review.`,
        count: pendingFraudReviewsCount,
        actionLink: 'admin-fraud',
        actionLabel: 'Review Fraud Queue',
      });
    }
    if (lockedUsersCount > 0) {
      attentionItems.push({
        id: 'att_locked_users',
        severity: 'MEDIUM',
        title: 'Locked User Accounts',
        description: `${lockedUsersCount} user account(s) locked due to authentication policy enforcement.`,
        count: lockedUsersCount,
        actionLink: 'admin-security',
        actionLabel: 'Security Center',
      });
    }
    if (suspendedTenantsCount > 0) {
      attentionItems.push({
        id: 'att_suspended_tenants',
        severity: 'MEDIUM',
        title: 'Suspended Organizations',
        description: `${suspendedTenantsCount} organization(s) suspended from executing platform operations.`,
        count: suspendedTenantsCount,
        actionLink: 'admin-organizations',
        actionLabel: 'Manage Organizations',
      });
    }

    // 8. Explainable Deterministic Insights
    const insights = [
      {
        id: 'ins_tenant_velocity',
        category: 'GROWTH',
        title: 'Organization Onboarding Velocity',
        description: `${newOrgsInPeriod} new organization(s) joined in the selected period${newOrgsChangePct !== null ? ` (${newOrgsChangePct >= 0 ? '+' : ''}${newOrgsChangePct}% vs prior period)` : ''
          }. Total tenant portfolio now stands at ${totalOrganizations}.`,
        metric: `${newOrgsInPeriod} new orgs`,
        currentValue: newOrgsInPeriod,
        baselineValue: newOrgsInPrior,
        changePercent: newOrgsChangePct,
        explainability:
          'Calculated by comparing organization creation timestamps in current period vs prior period of identical length.',
      },
      {
        id: 'ins_ecosystem_gmv',
        category: 'ECOSYSTEM',
        title: 'Partner Ecosystem GMV Tracked',
        description: `Platform tracked ₹${Math.round(
          ecosystemAttributedRevInPeriod / 100,
        ).toLocaleString()} in referred partner sales and distributed ₹${Math.round(
          ecosystemCommissionsInPeriod / 100,
        ).toLocaleString()} in affiliate earnings across all tenants.`,
        metric: `₹${Math.round(ecosystemAttributedRevInPeriod / 100).toLocaleString()}`,
        currentValue: Math.round(ecosystemAttributedRevInPeriod / 100),
        baselineValue: Math.round(ecosystemAttributedRevInPrior / 100),
        changePercent: ecosystemRevChangePct,
        explainability:
          'Aggregated directly from all validated conversion transaction amounts and ledger-approved commission records.',
      },
      {
        id: 'ins_product_adoption',
        category: 'ADOPTION',
        title: 'Feature Penetration Milestone',
        description: `Referral Programs are activated by ${Math.round(
          (orgsWithPrograms / eligibleCount) * 100,
        )}% of tenants, while Tracking Links are deployed by ${Math.round(
          (orgsWithLinks / eligibleCount) * 100,
        )}% of active organizations.`,
        metric: `${Math.round((orgsWithPrograms / eligibleCount) * 100)}% Programs`,
        currentValue: Math.round((orgsWithPrograms / eligibleCount) * 100),
        baselineValue: 0,
        changePercent: null,
        explainability:
          'Measured by dividing the count of organizations possessing >= 1 active entity by total eligible non-deleted tenants.',
      },
    ];

    // 9. Recent Signups
    const recentSignups = [...orgs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6)
      .map((org) => {
        const ownerMembership = dbStore.organizationMemberships.find(
          (m) => m.organizationId === org.id && m.role === 'OWNER',
        );
        const owner = ownerMembership && userById ? userById.get(ownerMembership.userId) : undefined;
        const sub = dbStore.billingSubscriptions.find((s) => s.organizationId === org.id && s.rowStatus === 'ACTIVE');
        const plan = sub ? dbStore.billingPlans.find((p) => p.id === sub.planId) : undefined;
        const isTrial = dbStore.organizationTrials.some((t) => t.organizationId === org.id && !t.trialUsed);
        const planName = plan?.name || (isTrial ? 'Trial' : 'Starter');

        const orgProgs = programs.filter((p) => p.organizationId === org.id);
        const orgAffs = affiliates.filter((a) => a.organizationId === org.id);

        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          plan: planName,
          status: org.status,
          ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'System Admin',
          ownerEmail: owner?.email || 'admin@partneriq.in',
          createdAt: org.createdAt,
          programsCount: orgProgs.length,
          affiliatesCount: orgAffs.length,
        };
      });

    return {
      kpis: {
        totalOrganizations,
        newOrganizations: newOrgsInPeriod,
        newOrganizationsChangePct: newOrgsChangePct,
        activeOrganizations: activeOrgs,
        payingOrganizations: payingOrgs,
        trialOrganizations: trialOrgs,
        platformRevenue: Math.round(platformRevInPeriod / 100),
        platformRevenueChangePct: platformRevChangePct,
        platformRevenueCurrency: 'INR',
        mrr: mrrDollars,
        arr: arrDollars,
        activeUsers: activeUserCount,
        totalAffiliates,
        activeAffiliates: activeAffiliatesCount,
        ecosystemAttributedRevenue: Math.round(ecosystemAttributedRevInPeriod / 100),
        ecosystemRevenueChangePct: ecosystemRevChangePct,
        ecosystemCommissions: Math.round(ecosystemCommissionsInPeriod / 100),
        systemHealthScore,
      },
      growthSeries,
      lifecycleDistribution,
      planDistribution,
      productAdoption,
      activationFunnel,
      attentionItems,
      insights,
      recentSignups,
      period: rawPeriod,
      organizationFilter: orgFilter,
      calculatedAt: now.toISOString(),
    };
  }

  private getSecurityEvents() {
    const securityEvents = [];

    for (const lockedUser of dbStore.users.filter((user) => user.status === 'LOCKED')) {
      securityEvents.push({
        id: `sec_user_${lockedUser.id}`,
        severity: 'High',
        event: 'USER_ACCOUNT_LOCKED',
        actor: lockedUser.email,
        orgName: 'PartnerIQ Platform',
        ip: 'n/a',
        time: this.relativeTime(lockedUser.lockedUntil || lockedUser.updatedAt),
        status: 'Locked',
        details: 'User account is locked after authentication policy enforcement.',
      });
    }

    for (const session of dbStore.authSessions.filter((item) => item.revokedAt)) {
      const sessionUser = dbStore.users.find((user) => user.id === session.userId);
      securityEvents.push({
        id: `sec_session_${session.id}`,
        severity: 'Medium',
        event: 'SESSION_REVOKED',
        actor: sessionUser?.email || session.userId,
        orgName: 'PartnerIQ Platform',
        ip: session.ipAddress || 'n/a',
        time: this.relativeTime(session.revokedAt),
        status: 'Revoked',
        details: 'Authentication session refresh token family was revoked.',
      });
    }

    for (const org of dbStore.organizations.filter((item) => item.status === 'SUSPENDED' || item.status === 'CLOSED')) {
      securityEvents.push({
        id: `sec_org_${org.id}`,
        severity: org.status === 'SUSPENDED' ? 'High' : 'Medium',
        event: 'TENANT_ACCESS_RESTRICTED',
        actor: dbStore.users.find((user) => user.id === org.createdBy)?.email || org.createdBy,
        orgName: org.name,
        ip: 'n/a',
        time: this.relativeTime(org.updatedAt),
        status: org.status,
        details: `Organization status is ${String(org.status).toLowerCase()}, so protected tenant actions are restricted.`,
      });
    }

    for (const apiKey of dbStore.apiKeys.filter((key) => key.revokedAt)) {
      const orgName = dbStore.organizations.find((org) => org.id === apiKey.organizationId)?.name || 'Unknown Organization';
      securityEvents.push({
        id: `sec_api_key_${apiKey.id}`,
        severity: 'Medium',
        event: 'API_KEY_REVOKED',
        actor: dbStore.users.find((user) => user.id === apiKey.createdBy)?.email || apiKey.createdBy,
        orgName,
        ip: 'n/a',
        time: this.relativeTime(apiKey.revokedAt),
        status: 'Revoked',
        details: `API key ${apiKey.prefix} was revoked and can no longer access tenant APIs.`,
      });
    }

    for (const delivery of dbStore.webhookDeliveries.filter((item) => item.responseCode >= 400)) {
      const endpoint = dbStore.webhookEndpoints.find((item) => item.id === delivery.endpointId);
      const orgName = endpoint
        ? dbStore.organizations.find((org) => org.id === endpoint.organizationId)?.name || 'Unknown Organization'
        : 'Unknown Organization';
      securityEvents.push({
        id: `sec_webhook_${delivery.id}`,
        severity: delivery.responseCode >= 500 ? 'High' : 'Medium',
        event: 'WEBHOOK_DELIVERY_FAILURE',
        actor: endpoint?.url || delivery.endpointId,
        orgName,
        ip: 'n/a',
        time: this.relativeTime(delivery.createdAt),
        status: String(delivery.responseCode),
        details: delivery.responseBodyTruncated || 'Webhook delivery returned a non-success response.',
      });
    }

    return securityEvents.sort((a, b) => a.time.localeCompare(b.time));
  }

  private getIntegrations() {
    const today = new Date().toISOString().slice(0, 10);
    return [...dbStore.integrations]
      .filter((integration) => integration.status !== IntegrationStatus.DISABLED && (integration.status as any) !== 'DISABLED')
      .sort((a, b) => (a.displayOrder || 100) - (b.displayOrder || 100) || a.name.localeCompare(b.name))
      .map((integration) => {
        const connections = dbStore.organizationIntegrations.filter((item) => item.integrationId === integration.id);
        const events = dbStore.integrationEvents.filter((item) => item.integrationId === integration.id);
        const processed = events.filter((event) => event.status === IntegrationEventStatus.PROCESSED).length;
        const failed = events.filter((event) => event.status === IntegrationEventStatus.FAILED).length;
        const total = processed + failed;
        const successRate = total === 0 ? 100 : Math.round((processed / total) * 1000) / 10;

        return {
          id: integration.id,
          code: integration.code,
          name: integration.name,
          slug: integration.slug,
          description: integration.description,
          category: integration.category,
          provider: integration.provider,
          status: integration.status,
          logo: integration.logo || `/integrations/${integration.slug}.svg`,
          capabilities: integration.capabilities || [],
          connectionTypes: integration.connectionTypes || [],
          supportsOAuth: integration.supportsOAuth,
          supportsWebhooks: integration.supportsWebhooks,
          supportsApiKey: integration.supportsApiKey,
          documentationUrl: integration.documentationUrl,
          iconKey: integration.iconKey,
          displayOrder: integration.displayOrder,
          connectedOrganizations: connections.length,
          healthyConnections: connections.filter((item) => item.status === OrganizationIntegrationStatus.CONNECTED).length,
          degradedConnections: connections.filter((item) => item.status === OrganizationIntegrationStatus.REAUTH_REQUIRED || item.status === OrganizationIntegrationStatus.PENDING).length,
          failedConnections: connections.filter((item) => item.status === OrganizationIntegrationStatus.ERROR).length,
          eventsToday: events.filter((event) => new Date(event.createdAt).toISOString().slice(0, 10) === today).length,
          successRate,
          avgProcessingMs: events.length === 0 ? 0 : Math.round(events.reduce((sum, event) => sum + Number(event.processingMs || 0), 0) / events.length),
          webhookSuccessRate: successRate,
        };
      });
  }

  private getIntegrationMetrics() {
    const integrations = this.getIntegrations();
    return {
      totalIntegrations: integrations.length,
      activeIntegrations: integrations.filter((item) => item.status === IntegrationStatus.ACTIVE).length,
      betaIntegrations: integrations.filter((item) => item.status === IntegrationStatus.BETA).length,
      comingSoonIntegrations: integrations.filter((item) => item.status === IntegrationStatus.COMING_SOON).length,
      connectedOrganizations: integrations.reduce((total, item) => total + item.connectedOrganizations, 0),
      healthyConnections: integrations.reduce((total, item) => total + item.healthyConnections, 0),
      degradedConnections: integrations.reduce((total, item) => total + item.degradedConnections, 0),
      failedConnections: integrations.reduce((total, item) => total + item.failedConnections, 0),
      eventsToday: integrations.reduce((total, item) => total + item.eventsToday, 0),
    };
  }

  private async getSystemComponents() {
    const [databaseHealth, redisHealth] = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkRedisHealth(),
    ]);

    const failedWebhookDeliveries = dbStore.webhookDeliveries.filter((delivery) => delivery.responseCode >= 400).length;
    const queuedWorkItems =
      dbStore.fraudReviews.filter((review) => review.status === 'PENDING').length +
      dbStore.payoutBatches.filter((batch) => batch.status === 'DRAFT' || batch.status === 'PROCESSING').length;

    return [
      databaseHealth,
      redisHealth,
      {
        name: 'Core API Process',
        status: 'Healthy',
        latency: 'local',
        uptime: this.formatUptime(process.uptime()),
        metric: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB RSS`,
      },
      {
        name: 'DB-Backed Store Cache',
        status: AppDataSource.isInitialized ? 'Healthy' : 'Down',
        latency: 'local',
        uptime: AppDataSource.isInitialized ? 'online' : 'offline',
        metric: `${dbStore.organizations.length} orgs cached`,
      },
      {
        name: 'BullMQ Worker Queues',
        status: redisHealth.status === 'Healthy' ? 'Healthy' : 'Degraded',
        latency: redisHealth.latency,
        uptime: redisHealth.status === 'Healthy' ? 'ready' : 'redis unavailable',
        metric: `${queuedWorkItems} pending work items`,
      },
      {
        name: 'Webhook Dispatch Engine',
        status: failedWebhookDeliveries > 0 ? 'Degraded' : 'Healthy',
        latency: this.averageWebhookLatency(),
        uptime: failedWebhookDeliveries > 0 ? `${failedWebhookDeliveries} failed deliveries` : 'ready',
        metric: `${dbStore.webhookDeliveries.length} deliveries`,
      },
    ];
  }

  private getQueueJobs() {
    const jobs = [];

    for (const review of dbStore.fraudReviews) {
      const orgName = dbStore.organizations.find((org) => org.id === review.organizationId)?.name || 'Unknown Organization';
      jobs.push({
        id: `fraud_${review.id}`,
        queue: 'Fraud',
        orgName,
        attempts: 1,
        status: review.status === 'PENDING' ? 'waiting' : 'completed',
        created: this.relativeTime(review.createdAt),
      });
    }

    for (const batch of dbStore.payoutBatches) {
      const orgName = dbStore.organizations.find((org) => org.id === batch.organizationId)?.name || 'Unknown Organization';
      jobs.push({
        id: `payout_${batch.id}`,
        queue: 'Payouts',
        orgName,
        attempts: batch.status === 'FAILED' ? 3 : 1,
        error: batch.status === 'FAILED' ? 'Payout batch failed' : undefined,
        status: batch.status === 'COMPLETED' ? 'completed' : batch.status === 'FAILED' ? 'failed' : 'waiting',
        created: this.relativeTime(batch.createdAt),
      });
    }

    for (const delivery of dbStore.webhookDeliveries) {
      const endpoint = dbStore.webhookEndpoints.find((item) => item.id === delivery.endpointId);
      const orgName = endpoint
        ? dbStore.organizations.find((org) => org.id === endpoint.organizationId)?.name || 'Unknown Organization'
        : 'Unknown Organization';
      jobs.push({
        id: `webhook_${delivery.id}`,
        queue: 'Webhooks',
        orgName,
        attempts: delivery.attempt,
        error: delivery.responseCode >= 400 ? delivery.responseBodyTruncated || 'Webhook delivery failed' : undefined,
        status: delivery.responseCode >= 400 ? 'failed' : 'completed',
        created: this.relativeTime(delivery.createdAt),
      });
    }

    return jobs;
  }

  private async checkDatabaseHealth() {
    const startedAt = Date.now();
    try {
      if (!AppDataSource.isInitialized) {
        return {
          name: 'MySQL Primary Database',
          status: 'Down',
          latency: 'offline',
          uptime: 'not connected',
          metric: 'connection closed',
        };
      }

      await AppDataSource.query('SELECT 1');
      return {
        name: 'MySQL Primary Database',
        status: 'Healthy',
        latency: `${Date.now() - startedAt}ms`,
        uptime: 'connected',
        metric: `${AppDataSource.entityMetadatas.length} entities`,
      };
    } catch (error: any) {
      return {
        name: 'MySQL Primary Database',
        status: 'Down',
        latency: `${Date.now() - startedAt}ms`,
        uptime: 'query failed',
        metric: error?.code || 'database error',
      };
    }
  }

  private async checkRedisHealth() {
    const startedAt = Date.now();
    const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
    const redis = redisUrl
      ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false })
      : new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
        password: process.env.REDIS_PASSWORD || undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
      });

    redis.on('error', () => undefined);

    try {
      await this.withTimeout(redis.connect(), 1200);
      await this.withTimeout(redis.ping(), 1200);
      const info = await this.withTimeout(redis.info('memory'), 1200);
      const memory = /used_memory_human:(.+)\r?\n/.exec(info)?.[1]?.trim() || 'connected';

      return {
        name: 'Redis Cache & Queue Broker',
        status: 'Healthy',
        latency: `${Date.now() - startedAt}ms`,
        uptime: 'connected',
        metric: memory,
      };
    } catch (error: any) {
      return {
        name: 'Redis Cache & Queue Broker',
        status: 'Degraded',
        latency: `${Date.now() - startedAt}ms`,
        uptime: 'unreachable',
        metric: error?.code || error?.message || 'redis unavailable',
      };
    } finally {
      redis.disconnect();
    }
  }

  private groupBy<T>(items: T[], getKey: (item: T) => string) {
    return items.reduce((map, item) => {
      const key = getKey(item);
      const values = map.get(key) || [];
      values.push(item);
      map.set(key, values);
      return map;
    }, new Map<string, T[]>());
  }

  private centsToDollars(value: number) {
    return Number((Number(value || 0) / 100).toFixed(2));
  }

  private dateOnly(value?: Date) {
    return value ? new Date(value).toISOString().slice(0, 10) : '';
  }

  private dateTime(value?: Date) {
    return value ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) : '';
  }

  private relativeTime(value?: Date) {
    if (!value) return 'Unknown';
    const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  private formatUptime(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  private averageWebhookLatency() {
    if (!dbStore.webhookDeliveries.length) return 'n/a';
    const total = dbStore.webhookDeliveries.reduce((sum, delivery) => sum + Number(delivery.durationMs || 0), 0);
    return `${Math.round(total / dbStore.webhookDeliveries.length)}ms`;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private domainFromWebsite(website?: string) {
    if (!website) return 'n/a';
    try {
      return new URL(website).hostname.replace(/^www\./, '');
    } catch {
      return website.replace(/^https?:\/\//, '').split('/')[0] || 'n/a';
    }
  }

  private organizationStatus(status: string) {
    if (status === 'SUSPENDED') return 'suspended';
    if (status === 'CLOSED' || status === 'REVOKED') return 'closed';
    return 'active';
  }

  private programStatus(status: string) {
    if (status === 'PAUSED') return 'paused';
    if (status === 'DRAFT') return 'draft';
    if (status === 'ARCHIVED') return 'archived';
    return 'active';
  }

  private affiliateStatus(status: string) {
    if (status === 'SUSPENDED') return 'Suspended';
    if (status === 'REJECTED') return 'Rejected';
    if (status === 'INACTIVE') return 'Inactive';
    if (status === 'PENDING') return 'Pending';
    return 'Active';
  }

  private payoutStatus(status: string) {
    if (status === 'COMPLETED') return 'Completed';
    if (status === 'PROCESSING') return 'Processing';
    if (status === 'FAILED' || status === 'PARTIALLY_FAILED' || status === 'CANCELLED') return 'Failed';
    return 'Scheduled';
  }

  private titleCase(value: string) {
    const normalized = String(value || '').toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private formatCommission(type: string, value: number) {
    if (type === 'FIXED_AMOUNT') {
      return `$${this.centsToDollars(value).toFixed(2)} flat`;
    }

    return `${value / 100}%`;
  }

  private fraudScoreForConversion(conversionId: string) {
    return dbStore.fraudReviews.find((review) => review.conversionId === conversionId)?.fraudScore || 0;
  }

  private fraudRateForProgram(programId: string) {
    const reviews = dbStore.fraudReviews.filter((review) => review.programId === programId);
    if (!reviews.length) return 0;
    return Number(((reviews.filter((review) => review.fraudScore >= 70).length / reviews.length) * 100).toFixed(1));
  }

  private fraudRateForAffiliate(affiliateId: string) {
    const conversionIds = dbStore.conversions
      .filter((conversion) => conversion.affiliateId === affiliateId)
      .map((conversion) => conversion.id);
    const reviews = dbStore.fraudReviews.filter((review) => conversionIds.includes(review.conversionId));
    if (!reviews.length) return 0;
    return Number(((reviews.filter((review) => review.fraudScore >= 70).length / reviews.length) * 100).toFixed(1));
  }

  private riskLevel(score: number) {
    if (score >= 90) return 'CRITICAL';
    if (score >= 70) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }

  async getAffiliateSettings(user: AuthUserPayload) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const setting = dbStore.platformSettings.find(
      (s) => s.key === 'affiliateEligibility.allowOrganizationMembers',
    );

    return {
      allowOrganizationMembers: setting ? Boolean(setting.value) : false,
      updatedAt: setting?.updatedAt || new Date(),
    };
  }

  async updateAffiliateSettings(dto: { allowOrganizationMembers: boolean }, user: AuthUserPayload) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const key = 'affiliateEligibility.allowOrganizationMembers';
    let setting = dbStore.platformSettings.find((s) => s.key === key);
    const oldValue = setting ? Boolean(setting.value) : false;
    const newValue = Boolean(dto.allowOrganizationMembers);

    if (!setting) {
      setting = {
        id: uuidv4(),
        key,
        value: newValue,
        description: 'Allow organization users to become affiliates',
        updatedBy: user.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.platformSettings.push(setting);
    } else {
      setting.value = newValue;
      setting.updatedBy = user.userId;
      setting.updatedAt = new Date();
    }
    await awaitPersist(setting);

    // Persist audit log
    const auditLog = {
      id: uuidv4(),
      actorType: 'USER',
      actorId: user.userId,
      action: AuditAction.AFFILIATE_ELIGIBILITY_POLICY_UPDATED,
      resourceType: 'platform_setting',
      resourceId: key,
      metadata: {
        settingKey: key,
        oldValue,
        newValue,
        actorEmail: user.email,
      },
      createdAt: new Date(),
    };
    dbStore.auditLogs.push(auditLog as any);

    return {
      allowOrganizationMembers: newValue,
      updatedAt: setting.updatedAt,
    };
  }

  async updateProgramStatus(programId: string, status: string, user: AuthUserPayload) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const program = dbStore.programs.find((p) => p.id === programId);
    if (!program) {
      throw new NotFoundException(`Program ${programId} not found`);
    }

    const oldStatus = program.status;
    const normalizedStatus = status.toUpperCase() as ProgramStatus;
    program.status = normalizedStatus;
    program.updatedAt = new Date();
    await awaitPersist(program);

    const auditLog = {
      id: uuidv4(),
      actorType: 'USER',
      actorId: user.userId,
      organizationId: program.organizationId,
      action: AuditAction.PROGRAM_UPDATED,
      resourceType: 'program',
      resourceId: program.id,
      metadata: {
        programName: program.name,
        oldStatus,
        newStatus: normalizedStatus,
        actorEmail: user.email,
      },
      createdAt: new Date(),
    };
    dbStore.auditLogs.push(auditLog as any);

    return {
      success: true,
      programId: program.id,
      status: this.programStatus(program.status),
    };
  }

  async bulkUpdateProgramStatus(programIds: string[], status: string, user: AuthUserPayload) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const results: string[] = [];
    const normalizedStatus = status.toUpperCase() as ProgramStatus;
    const pending: Promise<unknown>[] = [];

    for (const id of programIds) {
      const p = dbStore.programs.find((item) => item.id === id);
      if (p) {
        const oldStatus = p.status;
        p.status = normalizedStatus;
        p.updatedAt = new Date();
        results.push(p.id);
        pending.push(awaitPersist(p));

        dbStore.auditLogs.push({
          id: uuidv4(),
          actorType: 'USER',
          actorId: user.userId,
          organizationId: p.organizationId,
          action: AuditAction.PROGRAM_UPDATED,
          resourceType: 'program',
          resourceId: p.id,
          metadata: {
            programName: p.name,
            oldStatus,
            newStatus: normalizedStatus,
            actorEmail: user.email,
          },
          createdAt: new Date(),
        } as any);
      }
    }

    await Promise.all(pending);

    return {
      success: true,
      updatedCount: results.length,
      programIds: results,
      newStatus: status.toLowerCase(),
    };
  }

  async updateAffiliateStatus(affiliateId: string, status: string, user: AuthUserPayload) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const affiliate = dbStore.affiliates.find((a) => a.id === affiliateId);
    if (!affiliate) {
      throw new NotFoundException(`Affiliate ${affiliateId} not found`);
    }

    const oldStatus = affiliate.status;
    const normalizedStatus = status.toUpperCase() as AffiliateStatus;
    affiliate.status = normalizedStatus;
    affiliate.updatedAt = new Date();
    await awaitPersist(affiliate);

    const auditLog = {
      id: uuidv4(),
      actorType: 'USER',
      actorId: user.userId,
      organizationId: affiliate.organizationId,
      action: AuditAction.AFFILIATE_UPDATED,
      resourceType: 'affiliate',
      resourceId: affiliate.id,
      metadata: {
        affiliateName: affiliate.displayName,
        email: affiliate.email,
        oldStatus,
        newStatus: normalizedStatus,
        actorEmail: user.email,
      },
      createdAt: new Date(),
    };
    dbStore.auditLogs.push(auditLog as any);

    return {
      success: true,
      affiliateId: affiliate.id,
      status: this.affiliateStatus(affiliate.status),
    };
  }

  async bulkUpdateAffiliateStatus(affiliateIds: string[], status: string, user: AuthUserPayload) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const results: string[] = [];
    const normalizedStatus = status.toUpperCase() as AffiliateStatus;
    const pending: Promise<unknown>[] = [];

    for (const id of affiliateIds) {
      const a = dbStore.affiliates.find((item) => item.id === id);
      if (a) {
        const oldStatus = a.status;
        a.status = normalizedStatus;
        a.updatedAt = new Date();
        results.push(a.id);
        pending.push(awaitPersist(a));

        dbStore.auditLogs.push({
          id: uuidv4(),
          actorType: 'USER',
          actorId: user.userId,
          organizationId: a.organizationId,
          action: AuditAction.AFFILIATE_UPDATED,
          resourceType: 'affiliate',
          resourceId: a.id,
          metadata: {
            affiliateName: a.displayName,
            email: a.email,
            oldStatus,
            newStatus: normalizedStatus,
            actorEmail: user.email,
          },
          createdAt: new Date(),
        } as any);
      }
    }

    await Promise.all(pending);

    return {
      success: true,
      updatedCount: results.length,
      affiliateIds: results,
      newStatus: status,
    };
  }

  async updateConversionStatus(
    conversionId: string,
    status: string,
    user: AuthUserPayload,
    reason?: string,
  ) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const conversion = dbStore.conversions.find((c) => c.id === conversionId);
    if (!conversion) {
      throw new NotFoundException(`Conversion ${conversionId} not found`);
    }

    const oldStatus = conversion.status;
    const normalizedStatus = status.toUpperCase() as ConversionStatus;
    const pending: Promise<unknown>[] = [];

    if (normalizedStatus === ConversionStatus.APPROVED) {
      if (conversion.status === ConversionStatus.REJECTED) {
        throw new BadRequestException('Cannot approve a rejected conversion directly.');
      }
      conversion.status = ConversionStatus.APPROVED;
      conversion.validatedAt = new Date();
      conversion.validatedBy = user.userId;
      if (reason) conversion.validationNotes = reason;

      // Update associated commission
      const commissions = dbStore.commissions.filter((c) => c.conversionId === conversion.id);
      for (const comm of commissions) {
        comm.status = ConversionStatus.APPROVED;
        comm.approvalStatus = 'APPROVED';
        comm.approvedAt = new Date();
        comm.approvedBy = user.userId;
        comm.updatedAt = new Date();
        pending.push(awaitPersist(comm));
      }
    } else if (normalizedStatus === ConversionStatus.REJECTED) {
      conversion.status = ConversionStatus.REJECTED;
      conversion.rejectionReason = reason || 'Rejected by platform administrator';

      // Void/reject associated commissions
      const commissions = dbStore.commissions.filter((c) => c.conversionId === conversion.id);
      for (const comm of commissions) {
        comm.status = ConversionStatus.REJECTED;
        comm.approvalStatus = 'REJECTED';
        comm.updatedAt = new Date();
        pending.push(awaitPersist(comm));
      }
    } else if (normalizedStatus === ConversionStatus.REFUNDED) {
      conversion.status = ConversionStatus.REFUNDED;
      conversion.refundedAmount = conversion.amount;
      if (!conversion.refundHistory) conversion.refundHistory = [];
      conversion.refundHistory.push({
        refundExternalId: `rf-${Date.now()}`,
        amount: conversion.amount,
        reason: reason || 'Administrative full refund',
        createdAt: new Date().toISOString(),
      });

      // Reverse associated commissions
      const commissions = dbStore.commissions.filter((c) => c.conversionId === conversion.id);
      for (const comm of commissions) {
        comm.status = ConversionStatus.REFUNDED;
        comm.reversedAmount = comm.commissionAmount;
        comm.updatedAt = new Date();
        pending.push(awaitPersist(comm));
      }
    } else if (normalizedStatus === ConversionStatus.CHARGEBACK) {
      conversion.status = ConversionStatus.CHARGEBACK;
      conversion.refundedAmount = conversion.amount;

      // Reverse associated commissions
      const commissions = dbStore.commissions.filter((c) => c.conversionId === conversion.id);
      for (const comm of commissions) {
        comm.status = ConversionStatus.CHARGEBACK;
        comm.reversedAmount = comm.commissionAmount;
        comm.updatedAt = new Date();
        pending.push(awaitPersist(comm));
      }
    } else if (normalizedStatus === ConversionStatus.PENDING) {
      conversion.status = ConversionStatus.PENDING;
    } else {
      conversion.status = normalizedStatus;
    }

    conversion.updatedAt = new Date();
    pending.push(awaitPersist(conversion));
    await Promise.all(pending);

    // Audit log
    let auditAction: AuditAction = AuditAction.CONVERSION_APPROVED;
    if (normalizedStatus === ConversionStatus.REJECTED) auditAction = AuditAction.CONVERSION_REJECTED;
    if (normalizedStatus === ConversionStatus.REFUNDED || normalizedStatus === ConversionStatus.CHARGEBACK) auditAction = AuditAction.CONVERSION_REVERSED;

    const auditLog = {
      id: uuidv4(),
      actorType: 'USER',
      actorId: user.userId,
      organizationId: conversion.organizationId,
      action: auditAction,
      resourceType: 'conversion',
      resourceId: conversion.id,
      metadata: {
        orderId: conversion.externalId,
        oldStatus,
        newStatus: normalizedStatus,
        reason,
        amount: conversion.amount,
        currency: conversion.currency,
        actorEmail: user.email,
      },
      createdAt: new Date(),
    };
    dbStore.auditLogs.push(auditLog as any);

    return {
      success: true,
      conversionId: conversion.id,
      status: this.titleCase(conversion.status),
      oldStatus: this.titleCase(oldStatus),
    };
  }

  async bulkUpdateConversionStatus(
    conversionIds: string[],
    status: string,
    user: AuthUserPayload,
    reason?: string,
  ) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const results: string[] = [];
    for (const id of conversionIds) {
      try {
        await this.updateConversionStatus(id, status, user, reason);
        results.push(id);
      } catch (err) {
        // Skip individual failures
      }
    }

    return {
      success: true,
      updatedCount: results.length,
      conversionIds: results,
      newStatus: status,
    };
  }

  async updateCommissionStatus(
    commissionId: string,
    status: string,
    user: AuthUserPayload,
    reason?: string,
  ) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const commission = dbStore.commissions.find((c) => c.id === commissionId);
    if (!commission) {
      throw new NotFoundException(`Commission with id ${commissionId} not found`);
    }

    const oldStatus = commission.status;
    const normalized = status.toUpperCase();

    if (normalized === 'APPROVED') {
      commission.status = ConversionStatus.APPROVED;
      commission.approvalStatus = 'APPROVED';
      commission.approvedAt = new Date();
      commission.approvedBy = user.email || user.userId;
      commission.payoutStatus = 'ELIGIBLE';
    } else if (normalized === 'REJECTED') {
      commission.status = ConversionStatus.REJECTED;
      commission.approvalStatus = 'REJECTED';
      commission.payoutStatus = 'CANCELLED';
      if (reason) commission.disputeReason = reason;
    } else if (normalized === 'REFUNDED' || normalized === 'REVERSED') {
      commission.status = ConversionStatus.REFUNDED;
      commission.reversedAmount = commission.commissionAmount;
      commission.payoutStatus = 'CANCELLED';
      if (reason) commission.disputeReason = reason;
    } else if (normalized === 'CHARGEBACK') {
      commission.status = ConversionStatus.CHARGEBACK;
      commission.reversedAmount = commission.commissionAmount;
      commission.payoutStatus = 'CANCELLED';
      if (reason) commission.disputeReason = reason;
    } else if (normalized === 'PENDING') {
      commission.status = ConversionStatus.PENDING;
      commission.approvalStatus = 'PENDING';
      commission.payoutStatus = 'NOT_READY';
      commission.reversedAmount = 0;
    } else {
      commission.status = normalized as ConversionStatus;
    }

    commission.updatedAt = new Date();
    await awaitPersist(commission);

    // Audit log
    let auditAction: AuditAction = AuditAction.COMMISSION_APPROVED;
    if (normalized === 'REJECTED') auditAction = (AuditAction as any).COMMISSION_REJECTED || AuditAction.CONVERSION_REJECTED;
    if (normalized === 'REFUNDED' || normalized === 'REVERSED' || normalized === 'CHARGEBACK') auditAction = AuditAction.COMMISSION_REVERSED;

    const auditLog = {
      id: uuidv4(),
      actorType: 'USER',
      actorId: user.userId,
      organizationId: commission.organizationId,
      action: auditAction,
      resourceType: 'commission',
      resourceId: commission.id,
      metadata: {
        commissionId: commission.id,
        conversionId: commission.conversionId,
        oldStatus,
        newStatus: commission.status,
        reason,
        amount: commission.commissionAmount,
        actorEmail: user.email,
      },
      createdAt: new Date(),
    };
    dbStore.auditLogs.push(auditLog as any);

    return {
      success: true,
      commissionId: commission.id,
      status: this.titleCase(commission.status),
      oldStatus: this.titleCase(oldStatus),
    };
  }

  async bulkUpdateCommissionStatus(
    commissionIds: string[],
    status: string,
    user: AuthUserPayload,
    reason?: string,
  ) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const results: string[] = [];
    for (const id of commissionIds) {
      try {
        await this.updateCommissionStatus(id, status, user, reason);
        results.push(id);
      } catch (err) {
        // Skip individual failures
      }
    }

    return {
      success: true,
      updatedCount: results.length,
      commissionIds: results,
      newStatus: status,
    };
  }

  async recalculateCommission(commissionId: string, user: AuthUserPayload) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const commission = dbStore.commissions.find((c) => c.id === commissionId);
    if (!commission) {
      throw new NotFoundException(`Commission with id ${commissionId} not found`);
    }

    const conversion = dbStore.conversions.find((c) => c.id === commission.conversionId);
    const program = dbStore.programs.find((p) => p.id === commission.programId);
    const rule = commission.ruleId ? dbStore.commissionRules.find((r) => r.id === commission.ruleId) : undefined;

    const baseAmount = conversion ? Number(conversion.amount || 0) : commission.baseAmount;
    let rate = commission.rate;
    let newCommissionAmount = commission.commissionAmount;

    if (rule) {
      if (rule.commissionType === 'PERCENTAGE' || rule.commissionType === ('PERCENTAGE' as any)) {
        rate = Number(rule.commissionValue || 0);
        newCommissionAmount = Math.round((baseAmount * rate) / 10000);
      } else {
        newCommissionAmount = Number(rule.commissionValue || 0);
      }
    } else if (program) {
      if (program.commissionType === 'PERCENTAGE' || program.commissionType === ('PERCENTAGE' as any)) {
        rate = Number(program.defaultCommissionValue || 1000);
        newCommissionAmount = Math.round((baseAmount * rate) / 10000);
      } else {
        newCommissionAmount = Number(program.defaultCommissionValue || 0);
      }
    }

    commission.baseAmount = baseAmount;
    commission.rate = rate;
    commission.commissionAmount = newCommissionAmount;
    commission.updatedAt = new Date();

    const currentVersionNum = parseInt(String(commission.calculationVersion || 'v1').replace(/\D/g, ''), 10) || 1;
    commission.calculationVersion = `v${currentVersionNum + 1}`;
    await awaitPersist(commission);

    const auditLog = {
      id: uuidv4(),
      actorType: 'USER',
      actorId: user.userId,
      organizationId: commission.organizationId,
      action: AuditAction.COMMISSION_RULE_CHANGED,
      resourceType: 'commission',
      resourceId: commission.id,
      metadata: {
        commissionId: commission.id,
        action: 'RECALCULATE',
        recalculatedAmount: commission.commissionAmount,
        calculationVersion: commission.calculationVersion,
        actorEmail: user.email,
      },
      createdAt: new Date(),
    };
    dbStore.auditLogs.push(auditLog as any);

    return {
      success: true,
      commissionId: commission.id,
      recalculatedAmount: this.centsToDollars(commission.commissionAmount),
      version: commission.calculationVersion,
    };
  }

  async reverseCommission(commissionId: string, user: AuthUserPayload, reason?: string) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const commission = dbStore.commissions.find((c) => c.id === commissionId);
    if (!commission) {
      throw new NotFoundException(`Commission with id ${commissionId} not found`);
    }

    commission.status = ConversionStatus.REFUNDED;
    commission.reversedAmount = commission.commissionAmount;
    commission.payoutStatus = 'CANCELLED';
    commission.updatedAt = new Date();
    if (reason) {
      commission.disputeReason = reason;
    }
    await awaitPersist(commission);

    const auditLog = {
      id: uuidv4(),
      actorType: 'USER',
      actorId: user.userId,
      organizationId: commission.organizationId,
      action: AuditAction.COMMISSION_REVERSED,
      resourceType: 'commission',
      resourceId: commission.id,
      metadata: {
        commissionId: commission.id,
        reversedAmount: commission.reversedAmount,
        reason,
        actorEmail: user.email,
      },
      createdAt: new Date(),
    };
    dbStore.auditLogs.push(auditLog as any);

    return {
      success: true,
      commissionId: commission.id,
      status: 'Refunded',
      reversedAmount: this.centsToDollars(commission.reversedAmount),
    };
  }
}

