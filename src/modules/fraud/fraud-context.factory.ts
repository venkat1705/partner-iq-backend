import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ClickEntity, ConversionEntity, PayoutBatchEntity, dbStore } from '../../database/store';
import { FraudEntityType } from '../../common/enums';
import { FraudContext } from './fraud.types';

@Injectable()
export class FraudContextFactory {
  fromClick(click: ClickEntity, rawIp?: string): FraudContext {
    return {
      organizationId: click.organizationId,
      programId: click.programId,
      entityType: FraudEntityType.CLICK,
      entityId: click.id,
      clickId: click.id,
      affiliateId: click.affiliateId,
      anonymousId: click.anonymousId,
      ipHash: click.ipHash,
      rawIp,
      deviceId: click.anonymousId,
      userAgent: click.userAgent,
      referrer: click.referrer,
      country: click.country,
      occurredAt: click.createdAt,
      metadata: { trackingLinkId: click.trackingLinkId },
    };
  }

  fromConversion(conversion: ConversionEntity): FraudContext {
    const attribution = dbStore.attributions.find(
      (item) =>
        item.organizationId === conversion.organizationId &&
        item.affiliateId === conversion.affiliateId &&
        (item.customerExternalId === conversion.customerExternalId || item.anonymousId === conversion.customerExternalId),
    );
    const click = attribution ? dbStore.clicks.find((item) => item.id === attribution.clickId) : undefined;

    return {
      organizationId: conversion.organizationId,
      programId: conversion.programId,
      entityType: FraudEntityType.CONVERSION,
      entityId: conversion.id,
      conversionId: conversion.id,
      clickId: click?.id,
      affiliateId: conversion.affiliateId,
      anonymousId: attribution?.anonymousId,
      customerExternalId: conversion.customerExternalId,
      ipHash: click?.ipHash,
      deviceId: attribution?.anonymousId,
      userAgent: click?.userAgent,
      referrer: click?.referrer,
      country: click?.country,
      amount: conversion.amount,
      currency: conversion.currency,
      clickedAt: click?.createdAt,
      convertedAt: conversion.occurredAt,
      occurredAt: conversion.occurredAt || conversion.createdAt,
      metadata: { externalId: conversion.externalId, productId: conversion.productId },
    };
  }

  fromPayout(batch: PayoutBatchEntity): FraudContext {
    const items = dbStore.payoutItems.filter((item) => item.batchId === batch.id);
    const firstItem = items[0];
    const programId = dbStore.programs.find((program) => program.organizationId === batch.organizationId)?.id || '00000000-0000-0000-0000-000000000000';

    return {
      organizationId: batch.organizationId,
      programId,
      entityType: FraudEntityType.PAYOUT,
      entityId: batch.id,
      payoutId: batch.id,
      affiliateId: firstItem?.affiliateId,
      amount: batch.totalAmount,
      currency: batch.currency,
      occurredAt: new Date(),
      metadata: { payoutItems: items.length },
    };
  }

  hashIp(rawIp?: string) {
    if (!rawIp) return undefined;
    return createHmac('sha256', process.env.FRAUD_IP_HASH_SECRET || process.env.JWT_SECRET || 'partneriq-fraud-ip-salt')
      .update(rawIp)
      .digest('hex');
  }
}
