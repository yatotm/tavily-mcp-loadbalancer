import { ExaUsageClient } from '../billing/exa-usage.js';
import { ExaKeyTester } from '../providers/exa-key-tester.js';
import { nextReset } from '../loadbalancer/quota-policy.js';
import { DecisionSettings } from '../moderation/config.js';
import { ResultReviewer } from '../moderation/reviewer.js';
import { ToolRouter } from '../core/tools/tool-router.js';
import express from 'express';
import { AppDatabase, Provider } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { EventBus } from '../core/event-bus.js';
import { ConnectionStore } from '../core/connection-store.js';
import { StatsService } from '../core/stats-service.js';
import { maskKey } from '../utils/crypto.js';
import { getCurrentQuotaPeriod, daysAgoIso } from '../utils/date.js';
import { getRuntimeConfig, updateRuntimeConfig } from '../utils/runtime-config.js';
import { UsageSyncScheduler } from '../scheduler/usage-sync.js';

export class ApiRouter {
  public router = express.Router();

  constructor(
    private db: AppDatabase,
    private keyPool: KeyPool,
    private usageSync: UsageSyncScheduler,
    private eventBus: EventBus,
    private connectionStore: ConnectionStore,
    private exaPool = new KeyPool(db, 'exa'),
    private decisionSettings = new DecisionSettings(db),
    private reviewer = new ResultReviewer(decisionSettings),
    private toolRouter?: ToolRouter,
    private exaUsage = new ExaUsageClient(db, exaPool, eventBus),
    private exaKeyTester = new ExaKeyTester(db, exaPool, eventBus)
  ) {
    this.setupRoutes();
  }

  private poolFor(id: number): KeyPool {
    return this.db.getApiKeyById(id).provider === 'exa' ? this.exaPool : this.keyPool;
  }
  private provider(value: unknown): Provider {
    if (value === undefined || value === 'tavily') return 'tavily';
    if (value === 'exa') return 'exa';
    throw new Error('Unknown provider');
  }

  private setupRoutes(): void {
    this.router.get('/health', (req, res) => {
      const runtime = getRuntimeConfig();
      res.json({
        status: 'ok',
        authRequired: Boolean(runtime.adminPassword),
        uptime: process.uptime(),
      });
    });

    this.router.use((req, res, next) => {
      const runtime = getRuntimeConfig();
      if (!runtime.adminPassword) return next();

      const header = req.headers.authorization || '';
      const tokenHeader = req.headers['x-admin-token'] || req.headers['x-admin-password'];
      let token = '';

      if (typeof tokenHeader === 'string') {
        token = tokenHeader;
      } else if (header.startsWith('Bearer ')) {
        token = header.slice('Bearer '.length).trim();
      } else if (header.startsWith('Basic ')) {
        const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
        const parts = decoded.split(':');
        token = parts.length > 1 ? parts.slice(1).join(':') : decoded;
      }

      if (token && token === runtime.adminPassword) {
        return next();
      }

      res.status(401).json({ error: 'Unauthorized' });
    });

    this.router.get('/keys', (req, res) => {
      const yearMonth = getCurrentQuotaPeriod();
      const selectedProvider = req.query.provider ? this.provider(req.query.provider) : undefined;
      const paginated = req.query.page !== undefined || req.query.limit !== undefined;
      const result = paginated ? this.db.queryApiKeys({ provider: selectedProvider, page: Number(req.query.page || 1), limit: Number(req.query.limit || 20),
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        keyword: typeof req.query.keyword === 'string' ? req.query.keyword.slice(0,200) : undefined }) : null;
      const keys = result?.keys ?? this.db.getApiKeys(selectedProvider);
      const quotas = this.db.getMonthlyQuotas(yearMonth);
      const quotaMap = new Map(quotas.map((quota) => [quota.key_id, quota]));
      const syncStateMap = new Map(this.db.getUsageSyncStates().map((state) => [state.key_id, state]));

      const payload = keys.map((key) => {
        const quota = quotaMap.get(key.id);
        const used = quota?.used_count ?? 0;
        const limit = quota?.quota_limit ?? null;
        return {
          id: key.id,
          provider: key.provider,
          key_preview: maskKey(key.key_value),
          display_name: key.display_name,
          status: key.status,
          quota_reason: key.quota_reason, quota_reset_at: key.quota_reset_at,
          billing: key.provider === 'exa' ? this.db.exaBilling.summary(key.id) : null,
          weight: key.weight,
          error_count: key.error_count,
          max_errors: key.max_errors,
          total_requests: key.total_requests,
          successful_requests: key.successful_requests,
          failed_requests: key.failed_requests,
          last_used_at: key.last_used_at,
          last_error_at: key.last_error_at,
          last_error_message: key.last_error_message,
          created_at: key.created_at,
          updated_at: key.updated_at,
          usage_sync: syncStateMap.get(key.id) ?? {
            key_id: key.id,
            last_success_at: null,
            last_attempt_at: null,
            last_status: 'never',
            last_error: null,
            updated_at: key.created_at,
          },
          quota: quota
            ? {
                used_count: used,
                quota_limit: limit,
                remaining: limit !== null ? Math.max(0, limit - used) : null,
                search_count: quota.search_count,
                extract_count: quota.extract_count,
                crawl_count: quota.crawl_count,
                map_count: quota.map_count,
              }
            : null,
        };
      });

      res.json({ keys: payload, total: result?.total ?? keys.length, page: result?.page ?? 1, limit: result?.limit ?? keys.length });
    });

    this.router.post('/keys', async (req, res) => {
      const { key_value, display_name, weight, max_errors, provider } = req.body || {};
      if (!key_value) {
        return res.status(400).json({ error: 'key_value is required' });
      }
      try {
        const record = (this.provider(provider) === 'exa' ? this.exaPool : this.keyPool).addKey({
          keyValue: key_value,
          displayName: display_name,
          weight,
          maxErrors: max_errors,
        });
        const sync = record.provider === 'tavily' ? this.usageSync.enqueueKeys([record.id], 'new_key') : null;
        this.eventBus.emitEvent('key_status', { id: record.id, status: record.status });
        res.json({
          id: record.id,
          key_preview: maskKey(record.key_value),
          sync,
        });
      } catch (error: any) {
        res.status(400).json({ error: error?.message || 'Failed to add key' });
      }
    });

    this.router.post('/keys/import', (req, res) => {
      const { keys, provider } = req.body || {};
      const pool = this.provider(provider) === 'exa' ? this.exaPool : this.keyPool;
      if (!Array.isArray(keys) || keys.length > 1000) {
        return res.status(400).json({ error: 'keys array is required' });
      }
      const formatted = keys
        .map((entry: any) => {
          if (typeof entry === 'string') return { keyValue: entry };
          if (entry && entry.key_value) return { keyValue: entry.key_value, displayName: entry.display_name };
          return null;
        })
        .filter(Boolean) as Array<{ keyValue: string; displayName?: string }>;
      const inserted = pool.importKeys(formatted);
      res.json({ inserted });
    });

    this.router.post('/keys/batch/enable', (req, res) => {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || ids.some(id => !Number.isInteger(id) || id < 1)) {
        return res.status(400).json({ error: 'ids array is required' });
      }
      const uniqueIds = Array.from(new Set(ids.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))));
      uniqueIds.forEach(id => this.db.getApiKeyById(id));
      uniqueIds.forEach((id) => {
        this.poolFor(id).updateStatus(id, 'active');
        this.eventBus.emitEvent('key_status', { id, status: 'active' });
      });
      res.json({ updated: uniqueIds.length });
    });

    this.router.post('/keys/batch/disable', (req, res) => {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || ids.some(id => !Number.isInteger(id) || id < 1)) {
        return res.status(400).json({ error: 'ids array is required' });
      }
      const uniqueIds = Array.from(new Set(ids.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))));
      uniqueIds.forEach(id => this.db.getApiKeyById(id));
      uniqueIds.forEach((id) => {
        this.poolFor(id).updateStatus(id, 'disabled');
        this.eventBus.emitEvent('key_status', { id, status: 'disabled' });
      });
      res.json({ updated: uniqueIds.length });
    });

    this.router.post('/keys/batch/delete', (req, res) => {
      const { ids, provider } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || ids.some(id => !Number.isSafeInteger(id) || id < 1)
        || !['tavily', 'exa'].includes(provider)) {
        return res.status(400).json({ error: '请选择渠道及要删除的密钥（最多 1000 个）' });
      }
      let deletedIds: number[];
      try { deletedIds = this.db.deleteApiKeys(ids, provider); }
      catch (error: any) { return res.status(400).json({ error: error?.message || '批量删除失败' }); }
      this.usageSync.cancelKeys(deletedIds);
      (provider === 'exa' ? this.exaPool : this.keyPool).reload();
      this.eventBus.emitEvent('key_status', { ids: deletedIds, provider, status: 'deleted' });
      res.json({ deleted: deletedIds.length, ids: deletedIds });
    });

    this.router.post('/keys/batch/test', async (req, res) => {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || ids.some(id => !Number.isInteger(id) || id < 1)) {
        return res.status(400).json({ error: 'ids array is required' });
      }
      const uniqueIds = Array.from(new Set(ids.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))));
      const result = this.usageSync.enqueueKeys(uniqueIds, 'manual_test');
      res.status(202).json({ status: 'queued', ...result });
    });

    this.router.post('/keys/:id/test', async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: '无效的密钥 ID' });
      let key;
      try { key = this.db.getApiKeyById(id); }
      catch { return res.status(404).json({ error: '密钥不存在，请刷新列表' }); }
      if (key.provider === 'tavily') {
        const result = this.usageSync.enqueueKeys([id], 'manual_test');
        return res.status(202).json({ status: 'queued', ...result });
      }
      try { res.json(await this.exaKeyTester.test(id)); }
      catch { res.status(500).json({ error: '测试未完成，请稍后重试' }); }
    });

    this.router.get('/keys/:id', (req, res) => {
      const id = Number(req.params.id);
      try {
        const key = this.db.getApiKeyById(id);
        const quota = this.db.getMonthlyQuotaForKey(id, getCurrentQuotaPeriod());
        res.json({
          id: key.id,
          provider: key.provider,
          key_preview: maskKey(key.key_value),
          display_name: key.display_name,
          status: key.status,
          quota_reason: key.quota_reason, quota_reset_at: key.quota_reset_at,
          billing: key.provider === 'exa' ? this.db.exaBilling.summary(key.id) : null,
          weight: key.weight,
          error_count: key.error_count,
          max_errors: key.max_errors,
          total_requests: key.total_requests,
          successful_requests: key.successful_requests,
          failed_requests: key.failed_requests,
          last_used_at: key.last_used_at,
          last_error_at: key.last_error_at,
          last_error_message: key.last_error_message,
          created_at: key.created_at,
          updated_at: key.updated_at,
          usage_sync: this.db.getUsageSyncStateForKey(id),
          quota,
        });
      } catch (error: any) {
        res.status(404).json({ error: error?.message || 'Key not found' });
      }
    });

    this.router.get('/keys/:id/billing', (req, res) => {
      const key = this.db.getApiKeyById(Number(req.params.id));
      if (key.provider !== 'exa') return res.status(400).json({ error: 'Exa billing settings only' });
      res.json({ config: this.db.exaBilling.publicConfig(key.id), usage: this.db.exaBilling.summary(key.id) });
    });
    this.router.put('/keys/:id/billing', (req, res) => {
      const key = this.db.getApiKeyById(Number(req.params.id));
      if (key.provider !== 'exa') return res.status(400).json({ error: 'Exa billing settings only' });
      const config = this.db.exaBilling.saveConfig(key.id, req.body);
      if (key.status === 'quota_exceeded') {
        this.db.setQuotaPause(key.id, key.quota_reason, nextReset('exa', key.quota_reason || undefined, this.db.exaBilling.getConfig(key.id)));
        this.exaPool.reload();
      }
      res.json({ config });
    });
    this.router.post('/keys/:id/billing/sync', async (req, res) => {
      try { res.json(await this.exaUsage.sync(Number(req.params.id))); }
      catch (error: any) { res.status(502).json({ error: error.message }); }
    });

    this.router.put('/keys/:id', (req, res) => {
      const id = Number(req.params.id);
      const { display_name, weight, max_errors } = req.body || {};
      try {
        const record = this.poolFor(id).updateKey(id, {
          displayName: display_name,
          weight,
          maxErrors: max_errors,
        });
        this.eventBus.emitEvent('key_status', { id: record.id, status: record.status });
        res.json({ status: 'ok' });
      } catch (error: any) {
        res.status(400).json({ error: error?.message || 'Failed to update key' });
      }
    });

    this.router.delete('/keys/:id', (req, res) => {
      const id = Number(req.params.id);
      try {
        this.usageSync.cancelKey(id);
        this.poolFor(id).deleteKey(id);
        this.eventBus.emitEvent('key_status', { id, status: 'deleted' });
        res.json({ status: 'ok' });
      } catch (error: any) {
        res.status(400).json({ error: error?.message || 'Failed to delete key' });
      }
    });

    this.router.post('/keys/:id/enable', (req, res) => {
      const id = Number(req.params.id);
      this.poolFor(id).updateStatus(id, 'active');
      this.eventBus.emitEvent('key_status', { id, status: 'active' });
      res.json({ status: 'ok' });
    });

    this.router.post('/keys/:id/disable', (req, res) => {
      const id = Number(req.params.id);
      this.poolFor(id).updateStatus(id, 'disabled');
      this.eventBus.emitEvent('key_status', { id, status: 'disabled' });
      res.json({ status: 'ok' });
    });

    this.router.post('/keys/:id/reset', (req, res) => {
      const id = Number(req.params.id);
      this.poolFor(id).resetErrors(id);
      res.json({ status: 'ok' });
    });

    this.router.get('/stats/overview', (req, res) => {
      const statsService = new StatsService(this.db, this.connectionStore);
      res.json(statsService.getOverview(req.query.provider ? this.provider(req.query.provider) : undefined));
    });

    this.router.get('/stats/keys', (req, res) => {
      const yearMonth = getCurrentQuotaPeriod();
      const keys = this.db.getApiKeys(req.query.provider ? this.provider(req.query.provider) : undefined);
      const quotas = this.db.getMonthlyQuotas(yearMonth);
      const quotaMap = new Map(quotas.map((quota) => [quota.key_id, quota]));
      res.json({
        keys: keys.map((key) => {
          const quota = quotaMap.get(key.id);
          return {
            id: key.id,
          provider: key.provider,
            key_preview: maskKey(key.key_value),
            display_name: key.display_name,
            status: key.status,
          quota_reason: key.quota_reason, quota_reset_at: key.quota_reset_at,
          billing: key.provider === 'exa' ? this.db.exaBilling.summary(key.id) : null,
            total_requests: key.total_requests,
            success: key.successful_requests,
            failed: key.failed_requests,
            quota,
          };
        }),
      });
    });

    this.router.get('/stats/tools', (req, res) => {
      const statsService = new StatsService(this.db, this.connectionStore);
      res.json({ tools: statsService.getToolUsage() });
    });

    this.router.get('/stats/timeline', (req, res) => {
      const statsService = new StatsService(this.db, this.connectionStore);
      res.json({ timeline: statsService.getTimeline(30) });
    });

    this.router.get('/logs', (req, res) => {
      const page = Number(req.query.page || 1);
      const limit = Math.min(100, Number(req.query.limit || 20));
      const { start_date, end_date, tool_name, key_id, status, keyword, provider } = req.query;
      const result = this.db.queryRequestLogs({
        page,
        limit,
        includePayload: false,
        provider: provider ? this.provider(provider) : undefined,
        startDate: typeof start_date === 'string' ? start_date : undefined,
        endDate: typeof end_date === 'string' ? end_date : undefined,
        toolName: typeof tool_name === 'string' ? tool_name : undefined,
        keyId: typeof key_id === 'string' ? Number(key_id) : undefined,
        status: typeof status === 'string' ? status : undefined,
        keyword: typeof keyword === 'string' ? keyword : undefined,
      });
      res.json(result);
    });

    this.router.get('/logs/:id', (req, res) => {
      const id = Number(req.params.id);
      const log = this.db.getRequestLog(id);
      if (!log) {
        return res.status(404).json({ error: 'Log not found' });
      }
      res.json(log);
    });

    this.router.delete('/logs', (req, res) => {
      const days = Number(req.query.days || 30);
      if (!Number.isInteger(days) || days < 1 || days > 3650) return res.status(400).json({ error: 'Invalid retention days' });
      const cutoff = daysAgoIso(days);
      const deleted = this.db.deleteOldLogs(cutoff);
      res.json({ deleted });
    });

    this.router.get('/settings', (req, res) => {
      const runtime = getRuntimeConfig();
      res.json({
        config: {
          port: runtime.port,
          host: runtime.host,
          maxConcurrentRequests: runtime.maxConcurrentRequests,
          requestTimeoutMs: runtime.requestTimeoutMs,
          logRetentionDays: runtime.logRetentionDays,
          logLevel: runtime.logLevel,
          logFormat: runtime.logFormat,
          enableWebUI: runtime.enableWebUI,
          logResponseBodies: runtime.logResponseBodies,
          decision: this.decisionSettings.public(),
        },
        authRequired: Boolean(runtime.adminPassword),
      });
    });

    this.router.put('/settings', (req, res) => {
      const updates = req.body || {};
      const runtime = getRuntimeConfig();
      const nextConfig = {
        maxConcurrentRequests: updates.maxConcurrentRequests ?? runtime.maxConcurrentRequests,
        requestTimeoutMs: updates.requestTimeoutMs ?? runtime.requestTimeoutMs,
        logRetentionDays: updates.logRetentionDays ?? runtime.logRetentionDays,
        logLevel: updates.logLevel ?? runtime.logLevel,
        logFormat: updates.logFormat ?? runtime.logFormat,
      };
      for (const [key, min, max] of [['maxConcurrentRequests', 1, 100], ['requestTimeoutMs', 1000, 300000], ['logRetentionDays', 1, 365]] as const) {
        if (!Number.isInteger(nextConfig[key]) || nextConfig[key] < min || nextConfig[key] > max) return res.status(400).json({ error: `${key} must be between ${min} and ${max}` });
      }
      if (!['info', 'warn', 'error', 'debug'].includes(nextConfig.logLevel) || !['json', 'text'].includes(nextConfig.logFormat)) return res.status(400).json({ error: 'Invalid log format or level' });
      if (updates.logResponseBodies !== undefined && typeof updates.logResponseBodies !== 'boolean') return res.status(400).json({ error: 'logResponseBodies must be boolean' });
      if (updates.decision !== undefined) this.decisionSettings.prepare(updates.decision);
      const logResponseBodies = updates.logResponseBodies ?? runtime.logResponseBodies;
      const decision = updates.decision !== undefined ? this.decisionSettings.save(updates.decision) : this.decisionSettings.public();
      const next = { ...nextConfig, logResponseBodies };
      Object.entries(next).forEach(([key, value]) => this.db.setConfigValue(key, String(value)));
      updateRuntimeConfig(next);
      res.json({ status: 'ok', config: { ...next, decision } });
    });

    this.router.post('/settings/decision/test', async (req, res) => {
      const config = this.decisionSettings.prepare(req.body || {});
      if (!config.baseUrl || !config.apiKey) return res.status(400).json({ error: 'Configure a base URL and API key first' });
      try { res.json(await this.reviewer.test(config)); }
      catch (error: any) { res.status(502).json({ error: error?.message || 'Decision test failed' }); }
    });

    this.router.get('/providers', (req, res) => {
      res.json({ providers: (['tavily', 'exa'] as Provider[]).map(provider => ({
        id: provider, name: provider === 'exa' ? 'Exa' : 'Tavily',
        endpoints: { sse: `/${provider}/sse`, mcp: `/${provider}/mcp` },
        keys: this.db.getApiKeys(provider).map(k => ({ id: k.id, status: k.status })),
        tools: this.toolRouter?.listTools(provider).filter(t => !t.name.startsWith('tavily-')).map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) || [],
        reviewEnabled: this.decisionSettings.get().enabled && this.decisionSettings.get().channels[provider],
      })), exaBilling: this.db.exaBilling.summary(), review: this.db.getReviewStats() });
    });

    this.router.post('/settings/sync', (req, res) => {
      const mode = req.body?.mode === 'all' ? 'all' : 'stale';
      const result = mode === 'all'
        ? this.usageSync.enqueueAll()
        : this.usageSync.enqueueStale('stale');
      res.status(202).json({ status: 'queued', mode, ...result });
    });

    this.router.get('/settings/sync/status', (req, res) => {
      res.json(this.usageSync.getStatus());
    });
    this.router.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (res.headersSent) return next(error);
      const message = error instanceof Error ? error.message : 'Invalid request';
      res.status(400).json({ error: message.includes('UNIQUE constraint') ? 'This key is already in the pool' : message.slice(0, 250) });
    });
  }
}
