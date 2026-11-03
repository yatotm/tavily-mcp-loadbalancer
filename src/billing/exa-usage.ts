import axios from 'axios';
import { AppDatabase } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { EventBus } from '../core/event-bus.js';

/** Team Management requires a separate Service Key, never the pooled search key. */
export class ExaUsageClient {
  private running = new Map<number, Promise<any>>();
  private timer?: NodeJS.Timeout;
  private abort = new AbortController();
  private stopped = false;
  constructor(private db: AppDatabase, private pool: KeyPool, private events?: EventBus,
    private baseUrl = 'https://admin-api.exa.ai/team-management') {}
  sync(id: number): Promise<any> {
    if (this.running.has(id)) return this.running.get(id)!;
    const promise = this.fetch(id).finally(() => this.running.delete(id));
    this.running.set(id, promise); return promise;
  }
  private async fetch(id: number) {
    const key = this.db.getApiKeyById(id);
    if (key.provider !== 'exa') throw new Error('This key does not belong to Exa');
    const config = this.db.exaBilling.getConfig(id);
    if (!config.publicId || !config.serviceKey) throw new Error('请先配置 Exa Service Key 和 publicId；普通搜索 Key 不能查询官方用量');
    const start = new Date().toISOString().slice(0,7) + '-01T00:00:00.000Z';
    const end = new Date().toISOString();
    const options = { headers: { 'x-api-key': config.serviceKey }, timeout: 10000, maxRedirects: 0, signal: this.abort.signal };
    try {
      const [metadata, usage] = await Promise.all([
        axios.get(`${this.baseUrl}/api-keys/${encodeURIComponent(config.publicId)}`, options),
        axios.get(`${this.baseUrl}/api-keys/${encodeURIComponent(config.publicId)}/usage`, { ...options, params: { start_date: start, end_date: end } }),
      ]);
      if (this.stopped) throw new Error('Usage sync stopped');
      const data = usage.data, info = metadata.data?.apiKey;
      if (!info || data?.error || typeof data?.total_cost_usd !== 'number' || !Number.isFinite(data.total_cost_usd) || data.total_cost_usd < 0) throw new Error('官方用量返回格式异常');
      // Do not store the legacy api_key_id/id/secret fields: they can contain credentials.
      const snapshot = { period: start.slice(0,7), periodStart: start, periodEnd: end, usedUsd: data.total_cost_usd,
        budgetUsd: typeof info.budgetCents === 'number' && Number.isFinite(info.budgetCents) && info.budgetCents >= 0 ? info.budgetCents / 100 : null,
        isOverBudget: typeof info.isOverBudget === 'boolean' ? info.isOverBudget : null,
        syncedAt: end };
      this.db.exaBilling.setSnapshot(id, snapshot);
      const current = this.db.getApiKeyById(id);
      if (info.isOverBudget === true) this.pool.pauseQuota(id, 'API_KEY_BUDGET_EXCEEDED');
      else if (info.isOverBudget === false && current.status === 'quota_exceeded' && current.quota_reason === 'API_KEY_BUDGET_EXCEEDED') {
        this.pool.updateStatus(id, 'active'); this.pool.resetErrors(id);
      }
      this.events?.emitEvent('key_status', { id, provider: 'exa' });
      return snapshot;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const message = status === 401 || status === 403 ? 'Exa Service Key 无效、未开通管理接口或无权访问该团队；搜索 Key 状态未修改'
        : status === 404 ? '找不到该 Exa publicId，请核对所属团队'
        : status ? `Exa 用量接口返回 HTTP ${status}；搜索 Key 状态未修改`
        : 'Exa 官方用量同步失败，请检查连接和配置';
      if (!this.stopped) this.db.exaBilling.setSyncError(id, message);
      throw new Error(message);
    }
  }
  start() {
    const run = async () => {
      for (const id of this.db.exaBilling.configuredKeyIds()) {
        if (this.stopped) return;
        try {
          const key = this.db.getApiKeyById(id);
          if (key.status === 'banned' || key.status === 'disabled') continue;
          await this.sync(id);
        } catch { /* A key can be deleted mid-cycle. Sync errors are visible in settings. */ }
      }
    };
    void run(); this.timer = setInterval(() => { void run(); }, 6 * 3600000); this.timer.unref();
  }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.abort.abort(); }
}
