import * as crypto from 'crypto';

export interface PartnerIQOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface CreateConversionParams {
  externalId: string;
  customerExternalId: string;
  amount: number; // in cents or currency minor unit
  currency?: string;
  productId?: string;
  programId?: string;
  affiliateId?: string;
  attributionId?: string;
  metadata?: Record<string, any>;
  occurredAt?: string;
}

export interface RefundConversionParams {
  amount?: number;
  reason?: string;
}

export interface CaptureClickParams {
  affiliateCode: string;
  userAgent?: string;
  ipAddress?: string;
  landingPageUrl?: string;
}

export interface IdentifyCustomerParams {
  customerId: string;
  attributionId?: string;
  email?: string;
  name?: string;
  metadata?: Record<string, any>;
}

export interface AttachOrderParams {
  attributionId: string;
  provider: 'RAZORPAY' | 'CASHFREE' | 'JUSPAY' | 'STRIPE' | 'CUSTOM';
  externalOrderId: string;
  amount: number;
  currency: string;
  metadata?: Record<string, any>;
}

export interface CreateTrackingLinkParams {
  programId: string;
  affiliateId: string;
  destinationUrl: string;
  campaignId?: string;
  customCode?: string;
}

export interface CreateWebhookEndpointParams {
  url: string;
  subscribedEvents: string[];
}

export class PartnerIQError extends Error {
  public statusCode?: number;
  public details?: any;

  constructor(message: string, statusCode?: number, details?: any) {
    super(message);
    this.name = 'PartnerIQError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ProgramsResource {
  constructor(private readonly client: PartnerIQ) {}

  /**
   * List all partner programs visible to this API key organization.
   */
  async list() {
    return this.client.request('/api/v1/programs', {
      method: 'GET',
    });
  }
}

export class AffiliatesResource {
  constructor(private readonly client: PartnerIQ) {}

  /**
   * Fetch affiliate details and tier status by ID.
   */
  async get(affiliateId: string) {
    return this.client.request(`/api/v1/affiliates/${affiliateId}`, {
      method: 'GET',
    });
  }
}

export class CustomersResource {
  constructor(private readonly client: PartnerIQ) {}

  /**
   * Identify customer and attach to attribution session.
   */
  async identify(params: IdentifyCustomerParams) {
    return this.client.request('/api/v1/customers/identify', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }
}

export class AttributionsResource {
  constructor(private readonly client: PartnerIQ) {}

  /**
   * Attach a payment provider checkout order to an attribution session.
   */
  async attachOrder(params: AttachOrderParams) {
    return this.client.request('/api/v1/attributions/attach-order', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }
}

export class ConversionsResource {
  constructor(private readonly client: PartnerIQ) {}

  /**
   * Track a customer conversion/order event with automatic API key authentication & idempotency.
   */
  async track(params: CreateConversionParams, options?: { idempotencyKey?: string }) {
    const headers: Record<string, string> = {};
    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    return this.client.request('/api/v1/conversions', {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
  }

  /**
   * List conversions for an organization.
   */
  async list(organizationId: string) {
    return this.client.request(`/api/v1/organizations/${organizationId}/conversions`, {
      method: 'GET',
    });
  }

  /**
   * Get conversion status by PartnerIQ conversion ID or external order ID.
   */
  async get(conversionId: string) {
    return this.client.request(`/api/v1/conversions/${conversionId}`, {
      method: 'GET',
    });
  }

  /**
   * Process a full/partial refund and trigger automatic commission clawback in double-entry ledger.
   */
  async refund(conversionId: string, params?: RefundConversionParams) {
    return this.client.request(`/api/v1/conversions/${conversionId}/refund`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }
}

export class TrackingResource {
  constructor(private readonly client: PartnerIQ) {}

  /**
   * Create a tracking link via secret API key.
   */
  async createLink(params: CreateTrackingLinkParams) {
    return this.client.request('/api/v1/tracking-links', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Log an incoming affiliate click or server-side referral redirect.
   */
  async captureClick(params: CaptureClickParams) {
    return this.client.request(`/r/${params.affiliateCode}`, {
      method: 'GET',
    });
  }
}

export class WebhooksResource {
  constructor(private readonly client?: PartnerIQ) {}

  /**
   * List configured outgoing webhook endpoints.
   */
  async list() {
    if (!this.client) throw new PartnerIQError('Webhooks client instance required for list()');
    return this.client.request('/api/v1/webhook-endpoints', {
      method: 'GET',
    });
  }

  /**
   * Create a new outgoing webhook endpoint.
   */
  async createEndpoint(params: CreateWebhookEndpointParams) {
    if (!this.client) throw new PartnerIQError('Webhooks client instance required for createEndpoint()');
    return this.client.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Verify an incoming PartnerIQ webhook HMAC SHA-256 signature.
   * Supports `t=...,v1=...` format or standalone signatures with optional timestamp header.
   */
  verifySignature(rawBody: string, signatureHeader: string, secret: string, timestampHeader?: string | number): boolean {
    if (!rawBody || !signatureHeader || !secret) {
      return false;
    }

    try {
      let timestamp = timestampHeader ? String(timestampHeader) : '';
      let signature = signatureHeader;

      if (signatureHeader.includes(',')) {
        const parts = signatureHeader.split(',');
        for (const part of parts) {
          const [key, value] = part.split('=');
          if (key && value) {
            if (key.trim() === 't') timestamp = value.trim();
            if (key.trim() === 'v1') signature = value.trim();
          }
        }
      } else if (signatureHeader.startsWith('v1=')) {
        signature = signatureHeader.replace(/^v1=/, '');
      }

      if (!timestamp) {
        return false;
      }

      const signedPayload = `${timestamp}.${rawBody}`;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  }
}

export class PartnerIQ {
  public readonly apiKey: string;
  public readonly baseUrl: string;
  public readonly timeout: number;

  public readonly programs: ProgramsResource;
  public readonly affiliates: AffiliatesResource;
  public readonly customers: CustomersResource;
  public readonly attributions: AttributionsResource;
  public readonly conversions: ConversionsResource;
  public readonly tracking: TrackingResource;
  public readonly webhooks: WebhooksResource;

  constructor(options: PartnerIQOptions) {
    if (!options || !options.apiKey) {
      throw new PartnerIQError('PartnerIQ SDK requires an "apiKey" option');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || (typeof process !== 'undefined' && process.env?.PARTNERIQ_BASE_URL) || 'http://localhost:5000').replace(/\/$/, '');
    this.timeout = options.timeout || 10000;

    this.programs = new ProgramsResource(this);
    this.affiliates = new AffiliatesResource(this);
    this.customers = new CustomersResource(this);
    this.attributions = new AttributionsResource(this);
    this.conversions = new ConversionsResource(this);
    this.tracking = new TrackingResource(this);
    this.webhooks = new WebhooksResource(this);
  }

  /**
   * Internal HTTP Request Helper using fetch API.
   */
  async request(path: string, options: any = {}): Promise<any> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      ...((options.headers as Record<string, string>) || {}),
    };

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(id as any);

      const contentType = response.headers.get('content-type') || '';
      let data: any = null;
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        const message = data?.error?.message || data?.message || data?.error || `Request failed with status ${response.status}`;
        throw new PartnerIQError(message, response.status, data);
      }

      return data;
    } catch (error: any) {
      clearTimeout(id as any);
      if (error instanceof PartnerIQError) {
        throw error;
      }
      if (error.name === 'AbortError') {
        throw new PartnerIQError(`PartnerIQ API Request timed out after ${this.timeout}ms`);
      }
      throw new PartnerIQError(error.message || 'Network request failed', 0, error);
    }
  }
}

export default PartnerIQ;
