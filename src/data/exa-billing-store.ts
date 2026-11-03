import type Database from 'better-sqlite3';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';
export type CostSource = 'reported' | 'estimated' | 'pending' | 'unknown';
export interface ExaCharge { amount: number | null; source: CostSource; operationId: string; tool: string; detail: object; }
export interface ExaBillingConfig { resetMode: 'auto' | 'monthly' | 'manual'; resetDay: number; publicId: string; serviceKey: string; }
export class ExaBillingStore {
  constructor(private db: Database.Database, private encryptionKey: string) {
    db.exec(`CREATE TABLE IF NOT EXISTS exa_charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key_id INTEGER, operation_id TEXT NOT NULL UNIQUE, tool_name TEXT NOT NULL,
      amount_usd REAL, source TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exa_charges_key_date ON exa_charges(key_id, created_at);
    CREATE TABLE IF NOT EXISTS exa_billing_settings (
      key_id INTEGER PRIMARY KEY, config TEXT NOT NULL, service_key TEXT NOT NULL DEFAULT '',
      snapshot TEXT, sync_error TEXT, synced_at TEXT
    );`);
  }
  record(keyId: number, charge: ExaCharge, now = new Date().toISOString()) {
    return this.db.transaction(() => {
      const old = this.db.prepare('SELECT * FROM exa_charges WHERE operation_id = ?').get(charge.operationId) as any;
      if (old && old.key_id !== keyId) throw new Error('Billing task belongs to another key');
      // Polling the same run is free. Never downgrade a known charge to a pending estimate.
      if (old && ((old.source === 'reported' && charge.source !== 'reported') || (old.amount_usd !== null && charge.amount === null))) return { cost_usd: 0, cost_source: old.source as CostSource };
      this.db.prepare(`INSERT INTO exa_charges(key_id,operation_id,tool_name,amount_usd,source,detail,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET amount_usd=excluded.amount_usd,source=excluded.source,detail=excluded.detail,updated_at=excluded.updated_at`)
        .run(keyId, charge.operationId, charge.tool, charge.amount, charge.source, JSON.stringify(charge.detail), now, now);
      return { cost_usd: charge.amount === null ? null : Math.round((charge.amount - (old?.amount_usd ?? 0)) * 1e6) / 1e6, cost_source: charge.source };
    })();
  }
  summary(keyId?: number, period = new Date().toISOString().slice(0, 7)) {
    const row = this.db.prepare(`SELECT COALESCE(ROUND(SUM(amount_usd),6),0) AS total_usd,
      COALESCE(ROUND(SUM(CASE WHEN source='reported' THEN amount_usd ELSE 0 END),6),0) AS reported_usd,
      COALESCE(ROUND(SUM(CASE WHEN source='estimated' THEN amount_usd ELSE 0 END),6),0) AS estimated_usd,
      COUNT(*) AS operations, SUM(CASE WHEN amount_usd IS NULL THEN 1 ELSE 0 END) AS unsettled
      FROM exa_charges WHERE created_at >= ? AND created_at < ? ${keyId === undefined ? '' : 'AND key_id = ?'}`)
      .get(...[`${period}-01T00:00:00.000Z`, this.nextMonth(period), ...(keyId === undefined ? [] : [keyId])]) as any;
    const snapshot = keyId === undefined ? null : this.snapshot(keyId);
    return { ...row, unsettled: row.unsettled || 0, period, ...(snapshot ? { official: snapshot } : {}) };
  }
  private nextMonth(period: string) { const [year, month] = period.split('-').map(Number); return new Date(Date.UTC(year, month, 1)).toISOString(); }
  getConfig(keyId: number): ExaBillingConfig {
    const row = this.db.prepare('SELECT config, service_key FROM exa_billing_settings WHERE key_id = ?').get(keyId) as any;
    return { resetMode: 'auto', resetDay: 1, publicId: '', ...(row ? JSON.parse(row.config) : {}), serviceKey: row?.service_key ? decryptSecret(row.service_key, this.encryptionKey) : '' };
  }
  publicConfig(keyId: number) {
    const { serviceKey, ...config } = this.getConfig(keyId);
    const row = this.db.prepare('SELECT sync_error,synced_at FROM exa_billing_settings WHERE key_id=?').get(keyId) as any;
    return { ...config, serviceKeyConfigured: Boolean(serviceKey), syncError: row?.sync_error ?? null, syncedAt: row?.synced_at ?? null };
  }
  saveConfig(keyId: number, update: any) {
    const old = this.getConfig(keyId);
    if (!update || typeof update !== 'object' || Array.isArray(update)) throw new Error('Invalid billing configuration');
    const next = { ...old, resetMode: update.resetMode ?? old.resetMode, resetDay: update.resetDay ?? old.resetDay,
      publicId: update.publicId === undefined ? old.publicId : update.publicId,
      serviceKey: update.serviceKey === null ? '' : update.serviceKey || old.serviceKey };
    if (!['auto','monthly','manual'].includes(next.resetMode) || !Number.isInteger(next.resetDay) || next.resetDay < 1 || next.resetDay > 28) throw new Error('Invalid billing reset rule');
    if (typeof next.publicId !== 'string' || (next.publicId && !/^key_[A-Za-z0-9_-]{1,120}$/.test(next.publicId))) throw new Error('Use the Exa publicId beginning with key_');
    if (typeof next.serviceKey !== 'string' || next.serviceKey.length > 4096) throw new Error('Invalid Exa Service Key');
    const { serviceKey, ...stored } = next;
    this.db.prepare(`INSERT INTO exa_billing_settings(key_id,config,service_key) VALUES (?,?,?)
      ON CONFLICT(key_id) DO UPDATE SET config=excluded.config,service_key=excluded.service_key,
      snapshot=CASE WHEN ? THEN NULL ELSE snapshot END,
      sync_error=NULL`).run(keyId, JSON.stringify(stored), serviceKey ? encryptSecret(serviceKey, this.encryptionKey) : '', old.publicId !== next.publicId || old.serviceKey !== next.serviceKey ? 1 : 0);
    return this.publicConfig(keyId);
  }
  setSnapshot(keyId: number, snapshot: object) {
    this.db.prepare('UPDATE exa_billing_settings SET snapshot=?,sync_error=NULL,synced_at=? WHERE key_id=?').run(JSON.stringify(snapshot),new Date().toISOString(),keyId);
  }
  setSyncError(keyId: number, error: string) { this.db.prepare('UPDATE exa_billing_settings SET sync_error=? WHERE key_id=?').run(error,keyId); }
  snapshot(keyId: number): any { const row = this.db.prepare('SELECT snapshot FROM exa_billing_settings WHERE key_id=?').get(keyId) as any; return row?.snapshot ? JSON.parse(row.snapshot) : null; }
  configuredKeyIds(): number[] { return (this.db.prepare("SELECT key_id FROM exa_billing_settings WHERE service_key<>''").all() as any[]).map(r=>r.key_id); }
  deleteForKey(keyId: number) {
    this.db.prepare('UPDATE exa_charges SET key_id=NULL WHERE key_id=?').run(keyId);
    this.db.prepare('DELETE FROM exa_billing_settings WHERE key_id=?').run(keyId);
  }
}
