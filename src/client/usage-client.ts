import axios from 'axios';
import { AppDatabase } from '../data/database.js';
import { logger } from '../utils/logger.js';
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

  async syncUsageForKey(keyId: number, apiKey: string): Promise<void> {
    try {
      const response = await this.fetchUsage(apiKey);
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
    } catch (error: any) {
      logger.warn('Failed to sync usage for key', { keyId, error: error?.message });
    }
  }
}
