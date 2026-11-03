#!/usr/bin/env node

import { assertConfig } from './utils/config.js';
import { bootstrapCore } from './core/bootstrap.js';
import { HttpServer } from './core/http-server.js';
import { ApiRouter } from './api/router.js';
import { SchedulerManager } from './scheduler/index.js';
import { logger } from './utils/logger.js';

async function main() {
  try {
    assertConfig();
    const core = bootstrapCore();
    const apiRouter = new ApiRouter(core.db, core.keyPool, core.usageSync, core.eventBus, core.connectionStore, core.exaPool, core.decisionSettings, core.reviewer, core.toolRouter, core.exaUsage);
    const httpServer = new HttpServer(core.toolRouter, apiRouter, core.eventBus, core.connectionStore);
    const scheduler = new SchedulerManager(core.db, core.keyPool, core.usageSync, core.eventBus, core.connectionStore, core.exaPool);

    httpServer.start();
    scheduler.start();
    core.exaUsage.start();

    const shutdown = async (signal: string) => {
      logger.info('Shutting down', { signal });
      scheduler.stop();
      core.exaUsage.stop();
      await httpServer.stop();
      core.logManager.shutdown();
      core.db.close();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error: any) {
    logger.error('Failed to start HTTP server', { error: error?.message });
    process.exit(1);
  }
}

main();
