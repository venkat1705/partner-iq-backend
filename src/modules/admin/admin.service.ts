import { ForbiddenException, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { AppDataSource } from '../../database/data-source';
import { dbStore } from '../../database/store';
import { IntegrationEventStatus, IntegrationStatus, OrganizationIntegrationStatus, PlatformRole, PayoutStatus } from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@Injectable()
export class AdminService {
  async getOverview(user: AuthUserPayload) {
    if (!user.isSuperAdmin && user.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access is required');
    }

    const orgNameById = new Map(dbStore.organizations.map((org) => [org.id, org.name]));
    const userById = new Map(dbStore.users.map((userRecord) => [userRecord.id, userRecord]));
    const programById = new Map(dbStore.programs.map((program) => [program.id, program]));
    const affiliateById = new Map(dbStore.affiliates.map((affiliate) => [affiliate.id, affiliate]));
    const conversionsByProgram = this.groupBy(dbStore.conversions, (conversion) => conversion.programId);
    const commissionsByConversion = this.groupBy(dbStore.commissions, (commission) => commission.conversionId);
    const payoutsByBatch = this.groupBy(dbStore.payoutItems, (item) => item.batchId);

    const organizations = dbStore.organizations
      .filter((org) => !org.deletedAt)
      .map((org) => {
        const programs = dbStore.programs.filter((program) => program.organizationId === org.id && !program.deletedAt);
        const affiliates = dbStore.affiliates.filter((affiliate) => affiliate.organizationId === org.id);
        const conversions = dbStore.conversions.filter((conversion) => conversion.organizationId === org.id);
        const commissions = dbStore.commissions.filter((commission) => commission.organizationId === org.id);
        const ownerMembership = dbStore.organizationMemberships.find(
          (membership) => membership.organizationId === org.id && membership.role === 'OWNER',
        );
        const owner = ownerMembership ? userById.get(ownerMembership.userId) : undefined;

        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          domain: this.domainFromWebsite(org.website),
          status: this.organizationStatus(org.status),
          plan: 'growth',
          programs: programs.length,
          affiliates: affiliates.length,
          trackedRevenue: this.centsToDollars(conversions.reduce((total, conversion) => total + Number(conversion.amount || 0), 0)),
          commissionVolume: this.centsToDollars(commissions.reduce((total, commission) => total + Number(commission.commissionAmount || 0), 0)),
          country: org.country || 'US',
          industry: org.industry || 'Software',
          createdAt: this.dateOnly(org.createdAt),
          lastActiveAt: this.relativeTime(org.updatedAt || org.createdAt),
          ownerName: owner ? `${owner.firstName} ${owner.lastName}` : 'Unknown Owner',
          ownerEmail: owner?.email || 'unknown@example.com',
          apiAccessEnabled: org.status === 'ACTIVE',
          payoutsEnabled: org.status === 'ACTIVE',
        };
      });

    const programs = dbStore.programs
      .filter((program) => !program.deletedAt)
      .map((program) => {
        const conversions = conversionsByProgram.get(program.id) || [];
        const commissions = dbStore.commissions.filter((commission) => commission.programId === program.id);
        const affiliateIds = new Set(
          dbStore.programAffiliates
            .filter((link) => link.programId === program.id)
            .map((link) => link.affiliateId),
        );

        return {
          id: program.id,
          organizationId: program.organizationId,
          orgName: orgNameById.get(program.organizationId) || 'Unknown Organization',
          name: program.name,
          type: String(program.type).toLowerCase(),
          status: this.programStatus(program.status),
          affiliatesCount: affiliateIds.size,
          revenue: this.centsToDollars(conversions.reduce((total, conversion) => total + Number(conversion.amount || 0), 0)),
          commission: this.centsToDollars(commissions.reduce((total, commission) => total + Number(commission.commissionAmount || 0), 0)),
          fraudRate: this.fraudRateForProgram(program.id),
          defaultCommission: this.formatCommission(program.commissionType, program.defaultCommissionValue),
          attributionModel: String(program.attributionModel).toLowerCase(),
          cookieDays: program.cookieDurationDays,
          approvalType: String(program.affiliateApprovalMode || 'AUTO').toLowerCase(),
          createdAt: this.dateOnly(program.createdAt),
        };
      });

    const affiliates = dbStore.affiliates.map((affiliate) => {
      const programLinks = dbStore.programAffiliates.filter((link) => link.affiliateId === affiliate.id);
      const primaryProgram = programLinks[0] ? programById.get(programLinks[0].programId) : undefined;
      const commissions = dbStore.commissions.filter((commission) => commission.affiliateId === affiliate.id);
      const conversions = dbStore.conversions.filter((conversion) => conversion.affiliateId === affiliate.id);

      return {
        id: affiliate.id,
        organizationId: affiliate.organizationId,
        orgName: orgNameById.get(affiliate.organizationId) || 'Unknown Organization',
        programName: primaryProgram?.name || 'No program',
        name: affiliate.displayName,
        email: affiliate.email,
        channel: affiliate.companyName || affiliate.website || 'Direct partner',
        trustScore: affiliate.trustScore,
        status: this.affiliateStatus(affiliate.status),
        revenue: this.centsToDollars(conversions.reduce((total, conversion) => total + Number(conversion.amount || 0), 0)),
        commissionEarned: this.centsToDollars(commissions.reduce((total, commission) => total + Number(commission.commissionAmount || 0), 0)),
        fraudRate: this.fraudRateForAffiliate(affiliate.id),
        joinedDate: this.dateOnly(affiliate.createdAt),
        country: affiliate.country,
      };
    });

    const conversions = dbStore.conversions.map((conversion) => {
      const commission = (commissionsByConversion.get(conversion.id) || [])[0];
      const program = programById.get(conversion.programId);
      const affiliate = conversion.affiliateId ? affiliateById.get(conversion.affiliateId) : undefined;

      return {
        id: conversion.id,
        orderId: conversion.externalId,
        organizationId: conversion.organizationId,
        orgName: orgNameById.get(conversion.organizationId) || 'Unknown Organization',
        programName: program?.name || 'Unknown Program',
        affiliateName: affiliate?.displayName || 'Unattributed',
        revenue: this.centsToDollars(conversion.amount),
        commission: this.centsToDollars(commission?.commissionAmount || 0),
        fraudScore: this.fraudScoreForConversion(conversion.id),
        status: this.titleCase(conversion.status),
        date: this.dateTime(conversion.createdAt),
        attribution: 'Last Click',
        clickId: conversion.id,
      };
    });

    const commissions = dbStore.commissions.map((commission) => {
      const program = programById.get(commission.programId);
      const affiliate = affiliateById.get(commission.affiliateId);

      return {
        id: commission.id,
        organizationId: commission.organizationId,
        orgName: orgNameById.get(commission.organizationId) || 'Unknown Organization',
        affiliateName: affiliate?.displayName || 'Unknown Affiliate',
        programName: program?.name || 'Unknown Program',
        revenue: this.centsToDollars(commission.baseAmount),
        rate: `${commission.rate / 100}%`,
        amount: this.centsToDollars(commission.commissionAmount),
        status: this.titleCase(commission.status),
        rule: commission.ruleSnapshot?.ruleName || 'Default Program Rate',
        created: this.dateTime(commission.createdAt),
      };
    });

    const fraudReviews = dbStore.fraudReviews.map((review) => {
      const conversion = dbStore.conversions.find((item) => item.id === review.conversionId);
      const affiliate = conversion?.affiliateId ? affiliateById.get(conversion.affiliateId) : undefined;

      return {
        id: review.id,
        riskLevel: this.riskLevel(review.fraudScore),
        conversionId: conversion?.externalId || review.conversionId,
        orgName: orgNameById.get(review.organizationId) || 'Unknown Organization',
        affiliateName: affiliate?.displayName || 'Unassigned',
        amount: this.centsToDollars(conversion?.amount || 0),
        fraudScore: review.fraudScore,
        confidence: review.confidence || 0,
        decision: review.reviewDecision || 'REVIEW',
        assessmentId: review.assessmentId,
        signals: (review.signals || []).map((signal: any) => String(signal.code || signal.reason || signal.type || signal)),
        age: this.relativeTime(review.createdAt),
        status: review.status === 'APPROVED' ? 'cleared' : review.status === 'REJECTED' ? 'blocked' : 'pending',
        ip: 'n/a',
        country: affiliate?.country || 'n/a',
      };
    });

    const payoutBatches = dbStore.payoutBatches.map((batch) => ({
      id: batch.id,
      batchId: batch.id,
      orgName: orgNameById.get(batch.organizationId) || 'Unknown Organization',
      period: `${this.dateOnly(batch.createdAt)} payout`,
      affiliatesCount: new Set((payoutsByBatch.get(batch.id) || []).map((item) => item.affiliateId)).size,
      amount: this.centsToDollars(batch.totalAmount),
      provider: 'Direct Bank Wire',
      status: this.payoutStatus(batch.status),
      created: this.dateTime(batch.createdAt),
      processed: batch.status === PayoutStatus.COMPLETED ? this.dateTime(batch.updatedAt) : 'Pending',
    }));

    const auditLogs = dbStore.auditLogs.map((log) => ({
      id: log.id,
      time: this.dateTime(log.createdAt),
      actor: userById.get(log.actorId)?.email || log.actorId,
      orgName: log.organizationId ? orgNameById.get(log.organizationId) || 'Unknown Organization' : 'PartnerIQ Platform',
      action: log.action,
      resource: log.resourceId,
      ip: log.ipAddress || 'n/a',
      requestId: log.id,
      metadata: log.metadata || {},
    }));

    const webhooks = dbStore.webhookDeliveries.map((delivery) => {
      const endpoint = dbStore.webhookEndpoints.find((item) => item.id === delivery.endpointId);
      return {
        id: delivery.id,
        deliveryId: delivery.eventId,
        orgName: endpoint ? orgNameById.get(endpoint.organizationId) || 'Unknown Organization' : 'Unknown Organization',
        endpoint: endpoint?.url || 'Unknown endpoint',
        event: delivery.eventId,
        httpStatus: delivery.responseCode,
        attempts: delivery.attempt,
        durationMs: delivery.durationMs,
        timestamp: this.dateTime(delivery.createdAt),
        payload: typeof delivery.requestBody === 'string' ? delivery.requestBody : JSON.stringify(delivery.requestBody, null, 2),
        response: delivery.responseBodyTruncated || '',
      };
    });

    return {
      adminUser: {
        id: user.userId,
        name: user.email,
        email: user.email,
        role: 'SUPER_ADMIN',
        lastLogin: 'Just now',
      },
      organizations,
      programs,
      affiliates,
      conversions,
      commissions,
      fraudReviews,
      payoutBatches,
      auditLogs,
      webhooks,
      integrations: this.getIntegrations(),
      integrationMetrics: this.getIntegrationMetrics(),
      systemComponents: await this.getSystemComponents(),
      queueJobs: this.getQueueJobs(),
      securityEvents: this.getSecurityEvents(),
    };
  }

  private getSecurityEvents() {
    const securityEvents = [];

    for (const lockedUser of dbStore.users.filter((user) => user.status === 'LOCKED')) {
      securityEvents.push({
        id: `sec_user_${lockedUser.id}`,
        severity: 'High',
        event: 'USER_ACCOUNT_LOCKED',
        actor: lockedUser.email,
        orgName: 'PartnerIQ Platform',
        ip: 'n/a',
        time: this.relativeTime(lockedUser.lockedUntil || lockedUser.updatedAt),
        status: 'Locked',
        details: 'User account is locked after authentication policy enforcement.',
      });
    }

    for (const session of dbStore.authSessions.filter((item) => item.revokedAt)) {
      const sessionUser = dbStore.users.find((user) => user.id === session.userId);
      securityEvents.push({
        id: `sec_session_${session.id}`,
        severity: 'Medium',
        event: 'SESSION_REVOKED',
        actor: sessionUser?.email || session.userId,
        orgName: 'PartnerIQ Platform',
        ip: session.ipAddress || 'n/a',
        time: this.relativeTime(session.revokedAt),
        status: 'Revoked',
        details: 'Authentication session refresh token family was revoked.',
      });
    }

    for (const org of dbStore.organizations.filter((item) => item.status === 'SUSPENDED' || item.status === 'CLOSED')) {
      securityEvents.push({
        id: `sec_org_${org.id}`,
        severity: org.status === 'SUSPENDED' ? 'High' : 'Medium',
        event: 'TENANT_ACCESS_RESTRICTED',
        actor: dbStore.users.find((user) => user.id === org.createdBy)?.email || org.createdBy,
        orgName: org.name,
        ip: 'n/a',
        time: this.relativeTime(org.updatedAt),
        status: org.status,
        details: `Organization status is ${String(org.status).toLowerCase()}, so protected tenant actions are restricted.`,
      });
    }

    for (const apiKey of dbStore.apiKeys.filter((key) => key.revokedAt)) {
      const orgName = dbStore.organizations.find((org) => org.id === apiKey.organizationId)?.name || 'Unknown Organization';
      securityEvents.push({
        id: `sec_api_key_${apiKey.id}`,
        severity: 'Medium',
        event: 'API_KEY_REVOKED',
        actor: dbStore.users.find((user) => user.id === apiKey.createdBy)?.email || apiKey.createdBy,
        orgName,
        ip: 'n/a',
        time: this.relativeTime(apiKey.revokedAt),
        status: 'Revoked',
        details: `API key ${apiKey.prefix} was revoked and can no longer access tenant APIs.`,
      });
    }

    for (const delivery of dbStore.webhookDeliveries.filter((item) => item.responseCode >= 400)) {
      const endpoint = dbStore.webhookEndpoints.find((item) => item.id === delivery.endpointId);
      const orgName = endpoint
        ? dbStore.organizations.find((org) => org.id === endpoint.organizationId)?.name || 'Unknown Organization'
        : 'Unknown Organization';
      securityEvents.push({
        id: `sec_webhook_${delivery.id}`,
        severity: delivery.responseCode >= 500 ? 'High' : 'Medium',
        event: 'WEBHOOK_DELIVERY_FAILURE',
        actor: endpoint?.url || delivery.endpointId,
        orgName,
        ip: 'n/a',
        time: this.relativeTime(delivery.createdAt),
        status: String(delivery.responseCode),
        details: delivery.responseBodyTruncated || 'Webhook delivery returned a non-success response.',
      });
    }

    return securityEvents.sort((a, b) => a.time.localeCompare(b.time));
  }

  private getIntegrations() {
    const today = new Date().toISOString().slice(0, 10);
    return [...dbStore.integrations]
      .filter((integration) => integration.code === 'HUBSPOT')
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
      .map((integration) => {
        const connections = dbStore.organizationIntegrations.filter((item) => item.integrationId === integration.id);
        const events = dbStore.integrationEvents.filter((item) => item.integrationId === integration.id);
        const processed = events.filter((event) => event.status === IntegrationEventStatus.PROCESSED).length;
        const failed = events.filter((event) => event.status === IntegrationEventStatus.FAILED).length;
        const total = processed + failed;
        const successRate = total === 0 ? 100 : Math.round((processed / total) * 1000) / 10;

        return {
          id: integration.id,
          code: integration.code,
          name: integration.name,
          slug: integration.slug,
          description: integration.description,
          category: integration.category,
          provider: integration.provider,
          status: integration.status,
          connectionTypes: integration.connectionTypes || [],
          supportsOAuth: integration.supportsOAuth,
          supportsWebhooks: integration.supportsWebhooks,
          supportsApiKey: integration.supportsApiKey,
          documentationUrl: integration.documentationUrl,
          iconKey: integration.iconKey,
          displayOrder: integration.displayOrder,
          connectedOrganizations: connections.length,
          healthyConnections: connections.filter((item) => item.status === OrganizationIntegrationStatus.CONNECTED).length,
          degradedConnections: connections.filter((item) => item.status === OrganizationIntegrationStatus.REAUTH_REQUIRED || item.status === OrganizationIntegrationStatus.PENDING).length,
          failedConnections: connections.filter((item) => item.status === OrganizationIntegrationStatus.ERROR).length,
          eventsToday: events.filter((event) => new Date(event.createdAt).toISOString().slice(0, 10) === today).length,
          successRate,
          avgProcessingMs: events.length === 0 ? 0 : Math.round(events.reduce((sum, event) => sum + Number(event.processingMs || 0), 0) / events.length),
          webhookSuccessRate: successRate,
        };
      });
  }

  private getIntegrationMetrics() {
    const integrations = this.getIntegrations();
    return {
      totalIntegrations: integrations.length,
      activeIntegrations: integrations.filter((item) => item.status === IntegrationStatus.ACTIVE).length,
      betaIntegrations: integrations.filter((item) => item.status === IntegrationStatus.BETA).length,
      comingSoonIntegrations: integrations.filter((item) => item.status === IntegrationStatus.COMING_SOON).length,
      connectedOrganizations: integrations.reduce((total, item) => total + item.connectedOrganizations, 0),
      healthyConnections: integrations.reduce((total, item) => total + item.healthyConnections, 0),
      degradedConnections: integrations.reduce((total, item) => total + item.degradedConnections, 0),
      failedConnections: integrations.reduce((total, item) => total + item.failedConnections, 0),
      eventsToday: integrations.reduce((total, item) => total + item.eventsToday, 0),
    };
  }

  private async getSystemComponents() {
    const [databaseHealth, redisHealth] = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkRedisHealth(),
    ]);

    const failedWebhookDeliveries = dbStore.webhookDeliveries.filter((delivery) => delivery.responseCode >= 400).length;
    const queuedWorkItems =
      dbStore.fraudReviews.filter((review) => review.status === 'PENDING').length +
      dbStore.payoutBatches.filter((batch) => batch.status === 'DRAFT' || batch.status === 'PROCESSING').length;

    return [
      databaseHealth,
      redisHealth,
      {
        name: 'Core API Process',
        status: 'Healthy',
        latency: 'local',
        uptime: this.formatUptime(process.uptime()),
        metric: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB RSS`,
      },
      {
        name: 'DB-Backed Store Cache',
        status: AppDataSource.isInitialized ? 'Healthy' : 'Down',
        latency: 'local',
        uptime: AppDataSource.isInitialized ? 'online' : 'offline',
        metric: `${dbStore.organizations.length} orgs cached`,
      },
      {
        name: 'BullMQ Worker Queues',
        status: redisHealth.status === 'Healthy' ? 'Healthy' : 'Degraded',
        latency: redisHealth.latency,
        uptime: redisHealth.status === 'Healthy' ? 'ready' : 'redis unavailable',
        metric: `${queuedWorkItems} pending work items`,
      },
      {
        name: 'Webhook Dispatch Engine',
        status: failedWebhookDeliveries > 0 ? 'Degraded' : 'Healthy',
        latency: this.averageWebhookLatency(),
        uptime: failedWebhookDeliveries > 0 ? `${failedWebhookDeliveries} failed deliveries` : 'ready',
        metric: `${dbStore.webhookDeliveries.length} deliveries`,
      },
    ];
  }

  private getQueueJobs() {
    const jobs = [];

    for (const review of dbStore.fraudReviews) {
      const orgName = dbStore.organizations.find((org) => org.id === review.organizationId)?.name || 'Unknown Organization';
      jobs.push({
        id: `fraud_${review.id}`,
        queue: 'Fraud',
        orgName,
        attempts: 1,
        status: review.status === 'PENDING' ? 'waiting' : 'completed',
        created: this.relativeTime(review.createdAt),
      });
    }

    for (const batch of dbStore.payoutBatches) {
      const orgName = dbStore.organizations.find((org) => org.id === batch.organizationId)?.name || 'Unknown Organization';
      jobs.push({
        id: `payout_${batch.id}`,
        queue: 'Payouts',
        orgName,
        attempts: batch.status === 'FAILED' ? 3 : 1,
        error: batch.status === 'FAILED' ? 'Payout batch failed' : undefined,
        status: batch.status === 'COMPLETED' ? 'completed' : batch.status === 'FAILED' ? 'failed' : 'waiting',
        created: this.relativeTime(batch.createdAt),
      });
    }

    for (const delivery of dbStore.webhookDeliveries) {
      const endpoint = dbStore.webhookEndpoints.find((item) => item.id === delivery.endpointId);
      const orgName = endpoint
        ? dbStore.organizations.find((org) => org.id === endpoint.organizationId)?.name || 'Unknown Organization'
        : 'Unknown Organization';
      jobs.push({
        id: `webhook_${delivery.id}`,
        queue: 'Webhooks',
        orgName,
        attempts: delivery.attempt,
        error: delivery.responseCode >= 400 ? delivery.responseBodyTruncated || 'Webhook delivery failed' : undefined,
        status: delivery.responseCode >= 400 ? 'failed' : 'completed',
        created: this.relativeTime(delivery.createdAt),
      });
    }

    return jobs;
  }

  private async checkDatabaseHealth() {
    const startedAt = Date.now();
    try {
      if (!AppDataSource.isInitialized) {
        return {
          name: 'MySQL Primary Database',
          status: 'Down',
          latency: 'offline',
          uptime: 'not connected',
          metric: 'connection closed',
        };
      }

      await AppDataSource.query('SELECT 1');
      return {
        name: 'MySQL Primary Database',
        status: 'Healthy',
        latency: `${Date.now() - startedAt}ms`,
        uptime: 'connected',
        metric: `${AppDataSource.entityMetadatas.length} entities`,
      };
    } catch (error: any) {
      return {
        name: 'MySQL Primary Database',
        status: 'Down',
        latency: `${Date.now() - startedAt}ms`,
        uptime: 'query failed',
        metric: error?.code || 'database error',
      };
    }
  }

  private async checkRedisHealth() {
    const startedAt = Date.now();
    const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
    const redis = redisUrl
      ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false })
      : new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
        password: process.env.REDIS_PASSWORD || undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
      });

    redis.on('error', () => undefined);

    try {
      await this.withTimeout(redis.connect(), 1200);
      await this.withTimeout(redis.ping(), 1200);
      const info = await this.withTimeout(redis.info('memory'), 1200);
      const memory = /used_memory_human:(.+)\r?\n/.exec(info)?.[1]?.trim() || 'connected';

      return {
        name: 'Redis Cache & Queue Broker',
        status: 'Healthy',
        latency: `${Date.now() - startedAt}ms`,
        uptime: 'connected',
        metric: memory,
      };
    } catch (error: any) {
      return {
        name: 'Redis Cache & Queue Broker',
        status: 'Degraded',
        latency: `${Date.now() - startedAt}ms`,
        uptime: 'unreachable',
        metric: error?.code || error?.message || 'redis unavailable',
      };
    } finally {
      redis.disconnect();
    }
  }

  private groupBy<T>(items: T[], getKey: (item: T) => string) {
    return items.reduce((map, item) => {
      const key = getKey(item);
      const values = map.get(key) || [];
      values.push(item);
      map.set(key, values);
      return map;
    }, new Map<string, T[]>());
  }

  private centsToDollars(value: number) {
    return Number((Number(value || 0) / 100).toFixed(2));
  }

  private dateOnly(value?: Date) {
    return value ? new Date(value).toISOString().slice(0, 10) : '';
  }

  private dateTime(value?: Date) {
    return value ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) : '';
  }

  private relativeTime(value?: Date) {
    if (!value) return 'Unknown';
    const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  private formatUptime(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  private averageWebhookLatency() {
    if (!dbStore.webhookDeliveries.length) return 'n/a';
    const total = dbStore.webhookDeliveries.reduce((sum, delivery) => sum + Number(delivery.durationMs || 0), 0);
    return `${Math.round(total / dbStore.webhookDeliveries.length)}ms`;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private domainFromWebsite(website?: string) {
    if (!website) return 'n/a';
    try {
      return new URL(website).hostname.replace(/^www\./, '');
    } catch {
      return website.replace(/^https?:\/\//, '').split('/')[0] || 'n/a';
    }
  }

  private organizationStatus(status: string) {
    if (status === 'SUSPENDED') return 'suspended';
    if (status === 'CLOSED' || status === 'REVOKED') return 'closed';
    return 'active';
  }

  private programStatus(status: string) {
    if (status === 'PAUSED') return 'paused';
    if (status === 'DRAFT') return 'draft';
    return 'active';
  }

  private affiliateStatus(status: string) {
    if (status === 'SUSPENDED' || status === 'REJECTED') return 'Suspended';
    if (status === 'PENDING') return 'Pending';
    return 'Active';
  }

  private payoutStatus(status: string) {
    if (status === 'COMPLETED') return 'Completed';
    if (status === 'PROCESSING') return 'Processing';
    if (status === 'FAILED' || status === 'PARTIALLY_FAILED' || status === 'CANCELLED') return 'Failed';
    return 'Scheduled';
  }

  private titleCase(value: string) {
    const normalized = String(value || '').toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private formatCommission(type: string, value: number) {
    if (type === 'FIXED_AMOUNT') {
      return `$${this.centsToDollars(value).toFixed(2)} flat`;
    }

    return `${value / 100}%`;
  }

  private fraudScoreForConversion(conversionId: string) {
    return dbStore.fraudReviews.find((review) => review.conversionId === conversionId)?.fraudScore || 0;
  }

  private fraudRateForProgram(programId: string) {
    const reviews = dbStore.fraudReviews.filter((review) => review.programId === programId);
    if (!reviews.length) return 0;
    return Number(((reviews.filter((review) => review.fraudScore >= 70).length / reviews.length) * 100).toFixed(1));
  }

  private fraudRateForAffiliate(affiliateId: string) {
    const conversionIds = dbStore.conversions
      .filter((conversion) => conversion.affiliateId === affiliateId)
      .map((conversion) => conversion.id);
    const reviews = dbStore.fraudReviews.filter((review) => conversionIds.includes(review.conversionId));
    if (!reviews.length) return 0;
    return Number(((reviews.filter((review) => review.fraudScore >= 70).length / reviews.length) * 100).toFixed(1));
  }

  private riskLevel(score: number) {
    if (score >= 90) return 'CRITICAL';
    if (score >= 70) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }
}
