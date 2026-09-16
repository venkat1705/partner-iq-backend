import { Inject, Injectable, Optional } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import {
  AuditAction,
  FraudAssessmentType,
  FraudDecision,
  FraudReviewStatus,
  FraudSignalCode,
  PlatformRole,
  Role,
} from '../../common/enums';
import { MembershipStatus } from '../../common/enums/rbac';
import { NotificationsService } from '../notifications/notifications.service';
import { FRAUD_ENGINE_VERSION, FraudAssessmentResult, FraudContext } from './fraud.types';
import { FraudDecisionService } from './fraud-decision.service';
import { FraudPolicyService } from './fraud-policy.service';
import { FraudScoreService } from './fraud-score.service';
import { FraudSignalRegistry } from './fraud-signal-registry';
import { FRAUD_MODEL_PROVIDER } from './model/fraud-model.provider';
import type { FraudModelProvider } from './model/fraud-model.provider';

@Injectable()
export class FraudEngineService {
  constructor(
    private readonly registry: FraudSignalRegistry,
    private readonly policyService: FraudPolicyService,
    private readonly scoreService: FraudScoreService,
    private readonly decisionService: FraudDecisionService,
    private readonly notificationsService: NotificationsService,
    @Optional() @Inject(FRAUD_MODEL_PROVIDER) private readonly modelProvider?: FraudModelProvider,
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

    const ruleAggregate = this.scoreService.aggregate(signals, policy);
    const aggregate = await this.blendModelPrediction(ruleAggregate, signals);
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
      await this.notifyFraudReview(context, assessment.id, aggregate.score, decision, signals);
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

  private async blendModelPrediction(
    ruleAggregate: { score: number; confidence: number; riskLevel: any; categoryScores: Record<string, number> },
    signals: Array<{ code: FraudSignalCode; detected: boolean; metadata?: Record<string, unknown> }>,
  ) {
    if (!this.modelProvider) return ruleAggregate;

    const trustSignal = signals.find((signal) => signal.code === FraudSignalCode.AFFILIATE_LOW_TRUST);
    const featureVector = {
      score: ruleAggregate.score,
      confidence: ruleAggregate.confidence,
      categoryScores: ruleAggregate.categoryScores,
      signalCodes: signals.filter((signal) => signal.detected).map((signal) => signal.code),
      affiliateTrustScore: trustSignal?.metadata?.trustScore as number | undefined,
    };

    let prediction;
    try {
      prediction = await this.modelProvider.predict(featureVector);
    } catch {
      return ruleAggregate;
    }

    // A no-op/unconfigured model provider reports confidence 0, so the rule-based score is
    // used unchanged (current behavior is preserved). Once a real model is plugged in, its
    // prediction is blended in proportion to its own confidence, capped so the fully
    // explainable rule engine always keeps the majority say in the final decision.
    if (!prediction || prediction.confidence <= 0) return ruleAggregate;

    const modelScore = Math.max(0, Math.min(100, Math.round(prediction.probability * 100)));
    const blendWeight = Math.min(0.4, Math.max(0, prediction.confidence) / 100);
    const blendedScore = Math.max(0, Math.min(100, Math.round(ruleAggregate.score * (1 - blendWeight) + modelScore * blendWeight)));

    return {
      ...ruleAggregate,
      score: blendedScore,
      riskLevel: this.scoreService.riskLevel(blendedScore),
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

  private async notifyFraudReview(
    context: FraudContext,
    assessmentId: string,
    score: number,
    decision: FraudDecision,
    signals: any[],
  ) {
    const alertRoles = new Set<Role>([Role.OWNER, Role.ADMIN, Role.RISK_ANALYST, Role.AFFILIATE_MANAGER]);
    const recipients = dbStore.organizationMemberships.filter(
      (membership) =>
        membership.organizationId === context.organizationId &&
        membership.status === MembershipStatus.ACTIVE &&
        alertRoles.has(membership.role),
    );

    const topSignal = signals
      .filter((signal) => signal.detected || signal.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    const entityLabel = context.entityType.toLowerCase();
    const title = decision === FraudDecision.REVIEW
      ? 'Fraud review required'
      : decision === FraudDecision.HOLD
        ? 'Fraud hold applied'
        : 'Fraud blocked';
    const body = `${entityLabel} flagged with risk score ${score}${topSignal?.reason ? `: ${topSignal.reason}` : '.'}`;

    const metadata = {
      assessmentId,
      decision,
      score,
      entityType: context.entityType,
      entityId: context.entityId,
      programId: context.programId,
      affiliateId: context.affiliateId,
      topSignal: topSignal?.code,
    };

    await Promise.allSettled(
      recipients.map((recipient) =>
        this.notificationsService.createNotification({
          userId: recipient.userId,
          organizationId: context.organizationId,
          type: 'fraud',
          title,
          body,
          channel: 'in_app',
          priority: decision === FraudDecision.REVIEW ? 'high' : 'urgent',
          actionUrl: '/app/fraud',
          metadata,
        }),
      ),
    );

    // Platform visibility: severe decisions also surface to super admins.
    if (decision === FraudDecision.HOLD || decision === FraudDecision.BLOCK) {
      const organization = dbStore.organizations.find((o) => o.id === context.organizationId);
      const superAdmins = dbStore.users.filter((u) => u.platformRole === PlatformRole.SUPER_ADMIN);
      await Promise.allSettled(
        superAdmins.map((admin) =>
          this.notificationsService.createNotification({
            userId: admin.id,
            type: 'fraud',
            title: `${title} — ${organization?.name || 'an organization'}`,
            body,
            channel: 'in_app',
            priority: 'urgent',
            actionUrl: '/admin/fraud',
            metadata,
          }),
        ),
      );
    }
  }

  private sanitizeMetadata(metadata?: Record<string, unknown>) {
    if (!metadata) return undefined;
    const { rawIp, email, paymentIdentifier, ...safe } = metadata as any;
    return safe;
  }
}
