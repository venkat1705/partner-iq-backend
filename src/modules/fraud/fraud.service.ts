import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, ConversionEntity, FraudAssessmentEntity, FraudReviewEntity, PayoutBatchEntity } from '../../database/store';
import {
  AffiliateStatus,
  AffiliateTrustSource,
  AuditAction,
  ConversionStatus,
  FraudAssessmentType,
  FraudDecision,
  FraudEntityType,
  FraudReviewStatus,
  FraudSensitivity,
  FraudStatus,
  LedgerEntryType,
  PayoutStatus,
  WebhookEvent,
} from '../../common/enums';
import { FraudContextFactory } from './fraud-context.factory';
import { FraudEngineService } from './fraud-engine.service';
import { SENSITIVITY_THRESHOLD_PRESETS } from './fraud-policy.service';
import { FraudAssessmentResult } from './fraud.types';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CommissionsService } from '../commissions/commissions.service';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private readonly contextFactory: FraudContextFactory,
    private readonly engine: FraudEngineService,
    private readonly commissionsService: CommissionsService,
    private readonly ledgerService: LedgerService,
    private readonly webhooksService?: WebhooksService,
  ) {}

  async evaluateClick(clickId: string, rawIp?: string) {
    const click = dbStore.clicks.find((item) => item.id === clickId);
    if (!click) throw new NotFoundException('Click not found');
    const result = await this.engine.assess(this.contextFactory.fromClick(click, rawIp), FraudAssessmentType.INITIAL);
    click.fraudScore = result.score;
    click.fraudStatus = this.legacyFraudStatus(result.score);

    if (click.fraudStatus === FraudStatus.HIGH) {
      this.webhooksService?.triggerEvent(click.organizationId, WebhookEvent.CLICK_FLAGGED, {
        clickId: click.id,
        trackingLinkId: click.trackingLinkId,
        affiliateId: click.affiliateId,
        reason: 'FRAUD_SCORE_HIGH',
      }).catch((error) => {
        this.logger.error(`Webhook delivery failed for ${WebhookEvent.CLICK_FLAGGED}: ${error?.message || error}`);
      });
    }

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
    const existing = dbStore.fraudSettings.find(
      (item) => item.organizationId === organizationId && (dto.programId ? item.programId === dto.programId : !item.programId),
    );
    const sensitivity: FraudSensitivity = dto.sensitivity || existing?.sensitivity || FraudSensitivity.BALANCED;
    const preset = SENSITIVITY_THRESHOLD_PRESETS[sensitivity] || SENSITIVITY_THRESHOLD_PRESETS[FraudSensitivity.BALANCED];

    const resolvedDto = {
      ...dto,
      allowMaxScore: dto.allowMaxScore ?? preset.allowMaxScore,
      reviewMaxScore: dto.reviewMaxScore ?? preset.reviewMaxScore,
      blockMinScore: dto.blockMinScore ?? preset.blockMinScore,
      payoutHoldScore: dto.payoutHoldScore ?? preset.payoutHoldScore,
    };
    this.validateSettings(resolvedDto);

    const record = {
      ...(existing || { id: uuidv4(), organizationId, createdBy: userId, createdAt: new Date() }),
      programId: dto.programId,
      enabled: dto.enabled ?? true,
      sensitivity,
      allowMaxScore: resolvedDto.allowMaxScore,
      reviewMaxScore: resolvedDto.reviewMaxScore,
      blockMinScore: resolvedDto.blockMinScore,
      payoutHoldScore: resolvedDto.payoutHoldScore,
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

    if (review.entityType === FraudEntityType.CONVERSION) {
      const conversion = dbStore.conversions.find((item) => item.id === (review.entityId || review.conversionId));
      if (conversion) {
        conversion.status = decision === 'APPROVED' ? ConversionStatus.APPROVED : ConversionStatus.REJECTED;

        // A conversion held for fraud REVIEW never went through the commission step at
        // creation time (conversions.service.ts only calculates commission when a
        // conversion is APPROVED immediately) — so approving it here must generate the
        // commission now, otherwise the affiliate never gets credited despite the
        // conversion showing as approved.
        const alreadyHasCommission = dbStore.commissions.some((c) => c.conversionId === conversion.id);
        const affiliate = conversion.affiliateId
          ? dbStore.affiliates.find((a) => a.id === conversion.affiliateId)
          : undefined;
        const affiliateIsActive = !affiliate || affiliate.status === AffiliateStatus.ACTIVE;

        if (decision === 'APPROVED' && conversion.affiliateId && affiliateIsActive && !alreadyHasCommission) {
          await this.commissionsService.calculateAndRecordCommission(
            organizationId,
            conversion,
            conversion.affiliateId,
            review.fraudScore ?? 0,
          );
        }
      }
    } else if (review.entityType === FraudEntityType.PAYOUT) {
      // Previously, resolving a PAYOUT fraud review did nothing at all — there was no
      // branch for it, so a held payout batch had no way to ever leave HELD/PROCESSING.
      // APPROVED releases the hold so the batch can be processed normally; REJECTED
      // permanently cancels the batch and restores the balance that was reserved (zeroed
      // out) from each affiliate's earned balance when the batch was created, so rejecting
      // a suspected-fraudulent payout doesn't also cost the affiliate their earned balance.
      const batch = dbStore.payoutBatches.find((item) => item.id === (review.entityId || review.conversionId) && item.organizationId === organizationId);
      if (!batch) {
        this.logger.warn(`Fraud review ${review.id} resolved but payout batch ${review.entityId} was not found.`);
      } else if (decision === 'APPROVED') {
        if (batch.status === PayoutStatus.HELD) {
          batch.status = PayoutStatus.DRAFT;
          batch.updatedAt = new Date();
          this.webhooksService?.triggerEvent(organizationId, WebhookEvent.PAYOUT_RELEASED, {
            payoutId: batch.id,
            totalAmount: batch.totalAmount,
            currency: batch.currency,
          }).catch((error) => {
            this.logger.error(`Webhook delivery failed for ${WebhookEvent.PAYOUT_RELEASED}: ${error?.message || error}`);
          });
        }
      } else if (decision === 'REJECTED' && (batch.status === PayoutStatus.HELD || batch.status === PayoutStatus.DRAFT)) {
        const items = dbStore.payoutItems.filter((item) => item.batchId === batch.id && item.status !== PayoutStatus.CANCELLED);
        for (const item of items) {
          const account = await this.ledgerService.getAccount(organizationId, item.affiliateId, 'EARNED');
          account.balance += item.amount;
          account.updatedAt = new Date();
          await this.ledgerService.recordTransaction(
            organizationId,
            item.affiliateId,
            LedgerEntryType.PAYOUT_FAILED,
            `Payout batch ${batch.id} rejected by fraud review ${review.id}; reserved balance restored.`,
            item.id,
            item.amount,
            { skipBalanceMutation: true },
          );
          item.status = PayoutStatus.CANCELLED;
        }
        batch.status = PayoutStatus.CANCELLED;
        batch.updatedAt = new Date();
        this.webhooksService?.triggerEvent(organizationId, WebhookEvent.PAYOUT_FAILED, {
          payoutId: batch.id,
          totalAmount: batch.totalAmount,
          currency: batch.currency,
          reason: reason || 'FRAUD_REVIEW_REJECTED',
        }).catch((error) => {
          this.logger.error(`Webhook delivery failed for ${WebhookEvent.PAYOUT_FAILED}: ${error?.message || error}`);
        });
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
    const payoutHoldScore = dto.payoutHoldScore ?? 71;

    for (const [label, value] of Object.entries({ allowMaxScore, reviewMaxScore, blockMinScore, payoutHoldScore })) {
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new BadRequestException(`FRAUD_SETTINGS_INVALID: ${label} must be a number between 0 and 100.`);
      }
    }
    if (allowMaxScore >= reviewMaxScore) {
      throw new BadRequestException('FRAUD_SETTINGS_INVALID: allowMaxScore must be less than reviewMaxScore.');
    }
    // blockMinScore must immediately follow reviewMaxScore. A gap (e.g. reviewMax=60,
    // blockMin=71) would leave scores 61-70 matching neither the REVIEW nor BLOCK branch in
    // FraudDecisionService.decide(), so they would silently fall through to ALLOW.
    if (blockMinScore !== reviewMaxScore + 1) {
      throw new BadRequestException('FRAUD_SETTINGS_INVALID: blockMinScore must equal reviewMaxScore + 1, with no gap or overlap between the review and block ranges.');
    }
    if (payoutHoldScore <= allowMaxScore) {
      throw new BadRequestException('FRAUD_SETTINGS_INVALID: payoutHoldScore must be greater than allowMaxScore.');
    }
  }

  private legacyFraudStatus(score: number) {
    if (score >= 71) return FraudStatus.HIGH;
    if (score >= 31) return FraudStatus.MEDIUM;
    return FraudStatus.LOW;
  }
}
