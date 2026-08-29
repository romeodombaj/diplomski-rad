/**
 * In-process pub/sub between the parts of the backend that produce live events
 * and the WebSocket layer that ships them to dashboards.
 *
 * Exists so the access path and the behaviour client do not import the
 * WebSocket server directly — they announce that something happened and stay
 * unaware of whether anyone is listening. That keeps the socket layer
 * removable and stops a transport concern leaking into the access decision.
 *
 * Deliberately not a message broker. Events are ephemeral: a dashboard that
 * was not connected missed them, and reads the durable record from
 * /api/audit-logs instead. Nothing here is the system of record.
 */
import { EventEmitter } from 'events';

export type LiveEventType = 'access' | 'anomaly' | 'drift' | 'policy_sync';

export interface LiveEvent {
  type: LiveEventType;
  /** Scopes delivery — a dashboard only sees its own building. */
  buildingId: number | null;
  payload: Record<string, unknown>;
}

const emitter = new EventEmitter();
// One listener per connected dashboard; the default cap of 10 would start
// printing warnings on a wall display plus a few open tabs.
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
