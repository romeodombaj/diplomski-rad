import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';
import { deviceRoot } from './device.service';

/**
 * Devices — the hardware at a door, as distinct from the door itself.
 *
 * The cases that matter are the boundaries: a device belongs to one building
 * and may only be attached to a door in that same building, and deleting a door
 * must not destroy the record of hardware that still physically exists.
 */
describe('Devices', () => {
  let buildingId: number;
  let otherBuildingId: number;
  let cookie: string;
  let doorId: number;
  let otherDoorId: number;
  let secondDoorId: number;

  const post = (body: Record<string, unknown>) =>
    request(app).post('/api/devices').set('Cookie', cookie).send(body);

  beforeAll(async () => {
    await db.migrate.latest();
    const userId = randomUUID();
    [buildingId] = await db('buildings').insert({
      name: 'HQ', address: 'A', contract_address: '0xdev', is_sandbox: false,
    });
    [otherBuildingId] = await db('buildings').insert({
      name: 'Annex', address: 'B', contract_address: '0xdev2', is_sandbox: false,
    });
    await db('users').insert({
      id: userId, email: 'dev@test.com', name: 'Op', role: 'admin', password_hash: 'x',
    });
    cookie = `access_token=${jwt.sign(
      { userId, email: 'dev@test.com', role: 'admin', buildingId, isSandbox: false },
      config.jwt.accessSecret, { expiresIn: '1h' },
    )}`;
  });

  afterAll(async () => { await db.destroy(); });

  beforeEach(async () => {
    await db('devices').del();
    await db('doors').del();
    [doorId] = await db('doors').insert({
      building_id: buildingId, name: 'Front', door_code: `F-${randomUUID().slice(0, 5)}`,
      mqtt_topic: 'doors/front/cmd', active: true,
    });
    [otherDoorId] = await db('doors').insert({
      building_id: otherBuildingId, name: 'Annex', door_code: `A-${randomUUID().slice(0, 5)}`,
      mqtt_topic: 'doors/annex/cmd', active: true,
    });
    // A second door in the SAME building — the lock-exclusivity tests need one,
    // and otherDoorId is deliberately in another building.
    [secondDoorId] = await db('doors').insert({
      building_id: buildingId, name: 'Side', door_code: `S-${randomUUID().slice(0, 5)}`,
      mqtt_topic: 'doors/side/cmd', active: true,
    });
  });

  it('creates a device and reports the door it is attached to', async () => {
    const res = await post({
      name: 'Front ring', kind: 'proximity', address: 'doors/front/cmd', door_id: doorId,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Front ring', kind: 'proximity', door_id: doorId, door_name: 'Front',
    });
  });

  it('accepts a device with no door yet', async () => {
    const res = await post({ name: 'Spare sensor', kind: 'proximity' });
    expect(res.status).toBe(201);
    expect(res.body.data.door_id).toBeNull();
  });

  it('refuses a door in another building', async () => {
    // Otherwise an operator could attach hardware to somebody else's door and
    // read that door's name back out of the list join.
    const res = await post({ name: 'Sneaky', kind: 'lock', door_id: otherDoorId });
    expect(res.status).toBe(404);
  });

  it('rejects an unknown kind', async () => {
    const res = await post({ name: 'Thing', kind: 'teleporter' });
    expect(res.status).toBe(400);
  });

  it('lists only this building\'s devices', async () => {
    await post({ name: 'Mine', kind: 'proximity' });
    await db('devices').insert({ building_id: otherBuildingId, name: 'Theirs', kind: 'proximity' });
    const res = await request(app).get('/api/devices').set('Cookie', cookie);
    expect(res.body.data.map((d: any) => d.name)).toEqual(['Mine']);
  });

  it('filters to unassigned hardware', async () => {
    await post({ name: 'Attached', kind: 'lock', door_id: doorId });
    await post({ name: 'In a drawer', kind: 'lock' });
    const res = await request(app).get('/api/devices?door_id=none').set('Cookie', cookie);
    expect(res.body.data.map((d: any) => d.name)).toEqual(['In a drawer']);
  });

  it('attaches an existing device to a door', async () => {
    const made = await post({ name: 'Plug', kind: 'lock' });
    const res = await request(app)
      .patch(`/api/devices/${made.body.data.id}`)
      .set('Cookie', cookie)
      .send({ door_id: doorId });
    expect(res.status).toBe(200);
    expect(res.body.data.door_id).toBe(doorId);
  });

  it('lists the devices attached to a door', async () => {
    // One of each kind — which is all a door can hold.
    await post({ name: 'Sensor', kind: 'proximity', door_id: doorId });
    await post({ name: 'Plug', kind: 'lock', door_id: doorId });
    await post({ name: 'Elsewhere', kind: 'lock' });
    const res = await request(app).get(`/api/doors/${doorId}/devices`).set('Cookie', cookie);
    expect(res.body.data.map((d: any) => d.name).sort()).toEqual(['Plug', 'Sensor']);
  });

  it('keeps the device when its door is deleted', async () => {
    // The hardware still exists on a wall somewhere and can be reassigned;
    // deleting the policy object must not erase the inventory record.
    const made = await post({ name: 'Ring', kind: 'proximity', door_id: doorId });
    await request(app).delete(`/api/doors/${doorId}`).set('Cookie', cookie);
    const after = await db('devices').where({ id: made.body.data.id }).first();
    expect(after).toBeTruthy();
    expect(after.name).toBe('Ring');
  });

  it('soft-deletes and detaches', async () => {
    const made = await post({ name: 'Old plug', kind: 'lock', door_id: doorId });
    const res = await request(app)
      .delete(`/api/devices/${made.body.data.id}`).set('Cookie', cookie);
    expect(res.status).toBe(204);
    const row = await db('devices').where({ id: made.body.data.id }).first();
    expect(row.deleted_at).toBeTruthy();
    // Detached too, so a deleted device does not keep occupying a door slot.
    expect(row.door_id).toBeNull();
    const list = await request(app).get('/api/devices').set('Cookie', cookie);
    expect(list.body.data).toHaveLength(0);
  });

    it('requires authentication', async () => {
    expect((await request(app).get('/api/devices')).status).toBe(401);
  });

  /**
   * One lock per door.
   *
   * Two relays wired to one door is not a configuration but a mistake: the
   * access path has to pick one, and picking silently means an unlock that
   * opens whichever row sorted first.
   */
  describe('lock exclusivity', () => {
    it('refuses a second lock on the same door', async () => {
      await post({ name: 'Plug A', kind: 'lock', door_id: doorId, lock_profile: 'tasmota' });
      const second = await post({ name: 'Plug B', kind: 'lock', door_id: doorId });
      expect(second.status).toBe(409);
      // The message names the lock already there — the operator's next question.
      expect(second.body.message).toContain('Plug A');
    });

    it('allows a second lock on a different door', async () => {
      await post({ name: 'Plug A', kind: 'lock', door_id: doorId });
      const other = await post({ name: 'Plug B', kind: 'lock', door_id: secondDoorId });
      expect(other.status).toBe(201);
    });

    it('allows one of each kind on the same door', async () => {
      await post({ name: 'Plug A', kind: 'lock', door_id: doorId });
      expect((await post({ name: 'Sensor', kind: 'proximity', door_id: doorId })).status).toBe(201);
    });

    it('refuses a second proximity device on the same door', async () => {
      // A door senses you once. Two sensors means the code picks one silently,
      // and the ring then reports whichever row sorted first.
      await post({ name: 'Sensor A', kind: 'proximity', door_id: doorId });
      const second = await post({ name: 'Sensor B', kind: 'proximity', door_id: doorId });
      expect(second.status).toBe(409);
      expect(second.body.message).toContain('Sensor A');
    });

    it('refuses moving a second lock onto an occupied door', async () => {
      await post({ name: 'Plug A', kind: 'lock', door_id: doorId });
      const spare = await post({ name: 'Spare', kind: 'lock', door_id: null });
      const res = await request(app)
        .patch(`/api/devices/${spare.body.data.id}`)
        .set('Cookie', cookie)
        .send({ door_id: doorId });
      expect(res.status).toBe(409);
    });

    it('frees the slot when the lock is deleted', async () => {
      const first = await post({ name: 'Plug A', kind: 'lock', door_id: doorId });
      await request(app).delete(`/api/devices/${first.body.data.id}`).set('Cookie', cookie);
      expect((await post({ name: 'Plug B', kind: 'lock', door_id: doorId })).status).toBe(201);
    });

    it('stores the actuation fields', async () => {
      const made = await post({
        name: 'Front plug', kind: 'lock', door_id: doorId, address: 'plug-front',
        lock_profile: 'tasmota', hold_seconds: 4,
      });
      expect(made.status).toBe(201);
      expect(made.body.data.lock_profile).toBe('tasmota');
      expect(made.body.data.hold_seconds).toBe(4);
    });
  });
});

/**
 * Topic grouping for the MQTT scan.
 *
 * A single ESPHome node publishes a discovery topic, a debug topic and one
 * topic per entity. Before grouping, one ReSpeaker ring showed up as five
 * separate rows in the scan dialog, each inviting the operator to register it.
 */
describe('deviceRoot', () => {
  it('folds an ESPHome node\'s topics onto one device', () => {
    const topics = [
      'respeaker-door-ring/debug',
      'esphome/discover/respeaker-door-ring',
      'respeaker-door-ring/number/ring_brightness/state',
      'respeaker-door-ring/sensor/firmware_version/state',
      'respeaker-door-ring/sensor/free_heap/state',
      'respeaker-door-ring/status',
    ];
    const roots = new Set(topics.map(deviceRoot));
    expect([...roots]).toEqual(['respeaker-door-ring']);
  });

  it('keeps unrelated door topics apart', () => {
    // The important negative case: grouping by first segment would merge every
    // door in the building into a single "doors" device.
    expect(deviceRoot('doors/front-01/cmd')).toBe('doors/front-01/cmd');
    expect(deviceRoot('doors/side-02/cmd')).toBe('doors/side-02/cmd');
    expect(deviceRoot('doors/front-01/cmd/proximity')).toBe('doors/front-01/cmd/proximity');
  });

  it('leaves an unrecognised topic as its own device', () => {
    expect(deviceRoot('some/random/thing')).toBe('some/random/thing');
    expect(deviceRoot('flat')).toBe('flat');
  });
});
