import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { dbStore, ConversionEntity, IdempotencyKeyEntity } from '../../database/store';
import { FraudService } from '../fraud/fraud.service';
import { CommissionsService } from '../commissions/commissions.service';
import { LedgerService } from '../ledger/ledger.service';
import { PerformanceAggregationService } from '../gamification/performance/performance-aggregation.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { AutomationTriggerType, ConversionStatus, FraudDecision, AuditAction, EnvironmentType, LedgerEntryType, WebhookEvent, AffiliateStatus } from '../../common/enums';
import { CreateConversionDto, RefundConversionDto } from './dto/conversion.dto';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import { AutomationEngineService } from '../automations/engine/automation-engine.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import { AuditService } from '../audit/audit.service';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';

@Injectable()
export class ConversionsService {
  private readonly logger = new Logger(ConversionsService.name);

  constructor(
    private readonly fraudService: FraudService,
    private readonly commissionsService: CommissionsService,
    private readonly ledgerService: LedgerService,
    private readonly webhooksService: WebhooksService,
    private readonly performanceAggregationService?: PerformanceAggregationService,
    private readonly automationEngineService?: AutomationEngineService,
    private readonly auditService?: AuditService,
  ) { }

  private emitWebhook(organizationId: string, event: WebhookEvent, payload: any) {
    this.webhooksService.triggerEvent(organizationId, event, payload).catch((error) => {
      this.logger.error(`Webhook delivery failed for ${event}: ${error?.message || error}`);
    });
  }

  private audit(entry: {
    organizationId?: string;
    actorType: 'user' | 'system' | 'api_key';
    actorId: string;
    action: AuditAction;
    resourceType: string;
    resourceId: string;
    metadata?: any;
  }) {
    if (this.auditService) {
      this.auditService.log(entry);
      return;
    }
    // Fallback for call sites that construct ConversionsService directly without DI (e.g. tests).
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId: entry.organizationId,
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: entry.metadata,
      createdAt: new Date(),
    });
  }

  async createConversion(
    organizationId: string,
    dto: CreateConversionDto,
    idempotencyKey?: string,
    context?: { apiKeyId?: string; environment?: 'test' | 'live' | EnvironmentType },
  ) {
    const environment = EnvironmentUtils.normalizeEnvironment(context?.environment);
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    this.validateMetadata(dto.metadata);

    // IDEMPOTENCY CHECK
    if (idempotencyKey) {
      const existingKey = dbStore.idempotencyKeys.find(
        (k) =>
          k.organizationId === organizationId &&
          (k as any).environment === environment &&
          (k as any).apiKeyId === context?.apiKeyId &&
          k.key === idempotencyKey &&
          k.expiresAt > new Date(),
      );

      if (existingKey) {
        if (existingKey.requestHash === requestHash) {
          // Return exact cached response
          return existingKey.responseBody;
        } else {
          throw new ConflictException(
            'Idempotency key reuse detected with different request payload (409 Conflict)',
          );
        }
      }
    }

    // Check if externalId already exists for this org in this environment
    const existingConversion = dbStore.conversions.find(
      (c) =>
        c.organizationId === organizationId &&
        c.externalId === dto.externalId &&
        (c.environment === environment || (!c.environment && environment === EnvironmentType.LIVE)),
    );

    if (existingConversion) {
      throw new ConflictException(`Conversion with externalId '${dto.externalId}' already exists in ${environment} environment.`);
    }

    // Resolve attribution using deterministic model rules within environment
    const program = dbStore.programs.find(
      (p) =>
        p.organizationId === organizationId &&
        (p.environment === environment || (!p.environment && environment === EnvironmentType.LIVE)) &&
        !p.deletedAt,
    );
    // A caller-supplied clickId is a direct attribution claim (bypassing the durable
    // customer-identity resolution below), so it must be single-use: otherwise a click ID
    // observed anywhere (a URL, a Referer header, a leaked log) could be replayed to attribute
    // unlimited future conversions to that click's affiliate. This does not affect legitimate
    // recurring/subscription commissions, which resolve via customerExternalId instead.
    if (dto.clickId) {
      const alreadyUsed = dbStore.conversions.some(
        (c) =>
          c.clickId === dto.clickId &&
          c.organizationId === organizationId &&
          (c.environment === environment || (!c.environment && environment === EnvironmentType.LIVE)),
      );
      if (alreadyUsed) {
        throw new ConflictException('This click has already been attributed to a conversion.');
      }
    }

    const attribution = this.resolveAttribution(organizationId, dto.customerExternalId, dto.clickId, dto.attributionId, environment);
    const programId = attribution?.programId || program?.id;
    if (!programId) {
      throw new BadRequestException(`No active program found for conversion in ${environment} environment.`);
    }
    if (attribution) {
      // Defense in depth: even though candidates are already filtered by org+environment,
      // never let a resolved attribution cross a tenant or TEST/LIVE boundary into this conversion.
      EnvironmentUtils.assertEnvironmentIntegrity(
        { organizationId, environment },
        { organizationId: attribution.organizationId, environment: attribution.environment },
        'Attribution',
      );
    }

    const resolvedProgram = dbStore.programs.find((p) => p.id === programId);
    if (resolvedProgram?.currency && dto.currency && resolvedProgram.currency.toUpperCase() !== dto.currency.toUpperCase()) {
      throw new BadRequestException(
        `Conversion currency (${dto.currency}) does not match program currency (${resolvedProgram.currency}). Currency conversion is not supported.`,
      );
    }

    // Resolve affiliate ID with intelligent fallbacks:
    // 1. Directly from attribution record
    let resolvedAffiliateId = attribution?.affiliateId;

    // 2. From click record if clickId was passed
    if (!resolvedAffiliateId && dto.clickId) {
      const click = dbStore.clicks.find((c) => c.id === dto.clickId && c.organizationId === organizationId);
      if (click?.affiliateId) {
        resolvedAffiliateId = click.affiliateId;
      }
    }

    // 3. Explicitly passed in dto or metadata
    if (!resolvedAffiliateId) {
      resolvedAffiliateId = (dto as any).affiliateId || dto.metadata?.affiliateId || (dto as any).affiliate;
    }

    // 4. Auto-resolve if organization has only 1 affiliate
    if (!resolvedAffiliateId) {
      const activeOrgAffiliates = dbStore.affiliates.filter(
        (a) => a.organizationId === organizationId && a.status === AffiliateStatus.ACTIVE,
      );
      if (activeOrgAffiliates.length === 1) {
        resolvedAffiliateId = activeOrgAffiliates[0].id;
      } else if (activeOrgAffiliates.length === 0) {
        const allOrgAffiliates = dbStore.affiliates.filter((a) => a.organizationId === organizationId);
        if (allOrgAffiliates.length === 1) {
          resolvedAffiliateId = allOrgAffiliates[0].id;
        }
      }
    }

    const conversion: ConversionEntity = {
      id: uuidv4(),
      organizationId,
      environment,
      programId,
      affiliateId: resolvedAffiliateId,
      clickId: attribution?.clickId || dto.clickId,
      resolvedAttributionId: attribution?.id,
      externalId: dto.externalId,
      customerExternalId: dto.customerExternalId,
      amount: dto.amount,
      refundedAmount: 0,
      currency: dto.currency || PLATFORM_CURRENCY,
      type: dto.type || 'PURCHASE',
      metadata: dto.metadata,
      productId: dto.productId,
      status: ConversionStatus.PENDING,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      createdAt: new Date(),
    };

    dbStore.conversions.push(conversion);

    this.audit({
      organizationId,
      actorType: 'system',
      actorId: context?.apiKeyId || 'system',
      action: resolvedAffiliateId ? AuditAction.CONVERSION_ATTRIBUTED : AuditAction.CONVERSION_NO_ATTRIBUTION,
      resourceType: 'conversion',
      resourceId: conversion.id,
      metadata: {
        clickId: attribution?.clickId || dto.clickId,
        attributionId: attribution?.id,
        affiliateId: resolvedAffiliateId,
        programId,
        requestedClickId: dto.clickId,
        requestedAttributionId: dto.attributionId,
      },
    });

    this.emitWebhook(organizationId, WebhookEvent.CONVERSION_CREATED, {
      conversionId: conversion.id,
      externalId: conversion.externalId,
      customerExternalId: conversion.customerExternalId,
      amount: conversion.amount,
      currency: conversion.currency,
    });

    // Fraud check
    const fraudResult = await this.fraudService.evaluateConversion(conversion);

    if (fraudResult.decision === FraudDecision.BLOCK) {
      conversion.status = ConversionStatus.REJECTED;
      this.emitWebhook(organizationId, WebhookEvent.CONVERSION_REJECTED, {
        conversionId: conversion.id,
        affiliateId: resolvedAffiliateId,
        reason: 'FRAUD_BLOCK',
      });
    } else if (fraudResult.decision === FraudDecision.REVIEW) {
      conversion.status = ConversionStatus.PENDING;
    } else {
      conversion.status = ConversionStatus.APPROVED;
    }

    // Never generate a commission for an affiliate who has been suspended/deactivated —
    // otherwise a merchant/admin suspending an affiliate for fraud has no effect on
    // commissions still being earned on conversions attributed to them afterward.
    const attributedAffiliate = resolvedAffiliateId
      ? dbStore.affiliates.find((a) => a.id === resolvedAffiliateId)
      : undefined;
    const affiliateIsActive = !attributedAffiliate || attributedAffiliate.status === AffiliateStatus.ACTIVE;

    let commission: any = null;
    if (conversion.status === ConversionStatus.APPROVED && resolvedAffiliateId && affiliateIsActive) {
      commission = await this.commissionsService.calculateAndRecordCommission(
        organizationId,
        conversion,
        resolvedAffiliateId,
        fraudResult.score,
      );

      this.emitWebhook(organizationId, WebhookEvent.CONVERSION_APPROVED, {
        conversionId: conversion.id,
        affiliateId: resolvedAffiliateId,
        amount: conversion.amount,
        currency: conversion.currency,
      });

      // Check if first conversion
      const previousApprovedConversions = dbStore.conversions.filter(
        (c) =>
          c.organizationId === organizationId &&
          c.environment === environment &&
          c.programId === conversion.programId &&
          c.id !== conversion.id &&
          c.status === ConversionStatus.APPROVED,
      ).length;

      // The conversion and commission are already committed at this point. Downstream
      // side-effects (gamification, automations) must never be allowed to throw and turn
      // this into a client-visible 500 — that causes merchants to retry with a new/adjusted
      // externalId and create a genuine duplicate commission for the same underlying sale.
      try {
        // 1. Real-time gamification performance & tier & milestone evaluation
        await this.performanceAggregationService?.recordApprovedConversion(
          organizationId,
          conversion.programId,
          resolvedAffiliateId,
          conversion,
          commission?.commissionAmount || 0,
        );
      } catch (error: any) {
        this.logger.error(
          `Performance aggregation failed for conversion ${conversion.id}: ${error?.message || error}`,
        );
      }

      try {
        // 2. Trigger automations
        if (previousApprovedConversions === 0) {
          await this.automationEngineService?.handleEvent(
            AutomationTriggerType.FIRST_CONVERSION,
            organizationId,
            conversion.programId,
            resolvedAffiliateId,
            { conversionId: conversion.id, amount: conversion.amount },
          );
        }

        await this.automationEngineService?.handleEvent(
          AutomationTriggerType.APPROVED_CONVERSION,
          organizationId,
          conversion.programId,
          resolvedAffiliateId,
          { conversionId: conversion.id, amount: conversion.amount },
        );
      } catch (error: any) {
        this.logger.error(
          `Automation trigger failed for conversion ${conversion.id}: ${error?.message || error}`,
        );
      }
    }

    const responsePayload = {
      conversion,
      fraudResult,
      commission,
    };

    // Save Idempotency Key record
    if (idempotencyKey) {
      const ikRecord: IdempotencyKeyEntity = {
        id: uuidv4(),
        organizationId,
        environment,
        apiKeyId: context?.apiKeyId,
        key: idempotencyKey,
        requestHash,
        responseStatus: 201,
        responseBody: responsePayload,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        createdAt: new Date(),
      };
      dbStore.idempotencyKeys.push(ikRecord);
    }

    return responsePayload;
  }

  async refundConversion(
    organizationId: string,
    conversionId: string,
    dto: RefundConversionDto,
    environment: EnvironmentType | 'test' | 'live' = EnvironmentType.LIVE,
    context?: { apiKeyId?: string; idempotencyKey?: string },
  ) {
    const currentEnvironment = EnvironmentUtils.normalizeEnvironment(environment);
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({ conversionId, ...dto })).digest('hex');

    // REFUND IDEMPOTENCY CHECK - mirrors createConversion's idempotency handling so a retried
    // refund request (e.g. from an SDK's automatic retry-on-5xx) can never double-process.
    if (context?.idempotencyKey) {
      const existingKey = dbStore.idempotencyKeys.find(
        (k) =>
          k.organizationId === organizationId &&
          (k as any).environment === currentEnvironment &&
          (k as any).apiKeyId === context?.apiKeyId &&
          k.key === context.idempotencyKey &&
          k.expiresAt > new Date(),
      );
      if (existingKey) {
        if (existingKey.requestHash === requestHash) {
          return existingKey.responseBody;
        }
        throw new ConflictException(
          'Idempotency key reuse detected with different request payload (409 Conflict)',
        );
      }
    }

    const conversion = dbStore.conversions.find(
      (c) =>
        (c.id === conversionId || c.externalId === conversionId) &&
        c.organizationId === organizationId &&
        (c.environment === currentEnvironment || (!c.environment && currentEnvironment === EnvironmentType.LIVE)),
    );

    if (!conversion) {
      throw new NotFoundException('Conversion not found');
    }

    if (conversion.status === ConversionStatus.REFUNDED) {
      throw new BadRequestException('Conversion has already been fully refunded');
    }

    // Same refundExternalId submitted twice without an Idempotency-Key header still gets caught here.
    if (dto.refundExternalId && (conversion.refundHistory || []).some((r) => r.refundExternalId === dto.refundExternalId)) {
      throw new ConflictException(`Refund with refundExternalId '${dto.refundExternalId}' was already processed for this conversion.`);
    }

    const remaining = conversion.amount - (conversion.refundedAmount || 0);
    const refundAmount = dto.amount ?? remaining;
    if (refundAmount > remaining) {
      throw new BadRequestException(`Refund amount ${refundAmount} exceeds remaining refundable amount ${remaining}.`);
    }

    conversion.refundedAmount = (conversion.refundedAmount || 0) + refundAmount;
    conversion.refundHistory = [
      ...(conversion.refundHistory || []),
      { refundExternalId: dto.refundExternalId, amount: refundAmount, reason: dto.reason, createdAt: new Date().toISOString() },
    ];
    const isFullyRefunded = conversion.refundedAmount >= conversion.amount;
    conversion.status = isFullyRefunded ? ConversionStatus.REFUNDED : ConversionStatus.PARTIALLY_REFUNDED;

    this.emitWebhook(organizationId, WebhookEvent.CONVERSION_REFUNDED, {
      conversionId: conversion.id,
      refundExternalId: dto.refundExternalId,
      amount: refundAmount,
      totalRefundedAmount: conversion.refundedAmount,
      fullyRefunded: isFullyRefunded,
      currency: conversion.currency,
    });

    // Use the resolved internal conversion.id here, not the raw `conversionId` parameter —
    // callers may pass their own external order ID (refundConversion resolves either), and
    // commissions are always keyed by the internal UUID. Comparing against the raw param
    // silently fails to find the commission when an externalId was passed, so the refund
    // clawback never happens and the affiliate keeps a commission on a refunded order.
    const commission = dbStore.commissions.find((c) => c.conversionId === conversion.id);
    let commissionReversedAmount = 0;
    if (commission && conversion.affiliateId) {
      // Reversal is proportional to how much of the conversion's value was actually refunded,
      // and is clamped so cumulative reversals can never exceed the original commission.
      const proportionalReversal = Math.round((commission.commissionAmount * refundAmount) / conversion.amount);
      commissionReversedAmount = Math.min(proportionalReversal, commission.commissionAmount - (commission.reversedAmount || 0));

      if (commissionReversedAmount > 0) {
        commission.reversedAmount = (commission.reversedAmount || 0) + commissionReversedAmount;
        commission.status = commission.reversedAmount >= commission.commissionAmount
          ? ConversionStatus.REFUNDED
          : ConversionStatus.PARTIALLY_REFUNDED;

        // Immutable clawback / reversal entry in double-entry ledger
        await this.ledgerService.recordTransaction(
          organizationId,
          conversion.affiliateId,
          LedgerEntryType.COMMISSION_REVERSED,
          `Refund clawback for conversion ${conversion.externalId}: ${dto.reason || 'Customer refund'}`,
          commission.id,
          commissionReversedAmount,
        );

        this.emitWebhook(organizationId, WebhookEvent.COMMISSION_REVERSED, {
          commissionId: commission.id,
          conversionId: conversion.id,
          affiliateId: conversion.affiliateId,
          amount: commissionReversedAmount,
          status: commission.status,
        });

        const program = dbStore.programs.find((p) => p.id === conversion.programId);
        this.commissionsService.notifyAffiliateCommission(
          SystemTemplateKey.AFFILIATE_COMMISSION_REVERSED,
          organizationId,
          conversion.affiliateId,
          commissionReversedAmount,
          program?.currency || PLATFORM_CURRENCY,
          { reason: dto.reason || 'Customer refund' },
        ).catch(() => undefined);
      }
    }

    this.audit({
      organizationId,
      actorType: 'system',
      actorId: context?.apiKeyId || 'system',
      action: AuditAction.CONVERSION_REVERSED,
      resourceType: 'conversion',
      resourceId: conversion.id,
      metadata: {
        reason: dto.reason,
        refundExternalId: dto.refundExternalId,
        refundAmount,
        totalRefundedAmount: conversion.refundedAmount,
        fullyRefunded: isFullyRefunded,
        commissionReversedAmount,
      },
    });

    const responsePayload = {
      conversion,
      commissionStatus: commission?.status || 'NO_COMMISSION',
      refundAmount,
      fullyRefunded: isFullyRefunded,
      message: isFullyRefunded ? 'Conversion fully refunded and commission clawed back' : 'Partial refund recorded and commission proportionally clawed back',
    };

    if (context?.idempotencyKey) {
      const ikRecord: IdempotencyKeyEntity = {
        id: uuidv4(),
        organizationId,
        environment: currentEnvironment,
        apiKeyId: context?.apiKeyId,
        key: context.idempotencyKey,
        requestHash,
        responseStatus: 200,
        responseBody: responsePayload,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        createdAt: new Date(),
      };
      dbStore.idempotencyKeys.push(ikRecord);
    }

    return responsePayload;
  }

  async findAll(organizationId: string, environment: EnvironmentType | 'test' | 'live' = EnvironmentType.LIVE, programId?: string) {
    const currentEnvironment = EnvironmentUtils.normalizeEnvironment(environment);
    const conversions = dbStore.conversions.filter((c) =>
      c.organizationId === organizationId &&
      (c.environment === currentEnvironment || (!c.environment && currentEnvironment === EnvironmentType.LIVE)) &&
      (!programId || c.programId === programId),
    );
    return conversions.map((c) => {
      const affiliate = c.affiliateId ? dbStore.affiliates.find((a) => a.id === c.affiliateId) : undefined;
      const commission = dbStore.commissions.find((com) => com.conversionId === c.id);
      return {
        ...c,
        affiliateName: affiliate?.displayName || affiliate?.companyName || 'Direct / Organic',
        customerEmail: c.customerExternalId || (c.metadata as any)?.customerEmail || 'customer@example.com',
        commissionAmount: commission?.commissionAmount ?? 0,
      };
    });
  }

  async findOne(organizationId: string, id: string, environment: EnvironmentType | 'test' | 'live' = EnvironmentType.LIVE) {
    const currentEnvironment = EnvironmentUtils.normalizeEnvironment(environment);
    const conversion = dbStore.conversions.find(
      (c) =>
        c.organizationId === organizationId &&
        (c.environment === currentEnvironment || (!c.environment && currentEnvironment === EnvironmentType.LIVE)) &&
        (c.id === id || c.externalId === id),
    );
    if (!conversion) {
      throw new NotFoundException('Conversion not found');
    }
    return conversion;
  }

  private resolveAttribution(
    organizationId: string,
    customerExternalId: string,
    clickId?: string,
    explicitAttributionId?: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    const isLive = (a: { organizationId: string; environment?: EnvironmentType; expiresAt: Date }) =>
      a.organizationId === organizationId &&
      (!a.environment || a.environment === environment) &&
      a.expiresAt > new Date();

    // Click ID is the primary attribution identifier: if the caller supplies the Click ID
    // returned from tracking, resolve directly to the attribution created for that exact click -
    // no ambiguity, no attribution-model tie-breaking needed.
    if (clickId) {
      const byClick = dbStore.attributions.find((a) => a.clickId === clickId && isLive(a));
      if (byClick) return byClick;
    }

    // Legacy path: an explicit attribution record id, still scoped to this org+environment
    // and required to be unexpired.
    if (explicitAttributionId) {
      const byId = dbStore.attributions.find((a) => a.id === explicitAttributionId && isLive(a));
      if (byId) return byId;
    }

    // Durable identity path: the customer was linked to an attribution via /tracking/identify at
    // some point (signup/login/checkout) - this is what makes attribution survive cookie deletion,
    // and also what lets a later conversion on a different device still resolve correctly.
    // Deliberately NOT scoped to any single "default" program: an org can run several concurrent
    // programs, and a customer's real attribution must win regardless of which one it belongs to -
    // narrowing to a fallback program here would silently exclude genuine attributions.
    const candidates = dbStore.attributions.filter((a) => {
      if (!isLive(a)) return false;
      return a.customerExternalId === customerExternalId || a.anonymousId === customerExternalId;
    });

    if (!candidates.length) {
      return undefined;
    }

    const ordered = [...candidates].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const model = dbStore.programs.find((p) => p.id === ordered[0].programId)?.attributionModel || 'LAST_CLICK';

    if (model === 'FIRST_CLICK') return ordered[0];
    if (model === 'LAST_CLICK') return ordered[ordered.length - 1];

    const weighted = ordered.map((item, index) => {
      const program = dbStore.programs.find((p) => p.id === item.programId);
      const config = (program?.attributionConfig || {}) as Record<string, any>;
      const weights = config.weights || {};
      const sharedWeight = typeof weights["first"] === 'number' && index === 0 ? weights["first"] :
        typeof weights["middle"] === 'number' && index > 0 && index < ordered.length - 1 ? weights["middle"] :
          typeof weights["last"] === 'number' && index === ordered.length - 1 ? weights["last"] : 1;
      const partnerBoost = typeof weights[item.affiliateId] === 'number' ? weights[item.affiliateId] : 1;
      const timeBoost = Math.max(0.1, 1 - ((Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 45)));

      return { item, score: (sharedWeight * partnerBoost * timeBoost) + (index === 0 ? 0.1 : 0) };
    });

    if (model === 'POSITION_BASED') {
      return weighted.sort((a, b) => b.score - a.score)[0].item;
    }

    if (model === 'TIME_DECAY') {
      return weighted.sort((a, b) => b.score - a.score)[0].item;
    }

    if (model === 'MULTI_TOUCH' || model === 'CUSTOM') {
      return weighted.sort((a, b) => b.score - a.score)[0].item;
    }

    return ordered[ordered.length - 1];
  }

  private validateMetadata(metadata?: Record<string, unknown>) {
    if (!metadata) return;
    const serialized = JSON.stringify(metadata);
    if (serialized.length > 4096) {
      throw new BadRequestException('metadata must be 4KB or smaller');
    }
    const blocked = ['__proto__', 'constructor', 'prototype'];
    const visit = (value: unknown, depth: number) => {
      if (depth > 4) throw new BadRequestException('metadata nesting is too deep');
      if (!value || typeof value !== 'object') return;
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (blocked.includes(key)) {
          throw new BadRequestException(`metadata key is not allowed: ${key}`);
        }
        visit((value as Record<string, unknown>)[key], depth + 1);
      }
    };
    visit(metadata, 0);
  }
}
