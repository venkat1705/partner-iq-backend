const VERSION = '0.1.0';

export interface PartnerIQBrowserOptions {
  publicKey: string;
  apiUrl?: string;
  referralParams?: string[];
  cookieDays?: number;
}

export interface IdentifyOptions {
  customerId: string;
}

export interface TrackOptions {
  event: string;
  customerId?: string;
  metadata?: Record<string, unknown>;
}

type State = Required<Pick<PartnerIQBrowserOptions, 'publicKey' | 'apiUrl' | 'referralParams' | 'cookieDays'>>;

const ANON_KEY = 'pi_anonymous_id';
const ATTR_KEY = 'pi_attribution_id';

let state: State | null = null;

export const PartnerIQ = {
  init(options: PartnerIQBrowserOptions) {
    if (!options.publicKey) throw new Error('PartnerIQ publicKey is required');
    if (/^pi_(test|live)_sk_/.test(options.publicKey)) {
      throw new Error('Secret API keys cannot be used with @partneriq-io/browser');
    }
    if (!/^pi_(test|live)_pk_/.test(options.publicKey)) {
      throw new Error('Use a public browser key with pi_test_pk_ or pi_live_pk_ prefix');
    }
    state = {
      publicKey: options.publicKey,
      apiUrl: (options.apiUrl || 'http://localhost:3000').replace(/\/$/, ''),
      referralParams: options.referralParams || ['ref', 'via', 'partner', 'affiliate'],
      cookieDays: options.cookieDays || 30,
    };
    return PartnerIQ;
  },

  async trackReferral() {
    const cfg = requireState();
    if (!isBrowser()) return null;
    const url = new URL(window.location.href);
    const ref = cfg.referralParams.map((param) => url.searchParams.get(param)).find(Boolean);
    if (!ref) return PartnerIQ.getAttribution();

    const anonymousId = getOrCreateAnonymousId(cfg.cookieDays);
    const response = await request('/api/v1/browser/referrals', {
      publicKey: cfg.publicKey,
      ref,
      anonymousId,
      landingPageUrl: window.location.href,
    });
    if (response?.attributionId) {
      writeValue(ATTR_KEY, response.attributionId, cfg.cookieDays);
    }
    if (response?.anonymousId) {
      writeValue(ANON_KEY, response.anonymousId, cfg.cookieDays);
    }
    return PartnerIQ.getAttribution();
  },

  async identify(options: IdentifyOptions) {
    const cfg = requireState();
    const attribution = PartnerIQ.getAttribution();
    return request('/api/v1/tracking/identify', {
      publicKey: cfg.publicKey,
      anonymousId: attribution.anonymousId,
      customerExternalId: options.customerId,
    });
  },

  getAttribution() {
    return {
      anonymousId: readValue(ANON_KEY) || getOrCreateAnonymousId(requireState().cookieDays),
      attributionId: readValue(ATTR_KEY),
    };
  },

  clearAttribution() {
    clearValue(ANON_KEY);
    clearValue(ATTR_KEY);
  },

  async track(options: TrackOptions) {
    const cfg = requireState();
    const attribution = PartnerIQ.getAttribution();
    return request('/api/v1/browser/events', {
      publicKey: cfg.publicKey,
      anonymousId: attribution.anonymousId,
      attributionId: attribution.attributionId,
      event: options.event,
      customerId: options.customerId,
      metadata: options.metadata,
    });
  },
};

type PartnerIQApiPayload = {
  success?: boolean;
  data?: {
    anonymousId?: string;
    attributionId?: string;
    [key: string]: unknown;
  };
  anonymousId?: string;
  attributionId?: string;
  error?: { message?: string };
};

async function request(path: string, body: unknown) {
  const cfg = requireState();
  const response = await fetch(`${cfg.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PartnerIQ-Client': 'browser',
      'PartnerIQ-Client-Version': VERSION,
    },
    body: JSON.stringify(body),
    credentials: 'omit',
  });
  const payload = await response.json().catch(() => null) as PartnerIQApiPayload | null;
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error?.message || `PartnerIQ browser request failed with ${response.status}`);
  }
  return payload?.data ?? payload;
}

function requireState() {
  if (!state) throw new Error('PartnerIQ.init() must be called first');
  return state;
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getOrCreateAnonymousId(days: number) {
  const existing = readValue(ANON_KEY);
  if (existing) return existing;
  const anon = `anon_${randomId()}`;
  writeValue(ANON_KEY, anon, days);
  return anon;
}

function randomId() {
  const cryptoApi = isBrowser() ? window.crypto : undefined;
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function readValue(key: string) {
  if (!isBrowser()) return null;
  return localStorage.getItem(key) || readCookie(key);
}

function writeValue(key: string, value: string, days: number) {
  if (!isBrowser()) return;
  localStorage.setItem(key, value);
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${days * 86400}; Path=/; SameSite=Lax${secure}`;
}

function clearValue(key: string) {
  if (!isBrowser()) return;
  localStorage.removeItem(key);
  document.cookie = `${key}=; Max-Age=0; Path=/; SameSite=Lax`;
}

function readCookie(key: string) {
  if (!isBrowser()) return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export default PartnerIQ;
