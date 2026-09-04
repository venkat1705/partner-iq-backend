import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DEV_FALLBACK_ENCRYPTION_KEY = 'partneriq_dev_encryption_key_fallback_32x';

function resolveMasterKey(): string {
  const key = process.env.ENCRYPTION_KEY || process.env.TOTP_ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ENCRYPTION_KEY environment variable is required in production. ' +
        'Generate one with: openssl rand -hex 32'
      );
    }
    // Development fallback — stable across restarts unlike crypto.randomBytes
    return DEV_FALLBACK_ENCRYPTION_KEY;
  }
  return key;
}

export class SecurityUtils {
  private static readonly SALT_ROUNDS = 12;
  private static readonly MASTER_KEY = resolveMasterKey();

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  static generateRandomCode(length = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      result += chars[randomBytes[i] % chars.length];
    }
    return result;
  }

  private static base32Encode(buffer: Buffer): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';

    for (const byte of buffer) {
      value = (value << 8) | byte;
      bits += 8;

      while (bits >= 5) {
        output += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += alphabet[(value << (5 - bits)) & 31];
    }

    return output;
  }

  private static base32Decode(base32: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];

    for (let i = 0; i < base32.length; i++) {
      const index = alphabet.indexOf(base32[i]);
      if (index === -1) continue;
      value = (value << 5) | index;
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return Buffer.from(bytes);
  }

  static generateTotpSecret(label: string): { secret: string; otpauthUri: string; manualKey: string } {
    const secret = this.base32Encode(crypto.randomBytes(20)).slice(0, 32).toUpperCase();
    const issuer = 'PartnerIQ';
    const encodedLabel = encodeURIComponent(label);
    const encodedIssuer = encodeURIComponent(issuer);
    const otpauthUri = `otpauth://totp/${encodedIssuer}:${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
    return { secret, otpauthUri, manualKey: secret };
  }

  static generateTotpCode(secret: string, timeCounter?: number): string {
    const counter = timeCounter ?? Math.floor(Date.now() / 30000);
    const base32 = secret.replace(/\s/g, '').toUpperCase();
    const key = this.base32Decode(base32);
    const buffer = Buffer.alloc(8);
    let value = counter;
    for (let i = 7; i >= 0; i--) {
      buffer[i] = value & 0xff;
      value = Math.floor(value / 256);
    }

    const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    return String(code % 1000000).padStart(6, '0');
  }

  static verifyTotpCode(secret: string, code: string, skewWindow = 1): boolean {
    if (!secret || !code || !/^\d{6}$/.test(code)) {
      return false;
    }

    const counter = Math.floor(Date.now() / 30000);
    for (let offset = -skewWindow; offset <= skewWindow; offset += 1) {
      if (this.generateTotpCode(secret, counter + offset) === code) {
        return true;
      }
    }
    return false;
  }

  static generateRecoveryCodes(count = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const code = `${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4)}-${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4)}`;
      codes.push(code);
    }
    return codes;
  }

  static hashRecoveryCode(code: string): string {
    return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
  }

  static generateApiKey(
    environment: 'live' | 'test' = 'live',
    keyType: 'sk' | 'pk' = 'sk',
  ): { key: string; prefix: string; hash: string } {
    const randomStr = crypto.randomBytes(32).toString('base64url');
    const prefix = `pi_${environment}_${keyType}_`;
    const key = `${prefix}${randomStr}`;
    const hash = this.hashToken(key);
    return { key, prefix, hash };
  }

  static maskCredential(value: string): string {
    if (!value) return '';
    return `${value.slice(0, 14)}${'•'.repeat(10)}`;
  }

  static generateWebhookSecret(): { secret: string; hash: string } {
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    const hash = this.hashToken(secret);
    return { secret, hash };
  }

  static signWebhookPayload(secret: string, timestamp: number, payload: string): string {
    const signatureBase = `${timestamp}.${payload}`;
    return crypto
      .createHmac('sha256', secret)
      .update(signatureBase)
      .digest('hex');
  }

  static timingSafeCompare(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  }

  static encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(this.MASTER_KEY, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  static decrypt(encryptedData: string): string {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) return encryptedData;
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    const key = crypto.scryptSync(this.MASTER_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  static generatePkceVerifier(length = 64): string {
    return crypto.randomBytes(length).toString('base64url').slice(0, length);
  }

  static generatePkceChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  static generateNonce(length = 32): string {
    return crypto.randomBytes(length).toString('base64url');
  }

  static sanitizeForLogging(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    const sensitiveKeys = [
      'password',
      'passwordHash',
      'accessToken',
      'refreshToken',
      'authorization',
      'apiKey',
      'secret',
      'clientSecret',
      'client_secret',
      'cookie',
      'set-cookie',
      'webhookSecret',
      'keyHash',
      'code',
      'authCode',
      'idToken',
      'id_token',
      'codeVerifier',
      'code_verifier',
      'codeChallenge',
      'code_challenge',
      'totpSecret',
      'recoveryCode',
      'otp',
    ];

    const copy = Array.isArray(obj) ? [...obj] : { ...obj };
    for (const key of Object.keys(copy)) {
      const lowerKey = key.toLowerCase();
      if (
        sensitiveKeys.some(
          (s) => lowerKey === s.toLowerCase() || lowerKey.includes(s.toLowerCase()),
        )
      ) {
        copy[key] = '[REDACTED]';
      } else if (typeof copy[key] === 'object' && copy[key] !== null) {
        copy[key] = this.sanitizeForLogging(copy[key]);
      }
    }
    return copy;
  }
}
