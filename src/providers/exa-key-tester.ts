import axios from 'axios';
import { AppDatabase } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { EventBus } from '../core/event-bus.js';
import { classifyError, classifyResponsePayload, ErrorClassification } from '../loadbalancer/error-classifier.js';
import { exaCharge } from '../billing/exa-cost.js';

export interface KeyTestResult {
  status: 'success' | 'error';
  message: string;
  durationMs: number;
  costUsd: number | null;
  costSource?: string;
}
// One fixed, low-cost request. No retries, fallback keys, generated summaries or research jobs.
const parameters = { query: 'Exa search engine', type: 'lite', numResults: 1 };
type Search = (key: string, params: typeof parameters) => Promise<any>;
const search: Search = async (key, params) => (await axios.post('https://api.exa.ai/search', params, {
  headers: { 'x-api-key': key }, timeout: 10000, maxRedirects: 0,
})).data;

export class ExaKeyTester {
  private running = new Map<number, Promise<KeyTestResult>>();
  constructor(private db: AppDatabase, private pool: KeyPool, private events?: EventBus, private request: Search = search) {}

  test(id: number): Promise<KeyTestResult> {
    const key = this.db.getApiKeyById(id);
    if (key.provider !== 'exa') throw new Error('该密钥不属于 Exa');
    const existing = this.running.get(id);
    if (existing) return existing;
    const operation = this.run(id, key.key_value).finally(() => this.running.delete(id));
    this.running.set(id, operation);
    return operation;
  }

  private async run(id: number, secret: string): Promise<KeyTestResult> {
    const start = Date.now();
    let data: any, failure: ErrorClassification | null = null;
    try {
      data = await this.request(secret, { ...parameters });
      failure = classifyResponsePayload(data, 'exa');
      if (!failure && !Array.isArray(data?.results)) {
        failure = classifyError(new Error('Exa 返回格式异常'), undefined, 502, undefined, 'exa');
      }
    } catch (error) { failure = classifyError(error, undefined, undefined, undefined, 'exa'); }
    if (failure) failure.message = failure.message.split(secret).join('[redacted]').slice(0, 500);

    let current;
    try { current = this.db.getApiKeyById(id); } catch { /* The key may have been deleted during the request. */ }
    let cost: { cost_usd: number | null; cost_source: string } | undefined;
    const charge = exaCharge('web_search_advanced_exa', parameters, { structuredContent: data }, id, Boolean(failure));
    if (charge) {
      cost = this.db.exaBilling.record(id, { ...charge, tool: 'test' });
      if (!current) this.db.exaBilling.deleteForKey(id);
    }
    if (current) {
      if (failure?.type === 'auth') this.pool.updateStatus(id, 'banned');
      else if (failure?.type === 'quota_exceeded') this.pool.pauseQuota(id, failure.code);
      else if (failure?.type === 'rate_limit') this.pool.setCooldown(id, failure.retryDelay ?? 1000);
      else if (!failure && current.status === 'quota_exceeded') this.pool.updateStatus(id, 'active');
      if (failure) this.db.setKeyLastError(id, failure.message);
      // A manual test never re-enables banned or manually disabled keys.
      this.events?.emitEvent('key_status', { id, provider: 'exa' });
    }
    const result: KeyTestResult = {
      status: failure ? 'error' : 'success', message: failure ? failure.message : 'Exa 搜索测试通过',
      durationMs: Date.now() - start, costUsd: cost?.cost_usd ?? null, costSource: cost?.cost_source,
    };
    this.db.insertRequestLog({
      key_id: id, provider: 'exa', tool_name: 'test', request_params: JSON.stringify(parameters),
      response_data: JSON.stringify(result), response_status: result.status, response_time_ms: result.durationMs,
      error_type: failure?.type ?? null, error_message: failure?.message ?? null,
      cost_usd: result.costUsd, cost_source: result.costSource,
    });
    return result;
  }
}
