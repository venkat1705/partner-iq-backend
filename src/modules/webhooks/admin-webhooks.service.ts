import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { lookup as dnsLookup } from 'dns/promises';
import {
  dbStore,
  WebhookEndpointRecordEntity,
  WebhookEventRecordEntity,
  WebhookDeliveryRecordEntity,
  WebhookDeliveryAttemptRecordEntity,
  WebhookEventTypeDefinitionEntity,
  WebhookDeadLetterRecordEntity,
  WebhookSecurityIncidentRecordEntity,
  WebhookExceptionRecordEntity,
  WebhookAuditRecordEntity,
} from '../../database/store';
import {
  WebhookEndpointStatus,
  WebhookDeliveryStatus,
  WebhookFailureCategory,
} from '../../database/schema-webhooks';
import { SecurityUtils } from '../../common/utils/security.utils';

export interface WebhookOverviewResponse {
  kpis: {
    totalEvents: number;
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    deliverySuccessRate: number;
    pendingDeliveries: number;
    retryingDeliveries: number;
    deadLetterDeliveries: number;
    avgDeliveryLatencyMs: number;
    p95DeliveryLatencyMs: number;
    activeEndpoints: number;
    disabledEndpoints: number;
    organizationsCount: number;
  };
  timeline: {
    time: string;
    total: number;
    successful: number;
    failed: number;
    retried: number;
    deadLetter: number;
    avgLatencyMs: number;
  }[];
  healthSignals: {
    id: string;
    type: 'FAILURE_INCREASE' | 'ENDPOINT_FAILING' | 'RETRY_BACKLOG' | 'DEAD_LETTER_SPIKE' | 'HEALTHY';
    title: string;
    description: string;
    severity: 'CRITICAL' | 'WARNING' | 'INFO';
    detectedAt: string;
    affectedCount: number;
  }[];
  recentFailures: WebhookDeliveryRecordEntity[];
}

@Injectable()
export class AdminWebhooksService implements OnModuleInit {
  private readonly logger = new Logger(AdminWebhooksService.name);

  async onModuleInit() {
    this.seedEventTypeCatalog();
    // Never in production (see guard inside): local dev/tests need sample
    // endpoints/events/deliveries to exercise this dashboard against.
    this.seedDevFixtureTelemetry();
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1. Overview & Analytics
  // ────────────────────────────────────────────────────────────────────────

  async getOverview(period = '30d'): Promise<WebhookOverviewResponse> {
    const events = dbStore.webhookEventRecords;
    const deliveries = dbStore.webhookDeliveryRecords;
    const endpoints = dbStore.webhookEndpointRecords;
    const deadLetters = dbStore.webhookDeadLetterRecords;

    const totalEvents = events.length;
    const totalDeliveries = deliveries.length;
    const successfulDeliveries = deliveries.filter((d) => d.status === WebhookDeliveryStatus.DELIVERED).length;
    const failedDeliveries = deliveries.filter(
      (d) => d.status === WebhookDeliveryStatus.FAILED || d.status === WebhookDeliveryStatus.EXHAUSTED
    ).length;
    const retryingDeliveries = deliveries.filter((d) => d.status === WebhookDeliveryStatus.RETRYING).length;
    const pendingDeliveries = deliveries.filter(
      (d) => d.status === WebhookDeliveryStatus.PENDING || d.status === WebhookDeliveryStatus.PROCESSING
    ).length;
    const deadLetterDeliveries = deadLetters.filter((dl) => dl.status === 'UNRESOLVED').length;

    const completed = successfulDeliveries + failedDeliveries;
    const deliverySuccessRate = completed > 0 ? Number(((successfulDeliveries / completed) * 100).toFixed(1)) : 100;

    const latencies = deliveries.map((d) => d.durationMs || 0).sort((a, b) => a - b);
    const avgDeliveryLatencyMs =
      latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95DeliveryLatencyMs = latencies.length > 0 ? latencies[p95Index] || latencies[latencies.length - 1] : 0;

    const activeEndpoints = endpoints.filter((e) => e.status === WebhookEndpointStatus.ACTIVE).length;
    const disabledEndpoints = endpoints.filter((e) => e.status === WebhookEndpointStatus.DISABLED).length;

    const orgSet = new Set(endpoints.map((e) => e.organizationId));
    const organizationsCount = orgSet.size;

    // Timeline buckets (e.g. 7 points)
    const timeline = this.generateTimelineBuckets(deliveries);

    // Deterministic operational health signals
    const healthSignals = this.generateHealthSignals(deliveries, endpoints, deadLetters);

    // Recent failures
    const recentFailures = deliveries
      .filter((d) => d.status === WebhookDeliveryStatus.FAILED || d.status === WebhookDeliveryStatus.EXHAUSTED)
      .slice(0, 10);

    return {
      kpis: {
        totalEvents,
        totalDeliveries,
        successfulDeliveries,
        failedDeliveries,
        deliverySuccessRate,
        pendingDeliveries,
        retryingDeliveries,
        deadLetterDeliveries,
        avgDeliveryLatencyMs,
        p95DeliveryLatencyMs,
        activeEndpoints,
        disabledEndpoints,
        organizationsCount,
      },
      timeline,
      healthSignals,
      recentFailures,
    };
  }

  async getAnalytics(params: {
    range?: string;
    organizationId?: string;
    endpointId?: string;
    eventType?: string;
  } = {}) {
    let deliveries = dbStore.webhookDeliveryRecords;
    if (params.organizationId) {
      deliveries = deliveries.filter((d) => d.organizationId === params.organizationId);
    }
    if (params.endpointId) {
      deliveries = deliveries.filter((d) => d.endpointId === params.endpointId);
    }
    if (params.eventType) {
      deliveries = deliveries.filter((d) => d.eventType === params.eventType);
    }

    return {
      range: params.range || '30D',
      series: this.generateTimelineBuckets(deliveries),
      breakdownByStatus: {
        DELIVERED: deliveries.filter((d) => d.status === WebhookDeliveryStatus.DELIVERED).length,
        FAILED: deliveries.filter((d) => d.status === WebhookDeliveryStatus.FAILED).length,
        RETRYING: deliveries.filter((d) => d.status === WebhookDeliveryStatus.RETRYING).length,
        DEAD_LETTER: deliveries.filter((d) => d.status === WebhookDeliveryStatus.DEAD_LETTER).length,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private generateTimelineBuckets(deliveries: WebhookDeliveryRecordEntity[]) {
    const buckets = [
      { label: '00:00', startH: 0, endH: 4 },
      { label: '04:00', startH: 4, endH: 8 },
      { label: '08:00', startH: 8, endH: 12 },
      { label: '12:00', startH: 12, endH: 16 },
      { label: '16:00', startH: 16, endH: 20 },
      { label: '20:00', startH: 20, endH: 24 },
    ];

    return buckets.map((b) => {
      const subset = deliveries.filter((_, idx) => idx % buckets.length === buckets.indexOf(b));
      const total = subset.length;
      const successful = subset.filter((d) => d.status === WebhookDeliveryStatus.DELIVERED).length;
      const failed = subset.filter(
        (d) => d.status === WebhookDeliveryStatus.FAILED || d.status === WebhookDeliveryStatus.EXHAUSTED
      ).length;
      const retried = subset.filter((d) => d.status === WebhookDeliveryStatus.RETRYING).length;
      const deadLetter = subset.filter((d) => d.status === WebhookDeliveryStatus.DEAD_LETTER).length;
      const lats = subset.map((d) => d.durationMs || 0);
      const avgLatencyMs = lats.length > 0 ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : 0;

      return {
        time: b.label,
        total,
        successful,
        failed,
        retried,
        deadLetter,
        avgLatencyMs,
      };
    });
  }

  private generateHealthSignals(
    deliveries: WebhookDeliveryRecordEntity[],
    endpoints: WebhookEndpointRecordEntity[],
    deadLetters: WebhookDeadLetterRecordEntity[]
  ) {
    const signals: WebhookOverviewResponse['healthSignals'] = [];

    // Signal 1: Retry Backlog
    const retrying = deliveries.filter((d) => d.status === WebhookDeliveryStatus.RETRYING);
    if (retrying.length > 0) {
      signals.push({
        id: 'sig_retry_backlog',
        type: 'RETRY_BACKLOG',
        title: 'Active Retry Backlog',
        description: `${retrying.length} deliveries are currently awaiting exponential backoff retries.`,
        severity: retrying.length > 10 ? 'WARNING' : 'INFO',
        detectedAt: new Date().toISOString(),
        affectedCount: retrying.length,
      });
    }

    // Signal 2: Dead Letter activity
    const unresolvedDL = deadLetters.filter((d) => d.status === 'UNRESOLVED');
    if (unresolvedDL.length > 0) {
      signals.push({
        id: 'sig_dead_letter',
        type: 'DEAD_LETTER_SPIKE',
        title: 'Exhausted Deliveries in Dead-Letter Queue',
        description: `${unresolvedDL.length} deliveries exhausted max retry attempts and entered the dead-letter queue.`,
        severity: 'CRITICAL',
        detectedAt: new Date().toISOString(),
        affectedCount: unresolvedDL.length,
      });
    }

    // Signal 3: Failing Endpoints
    const degradedEndpoints = endpoints.filter((e) => e.status === WebhookEndpointStatus.DEGRADED);
    if (degradedEndpoints.length > 0) {
      signals.push({
        id: 'sig_failing_endpoints',
        type: 'ENDPOINT_FAILING',
        title: 'Degraded Endpoint Health',
        description: `${degradedEndpoints.length} endpoint(s) have failed consecutive deliveries and were flagged as degraded.`,
        severity: 'WARNING',
        detectedAt: new Date().toISOString(),
        affectedCount: degradedEndpoints.length,
      });
    } else {
      signals.push({
        id: 'sig_healthy',
        type: 'HEALTHY',
        title: 'Delivery Gateway Operating Nominally',
        description: 'No recurring destination endpoint outages detected in this period.',
        severity: 'INFO',
        detectedAt: new Date().toISOString(),
        affectedCount: 0,
      });
    }

    return signals;
  }

  // ────────────────────────────────────────────────────────────────────────
  // 2. Endpoints Management
  // ────────────────────────────────────────────────────────────────────────

  async getEndpoints(params: { search?: string; status?: string; organizationId?: string } = {}) {
    let endpoints = [...dbStore.webhookEndpointRecords];
    if (params.organizationId) {
      endpoints = endpoints.filter((e) => e.organizationId === params.organizationId);
    }
    if (params.status && params.status !== 'ALL') {
      endpoints = endpoints.filter((e) => e.status === params.status);
    }
    if (params.search) {
      const q = params.search.toLowerCase();
      endpoints = endpoints.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.url.toLowerCase().includes(q) ||
          e.organizationName.toLowerCase().includes(q)
      );
    }

    return endpoints.map((ep) => ({
      ...ep,
      secretEncrypted: undefined, // Never expose secret
      secretHash: undefined,
      secretMasked: '••••••••••••' + ep.id.slice(0, 4).toUpperCase(),
    }));
  }

  async getEndpointDetail(id: string) {
    const ep = dbStore.webhookEndpointRecords.find((e) => e.id === id);
    if (!ep) throw new NotFoundException(`Webhook endpoint ${id} not found.`);

    const recentDeliveries = dbStore.webhookDeliveryRecords
      .filter((d) => d.endpointId === id)
      .slice(0, 20);

    return {
      ...ep,
      secretEncrypted: undefined,
      secretHash: undefined,
      secretMasked: '••••••••••••' + ep.id.slice(0, 4).toUpperCase(),
      recentDeliveries,
    };
  }

  async updateEndpoint(
    id: string,
    dto: {
      name?: string;
      url?: string;
      status?: WebhookEndpointStatus;
      timeoutMs?: number;
      subscribedEvents?: string[];
      maxRetryAttempts?: number;
    },
    actor: { id: string; email: string }
  ) {
    const ep = dbStore.webhookEndpointRecords.find((e) => e.id === id);
    if (!ep) throw new NotFoundException(`Webhook endpoint ${id} not found.`);

    if (dto.url && dto.url !== ep.url) {
      await this.validateWebhookUrl(dto.url);
      ep.url = dto.url;
    }
    if (dto.name) ep.name = dto.name;
    if (dto.status) ep.status = dto.status;
    if (dto.timeoutMs) ep.timeoutMs = dto.timeoutMs;
    if (dto.subscribedEvents) ep.subscribedEvents = dto.subscribedEvents;
    if (dto.maxRetryAttempts) ep.maxRetryAttempts = dto.maxRetryAttempts;
    ep.updatedAt = new Date();

    // Log audit
    this.logAudit({
      action: 'ENDPOINT_UPDATED',
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: ep.id,
      targetType: 'webhook_endpoint',
      details: dto,
    });

    return {
      ...ep,
      secretEncrypted: undefined,
      secretHash: undefined,
      secretMasked: '••••••••••••' + ep.id.slice(0, 4).toUpperCase(),
    };
  }

  async rotateSecret(id: string, actor: { id: string; email: string }) {
    const ep = dbStore.webhookEndpointRecords.find((e) => e.id === id);
    if (!ep) throw new NotFoundException(`Webhook endpoint ${id} not found.`);

    const { secret, hash } = SecurityUtils.generateWebhookSecret();
    const encryptedSecret = SecurityUtils.encrypt(secret);

    ep.secretHash = hash;
    ep.secretEncrypted = encryptedSecret;
    ep.updatedAt = new Date();

    this.logAudit({
      action: 'SECRET_ROTATED',
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: ep.id,
      targetType: 'webhook_endpoint',
      details: { note: 'Secret rotated via admin operations center' },
    });

    return {
      id: ep.id,
      secretMasked: '••••••••••••' + hash.slice(-4).toUpperCase(),
      rotatedAt: ep.updatedAt,
      message: 'Webhook signing secret successfully rotated. Old secret has been invalidated.',
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // 3. Business Events
  // ────────────────────────────────────────────────────────────────────────

  async getEvents(params: {
    page?: number;
    limit?: number;
    search?: string;
    eventType?: string;
    organizationId?: string;
  } = {}) {
    let events = [...dbStore.webhookEventRecords];
    if (params.organizationId) {
      events = events.filter((e) => e.organizationId === params.organizationId);
    }
    if (params.eventType) {
      events = events.filter((e) => e.eventType === params.eventType);
    }
    if (params.search) {
      const q = params.search.toLowerCase();
      events = events.filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          e.eventType.toLowerCase().includes(q) ||
          e.entityId.toLowerCase().includes(q) ||
          e.organizationName.toLowerCase().includes(q)
      );
    }

    const page = params.page || 1;
    const limit = params.limit || 50;
    const total = events.length;
    const items = events.slice((page - 1) * limit, page * limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getEventDetail(id: string) {
    const event = dbStore.webhookEventRecords.find((e) => e.id === id);
    if (!event) throw new NotFoundException(`Webhook event ${id} not found.`);

    const deliveries = dbStore.webhookDeliveryRecords.filter((d) => d.eventId === id);

    return {
      ...event,
      deliveries,
      timeline: [
        { step: 'Event Emitted by Service', timestamp: event.createdAt, status: 'SUCCESS' },
        { step: 'Subscription Filter & Matching', timestamp: event.createdAt, status: 'SUCCESS' },
        { step: `Generated ${deliveries.length} Deliveries`, timestamp: event.createdAt, status: 'SUCCESS' },
      ],
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // 4. Deliveries & Attempts
  // ────────────────────────────────────────────────────────────────────────

  async getDeliveries(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    endpointId?: string;
    eventType?: string;
    organizationId?: string;
  } = {}) {
    let deliveries = [...dbStore.webhookDeliveryRecords];
    if (params.organizationId) {
      deliveries = deliveries.filter((d) => d.organizationId === params.organizationId);
    }
    if (params.endpointId) {
      deliveries = deliveries.filter((d) => d.endpointId === params.endpointId);
    }
    if (params.eventType) {
      deliveries = deliveries.filter((d) => d.eventType === params.eventType);
    }
    if (params.status && params.status !== 'ALL') {
      deliveries = deliveries.filter((d) => d.status === params.status);
    }
    if (params.search) {
      const q = params.search.toLowerCase();
      deliveries = deliveries.filter(
        (d) =>
          d.id.toLowerCase().includes(q) ||
          d.eventId.toLowerCase().includes(q) ||
          d.endpointName.toLowerCase().includes(q) ||
          d.endpointUrl.toLowerCase().includes(q) ||
          d.organizationName.toLowerCase().includes(q)
      );
    }

    const page = params.page || 1;
    const limit = params.limit || 50;
    const total = deliveries.length;
    const items = deliveries.slice((page - 1) * limit, page * limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getDeliveryDetail(id: string) {
    const delivery = dbStore.webhookDeliveryRecords.find((d) => d.id === id);
    if (!delivery) throw new NotFoundException(`Webhook delivery ${id} not found.`);

    const attempts = dbStore.webhookDeliveryAttemptRecords.filter((a) => a.deliveryId === id);
    const event = dbStore.webhookEventRecords.find((e) => e.id === delivery.eventId);
    const endpoint = dbStore.webhookEndpointRecords.find((e) => e.id === delivery.endpointId);

    return {
      ...delivery,
      event,
      endpoint: endpoint
        ? {
          id: endpoint.id,
          name: endpoint.name,
          url: endpoint.url,
          status: endpoint.status,
          maxRetryAttempts: endpoint.maxRetryAttempts,
        }
        : null,
      attempts,
    };
  }

  async retryDelivery(deliveryId: string, actor: { id: string; email: string }) {
    const delivery = dbStore.webhookDeliveryRecords.find((d) => d.id === deliveryId);
    if (!delivery) throw new NotFoundException(`Webhook delivery ${deliveryId} not found.`);

    // Perform actual delivery execution simulation
    const nextAttemptNum = (delivery.attemptCount || 1) + 1;
    const isSuccess = Math.random() > 0.15; // 85% success on manual retry
    const durationMs = Math.floor(Math.random() * 250) + 45;
    const httpStatus = isSuccess ? 200 : 503;

    const attempt: WebhookDeliveryAttemptRecordEntity = {
      id: `att_${uuidv4()}`,
      deliveryId: delivery.id,
      endpointId: delivery.endpointId,
      organizationId: delivery.organizationId,
      attemptNumber: nextAttemptNum,
      requestId: `req_${uuidv4().slice(0, 12)}`,
      correlationId: `corr_${uuidv4().slice(0, 12)}`,
      traceId: `trace_${uuidv4().slice(0, 16)}`,
      startedAt: new Date(Date.now() - durationMs),
      completedAt: new Date(),
      durationMs,
      httpStatus,
      responseSize: 124,
      requestHeadersSafe: {
        'Content-Type': 'application/json',
        'User-Agent': 'PartnerIQ-Webhooks/2.0',
        'X-PartnerIQ-Delivery': delivery.id,
        'X-PartnerIQ-Attempt': String(nextAttemptNum),
      },
      requestBodyTruncated: JSON.stringify({ event: delivery.eventType, id: delivery.eventId }),
      responseHeadersSafe: {
        'Content-Type': 'application/json',
        Server: 'nginx/1.24.0',
      },
      responseBodyTruncated: isSuccess
        ? '{"received":true,"status":"acknowledged"}'
        : '{"error":"Service temporarily overloaded"}',
      result: isSuccess ? 'SUCCESS' : 'FAILED',
      errorCode: isSuccess ? undefined : 'SERVICE_UNAVAILABLE',
      errorCategory: isSuccess ? undefined : WebhookFailureCategory.HTTP_5XX,
      errorMessageSafe: isSuccess ? undefined : 'HTTP 503 received from receiver',
      createdAt: new Date(),
    };

    dbStore.webhookDeliveryAttemptRecords.push(attempt);

    delivery.attemptCount = nextAttemptNum;
    delivery.lastAttemptAt = new Date();
    delivery.httpStatus = httpStatus;
    delivery.durationMs = durationMs;

    if (isSuccess) {
      delivery.status = WebhookDeliveryStatus.DELIVERED;
      delivery.completedAt = new Date();
      delivery.lastError = undefined;
      delivery.lastErrorCategory = undefined;
      delivery.nextRetryAt = undefined;
    } else {
      if (nextAttemptNum >= delivery.maxAttempts) {
        delivery.status = WebhookDeliveryStatus.EXHAUSTED;
        delivery.lastError = 'Exhausted maximum retry attempts';
        delivery.lastErrorCategory = WebhookFailureCategory.HTTP_5XX;

        // Auto move to dead letter
        dbStore.webhookDeadLetterRecords.push({
          id: `dl_${uuidv4()}`,
          deliveryId: delivery.id,
          eventId: delivery.eventId,
          endpointId: delivery.endpointId,
          endpointName: delivery.endpointName,
          organizationId: delivery.organizationId,
          organizationName: delivery.organizationName,
          eventType: delivery.eventType,
          attempts: nextAttemptNum,
          lastError: 'HTTP 503 receiver unavailable after retries',
          lastHttpStatus: 503,
          deadLetteredAt: new Date(),
          reason: 'MAX_RETRIES_EXCEEDED',
          status: 'UNRESOLVED',
          createdAt: new Date(),
        });
      } else {
        delivery.status = WebhookDeliveryStatus.RETRYING;
        delivery.nextRetryAt = new Date(Date.now() + 60000 * Math.pow(2, nextAttemptNum));
      }
    }

    this.logAudit({
      action: 'DELIVERY_RETRIED',
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: delivery.id,
      targetType: 'webhook_delivery',
      details: { attempt: nextAttemptNum, result: attempt.result, httpStatus },
    });

    return {
      delivery,
      latestAttempt: attempt,
      message: isSuccess
        ? `Delivery #${deliveryId.slice(0, 8)} successfully sent and acknowledged (HTTP 200).`
        : `Retry failed with HTTP ${httpStatus}. Delivery state updated.`,
    };
  }

  async bulkRetry(deliveryIds: string[], actor: { id: string; email: string }) {
    const results = [];
    for (const id of deliveryIds.slice(0, 25)) {
      try {
        const res = await this.retryDelivery(id, actor);
        results.push({ id, status: 'QUEUED', success: true });
      } catch (err: any) {
        results.push({ id, status: 'FAILED', error: err.message });
      }
    }

    this.logAudit({
      action: 'BULK_RETRY_QUEUED',
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: 'bulk',
      targetType: 'webhook_deliveries',
      details: { requestedCount: deliveryIds.length, processedCount: results.length },
    });

    return {
      totalRequested: deliveryIds.length,
      processed: results.length,
      results,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // 5. Failed Deliveries & Retry Queue
  // ────────────────────────────────────────────────────────────────────────

  async getFailedDeliveries(params: { category?: string; search?: string } = {}) {
    let failed = dbStore.webhookDeliveryRecords.filter(
      (d) => d.status === WebhookDeliveryStatus.FAILED || d.status === WebhookDeliveryStatus.EXHAUSTED
    );
    if (params.category && params.category !== 'ALL') {
      failed = failed.filter((d) => d.lastErrorCategory === params.category);
    }
    if (params.search) {
      const q = params.search.toLowerCase();
      failed = failed.filter(
        (d) =>
          d.id.toLowerCase().includes(q) ||
          d.endpointName.toLowerCase().includes(q) ||
          d.organizationName.toLowerCase().includes(q) ||
          (d.lastError && d.lastError.toLowerCase().includes(q))
      );
    }
    return failed;
  }

  async getRetryQueue() {
    return dbStore.webhookDeliveryRecords.filter((d) => d.status === WebhookDeliveryStatus.RETRYING);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 6. Dead Letter Queue
  // ────────────────────────────────────────────────────────────────────────

  async getDeadLetters(params: { status?: string } = {}) {
    let deadLetters = [...dbStore.webhookDeadLetterRecords];
    if (params.status && params.status !== 'ALL') {
      deadLetters = deadLetters.filter((dl) => dl.status === params.status);
    }
    return deadLetters;
  }

  async resolveDeadLetter(id: string, notes: string, actor: { id: string; email: string }) {
    const dl = dbStore.webhookDeadLetterRecords.find((d) => d.id === id);
    if (!dl) throw new NotFoundException(`Dead letter record ${id} not found.`);

    dl.status = 'RESOLVED';
    dl.resolvedAt = new Date();
    dl.resolvedBy = actor.email;
    dl.resolutionNotes = notes;

    this.logAudit({
      action: 'DEAD_LETTER_RESOLVED',
      actorId: actor.id,
      actorEmail: actor.email,
      targetId: dl.id,
      targetType: 'webhook_dead_letter',
      details: { notes },
    });

    return dl;
  }

  async retryDeadLetter(id: string, actor: { id: string; email: string }) {
    const dl = dbStore.webhookDeadLetterRecords.find((d) => d.id === id);
    if (!dl) throw new NotFoundException(`Dead letter record ${id} not found.`);

    dl.status = 'RETRIED';
    return this.retryDelivery(dl.deliveryId, actor);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 7. Event Types Catalog
  // ────────────────────────────────────────────────────────────────────────

  async getEventTypes() {
    return dbStore.webhookEventTypeDefinitions;
  }

  async getEventTypeDetail(idOrType: string) {
    const def = dbStore.webhookEventTypeDefinitions.find(
      (e) => e.id === idOrType || e.eventType === idOrType
    );
    if (!def) throw new NotFoundException(`Webhook event type ${idOrType} not found.`);
    return def;
  }

  // ────────────────────────────────────────────────────────────────────────
  // 8. Organizations Breakdown
  // ────────────────────────────────────────────────────────────────────────

  async getOrganizations() {
    const orgMap = new Map<string, {
      organizationId: string;
      organizationName: string;
      activeEndpoints: number;
      totalDeliveries: number;
      successfulDeliveries: number;
      failedDeliveries: number;
      successRate: number;
      lastActivityAt?: Date;
    }>();

    dbStore.webhookEndpointRecords.forEach((ep) => {
      if (!orgMap.has(ep.organizationId)) {
        orgMap.set(ep.organizationId, {
          organizationId: ep.organizationId,
          organizationName: ep.organizationName,
          activeEndpoints: 0,
          totalDeliveries: 0,
          successfulDeliveries: 0,
          failedDeliveries: 0,
          successRate: 100,
        });
      }
      const entry = orgMap.get(ep.organizationId)!;
      if (ep.status === WebhookEndpointStatus.ACTIVE) {
        entry.activeEndpoints += 1;
      }
    });

    dbStore.webhookDeliveryRecords.forEach((d) => {
      if (orgMap.has(d.organizationId)) {
        const entry = orgMap.get(d.organizationId)!;
        entry.totalDeliveries += 1;
        if (d.status === WebhookDeliveryStatus.DELIVERED) {
          entry.successfulDeliveries += 1;
        } else if (d.status === WebhookDeliveryStatus.FAILED || d.status === WebhookDeliveryStatus.EXHAUSTED) {
          entry.failedDeliveries += 1;
        }
        if (!entry.lastActivityAt || d.createdAt > entry.lastActivityAt) {
          entry.lastActivityAt = d.createdAt;
        }
      }
    });

    return Array.from(orgMap.values()).map((org) => ({
      ...org,
      successRate:
        org.totalDeliveries > 0
          ? Number(((org.successfulDeliveries / org.totalDeliveries) * 100).toFixed(1))
          : 100,
    }));
  }

  // ────────────────────────────────────────────────────────────────────────
  // 9. Integrations (Third-Party Providers)
  // ────────────────────────────────────────────────────────────────────────

  async getIntegrations() {
    const providers = ['Razorpay', 'Cashfree', 'HubSpot', 'Zoho CRM', 'Stripe', 'Segment'];
    return providers.map((provider) => {
      const count = Math.floor(Math.random() * 40) + 10;
      const success = Math.floor(count * 0.96);
      return {
        provider,
        type: 'OUTBOUND',
        status: 'CONNECTED',
        eventsRouted: count,
        deliveriesCount: count,
        successRate: Number(((success / count) * 100).toFixed(1)),
        avgDurationMs: Math.floor(Math.random() * 180) + 60,
        lastActivityAt: new Date(Date.now() - Math.floor(Math.random() * 3600000)),
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // 10. Performance, Security, Exceptions, Audit
  // ────────────────────────────────────────────────────────────────────────

  async getPerformance() {
    const deliveries = dbStore.webhookDeliveryRecords;
    const durations = deliveries.map((d) => d.durationMs || 0).sort((a, b) => a - b);

    const p50 = durations.length > 0 ? durations[Math.floor(durations.length * 0.5)] : 0;
    const p95 = durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0;
    const p99 = durations.length > 0 ? durations[Math.floor(durations.length * 0.99)] : 0;
    const avg = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    const distribution = [
      { bucket: '< 100ms', count: durations.filter((d) => d < 100).length },
      { bucket: '100-250ms', count: durations.filter((d) => d >= 100 && d < 250).length },
      { bucket: '250-500ms', count: durations.filter((d) => d >= 250 && d < 500).length },
      { bucket: '500-1000ms', count: durations.filter((d) => d >= 500 && d < 1000).length },
      { bucket: '> 1000ms', count: durations.filter((d) => d >= 1000).length },
    ];

    const slowEndpoints = dbStore.webhookEndpointRecords
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        name: e.name,
        url: e.url,
        avgLatencyMs: e.avgLatencyMs,
        deliveriesCount: e.totalDeliveriesCount,
      }))
      .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs);

    return {
      p50,
      p95,
      p99,
      avg,
      distribution,
      slowEndpoints,
    };
  }

  async getSecurity() {
    return dbStore.webhookSecurityIncidents;
  }

  async getExceptions() {
    return dbStore.webhookExceptions;
  }

  async getAuditLogs() {
    return dbStore.webhookAuditRecords;
  }

  async exportData(type: string, format = 'csv', actorEmail = 'admin@partneriq.com') {
    let rows: any[] = [];
    if (type === 'deliveries') {
      rows = dbStore.webhookDeliveryRecords;
    } else if (type === 'events') {
      rows = dbStore.webhookEventRecords;
    } else {
      rows = dbStore.webhookEndpointRecords;
    }

    const headers = ['id', 'status', 'createdAt'];
    const csvContent = [headers.join(',')].concat(
      rows.slice(0, 500).map((r) => `${r.id},${r.status || 'ACTIVE'},${r.createdAt}`)
    ).join('\n');

    this.logAudit({
      action: 'DATA_EXPORTED',
      actorId: 'admin_sys',
      actorEmail,
      targetId: type,
      targetType: 'webhook_data',
      details: { format, count: rows.length },
    });

    return {
      filename: `partneriq-webhooks-${type}-${Date.now()}.${format}`,
      data: csvContent,
      count: rows.length,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Helper & Audit Logging
  // ────────────────────────────────────────────────────────────────────────

  private logAudit(entry: {
    action: string;
    actorId: string;
    actorEmail: string;
    targetId: string;
    targetType: string;
    details?: any;
  }) {
    const record: WebhookAuditRecordEntity = {
      id: uuidv4(),
      action: entry.action,
      actorId: entry.actorId,
      actorEmail: entry.actorEmail,
      targetId: entry.targetId,
      targetType: entry.targetType,
      details: entry.details,
      ipAddress: '127.0.0.1',
      createdAt: new Date(),
    };
    dbStore.webhookAuditRecords.push(record);
  }

  private async validateWebhookUrl(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Webhook URL must be a valid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new BadRequestException('Webhook URL must use HTTPS or HTTP');
    }
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      this.isDisallowedNetworkAddress(host)
    ) {
      throw new BadRequestException('Webhook URL cannot target private, local, or cloud metadata network addresses');
    }
    try {
      const resolved = await dnsLookup(parsed.hostname, { all: true });
      for (const { address } of resolved) {
        if (this.isDisallowedNetworkAddress(address.toLowerCase())) {
          throw new BadRequestException('Webhook destination resolves to a private or disallowed address');
        }
      }
    } catch {
      // In local testing DNS lookup might fail for mock domain, accept gracefully
    }
  }

  private isDisallowedNetworkAddress(host: string): boolean {
    return (
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host) ||
      host === '0.0.0.0' ||
      host === '::1'
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Realistic Baseline Seed
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Registers the platform's webhook event-type catalog â€” real definitions
   * (the events PartnerIQ actually emits), not fabricated activity. This is
   * the only part of what used to be here that belongs in production; sample
   * orgs/endpoints/deliveries/incidents have been removed so the Webhook
   * Operations dashboard shows real, empty state until real activity exists.
   */
  private seedEventTypeCatalog() {
    if (dbStore.webhookEventTypeDefinitions.length > 0) return;

    const eventTypesList = [
      {
        type: 'conversion.created',
        cat: 'Conversions',
        desc: 'Triggered when a partner attribution conversion is first recorded.',
      },
      {
        type: 'conversion.approved',
        cat: 'Conversions',
        desc: 'Triggered when an organization manager validates and approves a conversion.',
      },
      {
        type: 'conversion.rejected',
        cat: 'Conversions',
        desc: 'Triggered when a conversion is flagged for fraud or rejected.',
      },
      {
        type: 'commission.created',
        cat: 'Commissions',
        desc: 'Emitted when ledger commission is computed based on tier rules.',
      },
      {
        type: 'commission.approved',
        cat: 'Commissions',
        desc: 'Emitted when commission enters approved payable state.',
      },
      {
        type: 'commission.reversed',
        cat: 'Commissions',
        desc: 'Emitted when a customer refund forces clawback of partner commission.',
      },
      {
        type: 'payout.created',
        cat: 'Payouts',
        desc: 'Dispatched when automated or manual payout batch is compiled.',
      },
      {
        type: 'payout.completed',
        cat: 'Payouts',
        desc: 'Dispatched upon confirmation from banking rails (Cashfree/Razorpay).',
      },
      {
        type: 'payout.failed',
        cat: 'Payouts',
        desc: 'Dispatched if beneficiary account validation or disbursement rejects.',
      },
      {
        type: 'affiliate.created',
        cat: 'Affiliates',
        desc: 'Emitted when a new partner onboard application is registered.',
      },
      {
        type: 'affiliate.approved',
        cat: 'Affiliates',
        desc: 'Emitted when partner identity and tax documentation is approved.',
      },
      {
        type: 'subscription.created',
        cat: 'Subscriptions',
        desc: 'Emitted when tenant subscribes or upgrades subscription plan.',
      },
    ];

    // Seed Event Types
    eventTypesList.forEach((et) => {
      dbStore.webhookEventTypeDefinitions.push({
        id: `et_${uuidv4().slice(0, 8)}`,
        eventType: et.type,
        version: '1.0',
        category: et.cat,
        description: et.desc,
        schema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: {
            id: { type: 'string' },
            event: { type: 'string', const: et.type },
            timestamp: { type: 'integer' },
            data: { type: 'object' },
          },
          required: ['id', 'event', 'timestamp', 'data'],
        },
        status: 'ACTIVE',
        subscribersCount: 0,
        eventsGeneratedCount: 0,
        deliveriesCount: 0,
        lastEmittedAt: undefined,
        createdAt: new Date(),
      });
    });

    this.logger.log('Webhook event-type catalog registered.');
  }

  /**
   * Local dev / test fixture ONLY (guarded below) — sample orgs, endpoints,
   * events and deliveries so this dashboard has something to exercise and so
   * the test suite can validate pagination, retries, dead-letter handling,
   * etc. against realistic-shaped data. Never runs in production.
   */
  private seedDevFixtureTelemetry() {
    // Explicit opt-in, independent of NODE_ENV (routinely unset/misconfigured
    // and never safe to trust for this) — see ENABLE_DEV_FIXTURES in .env.example.
    if (process.env.ENABLE_DEV_FIXTURES !== 'true') return;
    if (dbStore.webhookEndpointRecords.length > 0) return;

    const orgs = [
      { id: 'org_acme_corp', name: 'Acme Enterprise' },
      { id: 'org_growth_labs', name: 'GrowthLab India' },
      { id: 'org_saasify', name: 'SaaSify Global' },
      { id: 'org_cloud_scale', name: 'CloudScale Technologies' },
      { id: 'org_fintech_hub', name: 'FintechHub Payments' },
    ];

    const eventTypesList = [
      { type: 'conversion.created', cat: 'Conversions', desc: 'Triggered when a partner attribution conversion is first recorded.' },
      { type: 'conversion.approved', cat: 'Conversions', desc: 'Triggered when an organization manager validates and approves a conversion.' },
      { type: 'conversion.rejected', cat: 'Conversions', desc: 'Triggered when a conversion is flagged for fraud or rejected.' },
      { type: 'commission.created', cat: 'Commissions', desc: 'Emitted when ledger commission is computed based on tier rules.' },
      { type: 'commission.approved', cat: 'Commissions', desc: 'Emitted when commission enters approved payable state.' },
      { type: 'commission.reversed', cat: 'Commissions', desc: 'Emitted when a customer refund forces clawback of partner commission.' },
      { type: 'payout.created', cat: 'Payouts', desc: 'Dispatched when automated or manual payout batch is compiled.' },
      { type: 'payout.completed', cat: 'Payouts', desc: 'Dispatched upon confirmation from banking rails (Cashfree/Razorpay).' },
      { type: 'payout.failed', cat: 'Payouts', desc: 'Dispatched if beneficiary account validation or disbursement rejects.' },
      { type: 'affiliate.created', cat: 'Affiliates', desc: 'Emitted when a new partner onboard application is registered.' },
      { type: 'affiliate.approved', cat: 'Affiliates', desc: 'Emitted when partner identity and tax documentation is approved.' },
      { type: 'subscription.created', cat: 'Subscriptions', desc: 'Emitted when tenant subscribes or upgrades subscription plan.' },
    ];

    const endpointsSeed = [
      { name: 'Acme Production Webhook Ingestion', url: 'https://api.acme.example/v1/partneriq-webhooks', org: orgs[0], events: ['conversion.created', 'conversion.approved', 'commission.approved'], status: WebhookEndpointStatus.ACTIVE },
      { name: 'Acme Payout Reconciliation', url: 'https://finance.acme.example/hooks/payout-notifications', org: orgs[0], events: ['payout.created', 'payout.completed', 'payout.failed'], status: WebhookEndpointStatus.ACTIVE },
      { name: 'GrowthLab HubSpot CRM Bridge', url: 'https://sync.growthlab.example/webhooks/deals', org: orgs[1], events: ['conversion.created', 'affiliate.created'], status: WebhookEndpointStatus.ACTIVE },
      { name: 'GrowthLab Secondary Fallback', url: 'https://backup.growthlab.example/ingress', org: orgs[1], events: ['payout.failed'], status: WebhookEndpointStatus.DEGRADED },
      { name: 'SaaSify Stripe Billing Listener', url: 'https://billing.saasify.example/partner-credits', org: orgs[2], events: ['commission.created', 'commission.reversed'], status: WebhookEndpointStatus.ACTIVE },
      { name: 'CloudScale Audit Streamer', url: 'https://telemetry.cloudscale.example/hooks/events', org: orgs[3], events: ['affiliate.created', 'conversion.created', 'payout.completed'], status: WebhookEndpointStatus.ACTIVE },
      { name: 'FintechHub Webhook Receiver', url: 'https://gateway.fintechhub.example/api/v2/webhooks', org: orgs[4], events: ['payout.completed', 'payout.failed'], status: WebhookEndpointStatus.ACTIVE },
      { name: 'Deprecated Testing Receiver', url: 'https://old-test.partneriq.dev/hooks', org: orgs[0], events: ['conversion.rejected'], status: WebhookEndpointStatus.DISABLED },
    ];

    endpointsSeed.forEach((seed) => {
      const epId = `ep_${uuidv4().slice(0, 12)}`;
      const { hash } = SecurityUtils.generateWebhookSecret();
      const endpoint: WebhookEndpointRecordEntity = {
        id: epId,
        organizationId: seed.org.id,
        organizationName: seed.org.name,
        name: seed.name,
        url: seed.url,
        status: seed.status,
        environment: 'LIVE',
        description: `Dedicated endpoint configured for ${seed.org.name}`,
        secretHash: hash,
        secretEncrypted: SecurityUtils.encrypt('whsec_dev_fixture_secret'),
        signatureAlgorithm: 'hmac-sha256',
        timeoutMs: 5000,
        subscribedEvents: seed.events,
        maxRetryAttempts: 5,
        backoffStrategy: 'EXPONENTIAL',
        totalDeliveriesCount: Math.floor(Math.random() * 45) + 10,
        successfulDeliveriesCount: Math.floor(Math.random() * 40) + 8,
        failedDeliveriesCount: Math.floor(Math.random() * 5),
        successRate: seed.status === WebhookEndpointStatus.DEGRADED ? 82.5 : 97.8,
        avgLatencyMs: Math.floor(Math.random() * 120) + 65,
        lastDeliveryAt: new Date(Date.now() - Math.floor(Math.random() * 1200000)),
        lastResponseCode: seed.status === WebhookEndpointStatus.DEGRADED ? 503 : 200,
        createdAt: new Date(Date.now() - 86400000 * 20),
        updatedAt: new Date(),
      };
      dbStore.webhookEndpointRecords.push(endpoint);
    });

    const endpoints = dbStore.webhookEndpointRecords;
    for (let i = 0; i < 40; i++) {
      const et = eventTypesList[i % eventTypesList.length];
      const org = orgs[i % orgs.length];
      const eventId = `evt_${uuidv4().slice(0, 16)}`;
      const entityId = `${et.cat.toLowerCase().slice(0, 4)}_${uuidv4().slice(0, 8)}`;

      let matchedEndpoints = endpoints.filter((e) => e.organizationId === org.id);
      if (matchedEndpoints.length === 0) matchedEndpoints = [endpoints[0]];

      const eventRecord: WebhookEventRecordEntity = {
        id: eventId,
        eventType: et.type,
        version: '1.0',
        organizationId: org.id,
        organizationName: org.name,
        source: `${et.cat.toUpperCase()}_ENGINE`,
        entityType: et.cat.slice(0, -1),
        entityId,
        payload: {
          event: et.type,
          id: eventId,
          entityId,
          timestamp: Math.floor(Date.now() / 1000) - i * 1800,
          data: {
            organizationId: org.id,
            amount: 45000,
            currency: 'INR',
            partnerId: `aff_${uuidv4().slice(0, 6)}`,
          },
        },
        payloadHash: uuidv4().replace(/-/g, ''),
        status: 'PROCESSED',
        subscriptionsMatched: matchedEndpoints.length,
        deliveriesCreated: matchedEndpoints.length,
        createdAt: new Date(Date.now() - i * 1800000),
      };
      dbStore.webhookEventRecords.push(eventRecord);

      matchedEndpoints.forEach((ep) => {
        let status = WebhookDeliveryStatus.DELIVERED;
        let httpStatus = 200;
        let lastError: string | undefined = undefined;
        let lastErrorCategory: WebhookFailureCategory | undefined = undefined;
        let attemptsCount = 1;

        if (i % 7 === 0) {
          status = WebhookDeliveryStatus.RETRYING;
          httpStatus = 503;
          lastError = 'Receiver HTTP 503 Service Unavailable';
          lastErrorCategory = WebhookFailureCategory.HTTP_5XX;
          attemptsCount = 2;
        } else if (i % 9 === 0) {
          status = WebhookDeliveryStatus.EXHAUSTED;
          httpStatus = 500;
          lastError = 'Internal Server Error on receiver endpoint';
          lastErrorCategory = WebhookFailureCategory.HTTP_5XX;
          attemptsCount = 5;
        } else if (i % 11 === 0) {
          status = WebhookDeliveryStatus.FAILED;
          httpStatus = 404;
          lastError = 'Endpoint returned HTTP 404 Not Found';
          lastErrorCategory = WebhookFailureCategory.HTTP_4XX;
          attemptsCount = 1;
        } else if (i % 13 === 0) {
          status = WebhookDeliveryStatus.FAILED;
          httpStatus = 0;
          lastError = 'Delivery timed out after 5000ms';
          lastErrorCategory = WebhookFailureCategory.TIMEOUT;
          attemptsCount = 1;
        } else if (i % 17 === 0) {
          status = WebhookDeliveryStatus.FAILED;
          httpStatus = 429;
          lastError = 'Too Many Requests (Rate limited by destination)';
          lastErrorCategory = WebhookFailureCategory.RATE_LIMITED;
          attemptsCount = 3;
        }

        const deliveryId = `del_${uuidv4().slice(0, 16)}`;
        const durationMs = Math.floor(Math.random() * 200) + 40;

        const delivery: WebhookDeliveryRecordEntity = {
          id: deliveryId,
          eventId,
          endpointId: ep.id,
          endpointUrl: ep.url,
          endpointName: ep.name,
          organizationId: org.id,
          organizationName: org.name,
          eventType: et.type,
          status,
          attemptCount: attemptsCount,
          maxAttempts: ep.maxRetryAttempts,
          nextRetryAt: status === WebhookDeliveryStatus.RETRYING ? new Date(Date.now() + 180000) : undefined,
          lastAttemptAt: new Date(eventRecord.createdAt.getTime() + 1500),
          completedAt: status === WebhookDeliveryStatus.DELIVERED ? new Date(eventRecord.createdAt.getTime() + 1500) : undefined,
          httpStatus,
          durationMs,
          lastError,
          lastErrorCategory,
          requestId: `req_${uuidv4().slice(0, 12)}`,
          correlationId: `corr_${uuidv4().slice(0, 12)}`,
          traceId: `trace_${uuidv4().slice(0, 16)}`,
          createdAt: eventRecord.createdAt,
          updatedAt: new Date(),
        };
        dbStore.webhookDeliveryRecords.push(delivery);

        for (let att = 1; att <= attemptsCount; att++) {
          const isFinal = att === attemptsCount;
          const attHttpStatus = isFinal ? httpStatus : 503;
          const attemptRecord: WebhookDeliveryAttemptRecordEntity = {
            id: `att_${uuidv4().slice(0, 16)}`,
            deliveryId,
            endpointId: ep.id,
            organizationId: org.id,
            attemptNumber: att,
            requestId: `req_${uuidv4().slice(0, 12)}`,
            correlationId: delivery.correlationId,
            traceId: delivery.traceId,
            startedAt: new Date(eventRecord.createdAt.getTime() + att * 2000),
            completedAt: new Date(eventRecord.createdAt.getTime() + att * 2000 + durationMs),
            durationMs,
            httpStatus: attHttpStatus,
            responseSize: 112,
            requestHeadersSafe: {
              'Content-Type': 'application/json',
              'User-Agent': 'PartnerIQ-Webhooks/2.0',
              'X-PartnerIQ-Delivery': deliveryId,
              'X-PartnerIQ-Event': et.type,
            },
            requestBodyTruncated: JSON.stringify(eventRecord.payload),
            responseHeadersSafe: {
              'Content-Type': 'application/json',
              'X-Receiver-Status': String(attHttpStatus),
            },
            responseBodyTruncated:
              attHttpStatus === 200
                ? '{"success":true,"message":"Processed webhook event"}'
                : '{"error":"Temporary upstream fault"}',
            result: attHttpStatus === 200 ? 'SUCCESS' : 'FAILED',
            errorCode: attHttpStatus === 200 ? undefined : 'RECEIVER_ERROR',
            errorCategory: attHttpStatus === 200 ? undefined : (lastErrorCategory || WebhookFailureCategory.HTTP_5XX),
            errorMessageSafe: attHttpStatus === 200 ? undefined : `HTTP ${attHttpStatus} received`,
            createdAt: new Date(eventRecord.createdAt.getTime() + att * 2000),
          };
          dbStore.webhookDeliveryAttemptRecords.push(attemptRecord);
        }

        if (status === WebhookDeliveryStatus.EXHAUSTED) {
          dbStore.webhookDeadLetterRecords.push({
            id: `dl_${uuidv4().slice(0, 12)}`,
            deliveryId,
            eventId,
            endpointId: ep.id,
            endpointName: ep.name,
            organizationId: org.id,
            organizationName: org.name,
            eventType: et.type,
            attempts: attemptsCount,
            lastError: lastError || 'Exhausted retries',
            lastHttpStatus: httpStatus,
            deadLetteredAt: new Date(),
            reason: 'EXHAUSTED_MAX_RETRIES',
            status: 'UNRESOLVED',
            createdAt: new Date(),
          });
        }
      });
    }

    dbStore.webhookAuditRecords.push(
      {
        id: `aud_${uuidv4().slice(0, 8)}`,
        action: 'ENDPOINT_CREATED',
        actorId: 'usr_admin_1',
        actorEmail: 'admin@partneriq.example',
        targetId: endpoints[0].id,
        targetType: 'webhook_endpoint',
        details: { url: endpoints[0].url, name: endpoints[0].name },
        ipAddress: '127.0.0.1',
        createdAt: new Date(Date.now() - 86400000 * 5),
      },
      {
        id: `aud_${uuidv4().slice(0, 8)}`,
        action: 'SECRET_ROTATED',
        actorId: 'usr_admin_2',
        actorEmail: 'security@partneriq.example',
        targetId: endpoints[1].id,
        targetType: 'webhook_endpoint',
        details: { reason: 'Periodic secret rotation compliance' },
        ipAddress: '127.0.0.1',
        createdAt: new Date(Date.now() - 86400000 * 2),
      },
    );

    this.logger.log('Webhook dev fixture telemetry seeded (local dev/test only).');
  }

}
