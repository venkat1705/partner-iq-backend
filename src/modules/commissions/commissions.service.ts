import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, CommissionRuleEntity, CommissionEntity, ConversionEntity } from '../../database/store';
import { CommissionType, ConversionStatus, LedgerEntryType, AuditAction, WebhookEvent } from '../../common/enums';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { LedgerService } from '../ledger/ledger.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CreateCommissionRuleDto, TestCommissionRulesDto, UpdateCommissionRuleDto } from './dto/commission.dto';
import { SystemEmailDispatchService } from '../email-design/services/system-email-dispatch.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import { getAppConfig } from '../../config/app.config';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CommissionsService {
  private readonly logger = new Logger(CommissionsService.name);

  constructor(
    private readonly ledgerService: LedgerService,
    private readonly webhooksService?: WebhooksService,
    private readonly emailDispatch?: SystemEmailDispatchService,
    private readonly notificationsService?: NotificationsService,
    private readonly auditService?: AuditService,
  ) { }

  private emitWebhook(organizationId: string, event: WebhookEvent, payload: any) {
    this.webhooksService?.triggerEvent(organizationId, event, payload).catch((error) => {
      this.logger.error(`Webhook delivery failed for ${event}: ${error?.message || error}`);
    });
  }

  private formatMoney(cents: number, currency: string = PLATFORM_CURRENCY) {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }

  async notifyAffiliateCommission(
    templateKey: SystemTemplateKey,
    organizationId: string,
    affiliateId: string,
    commissionAmountCents: number,
    currency: string,
    extra: Record<string, any> = {},
  ) {
    const affiliate = dbStore.affiliates.find((a) => a.id === affiliateId);
    if (!affiliate?.email) return;
    const organization = dbStore.organizations.find((o) => o.id === organizationId);
    const dashboardUrl = `${getAppConfig().affiliateFrontendUrl.replace(/\/$/, '')}/commissions`;

    await this.emailDispatch?.send(
      templateKey,
      affiliate.email,
      {
        affiliate: { firstName: (affiliate.displayName || '').split(' ')[0] || affiliate.displayName },
        organization: { name: organization?.name || 'PartnerIQ' },
        commission: { amountFormatted: this.formatMoney(commissionAmountCents, currency), currency, ...extra },
        links: { dashboardUrl },
      },
      { organizationId },
    );

    const userId = affiliate.userId || dbStore.users.find((u) => u.email?.toLowerCase() === affiliate.email.toLowerCase())?.id;
    if (!userId) return;

    const isReversed = templateKey === SystemTemplateKey.AFFILIATE_COMMISSION_REVERSED;
    this.notificationsService?.createNotification({
      userId,
      organizationId,
      type: 'commission',
      title: isReversed ? 'Commission reversed' : 'New commission earned',
      body: isReversed
        ? `A commission of ${this.formatMoney(commissionAmountCents, currency)} was reversed${extra.reason ? `: ${extra.reason}` : '.'}`
        : `You earned a commission of ${this.formatMoney(commissionAmountCents, currency)}.`,
      channel: 'in_app',
      priority: isReversed ? 'high' : 'normal',
      actionUrl: '/commissions',
    }).catch(() => undefined);
  }

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

        const adjustmentEntry = {
          organizationId,
          actorType: 'system' as const,
          actorId: 'system',
          action: AuditAction.COMMISSION_APPROVED,
          resourceType: 'commission_adjustment',
          resourceId: comm.id,
          metadata: { affiliateId, programId, previousCommission: comm.commissionAmount, newCommission: newAmount, delta },
        };
        if (this.auditService) {
          this.auditService.log(adjustmentEntry);
        } else {
          dbStore.auditLogs.push({ id: uuidv4(), createdAt: new Date(), ...adjustmentEntry });
        }

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
    this.audit(organizationId, 'system', 'COMMISSION_RULE_CREATED', rule.id, { after: rule, version: rule.version });
    return rule;
  }

  /**
   * Updating a rule bumps its version in place and records a full before/after
   * snapshot in the audit trail (resourceType 'commission_rule') — this is the
   * rule's version history: GET .../rules/:ruleId/history replays it as a timeline.
   */
  async updateRule(organizationId: string, ruleId: string, dto: UpdateCommissionRuleDto, actorId = 'system') {
    const rule = dbStore.commissionRules.find(
      (r) => r.id === ruleId && r.organizationId === organizationId && r.status !== 'ARCHIVED',
    );
    if (!rule) throw new NotFoundException('Commission rule not found');

    const before = { ...rule };
    const scopeProgramId = rule.programId || null;

    if (dto.name?.trim() && dto.name.trim().toLowerCase() !== rule.name.toLowerCase()) {
      const nameExists = dbStore.commissionRules.some(
        (r) =>
          r.id !== ruleId &&
          r.organizationId === organizationId &&
          (r.programId || null) === scopeProgramId &&
          r.status !== 'ARCHIVED' &&
          r.name.trim().toLowerCase() === dto.name!.trim().toLowerCase(),
      );
      if (nameExists) throw new BadRequestException('A commission rule with this name already exists. Use a unique rule name.');
      rule.name = dto.name.trim();
      rule.slug = this.createUniqueRuleSlug(organizationId, scopeProgramId, rule.name);
    }

    if (dto.priority !== undefined && dto.priority !== rule.priority) {
      const priorityExists = dbStore.commissionRules.some(
        (r) => r.id !== ruleId && r.organizationId === organizationId && (r.programId || null) === scopeProgramId && r.priority === dto.priority && r.status !== 'ARCHIVED',
      );
      if (priorityExists) throw new BadRequestException('A rule with this priority already exists. Choose another priority.');
      rule.priority = dto.priority;
    }

    const nextCommissionType = dto.commissionType ?? rule.commissionType;
    const nextCommissionValueRaw = dto.commissionValue ?? (rule.commissionType === CommissionType.PERCENTAGE ? rule.commissionValue / 100 : rule.commissionValue);
    const nextHoldPeriodDays = dto.holdPeriodDays ?? rule.holdPeriodDays;
    this.validateAction(nextCommissionType, nextCommissionValueRaw, nextHoldPeriodDays);
    rule.commissionType = nextCommissionType;
    rule.commissionValue = this.normalizeCommissionValue(nextCommissionType, nextCommissionValueRaw);
    rule.holdPeriodDays = nextHoldPeriodDays;

    if (dto.conditionList || dto.conditions) {
      rule.conditions = this.normalizeConditions(dto as CreateCommissionRuleDto);
    }

    if (dto.status) {
      rule.status = dto.status;
      rule.active = dto.status === 'ACTIVE';
    }

    rule.version += 1;
    rule.updatedAt = new Date();

    this.audit(organizationId, actorId, 'COMMISSION_RULE_UPDATED', rule.id, { before, after: { ...rule }, version: rule.version });
    return rule;
  }

  /**
   * Rule version history — replays the audit trail recorded on create/update/delete
   * for this rule into a human-readable timeline, newest first.
   */
  async getRuleHistory(organizationId: string, ruleId: string) {
    const rule = dbStore.commissionRules.find((r) => r.id === ruleId && r.organizationId === organizationId);
    if (!rule) throw new NotFoundException('Commission rule not found');

    return dbStore.auditLogs
      .filter(
        (log) =>
          log.organizationId === organizationId &&
          log.resourceType === 'commission_rule' &&
          log.resourceId === ruleId,
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((log) => ({
        id: log.id,
        action: log.action,
        version: (log.metadata as any)?.version,
        before: (log.metadata as any)?.before,
        after: (log.metadata as any)?.after,
        actorId: log.actorId,
        createdAt: log.createdAt,
      }));
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

    this.audit(organizationId, 'system', 'COMMISSION_RULE_DELETED', rule.id, { before: rule, version: rule.version });
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

    // Guard against currency mismatch inflation: commission math below multiplies
    // conversion.amount directly by the program's rate, so a conversion reported in a
    // different currency than the program would silently over/under-pay by orders of
    // magnitude. PartnerIQ enforces INR only at every input boundary (DTOs reject any
    // other currency), so this should never trigger in practice — kept as defense in
    // depth against legacy data or a bypassed validation path.
    if (program?.currency && conversion.currency && program.currency.toUpperCase() !== conversion.currency.toUpperCase()) {
      throw new BadRequestException(
        `Conversion currency (${conversion.currency}) does not match program currency (${program.currency}). Currency conversion is not supported; commission cannot be safely calculated.`,
      );
    }

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

    // Per-affiliate commission override (set by a COMMISSION_RATE_CHANGE milestone reward,
    // or manually by an admin) on this specific program enrollment. More specific than the
    // tier default — a reward earned by this individual affiliate should stick even if their
    // tier's base rate is lower — but a merchant-configured commission RULE below is still the
    // final, most specific word (e.g. a fraud-risk clamp) and can still override it.
    const enrollment = dbStore.programAffiliates.find(
      (pa) => pa.organizationId === organizationId && pa.programId === conversion.programId && pa.affiliateId === affiliateId,
    );
    if (enrollment?.commissionOverride !== undefined && enrollment.commissionOverride !== null && enrollment.commissionOverrideType) {
      if (enrollment.commissionOverrideType === CommissionType.FIXED || enrollment.commissionOverrideType === CommissionType.FIXED_AMOUNT) {
        commissionType = CommissionType.FIXED;
      } else {
        commissionType = enrollment.commissionOverrideType as CommissionType;
      }
      commissionValue = enrollment.commissionOverride;
    }

    // Load active custom rules sorted by priority — program-specific rules and
    // the organization-wide default rule (no programId) are both eligible.
    const rules = dbStore.commissionRules
      .filter((r) => r.organizationId === organizationId && (r.programId === conversion.programId || !r.programId) && r.active && r.status === 'ACTIVE')
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
      reversedAmount: 0,
      calculationVersion: 'v1.0',
      status: ConversionStatus.APPROVED,
      createdAt: new Date(),
    };

    dbStore.commissions.push(commission);

    this.emitWebhook(organizationId, WebhookEvent.COMMISSION_CREATED, {
      commissionId: commission.id,
      conversionId: conversion.id,
      affiliateId,
      status: commission.status,
    });

    // Post immutable double-entry ledger record
    await this.ledgerService.recordTransaction(
      organizationId,
      affiliateId,
      LedgerEntryType.COMMISSION_EARNED,
      `Commission earned for conversion ${conversion.externalId}`,
      commission.id,
      commissionAmount,
    );

    const currency = program?.currency || PLATFORM_CURRENCY;
    this.notifyAffiliateCommission(
      SystemTemplateKey.AFFILIATE_COMMISSION_CREATED,
      organizationId,
      affiliateId,
      commissionAmount,
      currency,
    ).catch(() => undefined);

    return commission;
  }

  async getCommissions(organizationId: string, programId?: string) {
    return dbStore.commissions.filter((c) => c.organizationId === organizationId && (!programId || c.programId === programId));
  }

  private evaluateProgramRules(organizationId: string, programId: string, context: Record<string, any>) {
    // Program-specific rules and org-wide default rules (no programId — e.g. the
    // rule seeded automatically when the organization was created) are both
    // eligible; a program-specific rule naturally wins when given a higher
    // priority than the organization-wide default.
    const rules = dbStore.commissionRules
      .filter((r) => r.organizationId === organizationId && (r.programId === programId || !r.programId) && r.active && r.status === 'ACTIVE')
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
    const entry = {
      organizationId,
      actorType: (actorId === 'system' ? 'system' : 'user') as 'user' | 'system',
      actorId,
      action: action as AuditAction,
      resourceType: 'commission_rule',
      resourceId: ruleId,
      metadata,
    };
    if (this.auditService) {
      this.auditService.log(entry);
      return;
    }
    dbStore.auditLogs.push({ id: uuidv4(), createdAt: new Date(), ...entry });
  }
}
