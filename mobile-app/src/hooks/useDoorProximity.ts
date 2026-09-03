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
import { BleManager, ScanMode, State, type Device } from 'react-native-ble-plx';
import {
  BEACON_UUID,
  BEACON_TTL_MS,
  LED_LEVELS,
  isWithinGate,
  parseIBeacon,
  rssiToLevel,
  medianRssi,
  LEVEL_CONFIRM_TICKS,
  type RssiSample,
} from '@/lib/beacon';
import { reportProximity, type Door } from '@/lib/device';

/**
 * How often to expire stale doors and re-evaluate which one is nearest.
 *
 * This is the floor on how quickly the ring can respond to someone moving, so
 * it is deliberately shorter than a comfortable walking pace would need.
 */
const TICK_MS = 250;

/**
 * Re-send the current level at least this often while a door is in range.
 *
 * Must stay comfortably below the door firmware's own clear-the-ring timeout,
 * or the ring goes dark under somebody who has simply stopped moving.
 */
const PROXIMITY_KEEPALIVE_MS = 2000;

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
  | 'scan-error'
  | 'no-beacons'
  | 'unsupported';

/**
 * What the scan is actually seeing, for the door card to display.
 *
 * Without this the two interesting failures are indistinguishable: a scan that
 * receives nothing at all (radio, permission or OEM restriction) looks exactly
 * like one receiving plenty of advertisements from other devices where none is
 * ours (wrong UUID, wrong door ids, a parser that rejects the frame).
 */
export interface ProximityDiagnostics {
  /** Every BLE advertisement the scan callback delivered. */
  seen: number;
  /** Those that parsed as an iBeacon, whatever its UUID. */
  iBeacons: number;
  /** Those whose UUID matched ours. */
  ours: number;
  /** Verbatim text of the last scan error, mislabelled as "off" before. */
  lastError: string | null;
}

interface Tracked {
  /** Raw readings inside the median window; trimmed as it slides. */
  samples: RssiSample[];
  /** Median of that window — what everything downstream reads. */
  rssi: number;
  lastSeen: number;
  withinGate: boolean;
  /** The level currently being shown. */
  level: number;
  /** A different level waiting to be confirmed, and for how many ticks. */
  pendingLevel: number;
  pendingTicks: number;
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

  const api = Number(Platform.Version);
  const wanted =
    api >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          // Required even though this code never connects to anything.
          // react-native-ble-plx's Android layer reads adapter state (name,
          // status) while setting a scan up, and Android 12+ gates those behind
          // BLUETOOTH_CONNECT — so startDeviceScan throws
          // `SecurityException: Need android.permission.BLUETOOTH_CONNECT`
          // before delivering a single advertisement. Declaring it in the
          // manifest is not enough; it is a runtime permission.
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          // Requested even though the manifest declares neverForLocation:
          // several OEM builds — MIUI among them — still return an empty scan,
          // with no error and no callback, unless location is granted. Asking
          // costs a prompt; not asking costs a feature that silently does
          // nothing.
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const granted = await PermissionsAndroid.requestMultiple(wanted);
  // BLUETOOTH_SCAN is the one that must be granted; location is best-effort, so
  // a refusal there still lets the scan start rather than blocking it outright.
  const required = api >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
       PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  return required.every((p) => granted[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export function useDoorProximity(doors: Door[], enabled: boolean) {
  const [status, setStatus] = useState<ProximityStatus>('scanning');
  const [nearby, setNearby] = useState<NearbyDoor[]>([]);

  // One manager for the life of the screen. Constructing it per render leaks a
  // native object and silently stops delivering scan results.
  const managerRef = useRef<BleManager | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProximityDiagnostics>({
    seen: 0, iBeacons: 0, ours: 0, lastError: null,
  });
  // Counted in a ref and flushed on a timer: advertisements arrive many times a
  // second and a setState per frame is what made the liveness camera unusable.
  const countsRef = useRef({ seen: 0, iBeacons: 0, ours: 0 });
  const trackedRef = useRef<Map<string, Tracked>>(new Map());
  /** Whether any door beacon has ever been heard — see NO_BEACON_FALLBACK_MS. */
  const sawBeaconRef = useRef(false);
  /** Last `${door_code}:${level}` sent, so an unchanged level is not re-posted. */
  const lastReportRef = useRef<string | null>(null);
  /** When that last report went out — see the keepalive in the tick below. */
  const lastReportAtRef = useRef(0);

  /**
   * (major, minor) -> door. Built from the enrolment door list, which is why
   * claimEnrollment returns `id` and `building_id`. Doors cached before those
   * fields existed are skipped, and an empty index means no beacon support.
   */
  /**
   * Keyed on the door ids rather than the array itself.
   *
   * `doors` arrives as `enrollment?.doors ?? []`, so every parent re-render can
   * hand over a new array with identical contents. Depending on its identity
   * rebuilt this map, which rebuilt `onDevice`, which re-ran the scan effect —
   * and each re-run calls stopDeviceScan then startDeviceScan. Android's own
   * counters showed the cost: 16 start/stop cycles for 2.4 seconds of total
   * listening. A content signature makes the scan survive re-renders.
   */
  const doorSignature = doors
    .map((d) => `${d.building_id}:${d.id}`)
    .sort()
    .join(',');

  const byBeacon = useMemo(() => {
    const index = new Map<string, Door>();
    for (const d of doors) {
      if (typeof d.id === 'number' && typeof d.building_id === 'number') {
        index.set(`${d.building_id}:${d.id}`, d);
      }
    }
    return index;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doorSignature]);

  const onDevice = useCallback(
    (device: Device) => {
      countsRef.current.seen += 1;

      const frame = parseIBeacon(device.manufacturerData);
      if (!frame) return;
      countsRef.current.iBeacons += 1;
      if (frame.uuid !== BEACON_UUID) return;
      countsRef.current.ours += 1;
      if (device.rssi === null) return;

      const door = byBeacon.get(`${frame.major}:${frame.minor}`);
      // A beacon for a door this person has no business at — another building,
      // or one they are not enrolled for. Ignore it rather than showing a door
      // the backend would refuse anyway.
      if (!door) return;

      sawBeaconRef.current = true;
      const now = Date.now();
      const previous = trackedRef.current.get(door.door_code);

      // Collect raw readings here and smooth in the tick below, so the median
      // is over a fixed span of time rather than a fixed count of packets —
      // advertisements do not arrive at a steady rate.
      const samples = previous?.samples ?? [];
      samples.push({ t: now, rssi: device.rssi });

      const rssi = medianRssi(samples, now) ?? device.rssi;
      trackedRef.current.set(door.door_code, {
        samples,
        rssi,
        lastSeen: now,
        withinGate: isWithinGate(rssi, previous?.withinGate ?? false),
        level: previous?.level ?? rssiToLevel(rssi),
        pendingLevel: previous?.pendingLevel ?? rssiToLevel(rssi),
        pendingTicks: previous?.pendingTicks ?? 0,
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
      //
      // scanMode is the setting that actually decides whether this works.
      // `allowDuplicates` is iOS-only, so Android was falling back to
      // SCAN_MODE_LOW_POWER — roughly 500ms of listening every 5 seconds.
      // Against a beacon that alternates 1s on / 1s off, that misses far more
      // often than it hits: dumpsys showed 16 scans totalling 2.4 seconds of
      // airtime and never once seeing the door. LowLatency scans continuously,
      // which is right for a screen the user is actively standing in front of.
      manager.startDeviceScan(null, { scanMode: ScanMode.LowLatency }, (error, device) => {
        if (error) {
          // Report what actually happened. This used to set 'bluetooth-off' for
          // every error, so a permission or OEM-restriction failure was
          // indistinguishable from a switched-off radio — and the real message
          // was thrown away.
          const text = [error.reason, error.message, error.errorCode]
            .filter(Boolean)
            .join(' · ');
          if (!cancelled) {
            countsRef.current = { ...countsRef.current };
            setDiagnostics((d) => ({ ...d, lastError: text || 'unknown scan error' }));
            setStatus('scan-error');
          }
          return;
        }
        if (device) onDevice(device);
      });
      if (!cancelled) setStatus('scanning');

      giveUp = setTimeout(() => {
        // Only downgrade a still-healthy scan. Overwriting an error here is
        // what hid the underlying failure behind "no door beacons found".
        if (!cancelled && !sawBeaconRef.current) {
          setStatus((prev) => (prev === 'scanning' ? 'no-beacons' : prev));
        }
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

        // Commit a level change only once it has held for a couple of ticks.
        // The median stops the ring chasing spikes; this stops it toggling
        // between two adjacent counts when the signal sits on a boundary.
        const candidate = rssiToLevel(t.rssi);
        if (candidate === t.level) {
          t.pendingTicks = 0;
          t.pendingLevel = candidate;
        } else if (candidate === t.pendingLevel) {
          t.pendingTicks += 1;
          if (t.pendingTicks >= LEVEL_CONFIRM_TICKS) {
            t.level = candidate;
            t.pendingTicks = 0;
          }
        } else {
          t.pendingLevel = candidate;
          t.pendingTicks = 1;
        }

        rows.push({ door, rssi: t.rssi, level: t.level, withinGate: t.withinGate });
      }

      rows.sort((a, b) => b.rssi - a.rssi);
      setNearby(rows);

      // Report the closest door on every bucket change, plus a keepalive while
      // one stays in range.
      //
      // Change-only reporting is what keeps this from posting a hundred times a
      // second — the scan fires ~10x a second and the ring has eight steps. But
      // change-only alone leaves the ring dark exactly when somebody is
      // standing still in front of the door: no bucket change means no report,
      // and the door clears its ring after a few seconds of silence. The
      // keepalive costs one small request every couple of seconds while a door
      // is in range, and nothing at all when none is.
      const closest = rows[0];
      const key = closest ? `${closest.door.door_code}:${closest.level}` : null;
      const stale = now - lastReportAtRef.current > PROXIMITY_KEEPALIVE_MS;
      if (closest && (key !== lastReportRef.current || stale)) {
        lastReportRef.current = key;
        lastReportAtRef.current = now;
        void reportProximity(closest.door.door_code, closest.level, closest.rssi);
      } else if (!closest) {
        lastReportRef.current = null;
      }
    }, TICK_MS);

    return () => clearInterval(tick);
  }, [enabled, doors]);

  // Publish the counters once a second — often enough to watch them move while
  // debugging, rare enough not to re-render on every advertisement.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      setDiagnostics((d) => ({ ...d, ...countsRef.current }));
    }, 1000);
    return () => clearInterval(id);
  }, [enabled]);

  const nearest = nearby.find((d) => d.withinGate) ?? null;

  return {
    status,
    diagnostics,
    /** Every door currently in range, closest first. */
    nearby,
    /** The door close enough to offer, or null. */
    nearest,
    /** False when BLE cannot run at all — the screen falls back to the picker. */
    supported: status === 'scanning',
    levels: LED_LEVELS,
  };
}
