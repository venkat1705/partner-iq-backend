import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import { AuditAction } from '../../common/enums';

export interface AuditLogEntry {
  organizationId?: string;
  actorType: 'user' | 'system' | 'api_key' | 'affiliate';
  actorId: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface AffiliateAuditLogsQuery {
  actorId: string;
  affiliateIds?: string[];
  organizationId?: string;
  page?: number;
  limit?: number;
  search?: string;
  action?: string;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
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

  /**
   * Scoped audit log retrieval strictly for the authenticated affiliate.
   * Guarantees zero cross-affiliate leakage, zero internal admin visibility,
   * safe metadata sanitization, and organization/global scoping.
   */
  async getAffiliateAuditLogs(query: AffiliateAuditLogsQuery) {
    const {
      actorId,
      affiliateIds = [],
      organizationId,
      page = 1,
      limit = 20,
      search,
      action,
      resourceType,
      startDate,
      endDate,
    } = query;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const affiliateIdSet = new Set(affiliateIds);

    // 1. Strict identity scoping:
    // Only rows created by this actor, or directly associated with this affiliate's enrollments.
    let logs = dbStore.auditLogs.filter((log) => {
      // Exclude platform admin operational logs completely
      if (log.actorType === 'admin') return false;

      const matchesActor = log.actorId === actorId || affiliateIdSet.has(log.actorId);
      const matchesMetaAffiliate = Boolean(log.metadata && typeof log.metadata === 'object' && affiliateIdSet.has((log.metadata as any).affiliateId));
      const matchesAffiliateResource = log.resourceType === 'affiliate' && affiliateIdSet.has(log.resourceId);

      return matchesActor || matchesMetaAffiliate || matchesAffiliateResource;
    });

    // 2. Organization scoping (if provided)
    if (organizationId) {
      // Include events for this organization, PLUS global account/profile events
      // performed by this affiliate (e.g. profile updates, avatar, tax, payout methods).
      // Exclude events belonging to other, unrelated organizations.
      logs = logs.filter((log) => !log.organizationId || log.organizationId === organizationId);
    }

    // 3. Action filter
    if (action) {
      logs = logs.filter((log) => log.action === action);
    }

    // 4. Resource type filter
    if (resourceType) {
      logs = logs.filter((log) => (log.resourceType || '').toLowerCase() === resourceType.toLowerCase());
    }

    // 5. Date range filters
    if (startDate) {
      const fromTime = new Date(startDate).getTime();
      if (!isNaN(fromTime)) {
        logs = logs.filter((log) => new Date(log.createdAt).getTime() >= fromTime);
      }
    }
    if (endDate) {
      const toTime = new Date(endDate).getTime();
      if (!isNaN(toTime)) {
        logs = logs.filter((log) => new Date(log.createdAt).getTime() <= toTime);
      }
    }

    // 6. Search query
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      logs = logs.filter((log) => {
        const act = (log.action || '').toLowerCase();
        const resType = (log.resourceType || '').toLowerCase();
        const resId = (log.resourceId || '').toLowerCase();
        const metaStr = JSON.stringify(log.metadata || {}).toLowerCase();
        return act.includes(q) || resType.includes(q) || resId.includes(q) || metaStr.includes(q);
      });
    }

    // 7. Sort by newest first
    logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = logs.length;
    const totalPages = Math.ceil(total / safeLimit) || 1;
    const startIndex = (safePage - 1) * safeLimit;
    const paginated = logs.slice(startIndex, startIndex + safeLimit);

    // 8. Safe metadata sanitization & label enrichment
    const safeData = paginated.map((log) => {
      const org = log.organizationId ? dbStore.organizations.find((o) => o.id === log.organizationId) : null;
      const cleanMeta: Record<string, any> = {};

      if (log.metadata && typeof log.metadata === 'object') {
        const sensitiveKeys = ['password', 'token', 'secret', 'pan', 'taxid', 'accountnumber', 'routingnumber', 'otp'];
        for (const [k, v] of Object.entries(log.metadata)) {
          const lowerKey = k.toLowerCase();
          if (lowerKey === 'passwordchanged') {
            cleanMeta[k] = v;
          } else if (!sensitiveKeys.some((s) => lowerKey.includes(s))) {
            cleanMeta[k] = v;
          }
        }
      }

      return {
        id: log.id,
        organizationId: log.organizationId,
        organizationName: org ? org.name : undefined,
        actorType: log.actorType,
        actorId: log.actorId,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        metadata: cleanMeta,
        createdAt: log.createdAt,
      };
    });

    return {
      data: safeData,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages,
    };
  }
}
