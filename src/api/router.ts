import express from 'express';
import axios from 'axios';
import { AppDatabase } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { UsageClient } from '../client/usage-client.js';
import { EventBus } from '../core/event-bus.js';
import { ConnectionStore } from '../core/connection-store.js';
import { StatsService } from '../core/stats-service.js';
import { maskKey } from '../utils/crypto.js';
import { getCurrentQuotaPeriod, daysAgoIso } from '../utils/date.js';
import { getRuntimeConfig, updateRuntimeConfig } from '../utils/runtime-config.js';

export class ApiRouter {
  public router = express.Router();

  constructor(
    private db: AppDatabase,
    private keyPool: KeyPool,
    private usageClient: UsageClient,
    private eventBus: EventBus,
    private connectionStore: ConnectionStore
  ) {
    this.setupRoutes();
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
      const keys = this.db.getApiKeys();
      const quotas = this.db.getMonthlyQuotas(yearMonth);
      const quotaMap = new Map(quotas.map((quota) => [quota.key_id, quota]));

      const payload = keys.map((key) => {
        const quota = quotaMap.get(key.id);
        const used = quota?.used_count ?? 0;
        const limit = quota?.quota_limit ?? null;
        return {
          id: key.id,
          key_preview: maskKey(key.key_value),
          display_name: key.display_name,
          status: key.status,
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

      res.json({ keys: payload });
    });

    this.router.post('/keys', async (req, res) => {
      const { key_value, display_name, weight, max_errors } = req.body || {};
      if (!key_value) {
        return res.status(400).json({ error: 'key_value is required' });
      }
      try {
        const record = this.keyPool.addKey({
          keyValue: key_value,
          displayName: display_name,
          weight,
          maxErrors: max_errors,
        });
        await this.usageClient.syncUsageForKey(record.id, record.key_value);
        this.eventBus.emitEvent('key_status', { id: record.id, status: record.status });
        res.json({
          id: record.id,
          key_preview: maskKey(record.key_value),
        });
      } catch (error: any) {
        res.status(400).json({ error: error?.message || 'Failed to add key' });
      }
    });

    this.router.post('/keys/import', (req, res) => {
      const { keys } = req.body || {};
      if (!Array.isArray(keys)) {
        return res.status(400).json({ error: 'keys array is required' });
      }
      const formatted = keys
        .map((entry: any) => {
          if (typeof entry === 'string') return { keyValue: entry };
          if (entry && entry.key_value) return { keyValue: entry.key_value, displayName: entry.display_name };
          return null;
        })
        .filter(Boolean) as Array<{ keyValue: string; displayName?: string }>;
      const inserted = this.keyPool.importKeys(formatted);
      res.json({ inserted });
    });

    this.router.post('/keys/batch/enable', (req, res) => {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids array is required' });
      }
      const uniqueIds = Array.from(new Set(ids.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))));
      uniqueIds.forEach((id) => {
        this.keyPool.updateStatus(id, 'active');
        this.eventBus.emitEvent('key_status', { id, status: 'active' });
      });
      res.json({ updated: uniqueIds.length });
    });

    this.router.post('/keys/batch/disable', (req, res) => {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids array is required' });
      }
      const uniqueIds = Array.from(new Set(ids.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))));
      uniqueIds.forEach((id) => {
        this.keyPool.updateStatus(id, 'disabled');
        this.eventBus.emitEvent('key_status', { id, status: 'disabled' });
      });
      res.json({ updated: uniqueIds.length });
    });

    this.router.post('/keys/batch/test', async (req, res) => {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids array is required' });
      }
      const uniqueIds = Array.from(new Set(ids.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))));
      const results: Array<{ id: number; status: 'success' | 'error'; error_type?: string | null; error_message?: string | null }> = [];

      for (const id of uniqueIds) {
        let key;
        try {
          key = this.db.getApiKeyById(id);
        } catch (error: any) {
          results.push({ id, status: 'error', error_message: error?.message || 'Key not found', error_type: null });
          continue;
        }

        const startedAt = Date.now();
        try {
          const usage = await this.usageClient.fetchUsage(key.key_value);
          this.logUsageResult({
            keyId: key.id,
            toolName: 'test',
            responseStatus: 'success',
            responseData: usage,
            responseTimeMs: Date.now() - startedAt,
            errorType: null,
            errorMessage: null,
          });
          results.push({ id: key.id, status: 'success' });
        } catch (error: unknown) {
          const { errorType, errorMessage, responseData } = this.parseUsageError(error);
          this.logUsageResult({
            keyId: key.id,
            toolName: 'test',
            responseStatus: 'error',
            responseData,
            responseTimeMs: Date.now() - startedAt,
            errorType,
            errorMessage,
          });
          results.push({ id: key.id, status: 'error', error_type: errorType, error_message: errorMessage });
        }
      }

      res.json({ results });
    });

    this.router.get('/keys/:id', (req, res) => {
      const id = Number(req.params.id);
      try {
        const key = this.db.getApiKeyById(id);
        const quota = this.db.getMonthlyQuotaForKey(id, getCurrentQuotaPeriod());
        res.json({
          id: key.id,
          key_preview: maskKey(key.key_value),
          display_name: key.display_name,
          status: key.status,
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
          quota,
        });
      } catch (error: any) {
        res.status(404).json({ error: error?.message || 'Key not found' });
      }
    });

    this.router.put('/keys/:id', (req, res) => {
      const id = Number(req.params.id);
      const { display_name, weight, max_errors } = req.body || {};
      try {
        const record = this.keyPool.updateKey(id, {
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
        this.keyPool.deleteKey(id);
        this.eventBus.emitEvent('key_status', { id, status: 'deleted' });
        res.json({ status: 'ok' });
      } catch (error: any) {
        res.status(400).json({ error: error?.message || 'Failed to delete key' });
      }
    });

    this.router.post('/keys/:id/enable', (req, res) => {
      const id = Number(req.params.id);
      this.keyPool.updateStatus(id, 'active');
      this.eventBus.emitEvent('key_status', { id, status: 'active' });
      res.json({ status: 'ok' });
    });

    this.router.post('/keys/:id/disable', (req, res) => {
      const id = Number(req.params.id);
      this.keyPool.updateStatus(id, 'disabled');
      this.eventBus.emitEvent('key_status', { id, status: 'disabled' });
      res.json({ status: 'ok' });
    });

    this.router.post('/keys/:id/reset', (req, res) => {
      const id = Number(req.params.id);
      this.keyPool.resetErrors(id);
      res.json({ status: 'ok' });
    });

    this.router.get('/stats/overview', (req, res) => {
      const statsService = new StatsService(this.db, this.connectionStore);
      res.json(statsService.getOverview());
    });

    this.router.get('/stats/keys', (req, res) => {
      const yearMonth = getCurrentQuotaPeriod();
      const keys = this.db.getApiKeys();
      const quotas = this.db.getMonthlyQuotas(yearMonth);
      const quotaMap = new Map(quotas.map((quota) => [quota.key_id, quota]));
      res.json({
        keys: keys.map((key) => {
          const quota = quotaMap.get(key.id);
          return {
            id: key.id,
            key_preview: maskKey(key.key_value),
            display_name: key.display_name,
            status: key.status,
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
      const { start_date, end_date, tool_name, key_id, status, keyword } = req.query;
      const result = this.db.queryRequestLogs({
        page,
        limit,
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
      updateRuntimeConfig(nextConfig);
      Object.entries(nextConfig).forEach(([key, value]) => {
        this.db.setConfigValue(key, String(value));
      });
      res.json({ status: 'ok', config: nextConfig });
    });

    this.router.post('/settings/sync', async (req, res) => {
      const keys = this.db.getApiKeys();
      const results: Array<{ id: number; status: 'success' | 'error'; error_type?: string | null; error_message?: string | null }> = [];
      for (const key of keys) {
        const startedAt = Date.now();
        try {
          const usage = await this.usageClient.fetchUsageAndSync(key.id, key.key_value);
          this.logUsageResult({
            keyId: key.id,
            toolName: 'sync_quota',
            responseStatus: 'success',
            responseData: usage,
            responseTimeMs: Date.now() - startedAt,
            errorType: null,
            errorMessage: null,
          });
          results.push({ id: key.id, status: 'success' });
        } catch (error: unknown) {
          const { errorType, errorMessage, responseData } = this.parseUsageError(error);
          this.logUsageResult({
            keyId: key.id,
            toolName: 'sync_quota',
            responseStatus: 'error',
            responseData,
            responseTimeMs: Date.now() - startedAt,
            errorType,
            errorMessage,
          });
          results.push({ id: key.id, status: 'error', error_type: errorType, error_message: errorMessage });
        }
      }
      res.json({ status: 'ok', results });
    });
  }

  private stringifyLogData(data: unknown): string | null {
    if (data === undefined || data === null) return null;
    try {
      const json = JSON.stringify(data);
      return json.length > 50000 ? `${json.slice(0, 50000)}...(truncated)` : json;
    } catch {
      return null;
    }
  }

  private parseUsageError(error: unknown): { errorType: 'auth' | 'network' | null; errorMessage: string | null; responseData: unknown } {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data as any;
      const detail = data?.detail;
      const message =
        (typeof detail === 'string' && detail) ||
        (detail && typeof detail === 'object' && (detail.error || detail.message || detail.detail)) ||
        data?.error ||
        data?.message ||
        error.message;
      const errorType = status === 401 || status === 403 ? 'auth' : 'network';
      return {
        errorType,
        errorMessage: message ? String(message) : error.message,
        responseData: data ?? null,
      };
    }

    const message = error instanceof Error ? error.message : error ? String(error) : null;
    return { errorType: 'network', errorMessage: message, responseData: null };
  }

  private logUsageResult(params: {
    keyId: number | null;
    toolName: 'test' | 'sync_quota';
    responseStatus: 'success' | 'error';
    responseData: unknown;
    responseTimeMs: number;
    errorType: 'auth' | 'network' | null;
    errorMessage: string | null;
  }): void {
    this.db.insertRequestLog({
      key_id: params.keyId,
      tool_name: params.toolName,
      request_params: null,
      response_data: this.stringifyLogData(params.responseData),
      response_status: params.responseStatus,
      response_time_ms: params.responseTimeMs,
      error_type: params.errorType,
      error_message: params.errorMessage,
    });
  }
}
