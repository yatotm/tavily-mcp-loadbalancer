import axios from 'axios';
import { AppDatabase, ApiKeyRecord, Provider } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { LogManager } from '../data/log-manager.js';
import { classifyError, ErrorClassification } from '../loadbalancer/error-classifier.js';
import { getRuntimeConfig } from '../utils/runtime-config.js';
import { serializePayloadForLog } from './logging-utils.js';
import { EventBus } from '../core/event-bus.js';
import { computeDelay, defaultRetryConfig, RetryConfig, sleep } from './retry-handler.js';

/** A bounded queue; a request's deadline includes time spent waiting for a slot. */
export class RequestGate {
  private active = 0;
  private waiting: Array<() => void> = [];
  async run<T>(fn: () => Promise<T>, deadline: number): Promise<T> {
    if (this.active >= Math.max(1, getRuntimeConfig().maxConcurrentRequests)) {
      if (this.waiting.length >= getRuntimeConfig().maxQueuedRequests) throw new Error('Gateway busy: request queue is full');
      await new Promise<void>((resolve, reject) => {
        const ready = () => { clearTimeout(timer); this.active++; resolve(); };
        const timer = setTimeout(() => {
          this.waiting = this.waiting.filter(item => item !== ready);
          reject(new Error('Gateway queue timeout'));
        }, Math.max(1, deadline - Date.now()));
        this.waiting.push(ready);
      });
    } else this.active++;
    try { return await fn(); }
    finally {
      this.active--;
      while (this.waiting.length && this.active < Math.max(1, getRuntimeConfig().maxConcurrentRequests)) this.waiting.shift()!();
    }
  }
}

export class UpstreamFailure extends Error {
  constructor(public classification: ErrorClassification, public result?: unknown) { super(classification.message); }
}

export class RequestExecutor {
  retryConfig: RetryConfig = defaultRetryConfig;
  constructor(private db: AppDatabase, private pool: KeyPool, private logs: LogManager,
    private gate: RequestGate, private events?: EventBus) {}

  async run<T>(tool: string, params: Record<string, unknown>, operation: (key: ApiKeyRecord, timeout: number) => Promise<T>,
    options: { keyId?: number; retrySafe?: boolean; onSuccess?: (data: T, key: ApiKeyRecord) => void; timeoutMs?: number; usage?: () => { cost_usd: number | null; cost_source: string } | undefined } = {}): Promise<T> {
    const deadline = Date.now() + (options.timeoutMs ?? getRuntimeConfig().requestTimeoutMs);
    return this.gate.run(async () => {
      let last: Error = new Error('No available API keys');
      for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
        const key = options.keyId === undefined ? this.pool.getNextKey() : this.pool.getActiveKeys().find(k => k.id === options.keyId);
        if (!key) throw new Error(options.keyId ? 'The key for this task is unavailable; restore it before continuing' : last.message);
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Upstream request deadline exceeded');
        const start = Date.now();
        let result: T;
        try {
          result = await operation(key, remaining);
        } catch (error: any) {
          let c = error instanceof UpstreamFailure ? error.classification : classifyError(error, undefined, undefined, undefined, this.pool.provider);
          // Never expose a credential echoed by an upstream service.
          c = { ...c, message: c.message.split(key.key_value).join('[redacted]').slice(0, 500) };
          if (c.type === 'quota_exceeded') this.pool.pauseQuota(key.id, c.code);
          else if (c.shouldDisableKey) this.pool.updateStatus(key.id, 'banned');
          if (c.type === 'rate_limit') this.pool.setCooldown(key.id, c.retryDelay ?? 1000);
          this.pool.markFailure(key.id, c.message, c.incrementErrorCount);
          this.log(tool, params, key, start, undefined, c, options.usage?.());
          last = new Error(c.message);
          if (error instanceof UpstreamFailure && error.result !== undefined) return error.result as T;
          // Authentication/quota failures are safe to fail over. Never replay a possibly-created paid job.
          const canRetry = c.shouldDisableKey || (c.shouldRetry && (options.retrySafe !== false || c.requestNotProcessed));
          if (!canRetry || options.keyId !== undefined || attempt >= this.retryConfig.maxRetries) throw last;
          if (!c.shouldDisableKey && !(c.type === 'rate_limit' && this.pool.getActiveKeys().length)) {
            const delay = c.retryDelay ?? computeDelay(attempt, this.retryConfig);
            if (delay >= deadline - Date.now()) throw last;
            await sleep(delay);
          }
          continue;
        }
        // Bookkeeping failures must never replay a successful, billable upstream request.
        this.pool.markSuccess(key.id);
        options.onSuccess?.(result, key);
        this.log(tool, params, key, start, result, undefined, options.usage?.());
        return result;
      }
      throw last;
    }, deadline);
  }

  private log(tool: string, params: unknown, key: ApiKeyRecord, start: number, result?: unknown, error?: ErrorClassification, usage?: { cost_usd: number | null; cost_source: string }): void {
    this.logs.enqueue({ ...usage, provider: this.pool.provider, key_id: key.id, tool_name: tool,
      request_params: serializePayloadForLog(params, 4000),
      response_data: getRuntimeConfig().logResponseBodies && !error ? serializePayloadForLog(result, 8000) : null,
      response_status: error ? 'error' : 'success', response_time_ms: Date.now() - start,
      error_type: error?.type ?? null, error_message: error?.message ?? null });
    this.events?.emitEvent(error ? 'error' : 'request', { provider: this.pool.provider, tool_name: tool, key_id: key.id, duration_ms: Date.now() - start });
  }
}
