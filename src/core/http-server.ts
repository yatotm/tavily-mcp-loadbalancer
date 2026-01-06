import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { ToolRouter } from './tools/tool-router.js';
import { logger } from '../utils/logger.js';
import { sanitizeForSse } from '../client/response-formatter.js';
import { ApiRouter } from '../api/router.js';
import { EventBus } from './event-bus.js';
import { WebSocketHub } from './websocket-hub.js';
import { getRuntimeConfig } from '../utils/runtime-config.js';
import { ConnectionStore } from './connection-store.js';

interface SSEClient {
  sessionId: string;
  res: express.Response;
  lastActivity: number;
}

interface MCPRequest {
  jsonrpc: string;
  id: number | string | null;
  method: string;
  params?: any;
}

export class HttpServer {
  private app: express.Application;
  private server?: http.Server;
  private clients: Map<string, SSEClient> = new Map();
  private websocketHub: WebSocketHub;

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
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Admin-Token'],
    }));
    this.app.use(express.json({ limit: '2mb' }));
  }

  private setupRoutes(): void {
    const runtime = getRuntimeConfig();

    // SSE endpoint
    this.app.get('/sse', (req, res) => {
      const sessionId = this.generateSessionId();
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      });

      res.write('event: endpoint\n');
      res.write(`data: /message?sessionId=${sessionId}\n\n`);

      const client: SSEClient = {
        sessionId,
        res,
        lastActivity: Date.now(),
      };

      this.clients.set(sessionId, client);
      this.connectionStore.setSse(this.clients.size);
      logger.info('SSE client connected', { sessionId });

      req.on('close', () => {
        this.clients.delete(sessionId);
        this.connectionStore.setSse(this.clients.size);
        logger.info('SSE client disconnected', { sessionId });
      });

      req.on('error', (error) => {
        const msg = (error as Error).message;
        if (msg === 'aborted') {
          logger.debug('SSE client aborted', { sessionId });
        } else {
          logger.error('SSE client error', { sessionId, error: msg });
        }
        this.clients.delete(sessionId);
        this.connectionStore.setSse(this.clients.size);
      });
    });

    this.app.post('/message', async (req, res) => {
      try {
        const sessionId = req.query.sessionId as string;
        const mcpRequest: MCPRequest = req.body;
        if (!sessionId) {
          return res.status(400).json({ error: 'Missing sessionId parameter' });
        }

        const response = await this.handleMcpRequest(mcpRequest);
        if (response && this.clients.has(sessionId)) {
          const client = this.clients.get(sessionId)!;
          const payload = sanitizeForSse(JSON.stringify(response));
          if (!client.res.destroyed && client.res.writable) {
            client.res.write(`data: ${payload}\n\n`);
          }
          client.lastActivity = Date.now();
        }

        res.json({ status: 'sent' });
      } catch (error: any) {
        logger.error('Error handling SSE message', { error: error?.message });
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    this.app.post('/mcp', async (req, res) => {
      try {
        const mcpRequest: MCPRequest = req.body;
        if (!mcpRequest || !mcpRequest.jsonrpc || !mcpRequest.method) {
          return res.status(400).json({
            error: 'Invalid MCP request format. Expected JSON-RPC 2.0 format with method field.',
          });
        }

        const response = await this.handleMcpRequest(mcpRequest);
        if (response) {
          res.json(response);
        } else {
          res.json({
            jsonrpc: '2.0',
            id: mcpRequest.id ?? null,
            result: { status: 'acknowledged' },
          });
        }
      } catch (error: any) {
        logger.error('Error handling streamableHTTP MCP request', { error: error?.message });
        res.status(500).json({
          jsonrpc: '2.0',
          id: req.body?.id || null,
          error: {
            code: -32603,
            message: 'Internal error',
            data: error?.message || 'Unknown error',
          },
        });
      }
    });

    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        sse_clients: this.clients.size,
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

  private cleanupTimer?: ReturnType<typeof setInterval>;

  private setupCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const timeout = 5 * 60 * 1000;
      for (const [sessionId, client] of this.clients.entries()) {
        if (now - client.lastActivity > timeout) {
          try {
            client.res.end();
          } catch {
            // ignore
          }
          this.clients.delete(sessionId);
          this.connectionStore.setSse(this.clients.size);
        }
      }
    }, 60000);
  }

  private async handleMcpRequest(request: MCPRequest): Promise<any | null> {
    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'tavily-mcp-loadbalancer',
              version: '3.0.0',
              capabilities: { tools: {} },
            },
          },
        };
      case 'notifications/initialized':
        return null;
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            tools: this.toolRouter.listTools(),
          },
        };
      case 'tools/call': {
        const { name, arguments: args } = request.params || {};
        try {
          const result = await this.toolRouter.callTool(name, args);
          return {
            jsonrpc: '2.0',
            id: request.id,
            result,
          };
        } catch (error: any) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32603,
              message: error?.message || 'Tool call failed',
            },
          };
        }
      }
      default:
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`,
          },
        };
    }
  }

  private generateSessionId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
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
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Close all SSE connections
    for (const [sessionId, client] of this.clients.entries()) {
      try {
        client.res.end();
      } catch {
        // ignore
      }
      this.clients.delete(sessionId);
    }

    // Close WebSocket connections
    this.websocketHub.closeAll();

    // Close HTTP server
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
  }

  getSseConnections(): number {
    return this.clients.size;
  }

  getWsConnections(): number {
    return this.websocketHub.getConnectionCount();
  }
}
