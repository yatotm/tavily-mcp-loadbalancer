import { ExaUsageClient } from '../billing/exa-usage.js';
import { AppDatabase } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { UsageClient } from '../client/usage-client.js';
import { LogManager } from '../data/log-manager.js';
import { TavilyClient } from '../client/tavily-client.js';
import { RequestGate } from '../client/request-executor.js';
import { RemoteClient } from '../providers/remote-client.js';
import { DecisionSettings } from '../moderation/config.js';
import { ResultReviewer } from '../moderation/reviewer.js';
import { upstreamTools, ToolRouter } from './tools/tool-router.js';
import { EventBus } from './event-bus.js';
import { ConnectionStore } from './connection-store.js';
import { getRuntimeConfig, updateRuntimeConfig } from '../utils/runtime-config.js';
import { logger } from '../utils/logger.js';
import { UsageSyncScheduler } from '../scheduler/usage-sync.js';

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
      } else if (key === 'logResponseBodies') {
        updates[key] = value === 'true';
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
  const usageSync = new UsageSyncScheduler(db, usageClient, eventBus);
  const logManager = new LogManager(db);
  const exaPool = new KeyPool(db, 'exa');
  const exaUsage = new ExaUsageClient(db, exaPool, eventBus);
  const gate = new RequestGate();
  const tavilyClient = new TavilyClient(db, keyPool, logManager, undefined, eventBus, gate);
  const exaClient = new RemoteClient('exa', db, exaPool, logManager, upstreamTools('exa'), gate, eventBus);
  const tavilyRemote = new RemoteClient('tavily', db, keyPool, logManager, upstreamTools('tavily'), gate, eventBus);
  const decisionSettings = new DecisionSettings(db);
  const reviewer = new ResultReviewer(decisionSettings, logManager);
  const toolRouter = new ToolRouter(tavilyClient, exaClient, tavilyRemote, reviewer);

  // seed keys from env if database empty
  if (runtime.seedKeys.length > 0 && db.getApiKeys('tavily').length === 0) {
    const inserted = keyPool.importKeys(runtime.seedKeys.map((key) => ({ keyValue: key })));
    logger.info('Seeded API keys from env', { inserted });
  }

  if (runtime.exaSeedKeys.length && !db.getApiKeys('exa').length) exaPool.importKeys(runtime.exaSeedKeys.map(keyValue => ({ keyValue })));
  // Quota sync may change statuses in the database. Keep the selector's in-memory view in sync.
  eventBus.on('event', (event) => {
    if (event.type === 'key_status') { keyPool.reload(); exaPool.reload(); }
  });

  return {
    db,
    keyPool,
    exaPool,
    exaUsage,
    decisionSettings,
    reviewer,
    usageClient,
    usageSync,
    logManager,
    tavilyClient,
    toolRouter,
    eventBus,
    connectionStore,
  };
};
