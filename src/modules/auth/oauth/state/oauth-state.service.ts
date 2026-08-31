import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SecurityUtils } from '../../../../common/utils/security.utils';
import { getAppConfig } from '../../../../config/app.config';

export type OAuthFlowType = 'LOGIN' | 'REGISTER' | 'LINK_ACCOUNT' | 'ACCEPT_INVITATION';

export interface OAuthStateRecord {
  state: string;
  flowType: OAuthFlowType;
  returnUrl: string;
  invitationToken?: string;
  currentUserId?: string;
  codeVerifier: string;
  codeChallenge: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
}

export interface CreateStateOptions {
  flowType?: OAuthFlowType;
  returnUrl?: string;
  invitationToken?: string;
  currentUserId?: string;
}

@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name);
  private readonly states = new Map<string, OAuthStateRecord>();

  constructor() {
    // Run periodic purge every 5 minutes
    setInterval(() => this.purgeExpired(), 5 * 60 * 1000);
  }

  /**
   * Generates a new cryptographically secure state transaction with PKCE and nonce.
   */
  createState(options: CreateStateOptions = {}): OAuthStateRecord {
    const config = getAppConfig();
    const ttlMs = (config.googleStateTtlSeconds || 600) * 1000;
    const now = Date.now();

    const state = SecurityUtils.generateNonce(48);
    const nonce = SecurityUtils.generateNonce(32);
    const codeVerifier = SecurityUtils.generatePkceVerifier(64);
    const codeChallenge = SecurityUtils.generatePkceChallenge(codeVerifier);
    const returnUrl = this.sanitizeReturnUrl(options.returnUrl, options.flowType);

    const record: OAuthStateRecord = {
      state,
      flowType: options.flowType || 'LOGIN',
      returnUrl,
      invitationToken: options.invitationToken,
      currentUserId: options.currentUserId,
      codeVerifier,
      codeChallenge,
      nonce,
      createdAt: now,
      expiresAt: now + ttlMs,
    };

    this.states.set(state, record);
    return record;
  }

  /**
   * Atomically validates and consumes the OAuth state (single-use).
   * Prevents state replay, login CSRF, and injection attacks.
   */
  consumeState(stateToken: string): OAuthStateRecord | null {
    if (!stateToken) return null;

    const record = this.states.get(stateToken);
    if (!record) {
      this.logger.warn(`OAuth state not found or already consumed: ${stateToken.slice(0, 8)}...`);
      return null;
    }

    // Always delete immediately for single-use guarantee
    this.states.delete(stateToken);

    // Check expiration
    if (Date.now() > record.expiresAt) {
      this.logger.warn(`OAuth state expired: created at ${new Date(record.createdAt).toISOString()}`);
      return null;
    }

    return record;
  }

  /**
   * Strictly sanitizes return URLs to prevent Open Redirect attacks.
   * Only allows relative paths on the same origin starting with '/' and not '//'.
   */
  sanitizeReturnUrl(url?: string, flowType?: OAuthFlowType): string {
    const defaultRoute = flowType === 'ACCEPT_INVITATION' ? '/invite/accept' : '/app/dashboard';

    if (!url || typeof url !== 'string') {
      return defaultRoute;
    }

    const trimmed = url.trim();

    // Disallow absolute protocol URLs (e.g. http://, https://, javascript:, data:)
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      this.logger.warn(`Rejected absolute return URL for open redirect protection: ${trimmed}`);
      return defaultRoute;
    }

    // Disallow protocol-relative URLs (e.g. //evil.com)
    if (trimmed.startsWith('//')) {
      this.logger.warn(`Rejected protocol-relative return URL: ${trimmed}`);
      return defaultRoute;
    }

    // Disallow backslashes (e.g. /\evil.com)
    if (trimmed.includes('\\')) {
      this.logger.warn(`Rejected return URL containing backslash: ${trimmed}`);
      return defaultRoute;
    }

    // Must start with '/'
    if (!trimmed.startsWith('/')) {
      return `/${trimmed}`;
    }

    return trimmed;
  }

  /**
   * Purges expired states from memory.
   */
  private purgeExpired() {
    const now = Date.now();
    for (const [state, record] of this.states.entries()) {
      if (now > record.expiresAt) {
        this.states.delete(state);
      }
    }
  }
}
