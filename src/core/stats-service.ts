import { AppDatabase, Provider } from '../data/database.js';
import { ConnectionStore } from './connection-store.js';
import { getCurrentQuotaPeriod, daysAgoIso } from '../utils/date.js';

export class StatsService {
  constructor(private db: AppDatabase, private connectionStore: ConnectionStore) {}

  getOverview(provider?: Provider) {
    const keys = this.db.getApiKeys(provider);
    const totalKeys = keys.length;
    const activeKeys = keys.filter((key) => key.status === 'active').length;
    const disabledKeys = keys.filter((key) => key.status === 'disabled').length;
    const quotaKeys = keys.filter((key) => key.status === 'quota_exceeded').length;
    const bannedKeys = keys.filter((key) => key.status === 'banned').length;

    const yearMonth = getCurrentQuotaPeriod();
    const quotaKeysSet = new Set((provider === 'exa' ? [] : this.db.getApiKeys('tavily')).map(k => k.id));
    const quotas = this.db.getMonthlyQuotas(yearMonth).filter(q => quotaKeysSet.has(q.key_id));
    const totalUsed = quotas.reduce((sum, q) => sum + q.used_count, 0);
    const totalLimit = quotas.reduce((sum, q) => sum + (q.quota_limit || 0), 0);
    const knownRemaining = quotas.reduce((sum,q)=>sum+(q.quota_limit === null ? 0 : Math.max(0,q.quota_limit-q.used_count)),0);
    const availableIds = new Set(keys.filter(k=>k.provider==='tavily' && k.status==='active').map(k=>k.id));
    const available = quotas.reduce((sum,q)=>sum+(availableIds.has(q.key_id) && q.quota_limit !== null ? Math.max(0,q.quota_limit-q.used_count) : 0),0);
    const unknownLimitKeys = quotas.filter((q) => q.quota_limit === null).length + Math.max(0, quotaKeysSet.size - quotas.length);

    const totalRequests = this.db.queryRequestLogs({ provider, excludeMaintenance: true, includePayload: false, page: 1, limit: 1 }).total;
    const successCount = this.db.queryRequestLogs({ provider, excludeMaintenance: true, includePayload: false, page: 1, limit: 1, status: 'success' }).total;
    const errorCount = totalRequests - successCount;

    const lastLogs = this.db.queryRequestLogs({ provider, excludeMaintenance: true, includePayload: false, page: 1, limit: 50 }).logs;
    const avgResponse = lastLogs.reduce((sum, log) => sum + (log.response_time_ms || 0), 0) / Math.max(1, lastLogs.length);

    const connectionSnapshot = this.connectionStore.getSnapshot();

    return {
      exa_cost: provider === 'tavily' ? undefined : this.db.exaBilling.summary(),
      system: {
        uptime: process.uptime(),
        sse_connections: connectionSnapshot.sse,
        ws_connections: connectionSnapshot.ws,
      },
      keys: {
        total: totalKeys,
        active: activeKeys,
        disabled: disabledKeys,
        quota_exceeded: quotaKeys,
        banned: bannedKeys,
      },
      requests: {
        total: totalRequests,
        success: successCount,
        failed: errorCount,
        success_rate: totalRequests ? Number(((successCount / totalRequests) * 100).toFixed(2)) : 0,
        avg_response_time_ms: Number(avgResponse.toFixed(2)),
      },
      quota: {
        used: totalUsed,
        limit: unknownLimitKeys === 0 && totalLimit > 0 ? totalLimit : null,
        remaining: unknownLimitKeys === 0 && totalLimit > 0 ? knownRemaining : null,
        unknown_keys: unknownLimitKeys, known_limit: totalLimit, known_remaining: knownRemaining, available, period: yearMonth,
      },
    };
  }

  getToolUsage() {
    const yearMonth = getCurrentQuotaPeriod();
    const quotaKeysSet = new Set(this.db.getApiKeys('tavily').map(k => k.id));
    const quotas = this.db.getMonthlyQuotas(yearMonth).filter(q => quotaKeysSet.has(q.key_id));
    return quotas.reduce(
      (acc, quota) => {
        acc.search += quota.search_count;
        acc.extract += quota.extract_count;
        acc.crawl += quota.crawl_count;
        acc.map += quota.map_count;
        return acc;
      },
      { search: 0, extract: 0, crawl: 0, map: 0 }
    );
  }

  getTimeline(days: number = 30): Record<string, number> {
    const rows = this.db.getDailyRequestCounts(daysAgoIso(days));
    const timeline: Record<string, number> = {};
    rows.forEach((row) => {
      timeline[row.date] = row.count;
    });
    return timeline;
  }
}
