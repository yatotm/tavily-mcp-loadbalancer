import { AppDatabase } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { getCurrentQuotaPeriod } from '../utils/date.js';
import { logger } from '../utils/logger.js';

export class QuotaRefresher {
  private timer?: NodeJS.Timeout;

  constructor(private db: AppDatabase, private keyPool: KeyPool, private exaPool?: KeyPool) {}

  start(intervalMs: number = 60 * 60 * 1000): void {
    this.timer = setInterval(() => this.refresh(), intervalMs);
    this.refresh();
  }

  refresh(): void {
    const currentPeriod = getCurrentQuotaPeriod();
    const keys = this.db.getApiKeys('tavily');
    keys.forEach((key) => {
      const quota = this.db.ensureMonthlyQuota(key.id, currentPeriod);
      if (key.status !== 'quota_exceeded') return;
      // An upstream quota rejection is authoritative for its billing period.
      // Local estimates or an unknown limit must not reactivate it every hour.
      if (key.quota_reset_at && Date.parse(key.quota_reset_at) > Date.now()) return;
      if (!key.quota_reset_at && key.last_error_at?.slice(0, 7) === currentPeriod) return;
      const exhausted =
        quota.quota_limit !== null && quota.used_count >= quota.quota_limit;
      if (exhausted) return;
      this.keyPool.updateStatus(key.id, 'active');
      this.keyPool.resetErrors(key.id);
      logger.info('Key reactivated by monthly quota refresh', {
        keyId: key.id,
        period: currentPeriod,
      });
    });
    if (this.exaPool) {
      for (const key of this.db.getApiKeys('exa')) {
        if (key.status !== 'quota_exceeded' || !key.quota_reset_at || Date.parse(key.quota_reset_at) > Date.now()) continue;
        this.exaPool.updateStatus(key.id, 'active');
        this.exaPool.resetErrors(key.id);
        logger.info('Exa key eligible after quota reset', { keyId: key.id });
      }
    }
    logger.info('Quota refresh check completed', { period: currentPeriod });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
