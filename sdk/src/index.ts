import * as crypto from 'crypto';

export interface PartnerIQOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface CreateConversionParams {
  externalId: string;
  customerExternalId: string;
  amount: number; // in cents
  currency?: string;
  productId?: string;
  occurredAt?: string;
}

export interface RefundConversionParams {
  reason?: string;
}

export interface CaptureClickParams {
  affiliateCode: string;
  userAgent?: string;
  ipAddress?: string;
  landingPageUrl?: string;
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
   * Process a full/partial refund and trigger automatic commission clawback in double-entry ledger.
   */
  async refund(conversionId: string, params?: RefundConversionParams) {
    return this.client.request(`/api/v1/conversions/${conversionId}/refund`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
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
}

export class TrackingResource {
  constructor(private readonly client: PartnerIQ) {}

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
  constructor(private readonly _client?: PartnerIQ) {}

  /**
   * Verify an incoming PartnerIQ webhook HMAC SHA-256 signature.
   */
  verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
    if (!rawBody || !signatureHeader || !secret) {
      return false;
    }

    try {
      const parts = signatureHeader.split(',');
      let timestamp = '';
      let signature = '';

      for (const part of parts) {
        const [key, value] = part.split('=');
        if (key.trim() === 't') timestamp = value.trim();
        if (key.trim() === 'v1') signature = value.trim();
      }

      if (!timestamp || !signature) {
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

  public readonly conversions: ConversionsResource;
  public readonly tracking: TrackingResource;
  public readonly webhooks: WebhooksResource;

  constructor(options: PartnerIQOptions) {
    if (!options || !options.apiKey) {
      throw new PartnerIQError('PartnerIQ SDK requires an "apiKey" option');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
    this.timeout = options.timeout || 10000;

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
        const message = data?.message || data?.error || `Request failed with status ${response.status}`;
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
