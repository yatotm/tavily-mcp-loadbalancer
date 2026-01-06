import dotenv from 'dotenv';

dotenv.config();

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const parseDefaultParameters = (): Record<string, unknown> => {
  const raw = process.env.DEFAULT_PARAMETERS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

const parseSeedKeys = (): string[] => {
  const raw = process.env.TAVILY_API_KEYS || process.env.TAVILY_API_KEY || '';
  if (!raw) return [];
  return raw
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
};

export const config = {
  port: parseNumber(process.env.PORT || process.env.SUPERGATEWAY_PORT, 60002),
  host: process.env.HOST || '0.0.0.0',
  databasePath: process.env.DATABASE_PATH || './data/tavily.db',
  databaseEncryptionKey: process.env.DATABASE_ENCRYPTION_KEY || '',
  logRetentionDays: parseNumber(process.env.LOG_RETENTION_DAYS, 30),
  maxConcurrentRequests: parseNumber(process.env.MAX_CONCURRENT_REQUESTS, 4),
  requestTimeoutMs: parseNumber(process.env.REQUEST_TIMEOUT, 30000),
  maxKeyErrors: parseNumber(process.env.MAX_KEY_ERRORS, 5),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  enableWebUI: parseBoolean(process.env.ENABLE_WEB_UI, true),
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  logFormat: (process.env.LOG_FORMAT || 'json').toLowerCase(),
  nodeEnv: process.env.NODE_ENV || 'production',
  defaultParameters: parseDefaultParameters(),
  seedKeys: parseSeedKeys(),
};

export const assertConfig = (): void => {
  if (!config.databaseEncryptionKey) {
    throw new Error('DATABASE_ENCRYPTION_KEY is required. Set it before starting the service.');
  }
};
