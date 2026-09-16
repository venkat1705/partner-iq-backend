import { Injectable } from '@nestjs/common';
import { FraudRiskLevel } from '../../common/enums';
import { DEFAULT_SIGNAL_WEIGHTS } from './fraud-policy.service';
import { FraudPolicy, FraudSignalResult } from './fraud.types';

@Injectable()
export class FraudScoreService {
  aggregate(signals: FraudSignalResult[], policy: FraudPolicy) {
    const categoryScores: Record<string, number> = {};
    const categoryConfidence: Record<string, number[]> = {};

    for (const signal of signals) {
      const category = signal.category;
      const current = categoryScores[category] || 0;
      categoryScores[category] = Math.max(current, this.clamp(signal.score));
      categoryConfidence[category] = [...(categoryConfidence[category] || []), signal.confidence];
    }

    const detectedCategoryScores = Object.entries(categoryScores).filter(([, score]) => score > 0);

    // Per-category weight acts as a severity multiplier relative to that category's own
    // default weight, not a share of a pool split only among categories that happened to
    // fire. The old formula (score_i * weight_i / sum-of-fired-weights) degenerated to a
    // no-op whenever exactly one category fired — which is the common case — because the
    // weight of the sole contributor always cancelled out of its own denominator. That made
    // an admin's weight setting silently do nothing for single-signal fraud. Here, lowering
    // a category's weight below its default genuinely dampens that category's contribution,
    // and raising it amplifies; leaving all weights at default reproduces the raw scores.
    const effectiveScores = detectedCategoryScores.map(([category, score]) => {
      const configuredWeight = Math.max(0, Math.min(50, policy.signalWeights[category] ?? DEFAULT_SIGNAL_WEIGHTS[category] ?? 20));
      const baselineWeight = Math.max(1, DEFAULT_SIGNAL_WEIGHTS[category] ?? 20);
      const severityMultiplier = configuredWeight / baselineWeight;
      return [category, this.clamp(score * severityMultiplier)] as const;
    });

    // Combine via "dominant signal + diminishing corroboration" rather than a plain average,
    // so a single strong, unambiguous signal (e.g. a duplicate conversion id) is not washed
    // out just because an unrelated, weaker category also happened to fire alongside it.
    const sortedEffectiveScores = [...effectiveScores].sort((a, b) => b[1] - a[1]);
    const weightedScore = sortedEffectiveScores.length
      ? sortedEffectiveScores[0][1] + sortedEffectiveScores.slice(1).reduce((sum, [, s]) => sum + s * 0.15, 0)
      : 0;

    const availableSignals = signals.filter((signal) => signal.confidence > 0).length;
    const avgConfidence = availableSignals
      ? signals.reduce((sum, signal) => sum + signal.confidence, 0) / availableSignals
      : 0;
    const detectedCount = signals.filter((signal) => signal.detected).length;
    const completeness = Math.min(100, (availableSignals / Math.max(1, policy.enabledSignals.length)) * 100);
    const confidence = this.clamp(Math.round(avgConfidence * 0.7 + completeness * 0.2 + Math.min(detectedCount * 4, 10)));

    const score = this.clamp(Math.round(weightedScore));
    return {
      score,
      confidence,
      riskLevel: this.riskLevel(score),
      categoryScores,
    };
  }

  riskLevel(score: number) {
    if (score >= 90) return FraudRiskLevel.CRITICAL;
    if (score >= 71) return FraudRiskLevel.HIGH;
    if (score >= 31) return FraudRiskLevel.MEDIUM;
    return FraudRiskLevel.LOW;
  }

  private clamp(value: number) {
    return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  }
}
