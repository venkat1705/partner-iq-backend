import { Injectable } from '@nestjs/common';
import { FraudDecision, FraudEntityType } from '../../common/enums';
import { FraudContext, FraudPolicy } from './fraud.types';

@Injectable()
export class FraudDecisionService {
  decide(context: FraudContext, score: number, policy: FraudPolicy) {
    if (!policy.enabled) return FraudDecision.ALLOW;
    if (context.entityType === FraudEntityType.PAYOUT) {
      if (score >= policy.payoutHoldScore) return FraudDecision.HOLD;
      if (score > policy.allowMaxScore) return FraudDecision.REVIEW;
      return FraudDecision.ALLOW;
    }
    if (score >= policy.blockMinScore) return FraudDecision.BLOCK;
    if (score > policy.allowMaxScore && score <= policy.reviewMaxScore) return FraudDecision.REVIEW;
    return FraudDecision.ALLOW;
  }
}
