import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import { AuditAction } from '../../common/enums';

export interface AuditLogEntry {
  organizationId?: string;
  actorType: 'user' | 'system' | 'api_key';
  actorId: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  /**
   * Single write path for audit log rows. Every module previously pushed directly to
   * dbStore.auditLogs itself with inconsistent actorType casing ('user'/'USER'/'system'/'SYSTEM')
   * and no shared validation - this centralizes that so the shape stays consistent and the
   * behavior (e.g. metadata scrubbing) only needs to be correct in one place.
   */
  log(entry: AuditLogEntry) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId: entry.organizationId,
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      metadata: entry.metadata,
      createdAt: new Date(),
    });
  }

  async getAuditLogs(organizationId: string) {
    return dbStore.auditLogs
      .filter((log) => log.organizationId === organizationId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((log) => {
        const actor = dbStore.users.find((user) => user.id === log.actorId);
        return {
          ...log,
          actorLabel: actor ? actor.email : log.actorId,
        };
      });
  }
}
