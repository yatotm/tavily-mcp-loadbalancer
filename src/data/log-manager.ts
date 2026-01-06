import { AppDatabase, RequestLogRecord } from './database.js';
import { logger } from '../utils/logger.js';

export class LogManager {
  private queue: Array<Omit<RequestLogRecord, 'id' | 'created_at'>> = [];
  private timer: NodeJS.Timeout;
  private flushing = false;

  constructor(private db: AppDatabase, intervalMs: number = 1000) {
    this.timer = setInterval(() => this.flush(), intervalMs);
  }

  enqueue(entry: Omit<RequestLogRecord, 'id' | 'created_at'>): void {
    this.queue.push(entry);
    if (this.queue.length > 200) {
      this.flush();
    }
  }

  flush(): void {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      this.db.insertRequestLogs(batch);
    } catch (error: any) {
      logger.warn('Failed to write request logs batch', { error: error?.message });
      // requeue if failed
      this.queue.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }

  shutdown(): void {
    clearInterval(this.timer);
    this.flush();
  }
}
