import { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { EventBus, EventPayload } from './event-bus.js';
import { logger } from '../utils/logger.js';
import { ConnectionStore } from './connection-store.js';

export class WebSocketHub {
  private wss?: WebSocketServer;
  private connections = new Set<WebSocket>();

  constructor(private eventBus: EventBus, private connectionStore: ConnectionStore) {}

  attach(server: HttpServer, adminPassword?: string): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (socket, request) => {
      if (adminPassword && !this.isAuthorized(request, adminPassword)) {
        socket.close(1008, 'Unauthorized');
        return;
      }
      this.connections.add(socket);
      this.connectionStore.setWs(this.connections.size);
      socket.on('close', () => {
        this.connections.delete(socket);
        this.connectionStore.setWs(this.connections.size);
      });
    });

    this.eventBus.on('event', (payload: EventPayload) => {
      this.broadcast(payload);
    });

    logger.info('WebSocket hub initialized');
  }

  private isAuthorized(request: IncomingMessage, adminPassword: string): boolean {
    const header = request.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim() === adminPassword;
    }
    const url = request.url || '';
    try {
      const parsed = new URL(url, 'http://localhost');
      const token = parsed.searchParams.get('token');
      return token === adminPassword;
    } catch {
      return false;
    }
  }

  broadcast(payload: EventPayload): void {
    const data = JSON.stringify(payload);
    for (const socket of this.connections) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  closeAll(): void {
    for (const socket of this.connections) {
      try {
        socket.close(1001, 'Server shutting down');
      } catch {
        // ignore
      }
    }
    this.connections.clear();
    this.connectionStore.setWs(0);
  }
}
