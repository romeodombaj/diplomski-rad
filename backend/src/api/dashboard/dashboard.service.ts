import db from '../../db';
import * as chain from '../../services/chainService';
import * as mqttService from '../../services/mqttService';

export interface DoorCard {
  id: number;
  name: string;
  door_code: string;
  active: boolean;
  mqtt_topic: string;
  opens_today: number;
  denials_today: number;
  last_opened_at: string | null;
  last_opened_by: string | null;
  lock: {
    id: number;
    name: string;
    profile: string;
    address: string | null;
    active: boolean;
  } | null;
  device_count: number;
}

export interface OpenerRow {
  person_id: string | null;
  full_name: string;
  opens: number;
  last_at: string;
  last_door: string;
}

export interface DashboardOverview {
  totals: {
    granted_today: number;
    denied_today: number;
    doors: number;
    doors_inactive: number;
    locks_configured: number;
    people_active: number;
  };
  doors: DoorCard[];
  openers: OpenerRow[];
  activity: { hour: number; granted: number; denied: number }[];
  health: { mqtt: boolean; chain: boolean };
}

function startOfToday(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export const overview = async (buildingId: number): Promise<DashboardOverview> => {
  const since = startOfToday();

  const scope = () =>
    db('access_events')
      .where('access_events.building_id', buildingId)
      .where('access_events.occurred_at', '>=', since);

  const [
    doors,
    devices,
    todayEvents,
    peopleActive,
  ] = await Promise.all([
    db('doors').where({ building_id: buildingId }).whereNull('deleted_at').orderBy('name').select('*'),
    db('devices').where({ building_id: buildingId }).whereNull('deleted_at').select('*'),
    scope()
      .leftJoin('people as p', 'p.id', 'access_events.person_id')
      .select(
        'access_events.door_id',
        'access_events.door_code',
        'access_events.decision',
        'access_events.occurred_at',
        'access_events.person_id',
        'access_events.did',
        'p.full_name as person_name',
      ),
    db('people').where({ building_id: buildingId }).whereNull('deleted_at').where('status', 'active').count('* as c').first(),
  ]);

  type Row = {
    door_id: number | null;
    door_code: string;
    decision: string;
    occurred_at: string;
    person_id: string | null;
    did: string;
    person_name: string | null;
  };
  const rows = todayEvents as Row[];

  const granted = rows.filter((r) => r.decision === 'granted');
  const denied = rows.filter((r) => r.decision !== 'granted');

  const perDoor = new Map<number, { opens: number; denials: number; last: Row | null }>();
  for (const r of rows) {
    if (r.door_id === null) continue;
    const entry = perDoor.get(r.door_id) ?? { opens: 0, denials: 0, last: null };
    if (r.decision === 'granted') {
      entry.opens += 1;
      if (!entry.last || r.occurred_at > entry.last.occurred_at) entry.last = r;
    } else {
      entry.denials += 1;
    }
    perDoor.set(r.door_id, entry);
  }

  const locksByDoor = new Map<number, any>();
  const deviceCountByDoor = new Map<number, number>();
  for (const d of devices as any[]) {
    if (d.door_id === null) continue;
    deviceCountByDoor.set(d.door_id, (deviceCountByDoor.get(d.door_id) ?? 0) + 1);
    if (d.kind === 'lock') locksByDoor.set(d.door_id, d);
  }

  const doorCards: DoorCard[] = (doors as any[]).map((d) => {
    const tally = perDoor.get(d.id);
    const lock = locksByDoor.get(d.id);
    return {
      id: d.id,
      name: d.name,
      door_code: d.door_code,
      active: Boolean(d.active),
      mqtt_topic: d.mqtt_topic,
      opens_today: tally?.opens ?? 0,
      denials_today: tally?.denials ?? 0,
      last_opened_at: tally?.last?.occurred_at ?? null,
      last_opened_by: tally?.last?.person_name ?? null,
      lock: lock
        ? {
            id: lock.id,
            name: lock.name,
            profile: lock.lock_profile ?? 'native_json',
            address: lock.address,
            active: Boolean(lock.active),
          }
        : null,
      device_count: deviceCountByDoor.get(d.id) ?? 0,
    };
  });

  const byPerson = new Map<string, OpenerRow>();
  for (const r of granted) {
    const key = r.person_id ?? r.did;
    const name = r.person_name ?? (r.did.startsWith('admin:') ? 'Dashboard override' : r.did);
    const entry = byPerson.get(key) ?? {
      person_id: r.person_id,
      full_name: name,
      opens: 0,
      last_at: r.occurred_at,
      last_door: r.door_code,
    };
    entry.opens += 1;
    if (r.occurred_at >= entry.last_at) {
      entry.last_at = r.occurred_at;
      entry.last_door = r.door_code;
    }
    byPerson.set(key, entry);
  }

  const activity = Array.from({ length: 24 }, (_, hour) => ({ hour, granted: 0, denied: 0 }));
  for (const r of rows) {
    const h = new Date(r.occurred_at).getHours();
    if (Number.isNaN(h)) continue;
    if (r.decision === 'granted') activity[h].granted += 1;
    else activity[h].denied += 1;
  }

  return {
    totals: {
      granted_today: granted.length,
      denied_today: denied.length,
      doors: doorCards.length,
      doors_inactive: doorCards.filter((d) => !d.active).length,
      locks_configured: doorCards.filter((d) => d.lock !== null).length,
      people_active: Number((peopleActive as any)?.c ?? 0),
    },
    doors: doorCards,
    openers: [...byPerson.values()].sort((a, b) => b.last_at.localeCompare(a.last_at)),
    activity,
    health: { mqtt: mqttService.isConnected(), chain: chain.isEnabled() },
  };
};
