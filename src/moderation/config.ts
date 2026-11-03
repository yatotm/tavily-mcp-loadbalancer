import { AppDatabase, Provider } from '../data/database.js';

export interface DecisionConfig {
  enabled: boolean;
  channels: Record<Provider, boolean>;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  totalTimeoutMs: number;
  batchSize: number;
  concurrency: number;
  maxCalls: number;
  maxBatchChars: number;
  threshold: number;
}
const defaults: DecisionConfig = {
  enabled: false, channels: { tavily: false, exa: false }, baseUrl: '', model: 'decision-model-preview', apiKey: '',
  timeoutMs: 10000, totalTimeoutMs: 45000, batchSize: 8, concurrency: 2, maxCalls: 64, maxBatchChars: 24000, threshold: 0.5,
};
export const decisionEndpoint = (base: string): string => {
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid decision base URL');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Decision service requires HTTPS (except localhost)');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/systemone$/, '');
  if (!url.pathname.endsWith('/v1')) url.pathname += '/v1';
  url.pathname += '/systemone';
  return url.toString();
};
export class DecisionSettings {
  private value: DecisionConfig;
  constructor(private db: AppDatabase) {
    const stored = JSON.parse(db.getConfigValue('decision') || '{}');
    this.value = { ...defaults, ...stored, channels: { ...defaults.channels, ...stored.channels }, apiKey: db.getSecret('decisionApiKey') };
  }
  get(): DecisionConfig { return structuredClone(this.value); }
  public() { const { apiKey, ...value } = this.get(); return { ...value, apiKeyConfigured: Boolean(apiKey) }; }
  prepare(updates: any): DecisionConfig {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('Invalid decision settings');
    const allowed = new Set(Object.keys(defaults));
    for (const key of Object.keys(updates)) if (!allowed.has(key) && key !== 'apiKeyConfigured') throw new Error(`Unknown decision setting: ${key}`);
    const next = { ...this.value, ...updates, channels: { ...this.value.channels, ...updates.channels } };
    // Empty password field means preserve the encrypted secret. Explicit clearing uses null.
    next.apiKey = updates.apiKey === null ? '' : updates.apiKey || this.value.apiKey;
    delete next.apiKeyConfigured;
    if (typeof next.enabled !== 'boolean' || typeof next.channels.tavily !== 'boolean' || typeof next.channels.exa !== 'boolean') throw new Error('Decision switches must be boolean');
    if (Object.keys(next.channels).some(k => !['tavily', 'exa'].includes(k))) throw new Error('Unknown decision channel');
    if (typeof next.baseUrl !== 'string' || typeof next.model !== 'string' || typeof next.apiKey !== 'string' || next.apiKey.length > 4096) throw new Error('Invalid decision connection settings');
    next.baseUrl = next.baseUrl.trim(); next.model = next.model.trim();
    if (next.baseUrl) decisionEndpoint(next.baseUrl);
    if (next.enabled && (!next.baseUrl || !next.model || !next.apiKey)) throw new Error('Enable review only after configuring base URL, model and API key');
    for (const [key, min, max] of [
      ['timeoutMs', 1000, 60000], ['totalTimeoutMs', 1000, 180000], ['batchSize', 1, 16],
      ['concurrency', 1, 4], ['maxCalls', 1, 256], ['maxBatchChars', 1000, 48000],
    ] as const) {
      if (!Number.isInteger(next[key]) || next[key] < min || next[key] > max) throw new Error(`${key} must be between ${min} and ${max}`);
    }
    if (typeof next.threshold !== 'number' || !Number.isFinite(next.threshold) || next.threshold < 0.01 || next.threshold > 0.99) throw new Error('threshold must be between 0.01 and 0.99');
    return next;
  }
  save(updates: any) {
    const next = this.prepare(updates);
    const { apiKey, ...stored } = next;
    this.db.transaction(() => {
      this.db.setSecret('decisionApiKey', apiKey);
      this.db.setConfigValue('decision', JSON.stringify(stored));
    });
    this.value = next;
    return this.public();
  }
}
