import { AppDatabase } from '../data/database.js';
import { ConnectionStore } from './connection-store.js';
import { getCurrentQuotaPeriod, daysAgoIso } from '../utils/date.js';

export class StatsService {
  constructor(private db: AppDatabase, private connectionStore: ConnectionStore) {}

  getOverview() {
    const keys = this.db.getApiKeys();
    const totalKeys = keys.length;
    const activeKeys = keys.filter((key) => key.status === 'active').length;
    const disabledKeys = keys.filter((key) => key.status === 'disabled').length;
    const quotaKeys = keys.filter((key) => key.status === 'quota_exceeded').length;
    const bannedKeys = keys.filter((key) => key.status === 'banned').length;

    const yearMonth = getCurrentQuotaPeriod();
    const quotas = this.db.getMonthlyQuotas(yearMonth);
    const totalUsed = quotas.reduce((sum, q) => sum + q.used_count, 0);
    const totalLimit = quotas.reduce((sum, q) => sum + (q.quota_limit || 0), 0);

    const totalRequests = this.db.queryRequestLogs({ page: 1, limit: 1 }).total;
    const successCount = this.db.queryRequestLogs({ page: 1, limit: 1, status: 'success' }).total;
    const errorCount = totalRequests - successCount;

    const lastLogs = this.db.queryRequestLogs({ page: 1, limit: 50 }).logs;
    const avgResponse = lastLogs.reduce((sum, log) => sum + (log.response_time_ms || 0), 0) / Math.max(1, lastLogs.length);

    const connectionSnapshot = this.connectionStore.getSnapshot();

    return {
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
        limit: totalLimit || null,
        remaining: totalLimit ? Math.max(0, totalLimit - totalUsed) : null,
      },
    };
  }

  getToolUsage() {
    const yearMonth = getCurrentQuotaPeriod();
    const quotas = this.db.getMonthlyQuotas(yearMonth);
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
    const logs = this.db.queryRequestLogs({
      page: 1,
      limit: 500,
      startDate: daysAgoIso(days),
    }).logs;
    const timeline: Record<string, number> = {};
    logs.forEach((log) => {
      const dateKey = log.created_at.slice(0, 10);
      timeline[dateKey] = (timeline[dateKey] || 0) + 1;
    });
    return timeline;
  }
}
