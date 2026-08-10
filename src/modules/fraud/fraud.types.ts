import {
  FraudAssessmentType,
  FraudDecision,
  FraudEntityType,
  FraudRiskLevel,
  FraudSensitivity,
  FraudSignalCategory,
  FraudSignalCode,
} from '../../common/enums';

export const FRAUD_ENGINE_VERSION = 'fraud-v1';

export interface FraudContext {
  organizationId: string;
  programId: string;
  entityType: FraudEntityType;
  entityId: string;
  affiliateId?: string;
  clickId?: string;
  conversionId?: string;
  payoutId?: string;
  anonymousId?: string;
  customerExternalId?: string;
  ipHash?: string;
  rawIp?: string;
  deviceId?: string;
  sessionId?: string;
  userAgent?: string;
  referrer?: string;
  country?: string;
  region?: string;
  amount?: number;
  currency?: string;
  clickedAt?: Date;
  convertedAt?: Date;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

export interface FraudSignalResult {
  code: FraudSignalCode;
  category: FraudSignalCategory;
  detected: boolean;
  score: number;
  confidence: number;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface FraudSignalEvaluator {
  readonly code: FraudSignalCode;
  readonly category: FraudSignalCategory;
  evaluate(context: FraudContext): Promise<FraudSignalResult>;
}

export interface FraudPolicy {
  enabled: boolean;
  sensitivity: FraudSensitivity;
  allowMaxScore: number;
  reviewMaxScore: number;
  blockMinScore: number;
  payoutHoldScore: number;
  enabledSignals: FraudSignalCode[];
  signalWeights: Record<string, number>;
  policyVersion?: string;
}

export interface FraudAssessmentResult {
  assessmentId: string;
  score: number;
  confidence: number;
  riskLevel: FraudRiskLevel;
  decision: FraudDecision;
  assessmentType: FraudAssessmentType;
  categoryScores: Record<string, number>;
  signals: FraudSignalResult[];
}
