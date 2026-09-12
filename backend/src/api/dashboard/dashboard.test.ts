import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';

describe('Dashboard overview', () => {
  let buildingId: number;
  let otherBuildingId: number;
  let userId: string;
  let cookie: string;
  let doorId: number;
  let personId: string;

  const at = (hour: number, dayOffset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 30, 0, 0);
    return d.toISOString();
  };

  const event = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    building_id: buildingId,
    door_id: doorId,
    door_code: 'FRONT-01',
    person_id: personId,
    did: 'did:ethr:sep:0xabc',
    decision: 'granted',
    reason: 'ok',
    signature_verified: true,
    chain_checked: false,
    event_hash: `0x${randomUUID().replace(/-/g, '')}`,
    signature: randomUUID(),
    occurred_at: at(9),
    ...over,
  });

  beforeAll(async () => {
    await db.migrate.latest();
    userId = randomUUID();
    [buildingId] = await db('buildings').insert({ name: 'DB Test', address: 'a', contract_address: 'x', is_sandbox: false });
    [otherBuildingId] = await db('buildings').insert({ name: 'DB Other', address: 'b', contract_address: 'x', is_sandbox: false });
    await db('users').insert({ id: userId, email: 'dash@test.com', name: 'Dash', role: 'admin', password_hash: 'x' });
    cookie = `access_token=${jwt.sign(
      { userId, email: 'dash@test.com', role: 'admin', buildingId, isSandbox: false },
      config.jwt.accessSecret, { expiresIn: '1h' },
    )}`;
  });

  afterAll(async () => { await db.destroy(); });

  beforeEach(async () => {
    await db('access_events').del();
    await db('devices').del();
    await db('people').del();
    await db('doors').del();

    [doorId] = await db('doors').insert({
      building_id: buildingId, name: 'Front', door_code: 'FRONT-01',
      mqtt_topic: 'doors/front-01/cmd', active: true,
    });
    personId = randomUUID();
    await db('people').insert({
      id: personId, building_id: buildingId, full_name: 'Ana Anić',
      person_type: 'employee', status: 'active',
    });
  });

  const get = () => request(app).get('/api/dashboard/overview').set('Cookie', cookie);

  it('counts today and ignores yesterday', async () => {
    await db('access_events').insert([
      event(),
      event({ occurred_at: at(9, -1) }),
      event({ occurred_at: at(11) }),
    ]);

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.totals.granted_today).toBe(2);
    expect(res.body.data.doors[0].opens_today).toBe(2);
  });

  it('buckets by hour and separates granted from denied', async () => {
    await db('access_events').insert([
      event({ occurred_at: at(9) }),
      event({ occurred_at: at(9) }),
      event({ occurred_at: at(14), decision: 'denied', reason: 'invalid_totp' }),
    ]);

    const { activity, totals } = (await get()).body.data;
    expect(activity).toHaveLength(24);
    expect(activity[9]).toEqual({ hour: 9, granted: 2, denied: 0 });
    expect(activity[14]).toEqual({ hour: 14, granted: 0, denied: 1 });
    expect(totals.denied_today).toBe(1);
  });

  it('lists who came in, with their most recent door', async () => {
    await db('access_events').insert([
      event({ occurred_at: at(8) }),
      event({ occurred_at: at(16), door_code: 'FRONT-01' }),
    ]);

    const { openers } = (await get()).body.data;
    expect(openers).toHaveLength(1);
    expect(openers[0]).toMatchObject({ full_name: 'Ana Anić', opens: 2, last_door: 'FRONT-01' });
  });

  it('keeps an admin override as its own row rather than an unnamed person', async () => {
    await db('access_events').insert([
      event(),
      event({ person_id: null, did: `admin:${userId}`, reason: 'admin_unlock', occurred_at: at(10) }),
    ]);

    const { openers } = (await get()).body.data;
    expect(openers).toHaveLength(2);
    expect(openers.some((o: any) => o.full_name === 'Dashboard override')).toBe(true);
  });

  it('reports the lock mounted at a door', async () => {
    await db('devices').insert({
      building_id: buildingId, name: 'Front plug', kind: 'lock',
      address: 'plug-front', door_id: doorId, active: true, lock_profile: 'tasmota',
    });

    const { doors, totals } = (await get()).body.data;
    expect(doors[0].lock).toMatchObject({ name: 'Front plug', profile: 'tasmota', address: 'plug-front' });
    expect(totals.locks_configured).toBe(1);
  });

  it('reports a door with no lock rather than inventing one', async () => {
    const { doors, totals } = (await get()).body.data;
    expect(doors[0].lock).toBeNull();
    expect(totals.locks_configured).toBe(0);
  });

  it('does not count another building', async () => {
    const [foreignDoor] = await db('doors').insert({
      building_id: otherBuildingId, name: 'Annex', door_code: 'ANX-01',
      mqtt_topic: 'doors/anx/cmd', active: true,
    });
    await db('access_events').insert(
      event({ building_id: otherBuildingId, door_id: foreignDoor, door_code: 'ANX-01', person_id: null }),
    );

    const { totals, doors } = (await get()).body.data;
    expect(totals.granted_today).toBe(0);
    expect(doors).toHaveLength(1);
    expect(doors[0].door_code).toBe('FRONT-01');
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/dashboard/overview')).status).toBe(401);
  });
});
