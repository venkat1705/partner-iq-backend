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

export class NoOpFraudModelProvider implements FraudModelProvider {
  async predict(): Promise<FraudModelPrediction> {
    return {
      probability: 0,
      confidence: 0,
      modelVersion: 'disabled',
    };
  }
}
