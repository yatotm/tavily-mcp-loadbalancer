import axios from 'axios';
import { AppDatabase } from '../data/database.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { getCurrentQuotaPeriod } from '../utils/date.js';

// Tavily API actual response format
export interface TavilyUsageApiResponse {
  key: {
    usage: number;
    limit: number | null;
  };
  account: {
    current_plan: string;
    plan_usage: number;
    plan_limit: number | null;
    extract_usage: number;
    map_usage: number;
    paygo_usage: number;
    paygo_limit: number | null;
  };
}

// Normalized usage data for internal use
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRetriableUsageError = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status === 429) return true;

  const data = error.response?.data;
  const message = typeof data === 'string'
    ? data
    : JSON.stringify(data ?? error.message);
  const normalized = message.toLowerCase();
  return normalized.includes('excessive requests') || normalized.includes('rate limit');
};

const retryDelayFromError = (error: unknown): number => {
  if (!axios.isAxiosError(error)) return config.usageSyncRetryDelayMs;
  const retryAfter = error.response?.headers?.['retry-after'];
  const retryAfterSeconds = Array.isArray(retryAfter) ? Number(retryAfter[0]) : Number(retryAfter);
  return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : config.usageSyncRetryDelayMs;
};

export class UsageClient {
  constructor(private db: AppDatabase) {}

  async fetchUsage(apiKey: string): Promise<TavilyUsageApiResponse> {
    const response = await axios.get<TavilyUsageApiResponse>('https://api.tavily.com/usage', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Client-Source': 'MCP',
        accept: 'application/json',
      },
      timeout: 10000,
    });
    return response.data;
  }

  async fetchUsageAndSync(keyId: number, apiKey: string): Promise<TavilyUsageApiResponse> {
    let response: TavilyUsageApiResponse;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await this.fetchUsage(apiKey);
        break;
      } catch (error: unknown) {
        if (attempt >= config.usageSyncMaxRetries || !isRetriableUsageError(error)) {
          throw error;
        }
        const delayMs = retryDelayFromError(error);
        logger.warn('Usage sync rate limited, retrying', { keyId, attempt: attempt + 1, delayMs });
        await sleep(delayMs);
      }
    }
    const yearMonth = getCurrentQuotaPeriod();

    // Use account level usage data
    const quotaLimit = response.account.plan_limit;
    const usedCount = response.account.plan_usage;

    logger.info('Usage sync result', {
      keyId,
      plan: response.account.current_plan,
      used: usedCount,
      limit: quotaLimit
    });

    this.db.updateMonthlyQuotaFromUsage({
      keyId,
      yearMonth,
      quotaLimit,
      usedCount,
      resetAt: null,
    });

    return response;
  }

  async syncUsageForKey(keyId: number, apiKey: string): Promise<void> {
    try {
      await this.fetchUsageAndSync(keyId, apiKey);
    } catch (error: any) {
      logger.warn('Failed to sync usage for key', { keyId, error: error?.message });
    }
  }
}
