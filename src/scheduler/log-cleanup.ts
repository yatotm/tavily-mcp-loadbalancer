import { AppDatabase } from '../data/database.js';
import { getRuntimeConfig } from '../utils/runtime-config.js';
import { daysAgoIso } from '../utils/date.js';
import { logger } from '../utils/logger.js';

export class LogCleanupScheduler {
  private timer?: NodeJS.Timeout;

  constructor(private db: AppDatabase) {}

  start(intervalMs: number = 24 * 60 * 60 * 1000): void {
    this.timer = setInterval(() => this.cleanup(), intervalMs);
    this.cleanup();
  }

  cleanup(): void {
    const runtime = getRuntimeConfig();
    const cutoff = daysAgoIso(runtime.logRetentionDays);
    const deleted = this.db.deleteOldLogs(cutoff);
    if (deleted > 0) {
      logger.info('Old logs removed', { deleted });
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
