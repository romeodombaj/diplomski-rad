/**
 * Publishes the unlock command to the physical door.
 *
 * This replaces the three console.log lines in the old verificationService,
 * which meant no door had ever actually been told to open. Each door row
 * carries its own `mqtt_topic`; per specs/HARDWARE_ACCESS_NOTES.md the topic
 * currently drives a WiFi smart plug whose click stands in for a real lock.
 *
 * DEGRADED MODE: with no MQTT_URL configured the publish is logged and skipped
 * rather than throwing. An unreachable broker must not turn into a 500 on a
 * request that already passed identity, policy and revocation checks — the
 * access decision is recorded either way, and `delivered` reports the truth.
 */
import mqtt, { type MqttClient } from 'mqtt';
import logger from '../lib/logger';
import { config } from './../config/conifg';

let client: MqttClient | null = null;
let connecting = false;

export function init(): void {
  if (!config.mqtt.url) {
    logger.warn('[mqtt] disabled — MQTT_URL not set; unlock commands will be logged only');
    return;
  }
  if (client || connecting) return;
  connecting = true;

  client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.username || undefined,
    password: config.mqtt.password || undefined,
    reconnectPeriod: 5000,
    connectTimeout: 10_000,
    clientId: `${config.mqtt.clientId}-${Math.random().toString(16).slice(2, 8)}`,
  });

  client.on('connect', () => logger.info(`[mqtt] connected to ${config.mqtt.url}`));
  client.on('error', (err) => logger.error(`[mqtt] ${err.message}`));
  client.on('close', () => logger.warn('[mqtt] connection closed'));
  connecting = false;
}

export const isConnected = () => Boolean(client?.connected);

export const status = () => ({
  enabled: Boolean(config.mqtt.url),
  connected: isConnected(),
  url: config.mqtt.url || null,
});

export interface UnlockCommand {
  doorId: number;
  doorCode: string;
  did: string;
  eventId: string;
  holdSeconds?: number;
}

/**
 * Publish an unlock to one door's topic.
 * @returns whether the broker actually took the message.
 */
export async function publishUnlock(topic: string, cmd: UnlockCommand): Promise<boolean> {
  const payload = JSON.stringify({
    action: 'unlock',
    door_id: cmd.doorId,
    door_code: cmd.doorCode,
    did: cmd.did,
    event_id: cmd.eventId,
    hold_seconds: cmd.holdSeconds ?? config.mqtt.holdSeconds,
    timestamp: Date.now(),
  });

  if (!client?.connected) {
    logger.warn(`[mqtt] not connected — would publish to ${topic}: ${payload}`);
    return false;
  }

  return new Promise((resolve) => {
    client!.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) {
        logger.error(`[mqtt] publish to ${topic} failed: ${err.message}`);
        return resolve(false);
      }
      logger.info(`[mqtt] unlock → ${topic} (door ${cmd.doorCode})`);
      resolve(true);
    });
  });
}

export interface ProximityUpdate {
  doorId: number;
  doorCode: string;
  /** LED steps to light, 0..levels. */
  level: number;
  /** Total steps, so the door does not need to share the backend's config. */
  levels: number;
  /** Smoothed RSSI behind the bucket. For calibration and diagnostics only. */
  rssi: number;
}

/**
 * Publish an LED proximity update to one door's ring.
 *
 * Three deliberate differences from `publishUnlock`, all because this is
 * cosmetic and continuous rather than consequential and rare:
 *
 *  - **QoS 0.** An unlock must arrive; a position update must be *current*. QoS
 *    1 would retry a frame describing where somebody stood a second ago, which
 *    is worse than dropping it — the next report is already on its way.
 *  - **Not retained.** A retained proximity would relight the ring from stale
 *    state whenever the door reboots, showing someone standing there who left
 *    hours earlier.
 *  - **Logged at debug.** One approach produces a message per LED step; at info
 *    this would bury the access log it sits next to.
 *
 * The door is responsible for fading its own ring out when updates stop — see
 * hardware/door-beacon/respeaker-leds.yaml. Nothing here sends a final zero,
 * because the phone that walks away, backgrounds the app or loses WiFi is
 * exactly the case that would never send one.
 */
export async function publishProximity(
  topic: string,
  update: ProximityUpdate,
): Promise<boolean> {
  const payload = JSON.stringify({
    action: 'proximity',
    door_id: update.doorId,
    door_code: update.doorCode,
    level: update.level,
    levels: update.levels,
    rssi: update.rssi,
    timestamp: Date.now(),
  });

  if (!client?.connected) return false;

  return new Promise((resolve) => {
    client!.publish(`${topic}/proximity`, payload, { qos: 0 }, (err) => {
      if (err) {
        logger.debug(`[mqtt] proximity publish to ${topic}/proximity failed: ${err.message}`);
        return resolve(false);
      }
      logger.debug(`[mqtt] proximity ${update.level}/${update.levels} -> ${topic}/proximity`);
      resolve(true);
    });
  });
}

export async function close(): Promise<void> {
  await client?.endAsync();
  client = null;
}
