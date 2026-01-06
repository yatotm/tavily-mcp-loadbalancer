#!/usr/bin/env node

import { assertConfig } from './utils/config.js';
import { bootstrapCore } from './core/bootstrap.js';
import { McpStdioServer } from './core/mcp-server.js';
import { logger } from './utils/logger.js';

async function main() {
  try {
    assertConfig();
    const core = bootstrapCore();
    const server = new McpStdioServer(core.toolRouter);
    await server.run();
  } catch (error: any) {
    logger.error('Failed to start MCP stdio server', { error: error?.message });
    process.exit(1);
  }
}

main();
