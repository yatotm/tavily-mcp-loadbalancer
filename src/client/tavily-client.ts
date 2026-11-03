import axios from 'axios';
import { AppDatabase } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { LogManager } from '../data/log-manager.js';
import { EventBus } from '../core/event-bus.js';
import { classifyResponsePayload } from '../loadbalancer/error-classifier.js';
import { RequestExecutor, RequestGate, UpstreamFailure } from './request-executor.js';
import { defaultRetryConfig, RetryConfig } from './retry-handler.js';

export class TavilyClient {
  private executor: RequestExecutor;
  constructor(private db: AppDatabase, pool: KeyPool, logs: LogManager, retry: RetryConfig = defaultRetryConfig, events?: EventBus, gate = new RequestGate()) {
    this.executor = new RequestExecutor(db, pool, logs, gate, events);
    this.executor.retryConfig = retry;
  }
  updateRetryConfig(config: RetryConfig) { this.executor.retryConfig = config; }
  search(params: Record<string, unknown>) { return this.request('search', params); }
  extract(params: Record<string, unknown>) { return this.request('extract', params); }
  crawl(params: Record<string, unknown>) { return this.request('crawl', params); }
  map(params: Record<string, unknown>) { return this.request('map', params); }
  feedback(params: Record<string, unknown>) { return this.request('feedback', params); }

  private request(tool: string, params: Record<string, unknown>): Promise<any> {
    const taskId = typeof params.request_id === 'string' ? params.request_id : undefined;
    const boundKey = taskId ? this.db.getTaskKey('tavily', taskId) : null;
    return this.executor.run(tool, params, async (key, timeout) => {
      const response = await axios.post(`https://api.tavily.com/${tool}`, { ...params, ...(tool === 'feedback' || params.include_usage !== undefined ? {} : { include_usage: true }) }, {
        headers: { Authorization: `Bearer ${key.key_value}`, 'X-Client-Source': 'MCP' }, timeout, maxRedirects: 0,
      });
      const failure = classifyResponsePayload(response.data);
      if (failure) throw new UpstreamFailure(failure);
      return response.data;
    }, { keyId: boundKey ?? undefined, retrySafe: tool !== 'feedback', onSuccess: (data, key) => {
      if (typeof data.request_id === 'string') this.db.bindTask('tavily', data.request_id, key.id);
      if (tool === 'feedback') return;
      const count = Array.isArray(data.results) ? data.results.length : 0;
      const fallback = tool === 'search' ? (params.search_depth === 'advanced' ? 2 : 1)
        : tool === 'map' ? Math.ceil(count / 10)
        : Math.ceil(count / 5) * (params.extract_depth === 'advanced' ? 2 : 1) + (tool === 'crawl' ? Math.ceil(count / 10) : 0);
      const credits = data.usage?.credits;
      this.db.incrementMonthlyUsage(key.id, tool, typeof credits === 'number' && credits >= 0 ? credits : fallback);
    } });
  }
}
