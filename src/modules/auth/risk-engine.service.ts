import { Injectable, Logger } from '@nestjs/common';
import { RiskLevel } from '../../common/enums';

export interface RiskSignal {
  code: string;
  label: string;
  score: number;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  requiresMfa: boolean;
  blockLogin: boolean;
  signals: RiskSignal[];
}

export interface RiskInput {
  isNewDevice: boolean;
  isNewCountry: boolean;
  isKnownTrustedDevice: boolean;
  isPreviousKnownDevice: boolean;
  recentFailedAttempts: number;
  refreshTokenReuseDetected: boolean;
  recentPasswordChange: boolean;
  recentMfaChange: boolean;
  organizationRequiresMfa: boolean;
  mfaEnabled: boolean;
  suspiciousIp?: boolean;
  impossibleTravel?: boolean;
}

// Risk thresholds configurable via environment variables
function getThresholds() {
  return {
    high: parseInt(process.env.RISK_HIGH_THRESHOLD || '60', 10),
    critical: parseInt(process.env.RISK_CRITICAL_THRESHOLD || '80', 10),
  };
}

// Signal scoring weights
const SIGNAL_WEIGHTS: Record<string, { score: number; label: string }> = {
  new_device: { score: 20, label: 'Login from new device' },
  new_country: { score: 30, label: 'Login from new country' },
  impossible_travel: { score: 50, label: 'Impossible travel detected' },
  failed_attempts_moderate: { score: 15, label: 'Recent failed login attempts' },
  failed_attempts_high: { score: 30, label: 'Many recent failed login attempts' },
  token_reuse: { score: 80, label: 'Refresh token reuse detected' },
  recent_password_change: { score: 10, label: 'Password changed recently' },
  recent_mfa_change: { score: 15, label: 'MFA configuration changed recently' },
  suspicious_ip: { score: 25, label: 'Suspicious IP address' },
  trusted_device: { score: -20, label: 'Known trusted device' },
  known_device: { score: -10, label: 'Previously seen device' },
};

@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name);

  /**
   * Evaluate login risk from contextual signals.
   * This is a deterministic, rule-based engine — no AI/ML required.
   */
  evaluate(input: RiskInput): RiskAssessment {
    const activeSignals: RiskSignal[] = [];
    let score = 0;

    const addSignal = (code: string, overrideScore?: number) => {
      const def = SIGNAL_WEIGHTS[code];
      if (!def) return;
      const s = overrideScore ?? def.score;
      score += s;
      activeSignals.push({ code, label: def.label, score: s });
    };

    // Positive risk factors
    if (input.isNewDevice) addSignal('new_device');
    if (input.isNewCountry) addSignal('new_country');
    if (input.impossibleTravel) addSignal('impossible_travel');
    if (input.suspiciousIp) addSignal('suspicious_ip');
    if (input.refreshTokenReuseDetected) addSignal('token_reuse');
    if (input.recentPasswordChange) addSignal('recent_password_change');
    if (input.recentMfaChange) addSignal('recent_mfa_change');

    if (input.recentFailedAttempts >= 3 && input.recentFailedAttempts < 5) {
      addSignal('failed_attempts_moderate');
    } else if (input.recentFailedAttempts >= 5) {
      addSignal('failed_attempts_high');
    }

    // Trust modifiers
    if (input.isKnownTrustedDevice) addSignal('trusted_device');
    else if (input.isPreviousKnownDevice) addSignal('known_device');

    // Clamp score to minimum 0
    score = Math.max(0, score);

    const thresholds = getThresholds();
    const level = this.scoreToLevel(score, thresholds);
    const requiresMfa = level !== RiskLevel.LOW || input.organizationRequiresMfa;
    const blockLogin = level === RiskLevel.CRITICAL && input.refreshTokenReuseDetected;

    this.logger.debug(`Risk assessment: score=${score} level=${level} signals=[${activeSignals.map(s => s.code).join(',')}]`);

    return {
      score,
      level,
      requiresMfa,
      blockLogin,
      signals: activeSignals,
    };
  }

  private scoreToLevel(score: number, thresholds: { high: number; critical: number }): RiskLevel {
    if (score >= thresholds.critical) return RiskLevel.CRITICAL;
    if (score >= thresholds.high) return RiskLevel.HIGH;
    if (score >= 30) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }
}
