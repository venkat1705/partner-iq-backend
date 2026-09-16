import { Injectable, Logger } from '@nestjs/common';
import { createServer, Server as HttpServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import type { NotificationEventPayload } from './notifications.types';

@Injectable()
export class NotificationGateway {
  private readonly logger = new Logger(NotificationGateway.name);
  private server?: WebSocketServer;
  private readonly clients = new Map<string, Set<WebSocket>>();

  attachServer(httpServer: HttpServer) {
    if (this.server) {
      return;
    }

    // noServer + a manually-gated 'upgrade' listener lets this gateway coexist with other
    // WebSocketServer instances on the same http.Server: a `{server, path}`-mode instance
    // aborts (HTTP 400) any upgrade whose path doesn't match *before* other listeners run,
    // which breaks multiplexing. Checking the pathname ourselves and returning early instead
    // of aborting leaves the socket alone for the next listener to claim.
    this.server = new WebSocketServer({ noServer: true, clientTracking: true });

    httpServer.on('upgrade', (request, socket, head) => {
      const { pathname } = new URL(request.url || '', 'http://localhost');
      if (pathname !== '/notifications') return;
      this.server!.handleUpgrade(request, socket as any, head, (client) => {
        this.server!.emit('connection', client, request);
      });
    });

    this.server.on('connection', (socket: WebSocket, request) => {
      const query = new URL(request.url || '', 'http://localhost');
      const userId = query.searchParams.get('userId');

      if (!userId) {
        socket.close(1008, 'Missing userId');
        return;
      }

      this.registerSocket(userId, socket);
      this.logger.log(`Realtime notification socket connected for user ${userId}`);

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
        this.unregisterSocket(userId, socket);
      });
    });
  }

  registerSocket(userId: string, socket: WebSocket) {
    const sockets = this.clients.get(userId) || new Set<WebSocket>();
    sockets.add(socket);
    this.clients.set(userId, sockets);
  }

  unregisterSocket(userId: string, socket: WebSocket) {
    const sockets = this.clients.get(userId);
    if (!sockets) {
      return;
    }

    sockets.delete(socket);
    if (sockets.size === 0) {
      this.clients.delete(userId);
    }
  }

  broadcastToUser(userId: string, payload: NotificationEventPayload) {
    const sockets = this.clients.get(userId);
    if (!sockets || sockets.size === 0) {
      return;
    }

    const message = JSON.stringify(payload);
    for (const socket of Array.from(sockets)) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }
  }

  getSocketCount() {
    return Array.from(this.clients.values()).reduce((count, sockets) => count + sockets.size, 0);
  }
}
