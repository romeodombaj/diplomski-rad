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

export async function close(): Promise<void> {
  await client?.endAsync();
  client = null;
}
