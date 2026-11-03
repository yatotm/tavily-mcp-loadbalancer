import axios from 'axios';
import { classifyResponsePayload } from '../loadbalancer/error-classifier.js';
import { UpstreamFailure } from './request-executor.js';
import { nextReset } from '../loadbalancer/quota-policy.js';
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

const finiteNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

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
    const failure = classifyResponsePayload(response.data);
    if (failure) throw new UpstreamFailure(failure);
    if (!response.data?.key && !response.data?.account) throw new Error('Invalid Tavily usage response');
    return response.data;
  }

  async fetchUsageAndSync(keyId: number, apiKey: string): Promise<TavilyUsageApiResponse> {
    const response = await this.fetchUsage(apiKey);
    const yearMonth = getCurrentQuotaPeriod();

    // Free Researcher keys may report key.limit as null while account.plan_limit is 1000.
    // Prefer account-level values and fall back to key-level values for compatibility.
    const quotaLimit = finiteNumberOrNull(response.account?.plan_limit)
      ?? finiteNumberOrNull(response.key?.limit);
    const usedCount = finiteNumberOrNull(response.account?.plan_usage)
      ?? finiteNumberOrNull(response.key?.usage)
      ?? 0;

    logger.info('Usage sync result', {
      keyId,
      plan: response.account?.current_plan,
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

    const current = this.db.getApiKeyById(keyId);
    const keyLimit = finiteNumberOrNull(response.key?.limit), keyUsed = finiteNumberOrNull(response.key?.usage);
    const planLimit = finiteNumberOrNull(response.account?.plan_limit), planUsed = finiteNumberOrNull(response.account?.plan_usage);
    const paygoLimit = finiteNumberOrNull(response.account?.paygo_limit), paygoUsed = finiteNumberOrNull(response.account?.paygo_usage);
    const keyExhausted = keyLimit !== null && keyUsed !== null && keyUsed >= keyLimit;
    const accountExhausted = planLimit !== null && planUsed !== null && planUsed >= planLimit && paygoLimit !== null && (paygoUsed ?? 0) >= paygoLimit;
    if (current.status === 'active' && (keyExhausted || accountExhausted)) {
      this.db.updateApiKeyStatus(keyId,'quota_exceeded');
      this.db.setQuotaPause(keyId,'TAVILY_USAGE_LIMIT',nextReset('tavily','TAVILY_USAGE_LIMIT'));
    }
    // A successful /usage response is not proof that a revoked/disabled key should be restored.
    // Only a previously quota-paused key with positively confirmed capacity may resume.
    const keyHasCapacity = keyLimit === null || (keyUsed !== null && keyUsed < keyLimit);
    const accountHasCapacity = (planLimit !== null && planUsed !== null && planUsed < planLimit) || (paygoLimit !== null && paygoUsed !== null && paygoUsed < paygoLimit);
    if (current.status === 'quota_exceeded' && keyHasCapacity && accountHasCapacity) {
      this.db.updateApiKeyStatus(keyId,'active'); this.db.setQuotaPause(keyId,null,null);
    }
    return response;
  }
}
