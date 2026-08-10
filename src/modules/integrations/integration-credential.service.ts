import { Injectable, NotFoundException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';

@Injectable()
export class IntegrationCredentialService {
  storeCredential(organizationIntegrationId: string, credentialKey: string, value: string) {
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

  getCredential(organizationIntegrationId: string, credentialKey: string) {
    const credential = dbStore.integrationCredentials.find(
      (item) => item.organizationIntegrationId === organizationIntegrationId && item.credentialKey === credentialKey,
    );
    if (!credential) {
      throw new NotFoundException('Integration credential not found');
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

  private encryptionKey() {
    return createHash('sha256')
      .update(process.env.INTEGRATION_CREDENTIAL_KEY || process.env.JWT_SECRET || 'partneriq-development-integration-key')
      .digest();
  }
}
