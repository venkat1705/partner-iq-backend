import { createHmac, timingSafeEqual } from 'node:crypto';

const VERSION = '0.1.0';

export interface PartnerIQRequestOptions {
  idempotencyKey?: string;
}

export interface ConversionCreateRequest {
  externalId: string;
  customerExternalId: string;
  amount: number;
  currency: string;
  type?: 'PURCHASE' | 'SUBSCRIPTION_RENEWAL' | string;
  occurredAt?: string;
  attributionId?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundCreateRequest {
  externalId?: string;
  refundExternalId?: string;
  amount?: number;
  reason?: string;
}

export interface IdentifyCustomerRequest {
  customerId: string;
  attributionId?: string;
  anonymousId?: string;
}

export interface AttachOrderRequest {
  attributionId: string;
  provider: 'RAZORPAY' | 'CASHFREE' | 'JUSPAY' | 'CUSTOM';
  externalOrderId: string;
  amount: number;
  currency: string;
}

export interface TrackingLinkCreateRequest {
  programId: string;
  affiliateId: string;
  destinationUrl: string;
  campaignId?: string;
  customCode?: string;
}

export interface WebhookEndpointCreateRequest {
  url: string;
  subscribedEvents: string[];
}

export interface PartnerIQOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export class PartnerIQError extends Error {
  code: string;
  status: number;
  requestId?: string;
  details?: unknown;

  constructor(message: string, options: { code?: string; status?: number; requestId?: string; details?: unknown } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || 'PARTNERIQ_ERROR';
    this.status = options.status || 0;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export class PartnerIQAuthenticationError extends PartnerIQError {}
export class PartnerIQValidationError extends PartnerIQError {}
export class PartnerIQRateLimitError extends PartnerIQError {}
export class PartnerIQConflictError extends PartnerIQError {}
export class PartnerIQApiError extends PartnerIQError {}

type RequestConfig = RequestInit & { idempotencyKey?: string; retryUnsafe?: boolean };

export class PartnerIQ {
  readonly baseUrl: string;
  readonly timeout: number;
  readonly maxRetries: number;
  private readonly apiKey: string;

  readonly conversions = {
    create: (body: ConversionCreateRequest, options?: PartnerIQRequestOptions) => {
      const idempotencyKey = options?.idempotencyKey || (body.externalId ? `conversion:${body.externalId}` : undefined);
      return this.request('/api/v1/conversions', { method: 'POST', body: JSON.stringify(body), idempotencyKey });
    },
    get: (id: string) => this.request(`/api/v1/conversions/${encodeURIComponent(id)}`),
    refund: (body: RefundCreateRequest & { externalId: string }, options?: PartnerIQRequestOptions) =>
      this.request(`/api/v1/conversions/${encodeURIComponent(body.externalId)}/refund`, {
        method: 'POST',
        body: JSON.stringify(body),
        idempotencyKey: options?.idempotencyKey || (body.refundExternalId ? `refund:${body.refundExternalId}` : undefined),
      }),
  };

  readonly customers = {
    identify: (body: IdentifyCustomerRequest) =>
      this.request('/api/v1/customers/identify', { method: 'POST', body: JSON.stringify(body) }),
  };

  readonly attributions = {
    attachOrder: (body: AttachOrderRequest, options?: PartnerIQRequestOptions) =>
      this.request('/api/v1/attributions/attach-order', {
        method: 'POST',
        body: JSON.stringify(body),
        idempotencyKey: options?.idempotencyKey || `order:${body.provider}:${body.externalOrderId}`,
      }),
  };

  readonly trackingLinks = {
    create: (body: TrackingLinkCreateRequest) =>
      this.request('/api/v1/tracking-links', { method: 'POST', body: JSON.stringify(body) }),
  };

  readonly programs = {
    list: (params?: { limit?: number; cursor?: string }) => this.request(`/api/v1/programs${this.query(params)}`),
  };

  readonly affiliates = {
    get: (id: string) => this.request(`/api/v1/affiliates/${encodeURIComponent(id)}`),
  };

  readonly webhooks = {
    endpoints: {
      create: (body: WebhookEndpointCreateRequest) =>
        this.request('/api/v1/webhook-endpoints', { method: 'POST', body: JSON.stringify(body) }),
      list: () => this.request('/api/v1/webhook-endpoints'),
    },
    verifySignature: verifyWebhookSignature,
  };

  constructor(options: PartnerIQOptions) {
    if (!options.apiKey) throw new PartnerIQAuthenticationError('PartnerIQ apiKey is required');
    if (!/^pi_(test|live)_sk_/.test(options.apiKey)) {
      throw new PartnerIQAuthenticationError('Use a secret key with pi_test_sk_ or pi_live_sk_ prefix');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
    this.timeout = options.timeout || 10000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  async request(path: string, config: RequestConfig = {}) {
    const method = (config.method || 'GET').toUpperCase();
    const idempotencyKey = config.idempotencyKey;
    const retryUnsafe = Boolean(idempotencyKey || config.retryUnsafe);
    let attempt = 0;

    for (;;) {
      try {
        return await this.fetchOnce(path, config, idempotencyKey);
      } catch (error) {
        const err = normalizeError(error);
        const retryableStatus = [429, 502, 503, 504].includes(err.status);
        const canRetry = attempt < this.maxRetries && retryableStatus && (method === 'GET' || retryUnsafe);
        if (!canRetry) throw err;
        await sleep(backoff(attempt++));
      }
    }
  }

  private async fetchOnce(path: string, config: RequestConfig, idempotencyKey?: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    const headers = new Headers(config.headers);
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    headers.set('Content-Type', 'application/json');
    headers.set('PartnerIQ-Client', 'node');
    headers.set('PartnerIQ-Client-Version', VERSION);
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...config, headers, signal: controller.signal });
      const requestId = response.headers.get('x-request-id') || undefined;
      const body = await parseBody(response);
      if (!response.ok) throw toPartnerIQError(response.status, body, requestId);
      return body?.data ?? body;
    } finally {
      clearTimeout(timeout);
    }
  }

  private query(params?: Record<string, string | number | undefined>) {
    if (!params) return '';
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) search.set(key, String(value));
    });
    const value = search.toString();
    return value ? `?${value}` : '';
  }
}

export function verifyWebhookSignature(input: {
  rawBody: string;
  secret: string;
  signature: string;
  timestamp?: string | number;
  toleranceSeconds?: number;
}): boolean {
  if (!input || typeof input !== 'object') return false;
  if (!input.secret || typeof input.secret !== 'string') return false;
  if (!input.signature || typeof input.signature !== 'string') return false;
  if (typeof input.rawBody !== 'string') return false;

  let timestamp = input.timestamp !== undefined ? Number(input.timestamp) : NaN;
  let signature = input.signature.trim();

  // Support Stripe/PartnerIQ header format: "t=1700000000,v1=abcdef..."
  if (signature.includes(',')) {
    const parts = signature.split(',');
    for (const part of parts) {
      const [k, v] = part.split('=');
      if (k && v) {
        if (k.trim() === 't' && Number.isNaN(timestamp)) timestamp = Number(v.trim());
        if (k.trim() === 'v1') signature = v.trim();
      }
    }
  } else if (signature.startsWith('v1=')) {
    signature = signature.replace(/^v1=/, '');
  }

  const tolerance = input.toleranceSeconds ?? 300;
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > tolerance) {
    return false;
  }

  try {
    const expected = createHmac('sha256', input.secret).update(`${timestamp}.${input.rawBody}`).digest('hex');
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

async function parseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toPartnerIQError(status: number, body: any, requestId?: string) {
  const error = body?.error || {};
  const options = { code: error.code, status, requestId: error.requestId || requestId, details: error.details };
  if (status === 401) return new PartnerIQAuthenticationError(error.message || 'Authentication failed', options);
  if (status === 400 || status === 422) return new PartnerIQValidationError(error.message || 'Validation failed', options);
  if (status === 409) return new PartnerIQConflictError(error.message || 'Conflict', options);
  if (status === 429) return new PartnerIQRateLimitError(error.message || 'Rate limit exceeded', options);
  return new PartnerIQApiError(error.message || `PartnerIQ request failed with ${status}`, options);
}

function normalizeError(error: unknown) {
  if (error instanceof PartnerIQError) return error;
  const message = error instanceof Error ? error.message : 'Network request failed';
  return new PartnerIQApiError(message, { code: 'NETWORK_ERROR', status: 0 });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number) {
  return Math.min(2000, 150 * 2 ** attempt) + Math.floor(Math.random() * 100);
}

export default PartnerIQ;
