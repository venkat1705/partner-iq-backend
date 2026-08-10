import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { dbStore, ConversionEntity, IdempotencyKeyEntity } from '../../database/store';
import { ConversionStatus, LedgerEntryType, AuditAction, FraudDecision } from '../../common/enums';
import { FraudService } from '../fraud/fraud.service';
import { CommissionsService } from '../commissions/commissions.service';
import { LedgerService } from '../ledger/ledger.service';
import { CreateConversionDto, RefundConversionDto } from './dto/conversion.dto';

@Injectable()
export class ConversionsService {
  constructor(
    private readonly fraudService: FraudService,
    private readonly commissionsService: CommissionsService,
    private readonly ledgerService: LedgerService,
  ) {}

  async createConversion(
    organizationId: string,
    dto: CreateConversionDto,
    idempotencyKey?: string,
  ) {
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(dto)).digest('hex');

    // IDEMPOTENCY CHECK
    if (idempotencyKey) {
      const existingKey = dbStore.idempotencyKeys.find(
        (k) => k.organizationId === organizationId && k.key === idempotencyKey,
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

    // Check if externalId already exists for this org
    const existingConversion = dbStore.conversions.find(
      (c) => c.organizationId === organizationId && c.externalId === dto.externalId,
    );

    if (existingConversion) {
      throw new ConflictException(`Conversion with externalId '${dto.externalId}' already exists`);
    }

    // Resolve Attribution
    const attribution = dbStore.attributions.find(
      (a) =>
        a.organizationId === organizationId &&
        (a.customerExternalId === dto.customerExternalId || a.anonymousId === dto.customerExternalId),
    );

    const programId = attribution?.programId || dbStore.programs.find((p) => p.organizationId === organizationId)?.id;
    if (!programId) {
      throw new BadRequestException('No active program found for conversion');
    }

    const conversion: ConversionEntity = {
      id: uuidv4(),
      organizationId,
      programId,
      affiliateId: attribution?.affiliateId,
      externalId: dto.externalId,
      customerExternalId: dto.customerExternalId,
      amount: dto.amount,
      currency: dto.currency || 'USD',
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

  async refundConversion(organizationId: string, conversionId: string, dto: RefundConversionDto) {
    const conversion = dbStore.conversions.find(
      (c) => c.id === conversionId && c.organizationId === organizationId,
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

  async findAll(organizationId: string) {
    return dbStore.conversions.filter((c) => c.organizationId === organizationId);
  }
}
