import { AppDatabase } from '../data/database.js';
import { UsageClient } from '../client/usage-client.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class UsageSyncScheduler {
  private timer?: NodeJS.Timeout;

  constructor(private db: AppDatabase, private usageClient: UsageClient) {}

  start(intervalMs: number = 6 * 60 * 60 * 1000): void {
    this.timer = setInterval(() => this.syncAll(), intervalMs);
    this.syncAll();
  }

  async syncAll(): Promise<void> {
    const keys = this.db.getApiKeys();
    for (let index = 0; index < keys.length; index += 1) {
      if (index > 0 && config.usageSyncDelayMs > 0) {
        await sleep(config.usageSyncDelayMs);
      }
      const key = keys[index];
      await this.usageClient.syncUsageForKey(key.id, key.key_value);
    }
    logger.info('Usage sync completed', { keys: keys.length });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
