import { QuotaRefresher } from './quota-refresh.js';
import { UsageSyncScheduler } from './usage-sync.js';
import { LogCleanupScheduler } from './log-cleanup.js';
import { StatsBroadcastScheduler } from './stats-broadcast.js';
import { AppDatabase } from '../data/database.js';
import { KeyPool } from '../loadbalancer/key-pool.js';
import { StatsService } from '../core/stats-service.js';
import { EventBus } from '../core/event-bus.js';
import { ConnectionStore } from '../core/connection-store.js';

export class SchedulerManager {
  private quotaRefresher: QuotaRefresher;
  private usageSync: UsageSyncScheduler;
  private logCleanup: LogCleanupScheduler;
  private statsBroadcast: StatsBroadcastScheduler;

  constructor(
    db: AppDatabase,
    keyPool: KeyPool,
    usageSync: UsageSyncScheduler,
    eventBus: EventBus,
    connectionStore: ConnectionStore,
    exaPool?: KeyPool
  ) {
    this.quotaRefresher = new QuotaRefresher(db, keyPool, exaPool);
    this.usageSync = usageSync;
    this.logCleanup = new LogCleanupScheduler(db);
    this.statsBroadcast = new StatsBroadcastScheduler(new StatsService(db, connectionStore), eventBus);
  }

  start(): void {
    this.quotaRefresher.start();
    this.usageSync.start();
    this.logCleanup.start();
    this.statsBroadcast.start();
  }

  stop(): void {
    this.quotaRefresher.stop();
    this.usageSync.stop();
    this.logCleanup.stop();
    this.statsBroadcast.stop();
  }
}
