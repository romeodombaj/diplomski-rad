import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';

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
  });

  it('creates a device and reports the door it is attached to', async () => {
    const res = await post({
      name: 'Front ring', kind: 'indicator', address: 'doors/front/cmd', door_id: doorId,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Front ring', kind: 'indicator', door_id: doorId, door_name: 'Front',
    });
  });

  it('accepts a device with no door yet', async () => {
    const res = await post({ name: 'Spare beacon', kind: 'beacon' });
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
    await post({ name: 'Mine', kind: 'beacon' });
    await db('devices').insert({ building_id: otherBuildingId, name: 'Theirs', kind: 'beacon' });
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
    await post({ name: 'Ring', kind: 'indicator', door_id: doorId });
    await post({ name: 'Beacon', kind: 'beacon', door_id: doorId });
    await post({ name: 'Elsewhere', kind: 'lock' });
    const res = await request(app).get(`/api/doors/${doorId}/devices`).set('Cookie', cookie);
    expect(res.body.data.map((d: any) => d.name).sort()).toEqual(['Beacon', 'Ring']);
  });

  it('keeps the device when its door is deleted', async () => {
    // The hardware still exists on a wall somewhere and can be reassigned;
    // deleting the policy object must not erase the inventory record.
    const made = await post({ name: 'Ring', kind: 'indicator', door_id: doorId });
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
});
