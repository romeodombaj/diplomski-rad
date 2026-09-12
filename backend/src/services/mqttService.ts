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

export async function publishRaw(topic: string, payload: string): Promise<boolean> {
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
      resolve(true);
    });
  });
}

export interface ProximityUpdate {
  doorId: number;
  doorCode: string;
  level: number;
  levels: number;
  rssi: number;
}

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
