import { Injectable } from '@nestjs/common';
import { FraudRiskLevel } from '../../common/enums';
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
    const totalWeight = detectedCategoryScores
      .reduce((sum, [category]) => sum + Math.max(0, Math.min(50, policy.signalWeights[category] || 0)), 0);

    const weightedScore = totalWeight === 0
      ? 0
      : detectedCategoryScores.reduce((sum, [category, score]) => {
        const weight = Math.max(0, Math.min(50, policy.signalWeights[category] || 0));
        return sum + score * (weight / totalWeight);
      }, 0);

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
