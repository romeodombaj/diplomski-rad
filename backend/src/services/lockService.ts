/**
 * Turning "open this door" into whatever the hardware at it actually speaks.
 *
 * The access path decides *whether* a door opens. This decides *how*. Keeping
 * them apart is what lets the lock be swapped — a smart plug standing in for a
 * strike during a demo, a real relay later — without touching the eleven steps
 * that authorise the request.
 *
 * The shape of a command comes from the lock device's profile, because that is
 * the object with a lifecycle: a door is a policy object (a code, a building,
 * who may open it) and the door's own `mqtt_topic` is only the fallback for a
 * door with no lock device registered yet. That fallback is what every door
 * used before this file existed, so nothing breaks by leaving it unset.
 *
 * MOMENTARY vs LATCHING. Firmware written for this system reads a JSON payload
 * carrying `hold_seconds` and releases itself. A generic relay does not: it is
 * told ON, and something has to tell it OFF again. That release is scheduled
 * here, in process — see the warning on `scheduleRelease`.
 */
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

/** The subset of a device row this needs. */
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
  /** The DID that opened it, or an `admin:` actor for a dashboard override. */
  did: string;
  eventId: string;
}

export interface LockCommand {
  topic: string;
  payload: string;
  /** Present only for locks that latch and must be told to release. */
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

/**
 * What to publish, and where.
 *
 * Exported and pure so the shape of every profile can be asserted in a test
 * without a broker — the one part of this file where a typo means a door that
 * never opens, and the one part a unit test can actually catch.
 */
export function buildCommand(
  device: LockDevice | null,
  doorMqttTopic: string,
  ctx: UnlockContext,
): LockCommand {
  const profile = (device?.lock_profile as LockProfile) ?? DEFAULT_PROFILE;
  const holdSeconds = device?.hold_seconds ?? config.mqtt.holdSeconds;
  const afterMs = holdSeconds * 1000;

  // The device's own address wins over the door's topic: the door topic is a
  // property of the door, and a lock that was moved to another door should
  // carry its addressing with it.
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
      // `address` is expected to be the entity path, e.g.
      // `respeaker-door-ring/switch/strike` — the same string the MQTT scan
      // reports, minus the trailing `/state`.
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
        // A custom lock only gets a release when one was configured. Sending a
        // guessed payload at a lock nobody described is worse than sending
        // nothing: it could latch the door open rather than close it.
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
        // The firmware holds and releases on its own — that is what
        // `hold_seconds` in the payload is for.
        release: null,
      };
  }
}

/**
 * Send the release after the hold window.
 *
 * IN-PROCESS, AND THEREFORE NOT A SAFETY MECHANISM. If the backend is restarted
 * inside the window the timer dies with it and the relay stays closed — meaning
 * a door held open by a process crash. Anything load-bearing must fail safe at
 * the device: Tasmota `PulseTime`, an ESPHome `on_turn_on` delayed-off
 * automation, or a strike that is mechanically momentary. This exists so that a
 * plug bought off a shelf behaves like a lock out of the box, not so that the
 * building depends on this process staying up.
 */
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
  /** The lock device used, or null when the door's own topic was the fallback. */
  deviceId: number | null;
}

/**
 * Open one door.
 *
 * An inactive lock device is treated as no device at all rather than as a
 * failure: the door's own topic is still the best guess available, and refusing
 * to publish would turn "somebody unchecked the active box" into "nobody can
 * get in".
 */
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
