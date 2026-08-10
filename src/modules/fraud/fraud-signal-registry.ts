import { Injectable } from '@nestjs/common';
import { FraudSignalCode } from '../../common/enums';
import { FraudSignalEvaluator } from './fraud.types';

@Injectable()
export class FraudSignalRegistry {
  private readonly evaluators = new Map<FraudSignalCode, FraudSignalEvaluator>();

  register(evaluator: FraudSignalEvaluator) {
    this.evaluators.set(evaluator.code, evaluator);
  }

  getEnabled(codes: FraudSignalCode[]) {
    return codes.map((code) => this.evaluators.get(code)).filter(Boolean) as FraudSignalEvaluator[];
  }

  all() {
    return Array.from(this.evaluators.values());
  }
}
