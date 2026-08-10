import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, ConversionEntity, FraudAssessmentEntity, FraudReviewEntity, PayoutBatchEntity } from '../../database/store';
import {
  AffiliateTrustSource,
  AuditAction,
  ConversionStatus,
  FraudAssessmentType,
  FraudDecision,
  FraudEntityType,
  FraudReviewStatus,
  FraudStatus,
} from '../../common/enums';
import { FraudContextFactory } from './fraud-context.factory';
import { FraudEngineService } from './fraud-engine.service';
import { FraudAssessmentResult } from './fraud.types';

@Injectable()
export class FraudService {
  constructor(
    private readonly contextFactory: FraudContextFactory,
    private readonly engine: FraudEngineService,
  ) {}

  async evaluateClick(clickId: string, rawIp?: string) {
    const click = dbStore.clicks.find((item) => item.id === clickId);
    if (!click) throw new NotFoundException('Click not found');
    const result = await this.engine.assess(this.contextFactory.fromClick(click, rawIp), FraudAssessmentType.INITIAL);
    click.fraudScore = result.score;
    click.fraudStatus = this.legacyFraudStatus(result.score);
    return result;
  }

  async evaluateConversion(conversion: ConversionEntity): Promise<FraudAssessmentResult & { status: FraudStatus }> {
    const result = await this.engine.assess(this.contextFactory.fromConversion(conversion), FraudAssessmentType.INITIAL);
    return { ...result, status: this.legacyFraudStatus(result.score) };
  }

  async evaluatePayout(batch: PayoutBatchEntity) {
    return this.engine.assess(this.contextFactory.fromPayout(batch), FraudAssessmentType.PAYOUT_CHECK);
  }

  async getReviews(organizationId: string) {
    const reviewRows = dbStore.fraudReviews
      .filter((review) => review.organizationId === organizationId)
      .map((review) => this.expandReview(review));
    const reviewedAssessmentIds = new Set(reviewRows.map((review) => review.assessmentId).filter(Boolean));
    const assessmentRows = dbStore.fraudAssessments
      .filter((assessment) => assessment.organizationId === organizationId && !reviewedAssessmentIds.has(assessment.id))
      .map((assessment) => this.expandAssessment(assessment));

    return [...reviewRows, ...assessmentRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async getAssessment(organizationId: string, assessmentId: string) {
    const assessment = dbStore.fraudAssessments.find((item) => item.id === assessmentId && item.organizationId === organizationId);
    if (!assessment) throw new NotFoundException('FRAUD_ASSESSMENT_NOT_FOUND');
    return {
      ...assessment,
      signals: dbStore.fraudSignals.filter((signal) => signal.assessmentId === assessment.id),
    };
  }

  async getSettings(organizationId: string, programId?: string) {
    return dbStore.fraudSettings.find((item) => item.organizationId === organizationId && (programId ? item.programId === programId : !item.programId)) || null;
  }

  async upsertSettings(organizationId: string, userId: string, dto: any) {
    this.validateSettings(dto);
    const existing = dbStore.fraudSettings.find(
      (item) => item.organizationId === organizationId && (dto.programId ? item.programId === dto.programId : !item.programId),
    );
    const record = {
      ...(existing || { id: uuidv4(), organizationId, createdBy: userId, createdAt: new Date() }),
      programId: dto.programId,
      enabled: dto.enabled ?? true,
      sensitivity: dto.sensitivity || 'BALANCED',
      allowMaxScore: dto.allowMaxScore ?? 30,
      reviewMaxScore: dto.reviewMaxScore ?? 70,
      blockMinScore: dto.blockMinScore ?? 71,
      payoutHoldScore: dto.payoutHoldScore ?? 71,
      enabledSignals: dto.enabledSignals,
      signalWeights: dto.signalWeights,
      updatedAt: new Date(),
    };
    if (existing) Object.assign(existing, record);
    else dbStore.fraudSettings.push(record);
    return record;
  }

  async resolveReview(
    organizationId: string,
    reviewId: string,
    decision: 'APPROVED' | 'REJECTED' | 'ESCALATED',
    reviewerId: string,
    reason?: string,
    notes?: string,
  ) {
    const review = dbStore.fraudReviews.find((item) => item.id === reviewId && item.organizationId === organizationId);
    if (!review) throw new NotFoundException('FRAUD_REVIEW_NOT_FOUND');
    if (review.status === FraudReviewStatus.APPROVED || review.status === FraudReviewStatus.REJECTED) {
      throw new BadRequestException('FRAUD_REVIEW_ALREADY_COMPLETED');
    }

    review.status =
      decision === 'APPROVED'
        ? FraudReviewStatus.APPROVED
        : decision === 'REJECTED'
          ? FraudReviewStatus.REJECTED
          : FraudReviewStatus.ESCALATED;
    review.reviewDecision = decision;
    review.reviewedBy = reviewerId;
    review.reviewedAt = new Date();
    review.decisionReason = reason;
    review.reviewNotes = notes;
    review.updatedAt = new Date();

    if (review.entityType === FraudEntityType.CONVERSION || review.conversionId) {
      const conversion = dbStore.conversions.find((item) => item.id === (review.entityId || review.conversionId));
      if (conversion) {
        conversion.status = decision === 'APPROVED' ? ConversionStatus.APPROVED : ConversionStatus.REJECTED;
      }
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: reviewerId,
      action: 'FRAUD_REVIEW_RESOLVED' as AuditAction,
      resourceType: 'fraud_review',
      resourceId: review.id,
      metadata: { decision, reason },
      createdAt: new Date(),
    });

    return this.expandReview(review);
  }

  assignReview(organizationId: string, reviewId: string, analystId: string, actorId: string) {
    const review = dbStore.fraudReviews.find((item) => item.id === reviewId && item.organizationId === organizationId);
    if (!review) throw new NotFoundException('FRAUD_REVIEW_NOT_FOUND');
    review.assignedTo = analystId;
    review.status = FraudReviewStatus.IN_REVIEW;
    review.updatedAt = new Date();
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: 'FRAUD_REVIEW_ASSIGNED' as AuditAction,
      resourceType: 'fraud_review',
      resourceId: review.id,
      metadata: { analystId },
      createdAt: new Date(),
    });
    return this.expandReview(review);
  }

  updateAffiliateTrust(organizationId: string, affiliateId: string, newScore: number, reason: string, source = AffiliateTrustSource.AUTOMATED) {
    const affiliate = dbStore.affiliates.find((item) => item.organizationId === organizationId && item.id === affiliateId);
    if (!affiliate) throw new NotFoundException('Affiliate not found');
    const previousScore = affiliate.trustScore ?? 50;
    affiliate.trustScore = Math.max(0, Math.min(100, Math.round(newScore)));
    dbStore.affiliateTrustHistory.push({
      id: uuidv4(),
      organizationId,
      affiliateId,
      previousScore,
      newScore: affiliate.trustScore,
      reason,
      source,
      createdAt: new Date(),
    });
    return { affiliateId, previousScore, newScore: affiliate.trustScore };
  }

  getDashboard(organizationId: string) {
    const assessments = dbStore.fraudAssessments.filter((item) => item.organizationId === organizationId);
    const reviews = dbStore.fraudReviews.filter((item) => item.organizationId === organizationId);
    const signals = dbStore.fraudSignals.filter((signal) => assessments.some((assessment) => assessment.id === signal.assessmentId));
    return {
      metrics: {
        assessments: assessments.length,
        fraudPrevented: assessments
          .filter((item) => item.decision === FraudDecision.BLOCK || item.decision === FraudDecision.HOLD)
          .reduce((total, item) => total + Number(item.amount || 0), 0),
        highRiskEvents: assessments.filter((item) => item.score >= 71).length,
        pendingReviews: reviews.filter((item) => item.status === FraudReviewStatus.PENDING || item.status === FraudReviewStatus.IN_REVIEW).length,
        fraudRate: assessments.length ? Math.round((assessments.filter((item) => item.score >= 71).length / assessments.length) * 1000) / 10 : 0,
        averageRiskScore: assessments.length ? Math.round(assessments.reduce((sum, item) => sum + item.score, 0) / assessments.length) : 0,
      },
      riskDistribution: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((riskLevel) => ({
        riskLevel,
        count: assessments.filter((item) => item.riskLevel === riskLevel).length,
      })),
      topSignals: Object.entries(
        signals.reduce((map, signal) => ({ ...map, [signal.signalCode]: ((map as any)[signal.signalCode] || 0) + 1 }), {} as Record<string, number>),
      ).map(([code, count]) => ({ code, count })),
      reviews: reviews.map((review) => this.expandReview(review)),
    };
  }

  private expandReview(review: FraudReviewEntity) {
    const conversion = dbStore.conversions.find((item) => item.id === (review.entityId || review.conversionId));
    const assessment = review.assessmentId ? dbStore.fraudAssessments.find((item) => item.id === review.assessmentId) : undefined;
    const affiliateId = conversion?.affiliateId || assessment?.affiliateId;
    const affiliate = affiliateId ? dbStore.affiliates.find((item) => item.id === affiliateId) : undefined;
    const program = dbStore.programs.find((item) => item.id === review.programId);
    const organization = dbStore.organizations.find((item) => item.id === review.organizationId);
    return {
      ...review,
      organizationName: organization?.name,
      programName: program?.name,
      affiliateName: affiliate?.displayName || 'Unassigned',
      amount: conversion?.amount || review.signals?.reduce?.(() => 0, 0) || 0,
      assessment,
      signalRows: review.assessmentId ? dbStore.fraudSignals.filter((signal) => signal.assessmentId === review.assessmentId) : [],
    };
  }

  private expandAssessment(assessment: FraudAssessmentEntity) {
    const click = assessment.entityType === FraudEntityType.CLICK ? dbStore.clicks.find((item) => item.id === assessment.entityId) : undefined;
    const conversion = assessment.entityType === FraudEntityType.CONVERSION ? dbStore.conversions.find((item) => item.id === assessment.entityId) : undefined;
    const affiliateId = assessment.affiliateId || click?.affiliateId || conversion?.affiliateId;
    const affiliate = affiliateId ? dbStore.affiliates.find((item) => item.id === affiliateId) : undefined;
    const program = dbStore.programs.find((item) => item.id === assessment.programId);
    const organization = dbStore.organizations.find((item) => item.id === assessment.organizationId);
    const signalRows = dbStore.fraudSignals.filter((signal) => signal.assessmentId === assessment.id);

    return {
      id: assessment.id,
      organizationId: assessment.organizationId,
      programId: assessment.programId,
      conversionId: conversion?.id,
      assessmentId: assessment.id,
      entityType: assessment.entityType,
      entityId: assessment.entityId,
      fraudScore: assessment.score,
      confidence: assessment.confidence,
      riskLevel: assessment.riskLevel,
      status: FraudReviewStatus.PENDING,
      reviewDecision: assessment.decision,
      createdAt: assessment.createdAt,
      updatedAt: assessment.createdAt,
      organizationName: organization?.name,
      programName: program?.name,
      affiliateName: affiliate?.displayName || 'Unassigned',
      amount: conversion?.amount || assessment.amount || 0,
      assessment,
      signalRows,
      signals: signalRows.map((signal) => ({
        code: signal.signalCode,
        category: signal.category,
        score: signal.score,
        confidence: signal.confidence,
        reason: signal.reason,
      })),
    };
  }

  private validateSettings(dto: any) {
    const allowMaxScore = dto.allowMaxScore ?? 30;
    const reviewMaxScore = dto.reviewMaxScore ?? 70;
    const blockMinScore = dto.blockMinScore ?? 71;
    if (allowMaxScore < 0 || reviewMaxScore > 100 || blockMinScore < 0 || blockMinScore > 100 || allowMaxScore >= blockMinScore) {
      throw new BadRequestException('FRAUD_SETTINGS_INVALID');
    }
    if (reviewMaxScore >= blockMinScore) {
      throw new BadRequestException('FRAUD_SETTINGS_INVALID');
    }
  }

  private legacyFraudStatus(score: number) {
    if (score >= 71) return FraudStatus.HIGH;
    if (score >= 31) return FraudStatus.MEDIUM;
    return FraudStatus.LOW;
  }
}
