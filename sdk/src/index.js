"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartnerIQ = exports.WebhooksResource = exports.TrackingResource = exports.ConversionsResource = exports.PartnerIQError = void 0;
const crypto = __importStar(require("crypto"));
class PartnerIQError extends Error {
    constructor(message, statusCode, details) {
        super(message);
        this.name = 'PartnerIQError';
        this.statusCode = statusCode;
        this.details = details;
    }
}
exports.PartnerIQError = PartnerIQError;
class ConversionsResource {
    constructor(client) {
        this.client = client;
    }
    /**
     * Track a customer conversion/order event with automatic API key authentication & idempotency.
     */
    async track(params, options) {
        const headers = {};
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
    async refund(conversionId, params) {
        return this.client.request(`/api/v1/conversions/${conversionId}/refund`, {
            method: 'POST',
            body: JSON.stringify(params || {}),
        });
    }
    /**
     * List conversions for an organization.
     */
    async list(organizationId) {
        return this.client.request(`/api/v1/organizations/${organizationId}/conversions`, {
            method: 'GET',
        });
    }
}
exports.ConversionsResource = ConversionsResource;
class TrackingResource {
    constructor(client) {
        this.client = client;
    }
    /**
     * Log an incoming affiliate click or server-side referral redirect.
     */
    async captureClick(params) {
        return this.client.request(`/r/${params.affiliateCode}`, {
            method: 'GET',
        });
    }
}
exports.TrackingResource = TrackingResource;
class WebhooksResource {
    constructor(_client) {
        this._client = _client;
    }
    /**
     * Verify an incoming PartnerIQ webhook HMAC SHA-256 signature.
     */
    verifySignature(rawBody, signatureHeader, secret) {
        if (!rawBody || !signatureHeader || !secret) {
            return false;
        }
        try {
            const parts = signatureHeader.split(',');
            let timestamp = '';
            let signature = '';
            for (const part of parts) {
                const [key, value] = part.split('=');
                if (key.trim() === 't')
                    timestamp = value.trim();
                if (key.trim() === 'v1')
                    signature = value.trim();
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
        }
        catch {
            return false;
        }
    }
}
exports.WebhooksResource = WebhooksResource;
class PartnerIQ {
    constructor(options) {
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
    async request(path, options = {}) {
        const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            ...(options.headers || {}),
        };
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), this.timeout);
        try {
            const response = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal,
            });
            clearTimeout(id);
            const contentType = response.headers.get('content-type') || '';
            let data = null;
            if (contentType.includes('application/json')) {
                data = await response.json();
            }
            else {
                data = await response.text();
            }
            if (!response.ok) {
                const message = data?.message || data?.error || `Request failed with status ${response.status}`;
                throw new PartnerIQError(message, response.status, data);
            }
            return data;
        }
        catch (error) {
            clearTimeout(id);
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
exports.PartnerIQ = PartnerIQ;
exports.default = PartnerIQ;
