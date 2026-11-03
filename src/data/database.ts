import fs from 'fs';
import { ExaBillingStore } from './exa-billing-store.js';
import path from 'path';
import Database from 'better-sqlite3';
import { config } from '../utils/config.js';
import { decryptSecret, encryptSecret, hashKey, maskKey } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { getCurrentQuotaPeriod, toIsoString } from '../utils/date.js';

export type Provider = 'tavily' | 'exa';

export type KeyStatus = 'active' | 'disabled' | 'quota_exceeded' | 'banned';

export interface ApiKeyRecord {
  provider: Provider;
  quota_reason: string | null;
  quota_reset_at: string | null;
  id: number;
  key_hash: string;
  key_value: string;
  display_name: string | null;
  status: KeyStatus;
  weight: number;
  error_count: number;
  max_errors: number;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  last_used_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyDisplay extends Omit<ApiKeyRecord, 'key_value'> {
  key_preview: string;
}

export interface MonthlyQuotaRecord {
  id: number;
  key_id: number;
  year_month: string;
  quota_limit: number | null;
  used_count: number;
  search_count: number;
  extract_count: number;
  crawl_count: number;
  map_count: number;
  reset_at: string | null;
  created_at: string;
  updated_at: string;
}

export type UsageSyncStatus = 'never' | 'pending' | 'running' | 'success' | 'error' | 'rate_limited';

export interface UsageSyncStateRecord {
  key_id: number;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_status: UsageSyncStatus;
  last_error: string | null;
  updated_at: string;
}

export interface RequestLogRecord {
  cost_usd?: number | null;
  cost_source?: string | null;
  provider?: Provider;
  id: number;
  key_id: number | null;
  tool_name: string;
  request_params: string | null;
  response_data: string | null;
  response_status: string;
  response_time_ms: number | null;
  error_type: string | null;
  error_message: string | null;
  created_at: string;
}

export class AppDatabase {
  private db: Database.Database;
  private encryptionKey: string;
  readonly exaBilling: ExaBillingStore;

  constructor(dbPath: string = config.databasePath, encryptionKey: string = config.databaseEncryptionKey) {
    this.encryptionKey = encryptionKey;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
    this.exaBilling = new ExaBillingStore(this.db, this.encryptionKey);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_value TEXT NOT NULL UNIQUE,
        key_hash TEXT NOT NULL UNIQUE,
        display_name TEXT,
        status TEXT DEFAULT 'active',
        weight INTEGER DEFAULT 1,
        error_count INTEGER DEFAULT 0,
        max_errors INTEGER DEFAULT 5,
        total_requests INTEGER DEFAULT 0,
        successful_requests INTEGER DEFAULT 0,
        failed_requests INTEGER DEFAULT 0,
        last_used_at DATETIME,
        last_error_at DATETIME,
        last_error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS monthly_quotas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id INTEGER NOT NULL,
        year_month TEXT NOT NULL,
        quota_limit INTEGER,
        used_count INTEGER DEFAULT 0,
        search_count INTEGER DEFAULT 0,
        extract_count INTEGER DEFAULT 0,
        crawl_count INTEGER DEFAULT 0,
        map_count INTEGER DEFAULT 0,
        reset_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (key_id) REFERENCES api_keys(id),
        UNIQUE(key_id, year_month)
      );

      CREATE TABLE IF NOT EXISTS request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id INTEGER,
        tool_name TEXT NOT NULL,
        request_params TEXT,
        response_data TEXT,
        response_status TEXT,
        response_time_ms INTEGER,
        error_type TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (key_id) REFERENCES api_keys(id)
      );

      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS usage_sync_state (
        key_id INTEGER PRIMARY KEY,
        last_success_at DATETIME,
        last_attempt_at DATETIME,
        last_status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (key_id) REFERENCES api_keys(id)
      );

      CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_request_logs_key_id ON request_logs(key_id);
      CREATE INDEX IF NOT EXISTS idx_request_logs_tool_name ON request_logs(tool_name);
      CREATE INDEX IF NOT EXISTS idx_usage_sync_state_status ON usage_sync_state(last_status);
    `);

    // Migration: add response_data column if not exists
    const columns = this.db.prepare('PRAGMA table_info(request_logs)').all() as Array<{ name: string }>;
    const hasResponseData = columns.some((col) => col.name === 'response_data');
    if (!hasResponseData) {
      this.db.exec('ALTER TABLE request_logs ADD COLUMN response_data TEXT');
      logger.info('Migration: added response_data column to request_logs');
    }

    for (const table of ['api_keys', 'request_logs']) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!columns.some((col) => col.name === 'provider')) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN provider TEXT NOT NULL DEFAULT 'tavily'`);
      }
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_logs_provider_status_time ON request_logs(provider, response_status, created_at);
      CREATE TABLE IF NOT EXISTS upstream_tasks (
        provider TEXT NOT NULL, task_id TEXT NOT NULL, key_id INTEGER NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY(provider, task_id)
      );
    `);

    for (const [table, column, type] of [['api_keys','key_preview','TEXT'],['api_keys','quota_reason','TEXT'],['api_keys','quota_reset_at','TEXT'],['request_logs','cost_usd','REAL'],['request_logs','cost_source','TEXT']]) {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!cols.some(c => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }

    for (const row of this.db.prepare('SELECT id,key_value FROM api_keys WHERE key_preview IS NULL').all() as any[]) {
      let preview = '(unavailable)';
      try { preview = maskKey(this.decryptKey(row.key_value)); } catch { /* Keep invalid ciphertext out of output. */ }
      this.db.prepare('UPDATE api_keys SET key_preview=? WHERE id=?').run(preview,row.id);
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_keys_provider_status ON api_keys(provider,status,id)');

    // Backfill known successful remote quota synchronizations for existing databases.
    this.db.exec(`
      INSERT OR IGNORE INTO usage_sync_state (
        key_id, last_success_at, last_attempt_at, last_status, last_error, updated_at
      )
      SELECT key_id, MAX(created_at), MAX(created_at), 'success', NULL, MAX(created_at)
      FROM request_logs
      WHERE key_id IS NOT NULL
        AND tool_name = 'sync_quota'
        AND response_status = 'success'
      GROUP BY key_id
    `);
  }

  close(): void {
    this.db.close();
  }

  private encryptKey(keyValue: string): string {
    return encryptSecret(keyValue, this.encryptionKey);
  }

  private decryptKey(payload: string): string {
    return decryptSecret(payload, this.encryptionKey);
  }

  addApiKey(params: {
    keyValue: string;
    provider?: Provider;
    displayName?: string | null;
    weight?: number;
    maxErrors?: number;
  }): ApiKeyRecord {
    if (typeof params.keyValue !== 'string' || !params.keyValue.trim() || params.keyValue.length > 4096) throw new Error('Invalid API key');
    this.validateKeyOptions(params);
    if (params.displayName != null && (typeof params.displayName !== 'string' || params.displayName.length > 200)) throw new Error('Key name must be at most 200 characters');
    params.keyValue = params.keyValue.trim();
    const keyHash = hashKey(params.keyValue);
    const encrypted = this.encryptKey(params.keyValue);
    const now = toIsoString();
    const statement = this.db.prepare(`
      INSERT INTO api_keys (
        key_value, key_hash, provider, display_name, status, weight, error_count, max_errors,
        total_requests, successful_requests, failed_requests, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, 0, ?, 0, 0, 0, ?, ?)
    `);
    const result = statement.run(
      encrypted,
      keyHash,
      params.provider ?? 'tavily',
      params.displayName ?? null,
      params.weight ?? 1,
      params.maxErrors ?? config.maxKeyErrors,
      now,
      now
    );
    this.db.prepare('UPDATE api_keys SET key_preview=? WHERE id=?').run(maskKey(params.keyValue),result.lastInsertRowid);
    return this.getApiKeyById(Number(result.lastInsertRowid));
  }

  importApiKeys(keys: Array<{ keyValue: string; displayName?: string | null; provider?: Provider }>): number {
    return this.db.transaction(() => {
      let inserted = 0;
      for (const item of keys) {
        if (typeof item.keyValue !== 'string' || !item.keyValue.trim()) throw new Error('Invalid API key');
        if (this.getApiKeyByHash(hashKey(item.keyValue.trim()))) continue;
        this.addApiKey(item);
        inserted++;
      }
      return inserted;
    })();
  }

  private validateKeyOptions(params: { weight?: number; maxErrors?: number; provider?: Provider }): void {
    if (params.provider !== undefined && !['tavily', 'exa'].includes(params.provider)) throw new Error('Unknown provider');
    for (const [name, value, max] of [['weight', params.weight, 100], ['maxErrors', params.maxErrors, 100]] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > max)) throw new Error(`${name} must be an integer between 1 and ${max}`);
    }
  }

  getApiKeyById(id: number): ApiKeyRecord {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
    if (!row) {
      throw new Error('API key not found');
    }
    return this.mapApiKey(row);
  }

  getApiKeyByHash(hash: string): ApiKeyRecord | null {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hash);
    return row ? this.mapApiKey(row) : null;
  }

  getApiKeys(provider?: Provider): ApiKeyRecord[] {
    const rows = provider ? this.db.prepare('SELECT * FROM api_keys WHERE provider = ? ORDER BY id ASC').all(provider) : this.db.prepare('SELECT * FROM api_keys ORDER BY id ASC').all();
    return rows.map((row) => this.mapApiKey(row));
  }

  queryApiKeys(params: { provider?: Provider; status?: string; keyword?: string; page: number; limit: number }) {
    const clauses: string[] = [], values: Array<string | number> = [];
    if (params.provider) { clauses.push('provider=?'); values.push(params.provider); }
    if (params.status) { clauses.push('status=?'); values.push(params.status); }
    if (params.keyword) {
      clauses.push("(display_name LIKE ? ESCAPE '\\' OR key_preview LIKE ? ESCAPE '\\' OR CAST(id AS TEXT)=?)");
      const term = '%' + params.keyword.replace(/[\\%_]/g, '\\$&') + '%'; values.push(term,term,params.keyword);
    }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM api_keys ${where}`).get(...values) as any).n as number;
    const limit = Math.max(1, Math.min(100, Math.floor(params.limit) || 20));
    const page = Math.min(Math.max(1, Math.floor(params.page) || 1), Math.max(1, Math.ceil(total / limit)));
    const keys = this.db.prepare(`SELECT * FROM api_keys ${where} ORDER BY id ASC LIMIT ? OFFSET ?`).all(...values,limit,(page-1)*limit).map(row=>this.mapApiKey(row));
    return { total, page, limit, keys };
  }

  getApiKeysForDisplay(): ApiKeyDisplay[] {
    const rows = this.db.prepare('SELECT * FROM api_keys ORDER BY id ASC').all();
    return rows.map((row) => {
      const record = this.mapApiKey(row);
      const preview = maskKey(record.key_value);
      return {
        ...record,
        key_preview: preview,
        key_value: undefined as never,
      } as ApiKeyDisplay;
    });
  }

  getActiveKeys(): ApiKeyRecord[] {
    const rows = this.db.prepare("SELECT * FROM api_keys WHERE status = 'active' ORDER BY id ASC").all();
    return rows.map((row) => this.mapApiKey(row));
  }

  updateApiKey(id: number, updates: { displayName?: string | null; weight?: number; maxErrors?: number }): ApiKeyRecord {
    const now = toIsoString();
    this.validateKeyOptions(updates);
    if (updates.displayName != null && (typeof updates.displayName !== 'string' || updates.displayName.length > 200)) throw new Error('Key name must be at most 200 characters');
    const current = this.getApiKeyById(id);
    const statement = this.db.prepare(`
      UPDATE api_keys
      SET display_name = ?, weight = ?, max_errors = ?, updated_at = ?
      WHERE id = ?
    `);
    statement.run(
      updates.displayName ?? current.display_name,
      updates.weight ?? current.weight,
      updates.maxErrors ?? current.max_errors,
      now,
      id
    );
    return this.getApiKeyById(id);
  }

  updateApiKeyStatus(id: number, status: KeyStatus): void {
    const now = toIsoString();
    this.db.prepare('UPDATE api_keys SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }

  setQuotaPause(id: number, reason: string | null, resetAt: string | null): void {
    this.db.prepare('UPDATE api_keys SET quota_reason=?, quota_reset_at=? WHERE id=?').run(reason, resetAt, id);
  }

  deleteApiKey(id: number): void {
    this.deleteApiKeys([id]);
  }

  deleteApiKeys(ids: number[], provider?: Provider): number[] {
    const uniqueIds = [...new Set(ids)];
    return this.db.transaction(() => {
      // Validate the whole selection before deleting anything, including channel ownership.
      const lookup = this.db.prepare('SELECT provider FROM api_keys WHERE id = ?');
      for (const id of uniqueIds) {
        const key = lookup.get(id) as { provider: Provider } | undefined;
        if (!key || (provider && key.provider !== provider)) {
          throw new Error('所选密钥已变化或不属于当前渠道，请刷新列表后重试');
        }
      }
      const sync = this.db.prepare('DELETE FROM usage_sync_state WHERE key_id = ?');
      const logs = this.db.prepare('UPDATE request_logs SET key_id = NULL WHERE key_id = ?');
      const tasks = this.db.prepare('DELETE FROM upstream_tasks WHERE key_id = ?');
      const quotas = this.db.prepare('DELETE FROM monthly_quotas WHERE key_id = ?');
      const keys = this.db.prepare('DELETE FROM api_keys WHERE id = ?');
      for (const id of uniqueIds) {
        sync.run(id); logs.run(id); tasks.run(id); quotas.run(id);
        this.exaBilling.deleteForKey(id);
        keys.run(id);
      }
      return uniqueIds;
    })();
  }

  resetKeyErrors(id: number): void {
    const now = toIsoString();
    this.db.prepare('UPDATE api_keys SET error_count = 0, last_error_message = NULL, updated_at = ? WHERE id = ?').run(now, id);
  }

  setKeyLastError(id: number, message: string): void {
    this.db.prepare('UPDATE api_keys SET last_error_at=?,last_error_message=? WHERE id=?').run(toIsoString(),message.slice(0,500),id);
  }

  markKeySuccess(id: number): void {
    const now = toIsoString();
    this.db.prepare(`
      UPDATE api_keys
      SET total_requests = total_requests + 1,
          successful_requests = successful_requests + 1,
          error_count = 0,
          last_used_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(now, now, id);
  }

  markKeyFailure(id: number, message: string | null, incrementError: boolean): void {
    const now = toIsoString();
    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET total_requests = total_requests + 1,
          failed_requests = failed_requests + 1,
          error_count = error_count + ?,
          last_error_at = ?,
          last_error_message = ?,
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(incrementError ? 1 : 0, now, message, now, id);
  }

  updateKeyLastUsed(id: number): void {
    const now = toIsoString();
    this.db.prepare('UPDATE api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  }

  ensureMonthlyQuota(keyId: number, yearMonth: string): MonthlyQuotaRecord {
    const existing = this.db
      .prepare('SELECT * FROM monthly_quotas WHERE key_id = ? AND year_month = ?')
      .get(keyId, yearMonth);
    if (existing) {
      return existing as MonthlyQuotaRecord;
    }
    const quotaLimit = this.getLatestKnownQuotaLimit(keyId, yearMonth);
    const now = toIsoString();
    const result = this.db
      .prepare(`
        INSERT INTO monthly_quotas (
          key_id, year_month, quota_limit, used_count, search_count, extract_count, crawl_count, map_count, reset_at, created_at, updated_at
        ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?)
      `)
      .run(keyId, yearMonth, quotaLimit, now, now, now);
    return this.db.prepare('SELECT * FROM monthly_quotas WHERE id = ?').get(result.lastInsertRowid) as MonthlyQuotaRecord;
  }

  updateMonthlyQuotaFromUsage(params: {
    keyId: number;
    yearMonth: string;
    quotaLimit: number | null;
    usedCount: number;
    resetAt?: string | null;
  }): void {
    const now = toIsoString();
    const existing = this.ensureMonthlyQuota(params.keyId, params.yearMonth);
    this.db
      .prepare(`
        UPDATE monthly_quotas
        SET quota_limit = ?, used_count = ?, reset_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(params.quotaLimit, params.usedCount, params.resetAt ?? existing.reset_at, now, existing.id);
  }

  incrementMonthlyUsage(keyId: number, tool: string, count: number = 1): void {
    const yearMonth = getCurrentQuotaPeriod();
    const record = this.ensureMonthlyQuota(keyId, yearMonth);
    const now = toIsoString();
    const column = tool === 'search'
      ? 'search_count'
      : tool === 'extract'
        ? 'extract_count'
        : tool === 'crawl'
          ? 'crawl_count'
          : 'map_count';
    this.db
      .prepare(`
        UPDATE monthly_quotas
        SET used_count = used_count + ?,
            ${column} = ${column} + ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(count, count, now, record.id);
  }

  getMonthlyQuotas(yearMonth: string): MonthlyQuotaRecord[] {
    return this.db
      .prepare('SELECT * FROM monthly_quotas WHERE year_month = ?')
      .all(yearMonth) as MonthlyQuotaRecord[];
  }

  getLatestKnownQuotaLimit(keyId: number, beforeYearMonth?: string): number | null {
    const row = beforeYearMonth
      ? this.db
          .prepare(`
            SELECT quota_limit
            FROM monthly_quotas
            WHERE key_id = ? AND year_month < ? AND quota_limit IS NOT NULL
            ORDER BY year_month DESC
            LIMIT 1
          `)
          .get(keyId, beforeYearMonth)
      : this.db
          .prepare(`
            SELECT quota_limit
            FROM monthly_quotas
            WHERE key_id = ? AND quota_limit IS NOT NULL
            ORDER BY year_month DESC
            LIMIT 1
          `)
          .get(keyId);
    return (row as { quota_limit: number } | undefined)?.quota_limit ?? null;
  }

  getMonthlyQuotaForKey(keyId: number, yearMonth: string): MonthlyQuotaRecord | null {
    const row = this.db
      .prepare('SELECT * FROM monthly_quotas WHERE key_id = ? AND year_month = ?')
      .get(keyId, yearMonth);
    return row ? (row as MonthlyQuotaRecord) : null;
  }

  getUsageSyncStateForKey(keyId: number): UsageSyncStateRecord | null {
    const row = this.db.prepare('SELECT * FROM usage_sync_state WHERE key_id = ?').get(keyId);
    return row ? (row as UsageSyncStateRecord) : null;
  }

  getUsageSyncStates(): UsageSyncStateRecord[] {
    return this.db.prepare('SELECT * FROM usage_sync_state ORDER BY key_id ASC').all() as UsageSyncStateRecord[];
  }

  markUsageSyncPending(keyId: number): void {
    this.upsertUsageSyncState(keyId, 'pending', null, false);
  }

  markUsageSyncRunning(keyId: number): void {
    this.upsertUsageSyncState(keyId, 'running', null, true);
  }

  markUsageSyncSuccess(keyId: number): void {
    const now = toIsoString();
    this.db
      .prepare(`
        INSERT INTO usage_sync_state (
          key_id, last_success_at, last_attempt_at, last_status, last_error, updated_at
        ) VALUES (?, ?, ?, 'success', NULL, ?)
        ON CONFLICT(key_id) DO UPDATE SET
          last_success_at = excluded.last_success_at,
          last_attempt_at = excluded.last_attempt_at,
          last_status = 'success',
          last_error = NULL,
          updated_at = excluded.updated_at
      `)
      .run(keyId, now, now, now);
  }

  markUsageSyncFailure(keyId: number, status: 'error' | 'rate_limited', error: string | null): void {
    this.upsertUsageSyncState(keyId, status, error, true);
  }

  private upsertUsageSyncState(
    keyId: number,
    status: UsageSyncStatus,
    error: string | null,
    attempted: boolean
  ): void {
    const now = toIsoString();
    this.db
      .prepare(`
        INSERT INTO usage_sync_state (
          key_id, last_success_at, last_attempt_at, last_status, last_error, updated_at
        ) VALUES (?, NULL, ?, ?, ?, ?)
        ON CONFLICT(key_id) DO UPDATE SET
          last_attempt_at = CASE WHEN ? THEN excluded.last_attempt_at ELSE usage_sync_state.last_attempt_at END,
          last_status = excluded.last_status,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `)
      .run(keyId, attempted ? now : null, status, error, now, attempted ? 1 : 0);
  }

  insertRequestLog(entry: Omit<RequestLogRecord, 'id' | 'created_at'>): void {
    const now = toIsoString();
    this.db
      .prepare(`
        INSERT INTO request_logs (key_id, tool_name, request_params, response_data, response_status, response_time_ms, error_type, error_message, created_at, provider, cost_usd, cost_source)
        VALUES ((SELECT id FROM api_keys WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.key_id,
        entry.tool_name,
        entry.request_params,
        entry.response_data,
        entry.response_status,
        entry.response_time_ms,
        entry.error_type,
        entry.error_message,
        now,
        entry.provider ?? 'tavily',
        entry.cost_usd ?? null, entry.cost_source ?? null
      );
  }

  insertRequestLogs(entries: Array<Omit<RequestLogRecord, 'id' | 'created_at'>>): void {
    if (!entries.length) return;
    const insert = this.db.prepare(`
      INSERT INTO request_logs (key_id, tool_name, request_params, response_data, response_status, response_time_ms, error_type, error_message, created_at, provider, cost_usd, cost_source)
      VALUES ((SELECT id FROM api_keys WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = toIsoString();
    const transaction = this.db.transaction((items: typeof entries) => {
      for (const entry of items) {
        insert.run(
          entry.key_id,
          entry.tool_name,
          entry.request_params,
          entry.response_data,
          entry.response_status,
          entry.response_time_ms,
          entry.error_type,
          entry.error_message,
          now,
          entry.provider ?? 'tavily',
        entry.cost_usd ?? null, entry.cost_source ?? null
        );
      }
    });
    transaction(entries);
  }

  queryRequestLogs(params: {
    page: number;
    limit: number;
    startDate?: string;
    endDate?: string;
    toolName?: string;
    keyId?: number;
    status?: string;
    keyword?: string;
    provider?: Provider;
    includePayload?: boolean;
    excludeMaintenance?: boolean;
  }): { total: number; logs: RequestLogRecord[] } {
    const filters: string[] = [];
    const values: Array<string | number> = [];
    if (params.provider) { filters.push('provider = ?'); values.push(params.provider); }
    if (params.excludeMaintenance) filters.push("tool_name NOT IN ('sync_quota', 'test', 'moderation')");
    if (params.startDate) {
      filters.push('created_at >= ?');
      values.push(params.startDate);
    }
    if (params.endDate) {
      filters.push('created_at <= ?');
      values.push(params.endDate);
    }
    if (params.toolName) {
      filters.push('tool_name = ?');
      values.push(params.toolName);
    }
    if (params.keyId) {
      filters.push('key_id = ?');
      values.push(params.keyId);
    }
    if (params.status) {
      filters.push('response_status = ?');
      values.push(params.status);
    }
    if (params.keyword) {
      filters.push('(request_params LIKE ? OR error_message LIKE ?)');
      const keyword = `%${params.keyword}%`;
      values.push(keyword, keyword);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const total = this.db
      .prepare(`SELECT COUNT(*) as count FROM request_logs ${where}`)
      .get(...values) as { count: number };

    const page = Number.isInteger(params.page) && params.page > 0 ? params.page : 1;
    const limit = Number.isInteger(params.limit) && params.limit > 0 ? Math.min(params.limit, 100) : 20;
    const offset = (page - 1) * limit;
    const columns = params.includePayload === false ? 'id, key_id, provider, tool_name, response_status, response_time_ms, error_type, error_message, cost_usd, cost_source, created_at' : '*';
    const logs = this.db
      .prepare(`SELECT ${columns} FROM request_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...values, limit, offset) as RequestLogRecord[];
    return { total: total.count, logs };
  }

  getRequestLog(id: number): RequestLogRecord | null {
    const row = this.db.prepare('SELECT * FROM request_logs WHERE id = ?').get(id);
    return row ? (row as RequestLogRecord) : null;
  }

  deleteOldLogs(olderThanIso: string): number {
    const result = this.db.prepare('DELETE FROM request_logs WHERE created_at < ?').run(olderThanIso);
    return result.changes;
  }

  /**
   * Get daily request counts grouped by date for timeline chart.
   */
  getDailyRequestCounts(startDate: string): Array<{ date: string; count: number }> {
    return this.db
      .prepare(`
        SELECT date(created_at) as date, COUNT(*) as count
        FROM request_logs
        WHERE created_at >= ? AND tool_name NOT IN ('sync_quota', 'test', 'moderation')
        GROUP BY date(created_at)
        ORDER BY date ASC
      `)
      .all(startDate) as Array<{ date: string; count: number }>;
  }

  setConfigValue(key: string, value: string, description?: string): void {
    const now = toIsoString();
    this.db
      .prepare(`
        INSERT INTO system_config (key, value, description, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, description = excluded.description, updated_at = excluded.updated_at
      `)
      .run(key, value, description ?? null, now);
  }

  getConfigValue(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM system_config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  getAllConfigValues(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM system_config').all() as Array<{ key: string; value: string }>;
    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  }

  getReviewStats() {
    return this.db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN response_status = 'error' THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(CASE WHEN json_valid(response_data) THEN json_extract(response_data, '$.removed') ELSE 0 END), 0) AS removed,
      COALESCE(ROUND(AVG(response_time_ms)), 0) AS avg_ms
      FROM request_logs WHERE tool_name = 'moderation'`).get();
  }

  transaction<T>(fn: () => T): T { return this.db.transaction(fn)(); }

  setSecret(name: string, value: string): void {
    this.setConfigValue(name, this.encryptKey(value));
  }

  getSecret(name: string): string {
    const value = this.getConfigValue(name);
    return value ? this.decryptKey(value) : '';
  }

  bindTask(provider: Provider, taskId: string, keyId: number): void {
    this.db.prepare('INSERT OR REPLACE INTO upstream_tasks(provider, task_id, key_id, created_at) VALUES (?, ?, ?, ?)')
      .run(provider, taskId, keyId, toIsoString());
  }

  getTaskKey(provider: Provider, taskId: string): number | null {
    return (this.db.prepare('SELECT key_id FROM upstream_tasks WHERE provider = ? AND task_id = ?').get(provider, taskId) as any)?.key_id ?? null;
  }

  private mapApiKey(row: any): ApiKeyRecord {
    let keyValue = '';
    try {
      keyValue = this.decryptKey(row.key_value);
    } catch (error) {
      logger.warn('Failed to decrypt API key from database', { id: row.id });
    }
    return {
      id: row.id,
      provider: row.provider || 'tavily',
      quota_reason: row.quota_reason ?? null,
      quota_reset_at: row.quota_reset_at ?? null,
      key_hash: row.key_hash,
      key_value: keyValue,
      display_name: row.display_name,
      status: row.status,
      weight: row.weight,
      error_count: row.error_count,
      max_errors: row.max_errors,
      total_requests: row.total_requests,
      successful_requests: row.successful_requests,
      failed_requests: row.failed_requests,
      last_used_at: row.last_used_at,
      last_error_at: row.last_error_at,
      last_error_message: row.last_error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
