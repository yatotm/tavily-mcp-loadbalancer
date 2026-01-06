import axios, { AxiosInstance } from 'axios';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { classifyError, classifyResponsePayload, ErrorClassification } from '../loadbalancer/error-classifier.js';
import { AppDatabase } from '../data/database.js';
import { LogManager } from '../data/log-manager.js';
import { UsageClient } from './usage-client.js';
import { defaultRetryConfig, computeDelay, sleep, RetryConfig } from './retry-handler.js';
import { getRuntimeConfig } from '../utils/runtime-config.js';
import { EventBus } from '../core/event-bus.js';
import { logger } from '../utils/logger.js';

interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
}

export class TavilyClient {
  private axiosInstance: AxiosInstance;
  private queue: Array<QueuedRequest<any>> = [];
  private activeRequests = 0;
  private retryConfig: RetryConfig;

  private baseURLs = {
    search: 'https://api.tavily.com/search',
    extract: 'https://api.tavily.com/extract',
    crawl: 'https://api.tavily.com/crawl',
    map: 'https://api.tavily.com/map',
  };

  constructor(
    private db: AppDatabase,
    private keyPool: KeyPool,
    private usageClient: UsageClient,
    private logManager: LogManager,
    retryConfig: RetryConfig = defaultRetryConfig,
    private eventBus?: EventBus
  ) {
    this.retryConfig = retryConfig;
    this.axiosInstance = axios.create({
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'X-Client-Source': 'MCP',
      },
    });
  }

  updateRetryConfig(config: RetryConfig): void {
    this.retryConfig = config;
  }

  private getMaxConcurrent(): number {
    const runtime = getRuntimeConfig();
    return runtime.maxConcurrentRequests;
  }

  private getTimeoutMs(): number {
    const runtime = getRuntimeConfig();
    return runtime.requestTimeoutMs;
  }

  private async enqueueRequest<T>(executor: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ execute: executor, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.activeRequests >= this.getMaxConcurrent() || this.queue.length === 0) {
      return;
    }
    const request = this.queue.shift();
    if (!request) return;
    this.activeRequests += 1;
    try {
      const result = await request.execute();
      request.resolve(result);
    } catch (error) {
      request.reject(error);
    } finally {
      this.activeRequests -= 1;
      if (this.queue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  async search(params: Record<string, unknown>): Promise<any> {
    return this.makeRequest('search', this.baseURLs.search, params);
  }

  async extract(params: Record<string, unknown>): Promise<any> {
    return this.makeRequest('extract', this.baseURLs.extract, params);
  }

  async crawl(params: Record<string, unknown>): Promise<any> {
    return this.makeRequest('crawl', this.baseURLs.crawl, params);
  }

  async map(params: Record<string, unknown>): Promise<any> {
    return this.makeRequest('map', this.baseURLs.map, params);
  }

  private normalizeToolName(tool: string): string {
    if (tool.includes('search')) return 'search';
    if (tool.includes('extract')) return 'extract';
    if (tool.includes('crawl')) return 'crawl';
    if (tool.includes('map')) return 'map';
    return tool;
  }

  private calculateCredits(toolName: string, params: Record<string, unknown>): number {
    const tool = this.normalizeToolName(toolName);

    switch (tool) {
      case 'search': {
        const depth = params.search_depth as string | undefined;
        return depth === 'advanced' ? 2 : 1;
      }
      case 'extract': {
        const depth = params.extract_depth as string | undefined;
        const urls = Array.isArray(params.urls) ? params.urls.length : 0;
        const creditsPerBatch = depth === 'advanced' ? 2 : 1;
        return Math.ceil(urls / 5) * creditsPerBatch;
      }
      case 'crawl': {
        const depth = params.extract_depth as string | undefined;
        const limit = typeof params.limit === 'number' ? params.limit : 50;
        const mapCredits = Math.ceil(limit / 10);
        const extractCredits = Math.ceil(limit / 5) * (depth === 'advanced' ? 2 : 1);
        return mapCredits + extractCredits;
      }
      case 'map': {
        const limit = typeof params.limit === 'number' ? params.limit : 50;
        return Math.ceil(limit / 10);
      }
      default:
        return 1;
    }
  }

  private async makeRequest(toolName: string, endpoint: string, params: Record<string, unknown>): Promise<any> {
    return this.enqueueRequest(async () => {
      const startTotal = Date.now();
      let attempt = 0;
      let lastError: Error | null = null;

      while (attempt <= this.retryConfig.maxRetries) {
        const key = this.keyPool.getNextKey();
        if (!key) {
          throw new Error('No available API keys');
        }

        const requestStart = Date.now();
        const payload = {
          ...params,
          api_key: key.key_value,
        };

        try {
          logger.debug('Tavily API request', {
            endpoint,
            params: { ...params, api_key: '***' },
          });
          const response = await this.axiosInstance.post(endpoint, payload, {
            timeout: this.getTimeoutMs(),
            headers: {
              Authorization: `Bearer ${key.key_value}`,
            },
          });

          const payloadError = classifyResponsePayload(response.data);
          if (payloadError) {
            throw Object.assign(new Error(payloadError.message), { response: response, classification: payloadError });
          }

          this.keyPool.markSuccess(key.id);
          const creditCount = this.calculateCredits(toolName, params);
          this.db.incrementMonthlyUsage(key.id, this.normalizeToolName(toolName), creditCount);

          // 限制响应数据大小（最多50KB）
          let responseDataStr: string | null = null;
          try {
            const fullResponse = JSON.stringify(response.data);
            responseDataStr = fullResponse.length > 50000 ? fullResponse.slice(0, 50000) + '...(truncated)' : fullResponse;
          } catch {
            responseDataStr = null;
          }

          this.logManager.enqueue({
            key_id: key.id,
            tool_name: toolName,
            request_params: JSON.stringify(params),
            response_data: responseDataStr,
            response_status: 'success',
            response_time_ms: Date.now() - requestStart,
            error_type: null,
            error_message: null,
          });
          this.eventBus?.emitEvent('request', {
            tool_name: toolName,
            key_id: key.id,
            duration_ms: Date.now() - requestStart,
          });
          return response.data;
        } catch (error: any) {
          let classification: ErrorClassification;
          const status = axios.isAxiosError(error) ? error.response?.status : undefined;
          const retryAfter = axios.isAxiosError(error) ? error.response?.headers?.['retry-after'] : undefined;
          const responseData = axios.isAxiosError(error) ? error.response?.data : undefined;

          if (error?.classification) {
            classification = error.classification as ErrorClassification;
          } else {
            classification = classifyError(error, responseData, status, retryAfter);
          }

          if (status === 401 || status === 403 || status === 432 || status === 433) {
            classification = {
              ...classification,
              type: 'auth',
              shouldRetry: false,
              shouldDisableKey: true,
              message: classification.message || 'Invalid or disabled API key',
              incrementErrorCount: true,
            };
          }

          if (status === 429) {
            let remaining = Infinity;
            try {
              const usage = await this.usageClient.fetchUsageAndSync(key.id, key.key_value);
              remaining = usage.account.plan_limit !== null
                ? usage.account.plan_limit - usage.account.plan_usage
                : Infinity;
            } catch {
              // ignore usage sync errors
            }

            if (remaining <= 0) {
              classification = {
                ...classification,
                type: 'quota_exceeded',
                shouldRetry: false,
                shouldDisableKey: true,
                message: 'API quota exceeded',
                incrementErrorCount: true,
              };
            } else {
              classification = {
                ...classification,
                type: 'rate_limit',
                shouldRetry: true,
                shouldDisableKey: false,
                message: 'Rate limited, will retry',
                incrementErrorCount: false,
              };
            }
          }

          if (classification.shouldDisableKey) {
            const statusToSet = classification.type === 'quota_exceeded'
              ? 'quota_exceeded'
              : classification.type === 'auth'
                ? 'banned'
                : 'disabled';
            this.keyPool.updateStatus(key.id, statusToSet);
          }

          if (classification.type === 'rate_limit') {
            const delay = classification.retryDelay ?? computeDelay(attempt, this.retryConfig);
            this.keyPool.setCooldown(key.id, delay);
            classification.retryDelay = delay;
          }

          this.keyPool.markFailure(key.id, classification.message, classification.incrementErrorCount);

          // 记录错误响应数据
          let errorResponseStr: string | null = null;
          if (responseData) {
            try {
              const fullResponse = JSON.stringify(responseData);
              errorResponseStr = fullResponse.length > 50000 ? fullResponse.slice(0, 50000) + '...(truncated)' : fullResponse;
            } catch {
              errorResponseStr = null;
            }
          }

          this.logManager.enqueue({
            key_id: key.id,
            tool_name: toolName,
            request_params: JSON.stringify(params),
            response_data: errorResponseStr,
            response_status: 'error',
            response_time_ms: Date.now() - requestStart,
            error_type: classification.type,
            error_message: classification.message,
          });
          this.eventBus?.emitEvent('error', {
            tool_name: toolName,
            key_id: key.id,
            error_type: classification.type,
            message: classification.message,
          });

          lastError = new Error(classification.message);

          if (classification.shouldRetry && attempt < this.retryConfig.maxRetries) {
            const delay = classification.retryDelay ?? computeDelay(attempt, this.retryConfig);
            await sleep(delay);
            attempt += 1;
            continue;
          }

          throw lastError;
        }
      }

      throw lastError ?? new Error('Request failed');
    });
  }
}
