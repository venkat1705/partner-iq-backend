import { Inject, Injectable, Optional } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { ConversionStatus, FraudEntityType, FraudSignalCategory, FraudSignalCode } from '../../../common/enums';
import { FraudContext, FraudSignalEvaluator, FraudSignalResult } from '../fraud.types';
import { FraudVelocityService } from '../velocity/fraud-velocity.service';
import { IP_REPUTATION_PROVIDER } from '../reputation/ip-reputation.service';
import type { IpReputationProvider } from '../reputation/ip-reputation.service';

const safe = (code: FraudSignalCode, category: FraudSignalCategory, reason: string): FraudSignalResult => ({
  code,
  category,
  detected: false,
  score: 0,
  confidence: 70,
  reason,
});

@Injectable()
export class IpReputationSignal implements FraudSignalEvaluator {
  code = FraudSignalCode.IP_REPUTATION;
  category = FraudSignalCategory.NETWORK;

  constructor(
    @Optional() @Inject(IP_REPUTATION_PROVIDER) private readonly reputationProvider?: IpReputationProvider,
  ) {}

  async evaluate(context: FraudContext) {
    const rawIp = String(context.rawIp || '');
    const forwardedChain = rawIp
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const proxyChainDetected = forwardedChain.length > 1;
    const proxyHeaderDetected = /proxy|vpn|tor/i.test(String(context.metadata?.networkHint || ''));

    // Pluggable external reputation lookup (VPN/Tor/datacenter/ASN). The default provider
    // is a no-op that reports "unavailable" until a real provider (e.g. IPQualityScore,
    // MaxMind) is wired in via IP_REPUTATION_PROVIDER in fraud.module.ts — until then this
    // only contributes when a real provider is configured, so behavior is unchanged today.
    const candidateIp = forwardedChain[0] || rawIp || undefined;
    let providerResult: Awaited<ReturnType<IpReputationProvider['lookup']>> | undefined;
    if (this.reputationProvider && candidateIp) {
      try {
        providerResult = await this.reputationProvider.lookup(candidateIp);
      } catch {
        providerResult = undefined;
      }
    }
    const providerAvailable = Boolean(providerResult && !providerResult.unavailable);
    const providerFlagged = providerAvailable && Boolean(providerResult!.vpn || providerResult!.proxy || providerResult!.tor || providerResult!.datacenter);
    const providerRiskScore = providerAvailable ? Math.max(0, Math.min(100, providerResult!.riskScore || 0)) : 0;

    const heuristicDetected = proxyChainDetected || proxyHeaderDetected;
    const detected = heuristicDetected || providerFlagged || providerRiskScore > 0;
    const score = Math.max(heuristicDetected ? 80 : 0, providerFlagged ? 85 : 0, providerRiskScore);

    const reasons: string[] = [];
    if (heuristicDetected) reasons.push('traffic arrived through a forwarded proxy/VPN-style IP chain');
    if (providerFlagged) reasons.push('external reputation lookup flagged this IP as VPN/proxy/Tor/datacenter');
    else if (providerRiskScore > 0) reasons.push(`external reputation lookup reported risk score ${providerRiskScore}`);

    return {
      code: this.code,
      category: this.category,
      detected,
      score,
      confidence: detected ? 82 : providerAvailable ? 65 : 60,
      reason: reasons.length ? `Elevated network risk: ${reasons.join('; ')}.` : 'No proxy/VPN network indicators were observed.',
      metadata: {
        forwardedHops: forwardedChain.length,
        firstHopPresent: Boolean(forwardedChain[0]),
        providerChecked: providerAvailable,
      },
    };
  }
}

@Injectable()
export class IpVelocitySignal implements FraudSignalEvaluator {
  code = FraudSignalCode.IP_VELOCITY;
  category = FraudSignalCategory.NETWORK;
  constructor(private readonly velocity: FraudVelocityService) {}

  async evaluate(context: FraudContext) {
    if (!context.ipHash) return safe(this.code, this.category, 'No privacy-safe IP hash was available.');
    const suffix = context.entityType === FraudEntityType.CONVERSION ? 'conversion:1h' : 'click:1m';
    const ttl = context.entityType === FraudEntityType.CONVERSION ? 3600 : 60;
    const count = await this.velocity.increment(`fraud:v1:ip:${context.organizationId}:${context.ipHash}:${suffix}`, ttl);
    const score = count > 120 ? 85 : count > 30 ? 55 : count > 10 ? 25 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: count > 30 ? 90 : 65,
      reason: score > 0 ? `${count} ${context.entityType.toLowerCase()} events were observed from the same IP window.` : 'IP velocity is within expected range.',
      metadata: { count, window: suffix },
    };
  }
}

@Injectable()
export class AffiliateVelocitySignal implements FraudSignalEvaluator {
  code = FraudSignalCode.AFFILIATE_VELOCITY;
  category = FraudSignalCategory.TRAFFIC;
  constructor(private readonly velocity: FraudVelocityService) {}

  async evaluate(context: FraudContext) {
    if (!context.affiliateId) return safe(this.code, this.category, 'No affiliate was attached to this event.');
    const count = await this.velocity.increment(`fraud:v1:affiliate:${context.organizationId}:${context.affiliateId}:1h`, 3600);
    const score = count > 500 ? 80 : count > 100 ? 45 : count > 30 ? 20 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: count > 100 ? 85 : 60,
      reason: score > 0 ? `${count} affiliate events were observed in the current hour.` : 'Affiliate event velocity is within expected range.',
      metadata: { count, window: '1h' },
    };
  }
}

@Injectable()
export class DeviceVelocitySignal implements FraudSignalEvaluator {
  code = FraudSignalCode.DEVICE_VELOCITY;
  category = FraudSignalCategory.DEVICE;
  constructor(private readonly velocity: FraudVelocityService) {}

  async evaluate(context: FraudContext) {
    if (!context.deviceId) return safe(this.code, this.category, 'No first-party device identifier was available.');
    const count = await this.velocity.increment(`fraud:v1:device:${context.organizationId}:${context.deviceId}:1h`, 3600);
    const score = count > 100 ? 75 : count > 30 ? 40 : count > 10 ? 15 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: count > 30 ? 80 : 55,
      reason: score > 0 ? `${count} events were observed from the same first-party device in one hour.` : 'Device velocity is normal.',
      metadata: { count, window: '1h' },
    };
  }
}

@Injectable()
export class DuplicateDeviceSignal implements FraudSignalEvaluator {
  code = FraudSignalCode.DUPLICATE_DEVICE;
  category = FraudSignalCategory.DEVICE;

  async evaluate(context: FraudContext) {
    if (!context.deviceId) return safe(this.code, this.category, 'No first-party device identifier was available.');
    const affiliateIds = new Set(
      dbStore.clicks
        .filter((click) => click.organizationId === context.organizationId && click.anonymousId === context.deviceId)
        .map((click) => click.affiliateId),
    );
    const score = affiliateIds.size > 8 ? 70 : affiliateIds.size > 3 ? 35 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: affiliateIds.size > 3 ? 82 : 60,
      reason: score > 0 ? `This device has appeared across ${affiliateIds.size} affiliate accounts.` : 'Device has not appeared across unusual affiliate clusters.',
      metadata: { distinctAffiliates: affiliateIds.size },
    };
  }
}

@Injectable()
export class GeoMismatchSignal implements FraudSignalEvaluator {
  code = FraudSignalCode.GEO_MISMATCH;
  category = FraudSignalCategory.CONVERSION;

  async evaluate(context: FraudContext) {
    const conversionCountry = String(context.metadata?.paymentCountry || context.metadata?.country || '').toUpperCase();
    if (!context.country || !conversionCountry) return safe(this.code, this.category, 'Insufficient country data for geo comparison.');
    const detected = context.country.toUpperCase() !== conversionCountry;
    return {
      code: this.code,
      category: this.category,
      detected,
      score: detected ? 20 : 0,
      confidence: detected ? 70 : 60,
      reason: detected ? `Click country ${context.country} differs from payment country ${conversionCountry}.` : 'Click and conversion geography are aligned.',
      metadata: { clickCountry: context.country, conversionCountry },
    };
  }
}

@Injectable()
export class SelfReferralSignal implements FraudSignalEvaluator {
  code = FraudSignalCode.SELF_REFERRAL;
  category = FraudSignalCategory.IDENTITY;

  async evaluate(context: FraudContext) {
    const affiliate = context.affiliateId
      ? dbStore.affiliates.find((item) => item.id === context.affiliateId && item.organizationId === context.organizationId)
      : undefined;
    const detected = Boolean(affiliate?.email && context.customerExternalId && affiliate.email.toLowerCase() === context.customerExternalId.toLowerCase());
    return {
      code: this.code,
      category: this.category,
      detected,
      score: detected ? 85 : 0,
      confidence: detected ? 92 : 65,
      reason: detected ? 'Customer identifier matches the affiliate email on record.' : 'No self-referral identity match was found.',
    };
  }
}

@Injectable()
export class ConversionSpeedSignal implements FraudSignalEvaluator {
  code = FraudSignalCode.FAST_CONVERSION;
  category = FraudSignalCategory.BEHAVIOR;

  async evaluate(context: FraudContext) {
    if (!context.clickedAt || !context.convertedAt) return safe(this.code, this.category, 'Click-to-conversion timing is unavailable.');
    const seconds = Math.max(0, Math.round((context.convertedAt.getTime() - context.clickedAt.getTime()) / 1000));
    const score = seconds < 5 ? 55 : seconds < 20 ? 25 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: score > 0 ? 78 : 65,
      reason: score > 0 ? `Conversion occurred ${seconds}s after click, which is unusually fast.` : 'Click-to-conversion timing is normal.',
      metadata: { seconds },
    };
  }
}

@Injectable()
export class DuplicateConversionSignal implements FraudSignalEvaluator {
  code = FraudSignalCode.DUPLICATE_CONVERSION;
  category = FraudSignalCategory.CONVERSION;

  async evaluate(context: FraudContext) {
    const externalId = String(context.metadata?.externalId || '');
    if (!externalId) return safe(this.code, this.category, 'No external conversion identifier was provided.');
    const duplicates = dbStore.conversions.filter(
      (item) => item.organizationId === context.organizationId && item.externalId === externalId && item.id !== context.conversionId,
    );
    return {
      code: this.code,
      category: this.category,
      detected: duplicates.length > 0,
      score: duplicates.length > 0 ? 95 : 0,
      confidence: duplicates.length > 0 ? 98 : 80,
      reason: duplicates.length > 0 ? `External conversion id ${externalId} already exists for this organization.` : 'No duplicate conversion id was found.',
      metadata: { duplicateCount: duplicates.length },
    };
  }
}

@Injectable()
export class UserAgentRiskSignal implements FraudSignalEvaluator {
  code = FraudSignalCode.SUSPICIOUS_USER_AGENT;
  category = FraudSignalCategory.TRAFFIC;

  async evaluate(context: FraudContext) {
    const ua = context.userAgent || '';
    const suspicious = !ua || /bot|crawler|spider|curl|wget|python|headless|phantom/i.test(ua);
    return {
      code: this.code,
      category: this.category,
      detected: suspicious,
      score: suspicious ? 25 : 0,
      confidence: suspicious ? 72 : 65,
      reason: suspicious ? 'User agent is missing or matches a known automation pattern.' : 'User agent appears normal.',
      metadata: { userAgentPresent: Boolean(ua) },
    };
  }
}

@Injectable()
export class AmountAnomalySignal implements FraudSignalEvaluator {
  code = FraudSignalCode.AMOUNT_ANOMALY;
  category = FraudSignalCategory.PAYMENT;

  async evaluate(context: FraudContext) {
    if (!context.amount) return safe(this.code, this.category, 'No monetary amount was available.');
    const historical = dbStore.conversions
      .filter((item) => item.organizationId === context.organizationId && item.programId === context.programId && item.id !== context.conversionId)
      .map((item) => item.amount)
      .sort((a, b) => a - b);
    if (historical.length < 5) return safe(this.code, this.category, 'Not enough historical sample size for amount anomaly scoring.');
    const median = historical[Math.floor(historical.length / 2)];
    const ratio = median > 0 ? context.amount / median : 1;
    const score = ratio > 8 ? 60 : ratio > 4 ? 30 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: historical.length > 20 ? 80 : 55,
      reason: score > 0 ? `Conversion amount is ${ratio.toFixed(1)}x the program median.` : 'Conversion amount is within historical range.',
      metadata: { sampleSize: historical.length, median, ratio },
    };
  }
}

@Injectable()
export class AffiliateTrustSignal implements FraudSignalEvaluator {
  code = FraudSignalCode.AFFILIATE_LOW_TRUST;
  category = FraudSignalCategory.AFFILIATE;

  async evaluate(context: FraudContext) {
    const affiliate = context.affiliateId
      ? dbStore.affiliates.find((item) => item.id === context.affiliateId && item.organizationId === context.organizationId)
      : undefined;
    const trustScore = affiliate?.trustScore ?? 50;
    const score = trustScore < 20 ? 70 : trustScore < 40 ? 35 : trustScore < 55 ? 10 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: 75,
      reason: score > 0 ? `Affiliate trust score is ${trustScore}/100.` : `Affiliate trust score is ${trustScore}/100 and within acceptable range.`,
      metadata: { trustScore },
    };
  }
}

@Injectable()
export class AffiliateHighRefundRateSignal implements FraudSignalEvaluator {
  code = FraudSignalCode.AFFILIATE_HIGH_REFUND_RATE;
  category = FraudSignalCategory.AFFILIATE;

  async evaluate(context: FraudContext) {
    if (!context.affiliateId) return safe(this.code, this.category, 'No affiliate was attached to this event.');
    const conversions = dbStore.conversions.filter((item) => item.organizationId === context.organizationId && item.affiliateId === context.affiliateId);
    if (conversions.length < 10) return safe(this.code, this.category, 'Minimum sample size for refund-rate scoring has not been reached.');
    const refunded = conversions.filter((item) => item.status === ConversionStatus.REFUNDED).length;
    const rate = refunded / conversions.length;
    const score = rate > 0.3 ? 55 : rate > 0.15 ? 25 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: conversions.length > 30 ? 82 : 60,
      reason: score > 0 ? `Affiliate refund rate is ${(rate * 100).toFixed(1)}% across ${conversions.length} conversions.` : 'Affiliate refund rate is within expected range.',
      metadata: { sampleSize: conversions.length, refundRate: rate },
    };
  }
}

@Injectable()
export class PayoutAmountAnomalySignal implements FraudSignalEvaluator {
  code = FraudSignalCode.PAYOUT_AMOUNT_ANOMALY;
  category = FraudSignalCategory.PAYOUT;

  async evaluate(context: FraudContext) {
    if (context.entityType !== FraudEntityType.PAYOUT || !context.amount) return safe(this.code, this.category, 'Not a payout amount assessment.');
    const historical = dbStore.payoutBatches
      .filter((item) => item.organizationId === context.organizationId && item.id !== context.payoutId)
      .map((item) => item.totalAmount)
      .sort((a, b) => a - b);
    const baseline = historical.length ? historical[Math.floor(historical.length / 2)] : 500000;
    const ratio = baseline > 0 ? context.amount / baseline : 1;
    const score = context.amount >= 2000000 || ratio > 4 ? 70 : ratio > 2 ? 30 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: historical.length > 3 ? 75 : 55,
      reason: score > 0 ? `Payout amount is ${ratio.toFixed(1)}x the historical baseline.` : 'Payout amount is within expected range.',
      metadata: { baseline, ratio },
    };
  }
}

@Injectable()
export class AffiliateHighChargebackRateSignal implements FraudSignalEvaluator {
  code = FraudSignalCode.AFFILIATE_HIGH_CHARGEBACK_RATE;
  category = FraudSignalCategory.AFFILIATE;

  async evaluate(context: FraudContext) {
    if (!context.affiliateId) return safe(this.code, this.category, 'No affiliate was attached to this event.');
    const conversions = dbStore.conversions.filter((item) => item.organizationId === context.organizationId && item.affiliateId === context.affiliateId);
    if (conversions.length < 10) return safe(this.code, this.category, 'Minimum sample size for chargeback-rate scoring has not been reached.');
    const chargedBack = conversions.filter((item) => item.status === ConversionStatus.CHARGEBACK).length;
    const rate = chargedBack / conversions.length;
    const score = rate > 0.1 ? 70 : rate > 0.05 ? 35 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: conversions.length > 30 ? 85 : 62,
      reason: score > 0 ? `Affiliate chargeback rate is ${(rate * 100).toFixed(1)}% across ${conversions.length} conversions.` : 'Affiliate chargeback rate is within expected range.',
      metadata: { sampleSize: conversions.length, chargebackRate: rate },
    };
  }
}

@Injectable()
export class PayoutTrustDropSignal implements FraudSignalEvaluator {
  code = FraudSignalCode.PAYOUT_TRUST_DROP;
  category = FraudSignalCategory.PAYOUT;

  async evaluate(context: FraudContext) {
    if (context.entityType !== FraudEntityType.PAYOUT || !context.affiliateId) {
      return safe(this.code, this.category, 'Not a payout assessment with an identifiable affiliate.');
    }
    const affiliate = dbStore.affiliates.find((item) => item.id === context.affiliateId && item.organizationId === context.organizationId);
    if (!affiliate) return safe(this.code, this.category, 'Affiliate record was not found.');

    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentHistory = dbStore.affiliateTrustHistory
      .filter((entry) => entry.organizationId === context.organizationId && entry.affiliateId === context.affiliateId && entry.createdAt >= windowStart)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    if (recentHistory.length === 0) return safe(this.code, this.category, 'No recent trust score history for this affiliate.');

    const earliestScore = recentHistory[0].previousScore;
    const currentScore = affiliate.trustScore ?? recentHistory[recentHistory.length - 1].newScore;
    const drop = earliestScore - currentScore;
    const score = drop >= 30 ? 65 : drop >= 15 ? 30 : 0;

    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: 70,
      reason: score > 0
        ? `Affiliate trust score dropped ${drop} points in the last 30 days (from ${earliestScore} to ${currentScore}).`
        : 'Affiliate trust score has been stable over the last 30 days.',
      metadata: { earliestScore, currentScore, drop },
    };
  }
}
