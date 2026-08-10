import { Injectable } from '@nestjs/common';
import { dbStore } from '../../database/store';

@Injectable()
export class AuditService {
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
