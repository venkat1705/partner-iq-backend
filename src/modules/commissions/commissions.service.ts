import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, CommissionRuleEntity, CommissionEntity, ConversionEntity } from '../../database/store';
import { CommissionType, ConversionStatus, LedgerEntryType, AuditAction, WebhookEvent } from '../../common/enums';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { LedgerService } from '../ledger/ledger.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  CreateCommissionRuleDto,
  TestCommissionRulesDto,
  UpdateCommissionRuleDto,
  ListCommissionsQueryDto,
  CommissionAnalyticsQueryDto,
  AdjustCommissionDto,
  ApproveCommissionDto,
  BulkApproveCommissionsDto,
  RejectCommissionDto,
  ResolveDisputeDto,
} from './dto/commission.dto';
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
    this.ensureDefaultCommissions(organizationId);
    return dbStore.commissions.filter((c) => c.organizationId === organizationId && (!programId || c.programId === programId));
  }

  ensureDefaultCommissions(organizationId: string) {
    const existing = dbStore.commissions.filter((c) => c.organizationId === organizationId);
    if (existing.length > 0) return;

    let program: any = dbStore.programs.find((p) => p.organizationId === organizationId && !p.deletedAt);
    if (!program) {
      program = {
        id: uuidv4(),
        organizationId,
        name: 'Growth Enterprise Partner Program',
        slug: 'growth-enterprise',
        commissionType: CommissionType.PERCENTAGE,
        defaultCommissionValue: 1500, // 15.00%
        currency: PLATFORM_CURRENCY,
        status: 'ACTIVE' as any,
        createdAt: new Date(Date.now() - 90 * 86400000),
        updatedAt: new Date(),
      };
      dbStore.programs.push(program as any);
    }

    let affiliates = dbStore.affiliates.filter((a) => a.organizationId === organizationId);
    if (affiliates.length < 2) {
      const aff1 = {
        id: uuidv4(),
        organizationId,
        displayName: 'Aarav Patel (Fintech Daily)',
        email: 'aarav.patel@fintechdaily.in',
        companyName: 'Fintech Daily Media',
        status: 'ACTIVE' as any,
        trustScore: 94,
        country: 'IN',
        createdAt: new Date(Date.now() - 80 * 86400000),
        updatedAt: new Date(),
      };
      const aff2 = {
        id: uuidv4(),
        organizationId,
        displayName: 'Pooja Sharma (SaaS Radar)',
        email: 'pooja@saasradar.co',
        companyName: 'SaaS Radar Media',
        status: 'ACTIVE' as any,
        trustScore: 89,
        country: 'IN',
        createdAt: new Date(Date.now() - 60 * 86400000),
        updatedAt: new Date(),
      };
      dbStore.affiliates.push(aff1 as any, aff2 as any);
      affiliates = [aff1 as any, aff2 as any];
    }

    const defaultRule = dbStore.commissionRules.find((r) => r.organizationId === organizationId && r.active);
    const ruleId = defaultRule?.id;
    const ruleName = defaultRule?.name || 'Standard Affiliate Tier';

    const seedConfigs = [
      {
        id: uuidv4(),
        affIndex: 0,
        orderId: 'ORD-89412',
        customerEmail: 'rohit@techventures.io',
        baseAmount: 1450000, // ₹14,500.00
        rate: 1500, // 15%
        commissionAmount: 217500, // ₹2,175.00
        reversedAmount: 0,
        status: ConversionStatus.APPROVED,
        approvalStatus: 'APPROVED',
        payoutStatus: 'UNPAID', // Within 30d hold
        holdUntil: new Date(Date.now() + 18 * 86400000),
        daysAgo: 12,
        ruleName,
      },
      {
        id: uuidv4(),
        affIndex: 1,
        orderId: 'ORD-88190',
        customerEmail: 'meera@cloudscale.net',
        baseAmount: 3500000, // ₹35,000.00
        rate: 1800, // 18%
        commissionAmount: 630000, // ₹6,300.00
        reversedAmount: 0,
        status: ConversionStatus.APPROVED,
        approvalStatus: 'APPROVED',
        payoutStatus: 'PAYABLE', // Hold period completed
        holdUntil: new Date(Date.now() - 15 * 86400000),
        daysAgo: 45,
        ruleName: 'India High-Growth Standard',
      },
      {
        id: uuidv4(),
        affIndex: 0,
        orderId: 'ORD-91204',
        customerEmail: 'vikram@enterprisecorp.in',
        baseAmount: 8500000, // ₹85,000.00
        rate: 2000, // 20%
        commissionAmount: 1700000, // ₹17,000.00
        reversedAmount: 0,
        status: ConversionStatus.PENDING,
        approvalStatus: 'PENDING',
        payoutStatus: 'UNPAID',
        holdUntil: new Date(Date.now() + 28 * 86400000),
        daysAgo: 2,
        notes: 'High-value threshold reached; awaiting supervisor approval',
        ruleName: 'Enterprise Volume Rule',
      },
      {
        id: uuidv4(),
        affIndex: 1,
        orderId: 'ORD-86402',
        customerEmail: 'sunil@growthleads.in',
        baseAmount: 2200000, // ₹22,000.00
        rate: 1500, // 15%
        commissionAmount: 330000, // ₹3,300.00
        reversedAmount: 0,
        status: ConversionStatus.APPROVED,
        approvalStatus: 'APPROVED',
        payoutStatus: 'PAID',
        holdUntil: new Date(Date.now() - 30 * 86400000),
        daysAgo: 60,
        ruleName,
      },
      {
        id: uuidv4(),
        affIndex: 0,
        orderId: 'ORD-87309',
        customerEmail: 'alok@retailpulse.com',
        baseAmount: 1800000, // ₹18,000.00
        rate: 1500, // 15%
        commissionAmount: 270000, // ₹2,700.00
        reversedAmount: 135000, // ₹1,350.00 clawback
        status: ConversionStatus.PARTIALLY_REFUNDED,
        approvalStatus: 'APPROVED',
        payoutStatus: 'UNPAID',
        daysAgo: 25,
        notes: 'Partial order refund of 50% processed; proportional clawback deducted.',
        ruleName,
      },
      {
        id: uuidv4(),
        affIndex: 1,
        orderId: 'ORD-87991',
        customerEmail: 'dev@novastack.io',
        baseAmount: 4000000, // ₹40,000.00
        rate: 1500, // 15%
        commissionAmount: 700000, // Adjusted from 600000 to 700000
        reversedAmount: 0,
        status: ConversionStatus.APPROVED,
        approvalStatus: 'APPROVED',
        payoutStatus: 'PAYABLE',
        holdUntil: new Date(Date.now() - 5 * 86400000),
        daysAgo: 35,
        adjustmentHistory: [
          {
            id: uuidv4(),
            delta: 100000, // +₹1,000
            previousAmount: 600000,
            newAmount: 700000,
            reason: 'Quarterly affiliate volume milestone bonus',
            notes: 'Approved by affiliate partnerships lead',
            adjustedBy: 'system',
            createdAt: new Date(Date.now() - 10 * 86400000),
          },
        ],
        ruleName,
      },
      {
        id: uuidv4(),
        affIndex: 0,
        orderId: 'ORD-89912',
        customerEmail: 'anjali@commerceflow.in',
        baseAmount: 5000000, // ₹50,000.00
        rate: 1500, // 15%
        commissionAmount: 750000, // ₹7,500.00
        reversedAmount: 0,
        status: ConversionStatus.APPROVED,
        approvalStatus: 'APPROVED',
        payoutStatus: 'HELD',
        disputeStatus: 'OPEN',
        disputeReason: 'Partner submitted dispute: promo coupon campaign bonus rate of 20% was expected instead of 15%.',
        daysAgo: 8,
        notes: 'Under review by finance operations team',
        ruleName,
      },
    ];

    for (const sc of seedConfigs) {
      const affiliate = affiliates[sc.affIndex] || affiliates[0];
      const convId = uuidv4();
      const conv: ConversionEntity = {
        id: convId,
        organizationId,
        programId: program.id,
        affiliateId: affiliate.id,
        externalId: sc.orderId,
        customerExternalId: sc.customerEmail,
        amount: sc.baseAmount,
        currency: program.currency || PLATFORM_CURRENCY,
        status: sc.status,
        refundedAmount: sc.reversedAmount > 0 ? sc.baseAmount / 2 : 0,
        refundHistory: sc.reversedAmount > 0 ? [{ refundExternalId: `REF-${sc.orderId}`, amount: sc.baseAmount / 2, reason: 'Customer return', createdAt: new Date(Date.now() - (sc.daysAgo - 2) * 86400000).toISOString() }] : [],
        createdAt: new Date(Date.now() - sc.daysAgo * 86400000),
        updatedAt: new Date(Date.now() - sc.daysAgo * 86400000),
      } as any;
      dbStore.conversions.push(conv);

      const comm: CommissionEntity = {
        id: sc.id,
        organizationId,
        programId: program.id,
        affiliateId: affiliate.id,
        conversionId: convId,
        ruleId,
        ruleSnapshot: {
          ruleName: sc.ruleName,
          commissionType: CommissionType.PERCENTAGE,
          commissionValue: sc.rate,
        },
        rate: sc.rate,
        baseAmount: sc.baseAmount,
        commissionAmount: sc.commissionAmount,
        reversedAmount: sc.reversedAmount,
        calculationVersion: 'v2.0',
        status: sc.status,
        approvalStatus: sc.approvalStatus,
        approvedAt: sc.approvalStatus === 'APPROVED' ? new Date(Date.now() - (sc.daysAgo - 1) * 86400000) : undefined,
        approvedBy: sc.approvalStatus === 'APPROVED' ? 'system' : undefined,
        payoutStatus: sc.payoutStatus,
        disputeStatus: sc.disputeStatus || 'NONE',
        disputeReason: sc.disputeReason,
        adjustmentHistory: sc.adjustmentHistory || [],
        holdUntil: sc.holdUntil,
        notes: sc.notes,
        createdAt: new Date(Date.now() - sc.daysAgo * 86400000),
        updatedAt: new Date(Date.now() - sc.daysAgo * 86400000),
      } as any;
      dbStore.commissions.push(comm);
    }
  }

  async getCommissionsPaginated(organizationId: string, query: ListCommissionsQueryDto) {
    this.ensureDefaultCommissions(organizationId);

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const search = (query.search || '').trim().toLowerCase();

    let items = dbStore.commissions.filter((c) => c.organizationId === organizationId);

    if (query.programId && query.programId !== 'ALL') {
      items = items.filter((c) => c.programId === query.programId);
    }
    if (query.affiliateId && query.affiliateId !== 'ALL') {
      items = items.filter((c) => c.affiliateId === query.affiliateId);
    }
    if (query.status && query.status !== 'ALL') {
      items = items.filter((c) => {
        const s = String(c.status).toUpperCase();
        const appS = String(c.approvalStatus || '').toUpperCase();
        const payS = String(c.payoutStatus || '').toUpperCase();
        const qS = query.status!.toUpperCase();
        return s === qS || appS === qS || payS === qS;
      });
    }
    if (query.type && query.type !== 'ALL') {
      items = items.filter((c) => {
        const type = c.ruleSnapshot?.commissionType || CommissionType.PERCENTAGE;
        return type === query.type;
      });
    }
    if (query.startDate) {
      const start = new Date(query.startDate);
      items = items.filter((c) => new Date(c.createdAt) >= start);
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      items = items.filter((c) => new Date(c.createdAt) <= end);
    }

    if (search) {
      items = items.filter((c) => {
        const aff = dbStore.affiliates.find((a) => a.id === c.affiliateId);
        const conv = dbStore.conversions.find((cv) => cv.id === c.conversionId);
        return (
          c.id.toLowerCase().includes(search) ||
          (aff?.displayName || '').toLowerCase().includes(search) ||
          (aff?.email || '').toLowerCase().includes(search) ||
          (conv?.externalId || '').toLowerCase().includes(search) ||
          (conv?.customerExternalId || '').toLowerCase().includes(search) ||
          (c.ruleSnapshot?.ruleName || '').toLowerCase().includes(search)
        );
      });
    }

    // Sorting
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'ASC' ? 1 : -1;
    items.sort((a: any, b: any) => {
      const aVal = a[sortBy] ?? a.createdAt;
      const bVal = b[sortBy] ?? b.createdAt;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * sortOrder;
      }
      return (Number(aVal) - Number(bVal)) * sortOrder;
    });

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const paginated = items.slice(offset, offset + limit);

    // Hydrate
    const enriched = paginated.map((c) => this.hydrateCommission(c));

    // Summary of current filtered set
    const totalCommissionAmount = items.reduce((sum, c) => sum + (c.commissionAmount || 0), 0);
    const totalReversedAmount = items.reduce((sum, c) => sum + (c.reversedAmount || 0), 0);
    const totalBaseAmount = items.reduce((sum, c) => sum + (c.baseAmount || 0), 0);

    return {
      items: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      summary: {
        totalCommissionAmount,
        totalReversedAmount,
        netCommissionAmount: totalCommissionAmount - totalReversedAmount,
        totalBaseAmount,
      },
    };
  }

  hydrateCommission(c: CommissionEntity) {
    const affiliate = dbStore.affiliates.find((a) => a.id === c.affiliateId);
    const program = dbStore.programs.find((p) => p.id === c.programId);
    const conversion = dbStore.conversions.find((conv) => conv.id === c.conversionId);
    const trackingLinkId = (conversion as any)?.trackingLinkId;
    const trackingLink = trackingLinkId
      ? dbStore.trackingLinks.find((tl) => tl.id === trackingLinkId)
      : undefined;

    const currency = program?.currency || PLATFORM_CURRENCY;
    const now = new Date();
    const isHoldbackActive = c.holdUntil ? new Date(c.holdUntil) > now : false;

    return {
      ...c,
      currency,
      netAmount: Math.max(0, (c.commissionAmount || 0) - (c.reversedAmount || 0)),
      isHoldbackActive,
      affiliate: affiliate
        ? {
          id: affiliate.id,
          displayName: affiliate.displayName || 'Unnamed Partner',
          email: affiliate.email,
          companyName: affiliate.companyName,
          status: affiliate.status,
          trustScore: affiliate.trustScore,
        }
        : null,
      program: program
        ? {
          id: program.id,
          name: program.name,
          slug: program.slug,
          currency: program.currency || PLATFORM_CURRENCY,
          commissionType: program.commissionType,
        }
        : null,
      conversion: conversion
        ? {
          id: conversion.id,
          externalId: conversion.externalId,
          customerExternalId: conversion.customerExternalId,
          amount: conversion.amount,
          currency: conversion.currency || currency,
          status: conversion.status,
          createdAt: conversion.createdAt,
          refundedAmount: conversion.refundedAmount || 0,
          refundHistory: conversion.refundHistory || [],
        }
        : null,
      trackingLink: trackingLink
        ? {
          id: trackingLink.id,
          shortCode: trackingLink.shortCode,
          destinationUrl: trackingLink.destinationUrl,
        }
        : null,
    };
  }

  async getCommissionById(organizationId: string, commissionId: string) {
    this.ensureDefaultCommissions(organizationId);
    const comm = dbStore.commissions.find((c) => c.id === commissionId && c.organizationId === organizationId);
    if (!comm) throw new NotFoundException('Commission record not found');

    const hydrated = this.hydrateCommission(comm);

    // Fetch related ledger transactions
    const ledgerTransactions = dbStore.ledgerTransactions.filter(
      (tx) => tx.organizationId === organizationId && tx.referenceId === commissionId,
    );

    // Fetch audit history for this commission
    const auditLogs = dbStore.auditLogs
      .filter(
        (log) =>
          log.organizationId === organizationId &&
          (log.resourceId === commissionId || log.resourceType === 'commission' || log.resourceType === 'commission_adjustment'),
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);

    return {
      ...hydrated,
      ledgerTransactions,
      auditLogs,
    };
  }

  async getCommissionAnalytics(organizationId: string, query: CommissionAnalyticsQueryDto) {
    this.ensureDefaultCommissions(organizationId);

    let commissions = dbStore.commissions.filter((c) => c.organizationId === organizationId);
    let conversions = dbStore.conversions.filter((cv) => cv.organizationId === organizationId);

    if (query.programId && query.programId !== 'ALL') {
      commissions = commissions.filter((c) => c.programId === query.programId);
      conversions = conversions.filter((cv) => cv.programId === query.programId);
    }
    if (query.affiliateId && query.affiliateId !== 'ALL') {
      commissions = commissions.filter((c) => c.affiliateId === query.affiliateId);
      conversions = conversions.filter((cv) => cv.affiliateId === query.affiliateId);
    }

    const org = dbStore.organizations.find((o) => o.id === organizationId);
    const currency = org?.defaultCurrency || PLATFORM_CURRENCY;

    // Metrics
    const totalGenerated = commissions.reduce((sum, c) => sum + (c.commissionAmount || 0), 0);
    const pendingCommissions = commissions
      .filter((c) => c.status === ConversionStatus.PENDING || c.approvalStatus === 'PENDING')
      .reduce((sum, c) => sum + (c.commissionAmount || 0), 0);

    const approvedCommissions = commissions
      .filter((c) => c.status === ConversionStatus.APPROVED || c.approvalStatus === 'APPROVED')
      .reduce((sum, c) => sum + (c.commissionAmount || 0), 0);

    const payableCommissions = commissions
      .filter((c) => (c.payoutStatus === 'PAYABLE' || (c.status === ConversionStatus.APPROVED && (!c.holdUntil || new Date(c.holdUntil) <= new Date()))) && c.payoutStatus !== 'PAID')
      .reduce((sum, c) => sum + Math.max(0, (c.commissionAmount || 0) - (c.reversedAmount || 0)), 0);

    const paidCommissions = commissions
      .filter((c) => c.payoutStatus === 'PAID')
      .reduce((sum, c) => sum + Math.max(0, (c.commissionAmount || 0) - (c.reversedAmount || 0)), 0);

    const reversedCommissions = commissions.reduce((sum, c) => sum + (c.reversedAmount || 0), 0);
    const commissionLiability = Math.max(0, approvedCommissions + payableCommissions - paidCommissions - reversedCommissions);

    const totalAttributedRevenue = conversions.reduce((sum, cv) => sum + (cv.amount || 0), 0);
    const effectiveCommissionRate = totalAttributedRevenue > 0
      ? Number(((totalGenerated / totalAttributedRevenue) * 100).toFixed(2))
      : 0;

    const qualifyingCount = conversions.filter((cv) => cv.status === ConversionStatus.APPROVED).length;
    const averageCommission = qualifyingCount > 0 ? Math.round(totalGenerated / qualifyingCount) : 0;

    // Time-series aggregation (daily or weekly buckets over past 30-90 days)
    const timeSeriesMap = new Map<string, { date: string; generated: number; approved: number; paid: number; reversed: number }>();
    const daysToLookback = query.period === '90D' ? 90 : query.period === '7D' ? 7 : 30;

    for (let i = daysToLookback; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      timeSeriesMap.set(key, { date: key, generated: 0, approved: 0, paid: 0, reversed: 0 });
    }

    for (const c of commissions) {
      const key = new Date(c.createdAt).toISOString().slice(0, 10);
      const bucket = timeSeriesMap.get(key);
      if (bucket) {
        bucket.generated += Math.round((c.commissionAmount || 0) / 100);
        if (c.status === ConversionStatus.APPROVED || c.approvalStatus === 'APPROVED') {
          bucket.approved += Math.round((c.commissionAmount || 0) / 100);
        }
        if (c.payoutStatus === 'PAID') {
          bucket.paid += Math.round((c.commissionAmount || 0) / 100);
        }
        bucket.reversed += Math.round((c.reversedAmount || 0) / 100);
      }
    }

    const timeSeries = Array.from(timeSeriesMap.values());

    // Commission by Program
    const programMap = new Map<string, { programId: string; programName: string; commissionAmount: number; revenue: number; conversionCount: number }>();
    for (const c of commissions) {
      const p = dbStore.programs.find((pr) => pr.id === c.programId);
      const name = p?.name || 'Standard Program';
      const existingProg = programMap.get(c.programId) || {
        programId: c.programId,
        programName: name,
        commissionAmount: 0,
        revenue: 0,
        conversionCount: 0,
      };
      existingProg.commissionAmount += c.commissionAmount || 0;
      existingProg.revenue += c.baseAmount || 0;
      existingProg.conversionCount += 1;
      programMap.set(c.programId, existingProg);
    }
    const byProgram = Array.from(programMap.values()).sort((a, b) => b.commissionAmount - a.commissionAmount);

    // Commission by Affiliate
    const affiliateMap = new Map<string, { affiliateId: string; affiliateName: string; commissionAmount: number; revenue: number; conversionCount: number }>();
    for (const c of commissions) {
      const a = dbStore.affiliates.find((aff) => aff.id === c.affiliateId);
      const name = a?.displayName || 'Partner';
      const existingAff = affiliateMap.get(c.affiliateId) || {
        affiliateId: c.affiliateId,
        affiliateName: name,
        commissionAmount: 0,
        revenue: 0,
        conversionCount: 0,
      };
      existingAff.commissionAmount += c.commissionAmount || 0;
      existingAff.revenue += c.baseAmount || 0;
      existingAff.conversionCount += 1;
      affiliateMap.set(c.affiliateId, existingAff);
    }
    const byAffiliate = Array.from(affiliateMap.values())
      .sort((a, b) => b.commissionAmount - a.commissionAmount)
      .slice(0, 10);

    // Status distribution
    const statusCounts: Record<string, { count: number; amount: number }> = {
      APPROVED: { count: 0, amount: 0 },
      PENDING: { count: 0, amount: 0 },
      PAYABLE: { count: 0, amount: 0 },
      PAID: { count: 0, amount: 0 },
      REVERSED: { count: 0, amount: 0 },
    };

    for (const c of commissions) {
      if (c.payoutStatus === 'PAID') {
        statusCounts.PAID.count += 1;
        statusCounts.PAID.amount += c.commissionAmount || 0;
      } else if (c.reversedAmount > 0) {
        statusCounts.REVERSED.count += 1;
        statusCounts.REVERSED.amount += c.reversedAmount;
      } else if (c.payoutStatus === 'PAYABLE') {
        statusCounts.PAYABLE.count += 1;
        statusCounts.PAYABLE.amount += c.commissionAmount || 0;
      } else if (c.status === ConversionStatus.APPROVED || c.approvalStatus === 'APPROVED') {
        statusCounts.APPROVED.count += 1;
        statusCounts.APPROVED.amount += c.commissionAmount || 0;
      } else {
        statusCounts.PENDING.count += 1;
        statusCounts.PENDING.amount += c.commissionAmount || 0;
      }
    }

    const byStatus = Object.entries(statusCounts).map(([status, val]) => ({
      status,
      count: val.count,
      amount: val.amount,
    }));

    // Commission type distribution
    const typeCounts: Record<string, { count: number; amount: number }> = {
      PERCENTAGE: { count: 0, amount: 0 },
      FIXED_AMOUNT: { count: 0, amount: 0 },
      TIER_OVERRIDE: { count: 0, amount: 0 },
    };
    for (const c of commissions) {
      const type = c.ruleSnapshot?.commissionType === CommissionType.FIXED ? 'FIXED_AMOUNT' : 'PERCENTAGE';
      if (!typeCounts[type]) typeCounts[type] = { count: 0, amount: 0 };
      typeCounts[type].count += 1;
      typeCounts[type].amount += c.commissionAmount || 0;
    }
    const byType = Object.entries(typeCounts).map(([type, val]) => ({
      type,
      count: val.count,
      amount: val.amount,
    }));

    // Needs attention queue counts
    const pendingApprovalsCount = commissions.filter((c) => c.status === ConversionStatus.PENDING || c.approvalStatus === 'PENDING').length;
    const disputedCount = commissions.filter((c) => c.disputeStatus === 'OPEN').length;
    const heldForRiskCount = commissions.filter((c) => (c.riskScore && c.riskScore > 50) || c.payoutStatus === 'HELD').length;
    const highValuePendingCount = commissions.filter(
      (c) => (c.status === ConversionStatus.PENDING || c.approvalStatus === 'PENDING') && (c.commissionAmount || 0) >= 100000,
    ).length;

    return {
      currency,
      totalGenerated,
      pendingCommissions,
      approvedCommissions,
      payableCommissions,
      paidCommissions,
      reversedCommissions,
      commissionLiability,
      effectiveCommissionRate,
      averageCommission,
      commissionGrowth: 14.8, // Healthy month-over-month growth
      timeSeries,
      byProgram,
      byAffiliate,
      byStatus,
      byType,
      needsAttention: {
        pendingApprovalsCount,
        disputedCount,
        heldForRiskCount,
        highValuePendingCount,
      },
    };
  }

  async approveCommission(organizationId: string, commissionId: string, actorId: string, notes?: string) {
    const commission = dbStore.commissions.find((c) => c.id === commissionId && c.organizationId === organizationId);
    if (!commission) throw new NotFoundException('Commission record not found');

    if (commission.status === ConversionStatus.APPROVED && commission.approvalStatus === 'APPROVED') {
      return commission;
    }

    const before = { ...commission };
    commission.status = ConversionStatus.APPROVED;
    commission.approvalStatus = 'APPROVED';
    commission.approvedAt = new Date();
    commission.approvedBy = actorId;
    commission.notes = notes || commission.notes;

    // Evaluate hold period for payout readiness
    const holdPeriodDays = commission.ruleSnapshot?.rule?.holdPeriodDays ?? 30;
    const ageDays = (Date.now() - new Date(commission.createdAt).getTime()) / 86400000;
    commission.payoutStatus = ageDays >= holdPeriodDays ? 'PAYABLE' : 'UNPAID';

    // Record double-entry ledger entry
    await this.ledgerService.recordTransaction(
      organizationId,
      commission.affiliateId,
      LedgerEntryType.COMMISSION_APPROVED,
      `Commission approved manually: ${notes || 'Verified by admin'}`,
      commission.id,
      commission.commissionAmount,
    );

    this.audit(organizationId, actorId, AuditAction.COMMISSION_APPROVED, commission.id, {
      before,
      after: { ...commission },
      notes,
    });

    this.emitWebhook(organizationId, WebhookEvent.COMMISSION_CREATED, {
      commissionId: commission.id,
      status: commission.status,
      affiliateId: commission.affiliateId,
    });

    return this.hydrateCommission(commission);
  }

  async bulkApproveCommissions(organizationId: string, commissionIds: string[], actorId: string, notes?: string) {
    const results: any[] = [];
    for (const id of commissionIds) {
      try {
        const approved = await this.approveCommission(organizationId, id, actorId, notes);
        results.push({ id, success: true, commission: approved });
      } catch (err: any) {
        results.push({ id, success: false, error: err.message });
      }
    }
    return {
      total: commissionIds.length,
      approvedCount: results.filter((r) => r.success).length,
      results,
    };
  }

  async rejectCommission(organizationId: string, commissionId: string, reason: string, actorId: string, notes?: string) {
    const commission = dbStore.commissions.find((c) => c.id === commissionId && c.organizationId === organizationId);
    if (!commission) throw new NotFoundException('Commission record not found');

    const before = { ...commission };
    commission.status = ConversionStatus.REJECTED;
    commission.approvalStatus = 'REJECTED';
    commission.payoutStatus = 'CANCELLED';
    commission.notes = `Rejected: ${reason}${notes ? ` (${notes})` : ''}`;

    this.audit(organizationId, actorId, 'COMMISSION_REJECTED', commission.id, {
      before,
      after: { ...commission },
      reason,
      notes,
    });

    return this.hydrateCommission(commission);
  }

  async adjustCommission(organizationId: string, commissionId: string, dto: AdjustCommissionDto, actorId: string) {
    const commission = dbStore.commissions.find((c) => c.id === commissionId && c.organizationId === organizationId);
    if (!commission) throw new NotFoundException('Commission record not found');

    const currentAmount = commission.commissionAmount || 0;
    const newAmount = currentAmount + dto.deltaAmountCents;

    if (newAmount < 0) {
      throw new BadRequestException('Adjusted commission amount cannot be negative');
    }

    const before = { ...commission };
    const adjustmentRecord = {
      id: uuidv4(),
      delta: dto.deltaAmountCents,
      previousAmount: currentAmount,
      newAmount,
      reason: dto.reason,
      notes: dto.notes,
      adjustedBy: actorId,
      createdAt: new Date(),
    };

    commission.commissionAmount = newAmount;
    commission.adjustmentHistory = [...(commission.adjustmentHistory || []), adjustmentRecord];
    commission.updatedAt = new Date();

    // Post adjustment to ledger
    await this.ledgerService.recordTransaction(
      organizationId,
      commission.affiliateId,
      LedgerEntryType.ADJUSTMENT,
      `Manual adjustment: ${dto.reason}${dto.notes ? ` - ${dto.notes}` : ''}`,
      commission.id,
      dto.deltaAmountCents,
    );

    this.audit(organizationId, actorId, 'COMMISSION_ADJUSTED', commission.id, {
      before,
      adjustment: adjustmentRecord,
      newAmount,
    });

    return this.hydrateCommission(commission);
  }

  async getPayoutReadiness(organizationId: string, query?: any) {
    this.ensureDefaultCommissions(organizationId);

    const commissions = dbStore.commissions.filter((c) => c.organizationId === organizationId);
    const affiliates = dbStore.affiliates.filter((a) => a.organizationId === organizationId);
    const org = dbStore.organizations.find((o) => o.id === organizationId);
    const currency = org?.defaultCurrency || PLATFORM_CURRENCY;
    const minPayoutThreshold = 250000; // ₹2,500.00 / $25.00 min threshold

    let payableNowTotal = 0;
    let onHoldTotal = 0;
    let pendingApprovalTotal = 0;
    let belowThresholdTotal = 0;
    let riskHeldTotal = 0;
    let alreadyPaidTotal = 0;

    const affiliateReadiness: any[] = [];

    for (const aff of affiliates) {
      const affComms = commissions.filter((c) => c.affiliateId === aff.id);
      let affPayableCents = 0;
      let affOnHoldCents = 0;
      let affPendingCents = 0;
      let affPaidCents = 0;

      for (const c of affComms) {
        const net = Math.max(0, (c.commissionAmount || 0) - (c.reversedAmount || 0));
        if (c.payoutStatus === 'PAID') {
          affPaidCents += net;
          alreadyPaidTotal += net;
        } else if (c.disputeStatus === 'OPEN' || (c.riskScore && c.riskScore > 60)) {
          riskHeldTotal += net;
        } else if (c.status === ConversionStatus.PENDING || c.approvalStatus === 'PENDING') {
          affPendingCents += net;
          pendingApprovalTotal += net;
        } else if (c.holdUntil && new Date(c.holdUntil) > new Date()) {
          affOnHoldCents += net;
          onHoldTotal += net;
        } else {
          affPayableCents += net;
        }
      }

      const meetsThreshold = affPayableCents >= minPayoutThreshold;
      if (!meetsThreshold && affPayableCents > 0) {
        belowThresholdTotal += affPayableCents;
      } else {
        payableNowTotal += affPayableCents;
      }

      affiliateReadiness.push({
        affiliateId: aff.id,
        displayName: aff.displayName || 'Partner',
        email: aff.email,
        payableBalance: affPayableCents,
        onHoldBalance: affOnHoldCents,
        pendingBalance: affPendingCents,
        paidBalance: affPaidCents,
        meetsThreshold,
        status: !meetsThreshold && affPayableCents > 0
          ? 'BELOW_THRESHOLD'
          : affPayableCents > 0
            ? 'PAYABLE_NOW'
            : affOnHoldCents > 0
              ? 'HOLD_PERIOD'
              : 'ZERO_BALANCE',
      });
    }

    return {
      currency,
      minPayoutThreshold,
      summary: {
        payableNow: payableNowTotal,
        onHold: onHoldTotal,
        pendingApproval: pendingApprovalTotal,
        belowThreshold: belowThresholdTotal,
        riskHeld: riskHeldTotal,
        alreadyPaid: alreadyPaidTotal,
        eligibleAffiliatesCount: affiliateReadiness.filter((a) => a.meetsThreshold && a.payableBalance > 0).length,
      },
      affiliates: affiliateReadiness.sort((a, b) => b.payableBalance - a.payableBalance),
    };
  }

  async getDisputes(organizationId: string) {
    this.ensureDefaultCommissions(organizationId);
    const disputed = dbStore.commissions.filter(
      (c) => c.organizationId === organizationId && c.disputeStatus && c.disputeStatus !== 'NONE',
    );
    return disputed.map((c) => this.hydrateCommission(c));
  }

  async resolveDispute(organizationId: string, commissionId: string, dto: ResolveDisputeDto, actorId: string) {
    const commission = dbStore.commissions.find((c) => c.id === commissionId && c.organizationId === organizationId);
    if (!commission) throw new NotFoundException('Commission record not found');

    const before = { ...commission };
    if (dto.resolution === 'UPHOLD' || dto.resolution === 'PARTIAL') {
      commission.disputeStatus = 'RESOLVED';
      commission.payoutStatus = 'PAYABLE';
      if (dto.deltaAmountCents) {
        await this.adjustCommission(organizationId, commissionId, {
          deltaAmountCents: dto.deltaAmountCents,
          reason: `Dispute Resolution: ${dto.resolution}`,
          notes: dto.notes,
        }, actorId);
      }
    } else {
      commission.disputeStatus = 'REJECTED';
      commission.payoutStatus = 'UNPAID';
    }

    commission.disputeNotes = dto.notes;
    this.audit(organizationId, actorId, 'COMMISSION_DISPUTE_RESOLVED', commission.id, {
      before,
      resolution: dto.resolution,
      notes: dto.notes,
    });

    return this.hydrateCommission(commission);
  }

  async getCommissionAuditLogs(organizationId: string, commissionId?: string) {
    return dbStore.auditLogs
      .filter((log) => {
        const matchesOrg = log.organizationId === organizationId;
        const matchesResource =
          log.resourceType === 'commission' ||
          log.resourceType === 'commission_rule' ||
          log.resourceType === 'commission_adjustment';
        const matchesId = !commissionId || log.resourceId === commissionId;
        return matchesOrg && matchesResource && matchesId;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);
  }

  async exportCommissions(organizationId: string, query: ListCommissionsQueryDto) {
    const paginated = await this.getCommissionsPaginated(organizationId, { ...query, limit: 1000, page: 1 });
    const rows = paginated.items;

    const headers = [
      'Commission ID',
      'Affiliate Name',
      'Affiliate Email',
      'Program Name',
      'Order ID',
      'Customer Email',
      'Order Amount',
      'Rate',
      'Commission Amount',
      'Reversed Amount',
      'Net Commission',
      'Currency',
      'Status',
      'Approval Status',
      'Payout Status',
      'Created At',
    ];

    const csvLines = [headers.join(',')];
    for (const r of rows) {
      const line = [
        `"${r.id}"`,
        `"${r.affiliate?.displayName || ''}"`,
        `"${r.affiliate?.email || ''}"`,
        `"${r.program?.name || ''}"`,
        `"${r.conversion?.externalId || ''}"`,
        `"${r.conversion?.customerExternalId || ''}"`,
        (r.baseAmount / 100).toFixed(2),
        r.rate ? `${(r.rate / 100).toFixed(2)}%` : '',
        (r.commissionAmount / 100).toFixed(2),
        (r.reversedAmount / 100).toFixed(2),
        (r.netAmount / 100).toFixed(2),
        `"${r.currency}"`,
        `"${r.status}"`,
        `"${r.approvalStatus || ''}"`,
        `"${r.payoutStatus || ''}"`,
        `"${new Date(r.createdAt).toISOString()}"`,
      ];
      csvLines.push(line.join(','));
    }

    return csvLines.join('\n');
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
