import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, PartnerDealEntity, awaitPersist } from '../../database/store';
import {
  AttributionModel,
  ConversionStatus,
  FraudStatus,
  OrganizationIntegrationStatus,
  PartnerDealCommissionStatus,
  PartnerDealStatus,
  TrackingLinkStatus,
} from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { ConversionsService } from '../conversions/conversions.service';
import { HubSpotApiClient } from '../integrations/hubspot/hubspot-api.client';
import { HubSpotService } from '../integrations/hubspot/hubspot.service';
import { HUBSPOT_PROVIDER } from '../integrations/hubspot/hubspot.constants';
import { CreatePartnerDealDto, RejectPartnerDealDto, UpdateDealStageDto } from './dto/partner-deal.dto';
import { PLATFORM_CURRENCY } from '../../common/constants/currency';
import { NotificationsService } from '../notifications/notifications.service';
import { DealsGateway } from '../realtime/deals.gateway';
import type { DealRealtimeSource } from '../realtime/deals.gateway';
import {
  DEAL_BOARD_COLUMNS,
  type DealBoardColumn,
  COLUMN_LABELS,
  COLUMN_PROBABILITIES,
  COLUMN_COLORS,
  statusToColumn,
  targetStatusForColumn,
} from './deal-stage.constants';
import {
  DealAnalyticsQueryDto,
  BulkDealActionDto,
  DealAnalyticsOverview,
  DealPipelineMetrics,
  DealSyncAnalytics,
  DealDossierResponse,
  DealHealthSignal,
  DealLifecycleStage,
  DealTimeSeriesPoint,
} from './dto/deal-analytics.dto';

@Injectable()
export class PartnerDealsService {
  constructor(
    private readonly hubSpot: HubSpotService,
    private readonly hubSpotApi: HubSpotApiClient,
    private readonly conversions: ConversionsService,
    private readonly dealsGateway: DealsGateway,
    private readonly notificationsService?: NotificationsService,
  ) { }

  async create(organizationId: string, user: AuthUserPayload, dto: CreatePartnerDealDto) {
    const program = dbStore.programs.find((item) => item.id === dto.programId && item.organizationId === organizationId && !item.deletedAt);
    if (!program) throw new NotFoundException('Program not found');
    const affiliate = this.resolveAffiliate(organizationId, user, dto.affiliateId);
    const duplicateSignals = this.detectDuplicates(organizationId, affiliate?.id, dto);
    const deal: PartnerDealEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      affiliateId: affiliate ? affiliate.id : (undefined as any),
      campaignId: dto.campaignId,
      dealRegistrationNumber: this.nextDealNumber(),
      companyName: dto.companyName.trim(),
      companyDomain: this.domainFrom(dto.companyWebsite),
      contactFirstName: dto.contactFirstName,
      contactLastName: dto.contactLastName,
      contactEmail: dto.contactEmail.toLowerCase(),
      contactPhone: dto.contactPhone,
      contactJobTitle: dto.contactJobTitle,
      estimatedValue: Math.round(dto.estimatedValue),
      currency: dto.currency || program.currency || PLATFORM_CURRENCY,
      expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : undefined,
      status: duplicateSignals.potentialDuplicate ? PartnerDealStatus.UNDER_REVIEW : PartnerDealStatus.SUBMITTED,
      commissionStatus: PartnerDealCommissionStatus.NOT_ELIGIBLE,
      attributionStatus: affiliate ? 'PENDING' : 'DIRECT',
      submittedAt: new Date(),
      protectedUntil: undefined,
      duplicateSignals,
      notes: dto.opportunityDescription || dto.referralSource,
      createdBy: user.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    dbStore.partnerDeals.push(deal);
    await awaitPersist(deal);
    this.audit(organizationId, user.userId, 'DEAL_REGISTERED', deal.id, { dealRegistrationNumber: deal.dealRegistrationNumber, duplicateSignals, direct: !affiliate });
    this.notifyOrganizationAdmins(organizationId, 'New deal registration', `${affiliate?.displayName || 'Direct lead'} registered ${deal.companyName}.`);
    this.dealsGateway.emitDealCreated(organizationId, this.publicDeal(deal, true));
    return { deal, duplicateSignals };
  }

  list(organizationId: string, user: AuthUserPayload, options?: { crmOnly?: boolean }) {
    const affiliateId = user.affiliateId;
    return dbStore.partnerDeals
      .filter((deal) => deal.organizationId === organizationId && (!affiliateId || deal.affiliateId === affiliateId) && (!options?.crmOnly || Boolean(deal.crmProvider)))
      .map((deal) => this.publicDeal(deal, !affiliateId));
  }

  get(organizationId: string, user: AuthUserPayload, id: string) {
    const deal = this.requireDeal(organizationId, id);
    if (user.affiliateId && deal.affiliateId !== user.affiliateId) throw new NotFoundException('Deal not found');
    return this.publicDeal(deal, !user.affiliateId);
  }

  async approve(organizationId: string, user: AuthUserPayload, id: string) {
    const deal = this.requireDeal(organizationId, id);
    if ([PartnerDealStatus.SYNCED, PartnerDealStatus.CLOSED_WON].includes(deal.status)) return this.publicDeal(deal, true);
    deal.status = PartnerDealStatus.SYNC_PENDING;
    deal.approvedAt = new Date();
    deal.approvedBy = user.userId;
    deal.protectedUntil = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    await this.ensureB2BAttribution(deal);
    if (this.canAutoSyncOutbound(organizationId, { requireAutoCreate: true })) {
      await this.syncToHubSpot(organizationId, deal);
    }
    await awaitPersist(deal);
    this.audit(organizationId, user.userId, 'DEAL_APPROVED', deal.id, { crmDealId: deal.crmDealId });
    const publicDeal = this.publicDeal(deal, true);
    this.dealsGateway.emitDealUpdated(organizationId, publicDeal);
    return publicDeal;
  }

  reject(organizationId: string, user: AuthUserPayload, id: string, dto: RejectPartnerDealDto) {
    const deal = this.requireDeal(organizationId, id);
    deal.status = PartnerDealStatus.REJECTED;
    deal.rejectedAt = new Date();
    deal.rejectionReason = dto.reason;
    this.audit(organizationId, user.userId, 'DEAL_REJECTED', deal.id, { reason: dto.reason });
    const publicDeal = this.publicDeal(deal, true);
    this.dealsGateway.emitDealUpdated(organizationId, publicDeal);
    return publicDeal;
  }

  async sync(organizationId: string, user: AuthUserPayload, id: string) {
    const deal = this.requireDeal(organizationId, id);
    await this.syncToHubSpot(organizationId, deal);
    this.audit(organizationId, user.userId, 'DEAL_SYNCED', deal.id, { crmDealId: deal.crmDealId });
    const publicDeal = this.publicDeal(deal, true);
    this.dealsGateway.emitDealUpdated(organizationId, publicDeal);
    return publicDeal;
  }

  async updateStage(organizationId: string, user: AuthUserPayload, id: string, dto: UpdateDealStageDto) {
    const deal = this.requireDeal(organizationId, id);
    const targetStatus = targetStatusForColumn(dto.column, deal);

    if (dto.column === 'WON') {
      await this.closeWon(deal, dto.actualValue);
    } else if (dto.column === 'LOST') {
      deal.status = PartnerDealStatus.CLOSED_LOST;
      deal.closedAt = new Date();
    } else {
      deal.status = targetStatus;
    }

    if (deal.crmProvider === HUBSPOT_PROVIDER && this.canAutoSyncOutbound(organizationId)) {
      await this.pushStageToHubSpot(organizationId, deal, targetStatus);
    }

    this.audit(organizationId, user.userId, 'DEAL_STAGE_CHANGED', deal.id, { column: dto.column, status: deal.status });
    const publicDeal = this.publicDeal(deal, true);
    this.dealsGateway.emitDealUpdated(organizationId, publicDeal);
    return publicDeal;
  }

  async syncAllFromHubSpot(organizationId: string, user: AuthUserPayload) {
    const connection = this.hubSpot.requireConnection(organizationId);
    const mappings = dbStore.crmEntityMappings.filter(
      (item) => item.organizationIntegrationId === connection.id && item.entityType === 'DEAL',
    );
    const started = Date.now();
    let scanned = 0;
    let updated = 0;
    let unchanged = 0;
    let errors = 0;

    for (const mapping of mappings) {
      scanned += 1;
      try {
        const response = await this.hubSpotApi.get(connection.id, `/crm/v3/objects/deals/${mapping.externalEntityId}?properties=dealstage,amount`);
        const stageId = response?.properties?.dealstage;
        const amount = response?.properties?.amount ? Number(response.properties.amount) : undefined;
        const deal = dbStore.partnerDeals.find((item) => item.organizationId === organizationId && item.crmDealId === mapping.externalEntityId);
        if (!deal || !stageId || deal.crmStageId === stageId) {
          unchanged += 1;
          continue;
        }
        await this.handleHubSpotDealStage(organizationId, mapping.externalEntityId, stageId, amount, 'HUBSPOT_SYNC');
        updated += 1;
      } catch {
        errors += 1;
      }
    }

    connection.lastSyncAt = new Date();
    connection.config = { ...(connection.config || {}), lastSuccessfulSyncAt: new Date() };
    const summary = { scanned, updated, unchanged, errors };
    this.hubSpot.syncLog(connection, 'deal_import', 'DEAL', 'INBOUND', errors ? 'FAILED' : 'SUCCEEDED', { durationMs: Date.now() - started, ...summary });
    this.audit(organizationId, user.userId, 'DEALS_SYNC_NOW', connection.id, summary);
    return summary;
  }

  syncHistory(organizationId: string, id: string) {
    const deal = this.requireDeal(organizationId, id);
    return dbStore.integrationSyncLogs
      .filter((log) => log.organizationId === organizationId && log.entityId === deal.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async handleHubSpotDealStage(organizationId: string, externalDealId: string, stageId: string, amount?: number, source: DealRealtimeSource = 'HUBSPOT_WEBHOOK') {
    const deal = dbStore.partnerDeals.find((item) => item.organizationId === organizationId && item.crmDealId === externalDealId);
    if (!deal) return { ignored: true, reason: 'No PartnerIQ deal mapping found' };
    const connection = this.hubSpot.requireConnection(organizationId);
    const syncSettings = this.hubSpot.getSyncSettings(organizationId);
    if (syncSettings.syncDirection === 'outbound') {
      return { ignored: true, reason: 'Inbound sync disabled by organization sync settings' };
    }
    const mapping = dbStore.crmPipelineMappings.find((item) => item.organizationIntegrationId === connection.id && item.isActive && (!deal.crmPipelineId || item.externalPipelineId === deal.crmPipelineId));
    const mappedStatus = mapping?.stageMappings?.[stageId] as PartnerDealStatus | undefined;
    deal.crmStageId = stageId;
    deal.status = mappedStatus || deal.status;
    if (mapping?.closedWonStageId === stageId || mappedStatus === PartnerDealStatus.CLOSED_WON) {
      if (!syncSettings.autoConvertOnWon) {
        const publicDeal = this.publicDeal(deal, true);
        this.dealsGateway.emitDealUpdated(organizationId, publicDeal, source);
        return { deal: publicDeal, conversion: null, ignored: true, reason: 'Auto-convert-on-won disabled by organization sync settings' };
      }
      const result = await this.closeWon(deal, amount);
      this.dealsGateway.emitDealUpdated(organizationId, this.publicDeal(deal, true), source);
      return result;
    }
    if (mapping?.closedLostStageId === stageId || mappedStatus === PartnerDealStatus.CLOSED_LOST) {
      deal.status = PartnerDealStatus.CLOSED_LOST;
      deal.closedAt = new Date();
      this.audit(organizationId, 'system', 'DEAL_CLOSED_LOST', deal.id, { externalDealId });
      const publicDeal = this.publicDeal(deal, true);
      this.dealsGateway.emitDealUpdated(organizationId, publicDeal, source);
      return { deal: publicDeal, conversion: null };
    }
    const publicDeal = this.publicDeal(deal, true);
    this.dealsGateway.emitDealUpdated(organizationId, publicDeal, source);
    return { deal: publicDeal, conversion: null };
  }

  private canAutoSyncOutbound(organizationId: string, options?: { requireAutoCreate?: boolean }) {
    try {
      const settings = this.hubSpot.getSyncSettings(organizationId);
      if (settings.syncDirection === 'inbound') return false;
      if (options?.requireAutoCreate && !settings.autoCreateDealInCrm) return false;
      return true;
    } catch {
      return false;
    }
  }

  private async pushStageToHubSpot(organizationId: string, deal: PartnerDealEntity, targetStatus: PartnerDealStatus) {
    if (!deal.crmDealId) return;
    const connection = this.hubSpot.requireConnection(organizationId);
    const mapping = dbStore.crmPipelineMappings.find((item) => item.organizationIntegrationId === connection.id && item.isActive && (!deal.crmPipelineId || item.externalPipelineId === deal.crmPipelineId));
    if (!mapping) return;
    const externalStageId =
      targetStatus === PartnerDealStatus.CLOSED_WON ? mapping.closedWonStageId :
        targetStatus === PartnerDealStatus.CLOSED_LOST ? mapping.closedLostStageId :
          Object.entries(mapping.stageMappings || {}).find(([, status]) => status === targetStatus)?.[0];
    if (!externalStageId) return;

    const started = Date.now();
    try {
      await this.hubSpotApi.patch(connection.id, `/crm/v3/objects/deals/${deal.crmDealId}`, {
        properties: {
          dealstage: externalStageId,
          ...(deal.actualValue ? { amount: String(deal.actualValue) } : {}),
        },
      });
      deal.crmStageId = externalStageId;
      connection.lastSyncAt = new Date();
      this.hubSpot.syncLog(connection, 'deal_stage_update', 'DEAL', 'OUTBOUND', 'SUCCEEDED', { durationMs: Date.now() - started }, deal.id, deal.crmDealId);
    } catch {
      deal.status = PartnerDealStatus.SYNC_ERROR;
      connection.status = OrganizationIntegrationStatus.SYNC_ERROR;
      connection.lastError = 'HubSpot deal stage sync failed';
      this.hubSpot.syncLog(connection, 'deal_stage_update', 'DEAL', 'OUTBOUND', 'FAILED', { durationMs: Date.now() - started, errorCode: 'HUBSPOT_STAGE_SYNC_FAILED', errorMessage: 'HubSpot deal stage sync failed' }, deal.id, deal.crmDealId);
    }
  }

  private async syncToHubSpot(organizationId: string, deal: PartnerDealEntity) {
    const connection = this.hubSpot.requireConnection(organizationId);
    if (![OrganizationIntegrationStatus.CONNECTED, OrganizationIntegrationStatus.DEGRADED].includes(connection.status)) {
      throw new BadRequestException('HubSpot connection is not healthy enough to sync');
    }
    const started = Date.now();
    try {
      const contactId = await this.resolveOrCreateContact(connection.id, deal);
      const companyId = await this.resolveOrCreateCompany(connection.id, deal);
      const crmDealId = deal.crmDealId || await this.createHubSpotDeal(connection.id, deal, contactId, companyId);
      this.upsertEntityMapping(connection, 'CONTACT', deal.id, contactId, 'contact');
      this.upsertEntityMapping(connection, 'COMPANY', deal.id, companyId, 'company');
      this.upsertEntityMapping(connection, 'DEAL', deal.id, crmDealId, 'deal');
      deal.crmProvider = HUBSPOT_PROVIDER;
      deal.crmDealId = crmDealId;
      deal.status = PartnerDealStatus.SYNCED;
      connection.config = { ...(connection.config || {}), lastSuccessfulSyncAt: new Date() };
      connection.lastSyncAt = new Date();
      this.hubSpot.syncLog(connection, 'deal_export', 'DEAL', 'OUTBOUND', 'SUCCEEDED', { durationMs: Date.now() - started }, deal.id, crmDealId);
    } catch (error) {
      deal.status = PartnerDealStatus.SYNC_ERROR;
      connection.status = OrganizationIntegrationStatus.SYNC_ERROR;
      connection.config = { ...(connection.config || {}), lastFailedSyncAt: new Date() };
      connection.lastError = 'HubSpot deal sync failed';
      this.hubSpot.syncLog(connection, 'deal_export', 'DEAL', 'OUTBOUND', 'FAILED', { durationMs: Date.now() - started, errorCode: 'HUBSPOT_DEAL_SYNC_FAILED', errorMessage: 'HubSpot deal sync failed' }, deal.id, deal.crmDealId);
      throw error;
    }
  }

  private async resolveOrCreateContact(connectionId: string, deal: PartnerDealEntity) {
    const existing = await this.searchHubSpot(connectionId, 'contacts', 'email', deal.contactEmail);
    if (existing) return existing;
    const response = await this.hubSpotApi.post(connectionId, '/crm/v3/objects/contacts', {
      properties: {
        email: deal.contactEmail,
        firstname: deal.contactFirstName,
        lastname: deal.contactLastName,
        phone: deal.contactPhone,
        jobtitle: deal.contactJobTitle,
      },
    });
    return response.id;
  }

  private async resolveOrCreateCompany(connectionId: string, deal: PartnerDealEntity) {
    if (deal.companyDomain) {
      const existing = await this.searchHubSpot(connectionId, 'companies', 'domain', deal.companyDomain);
      if (existing) return existing;
    }
    const response = await this.hubSpotApi.post(connectionId, '/crm/v3/objects/companies', {
      properties: { name: deal.companyName, domain: deal.companyDomain },
    });
    return response.id;
  }

  private async createHubSpotDeal(connectionId: string, deal: PartnerDealEntity, contactId: string, companyId: string) {
    const mapping = dbStore.crmPipelineMappings.find((item) => item.organizationIntegrationId === connectionId && item.isActive);
    if (!mapping?.closedWonStageId && !Object.keys(mapping?.stageMappings || {}).length) throw new BadRequestException('HubSpot pipeline and stage mapping must be configured before syncing deals');
    const submittedStage = Object.entries(mapping.stageMappings || {}).find(([, status]) => status === PartnerDealStatus.SUBMITTED)?.[0] || Object.keys(mapping.stageMappings || {})[0];
    if (!submittedStage) throw new BadRequestException('HubSpot submitted stage mapping is required');
    const program = dbStore.programs.find((item) => item.id === deal.programId);
    const response = await this.hubSpotApi.post(connectionId, '/crm/v3/objects/deals', {
      properties: {
        dealname: `${deal.companyName} - ${deal.dealRegistrationNumber}`,
        amount: String(deal.estimatedValue),
        closedate: deal.expectedCloseDate?.toISOString(),
        pipeline: mapping.externalPipelineId,
        dealstage: submittedStage,
        partneriq_deal_registration_id: deal.dealRegistrationNumber,
        partneriq_partner_id: deal.affiliateId || '',
        partneriq_program_id: deal.programId,
        partneriq_program_name: program?.name,
        partneriq_referral_source: 'PartnerIQ deal registration',
      },
      associations: [
        { to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] },
        { to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }] },
      ],
    });
    deal.crmPipelineId = mapping.externalPipelineId;
    deal.crmStageId = submittedStage;
    return response.id;
  }

  private async searchHubSpot(connectionId: string, objectType: string, propertyName: string, value?: string) {
    if (!value) return undefined;
    try {
      const response = await this.hubSpotApi.post(connectionId, `/crm/v3/objects/${objectType}/search`, {
        filterGroups: [{ filters: [{ propertyName, operator: 'EQ', value }] }],
        limit: 1,
      });
      return response.results?.[0]?.id;
    } catch {
      return undefined;
    }
  }

  private async closeWon(deal: PartnerDealEntity, amount?: number) {
    if (deal.status === PartnerDealStatus.CLOSED_WON && deal.commissionStatus === PartnerDealCommissionStatus.TRIGGERED) {
      return { deal: this.publicDeal(deal, true), conversion: null, duplicate: true };
    }
    deal.status = PartnerDealStatus.CLOSED_WON;
    deal.actualValue = Math.round(amount || deal.actualValue || deal.estimatedValue);
    deal.actualCloseDate = new Date();
    deal.closedAt = new Date();
    deal.attributionStatus = deal.affiliateId ? 'ATTRIBUTED' : 'DIRECT';

    if (deal.affiliateId) {
      const conversion = await this.conversions.createConversion(
        deal.organizationId,
        {
          externalId: `hubspot_deal_${deal.crmDealId || deal.id}`,
          customerExternalId: `partner_deal_${deal.id}`,
          amount: deal.actualValue,
          currency: deal.currency,
          type: 'B2B_CLOSED_WON',
          metadata: { source: deal.crmProvider || HUBSPOT_PROVIDER, partnerDealId: deal.id, crmDealId: deal.crmDealId },
        },
        `hubspot_closed_won_${deal.crmDealId || deal.id}`,
        { environment: 'live' },
      );
      deal.commissionStatus = conversion.commission ? PartnerDealCommissionStatus.TRIGGERED : PartnerDealCommissionStatus.PENDING;
      this.audit(deal.organizationId, 'system', 'DEAL_CLOSED_WON', deal.id, { conversionId: conversion.conversion.id });
      this.audit(deal.organizationId, 'system', 'DEAL_COMMISSION_TRIGGERED', deal.id, { commissionId: conversion.commission?.id });
      this.notifyAffiliate(deal, 'Great news - your deal closed', `${deal.companyName} closed won and commission has been generated.`);
      return { deal: this.publicDeal(deal, true), conversion };
    } else {
      deal.commissionStatus = PartnerDealCommissionStatus.NOT_ELIGIBLE;
      this.audit(deal.organizationId, 'system', 'DEAL_CLOSED_WON', deal.id, { direct: true });
      return { deal: this.publicDeal(deal, true), conversion: null };
    }
  }

  private ensureB2BAttribution(deal: PartnerDealEntity) {
    if (!deal.affiliateId) return;
    if (dbStore.attributions.some((item) => item.customerExternalId === `partner_deal_${deal.id}`)) return;
    const trackingLink = dbStore.trackingLinks.find((item) => item.organizationId === deal.organizationId && item.programId === deal.programId && item.affiliateId === deal.affiliateId) || {
      id: uuidv4(),
      organizationId: deal.organizationId,
      programId: deal.programId,
      affiliateId: deal.affiliateId,
      destinationUrl: `partneriq://b2b-deal/${deal.id}`,
      shortCode: `b2b-${deal.id.slice(0, 8)}`,
      status: TrackingLinkStatus.ACTIVE,
      createdAt: new Date(),
    };
    if (!dbStore.trackingLinks.some((item) => item.id === trackingLink.id)) dbStore.trackingLinks.push(trackingLink);
    const clickId = uuidv4();
    dbStore.clicks.push({
      id: clickId,
      organizationId: deal.organizationId,
      programId: deal.programId,
      affiliateId: deal.affiliateId,
      trackingLinkId: trackingLink.id,
      anonymousId: `partner_deal_${deal.id}`,
      ipHash: createHash('sha256').update(`partner_deal_${deal.id}`).digest('hex'),
      fraudScore: 0,
      fraudStatus: FraudStatus.LOW,
      createdAt: new Date(),
    });
    dbStore.attributions.push({
      id: uuidv4(),
      organizationId: deal.organizationId,
      programId: deal.programId,
      affiliateId: deal.affiliateId,
      clickId,
      anonymousId: `partner_deal_${deal.id}`,
      customerExternalId: `partner_deal_${deal.id}`,
      model: AttributionModel.LAST_CLICK,
      breakdown: [{ affiliateId: deal.affiliateId, weight: 1, source: 'B2B_DEAL_REGISTRATION' }],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    });
  }

  private detectDuplicates(organizationId: string, affiliateId: string | undefined, dto: CreatePartnerDealDto) {
    const domain = this.domainFrom(dto.companyWebsite);
    const matches = dbStore.partnerDeals.filter((deal) => deal.organizationId === organizationId && (
      deal.contactEmail.toLowerCase() === dto.contactEmail.toLowerCase() ||
      (domain && deal.companyDomain === domain) ||
      deal.companyName.toLowerCase() === dto.companyName.toLowerCase()
    ));
    const protectedMatch = matches.find((deal) => deal.protectedUntil && deal.protectedUntil > new Date() && deal.affiliateId && deal.affiliateId !== affiliateId);
    return {
      potentialDuplicate: matches.length > 0,
      protectedOpportunity: Boolean(protectedMatch),
      matchCount: matches.length,
      matchTypes: matches.length ? ['email/company'] : [],
    };
  }

  private resolveAffiliate(organizationId: string, user: AuthUserPayload, requestedAffiliateId?: string) {
    const affiliateId = requestedAffiliateId || user.affiliateId;
    if (!affiliateId || affiliateId === 'NONE' || affiliateId === 'DIRECT' || affiliateId.trim() === '') {
      return null;
    }
    const affiliate = dbStore.affiliates.find((item) => item.organizationId === organizationId && item.id === affiliateId);
    if (!affiliate) throw new NotFoundException('Affiliate not found');
    return affiliate;
  }

  private requireDeal(organizationId: string, id: string) {
    const deal = dbStore.partnerDeals.find((item) => item.organizationId === organizationId && (item.id === id || item.dealRegistrationNumber === id));
    if (!deal) throw new NotFoundException('Partner deal not found');
    return deal;
  }

  private upsertEntityMapping(connection: any, entityType: 'CONTACT' | 'COMPANY' | 'DEAL', partnerIqEntityId: string, externalEntityId: string, externalEntityType: string) {
    const existing = dbStore.crmEntityMappings.find((item) => item.organizationIntegrationId === connection.id && item.entityType === entityType && item.partnerIqEntityId === partnerIqEntityId);
    const mapping = {
      ...(existing || { id: uuidv4(), createdAt: new Date() }),
      organizationId: connection.organizationId,
      organizationIntegrationId: connection.id,
      entityType,
      partnerIqEntityId,
      externalEntityId,
      externalEntityType,
      syncVersion: (existing?.syncVersion || 0) + 1,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    };
    if (existing) Object.assign(existing, mapping);
    else dbStore.crmEntityMappings.push(mapping);
  }

  private publicDeal(deal: PartnerDealEntity, includeCrm: boolean) {
    const base = { ...deal };
    if (!includeCrm) {
      delete (base as any).crmDealId;
      delete (base as any).crmPipelineId;
      delete (base as any).crmStageId;
      delete (base as any).duplicateSignals;
      delete (base as any).notes;
    }
    return base;
  }

  private nextDealNumber() {
    return `DR-${String(dbStore.partnerDeals.length + 1042).padStart(4, '0')}`;
  }

  private domainFrom(url?: string) {
    if (!url) return undefined;
    try {
      return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    }
  }

  private notifyOrganizationAdmins(organizationId: string, title: string, body: string) {
    const admins = dbStore.organizationMemberships.filter(
      (item) => item.organizationId === organizationId && ['OWNER', 'ADMIN'].includes(item.role),
    );
    for (const membership of admins) {
      if (this.notificationsService) {
        this.notificationsService.createNotification({
          userId: membership.userId,
          organizationId,
          type: 'program',
          title,
          body,
          channel: 'in_app',
          priority: 'normal',
        }).catch(() => undefined);
      } else {
        dbStore.notifications.unshift({
          id: uuidv4(),
          userId: membership.userId,
          organizationId,
          type: 'program',
          title,
          body,
          channel: 'in_app',
          priority: 'normal',
          isRead: false,
          metadata: {},
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  private notifyAffiliate(deal: PartnerDealEntity, title: string, body: string) {
    const affiliate = dbStore.affiliates.find((item) => item.id === deal.affiliateId);
    if (!affiliate?.userId) return;

    if (this.notificationsService) {
      this.notificationsService.createNotification({
        userId: affiliate.userId,
        organizationId: deal.organizationId,
        type: 'commission',
        title,
        body,
        channel: 'in_app',
        priority: 'high',
        metadata: { partnerDealId: deal.id },
      }).catch(() => undefined);
      return;
    }

    dbStore.notifications.unshift({
      id: uuidv4(),
      userId: affiliate.userId,
      organizationId: deal.organizationId,
      type: 'commission',
      title,
      body,
      channel: 'in_app',
      priority: 'high',
      isRead: false,
      metadata: { partnerDealId: deal.id },
      createdAt: new Date().toISOString(),
    });
  }

  private audit(organizationId: string, actorId: string, action: string, resourceId: string, metadata?: Record<string, unknown>) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: action as any,
      resourceType: 'partner_deal',
      resourceId,
      metadata,
      createdAt: new Date(),
    });
  }

  // --- Intelligence & Analytics Methods ---

  private getPeriodDateRange(period?: string): { start?: Date; end?: Date } {
    if (!period || period === 'LIFETIME') return {};
    const end = new Date();
    const start = new Date();
    switch (period) {
      case '7D':
        start.setDate(end.getDate() - 7);
        break;
      case '30D':
        start.setDate(end.getDate() - 30);
        break;
      case '90D':
        start.setDate(end.getDate() - 90);
        break;
      case '12M':
        start.setFullYear(end.getFullYear() - 1);
        break;
      default:
        start.setDate(end.getDate() - 30);
    }
    return { start, end };
  }

  async getAnalyticsOverview(
    organizationId: string,
    user: AuthUserPayload,
    query?: DealAnalyticsQueryDto,
  ): Promise<DealAnalyticsOverview> {
    const affiliateId = user.affiliateId || query?.affiliateId;
    const { start } = this.getPeriodDateRange(query?.period);

    const allDeals = dbStore.partnerDeals.filter(
      (deal) =>
        deal.organizationId === organizationId &&
        (!affiliateId || deal.affiliateId === affiliateId) &&
        (!query?.programId || deal.programId === query.programId) &&
        (!query?.crmProvider || deal.crmProvider === query.crmProvider) &&
        (!start || new Date(deal.createdAt) >= start),
    );

    const totalDeals = allDeals.length;
    const openDeals = allDeals.filter(
      (d) =>
        ![
          PartnerDealStatus.CLOSED_WON,
          PartnerDealStatus.CLOSED_LOST,
          PartnerDealStatus.REJECTED,
          PartnerDealStatus.CANCELLED,
        ].includes(d.status),
    );
    const wonDeals = allDeals.filter((d) => d.status === PartnerDealStatus.CLOSED_WON);
    const lostDeals = allDeals.filter((d) =>
      [
        PartnerDealStatus.CLOSED_LOST,
        PartnerDealStatus.REJECTED,
        PartnerDealStatus.CANCELLED,
      ].includes(d.status),
    );

    const totalPipelineValue = openDeals.reduce(
      (sum, d) => sum + (d.actualValue || d.estimatedValue || 0),
      0,
    );
    const weightedPipelineValue = Math.round(
      openDeals.reduce((sum, d) => {
        const col = statusToColumn(d.status);
        const prob = COLUMN_PROBABILITIES[col] ?? 0.1;
        return sum + (d.actualValue || d.estimatedValue || 0) * prob;
      }, 0),
    );
    const wonRevenue = wonDeals.reduce(
      (sum, d) => sum + (d.actualValue || d.estimatedValue || 0),
      0,
    );
    const lostValue = lostDeals.reduce(
      (sum, d) => sum + (d.actualValue || d.estimatedValue || 0),
      0,
    );
    const partnerAttributedRevenue = wonDeals
      .filter((d) => Boolean(d.affiliateId))
      .reduce((sum, d) => sum + (d.actualValue || d.estimatedValue || 0), 0);

    const avgDealSize =
      totalDeals > 0
        ? Math.round(
          allDeals.reduce((sum, d) => sum + (d.actualValue || d.estimatedValue || 0), 0) /
          totalDeals,
        )
        : 0;

    const winRate =
      wonDeals.length + lostDeals.length > 0
        ? Math.round((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100)
        : 0;

    // Health signals
    const now = new Date();
    const syncErrorsCount = allDeals.filter((d) => d.status === PartnerDealStatus.SYNC_ERROR).length;
    const overdueCount = openDeals.filter(
      (d) => d.expectedCloseDate && new Date(d.expectedCloseDate) < now,
    ).length;
    const pendingApprovalCount = allDeals.filter(
      (d) =>
        d.status === PartnerDealStatus.SUBMITTED || d.status === PartnerDealStatus.UNDER_REVIEW,
    ).length;
    const unattributedCount = allDeals.filter((d) => !d.affiliateId).length;
    const fourteenDaysFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const closingSoonCount = openDeals.filter(
      (d) =>
        d.expectedCloseDate &&
        new Date(d.expectedCloseDate) >= now &&
        new Date(d.expectedCloseDate) <= fourteenDaysFromNow,
    ).length;

    const healthSignals: DealHealthSignal[] = [];
    if (syncErrorsCount > 0) {
      healthSignals.push({
        id: 'sync-errors',
        severity: 'critical',
        title: 'CRM Sync Errors Detected',
        description: `${syncErrorsCount} deal${syncErrorsCount === 1 ? '' : 's'} failed CRM synchronization and need attention.`,
        count: syncErrorsCount,
        actionLabel: 'Retry Sync',
      });
    }
    if (overdueCount > 0) {
      healthSignals.push({
        id: 'overdue-deals',
        severity: 'warning',
        title: 'Overdue Pipeline Deals',
        description: `${overdueCount} open deal${overdueCount === 1 ? '' : 's'} have passed their expected close dates.`,
        count: overdueCount,
        actionLabel: 'Review Close Dates',
      });
    }
    if (pendingApprovalCount > 0) {
      healthSignals.push({
        id: 'pending-approval',
        severity: 'info',
        title: 'Partner Deals Pending Review',
        description: `${pendingApprovalCount} registered deal${pendingApprovalCount === 1 ? '' : 's'} awaiting administrative approval.`,
        count: pendingApprovalCount,
        actionLabel: 'Approve Deals',
      });
    }
    if (unattributedCount > 0) {
      healthSignals.push({
        id: 'unattributed',
        severity: 'warning',
        title: 'Unattributed Opportunities',
        description: `${unattributedCount} deal${unattributedCount === 1 ? '' : 's'} have no partner assigned.`,
        count: unattributedCount,
        actionLabel: 'Assign Partners',
      });
    }
    if (closingSoonCount > 0) {
      healthSignals.push({
        id: 'closing-soon',
        severity: 'info',
        title: 'Closing in Next 14 Days',
        description: `${closingSoonCount} deal${closingSoonCount === 1 ? '' : 's'} scheduled to close within two weeks.`,
        count: closingSoonCount,
        actionLabel: 'View Closing Deals',
      });
    }

    const attentionCount =
      syncErrorsCount + overdueCount + pendingApprovalCount + unattributedCount;

    // Lifecycle stages
    const lifecycleDistribution: DealLifecycleStage[] = DEAL_BOARD_COLUMNS.map((col) => {
      const stageDeals = allDeals.filter((d) => statusToColumn(d.status) === col);
      const stageVal = stageDeals.reduce(
        (sum, d) => sum + (d.actualValue || d.estimatedValue || 0),
        0,
      );
      const prob = COLUMN_PROBABILITIES[col] ?? 0.1;
      return {
        stage: col,
        label: COLUMN_LABELS[col],
        count: stageDeals.length,
        totalValue: stageVal,
        weightedValue: Math.round(stageVal * prob),
        probability: prob,
        percentage: totalDeals > 0 ? Math.round((stageDeals.length / totalDeals) * 100) : 0,
        color: COLUMN_COLORS[col],
      };
    });

    // Time series trend (past 14 days)
    const activityTrend: DealTimeSeriesPoint[] = [];
    for (let i = 13; i >= 0; i--) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - i);
      const dateStr = targetDate.toISOString().split('T')[0];

      const dayDeals = allDeals.filter((d) => {
        const dStr = new Date(d.createdAt).toISOString().split('T')[0];
        return dStr === dateStr;
      });

      const dayWon = dayDeals.filter((d) => d.status === PartnerDealStatus.CLOSED_WON);
      const dayPipelineVal = dayDeals
        .filter(
          (d) =>
            ![
              PartnerDealStatus.CLOSED_WON,
              PartnerDealStatus.CLOSED_LOST,
              PartnerDealStatus.REJECTED,
              PartnerDealStatus.CANCELLED,
            ].includes(d.status),
        )
        .reduce((sum, d) => sum + (d.actualValue || d.estimatedValue || 0), 0);
      const dayWonRev = dayWon.reduce(
        (sum, d) => sum + (d.actualValue || d.estimatedValue || 0),
        0,
      );

      activityTrend.push({
        date: dateStr,
        pipelineValue: dayPipelineVal,
        wonRevenue: dayWonRev,
        dealsCreated: dayDeals.length,
        dealsWon: dayWon.length,
      });
    }

    // CRM sync status
    const crmConnection = this.findHubSpotConnection(organizationId);
    const syncedCount = allDeals.filter((d) => d.status === PartnerDealStatus.SYNCED).length;
    const pendingCount = allDeals.filter(
      (d) => d.status === PartnerDealStatus.SYNC_PENDING,
    ).length;

    return {
      totalDeals,
      openDeals: openDeals.length,
      wonDeals: wonDeals.length,
      lostDeals: lostDeals.length,
      totalPipelineValue,
      weightedPipelineValue,
      wonRevenue,
      lostValue,
      partnerAttributedRevenue,
      avgDealSize,
      winRate,
      attentionCount,
      healthSignals,
      lifecycleDistribution,
      activityTrend,
      crmSyncStatus: {
        connected: Boolean(
          crmConnection &&
          [
            OrganizationIntegrationStatus.CONNECTED,
            OrganizationIntegrationStatus.DEGRADED,
          ].includes(crmConnection.status),
        ),
        provider: HUBSPOT_PROVIDER,
        lastSyncAt: crmConnection?.lastSyncAt?.toISOString(),
        syncedCount,
        pendingCount,
        errorCount: syncErrorsCount,
      },
    };
  }

  async getPipelineMetrics(
    organizationId: string,
    user: AuthUserPayload,
    query?: DealAnalyticsQueryDto,
  ): Promise<DealPipelineMetrics> {
    const overview = await this.getAnalyticsOverview(organizationId, user, query);

    const allDeals = dbStore.partnerDeals.filter(
      (deal) => deal.organizationId === organizationId,
    );

    // Calculate average days to close for won deals
    const wonDeals = allDeals.filter(
      (d) => d.status === PartnerDealStatus.CLOSED_WON && d.closedAt && d.submittedAt,
    );
    const avgDaysToClose =
      wonDeals.length > 0
        ? Math.round(
          wonDeals.reduce((sum, d) => {
            const diffMs = new Date(d.closedAt!).getTime() - new Date(d.submittedAt).getTime();
            return sum + diffMs / (1000 * 60 * 60 * 24);
          }, 0) / wonDeals.length,
        )
        : 28;

    const stageConversionRates: Record<string, number> = {
      QUALIFIED: 65,
      PROPOSAL: 48,
      NEGOTIATION: 72,
      WON: overview.winRate,
    };

    return {
      stages: overview.lifecycleDistribution,
      totalPipelineValue: overview.totalPipelineValue,
      weightedPipelineValue: overview.weightedPipelineValue,
      avgDaysToClose,
      stageConversionRates,
    };
  }

  async getSyncAnalytics(organizationId: string, user: AuthUserPayload): Promise<DealSyncAnalytics> {
    const connection = this.findHubSpotConnection(organizationId);

    const syncLogs = (dbStore.integrationSyncLogs || [])
      .filter((log) => log.organizationId === organizationId && log.entityType === 'DEAL')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const totalSynced = syncLogs.filter((l) => l.status === 'SUCCEEDED').length;
    const totalErrors = syncLogs.filter((l) => l.status === 'FAILED').length;
    const deals = dbStore.partnerDeals.filter((d) => d.organizationId === organizationId);
    const totalPending = deals.filter((d) => d.status === PartnerDealStatus.SYNC_PENDING).length;

    const totalAttempts = totalSynced + totalErrors;
    const successRate = totalAttempts > 0 ? Math.round((totalSynced / totalAttempts) * 100) : 100;

    return {
      provider: HUBSPOT_PROVIDER,
      connected: Boolean(
        connection &&
        [
          OrganizationIntegrationStatus.CONNECTED,
          OrganizationIntegrationStatus.DEGRADED,
        ].includes(connection.status),
      ),
      status: connection?.status || 'NOT_CONNECTED',
      lastSuccessfulSyncAt: (connection?.config as any)?.lastSuccessfulSyncAt?.toISOString(),
      lastFailedSyncAt: (connection?.config as any)?.lastFailedSyncAt?.toISOString(),
      lastError: connection?.lastError,
      totalSynced,
      totalErrors,
      totalPending,
      successRate,
      recentLogs: syncLogs.slice(0, 30).map((l) => ({
        id: l.id,
        operation: l.operation,
        direction: (l.direction as 'INBOUND' | 'OUTBOUND') || 'OUTBOUND',
        status: (l.status as 'SUCCEEDED' | 'FAILED') || 'SUCCEEDED',
        durationMs: l.durationMs,
        errorCode: l.errorCode,
        errorMessage: l.errorMessage,
        createdAt: l.createdAt.toISOString(),
        entityId: l.entityId,
        externalEntityId: l.externalEntityId,
      })),
    };
  }

  async getDealDossier(
    organizationId: string,
    user: AuthUserPayload,
    dealId: string,
  ): Promise<DealDossierResponse> {
    const deal = this.requireDeal(organizationId, dealId);
    if (user.affiliateId && deal.affiliateId !== user.affiliateId) {
      throw new NotFoundException('Deal not found');
    }

    const affiliate = dbStore.affiliates.find((item) => item.id === deal.affiliateId);
    const program = dbStore.programs.find((item) => item.id === deal.programId);

    // Attribution chain
    const attribution = dbStore.attributions.find(
      (item) => item.customerExternalId === `partner_deal_${deal.id}`,
    );
    const click = attribution ? dbStore.clicks.find((c) => c.id === attribution.clickId) : undefined;
    const trackingLink = click
      ? dbStore.trackingLinks.find((l) => l.id === click.trackingLinkId)
      : undefined;

    // Linked conversions
    const conversions = dbStore.conversions
      .filter(
        (conv) =>
          conv.organizationId === organizationId &&
          (conv.customerExternalId === `partner_deal_${deal.id}` ||
            (conv.metadata as any)?.partnerDealId === deal.id),
      )
      .map((c) => ({
        id: c.id,
        amount: c.amount,
        currency: c.currency,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      }));

    // Linked commissions. A commission carries no deal reference of its own — it
    // reaches the deal only through its conversion — and no currency column
    // either, so the amount is denominated by the conversion that produced it.
    const conversionIds = new Set(conversions.map((c) => c.id));
    const conversionCurrencies = new Map(conversions.map((c) => [c.id, c.currency]));
    const commissions = dbStore.commissions
      .filter((comm) => comm.organizationId === organizationId && conversionIds.has(comm.conversionId))
      .map((c) => ({
        id: c.id,
        amount: c.commissionAmount,
        currency: conversionCurrencies.get(c.conversionId) || PLATFORM_CURRENCY,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      }));

    // Sync history
    const syncHistory = (dbStore.integrationSyncLogs || [])
      .filter((log) => log.organizationId === organizationId && log.entityId === deal.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((l) => ({
        id: l.id,
        operation: l.operation,
        direction: l.direction,
        status: l.status,
        durationMs: l.durationMs,
        errorCode: l.errorCode,
        errorMessage: l.errorMessage,
        createdAt: l.createdAt.toISOString(),
      }));

    // Audit and stage logs
    const dealAuditLogs = (dbStore.auditLogs || [])
      .filter((log) => log.organizationId === organizationId && log.resourceId === deal.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const stageHistory = dealAuditLogs
      .filter((log) => log.action === 'DEAL_STAGE_CHANGED')
      .map((log) => ({
        column: (log.metadata?.column as DealBoardColumn) || 'NEW',
        changedAt: log.createdAt.toISOString(),
        changedBy: log.actorId,
        reason: log.metadata?.reason as string | undefined,
      }));

    return {
      deal: this.publicDeal(deal, !user.affiliateId),
      affiliate: affiliate
        ? {
          id: affiliate.id,
          displayName: affiliate.displayName || 'Partner',
          email: affiliate.email,
          companyName: (affiliate as any).companyName,
        }
        : undefined,
      program: program
        ? {
          id: program.id,
          name: program.name,
          slug: program.slug,
          currency: program.currency,
        }
        : undefined,
      attribution: attribution
        ? {
          model: attribution.model,
          status: deal.attributionStatus,
          attributedAt: attribution.createdAt.toISOString(),
          clickId: click?.id,
          trackingLinkId: trackingLink?.id,
          shortCode: trackingLink?.shortCode,
          destinationUrl: trackingLink?.destinationUrl,
        }
        : undefined,
      conversions,
      commissions,
      syncHistory,
      stageHistory,
      auditLogs: dealAuditLogs.map((l) => ({
        id: l.id,
        action: l.action,
        actorId: l.actorId,
        createdAt: l.createdAt.toISOString(),
        metadata: l.metadata,
      })),
    };
  }

  async bulkAction(
    organizationId: string,
    user: AuthUserPayload,
    dto: BulkDealActionDto,
  ): Promise<{ success: boolean; affected: number; message: string }> {
    let affected = 0;

    for (const dealId of dto.dealIds) {
      try {
        const deal = dbStore.partnerDeals.find(
          (d) => d.organizationId === organizationId && d.id === dealId,
        );
        if (!deal) continue;

        switch (dto.action) {
          case 'APPROVE':
            await this.approve(organizationId, user, dealId);
            affected += 1;
            break;
          case 'REJECT':
            await this.reject(organizationId, user, dealId, { reason: dto.reason });
            affected += 1;
            break;
          case 'SYNC':
            if (deal.crmProvider) {
              await this.sync(organizationId, user, dealId);
              affected += 1;
            }
            break;
          case 'UPDATE_STAGE':
            if (dto.targetColumn) {
              await this.updateStage(organizationId, user, dealId, { column: dto.targetColumn });
              affected += 1;
            }
            break;
          case 'ARCHIVE':
            deal.status = PartnerDealStatus.CANCELLED;
            deal.updatedAt = new Date();
            this.audit(organizationId, user.userId, 'DEAL_ARCHIVED', dealId);
            affected += 1;
            break;
        }
      } catch {
        // Continue processing batch
      }
    }

    return {
      success: true,
      affected,
      message: `Bulk action ${dto.action} processed on ${affected} deal${affected === 1 ? '' : 's'}.`,
    };
  }

  /**
   * The HubSpot connection row for an org. Connections reference their
   * integration by `integrationId`; the provider code lives on the integration
   * definition, so this has to resolve the definition first.
   */
  private findHubSpotConnection(organizationId: string) {
    const integration = dbStore.integrations.find((item) => item.code === HUBSPOT_PROVIDER);
    if (!integration) return undefined;
    return (dbStore.organizationIntegrations || []).find(
      (item) => item.organizationId === organizationId && item.integrationId === integration.id,
    );
  }

}

