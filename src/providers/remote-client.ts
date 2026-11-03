import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { AppDatabase, Provider } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { LogManager } from '../data/log-manager.js';
import { RequestExecutor, RequestGate, UpstreamFailure } from '../client/request-executor.js';
import { classifyError, classifyMcpResult } from '../loadbalancer/error-classifier.js';
import { exaCharge } from '../billing/exa-cost.js';
import { getRuntimeConfig } from '../utils/runtime-config.js';
import { EventBus } from '../core/event-bus.js';

export class RemoteClient {
  private executor: RequestExecutor;
  constructor(private provider: Provider, private db: AppDatabase, private pool: KeyPool,
    logs: LogManager, private tools: Tool[], gate: RequestGate, events?: EventBus) {
    this.executor = new RequestExecutor(db, pool, logs, gate, events);
  }

  private async connect<T>(key: string, timeout: number, fn: (client: Client) => Promise<T>): Promise<T> {
    const url = new URL(this.provider === 'exa' ? 'https://mcp.exa.ai/mcp' : 'https://mcp.tavily.com/mcp');
    if (this.provider === 'exa') url.searchParams.set('tools', this.tools.map(tool => tool.name).join(','));
    const client = new Client({ name: 'search-mcp-gateway', version: '4.1.2' });
    const abort = AbortSignal.timeout(timeout);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${key}`, ...(this.provider === 'exa' ? { 'x-api-key': key } : {}) } },
      fetch: async (input, init) => {
        const response = await fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([abort, init.signal]) : abort });
        if (!response.ok) {
          let data: any;
          try { data = await response.clone().json(); } catch { data = { message: `Upstream HTTP ${response.status}` }; }
          throw new UpstreamFailure(classifyError(new Error('Upstream request failed'), data, response.status, response.headers.get('retry-after') || undefined, this.provider));
        }
        return response;
      },
    });
    try {
      await client.connect(transport, { timeout: Math.min(timeout, 15000), signal: abort });
      return await fn(client);
    } catch (error: any) {
      if (error instanceof UpstreamFailure) throw error;
      // SDK transport errors carry the HTTP status in `code`; convert only HTTP errors.
      const status = typeof error.code === 'number' && error.code >= 400 && error.code < 600 ? error.code : undefined;
      const message = String(error.message || 'Upstream MCP failure').split(key).join('[redacted]').slice(0, 500);
      if (status) throw new UpstreamFailure(classifyError(new axios.AxiosError(message), error.data || { message }, status, undefined, this.provider));
      if (abort.aborted || error instanceof TypeError || /fetch failed|ECONN|timed out|timeout/i.test(message)) throw new axios.AxiosError('Upstream MCP connection failed or timed out', 'ECONNRESET');
      throw new Error('Upstream MCP protocol failure');
    } finally { await client.close().catch(() => undefined); }
  }

  async discover(): Promise<Tool[]> {
    const key = this.pool.getActiveKeys()[0];
    if (!key) throw new Error(`No active ${this.provider} key`);
    return this.connect(key.key_value, 20000, async c => {
      const tools: Tool[] = [];
      let cursor: string | undefined;
      do { const page = await c.listTools({ cursor }); tools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
      return tools;
    });
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const tasks = [args.runId, args.previousRunId, args.researchId].filter(v => typeof v === 'string' && v) as string[];
    const owners = new Set(tasks.map(id => this.db.getTaskKey(this.provider, id)).filter(id => id !== null));
    if (owners.size > 1) throw new Error('Task arguments refer to different key owners');
    const task = tasks[0];
    const keyId = task ? this.db.getTaskKey(this.provider, task) : null;
    if (task && keyId === null && this.pool.getAllKeys().length > 1) throw new Error('Unknown task owner; cannot safely choose a key');
    const isJob = ['agent_run', 'deep_researcher_start', 'tavily_research'].includes(name) && !args.runId;
    let usage: { cost_usd: number | null; cost_source: string } | undefined;
    return this.executor.run(name, args, (key, timeout) => {
      usage = undefined;
      return this.connect(key.key_value, timeout, async c => {
      const result = await c.callTool({ name, arguments: args }, undefined, { timeout, resetTimeoutOnProgress: false }) as CallToolResult;
      this.bindTasks(result, key.id);
      const failure = classifyMcpResult(result, this.provider);
      if (this.provider === 'exa') {
        const charge = exaCharge(name, args, result, key.id, Boolean(failure));
        if (charge) usage = this.db.exaBilling.record(key.id, charge);
      }
      if (failure) throw new UpstreamFailure(failure, failure.type === 'client' ? { ...result, isError: true } : undefined);
      return result;
    }); }, { usage: () => usage, keyId: keyId ?? undefined, retrySafe: !isJob, timeoutMs: isJob ? Math.max(180000, getRuntimeConfig().requestTimeoutMs) : undefined });
  }

  private bindTasks(result: CallToolResult, keyId: number): void {
    const visit = (value: any) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (['runId', 'run_id', 'researchId', 'research_id', 'request_id'].includes(key) && typeof item === 'string') this.db.bindTask(this.provider, item, keyId);
        else if (typeof item === 'object') visit(item);
      }
    };
    const bindRoot = (value: any) => {
      if (value && typeof value.id === 'string' && typeof value.status === 'string') this.db.bindTask(this.provider, value.id, keyId);
      visit(value);
    };
    bindRoot(result.structuredContent);
    for (const item of result.content) {
      if (item.type !== 'text') continue;
      try { bindRoot(JSON.parse(item.text)); } catch { /* Some official legacy tools return prose. */ }
      for (const match of item.text.matchAll(/(?:runId|run_id|researchId|research_id|Research ID|Run ID)["\s:]+([a-zA-Z0-9_-]{8,})/g)) this.db.bindTask(this.provider, match[1], keyId);
    }
  }
}
