/**
 * Scan for door beacons and decide which door the user is standing at.
 *
 * The door broadcasts and the phone listens — never the reverse. Per
 * hardware/door-beacon/README.md that ordering is what lets the button light up
 * instantly, with no network round trip and no dependency on the door having
 * working WiFi.
 *
 * DEGRADES TO THE MANUAL LIST. Every failure here — permission refused, radio
 * switched off, a handset with no BLE, an enrolment cached before doors carried
 * ids — resolves to `supported: false`, and the screen falls back to the door
 * picker it had before. A broken radio must never be able to keep somebody out
 * of a building, and it cannot: the BLE gate only chooses what the UI offers,
 * and the backend re-checks everything regardless.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device } from 'react-native-ble-plx';
import {
  BEACON_UUID,
  BEACON_TTL_MS,
  LED_LEVELS,
  isWithinGate,
  parseIBeacon,
  rssiToLevel,
  smoothRssi,
} from '@/lib/beacon';
import { reportProximity, type Door } from '@/lib/device';

/** How often to expire stale doors and re-evaluate which one is nearest. */
const TICK_MS = 500;

/**
 * Scan this long without hearing a single door beacon and give up, falling back
 * to the manual picker.
 *
 * Same principle as a denied permission: a dead beacon must not be able to keep
 * somebody out of a building. Without this, one flat battery at a door — or a
 * building whose beacons have not been installed yet — leaves every enrolled
 * phone showing a permanently disabled button and no way to proceed.
 *
 * It only applies before the FIRST sighting. Once a door has been heard, going
 * quiet means the user walked away, which is exactly when the gate should close.
 */
const NO_BEACON_FALLBACK_MS = 12000;

export interface NearbyDoor {
  door: Door;
  /** Smoothed, not raw — see smoothRssi. */
  rssi: number;
  level: number;
  /** Whether the unlock button should be offered for this door. */
  withinGate: boolean;
}

export type ProximityStatus =
  | 'scanning'
  | 'bluetooth-off'
  | 'permission-denied'
  | 'no-beacons'
  | 'unsupported';

interface Tracked {
  rssi: number;
  lastSeen: number;
  withinGate: boolean;
}

/**
 * Ask for what Android needs to see a BLE advertisement.
 *
 * Two regimes. On API 31+ `BLUETOOTH_SCAN` is enough, because the manifest
 * declares it `neverForLocation` (see the react-native-ble-plx block in
 * app.json). Below that there is no such permission and the OS will return an
 * empty scan — no error, no callback, nothing — unless location is granted AND
 * location services are switched on. That silent-empty-scan is the single most
 * common way this feature appears broken.
 */
async function requestScanPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const wanted =
    Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const granted = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => granted[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export function useDoorProximity(doors: Door[], enabled: boolean) {
  const [status, setStatus] = useState<ProximityStatus>('scanning');
  const [nearby, setNearby] = useState<NearbyDoor[]>([]);

  // One manager for the life of the screen. Constructing it per render leaks a
  // native object and silently stops delivering scan results.
  const managerRef = useRef<BleManager | null>(null);
  const trackedRef = useRef<Map<string, Tracked>>(new Map());
  /** Whether any door beacon has ever been heard — see NO_BEACON_FALLBACK_MS. */
  const sawBeaconRef = useRef(false);
  /** Last `${door_code}:${level}` actually sent, so we report on change only. */
  const lastReportRef = useRef<string | null>(null);

  /**
   * (major, minor) -> door. Built from the enrolment door list, which is why
   * claimEnrollment returns `id` and `building_id`. Doors cached before those
   * fields existed are skipped, and an empty index means no beacon support.
   */
  const byBeacon = useMemo(() => {
    const index = new Map<string, Door>();
    for (const d of doors) {
      if (typeof d.id === 'number' && typeof d.building_id === 'number') {
        index.set(`${d.building_id}:${d.id}`, d);
      }
    }
    return index;
  }, [doors]);

  const onDevice = useCallback(
    (device: Device) => {
      const frame = parseIBeacon(device.manufacturerData);
      if (!frame || frame.uuid !== BEACON_UUID) return;
      if (device.rssi === null) return;

      const door = byBeacon.get(`${frame.major}:${frame.minor}`);
      // A beacon for a door this person has no business at — another building,
      // or one they are not enrolled for. Ignore it rather than showing a door
      // the backend would refuse anyway.
      if (!door) return;

      sawBeaconRef.current = true;
      const previous = trackedRef.current.get(door.door_code);
      const rssi = smoothRssi(previous?.rssi ?? null, device.rssi);
      trackedRef.current.set(door.door_code, {
        rssi,
        lastSeen: Date.now(),
        withinGate: isWithinGate(rssi, previous?.withinGate ?? false),
      });
    },
    [byBeacon],
  );

  // ── the scan ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    if (byBeacon.size === 0) {
      setStatus('unsupported');
      return;
    }

    let cancelled = false;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const manager = managerRef.current ?? new BleManager();
    managerRef.current = manager;

    const start = async () => {
      if (!(await requestScanPermission())) {
        if (!cancelled) setStatus('permission-denied');
        return;
      }
      if (cancelled) return;

      // `null` for the service-UUID filter is not laziness: an iBeacon carries
      // no service UUID at all, so filtering on one matches nothing. The UUID
      // check happens in onDevice, against the manufacturer data.
      manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
        if (error) {
          if (!cancelled) setStatus('bluetooth-off');
          return;
        }
        if (device) onDevice(device);
      });
      if (!cancelled) setStatus('scanning');

      giveUp = setTimeout(() => {
        if (!cancelled && !sawBeaconRef.current) setStatus('no-beacons');
      }, NO_BEACON_FALLBACK_MS);
    };

    // Wait for the adapter before scanning; starting while it is off throws and
    // the subscription is how we notice it being switched on again.
    const subscription = manager.onStateChange((state) => {
      if (state === State.PoweredOn) {
        void start();
      } else {
        trackedRef.current.clear();
        if (!cancelled) {
          setNearby([]);
          setStatus(state === State.Unsupported ? 'unsupported' : 'bluetooth-off');
        }
      }
    }, true);

    return () => {
      cancelled = true;
      if (giveUp) clearTimeout(giveUp);
      subscription.remove();
      manager.stopDeviceScan();
      trackedRef.current.clear();
      lastReportRef.current = null;
    };
  }, [enabled, byBeacon, onDevice]);

  // Destroy the native manager only when the hook itself goes away.
  useEffect(() => () => { managerRef.current?.destroy(); managerRef.current = null; }, []);

  // ── expiry, ranking, and the LED report ───────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const tick = setInterval(() => {
      const now = Date.now();
      const rows: NearbyDoor[] = [];

      for (const [doorCode, t] of trackedRef.current) {
        // Expiring on silence is what makes walking away work. Nothing sends a
        // "gone" event, so absence is the only signal there is.
        if (now - t.lastSeen > BEACON_TTL_MS) {
          trackedRef.current.delete(doorCode);
          continue;
        }
        const door = doors.find((d) => d.door_code === doorCode);
        if (!door) continue;
        rows.push({ door, rssi: t.rssi, level: rssiToLevel(t.rssi), withinGate: t.withinGate });
      }

      rows.sort((a, b) => b.rssi - a.rssi);
      setNearby(rows);

      // Report only the closest door, and only when its bucket changes. The
      // scan fires ~10x a second; the ring has eight steps. Without this the
      // phone would post a hundred times a second to move a light.
      const closest = rows[0];
      const key = closest ? `${closest.door.door_code}:${closest.level}` : null;
      if (key !== lastReportRef.current) {
        lastReportRef.current = key;
        if (closest) void reportProximity(closest.door.door_code, closest.level, closest.rssi);
      }
    }, TICK_MS);

    return () => clearInterval(tick);
  }, [enabled, doors]);

  const nearest = nearby.find((d) => d.withinGate) ?? null;

  return {
    status,
    /** Every door currently in range, closest first. */
    nearby,
    /** The door close enough to offer, or null. */
    nearest,
    /** False when BLE cannot run at all — the screen falls back to the picker. */
    supported: status === 'scanning',
    levels: LED_LEVELS,
  };
}
