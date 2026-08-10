import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, CommissionRuleEntity, CommissionEntity, ConversionEntity } from '../../database/store';
import { CommissionType, ConversionStatus, LedgerEntryType, AuditAction } from '../../common/enums';
import { LedgerService } from '../ledger/ledger.service';
import { CreateCommissionRuleDto } from './dto/commission.dto';

@Injectable()
export class CommissionsService {
  constructor(private readonly ledgerService: LedgerService) {}

  async createRule(organizationId: string, dto: CreateCommissionRuleDto) {
    const rule: CommissionRuleEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      name: dto.name,
      priority: dto.priority,
      conditions: dto.conditions || { all: [] },
      commissionType: dto.commissionType,
      commissionValue: dto.commissionValue,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.commissionRules.push(rule);
    return rule;
  }

  async getRules(organizationId: string) {
    return dbStore.commissionRules.filter((r) => r.organizationId === organizationId);
  }

  // Deterministic Commission Evaluator Engine
  async calculateAndRecordCommission(
    organizationId: string,
    conversion: ConversionEntity,
    affiliateId: string,
    fraudScore: number,
  ) {
    const program = dbStore.programs.find((p) => p.id === conversion.programId);
    let commissionType = program?.commissionType || CommissionType.PERCENTAGE;
    let commissionValue = program?.defaultCommissionValue || 1000; // 10.00%
    let matchedRule: CommissionRuleEntity | undefined = undefined;

    // Load active rules sorted by priority
    const rules = dbStore.commissionRules
      .filter((r) => r.organizationId === organizationId && r.programId === conversion.programId && r.active)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of rules) {
      if (this.evaluateRuleConditions(rule.conditions, { conversion, fraudScore })) {
        commissionType = rule.commissionType;
        commissionValue = rule.commissionValue;
        matchedRule = rule;
        break; // First matching highest priority rule
      }
    }

    // Calculate commission amount in cents
    let commissionAmount = 0;
    if (commissionType === CommissionType.PERCENTAGE || commissionType === CommissionType.RECURRING_PERCENTAGE) {
      // commissionValue is in basis points (100 = 1%)
      commissionAmount = Math.round((conversion.amount * commissionValue) / 10000);
    } else {
      // Fixed cents
      commissionAmount = commissionValue;
    }

    const commission: CommissionEntity = {
      id: uuidv4(),
      organizationId,
      programId: conversion.programId,
      affiliateId,
      conversionId: conversion.id,
      ruleId: matchedRule?.id,
      ruleSnapshot: {
        ruleName: matchedRule?.name || 'Default Program Rate',
        commissionType,
        commissionValue,
      },
      rate: commissionValue,
      baseAmount: conversion.amount,
      commissionAmount,
      calculationVersion: 'v1.0',
      status: ConversionStatus.APPROVED,
      createdAt: new Date(),
    };

    dbStore.commissions.push(commission);

    // Post immutable double-entry ledger record
    await this.ledgerService.recordTransaction(
      organizationId,
      affiliateId,
      LedgerEntryType.COMMISSION_EARNED,
      `Commission earned for conversion ${conversion.externalId}`,
      commission.id,
      commissionAmount,
    );

    return commission;
  }

  async getCommissions(organizationId: string) {
    return dbStore.commissions.filter((c) => c.organizationId === organizationId);
  }

  private evaluateRuleConditions(conditions: any, context: { conversion: ConversionEntity; fraudScore: number }): boolean {
    if (!conditions || !conditions.all || conditions.all.length === 0) return true;

    for (const cond of conditions.all) {
      let val: any;
      if (cond.field === 'country') val = 'US';
      else if (cond.field === 'fraudScore') val = context.fraudScore;
      else if (cond.field === 'amount') val = context.conversion.amount;

      if (cond.operator === 'eq' && val !== cond.value) return false;
      if (cond.operator === 'lt' && val >= cond.value) return false;
      if (cond.operator === 'gt' && val <= cond.value) return false;
    }

    return true;
  }
}
