import { StatsService } from '../core/stats-service.js';
import { EventBus } from '../core/event-bus.js';

export class StatsBroadcastScheduler {
  private timer?: NodeJS.Timeout;

  constructor(private statsService: StatsService, private eventBus: EventBus) {}

  start(intervalMs: number = 15000): void {
    this.timer = setInterval(() => this.broadcast(), intervalMs);
    this.broadcast();
  }

  broadcast(): void {
    const overview = this.statsService.getOverview();
    this.eventBus.emitEvent('stats_update', overview);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
