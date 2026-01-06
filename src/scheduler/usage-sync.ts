import { AppDatabase } from '../data/database.js';
import { UsageClient } from '../client/usage-client.js';
import { logger } from '../utils/logger.js';

export class UsageSyncScheduler {
  private timer?: NodeJS.Timeout;

  constructor(private db: AppDatabase, private usageClient: UsageClient) {}

  start(intervalMs: number = 6 * 60 * 60 * 1000): void {
    this.timer = setInterval(() => this.syncAll(), intervalMs);
    this.syncAll();
  }

  async syncAll(): Promise<void> {
    const keys = this.db.getApiKeys();
    for (const key of keys) {
      await this.usageClient.syncUsageForKey(key.id, key.key_value);
    }
    logger.info('Usage sync completed', { keys: keys.length });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
