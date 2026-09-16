import { Injectable } from '@nestjs/common';
import { dbStore } from '../../database/store';
import { FraudSensitivity, FraudSignalCode } from '../../common/enums';
import { FraudPolicy } from './fraud.types';

export const DEFAULT_ENABLED_SIGNALS = [
  FraudSignalCode.IP_REPUTATION,
  FraudSignalCode.IP_VELOCITY,
  FraudSignalCode.AFFILIATE_VELOCITY,
  FraudSignalCode.DEVICE_VELOCITY,
  FraudSignalCode.DUPLICATE_DEVICE,
  FraudSignalCode.GEO_MISMATCH,
  FraudSignalCode.SELF_REFERRAL,
  FraudSignalCode.FAST_CONVERSION,
  FraudSignalCode.DUPLICATE_CONVERSION,
  FraudSignalCode.SUSPICIOUS_USER_AGENT,
  FraudSignalCode.AMOUNT_ANOMALY,
  FraudSignalCode.AFFILIATE_LOW_TRUST,
  FraudSignalCode.AFFILIATE_HIGH_REFUND_RATE,
  FraudSignalCode.PAYOUT_AMOUNT_ANOMALY,
];

export const DEFAULT_SIGNAL_WEIGHTS: Record<string, number> = {
  NETWORK: 20,
  DEVICE: 20,
  TRAFFIC: 20,
  CONVERSION: 20,
  AFFILIATE: 20,
  IDENTITY: 15,
  BEHAVIOR: 15,
  PAYMENT: 15,
  PAYOUT: 30,
};

export interface FraudScoreThresholds {
  allowMaxScore: number;
  reviewMaxScore: number;
  blockMinScore: number;
  payoutHoldScore: number;
}

// Sensitivity presets applied when an org selects a sensitivity level without overriding
// individual thresholds — this is what makes the `sensitivity` setting (LOW/BALANCED/STRICT)
// actually change scoring behavior instead of being stored but never read. CUSTOM implies the
// admin supplies explicit thresholds; the BALANCED numbers are only a fallback for any they omit.
export const SENSITIVITY_THRESHOLD_PRESETS: Record<FraudSensitivity, FraudScoreThresholds> = {
  [FraudSensitivity.STRICT]: { allowMaxScore: 15, reviewMaxScore: 40, blockMinScore: 41, payoutHoldScore: 41 },
  [FraudSensitivity.BALANCED]: { allowMaxScore: 30, reviewMaxScore: 70, blockMinScore: 71, payoutHoldScore: 71 },
  [FraudSensitivity.LOW]: { allowMaxScore: 50, reviewMaxScore: 85, blockMinScore: 86, payoutHoldScore: 86 },
  [FraudSensitivity.CUSTOM]: { allowMaxScore: 30, reviewMaxScore: 70, blockMinScore: 71, payoutHoldScore: 71 },
};

@Injectable()
export class FraudPolicyService {
  resolvePolicy(organizationId: string, programId?: string): FraudPolicy {
    const settings =
      (programId && dbStore.fraudSettings.find((item) => item.organizationId === organizationId && item.programId === programId)) ||
      dbStore.fraudSettings.find((item) => item.organizationId === organizationId && !item.programId);

    if (!settings) {
      return {
        enabled: true,
        sensitivity: FraudSensitivity.BALANCED,
        allowMaxScore: 30,
        reviewMaxScore: 70,
        blockMinScore: 71,
        payoutHoldScore: 71,
        enabledSignals: DEFAULT_ENABLED_SIGNALS,
        signalWeights: this.defaultWeights(),
        policyVersion: 'system-default-v1',
      };
    }

    return {
      enabled: settings.enabled,
      sensitivity: settings.sensitivity,
      allowMaxScore: settings.allowMaxScore,
      reviewMaxScore: settings.reviewMaxScore,
      blockMinScore: settings.blockMinScore,
      payoutHoldScore: settings.payoutHoldScore,
      enabledSignals: settings.enabledSignals?.length ? settings.enabledSignals : DEFAULT_ENABLED_SIGNALS,
      signalWeights: { ...this.defaultWeights(), ...(settings.signalWeights || {}) },
      policyVersion: `settings-${settings.id}`,
    };
  }

  defaultWeights() {
    return { ...DEFAULT_SIGNAL_WEIGHTS };
  }
}
