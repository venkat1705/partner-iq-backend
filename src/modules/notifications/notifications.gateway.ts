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

    this.server = new WebSocketServer({
      server: httpServer,
      path: '/notifications',
      clientTracking: true,
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
