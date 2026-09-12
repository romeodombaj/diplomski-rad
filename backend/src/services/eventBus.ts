import { EventEmitter } from 'events';

export type LiveEventType = 'access' | 'anomaly' | 'drift' | 'policy_sync';

export interface LiveEvent {
  type: LiveEventType;
  buildingId: number | null;
  payload: Record<string, unknown>;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

const CHANNEL = 'live';

export function publish(event: LiveEvent): void {
  emitter.emit(CHANNEL, { ...event, at: new Date().toISOString() });
}

export function subscribe(listener: (event: LiveEvent & { at: string }) => void): () => void {
  emitter.on(CHANNEL, listener);
  return () => emitter.off(CHANNEL, listener);
}

export const listenerCount = () => emitter.listenerCount(CHANNEL);
