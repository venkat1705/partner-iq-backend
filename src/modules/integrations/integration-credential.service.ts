import { Injectable, NotFoundException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, awaitPersist } from '../../database/store';

@Injectable()
export class IntegrationCredentialService {
  /**
   * Stays synchronous so every credential mutation lands in dbStore immediately (many callers,
   * including tests, invoke this without awaiting). The tracked entity is returned so a caller
   * that needs the background DB write confirmed before it returns can do
   * `await awaitPersist(credentialService.storeCredential(...))` itself.
   */
  storeCredential(organizationIntegrationId: string, credentialKey: string, value: string) {
    if (!value) return undefined;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const existing = dbStore.integrationCredentials.find(
      (item) => item.organizationIntegrationId === organizationIntegrationId && item.credentialKey === credentialKey,
    );

    const credential = {
      ...(existing || { id: uuidv4(), createdAt: new Date() }),
      organizationIntegrationId,
      credentialKey,
      encryptedValue: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyVersion: 1,
      updatedAt: new Date(),
    };

    // `existing`, when found, is the live Proxy-wrapped entity already tracked by dbStore —
    // mutate and return that reference directly rather than the freshly spread `credential`
    // object, which is never pushed/tracked in the update path.
    if (existing) {
      Object.assign(existing, credential);
      return existing;
    }
    dbStore.integrationCredentials.push(credential);
    return credential;
  }

  /**
   * Stores several credentials in one synchronous pass (so partial execution can't be observed
   * by an un-awaited caller), then resolves once every write it kicked off has actually landed.
   */
  async storeCredentials(organizationIntegrationId: string, credentials: Record<string, string>) {
    const pending: Promise<unknown>[] = [];
    for (const [key, value] of Object.entries(credentials)) {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        const entity = this.storeCredential(organizationIntegrationId, key, String(value));
        if (entity) pending.push(awaitPersist(entity));
      }
    }
    await Promise.all(pending);
  }

  getCredential(organizationIntegrationId: string, credentialKey: string): string {
    const credential = dbStore.integrationCredentials.find(
      (item) => item.organizationIntegrationId === organizationIntegrationId && item.credentialKey === credentialKey,
    );
    if (!credential) {
      throw new NotFoundException(`Integration credential '${credentialKey}' not found`);
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(credential.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(credential.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(credential.encryptedValue, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  getAllCredentials(organizationIntegrationId: string): Record<string, string> {
    const creds = dbStore.integrationCredentials.filter(
      (item) => item.organizationIntegrationId === organizationIntegrationId,
    );
    const result: Record<string, string> = {};
    for (const item of creds) {
      try {
        result[item.credentialKey] = this.getCredential(organizationIntegrationId, item.credentialKey);
      } catch {
        // ignore decryption error for missing item
      }
    }
    return result;
  }

  hasCredentials(organizationIntegrationId: string): boolean {
    return dbStore.integrationCredentials.some(
      (item) => item.organizationIntegrationId === organizationIntegrationId,
    );
  }

  deleteCredentials(organizationIntegrationId: string) {
    const remaining = dbStore.integrationCredentials.filter(
      (item) => item.organizationIntegrationId !== organizationIntegrationId,
    );
    dbStore.integrationCredentials = remaining as any;
  }

  private encryptionKey() {
    const key = process.env.INTEGRATION_CREDENTIAL_KEY || process.env.ENCRYPTION_KEY;
    if (!key) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'INTEGRATION_CREDENTIAL_KEY (or ENCRYPTION_KEY) environment variable is required in production to encrypt integration credentials.',
        );
      }
      return createHash('sha256').update('partneriq-development-integration-key').digest();
    }
    return createHash('sha256').update(key).digest();
  }
}
