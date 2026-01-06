import { AppDatabase } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { UsageClient } from '../client/usage-client.js';
import { LogManager } from '../data/log-manager.js';
import { TavilyClient } from '../client/tavily-client.js';
import { ToolRouter } from './tools/tool-router.js';
import { EventBus } from './event-bus.js';
import { ConnectionStore } from './connection-store.js';
import { getRuntimeConfig, updateRuntimeConfig } from '../utils/runtime-config.js';
import { logger } from '../utils/logger.js';

export const bootstrapCore = () => {
  const runtime = getRuntimeConfig();
  const db = new AppDatabase(runtime.databasePath, runtime.databaseEncryptionKey);

  // load persisted config overrides
  try {
    const storedConfig = db.getAllConfigValues();
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(storedConfig)) {
      if (['maxConcurrentRequests', 'requestTimeoutMs', 'logRetentionDays'].includes(key)) {
        updates[key] = Number(value);
      } else if (['logLevel', 'logFormat'].includes(key)) {
        updates[key] = value;
      }
    }
    updateRuntimeConfig(updates);
  } catch (error: any) {
    logger.warn('Failed to load runtime config from database', { error: error?.message });
  }

  const eventBus = new EventBus();
  const connectionStore = new ConnectionStore();
  const keyPool = new KeyPool(db);
  const usageClient = new UsageClient(db);
  const logManager = new LogManager(db);
  const tavilyClient = new TavilyClient(db, keyPool, usageClient, logManager, undefined, eventBus);
  const toolRouter = new ToolRouter(tavilyClient);

  // seed keys from env if database empty
  if (runtime.seedKeys.length > 0 && db.getApiKeys().length === 0) {
    const inserted = keyPool.importKeys(runtime.seedKeys.map((key) => ({ keyValue: key })));
    logger.info('Seeded API keys from env', { inserted });
  }

  return {
    db,
    keyPool,
    usageClient,
    logManager,
    tavilyClient,
    toolRouter,
    eventBus,
    connectionStore,
  };
};
