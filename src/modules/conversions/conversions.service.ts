import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { dbStore, ConversionEntity, IdempotencyKeyEntity } from '../../database/store';
import { FraudService } from '../fraud/fraud.service';
import { CommissionsService } from '../commissions/commissions.service';
import { LedgerService } from '../ledger/ledger.service';
import { PerformanceAggregationService } from '../gamification/performance/performance-aggregation.service';
import { AutomationTriggerType, ConversionStatus, FraudDecision, AuditAction, EnvironmentType, LedgerEntryType } from '../../common/enums';
import { CreateConversionDto, RefundConversionDto } from './dto/conversion.dto';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import { AutomationEngineService } from '../automations/engine/automation-engine.service';

@Injectable()
export class ConversionsService {
  constructor(
    private readonly fraudService: FraudService,
    private readonly commissionsService: CommissionsService,
    private readonly ledgerService: LedgerService,
    private readonly performanceAggregationService?: PerformanceAggregationService,
    private readonly automationEngineService?: AutomationEngineService,
  ) { }

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
          k.key === idempotencyKey,
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
    const attribution = this.resolveAttribution(organizationId, dto.customerExternalId, dto.attributionId, program?.id, environment);
    const programId = attribution?.programId || program?.id;
    if (!programId) {
      throw new BadRequestException(`No active program found for conversion in ${environment} environment.`);
    }

    const conversion: ConversionEntity = {
      id: uuidv4(),
      organizationId,
      environment,
      programId,
      affiliateId: attribution?.affiliateId,
      externalId: dto.externalId,
      customerExternalId: dto.customerExternalId,
      amount: dto.amount,
      currency: dto.currency || 'USD',
      type: dto.type || 'PURCHASE',
      metadata: dto.metadata,
      productId: dto.productId,
      status: ConversionStatus.PENDING,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      createdAt: new Date(),
    };

    dbStore.conversions.push(conversion);

    // Fraud check
    const fraudResult = await this.fraudService.evaluateConversion(conversion);

    if (fraudResult.decision === FraudDecision.BLOCK) {
      conversion.status = ConversionStatus.REJECTED;
    } else if (fraudResult.decision === FraudDecision.REVIEW) {
      conversion.status = ConversionStatus.PENDING;
    } else {
      conversion.status = ConversionStatus.APPROVED;
    }

    let commission: any = null;
    if (conversion.status === ConversionStatus.APPROVED && attribution?.affiliateId) {
      commission = await this.commissionsService.calculateAndRecordCommission(
        organizationId,
        conversion,
        attribution.affiliateId,
        fraudResult.score,
      );

      // Check if first conversion
      const previousApprovedConversions = dbStore.conversions.filter(
        (c) =>
          c.organizationId === organizationId &&
          c.environment === environment &&
          c.programId === conversion.programId &&
          c.id !== conversion.id &&
          c.status === ConversionStatus.APPROVED,
      ).length;

      // 1. Real-time gamification performance & tier & milestone evaluation
      await this.performanceAggregationService?.recordApprovedConversion(
        organizationId,
        conversion.programId,
        attribution.affiliateId,
        conversion,
        commission?.commissionAmount || 0,
      );

      // 2. Trigger automations
      if (previousApprovedConversions === 0) {
        await this.automationEngineService?.handleEvent(
          AutomationTriggerType.FIRST_CONVERSION,
          organizationId,
          conversion.programId,
          attribution.affiliateId,
          { conversionId: conversion.id, amount: conversion.amount },
        );
      }

      await this.automationEngineService?.handleEvent(
        AutomationTriggerType.APPROVED_CONVERSION,
        organizationId,
        conversion.programId,
        attribution.affiliateId,
        { conversionId: conversion.id, amount: conversion.amount },
      );
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

  async refundConversion(organizationId: string, conversionId: string, dto: RefundConversionDto, environment: EnvironmentType | 'test' | 'live' = EnvironmentType.LIVE) {
    const currentEnvironment = EnvironmentUtils.normalizeEnvironment(environment);
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
      throw new BadRequestException('Conversion has already been refunded');
    }

    conversion.status = ConversionStatus.REFUNDED;

    const commission = dbStore.commissions.find((c) => c.conversionId === conversionId);
    if (commission && conversion.affiliateId) {
      commission.status = ConversionStatus.REFUNDED;

      // Immutable clawback / reversal entry in double-entry ledger
      await this.ledgerService.recordTransaction(
        organizationId,
        conversion.affiliateId,
        LedgerEntryType.COMMISSION_REVERSED,
        `Refund clawback for conversion ${conversion.externalId}: ${dto.reason || 'Customer refund'}`,
        commission.id,
        commission.commissionAmount,
      );
    }

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: 'system',
      action: AuditAction.COMMISSION_REVERSED,
      resourceType: 'conversion',
      resourceId: conversion.id,
      metadata: { reason: dto.reason },
      createdAt: new Date(),
    });

    return { conversion, commissionStatus: 'REFUNDED', message: 'Conversion refunded and commission clawed back' };
  }

  async findAll(organizationId: string, environment: EnvironmentType | 'test' | 'live' = EnvironmentType.LIVE, programId?: string) {
    const currentEnvironment = EnvironmentUtils.normalizeEnvironment(environment);
    return dbStore.conversions.filter((c) =>
      c.organizationId === organizationId &&
      (c.environment === currentEnvironment || (!c.environment && currentEnvironment === EnvironmentType.LIVE)) &&
      (!programId || c.programId === programId),
    );
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
    explicitAttributionId?: string,
    fallbackProgramId?: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    const candidates = dbStore.attributions.filter((a) => {
      if (a.organizationId !== organizationId) return false;
      if (a.environment && a.environment !== environment) return false;
      if (a.expiresAt <= new Date()) return false;
      if (explicitAttributionId && a.id === explicitAttributionId) return true;
      if (fallbackProgramId && a.programId !== fallbackProgramId) return false;
      return a.customerExternalId === customerExternalId || a.anonymousId === customerExternalId;
    });

    if (!candidates.length) {
      return (
        dbStore.attributions.find(
          (a) =>
            a.organizationId === organizationId &&
            a.id === explicitAttributionId &&
            (!a.environment || a.environment === environment) &&
            a.expiresAt > new Date(),
        ) || undefined
      );
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
