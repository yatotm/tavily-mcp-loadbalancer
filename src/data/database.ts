import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { config } from '../utils/config.js';
import { decryptSecret, encryptSecret, hashKey } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { getCurrentQuotaPeriod, toIsoString } from '../utils/date.js';

export type KeyStatus = 'active' | 'disabled' | 'quota_exceeded' | 'banned';

export interface ApiKeyRecord {
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

export interface RequestLogRecord {
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

  constructor(dbPath: string = config.databasePath, encryptionKey: string = config.databaseEncryptionKey) {
    this.encryptionKey = encryptionKey;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
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

      CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_request_logs_key_id ON request_logs(key_id);
      CREATE INDEX IF NOT EXISTS idx_request_logs_tool_name ON request_logs(tool_name);
    `);

    // Migration: add response_data column if not exists
    const columns = this.db.prepare('PRAGMA table_info(request_logs)').all() as Array<{ name: string }>;
    const hasResponseData = columns.some((col) => col.name === 'response_data');
    if (!hasResponseData) {
      this.db.exec('ALTER TABLE request_logs ADD COLUMN response_data TEXT');
      logger.info('Migration: added response_data column to request_logs');
    }
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
    displayName?: string | null;
    weight?: number;
    maxErrors?: number;
  }): ApiKeyRecord {
    const keyHash = hashKey(params.keyValue);
    const encrypted = this.encryptKey(params.keyValue);
    const now = toIsoString();
    const statement = this.db.prepare(`
      INSERT INTO api_keys (
        key_value, key_hash, display_name, status, weight, error_count, max_errors,
        total_requests, successful_requests, failed_requests, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', ?, 0, ?, 0, 0, 0, ?, ?)
    `);
    const result = statement.run(
      encrypted,
      keyHash,
      params.displayName ?? null,
      params.weight ?? 1,
      params.maxErrors ?? config.maxKeyErrors,
      now,
      now
    );
    return this.getApiKeyById(Number(result.lastInsertRowid));
  }

  importApiKeys(keys: Array<{ keyValue: string; displayName?: string | null }>): number {
    const insert = this.db.prepare(`
      INSERT INTO api_keys (
        key_value, key_hash, display_name, status, weight, error_count, max_errors,
        total_requests, successful_requests, failed_requests, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', 1, 0, ?, 0, 0, 0, ?, ?)
    `);
    const now = toIsoString();
    const transaction = this.db.transaction((items: typeof keys) => {
      let inserted = 0;
      for (const item of items) {
        const encrypted = this.encryptKey(item.keyValue);
        const hash = hashKey(item.keyValue);
        try {
          insert.run(encrypted, hash, item.displayName ?? null, config.maxKeyErrors, now, now);
          inserted += 1;
        } catch (error) {
          // ignore duplicates
        }
      }
      return inserted;
    });
    return transaction(keys);
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

  getApiKeys(): ApiKeyRecord[] {
    const rows = this.db.prepare('SELECT * FROM api_keys ORDER BY id ASC').all();
    return rows.map((row) => this.mapApiKey(row));
  }

  getApiKeysForDisplay(): ApiKeyDisplay[] {
    const rows = this.db.prepare('SELECT * FROM api_keys ORDER BY id ASC').all();
    return rows.map((row) => {
      const record = this.mapApiKey(row);
      const preview = record.key_value;
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

  deleteApiKey(id: number): void {
    this.db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  }

  resetKeyErrors(id: number): void {
    const now = toIsoString();
    this.db.prepare('UPDATE api_keys SET error_count = 0, last_error_message = NULL, updated_at = ? WHERE id = ?').run(now, id);
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
    const now = toIsoString();
    const result = this.db
      .prepare(`
        INSERT INTO monthly_quotas (
          key_id, year_month, quota_limit, used_count, search_count, extract_count, crawl_count, map_count, reset_at, created_at, updated_at
        ) VALUES (?, ?, NULL, 0, 0, 0, 0, 0, ?, ?, ?)
      `)
      .run(keyId, yearMonth, now, now, now);
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

  getMonthlyQuotaForKey(keyId: number, yearMonth: string): MonthlyQuotaRecord | null {
    const row = this.db
      .prepare('SELECT * FROM monthly_quotas WHERE key_id = ? AND year_month = ?')
      .get(keyId, yearMonth);
    return row ? (row as MonthlyQuotaRecord) : null;
  }

  insertRequestLog(entry: Omit<RequestLogRecord, 'id' | 'created_at'>): void {
    const now = toIsoString();
    this.db
      .prepare(`
        INSERT INTO request_logs (key_id, tool_name, request_params, response_data, response_status, response_time_ms, error_type, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        now
      );
  }

  insertRequestLogs(entries: Array<Omit<RequestLogRecord, 'id' | 'created_at'>>): void {
    if (!entries.length) return;
    const insert = this.db.prepare(`
      INSERT INTO request_logs (key_id, tool_name, request_params, response_data, response_status, response_time_ms, error_type, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          now
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
  }): { total: number; logs: RequestLogRecord[] } {
    const filters: string[] = [];
    const values: Array<string | number> = [];
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

    const offset = (params.page - 1) * params.limit;
    const logs = this.db
      .prepare(`SELECT * FROM request_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...values, params.limit, offset) as RequestLogRecord[];
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
        WHERE created_at >= ?
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

  private mapApiKey(row: any): ApiKeyRecord {
    let keyValue = '';
    try {
      keyValue = this.decryptKey(row.key_value);
    } catch (error) {
      logger.warn('Failed to decrypt API key from database', { id: row.id });
    }
    return {
      id: row.id,
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
