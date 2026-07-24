import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { ToolRouter } from './tools/tool-router.js';
import { logger } from '../utils/logger.js';
import { ApiRouter } from '../api/router.js';
import { EventBus } from './event-bus.js';
import { WebSocketHub } from './websocket-hub.js';
import { getRuntimeConfig } from '../utils/runtime-config.js';
import { ConnectionStore } from './connection-store.js';
import { createMcpServer } from './mcp-server-factory.js';

export class HttpServer {
  private app: express.Application;
  private server?: http.Server;
  private transports: Map<string, StreamableHTTPServerTransport | SSEServerTransport> = new Map();
  private websocketHub: WebSocketHub;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    private toolRouter: ToolRouter,
    private apiRouter: ApiRouter,
    private eventBus: EventBus,
    private connectionStore: ConnectionStore
  ) {
    this.app = express();
    this.websocketHub = new WebSocketHub(eventBus, connectionStore);
    this.setupMiddleware();
    this.setupRoutes();
    this.setupCleanup();
  }

  private setupMiddleware(): void {
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Admin-Token', 'Mcp-Session-Id'],
    }));
    this.app.use(express.json({ limit: '2mb' }));
  }

  private setupRoutes(): void {
    const runtime = getRuntimeConfig();

    // ===================================================================
    // Streamable HTTP transport (protocol 2025-03-26+) — /mcp endpoint
    // ===================================================================
    this.app.all('/mcp', async (req, res) => {
      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && this.transports.has(sessionId)) {
          const existing = this.transports.get(sessionId)!;
          if (existing instanceof StreamableHTTPServerTransport) {
            transport = existing;
          } else {
            return res.status(400).json({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Bad Request: Session exists but uses a different transport protocol' },
              id: null,
            });
          }
        } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              this.transports.set(sid, transport);
              this.connectionStore.setSse(this.transports.size);
              logger.info('Streamable HTTP session initialized', { sessionId: sid });
            },
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && this.transports.has(sid)) {
              this.transports.delete(sid);
              this.connectionStore.setSse(this.transports.size);
              logger.info('Streamable HTTP session closed', { sessionId: sid });
            }
          };

          const server = createMcpServer(this.toolRouter);
          await server.connect(transport);
        } else {
          return res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
            id: null,
          });
        }

        await transport.handleRequest(req, res, req.body);
      } catch (error: any) {
        logger.error('Error handling Streamable HTTP request', { error: error?.message });
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error' },
            id: null,
          });
        }
      }
    });

    // ===================================================================
    // Legacy SSE transport (protocol 2024-11-05) — /sse + /message(s)
    // ===================================================================
    this.app.get('/sse', async (req, res) => {
      const transport = new SSEServerTransport('/message', res);
      this.transports.set(transport.sessionId, transport);
      this.connectionStore.setSse(this.transports.size);
      logger.info('SSE client connected', { sessionId: transport.sessionId });

      res.on('close', () => {
        this.transports.delete(transport.sessionId);
        this.connectionStore.setSse(this.transports.size);
        logger.info('SSE client disconnected', { sessionId: transport.sessionId });
      });

      const server = createMcpServer(this.toolRouter);
      await server.connect(transport);
    });

    // Support both /message (original) and /messages (SDK standard) for legacy SSE
    const handleLegacyPost = async (req: express.Request, res: express.Response) => {
      const sessionId = req.query.sessionId as string;
      const transport = this.transports.get(sessionId);

      if (!transport || !(transport instanceof SSEServerTransport)) {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid SSE session' },
          id: null,
        });
      }

      await transport.handlePostMessage(req, res, req.body);
    };

    this.app.post('/message', handleLegacyPost);
    this.app.post('/messages', handleLegacyPost);

    // ===================================================================
    // Health, API, Web UI
    // ===================================================================
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        sse_clients: this.transports.size,
        ws_clients: this.websocketHub.getConnectionCount(),
        uptime: process.uptime(),
      });
    });

    this.app.use('/api', this.apiRouter.router);

    if (runtime.enableWebUI) {
      const root = path.resolve(process.cwd(), 'web', 'public');
      this.app.use(express.static(root));
      // Express 5 requires named wildcard parameter instead of bare '*'
      this.app.get('/{*splat}', (req, res) => {
        res.sendFile(path.join(root, 'index.html'));
      });
    }
  }

  private setupCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      logger.debug('Active transport sessions', { count: this.transports.size });
    }, 60000);
  }

  start(): void {
    const runtime = getRuntimeConfig();
    this.server = http.createServer(this.app);
    this.websocketHub.attach(this.server, runtime.adminPassword || undefined);
    this.server.listen(runtime.port, runtime.host, () => {
      logger.info('HTTP server listening', { host: runtime.host, port: runtime.port });
    });
  }

  async stop(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Close all SDK transports
    for (const [sid, transport] of this.transports.entries()) {
      try {
        await transport.close();
      } catch {
        // ignore
      }
      this.transports.delete(sid);
    }

    this.connectionStore.setSse(0);

    // Close WebSocket connections
    this.websocketHub.closeAll();

    // Close HTTP server
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
  }

  getSseConnections(): number {
    return this.transports.size;
  }

  getWsConnections(): number {
    return this.websocketHub.getConnectionCount();
  }
}
