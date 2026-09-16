import { Injectable, Logger } from '@nestjs/common';
import { Server as HttpServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { dbStore } from '../../database/store';
import { MembershipStatus } from '../../common/enums/rbac';
import { verifyAccessToken } from '../../common/auth/verify-access-token';

export type DealRealtimeSource = 'LOCAL' | 'HUBSPOT_WEBHOOK' | 'HUBSPOT_SYNC';

export interface DealRealtimeEvent {
  type: 'deal.created' | 'deal.updated';
  organizationId: string;
  deal: Record<string, unknown>;
  source: DealRealtimeSource;
  occurredAt: string;
}

@Injectable()
export class DealsGateway {
  private readonly logger = new Logger(DealsGateway.name);
  private server?: WebSocketServer;
  private readonly clients = new Map<string, Set<WebSocket>>();

  attachServer(httpServer: HttpServer) {
    if (this.server) return;

    // noServer + a manually-gated 'upgrade' listener lets this gateway coexist with other
    // WebSocketServer instances on the same http.Server: a `{server, path}`-mode instance
    // aborts (HTTP 400) any upgrade whose path doesn't match *before* other listeners run,
    // which breaks multiplexing. Checking the pathname ourselves and returning early instead
    // of aborting leaves the socket alone for the next listener to claim.
    this.server = new WebSocketServer({ noServer: true, clientTracking: true });

    httpServer.on('upgrade', (request, socket, head) => {
      const { pathname } = new URL(request.url || '', 'http://localhost');
      if (pathname !== '/ws/deals') return;
      this.server!.handleUpgrade(request, socket as any, head, (client) => {
        this.server!.emit('connection', client, request);
      });
    });

    this.server.on('connection', async (socket: WebSocket, request) => {
      const query = new URL(request.url || '', 'http://localhost');
      const token = query.searchParams.get('token');
      const organizationId = query.searchParams.get('organizationId');

      if (!token || !organizationId) {
        socket.close(1008, 'Missing token or organizationId');
        return;
      }

      try {
        const user = await verifyAccessToken(token);
        const isMember = user.isSuperAdmin || dbStore.organizationMemberships.some(
          (m) => m.userId === user.userId && m.organizationId === organizationId && m.status === MembershipStatus.ACTIVE,
        );
        if (!isMember) {
          socket.close(1008, 'Not a member of this organization');
          return;
        }
      } catch {
        socket.close(1008, 'Invalid or expired token');
        return;
      }

      this.registerSocket(organizationId, socket);
      this.logger.log(`Realtime deals socket connected for organization ${organizationId}`);

      socket.on('message', (raw) => {
        try {
          const payload = JSON.parse(raw.toString());
          if (payload?.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // ignore malformed client payloads
        }
      });

      socket.on('close', () => {
        this.unregisterSocket(organizationId, socket);
      });
    });
  }

  registerSocket(organizationId: string, socket: WebSocket) {
    const sockets = this.clients.get(organizationId) || new Set<WebSocket>();
    sockets.add(socket);
    this.clients.set(organizationId, sockets);
  }

  unregisterSocket(organizationId: string, socket: WebSocket) {
    const sockets = this.clients.get(organizationId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) this.clients.delete(organizationId);
  }

  emitDealCreated(organizationId: string, deal: Record<string, unknown>, source: DealRealtimeSource = 'LOCAL') {
    this.broadcast(organizationId, { type: 'deal.created', organizationId, deal, source, occurredAt: new Date().toISOString() });
  }

  emitDealUpdated(organizationId: string, deal: Record<string, unknown>, source: DealRealtimeSource = 'LOCAL') {
    this.broadcast(organizationId, { type: 'deal.updated', organizationId, deal, source, occurredAt: new Date().toISOString() });
  }

  private broadcast(organizationId: string, payload: DealRealtimeEvent) {
    const sockets = this.clients.get(organizationId);
    if (!sockets || sockets.size === 0) return;
    const message = JSON.stringify(payload);
    for (const socket of Array.from(sockets)) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  }

  getSocketCount() {
    return Array.from(this.clients.values()).reduce((count, sockets) => count + sockets.size, 0);
  }
}
