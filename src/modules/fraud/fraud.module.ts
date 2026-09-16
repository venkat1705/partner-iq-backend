import { Module, OnModuleInit } from '@nestjs/common';
import { FraudController } from './fraud.controller';
import { FraudContextFactory } from './fraud-context.factory';
import { FraudDecisionService } from './fraud-decision.service';
import { FraudEngineService } from './fraud-engine.service';
import { FraudPolicyService } from './fraud-policy.service';
import { FraudScoreService } from './fraud-score.service';
import { FraudService } from './fraud.service';
import { FraudSignalRegistry } from './fraud-signal-registry';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { LedgerModule } from '../ledger/ledger.module';
import { IP_REPUTATION_PROVIDER, NoOpIpReputationProvider } from './reputation/ip-reputation.service';
import { FRAUD_MODEL_PROVIDER, NoOpFraudModelProvider } from './model/fraud-model.provider';
import {
  AffiliateHighChargebackRateSignal,
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
  PayoutTrustDropSignal,
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
  AffiliateHighChargebackRateSignal,
  PayoutAmountAnomalySignal,
  PayoutTrustDropSignal,
];

@Module({
  imports: [NotificationsModule, WebhooksModule, CommissionsModule, LedgerModule],
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
    // Pluggable, swappable integrations. Both default to a no-op implementation so behavior
    // is unchanged until a real provider (external IP reputation API, ML fraud model) is
    // configured — swap the `useClass` below to point at a real implementation.
    { provide: IP_REPUTATION_PROVIDER, useClass: NoOpIpReputationProvider },
    { provide: FRAUD_MODEL_PROVIDER, useClass: NoOpFraudModelProvider },
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
    private readonly chargebackRate: AffiliateHighChargebackRateSignal,
    private readonly payoutAmount: PayoutAmountAnomalySignal,
    private readonly payoutTrustDrop: PayoutTrustDropSignal,
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
      this.chargebackRate,
      this.payoutAmount,
      this.payoutTrustDrop,
    ].forEach((signal) => this.registry.register(signal));
  }
}
