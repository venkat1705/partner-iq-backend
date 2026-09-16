import { Injectable, NotFoundException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';

@Injectable()
export class IntegrationCredentialService {
  storeCredential(organizationIntegrationId: string, credentialKey: string, value: string) {
    if (!value) return;
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

    if (existing) {
      Object.assign(existing, credential);
    } else {
      dbStore.integrationCredentials.push(credential);
    }
  }

  storeCredentials(organizationIntegrationId: string, credentials: Record<string, string>) {
    for (const [key, value] of Object.entries(credentials)) {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        this.storeCredential(organizationIntegrationId, key, String(value));
      }
    }
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
