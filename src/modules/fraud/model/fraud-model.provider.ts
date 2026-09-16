import { Injectable } from '@nestjs/common';

export const FRAUD_MODEL_PROVIDER = Symbol('FRAUD_MODEL_PROVIDER');

export interface FraudFeatureVector {
  score: number;
  confidence: number;
  categoryScores: Record<string, number>;
  signalCodes: string[];
  affiliateTrustScore?: number;
}

export interface FraudModelPrediction {
  probability: number;
  confidence: number;
  modelVersion: string;
}

export interface FraudModelProvider {
  predict(features: FraudFeatureVector): Promise<FraudModelPrediction>;
}

@Injectable()
export class NoOpFraudModelProvider implements FraudModelProvider {
  async predict(): Promise<FraudModelPrediction> {
    return {
      probability: 0,
      confidence: 0,
      modelVersion: 'disabled',
    };
  }
}
