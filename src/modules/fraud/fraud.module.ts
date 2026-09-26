import { Module, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { FraudController } from './fraud.controller';
import { AdminFraudController } from './admin-fraud.controller';
import { FraudContextFactory } from './fraud-context.factory';
import { FraudDecisionService } from './fraud-decision.service';
import { FraudEngineService } from './fraud-engine.service';
import { FraudPolicyService } from './fraud-policy.service';
import { FraudScoreService } from './fraud-score.service';
import { FraudService } from './fraud.service';
import { AdminFraudService } from './admin-fraud.service';
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
  controllers: [FraudController, AdminFraudController],
  providers: [
    FraudService,
    AdminFraudService,
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
  exports: [FraudService, AdminFraudService, FraudEngineService, FraudVelocityService],
})
export class FraudModule implements OnModuleInit {
  constructor(
    @Inject(forwardRef(() => FraudSignalRegistry))
    private readonly registry: FraudSignalRegistry,
    @Inject(forwardRef(() => IpReputationSignal))
    private readonly ipReputation: IpReputationSignal,
    @Inject(forwardRef(() => IpVelocitySignal))
    private readonly ipVelocity: IpVelocitySignal,
    @Inject(forwardRef(() => AffiliateVelocitySignal))
    private readonly affiliateVelocity: AffiliateVelocitySignal,
    @Inject(forwardRef(() => DeviceVelocitySignal))
    private readonly deviceVelocity: DeviceVelocitySignal,
    @Inject(forwardRef(() => DuplicateDeviceSignal))
    private readonly duplicateDevice: DuplicateDeviceSignal,
    @Inject(forwardRef(() => GeoMismatchSignal))
    private readonly geoMismatch: GeoMismatchSignal,
    @Inject(forwardRef(() => SelfReferralSignal))
    private readonly selfReferral: SelfReferralSignal,
    @Inject(forwardRef(() => ConversionSpeedSignal))
    private readonly conversionSpeed: ConversionSpeedSignal,
    @Inject(forwardRef(() => DuplicateConversionSignal))
    private readonly duplicateConversion: DuplicateConversionSignal,
    @Inject(forwardRef(() => UserAgentRiskSignal))
    private readonly userAgentRisk: UserAgentRiskSignal,
    @Inject(forwardRef(() => AmountAnomalySignal))
    private readonly amountAnomaly: AmountAnomalySignal,
    @Inject(forwardRef(() => AffiliateTrustSignal))
    private readonly affiliateTrust: AffiliateTrustSignal,
    @Inject(forwardRef(() => AffiliateHighRefundRateSignal))
    private readonly refundRate: AffiliateHighRefundRateSignal,
    @Inject(forwardRef(() => AffiliateHighChargebackRateSignal))
    private readonly chargebackRate: AffiliateHighChargebackRateSignal,
    @Inject(forwardRef(() => PayoutAmountAnomalySignal))
    private readonly payoutAmount: PayoutAmountAnomalySignal,
    @Inject(forwardRef(() => PayoutTrustDropSignal))
    private readonly payoutTrustDrop: PayoutTrustDropSignal,
  ) { }

  onModuleInit() {
    if (!this.registry) return;
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
    ].forEach((signal) => {
      if (signal && this.registry) {
        this.registry.register(signal);
      }
    });
  }
}
