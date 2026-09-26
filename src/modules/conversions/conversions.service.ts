import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { dbStore, ConversionEntity, IdempotencyKeyEntity, ClickEntity, AttributionEntity, awaitPersist } from '../../database/store';
import { FraudService } from '../fraud/fraud.service';
import { CommissionsService } from '../commissions/commissions.service';
import { LedgerService } from '../ledger/ledger.service';
import { PerformanceAggregationService } from '../gamification/performance/performance-aggregation.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  AutomationTriggerType,
  ConversionStatus,
  FraudDecision,
  AuditAction,
  EnvironmentType,
  LedgerEntryType,
  WebhookEvent,
  AffiliateStatus,
  AttributionModel,
} from '../../common/enums';
import {
  CreateConversionDto,
  RefundConversionDto,
  ListConversionsQueryDto,
  ConversionAnalyticsQueryDto,
  ApproveConversionDto,
  RejectConversionDto,
  BulkApproveConversionsDto,
  CreateManualConversionDto,
} from './dto/conversion.dto';
import { EnvironmentUtils } from '../../common/utils/environment.utils';
import { AutomationEngineService } from '../automations/engine/automation-engine.service';
import { SystemTemplateKey } from '../email-design/constants/email-template-keys';
import { AuditService } from '../audit/audit.service';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { netCommissionAmount } from '../../common/utils/commission.utils';

export interface HydratedConversion extends ConversionEntity {
  affiliateName: string;
  affiliateEmail: string;
  affiliateCompany?: string;
  programName: string;
  programSlug: string;
  commissionAmount: number;
  commissionStatus: string;
  attributionModel: string;
  maskedCustomer: string;
  clickData?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    country?: string;
    deviceType?: string;
    browser?: string;
  };
}

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


  private hydrateConversion(c: ConversionEntity): HydratedConversion {
    const affiliate = c.affiliateId ? dbStore.affiliates.find((a) => a.id === c.affiliateId) : undefined;
    const program = dbStore.programs.find((p) => p.id === c.programId);
    const commission = dbStore.commissions.find((com) => com.conversionId === c.id);
    const click = c.clickId ? dbStore.clicks.find((ck) => ck.id === c.clickId) : undefined;

    // Mask customer identifier (PII security)
    let maskedCustomer = c.customerExternalId;
    if (maskedCustomer.includes('@')) {
      const parts = maskedCustomer.split('@');
      maskedCustomer = `${parts[0].slice(0, 2)}â€¢â€¢â€¢â€¢@${parts[1]}`;
    } else if (maskedCustomer.length > 5) {
      maskedCustomer = `${maskedCustomer.slice(0, 3)}â€¢â€¢â€¢â€¢${maskedCustomer.slice(-2)}`;
    }

    const clickData = click
      ? {
        utmSource: click.utmSource,
        utmMedium: click.utmMedium,
        utmCampaign: click.utmCampaign,
        country: click.country,
        deviceType: click.deviceType,
        browser: click.browser,
      }
      : undefined;

    return {
      ...c,
      affiliateName: affiliate?.displayName || affiliate?.companyName || 'Direct / Organic',
      affiliateEmail: affiliate?.email || 'partner@affiliate.io',
      affiliateCompany: affiliate?.companyName,
      programName: program?.name || 'Standard Program',
      programSlug: program?.slug || 'standard',
      commissionAmount: commission?.commissionAmount ?? 0,
      commissionStatus: commission?.status || 'NO_COMMISSION',
      attributionModel: program?.attributionModel || 'LAST_CLICK',
      maskedCustomer,
      clickData,
    };
  }

  async getConversionAnalytics(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query?: ConversionAnalyticsQueryDto,
  ) {

    const org = dbStore.organizations.find((o) => o.id === organizationId);
    const currency = org?.defaultCurrency || PLATFORM_CURRENCY;

    let conversions = dbStore.conversions.filter(
      (c) =>
        c.organizationId === organizationId &&
        (c.environment === environment || (!c.environment && environment === EnvironmentType.LIVE)),
    );

    if (query?.programId && query.programId !== 'ALL') {
      conversions = conversions.filter((c) => c.programId === query.programId);
    }
    if (query?.affiliateId && query.affiliateId !== 'ALL') {
      conversions = conversions.filter((c) => c.affiliateId === query.affiliateId);
    }

    let totalConversions = 0;
    let approvedConversions = 0;
    let pendingValidation = 0;
    let rejectedConversions = 0;
    let refundedConversions = 0;

    let grossRevenue = 0;
    let refundedRevenue = 0;
    let totalCommission = 0;
    let attributedCount = 0;

    const statusMap: Record<string, { count: number; revenue: number }> = {};
    const programMap: Record<string, { conversions: number; revenue: number; commission: number; name: string }> = {};
    const affiliateMap: Record<string, { conversions: number; revenue: number; commission: number; name: string }> = {};
    const modelMap: Record<string, number> = {};
    const sourceMap: Record<string, number> = {};

    for (const conv of conversions) {
      totalConversions++;
      grossRevenue += conv.amount || 0;
      refundedRevenue += conv.refundedAmount || 0;

      if (conv.affiliateId) attributedCount++;

      const st = conv.status || ConversionStatus.PENDING;
      if (!statusMap[st]) statusMap[st] = { count: 0, revenue: 0 };
      statusMap[st].count++;
      statusMap[st].revenue += conv.amount;

      if (st === ConversionStatus.APPROVED) approvedConversions++;
      else if (st === ConversionStatus.PENDING) pendingValidation++;
      else if (st === ConversionStatus.REJECTED) rejectedConversions++;
      else if (st === ConversionStatus.REFUNDED || st === ConversionStatus.PARTIALLY_REFUNDED) refundedConversions++;

      // Program breakdown
      const prog = dbStore.programs.find((p) => p.id === conv.programId);
      const progName = prog?.name || 'Default Program';
      if (!programMap[conv.programId]) {
        programMap[conv.programId] = { conversions: 0, revenue: 0, commission: 0, name: progName };
      }
      programMap[conv.programId].conversions++;
      programMap[conv.programId].revenue += conv.amount;

      // Affiliate breakdown
      if (conv.affiliateId) {
        const aff = dbStore.affiliates.find((a) => a.id === conv.affiliateId);
        const affName = aff?.displayName || aff?.companyName || 'Affiliate Partner';
        if (!affiliateMap[conv.affiliateId]) {
          affiliateMap[conv.affiliateId] = { conversions: 0, revenue: 0, commission: 0, name: affName };
        }
        affiliateMap[conv.affiliateId].conversions++;
        affiliateMap[conv.affiliateId].revenue += conv.amount;
      }

      // Attribution model
      const model = prog?.attributionModel || 'LAST_CLICK';
      modelMap[model] = (modelMap[model] || 0) + 1;

      // Source
      const src = conv.source || 'API';
      sourceMap[src] = (sourceMap[src] || 0) + 1;

      // Commission lookup
      const comm = dbStore.commissions.find((c) => c.conversionId === conv.id);
      if (comm) {
        totalCommission += netCommissionAmount(comm);
        if (programMap[conv.programId]) programMap[conv.programId].commission += netCommissionAmount(comm);
        if (conv.affiliateId && affiliateMap[conv.affiliateId]) affiliateMap[conv.affiliateId].commission += netCommissionAmount(comm);
      }
    }

    const netRevenue = grossRevenue - refundedRevenue;
    const averageOrderValue = totalConversions > 0 ? Math.round(grossRevenue / totalConversions) : 0;
    const attributionCoverage = totalConversions > 0 ? Number(((attributedCount / totalConversions) * 100).toFixed(1)) : 100;
    const refundRate = totalConversions > 0 ? Number(((refundedConversions / totalConversions) * 100).toFixed(1)) : 0;

    // Time-series trajectory over the last 14 days
    const trajectoryMap: Record<string, { conversions: number; revenue: number; commission: number }> = {};
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      trajectoryMap[key] = { conversions: 0, revenue: 0, commission: 0 };
    }

    for (const conv of conversions) {
      const convDate = new Date(conv.occurredAt || conv.createdAt);
      const key = convDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (trajectoryMap[key]) {
        trajectoryMap[key].conversions++;
        trajectoryMap[key].revenue += conv.amount || 0;
        const comm = dbStore.commissions.find((c) => c.conversionId === conv.id);
        if (comm) trajectoryMap[key].commission += netCommissionAmount(comm);
      }
    }

    const trajectory = Object.entries(trajectoryMap).map(([date, val]) => ({
      date,
      conversions: val.conversions,
      revenue: val.revenue,
      commission: val.commission,
    }));

    const statusDistribution = Object.entries(statusMap).map(([status, val]) => ({
      status,
      count: val.count,
      revenue: val.revenue,
      percentage: grossRevenue > 0 ? Number(((val.revenue / grossRevenue) * 100).toFixed(1)) : 0,
    }));

    const programBreakdown = Object.entries(programMap).map(([programId, val]) => ({
      programId,
      programName: val.name,
      conversions: val.conversions,
      revenue: val.revenue,
      commission: val.commission,
    }));

    const affiliateBreakdown = Object.entries(affiliateMap)
      .map(([affiliateId, val]) => ({
        affiliateId,
        affiliateName: val.name,
        conversions: val.conversions,
        revenue: val.revenue,
        commission: val.commission,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const attributionModelDistribution = Object.entries(modelMap).map(([model, count]) => ({
      model,
      count,
      percentage: totalConversions > 0 ? Number(((count / totalConversions) * 100).toFixed(1)) : 0,
    }));

    const sourceDistribution = Object.entries(sourceMap).map(([source, count]) => ({
      source,
      count,
      percentage: totalConversions > 0 ? Number(((count / totalConversions) * 100).toFixed(1)) : 0,
    }));

    // Operational alerts
    const needsAttention: string[] = [];
    if (pendingValidation > 0) {
      needsAttention.push(`${pendingValidation} ${pendingValidation === 1 ? 'conversion requires' : 'conversions require'} manual validation review before commissions can be cleared.`);
    }
    if (rejectedConversions > 0) {
      needsAttention.push(`${rejectedConversions} conversions blocked by risk & fraud checks.`);
    }
    const unattributed = totalConversions - attributedCount;
    if (unattributed > 0) {
      needsAttention.push(`${unattributed} conversions recorded as direct / organic without affiliate attribution.`);
    }

    return {
      totalConversions,
      approvedConversions,
      pendingValidation,
      rejectedConversions,
      refundedConversions,
      grossRevenue,
      netRevenue,
      refundedRevenue,
      totalCommission,
      averageOrderValue,
      attributionCoverage,
      refundRate,
      trajectory,
      statusDistribution,
      programBreakdown,
      affiliateBreakdown,
      attributionModelDistribution,
      sourceDistribution,
      needsAttention,
      currency,
    };
  }

  async getConversionsPaginated(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query: ListConversionsQueryDto,
  ) {

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const search = (query.search || '').trim().toLowerCase();

    let conversions = dbStore.conversions.filter(
      (c) =>
        c.organizationId === organizationId &&
        (c.environment === environment || (!c.environment && environment === EnvironmentType.LIVE)),
    );

    if (query.status && query.status !== 'ALL') {
      conversions = conversions.filter((c) => c.status.toUpperCase() === query.status?.toUpperCase());
    }

    if (query.validationStatus && query.validationStatus !== 'ALL') {
      conversions = conversions.filter((c) => (c.validationStatus || 'VALID').toUpperCase() === query.validationStatus?.toUpperCase());
    }

    if (query.programId && query.programId !== 'ALL') {
      conversions = conversions.filter((c) => c.programId === query.programId);
    }

    if (query.affiliateId && query.affiliateId !== 'ALL') {
      conversions = conversions.filter((c) => c.affiliateId === query.affiliateId);
    }

    if (query.source && query.source !== 'ALL') {
      conversions = conversions.filter((c) => (c.source || '').toLowerCase() === query.source!.toLowerCase());
    }

    if (query.startDate) {
      const start = new Date(query.startDate);
      conversions = conversions.filter((c) => new Date(c.occurredAt || c.createdAt) >= start);
    }

    if (query.endDate) {
      const end = new Date(query.endDate);
      conversions = conversions.filter((c) => new Date(c.occurredAt || c.createdAt) <= end);
    }

    let hydrated = conversions.map((c) => this.hydrateConversion(c));

    if (search) {
      hydrated = hydrated.filter(
        (c) =>
          c.id.toLowerCase().includes(search) ||
          c.externalId.toLowerCase().includes(search) ||
          c.customerExternalId.toLowerCase().includes(search) ||
          c.affiliateName.toLowerCase().includes(search) ||
          c.programName.toLowerCase().includes(search),
      );
    }

    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';

    hydrated.sort((a: any, b: any) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (valA instanceof Date) valA = valA.getTime();
      if (valB instanceof Date) valB = valB.getTime();
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    const total = hydrated.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginated = hydrated.slice((page - 1) * limit, page * limit);

    return {
      data: paginated,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async getConversionDetail(
    organizationId: string,
    conversionId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {

    const conversion = dbStore.conversions.find(
      (c) =>
        (c.id === conversionId || c.externalId === conversionId) &&
        c.organizationId === organizationId &&
        (c.environment === environment || (!c.environment && environment === EnvironmentType.LIVE)),
    );

    if (!conversion) {
      throw new NotFoundException('Conversion not found');
    }

    const hydrated = this.hydrateConversion(conversion);
    const click = conversion.clickId ? dbStore.clicks.find((c) => c.id === conversion.clickId) : null;
    const attribution = conversion.resolvedAttributionId ? dbStore.attributions.find((a) => a.id === conversion.resolvedAttributionId) : null;
    const commission = dbStore.commissions.find((c) => c.conversionId === conversion.id);
    const program = dbStore.programs.find((p) => p.id === conversion.programId);

    // Audit logs for this conversion
    const auditLogs = dbStore.auditLogs.filter(
      (a) => a.organizationId === organizationId && a.resourceId === conversion.id,
    );

    // Validation checks summary
    const validationChecks = [
      { code: 'IDEMPOTENCY', name: 'Idempotency Protection', passed: true, details: `Unique external ID verified: ${conversion.externalId}` },
      { code: 'ACTIVE_AFFILIATE', name: 'Partner Authorization', passed: Boolean(conversion.affiliateId), details: conversion.affiliateId ? 'Affiliate active in program' : 'Direct / Organic' },
      { code: 'CURRENCY_ALIGNMENT', name: 'Currency Consistency', passed: true, details: `Aligned with program currency (${conversion.currency})` },
      { code: 'FRAUD_CLEARANCE', name: 'Risk & Fraud Clearance', passed: conversion.status !== ConversionStatus.REJECTED, details: conversion.rejectionReason || 'Trust score within acceptable bounds' },
    ];

    return {
      conversion: hydrated,
      financials: {
        grossAmount: conversion.amount,
        refundedAmount: conversion.refundedAmount || 0,
        netAmount: conversion.amount - (conversion.refundedAmount || 0),
        currency: conversion.currency,
        commissionAmount: commission?.commissionAmount ?? 0,
        commissionReversed: commission?.reversedAmount ?? 0,
        commissionStatus: commission?.status || 'NO_COMMISSION',
      },
      commissionDetails: commission
        ? {
          id: commission.id,
          rate: (commission.ruleSnapshot as any)?.commissionValue ? ((commission.ruleSnapshot as any).commissionValue / 100) : 10,
          ruleName: (commission.ruleSnapshot as any)?.ruleName || 'Standard Program Rate',
          status: commission.status,
          holdPeriodDays: (commission.ruleSnapshot as any)?.holdPeriodDays ?? 30,
        }
        : null,
      attributionJourney: {
        model: program?.attributionModel || 'LAST_CLICK',
        clickId: conversion.clickId,
        landingUrl: click?.landingUrl,
        referrer: click?.referrer,
        utmSource: click?.utmSource,
        utmMedium: click?.utmMedium,
        utmCampaign: click?.utmCampaign,
        country: click?.country,
        deviceType: click?.deviceType,
        browser: click?.browser,
        clickTimestamp: click?.createdAt,
        conversionTimestamp: conversion.occurredAt || conversion.createdAt,
      },
      validation: {
        status: conversion.validationStatus || (conversion.status === ConversionStatus.PENDING ? 'PENDING' : 'VALID'),
        validatedAt: conversion.validatedAt,
        validatedBy: conversion.validatedBy,
        notes: conversion.validationNotes,
        rejectionReason: conversion.rejectionReason,
        checks: validationChecks,
      },
      refundHistory: conversion.refundHistory || [],
      auditLogs,
    };
  }

  async approveConversion(
    organizationId: string,
    conversionId: string,
    actorId: string,
    dto?: ApproveConversionDto,
  ) {
    const conversion = dbStore.conversions.find(
      (c) =>
        (c.id === conversionId || c.externalId === conversionId) &&
        c.organizationId === organizationId,
    );

    if (!conversion) {
      throw new NotFoundException('Conversion not found');
    }

    if (conversion.status === ConversionStatus.APPROVED) {
      throw new BadRequestException('Conversion is already approved');
    }

    conversion.status = ConversionStatus.APPROVED;
    conversion.validationStatus = 'VALID';
    conversion.validatedAt = new Date();
    conversion.validatedBy = actorId;
    conversion.validationNotes = dto?.notes;
    conversion.updatedAt = new Date();

    let commission = dbStore.commissions.find((c) => c.conversionId === conversion.id);
    if (!commission && conversion.affiliateId) {
      commission = await this.commissionsService.calculateAndRecordCommission(
        organizationId,
        conversion,
        conversion.affiliateId,
        10, // low risk score upon merchant approval
      );
    }

    this.audit({
      organizationId,
      actorType: 'user',
      actorId,
      action: AuditAction.CONVERSION_APPROVED,
      resourceType: 'conversion',
      resourceId: conversion.id,
      metadata: { notes: dto?.notes, approvedAt: new Date() },
    });

    this.emitWebhook(organizationId, WebhookEvent.CONVERSION_APPROVED, {
      conversionId: conversion.id,
      affiliateId: conversion.affiliateId,
      amount: conversion.amount,
      currency: conversion.currency,
    });

    await awaitPersist(conversion);
    return {
      success: true,
      conversion: this.hydrateConversion(conversion),
      commission,
    };
  }

  async rejectConversion(
    organizationId: string,
    conversionId: string,
    actorId: string,
    dto: RejectConversionDto,
  ) {
    const conversion = dbStore.conversions.find(
      (c) =>
        (c.id === conversionId || c.externalId === conversionId) &&
        c.organizationId === organizationId,
    );

    if (!conversion) {
      throw new NotFoundException('Conversion not found');
    }

    conversion.status = ConversionStatus.REJECTED;
    conversion.validationStatus = 'REJECTED';
    conversion.rejectionReason = dto.reason;
    conversion.validationNotes = dto.notes;
    conversion.validatedAt = new Date();
    conversion.validatedBy = actorId;
    conversion.updatedAt = new Date();

    // If a commission was already generated, claw it back
    const commission = dbStore.commissions.find((c) => c.conversionId === conversion.id);
    const pendingPersist: Promise<unknown>[] = [awaitPersist(conversion)];
    if (commission && conversion.affiliateId) {
      commission.status = ConversionStatus.REJECTED;
      pendingPersist.push(awaitPersist(commission));
      await this.ledgerService.recordTransaction(
        organizationId,
        conversion.affiliateId,
        LedgerEntryType.COMMISSION_REVERSED,
        `Conversion rejected: ${dto.reason}`,
        commission.id,
        commission.commissionAmount,
      );
    }

    this.audit({
      organizationId,
      actorType: 'user',
      actorId,
      action: AuditAction.CONVERSION_REJECTED,
      resourceType: 'conversion',
      resourceId: conversion.id,
      metadata: { reason: dto.reason, notes: dto.notes, rejectedAt: new Date() },
    });

    this.emitWebhook(organizationId, WebhookEvent.CONVERSION_REJECTED, {
      conversionId: conversion.id,
      affiliateId: conversion.affiliateId,
      reason: dto.reason,
    });

    await Promise.all(pendingPersist);
    return {
      success: true,
      conversion: this.hydrateConversion(conversion),
    };
  }

  async bulkApproveConversions(
    organizationId: string,
    actorId: string,
    dto: BulkApproveConversionsDto,
  ) {
    let approvedCount = 0;
    const results: any[] = [];

    for (const convId of dto.conversionIds) {
      try {
        const res = await this.approveConversion(organizationId, convId, actorId, { notes: dto.notes });
        results.push(res);
        approvedCount++;
      } catch (err: any) {
        this.logger.warn(`Bulk approve skipped ${convId}: ${err?.message}`);
      }
    }

    return {
      total: dto.conversionIds.length,
      approvedCount,
      results,
    };
  }

  async createManualConversion(
    organizationId: string,
    actorId: string,
    dto: CreateManualConversionDto,
    environment: EnvironmentType = EnvironmentType.LIVE,
  ) {
    const existing = dbStore.conversions.find(
      (c) => c.organizationId === organizationId && c.externalId === dto.externalId,
    );
    if (existing) {
      throw new ConflictException(`Conversion with externalId '${dto.externalId}' already exists.`);
    }

    const conversion: ConversionEntity = {
      id: uuidv4(),
      organizationId,
      environment,
      programId: dto.programId,
      affiliateId: dto.affiliateId,
      externalId: dto.externalId,
      customerExternalId: dto.customerExternalId,
      amount: dto.amount,
      refundedAmount: 0,
      currency: dto.currency || PLATFORM_CURRENCY,
      type: 'PURCHASE',
      status: ConversionStatus.APPROVED,
      source: dto.source || 'MANUAL',
      validationStatus: 'VALID',
      validatedAt: new Date(),
      validatedBy: actorId,
      validationNotes: dto.notes,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.conversions.push(conversion);
    await awaitPersist(conversion);

    let commission: any = null;
    if (dto.affiliateId) {
      commission = await this.commissionsService.calculateAndRecordCommission(
        organizationId,
        conversion,
        dto.affiliateId,
        5,
      );
    }

    this.audit({
      organizationId,
      actorType: 'user',
      actorId,
      action: AuditAction.CONVERSION_CREATED,
      resourceType: 'conversion',
      resourceId: conversion.id,
      metadata: { source: 'MANUAL', amount: dto.amount, externalId: dto.externalId },
    });

    return {
      success: true,
      conversion: this.hydrateConversion(conversion),
      commission,
    };
  }

  async generateCsvExport(
    organizationId: string,
    environment: EnvironmentType = EnvironmentType.LIVE,
    query?: ListConversionsQueryDto,
  ): Promise<string> {

    const res = await this.getConversionsPaginated(organizationId, environment, { ...query, limit: 1000 });
    const items = res.data;

    const sanitizeField = (value: string | undefined | null): string => {
      if (!value) return '';
      let str = String(value);
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str.replace(/"/g, '""')}"`;
    };

    let csv = 'conversion_id,external_order_id,program,affiliate,masked_customer,amount,refunded_amount,currency,commission,status,validation,source,occurred_at\n';

    for (const item of items) {
      const amount = (item.amount / 100).toFixed(2);
      const refunded = ((item.refundedAmount || 0) / 100).toFixed(2);
      const commission = (item.commissionAmount / 100).toFixed(2);
      csv += `${item.id},${sanitizeField(item.externalId)},${sanitizeField(item.programName)},${sanitizeField(item.affiliateName)},${sanitizeField(item.maskedCustomer)},${amount},${refunded},${item.currency},${commission},${item.status},${item.validationStatus || 'VALID'},${item.source || 'API'},${sanitizeField(new Date(item.occurredAt || item.createdAt).toISOString())}\n`;
    }

    return csv;
  }

  // --- Existing Public API Methods ---

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
          return existingKey.responseBody;
        } else {
          throw new ConflictException(
            'Idempotency key reuse detected with different request payload (409 Conflict)',
          );
        }
      }
    }

    // Check duplicate externalId
    const existingConversion = dbStore.conversions.find(
      (c) =>
        c.organizationId === organizationId &&
        c.externalId === dto.externalId &&
        (c.environment === environment || (!c.environment && environment === EnvironmentType.LIVE)),
    );

    if (existingConversion) {
      throw new ConflictException(`Conversion with externalId '${dto.externalId}' already exists in ${environment} environment.`);
    }

    const program = dbStore.programs.find(
      (p) =>
        p.organizationId === organizationId &&
        (p.environment === environment || (!p.environment && environment === EnvironmentType.LIVE)) &&
        !p.deletedAt,
    );

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

    const resolvedProgram = dbStore.programs.find((p) => p.id === programId);
    if (resolvedProgram?.currency && dto.currency && resolvedProgram.currency.toUpperCase() !== dto.currency.toUpperCase()) {
      throw new BadRequestException(
        `Conversion currency (${dto.currency}) does not match program currency (${resolvedProgram.currency}). Currency conversion is not supported.`,
      );
    }

    let resolvedAffiliateId = attribution?.affiliateId;
    if (!resolvedAffiliateId && dto.clickId) {
      const click = dbStore.clicks.find((c) => c.id === dto.clickId && c.organizationId === organizationId);
      if (click?.affiliateId) resolvedAffiliateId = click.affiliateId;
    }
    if (!resolvedAffiliateId) {
      resolvedAffiliateId = (dto as any).affiliateId || dto.metadata?.affiliateId || (dto as any).affiliate;
    }
    if (!resolvedAffiliateId) {
      const activeOrgAffiliates = dbStore.affiliates.filter(
        (a) => a.organizationId === organizationId && a.status === AffiliateStatus.ACTIVE,
      );
      if (activeOrgAffiliates.length === 1) {
        resolvedAffiliateId = activeOrgAffiliates[0].id;
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
      source: dto.source || 'SDK',
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.conversions.push(conversion);

    this.emitWebhook(organizationId, WebhookEvent.CONVERSION_CREATED, {
      conversionId: conversion.id,
      externalId: conversion.externalId,
      customerExternalId: conversion.customerExternalId,
      amount: conversion.amount,
      currency: conversion.currency,
    });

    const fraudResult = await this.fraudService.evaluateConversion(conversion);

    if (fraudResult.decision === FraudDecision.BLOCK) {
      conversion.status = ConversionStatus.REJECTED;
      conversion.validationStatus = 'REJECTED';
      conversion.rejectionReason = 'FRAUD_BLOCK';
      this.emitWebhook(organizationId, WebhookEvent.CONVERSION_REJECTED, {
        conversionId: conversion.id,
        affiliateId: resolvedAffiliateId,
        reason: 'FRAUD_BLOCK',
      });
    } else if (fraudResult.decision === FraudDecision.REVIEW) {
      conversion.status = ConversionStatus.PENDING;
      conversion.validationStatus = 'PENDING';
    } else {
      conversion.status = ConversionStatus.APPROVED;
      conversion.validationStatus = 'VALID';
    }

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

      try {
        await this.performanceAggregationService?.recordApprovedConversion(
          organizationId,
          conversion.programId,
          resolvedAffiliateId,
          conversion,
          commission?.commissionAmount || 0,
        );
      } catch (error: any) {
        this.logger.error(`Performance aggregation failed: ${error?.message || error}`);
      }
    }

    const responsePayload = {
      conversion,
      fraudResult,
      commission,
    };

    const pendingPersist: Promise<unknown>[] = [awaitPersist(conversion)];
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
      pendingPersist.push(awaitPersist(ikRecord));
    }

    await Promise.all(pendingPersist);
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
        throw new ConflictException('Idempotency key reuse detected with different request payload (409 Conflict)');
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

    if (dto.refundExternalId && (conversion.refundHistory || []).some((r) => r.refundExternalId === dto.refundExternalId)) {
      throw new ConflictException(`Refund with refundExternalId '${dto.refundExternalId}' was already processed.`);
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

    const commission = dbStore.commissions.find((c) => c.conversionId === conversion.id);
    const pendingPersist: Promise<unknown>[] = [awaitPersist(conversion)];
    let commissionReversedAmount = 0;
    if (commission && conversion.affiliateId) {
      const proportionalReversal = Math.round((commission.commissionAmount * refundAmount) / conversion.amount);
      commissionReversedAmount = Math.min(proportionalReversal, commission.commissionAmount - (commission.reversedAmount || 0));

      if (commissionReversedAmount > 0) {
        commission.reversedAmount = (commission.reversedAmount || 0) + commissionReversedAmount;
        commission.status = commission.reversedAmount >= commission.commissionAmount
          ? ConversionStatus.REFUNDED
          : ConversionStatus.PARTIALLY_REFUNDED;
        pendingPersist.push(awaitPersist(commission));

        await this.ledgerService.recordTransaction(
          organizationId,
          conversion.affiliateId,
          LedgerEntryType.COMMISSION_REVERSED,
          `Refund clawback for conversion ${conversion.externalId}: ${dto.reason || 'Customer refund'}`,
          commission.id,
          commissionReversedAmount,
        );
      }
    }

    this.audit({
      organizationId,
      actorType: 'system',
      actorId: context?.apiKeyId || 'system',
      action: AuditAction.CONVERSION_REVERSED,
      resourceType: 'conversion',
      resourceId: conversion.id,
      metadata: { reason: dto.reason, refundAmount, fullyRefunded: isFullyRefunded },
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
      pendingPersist.push(awaitPersist(ikRecord));
    }

    await Promise.all(pendingPersist);
    return responsePayload;
  }

  async findAll(organizationId: string, environment: EnvironmentType | 'test' | 'live' = EnvironmentType.LIVE, programId?: string) {
    const currentEnvironment = EnvironmentUtils.normalizeEnvironment(environment);
    const conversions = dbStore.conversions.filter((c) =>
      c.organizationId === organizationId &&
      (c.environment === currentEnvironment || (!c.environment && currentEnvironment === EnvironmentType.LIVE)) &&
      (!programId || c.programId === programId),
    );
    return conversions.map((c) => this.hydrateConversion(c));
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
    return this.hydrateConversion(conversion);
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

    if (clickId) {
      const byClick = dbStore.attributions.find((a) => a.clickId === clickId && isLive(a));
      if (byClick) return byClick;
    }

    if (explicitAttributionId) {
      const byId = dbStore.attributions.find((a) => a.id === explicitAttributionId && isLive(a));
      if (byId) return byId;
    }

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

    if (model === 'POSITION_BASED' || model === 'TIME_DECAY' || model === 'MULTI_TOUCH' || model === 'CUSTOM') {
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
