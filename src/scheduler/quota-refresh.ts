import { AppDatabase } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { getCurrentQuotaPeriod } from '../utils/date.js';
import { logger } from '../utils/logger.js';

export class QuotaRefresher {
  private timer?: NodeJS.Timeout;

  constructor(private db: AppDatabase, private keyPool: KeyPool) {}

  start(intervalMs: number = 60 * 60 * 1000): void {
    this.timer = setInterval(() => this.refresh(), intervalMs);
    this.refresh();
  }

  refresh(): void {
    const currentPeriod = getCurrentQuotaPeriod();
    const keys = this.db.getApiKeys();
    keys.forEach((key) => {
      const existing = this.db.getMonthlyQuotaForKey(key.id, currentPeriod);
      if (!existing) {
        this.db.ensureMonthlyQuota(key.id, currentPeriod);
        if (key.status === 'quota_exceeded') {
          this.keyPool.updateStatus(key.id, 'active');
        }
      }
    });
    logger.info('Quota refresh check completed', { period: currentPeriod });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
