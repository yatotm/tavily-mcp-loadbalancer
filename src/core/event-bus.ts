import { EventEmitter } from 'events';

export type EventType = 'request' | 'error' | 'key_status' | 'stats_update';

export interface EventPayload {
  type: EventType;
  data: any;
  timestamp: string;
}

export class EventBus extends EventEmitter {
  emitEvent(type: EventType, data: any): void {
    const payload: EventPayload = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    this.emit('event', payload);
  }
}
