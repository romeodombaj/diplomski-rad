import logger from '../lib/logger';
import { config } from '../config/conifg';
import * as mqttService from './mqttService';

export const LOCK_PROFILES = [
  'native_json',
  'tasmota',
  'shelly',
  'esphome_switch',
  'zigbee2mqtt',
  'custom',
] as const;
export type LockProfile = (typeof LOCK_PROFILES)[number];

export const DEFAULT_PROFILE: LockProfile = 'native_json';

export interface LockDevice {
  id: number;
  name: string;
  address: string | null;
  active: boolean;
  lock_profile: string | null;
  command_topic: string | null;
  unlock_payload: string | null;
  lock_payload: string | null;
  hold_seconds: number | null;
}

export interface UnlockContext {
  doorId: number;
  doorCode: string;
  did: string;
  eventId: string;
}

export interface LockCommand {
  topic: string;
  payload: string;
  release: { topic: string; payload: string; afterMs: number } | null;
  profile: LockProfile;
}

const nativePayload = (ctx: UnlockContext, holdSeconds: number) =>
  JSON.stringify({
    action: 'unlock',
    door_id: ctx.doorId,
    door_code: ctx.doorCode,
    did: ctx.did,
    event_id: ctx.eventId,
    hold_seconds: holdSeconds,
    timestamp: Date.now(),
  });

export function buildCommand(
  device: LockDevice | null,
  doorMqttTopic: string,
  ctx: UnlockContext,
): LockCommand {
  const profile = (device?.lock_profile as LockProfile) ?? DEFAULT_PROFILE;
  const holdSeconds = device?.hold_seconds ?? config.mqtt.holdSeconds;
  const afterMs = holdSeconds * 1000;

  const base = device?.address?.trim() || doorMqttTopic;
  const explicit = device?.command_topic?.trim();

  switch (profile) {
    case 'tasmota':
      return {
        profile,
        topic: explicit || `cmnd/${base}/POWER`,
        payload: 'ON',
        release: { topic: explicit || `cmnd/${base}/POWER`, payload: 'OFF', afterMs },
      };

    case 'shelly':
      return {
        profile,
        topic: explicit || `${base}/relay/0/command`,
        payload: 'on',
        release: { topic: explicit || `${base}/relay/0/command`, payload: 'off', afterMs },
      };

    case 'esphome_switch':
      return {
        profile,
        topic: explicit || `${base}/command`,
        payload: 'ON',
        release: { topic: explicit || `${base}/command`, payload: 'OFF', afterMs },
      };

    case 'zigbee2mqtt':
      return {
        profile,
        topic: explicit || `${base}/set`,
        payload: JSON.stringify({ state: 'ON' }),
        release: { topic: explicit || `${base}/set`, payload: JSON.stringify({ state: 'OFF' }), afterMs },
      };

    case 'custom':
      return {
        profile,
        topic: explicit || base,
        payload: device?.unlock_payload ?? nativePayload(ctx, holdSeconds),
        release: device?.lock_payload
          ? { topic: explicit || base, payload: device.lock_payload, afterMs }
          : null,
      };

    case 'native_json':
    default:
      return {
        profile: 'native_json',
        topic: explicit || base,
        payload: nativePayload(ctx, holdSeconds),
        release: null,
      };
  }
}

function scheduleRelease(release: NonNullable<LockCommand['release']>, doorCode: string) {
  setTimeout(() => {
    mqttService
      .publishRaw(release.topic, release.payload)
      .then((ok) => {
        if (!ok) logger.error(`[lock] release for ${doorCode} was not delivered — door may be held open`);
      })
      .catch((err) => logger.error(`[lock] release for ${doorCode} failed: ${err.message}`));
  }, release.afterMs).unref?.();
}

export interface ActuateResult {
  delivered: boolean;
  profile: LockProfile;
  topic: string;
  deviceId: number | null;
}

export async function actuate(
  door: { id: number; door_code: string; mqtt_topic: string },
  device: LockDevice | null,
  ctx: UnlockContext,
): Promise<ActuateResult> {
  const usable = device?.active ? device : null;
  const cmd = buildCommand(usable, door.mqtt_topic, ctx);

  const delivered = await mqttService.publishRaw(cmd.topic, cmd.payload);

  if (delivered && cmd.release) scheduleRelease(cmd.release, door.door_code);

  logger.info(
    `[lock] ${cmd.profile} → ${cmd.topic} (door ${door.door_code}) delivered=${delivered}` +
      (cmd.release ? ` release in ${cmd.release.afterMs}ms` : ''),
  );

  return { delivered, profile: cmd.profile, topic: cmd.topic, deviceId: usable?.id ?? null };
}
