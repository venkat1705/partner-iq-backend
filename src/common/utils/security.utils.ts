import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

export class SecurityUtils {
  private static readonly SALT_ROUNDS = 12;
  private static readonly MASTER_KEY =
    process.env.ENCRYPTION_KEY || 'partneriq_master_encryption_key_32bytes!!';

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

  static generateApiKey(environment: 'live' | 'test' = 'live'): { key: string; prefix: string; hash: string } {
    const randomStr = crypto.randomBytes(24).toString('hex');
    const prefix = `pi_${environment}_`;
    const key = `${prefix}${randomStr}`;
    const hash = this.hashToken(key);
    return { key, prefix, hash };
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
      'cookie',
      'webhookSecret',
      'keyHash',
    ];

    const copy = Array.isArray(obj) ? [...obj] : { ...obj };
    for (const key of Object.keys(copy)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        copy[key] = '[REDACTED]';
      } else if (typeof copy[key] === 'object' && copy[key] !== null) {
        copy[key] = this.sanitizeForLogging(copy[key]);
      }
    }
    return copy;
  }
}
