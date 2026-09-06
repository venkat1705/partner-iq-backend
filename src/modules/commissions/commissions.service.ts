import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, CommissionRuleEntity, CommissionEntity, ConversionEntity } from '../../database/store';
import { CommissionType, ConversionStatus, LedgerEntryType, AuditAction } from '../../common/enums';
import { LedgerService } from '../ledger/ledger.service';
import { CreateCommissionRuleDto, TestCommissionRulesDto } from './dto/commission.dto';

@Injectable()
export class CommissionsService {
  constructor(private readonly ledgerService: LedgerService) { }

  /**
   * Apply retroactive commission adjustments for an affiliate when a tier
   * specifies RETROACTIVE_CURRENT_PERIOD. This will compute the delta between
   * what was paid and what would have been paid under the new tier rate for
   * commissions in the current period and create adjustment ledger entries.
   */
  async applyRetroactiveAdjustment(
    organizationId: string,
    programId: string,
    affiliateId: string,
    newTier: any,
  ) {
    if (!newTier) return { adjusted: 0, details: [] };

    // Only applies when a commission percentage override exists
    if (!newTier.commissionRateOverride && !newTier.fixedCommissionOverride) {
      return { adjusted: 0, details: [] };
    }

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));

    const commissionsToAdjust = dbStore.commissions.filter((c) => {
      return (
        c.organizationId === organizationId &&
        c.programId === programId &&
        c.affiliateId === affiliateId &&
        c.status === ConversionStatus.APPROVED &&
        new Date(c.createdAt) >= monthStart &&
        new Date(c.createdAt) <= monthEnd
      );
    });

    const details: any[] = [];
    let totalAdjusted = 0;

    for (const comm of commissionsToAdjust) {
      const baseAmount = comm.baseAmount || 0; // cents
      let newAmount = 0;

      if (newTier.commissionRateOverride !== undefined && newTier.commissionRateOverride !== null) {
        // commissionRateOverride stored in basis points
        newAmount = Math.round((baseAmount * newTier.commissionRateOverride) / 10000);
      } else if (newTier.fixedCommissionOverride !== undefined && newTier.fixedCommissionOverride !== null) {
        newAmount = newTier.fixedCommissionOverride;
      }

      const delta = newAmount - (comm.commissionAmount || 0);
      if (delta > 0) {
        // Create an adjustment ledger entry
        await this.ledgerService.recordTransaction(
          organizationId,
          affiliateId,
          LedgerEntryType.ADJUSTMENT,
          `Retroactive commission adjustment for commission ${comm.id} due to tier upgrade to ${newTier.name}`,
          comm.id,
          delta,
        );

        dbStore.auditLogs.push({
          id: uuidv4(),
          organizationId,
          actorType: 'SYSTEM',
          actorId: 'system',
          action: AuditAction.COMMISSION_APPROVED,
          resourceType: 'commission_adjustment',
          resourceId: comm.id,
          metadata: { affiliateId, programId, previousCommission: comm.commissionAmount, newCommission: newAmount, delta },
          createdAt: new Date(),
        });

        details.push({ commissionId: comm.id, previous: comm.commissionAmount, new: newAmount, delta });
        totalAdjusted += delta;
      }
    }

    return { adjusted: totalAdjusted, details };
  }

  async createRule(organizationId: string, dto: CreateCommissionRuleDto) {
    if (dto.programId) {
      const program = dbStore.programs.find((p) => p.id === dto.programId && p.organizationId === organizationId && !p.deletedAt);
      if (!program) throw new NotFoundException('Program not found');
    }
    if (!dto.name?.trim()) throw new BadRequestException('Rule name is required');
    if (dto.priority === undefined || dto.priority === null) throw new BadRequestException('Priority is required');
    const trimmedName = dto.name.trim();
    const scopeProgramId = dto.programId || null;
    const nameExists = dbStore.commissionRules.some(
      (rule) =>
        rule.organizationId === organizationId &&
        (rule.programId || null) === scopeProgramId &&
        rule.status !== 'ARCHIVED' &&
        rule.name.trim().toLowerCase() === trimmedName.toLowerCase(),
    );
    if (nameExists) throw new BadRequestException('A commission rule with this name already exists. Use a unique rule name.');
    const priorityExists = dbStore.commissionRules.some(
      (rule) => rule.organizationId === organizationId && (rule.programId || null) === (dto.programId || null) && rule.priority === dto.priority && rule.status !== 'ARCHIVED',
    );
    if (priorityExists) throw new BadRequestException('A rule with this priority already exists. Choose another priority.');
    const slug = this.createUniqueRuleSlug(organizationId, scopeProgramId, trimmedName);

    const action = dto.action || {
      commissionType: dto.commissionType,
      commissionValue: dto.commissionValue,
      holdPeriodDays: dto.holdPeriodDays ?? 30,
    };
    this.validateAction(action.commissionType, action.commissionValue, action.holdPeriodDays ?? 30);
    const conditions = this.normalizeConditions(dto);

    const rule: CommissionRuleEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      name: trimmedName,
      slug,
      priority: dto.priority,
      conditions,
      commissionType: action.commissionType,
      commissionValue: this.normalizeCommissionValue(action.commissionType, action.commissionValue),
      holdPeriodDays: action.holdPeriodDays ?? 30,
      version: 1,
      status: dto.status || 'ACTIVE',
      active: (dto.status || 'ACTIVE') === 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.commissionRules.push(rule);
    this.audit(organizationId, 'system', 'COMMISSION_RULE_CREATED', rule.id, { after: rule });
    return rule;
  }

  async getRules(organizationId: string, programId?: string) {
    return dbStore.commissionRules
      .filter((r) => r.organizationId === organizationId && (!programId || r.programId === programId) && r.status !== 'ARCHIVED')
      .sort((a, b) => b.priority - a.priority);
  }

  async deleteRule(organizationId: string, ruleId: string) {
    const rule = dbStore.commissionRules.find(
      (r) => r.id === ruleId && r.organizationId === organizationId && r.status !== 'ARCHIVED',
    );
    if (!rule) throw new NotFoundException('Commission rule not found');

    // Check if any active program is currently referencing or assigned this commission configuration
    const inUseProgram = dbStore.programs.find(
      (p) =>
        p.organizationId === organizationId &&
        !p.deletedAt &&
        (p.id === rule.programId ||
          (p as any).commissionConfigurationId === ruleId ||
          (p as any).commissionRuleId === ruleId),
    );

    if (inUseProgram) {
      throw new BadRequestException(
        `Cannot delete "${rule.name}": It is currently assigned to active program "${inUseProgram.name}". Please reassign the program's commission configuration before deleting this rule.`,
      );
    }

    rule.status = 'ARCHIVED';
    rule.active = false;
    rule.updatedAt = new Date();

    this.audit(organizationId, 'system', 'COMMISSION_RULE_DELETED', rule.id, { before: rule });
    return { success: true, message: `Commission rule "${rule.name}" deleted successfully.` };
  }

  async testRules(organizationId: string, programId: string, dto: TestCommissionRulesDto) {
    const program = dbStore.programs.find((p) => p.id === programId && p.organizationId === organizationId && !p.deletedAt);
    if (!program) throw new NotFoundException('Program not found');
    const context = {
      country: dto.country || 'IN',
      productTier: dto.productTier || 'PREMIUM',
      monthlyRevenue: dto.monthlyRevenue ?? 0,
      fraudRiskScore: dto.fraudRiskScore ?? 0,
      conversionAmount: dto.conversionAmount ?? 100000,
    };
    const evaluation = this.evaluateProgramRules(organizationId, programId, context);
    const commissionType = evaluation.rule?.commissionType || program.commissionType;
    const commissionValue = evaluation.rule?.commissionValue || program.defaultCommissionValue;
    const holdPeriodDays = evaluation.rule?.holdPeriodDays ?? 30;
    return {
      matched: Boolean(evaluation.rule),
      rule: evaluation.rule
        ? { id: evaluation.rule.id, name: evaluation.rule.name, priority: evaluation.rule.priority }
        : null,
      evaluation: evaluation.evaluation,
      result: {
        commissionType,
        commissionValue: commissionType === CommissionType.PERCENTAGE ? commissionValue / 100 : commissionValue,
        holdPeriodDays,
        commissionAmount: commissionType === CommissionType.PERCENTAGE
          ? Math.round((context.conversionAmount * commissionValue) / 10000)
          : commissionValue,
      },
    };
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
    let matchedTier: any = undefined;

    // Check if affiliate has an active tier override
    const affiliateTier = dbStore.affiliateTiers.find(
      (at) =>
        at.organizationId === organizationId &&
        at.affiliateId === affiliateId &&
        (!at.programId || at.programId === conversion.programId),
    );

    if (affiliateTier) {
      const tier = dbStore.partnerTiers.find((t) => t.id === affiliateTier.currentTierId && t.isActive && !t.deletedAt);
      if (tier) {
        matchedTier = tier;
        if (tier.commissionRateOverride !== undefined && tier.commissionRateOverride !== null) {
          commissionType = CommissionType.PERCENTAGE;
          commissionValue = tier.commissionRateOverride;
        } else if (tier.fixedCommissionOverride !== undefined && tier.fixedCommissionOverride !== null) {
          commissionType = CommissionType.FIXED;
          commissionValue = tier.fixedCommissionOverride;
        }
      }
    }

    // Load active custom rules sorted by priority (if custom rule has higher priority)
    const rules = dbStore.commissionRules
      .filter((r) => r.organizationId === organizationId && r.programId === conversion.programId && r.active && r.status === 'ACTIVE')
      .sort((a, b) => b.priority - a.priority);

    for (const rule of rules) {
      if (this.evaluateRuleConditions(rule.conditions, { amount: conversion.amount, fraudRiskScore: fraudScore })) {
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
        ruleName: matchedRule?.name || (matchedTier ? `Tier Override (${matchedTier.name})` : 'Default Program Rate'),
        ruleVersion: matchedRule?.version,
        rule: matchedRule ? { ...matchedRule } : undefined,
        tier: matchedTier ? { id: matchedTier.id, name: matchedTier.name, level: matchedTier.level, code: matchedTier.code } : undefined,
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

  async getCommissions(organizationId: string, programId?: string) {
    return dbStore.commissions.filter((c) => c.organizationId === organizationId && (!programId || c.programId === programId));
  }

  private evaluateProgramRules(organizationId: string, programId: string, context: Record<string, any>) {
    const rules = dbStore.commissionRules
      .filter((r) => r.organizationId === organizationId && r.programId === programId && r.active && r.status === 'ACTIVE')
      .sort((a, b) => b.priority - a.priority);

    for (const rule of rules) {
      const evaluation = this.evaluateRuleConditionsDetailed(rule.conditions, context);
      if (evaluation.every((item) => item.matched)) return { rule, evaluation };
    }
    return { rule: null, evaluation: [] };
  }

  private evaluateRuleConditions(conditions: any, context: Record<string, any>): boolean {
    return this.evaluateRuleConditionsDetailed(conditions, context).every((item) => item.matched);
  }

  private evaluateRuleConditionsDetailed(conditions: any, context: Record<string, any>) {
    const list = conditions?.all || [];
    if (!list.length) return [{ field: 'always', matched: true }];
    return list.map((cond: any) => {
      const left = context[cond.field];
      const right = cond.value;
      const op = String(cond.operator).toUpperCase();
      let matched = false;
      if (['EQUALS', 'EQ', 'equals'].map(String).includes(op)) matched = left === right;
      else if (['NOT_EQUALS', 'NEQ'].includes(op)) matched = left !== right;
      else if (['GREATER_THAN', 'GT'].includes(op)) matched = Number(left) > Number(right);
      else if (['GREATER_THAN_OR_EQUAL', 'GTE'].includes(op)) matched = Number(left) >= Number(right);
      else if (['LESS_THAN', 'LT'].includes(op)) matched = Number(left) < Number(right);
      else if (['LESS_THAN_OR_EQUAL', 'LTE'].includes(op)) matched = Number(left) <= Number(right);
      else if (['IN'].includes(op)) matched = Array.isArray(right) ? right.includes(left) : String(right).split(',').includes(String(left));
      return { field: cond.field, operator: cond.operator, value: cond.value, actual: left, matched };
    });
  }

  private normalizeConditions(dto: CreateCommissionRuleDto) {
    const list = dto.conditionList || (Array.isArray(dto.conditions) ? dto.conditions : dto.conditions?.all) || [];
    const normalized = list.map((condition: any) => {
      if (!condition.field || !condition.operator || condition.value === undefined || condition.value === '') {
        throw new BadRequestException('Each condition must include field, operator, and value.');
      }
      return {
        field: this.normalizeField(condition.field),
        operator: this.normalizeOperator(condition.operator),
        value: this.normalizeConditionValue(condition.field, condition.value),
      };
    });
    return { matchType: dto.matchType || 'ALL', all: normalized };
  }

  private normalizeField(field: string) {
    const map: Record<string, string> = {
      Country: 'country',
      'Customer Country': 'country',
      'Product Tier': 'productTier',
      'Monthly Revenue': 'monthlyRevenue',
      'Fraud Risk Score': 'fraudRiskScore',
      amount: 'amount',
      OrderAmount: 'amount',
    };
    return map[field] || field;
  }

  private normalizeOperator(operator: string) {
    const map: Record<string, string> = {
      equals: 'EQUALS',
      'greater than': 'GREATER_THAN',
      'is below': 'LESS_THAN',
      lt: 'LESS_THAN',
      gt: 'GREATER_THAN',
      eq: 'EQUALS',
    };
    return map[operator] || operator;
  }

  private normalizeConditionValue(field: string, value: any) {
    const normalizedField = this.normalizeField(field);
    if (normalizedField === 'country' && value === 'India') return 'IN';
    if (normalizedField === 'country' && value === 'Brazil / LatAm') return 'BR';
    if (normalizedField === 'productTier' && value === 'Premium Plan') return 'PREMIUM';
    if (['monthlyRevenue', 'fraudRiskScore', 'amount'].includes(normalizedField)) {
      return Number(String(value).replace(/[^0-9.]/g, ''));
    }
    return value;
  }

  private normalizeCommissionValue(type: CommissionType, value: number) {
    return type === CommissionType.PERCENTAGE ? Math.round(value * 100) : Math.round(value);
  }

  private createUniqueRuleSlug(organizationId: string, programId: string | null, name: string) {
    const baseSlug = this.slugify(name);
    const existingSlugs = new Set(
      dbStore.commissionRules
        .filter((rule) => rule.organizationId === organizationId && (rule.programId || null) === programId && rule.status !== 'ARCHIVED')
        .map((rule) => rule.slug),
    );
    if (!existingSlugs.has(baseSlug)) return baseSlug;

    let suffix = 2;
    while (existingSlugs.has(`${baseSlug}-${suffix}`)) suffix += 1;
    return `${baseSlug}-${suffix}`;
  }

  private slugify(value: string) {
    const slug = value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || 'commission-rule';
  }

  private validateAction(type: CommissionType, value: number, holdPeriodDays: number) {
    if (type === CommissionType.PERCENTAGE && (value <= 0 || value > 100)) {
      throw new BadRequestException('Percentage commission must be greater than 0 and at most 100.');
    }
    if (type === CommissionType.FIXED_AMOUNT && value < 0) {
      throw new BadRequestException('Fixed commission must be non-negative.');
    }
    if (holdPeriodDays < 0) throw new BadRequestException('Hold period must be non-negative.');
  }

  private audit(organizationId: string, actorId: string, action: string, ruleId: string, metadata?: Record<string, any>) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: action as AuditAction,
      resourceType: 'commission_rule',
      resourceId: ruleId,
      metadata,
      createdAt: new Date(),
    });
  }
}
