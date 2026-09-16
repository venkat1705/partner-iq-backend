const VERSION = '0.2.0';

export interface PartnerIQBrowserOptions {
  publicKey: string;
  apiUrl?: string;
  /** Query params on the merchant's own page that carry a PartnerIQ short code, e.g. https://merchant.com/?pi_ref=sarah */
  referralParams?: string[];
  cookieDays?: number;
}

export interface IdentifyOptions {
  customerId: string;
}

type State = Required<Pick<PartnerIQBrowserOptions, 'publicKey' | 'apiUrl' | 'referralParams' | 'cookieDays'>>;

// Same cookie name the backend sets on GET /r/:shortCode (tracking.controller.ts) - the browser
// SDK reads/writes this same cookie so both entry points (a direct /r/:shortCode click and an
// in-page click captured via captureReferral()) converge on one anonymous id.
const ANON_KEY = 'pi_anon_id';
const CLICK_KEY = 'pi_click_id';

let state: State | null = null;

export const PartnerIQ = {
  init(options: PartnerIQBrowserOptions) {
    if (!options.publicKey) throw new Error('PartnerIQ publicKey is required');
    if (/^(pi_|sk_)(test|live)_/.test(options.publicKey) && !/pk_/.test(options.publicKey)) {
      throw new Error('Secret API keys cannot be used with @partneriq-io/browser - use a public tracking key');
    }
    state = {
      publicKey: options.publicKey,
      apiUrl: (options.apiUrl || 'http://localhost:3000').replace(/\/$/, ''),
      referralParams: options.referralParams || ['pi_ref', 'ref', 'via'],
      cookieDays: options.cookieDays || 30,
    };
    return PartnerIQ;
  },

  /**
   * Call once per page load. If the current page URL carries one of `referralParams`
   * (e.g. a merchant embeds the short code directly rather than routing through /r/:shortCode),
   * this records the click against the real backend and persists the resulting Click ID -
   * the durable, server-side attribution identifier - alongside the anonymous id.
   * If no referral param is present, it just returns whatever attribution state already exists
   * (e.g. set previously by a /r/:shortCode redirect).
   */
  async captureReferral() {
    const cfg = requireState();
    if (!isBrowser()) return PartnerIQ.getAttribution();
    const url = new URL(window.location.href);
    const shortCode = cfg.referralParams.map((param) => url.searchParams.get(param)).find(Boolean);
    if (!shortCode) return PartnerIQ.getAttribution();

    const response = await request('/api/v1/tracking/click', {
      publicKey: cfg.publicKey,
      shortCode,
      landingUrl: window.location.href,
      utmSource: url.searchParams.get('utm_source') || undefined,
      utmMedium: url.searchParams.get('utm_medium') || undefined,
      utmCampaign: url.searchParams.get('utm_campaign') || undefined,
      utmTerm: url.searchParams.get('utm_term') || undefined,
      utmContent: url.searchParams.get('utm_content') || undefined,
    }) as { anonymousId?: string; clickId?: string; cookieMaxAgeMs?: number; tracked?: boolean } | null;

    if (response?.tracked && response.anonymousId) {
      const days = response.cookieMaxAgeMs ? response.cookieMaxAgeMs / 86400000 : cfg.cookieDays;
      writeValue(ANON_KEY, response.anonymousId, days);
      if (response.clickId) writeValue(CLICK_KEY, response.clickId, days);
    }
    return PartnerIQ.getAttribution();
  },

  /**
   * Links the current anonymous click to a real customer id (call at signup/login/checkout).
   * This is what makes attribution survive a later cookie deletion, or a purchase completed on a
   * different device - the backend durably associates customerExternalId with the click's
   * attribution record server-side.
   */
  async identify(options: IdentifyOptions) {
    const cfg = requireState();
    const attribution = PartnerIQ.getAttribution();
    if (!attribution.anonymousId) return null;
    return request('/api/v1/tracking/identify', {
      publicKey: cfg.publicKey,
      anonymousId: attribution.anonymousId,
      customerExternalId: options.customerId,
    });
  },

  getAttribution() {
    return {
      anonymousId: readValue(ANON_KEY),
      clickId: readValue(CLICK_KEY),
    };
  },

  /** The Click ID is the primary attribution identifier - pass it to your server (e.g. as a hidden
   * checkout field or a Cashfree/Razorpay order tag) so a server-to-server conversion call or
   * payment webhook can resolve attribution deterministically instead of by customer/anon matching. */
  getClickId() {
    return readValue(CLICK_KEY);
  },

  clearAttribution() {
    clearValue(ANON_KEY);
    clearValue(CLICK_KEY);
  },
};

type PartnerIQApiPayload = {
  success?: boolean;
  data?: Record<string, unknown>;
  error?: { message?: string };
  [key: string]: unknown;
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

function readValue(key: string) {
  if (!isBrowser()) return null;
  return readCookie(key) || localStorage.getItem(key);
}

function writeValue(key: string, value: string, days: number) {
  if (!isBrowser()) return;
  localStorage.setItem(key, value);
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${Math.round(days * 86400)}; Path=/; SameSite=Lax${secure}`;
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
