import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolRouter } from './tools/tool-router.js';
import { logger } from '../utils/logger.js';
import { ApiRouter } from '../api/router.js';
import { EventBus } from './event-bus.js';
import { WebSocketHub } from './websocket-hub.js';
import { getRuntimeConfig } from '../utils/runtime-config.js';
import { ConnectionStore } from './connection-store.js';
import { Provider } from '../data/database.js';

export class HttpServer {
  public app = express();
  private server?: http.Server;
  private clients = new Map<string, { transport: SSEServerTransport; server: Server; route: string; heartbeat: NodeJS.Timeout }>();
  private websocketHub: WebSocketHub;
  constructor(private toolRouter: ToolRouter, private apiRouter: ApiRouter, private eventBus: EventBus, private connectionStore: ConnectionStore) {
    this.websocketHub = new WebSocketHub(eventBus, connectionStore);
    this.app.disable('x-powered-by');
    this.app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Admin-Token', 'MCP-Protocol-Version', 'Mcp-Session-Id', 'Last-Event-ID'],
      exposedHeaders: ['Mcp-Session-Id'] }));
    this.app.use(express.json({ limit: '2mb' }));
    this.routes();
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (res.headersSent) return next(error);
      res.status(error?.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500)
        .json({ error: error instanceof SyntaxError ? 'Invalid JSON' : 'Request failed' });
    });
  }
  private createMcp(provider: Provider): Server {
    const server = new Server({ name: `${provider}-mcp-gateway`, version: '4.1.2' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.toolRouter.listTools(provider) }));
    server.setRequestHandler(CallToolRequestSchema, async request => {
      try { return await this.toolRouter.callTool(request.params.name, request.params.arguments, provider); }
      catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Tool call failed' }] }; }
    });
    server.onerror = () => logger.debug('MCP transport error', { provider });
    return server;
  }
  private routes() {
    const runtime = getRuntimeConfig();
    for (const [prefix, provider] of [['', 'tavily'], ['/tavily', 'tavily'], ['/exa', 'exa']] as const) {
      this.app.get(`${prefix}/sse`, async (req, res) => {
        if (this.clients.size >= 1000) { res.status(503).json({ error: 'Too many SSE sessions' }); return; }
        const server = this.createMcp(provider);
        const transport = new SSEServerTransport(`${prefix}/message`, res);
        res.setHeader('X-Accel-Buffering', 'no');
        const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 25000);
        heartbeat.unref();
        const cleanup = () => {
          clearInterval(heartbeat); this.clients.delete(transport.sessionId);
          this.connectionStore.setSse(this.clients.size);
        };
        this.clients.set(transport.sessionId, { transport, server, route: prefix, heartbeat });
        this.connectionStore.setSse(this.clients.size);
        res.on('close', () => { cleanup(); void server.close(); });
        try { await server.connect(transport); } catch { cleanup(); res.end(); }
      });
      this.app.post(`${prefix}/message`, async (req, res) => {
        const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
        const client = this.clients.get(sessionId);
        // Reject stale and cross-channel sessions BEFORE dispatching a billable call.
        if (!client || client.route !== prefix) { res.status(404).json({ error: 'Unknown SSE session for this endpoint' }); return; }
        await client.transport.handlePostMessage(req, res, req.body);
      });
      this.app.post(`${prefix}/mcp`, async (req, res) => {
        const server = this.createMcp(provider);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        try {
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
        } finally { await server.close(); }
      });
      this.app.all(`${prefix}/mcp`, (req, res) => { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'This stateless MCP endpoint accepts POST requests' }); });
    }
    this.app.get('/health', (req, res) => res.json({ status: 'ok', version: '4.1.2', sse_clients: this.clients.size, ws_clients: this.websocketHub.getConnectionCount(), uptime: process.uptime() }));
    this.app.use('/api', this.apiRouter.router);
    this.app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
    if (runtime.enableWebUI) {
      const root = path.resolve(process.cwd(), 'web', 'public');
      this.app.use(express.static(root));
      this.app.get('/', (req, res) => res.sendFile(path.join(root, 'index.html')));
    }
    this.app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  }
  start() {
    const runtime = getRuntimeConfig();
    this.server = http.createServer(this.app);
    this.websocketHub.attach(this.server, runtime.adminPassword || undefined);
    this.server.listen(runtime.port, runtime.host, () => logger.info('HTTP server listening', { host: runtime.host, port: runtime.port }));
  }
  async stop() {
    for (const client of this.clients.values()) { clearInterval(client.heartbeat); await client.server.close(); }
    this.clients.clear(); this.connectionStore.setSse(0); this.websocketHub.closeAll();
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
  }
  getSseConnections() { return this.clients.size; }
  getWsConnections() { return this.websocketHub.getConnectionCount(); }
}
