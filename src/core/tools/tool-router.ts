import fs from 'node:fs';
import { Ajv } from 'ajv';
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TavilyClient } from '../../client/tavily-client.js';
import { RemoteClient } from '../../providers/remote-client.js';
import { ResultReviewer } from '../../moderation/reviewer.js';
import { Provider } from '../../data/database.js';
import { getRuntimeConfig } from '../../utils/runtime-config.js';

export const upstreamTools = (provider: Provider): Tool[] => JSON.parse(fs.readFileSync(new URL(`../../providers/${provider}-tools.json`, import.meta.url), 'utf8'));
const originalTavily = upstreamTools('tavily');
const originalExa = upstreamTools('exa');
// Preserve the legacy public names while exposing current official names and complete schemas.
const aliases: Record<string, string> = { search: 'tavily_search', ...Object.fromEntries(originalTavily.map(t => [t.name.replace('tavily_', 'tavily-'), t.name])) };

export class ToolRouter {
  private tools: Record<Provider, Tool[]>;
  private ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false });
  private validators = new Map<string, ReturnType<Ajv['compile']>>();
  constructor(private tavilyClient: TavilyClient, private exaClient?: RemoteClient, private tavilyRemote?: RemoteClient, private reviewer?: ResultReviewer) {
    const tavily = structuredClone(originalTavily);
    const search = tavily.find(t => t.name === 'tavily_search')!;
    const props = search.inputSchema.properties as any;
    props.max_results.minimum = 0; // Existing clients and the REST API allow smaller result counts.
    props.include_answer = { anyOf: [{ type: 'boolean' }, { enum: ['basic', 'advanced'] }] };
    props.include_raw_content = { anyOf: [{ type: 'boolean' }, { enum: ['text', 'markdown'] }] };
    props.auto_parameters = { type: 'boolean' };
    props.include_usage = { type: 'boolean' };
    props.chunks_per_source = { type: 'integer', minimum: 1, maximum: 3 };
    props.days = { type: 'integer', minimum: 1 };
    for (const t of tavily) {
      const p = t.inputSchema.properties as any;
      if (['tavily_crawl', 'tavily_extract'].includes(t.name)) {
        p.chunks_per_source = { type: 'integer', minimum: 1, maximum: 5 };
        p.timeout = { type: 'number', minimum: 1, maximum: 150 };
      }
      if (['tavily_crawl', 'tavily_map'].includes(t.name)) {
        p.exclude_paths = { type: 'array', items: { type: 'string' } };
        p.exclude_domains = { type: 'array', items: { type: 'string' } };
        p.allow_subdomains = { type: 'boolean' };
      }
    }
    this.tools = { tavily, exa: originalExa };
  }
  listTools(provider: Provider = 'tavily'): Tool[] {
    const tools = provider === 'exa' ? this.tools.exa : [...this.tools.tavily, ...this.tools.tavily.map(t => ({ ...t, name: t.name.replace('tavily_', 'tavily-') }))];
    // Filtering can remove fields; do not promise an output schema that runtime review can invalidate.
    return tools.map(({ outputSchema, ...tool }) => tool);
  }
  async callTool(name: string, args: any, provider: Provider = 'tavily'): Promise<CallToolResult> {
    const canonical = provider === 'tavily' ? aliases[name] || name : name;
    const definition = this.tools[provider].find(t => t.name === canonical);
    if (!definition) throw new Error(`Unknown ${provider} tool: ${name}`);
    if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) throw new Error('Tool arguments must be an object');
    let payload = { ...(args || {}) };
    if (canonical === 'tavily_search') {
      payload = { ...getRuntimeConfig().defaultParameters, ...payload };
      const ranges: Record<string, string> = { d: 'day', w: 'week', m: 'month', y: 'year' };
      if (ranges[payload.time_range]) payload.time_range = ranges[payload.time_range];
      if (payload.country) payload.topic = 'general';
      if (payload.start_date || payload.end_date) { delete payload.time_range; delete payload.days; }
    }
    // Empty optional strings from older clients are treated as omitted, never discard false/zero/arrays.
    for (const [key, value] of Object.entries(payload)) if (value === '' && !(definition.inputSchema.required || []).includes(key)) delete payload[key];
    if ('api_key' in payload || 'apiKey' in payload) throw new Error('Credentials are managed by the gateway key pool');
    const key = `${provider}:${canonical}`;
    if (!this.validators.has(key)) this.validators.set(key, this.ajv.compile(definition.inputSchema));
    const validate = this.validators.get(key)!;
    if (!validate(payload)) throw new Error(`Invalid tool arguments: ${this.ajv.errorsText(validate.errors)}`);
    let result: CallToolResult;
    const operation = canonical.replace('tavily_', '');
    if (provider === 'tavily' && ['search', 'extract', 'crawl', 'map', 'feedback'].includes(operation)) {
      const data = await (this.tavilyClient as any)[operation](payload);
      const reviewed = this.reviewer ? await this.reviewer.review(provider, { content: [{ type: 'text', text: JSON.stringify(data) }] }) : { content: [{ type: 'text', text: JSON.stringify(data) }] };
      return reviewed;
    } else {
      const client = provider === 'exa' ? this.exaClient : this.tavilyRemote;
      if (!client) throw new Error('Provider is not configured');
      result = await client.call(canonical, payload);
    }
    return this.reviewer ? this.reviewer.review(provider, result) : result;
  }
}
