import { AppDatabase, ApiKeyRecord, KeyStatus } from '../data/database.js';
import { logger } from '../utils/logger.js';
import { KeySelector } from './key-selector.js';

export class KeyPool {
  private db: AppDatabase;
  private keys: ApiKeyRecord[] = [];
  private cooldowns: Map<number, number> = new Map();
  private selector = new KeySelector();
  private activeSignature = '';

  constructor(db: AppDatabase) {
    this.db = db;
    this.reload();
  }

  reload(): void {
    this.keys = this.db.getApiKeys();
    this.selector.reset(this.getActiveKeys());
    this.activeSignature = this.computeSignature(this.getActiveKeys());
  }

  getAllKeys(): ApiKeyRecord[] {
    return this.keys;
  }

  getActiveKeys(): ApiKeyRecord[] {
    const now = Date.now();
    return this.keys.filter((key) => {
      if (key.status !== 'active') return false;
      const cooldown = this.cooldowns.get(key.id);
      if (cooldown && cooldown > now) return false;
      return true;
    });
  }

  getNextKey(): ApiKeyRecord | null {
    const activeKeys = this.getActiveKeys();
    if (!activeKeys.length) return null;
    const signature = this.computeSignature(activeKeys);
    if (signature !== this.activeSignature) {
      this.selector.reset(activeKeys);
      this.activeSignature = signature;
    }
    return this.selector.select(activeKeys);
  }

  setCooldown(keyId: number, delayMs: number): void {
    if (delayMs <= 0) return;
    const until = Date.now() + delayMs;
    this.cooldowns.set(keyId, until);
  }

  clearCooldown(keyId: number): void {
    this.cooldowns.delete(keyId);
  }

  markSuccess(keyId: number): void {
    this.db.markKeySuccess(keyId);
    this.updateKeyInMemory(keyId, {
      error_count: 0,
      last_used_at: new Date().toISOString(),
      total_requests: this.getKeyValue(keyId, 'total_requests') + 1,
      successful_requests: this.getKeyValue(keyId, 'successful_requests') + 1,
    });
  }

  markFailure(keyId: number, message: string | null, incrementError: boolean): void {
    this.db.markKeyFailure(keyId, message, incrementError);
    const currentErrors = this.getKeyValue(keyId, 'error_count');
    const maxErrors = this.getKeyValue(keyId, 'max_errors');
    const nextErrors = currentErrors + (incrementError ? 1 : 0);
    this.updateKeyInMemory(keyId, {
      error_count: this.getKeyValue(keyId, 'error_count') + (incrementError ? 1 : 0),
      last_error_at: new Date().toISOString(),
      last_error_message: message,
      total_requests: this.getKeyValue(keyId, 'total_requests') + 1,
      failed_requests: this.getKeyValue(keyId, 'failed_requests') + 1,
    });

    if (incrementError && maxErrors && nextErrors >= maxErrors) {
      const currentStatus = this.getKeyValue(keyId, 'status');
      if (currentStatus !== 'quota_exceeded') {
        this.updateStatus(keyId, 'disabled');
        logger.warn('API key disabled after exceeding max errors', { keyId, maxErrors });
      }
    }
  }

  updateStatus(keyId: number, status: KeyStatus): void {
    this.db.updateApiKeyStatus(keyId, status);
    this.updateKeyInMemory(keyId, { status });
  }

  resetErrors(keyId: number): void {
    this.db.resetKeyErrors(keyId);
    this.updateKeyInMemory(keyId, { error_count: 0, last_error_message: null });
  }

  addKey(params: { keyValue: string; displayName?: string | null; weight?: number; maxErrors?: number }): ApiKeyRecord {
    const record = this.db.addApiKey(params);
    this.reload();
    return record;
  }

  importKeys(keys: Array<{ keyValue: string; displayName?: string | null }>): number {
    const count = this.db.importApiKeys(keys);
    this.reload();
    return count;
  }

  updateKey(id: number, updates: { displayName?: string | null; weight?: number; maxErrors?: number }): ApiKeyRecord {
    const record = this.db.updateApiKey(id, updates);
    this.reload();
    return record;
  }

  deleteKey(id: number): void {
    this.db.deleteApiKey(id);
    this.reload();
  }

  private updateKeyInMemory(id: number, updates: Partial<ApiKeyRecord>): void {
    const index = this.keys.findIndex((key) => key.id === id);
    if (index === -1) return;
    this.keys[index] = { ...this.keys[index], ...updates };
  }

  private getKeyValue<K extends keyof ApiKeyRecord>(id: number, field: K): ApiKeyRecord[K] {
    const key = this.keys.find((item) => item.id === id);
    if (!key) return 0 as ApiKeyRecord[K];
    return key[field];
  }

  private computeSignature(keys: ApiKeyRecord[]): string {
    return keys
      .map((key) => `${key.id}:${key.weight}:${key.status}`)
      .join('|');
  }
}
