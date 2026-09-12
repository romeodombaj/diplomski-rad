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

const TICK_MS = 250;

const PROXIMITY_KEEPALIVE_MS = 2000;

const NO_BEACON_FALLBACK_MS = 12000;

export interface NearbyDoor {
  door: Door;
  rssi: number;
  level: number;
  withinGate: boolean;
}

export type ProximityStatus =
  | 'scanning'
  | 'bluetooth-off'
  | 'permission-denied'
  | 'scan-error'
  | 'no-beacons'
  | 'unsupported';

export interface ProximityDiagnostics {
  seen: number;
  iBeacons: number;
  ours: number;
  lastError: string | null;
}

interface Tracked {
  samples: RssiSample[];
  rssi: number;
  lastSeen: number;
  withinGate: boolean;
  level: number;
  pendingLevel: number;
  pendingTicks: number;
}

async function requestScanPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const api = Number(Platform.Version);
  const wanted =
    api >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const granted = await PermissionsAndroid.requestMultiple(wanted);
  const required = api >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
       PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  return required.every((p) => granted[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export function useDoorProximity(doors: Door[], enabled: boolean) {
  const [status, setStatus] = useState<ProximityStatus>('scanning');
  const [nearby, setNearby] = useState<NearbyDoor[]>([]);

  const managerRef = useRef<BleManager | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProximityDiagnostics>({
    seen: 0, iBeacons: 0, ours: 0, lastError: null,
  });
  const countsRef = useRef({ seen: 0, iBeacons: 0, ours: 0 });
  const trackedRef = useRef<Map<string, Tracked>>(new Map());
  const sawBeaconRef = useRef(false);
  const lastReportRef = useRef<string | null>(null);
  const lastReportAtRef = useRef(0);

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
      if (!door) return;

      sawBeaconRef.current = true;
      const now = Date.now();
      const previous = trackedRef.current.get(door.door_code);

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

      manager.startDeviceScan(null, { scanMode: ScanMode.LowLatency }, (error, device) => {
        if (error) {
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
        if (!cancelled && !sawBeaconRef.current) {
          setStatus((prev) => (prev === 'scanning' ? 'no-beacons' : prev));
        }
      }, NO_BEACON_FALLBACK_MS);
    };

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

  useEffect(() => () => { managerRef.current?.destroy(); managerRef.current = null; }, []);

  useEffect(() => {
    if (!enabled) return;

    const tick = setInterval(() => {
      const now = Date.now();
      const rows: NearbyDoor[] = [];

      for (const [doorCode, t] of trackedRef.current) {
        if (now - t.lastSeen > BEACON_TTL_MS) {
          trackedRef.current.delete(doorCode);
          continue;
        }
        const door = doors.find((d) => d.door_code === doorCode);
        if (!door) continue;

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
    nearby,
    nearest,
    supported: status === 'scanning',
    levels: LED_LEVELS,
  };
}
