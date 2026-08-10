import { Module, OnModuleInit } from '@nestjs/common';
import { FraudController } from './fraud.controller';
import { FraudContextFactory } from './fraud-context.factory';
import { FraudDecisionService } from './fraud-decision.service';
import { FraudEngineService } from './fraud-engine.service';
import { FraudPolicyService } from './fraud-policy.service';
import { FraudScoreService } from './fraud-score.service';
import { FraudService } from './fraud.service';
import { FraudSignalRegistry } from './fraud-signal-registry';
import {
  AffiliateHighRefundRateSignal,
  AffiliateTrustSignal,
  AffiliateVelocitySignal,
  AmountAnomalySignal,
  ConversionSpeedSignal,
  DeviceVelocitySignal,
  DuplicateConversionSignal,
  DuplicateDeviceSignal,
  GeoMismatchSignal,
  IpReputationSignal,
  IpVelocitySignal,
  PayoutAmountAnomalySignal,
  SelfReferralSignal,
  UserAgentRiskSignal,
} from './signals/phase-one-signals';
import { FraudVelocityService } from './velocity/fraud-velocity.service';

const signalProviders = [
  IpReputationSignal,
  IpVelocitySignal,
  AffiliateVelocitySignal,
  DeviceVelocitySignal,
  DuplicateDeviceSignal,
  GeoMismatchSignal,
  SelfReferralSignal,
  ConversionSpeedSignal,
  DuplicateConversionSignal,
  UserAgentRiskSignal,
  AmountAnomalySignal,
  AffiliateTrustSignal,
  AffiliateHighRefundRateSignal,
  PayoutAmountAnomalySignal,
];

@Module({
  controllers: [FraudController],
  providers: [
    FraudService,
    FraudEngineService,
    FraudScoreService,
    FraudDecisionService,
    FraudPolicyService,
    FraudContextFactory,
    FraudSignalRegistry,
    FraudVelocityService,
    ...signalProviders,
  ],
  exports: [FraudService, FraudEngineService, FraudVelocityService],
})
export class FraudModule implements OnModuleInit {
  constructor(
    private readonly registry: FraudSignalRegistry,
    private readonly ipReputation: IpReputationSignal,
    private readonly ipVelocity: IpVelocitySignal,
    private readonly affiliateVelocity: AffiliateVelocitySignal,
    private readonly deviceVelocity: DeviceVelocitySignal,
    private readonly duplicateDevice: DuplicateDeviceSignal,
    private readonly geoMismatch: GeoMismatchSignal,
    private readonly selfReferral: SelfReferralSignal,
    private readonly conversionSpeed: ConversionSpeedSignal,
    private readonly duplicateConversion: DuplicateConversionSignal,
    private readonly userAgentRisk: UserAgentRiskSignal,
    private readonly amountAnomaly: AmountAnomalySignal,
    private readonly affiliateTrust: AffiliateTrustSignal,
    private readonly refundRate: AffiliateHighRefundRateSignal,
    private readonly payoutAmount: PayoutAmountAnomalySignal,
  ) {}

  onModuleInit() {
    [
      this.ipReputation,
      this.ipVelocity,
      this.affiliateVelocity,
      this.deviceVelocity,
      this.duplicateDevice,
      this.geoMismatch,
      this.selfReferral,
      this.conversionSpeed,
      this.duplicateConversion,
      this.userAgentRisk,
      this.amountAnomaly,
      this.affiliateTrust,
      this.refundRate,
      this.payoutAmount,
    ].forEach((signal) => this.registry.register(signal));
  }
}
