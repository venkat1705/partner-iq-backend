import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import {
  AuditAction,
  FraudAssessmentType,
  FraudDecision,
  FraudReviewStatus,
} from '../../common/enums';
import { FRAUD_ENGINE_VERSION, FraudAssessmentResult, FraudContext } from './fraud.types';
import { FraudDecisionService } from './fraud-decision.service';
import { FraudPolicyService } from './fraud-policy.service';
import { FraudScoreService } from './fraud-score.service';
import { FraudSignalRegistry } from './fraud-signal-registry';

@Injectable()
export class FraudEngineService {
  constructor(
    private readonly registry: FraudSignalRegistry,
    private readonly policyService: FraudPolicyService,
    private readonly scoreService: FraudScoreService,
    private readonly decisionService: FraudDecisionService,
  ) {}

  async assess(context: FraudContext, assessmentType = FraudAssessmentType.INITIAL): Promise<FraudAssessmentResult> {
    const policy = this.policyService.resolvePolicy(context.organizationId, context.programId);
    const evaluators = this.registry.getEnabled(policy.enabledSignals);
    const signals = [];

    for (const evaluator of evaluators) {
      try {
        signals.push(await evaluator.evaluate(context));
      } catch (error: any) {
        signals.push({
          code: evaluator.code,
          category: evaluator.category,
          detected: false,
          score: 0,
          confidence: 0,
          reason: 'Signal unavailable; assessment continued with reduced confidence.',
          metadata: { error: error?.code || error?.message || 'signal_failed' },
        });
      }
    }

    const aggregate = this.scoreService.aggregate(signals, policy);
    const decision = this.decisionService.decide(context, aggregate.score, policy);

    const assessment = {
      id: uuidv4(),
      organizationId: context.organizationId,
      programId: context.programId,
      entityType: context.entityType,
      entityId: context.entityId,
      affiliateId: context.affiliateId,
      score: aggregate.score,
      confidence: aggregate.confidence,
      riskLevel: aggregate.riskLevel,
      decision,
      engineVersion: FRAUD_ENGINE_VERSION,
      policyVersion: policy.policyVersion,
      assessmentType,
      categoryScores: aggregate.categoryScores,
      amount: context.amount,
      createdAt: new Date(),
    };
    dbStore.fraudAssessments.push(assessment);

    for (const signal of signals.filter((item) => item.detected || item.score > 0)) {
      dbStore.fraudSignals.push({
        id: uuidv4(),
        assessmentId: assessment.id,
        signalCode: signal.code,
        category: signal.category,
        detected: signal.detected,
        score: signal.score,
        confidence: signal.confidence,
        reason: signal.reason,
        metadata: this.sanitizeMetadata(signal.metadata),
        createdAt: new Date(),
      });
    }

    if (decision === FraudDecision.REVIEW || decision === FraudDecision.BLOCK || decision === FraudDecision.HOLD) {
      this.createReview(context, assessment.id, aggregate.score, aggregate.confidence, aggregate.riskLevel, decision, signals);
    }

    this.updateRollup(context, aggregate.score, decision);
    this.audit(context, assessment.id, decision, aggregate.score);

    return {
      assessmentId: assessment.id,
      score: aggregate.score,
      confidence: aggregate.confidence,
      riskLevel: aggregate.riskLevel,
      decision,
      assessmentType,
      categoryScores: aggregate.categoryScores,
      signals,
    };
  }

  private createReview(
    context: FraudContext,
    assessmentId: string,
    score: number,
    confidence: number,
    riskLevel: any,
    decision: FraudDecision,
    signals: any[],
  ) {
    const existing = dbStore.fraudReviews.find(
      (review) => review.organizationId === context.organizationId && review.assessmentId === assessmentId,
    );
    if (existing) return;

    dbStore.fraudReviews.push({
      id: uuidv4(),
      organizationId: context.organizationId,
      programId: context.programId,
      conversionId: context.conversionId || context.entityId,
      assessmentId,
      entityType: context.entityType,
      entityId: context.entityId,
      fraudScore: score,
      confidence,
      riskLevel,
      signals: signals.filter((signal) => signal.detected).map((signal) => ({
        code: signal.code,
        category: signal.category,
        score: signal.score,
        confidence: signal.confidence,
        reason: signal.reason,
      })),
      status: decision === FraudDecision.BLOCK || decision === FraudDecision.HOLD ? FraudReviewStatus.IN_REVIEW : FraudReviewStatus.PENDING,
      reviewDecision: decision,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  private updateRollup(context: FraudContext, score: number, decision: FraudDecision) {
    const date = new Date().toISOString().slice(0, 10);
    let rollup = dbStore.fraudMetricRollups.find(
      (item) => item.organizationId === context.organizationId && item.programId === context.programId && item.date === date,
    );
    if (!rollup) {
      rollup = {
        id: uuidv4(),
        organizationId: context.organizationId,
        programId: context.programId,
        date,
        assessments: 0,
        highRiskCount: 0,
        blockedCount: 0,
        reviewCount: 0,
        fraudPreventedAmount: 0,
        averageScore: 0,
        updatedAt: new Date(),
      };
      dbStore.fraudMetricRollups.push(rollup);
    }
    rollup.averageScore = Math.round(((rollup.averageScore * rollup.assessments) + score) / (rollup.assessments + 1));
    rollup.assessments += 1;
    rollup.highRiskCount += score >= 71 ? 1 : 0;
    rollup.blockedCount += decision === FraudDecision.BLOCK || decision === FraudDecision.HOLD ? 1 : 0;
    rollup.reviewCount += decision === FraudDecision.REVIEW ? 1 : 0;
    rollup.fraudPreventedAmount += decision === FraudDecision.BLOCK || decision === FraudDecision.HOLD ? Number(context.amount || 0) : 0;
    rollup.updatedAt = new Date();
  }

  private audit(context: FraudContext, assessmentId: string, decision: FraudDecision, score: number) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId: context.organizationId,
      actorType: 'SYSTEM',
      actorId: 'fraud-engine',
      action: 'FRAUD_ASSESSMENT_CREATED' as AuditAction,
      resourceType: 'fraud_assessment',
      resourceId: assessmentId,
      metadata: { entityType: context.entityType, entityId: context.entityId, decision, score },
      createdAt: new Date(),
    });
  }

  private sanitizeMetadata(metadata?: Record<string, unknown>) {
    if (!metadata) return undefined;
    const { rawIp, email, paymentIdentifier, ...safe } = metadata as any;
    return safe;
  }
}
