import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';

/**
 * Lockdown, enforced where it has to be.
 *
 * The point of these cases is that a lockdown is refused on the access path and
 * not merely hidden in the UI — the phone signs its own request and a modified
 * client can send one whatever a screen shows. They also pin the two states
 * apart: an emergency must not silently release a door somebody locked by hand.
 */
describe('Lockdown', () => {
  let buildingId: number;
  let cookie: string;
  let doorId: number;
  let otherDoorId: number;

  const state = () => request(app).get('/api/lockdown').set('Cookie', cookie);

  beforeAll(async () => {
    await db.migrate.latest();
    const userId = randomUUID();
    [buildingId] = await db('buildings').insert({
      name: 'HQ', address: 'A', contract_address: '0xlock', is_sandbox: false,
    });
    await db('users').insert({
      id: userId, email: 'lock@test.com', name: 'Op', role: 'admin', password_hash: 'x',
    });
    cookie = `access_token=${jwt.sign(
      { userId, email: 'lock@test.com', role: 'admin', buildingId, isSandbox: false },
      config.jwt.accessSecret, { expiresIn: '1h' },
    )}`;
  });

  afterAll(async () => { await db.destroy(); });

  beforeEach(async () => {
    await db('doors').where({ building_id: buildingId }).del();
    await db('buildings').where({ id: buildingId }).update({ lockdown_at: null, lockdown_by: null });
    [doorId] = await db('doors').insert({
      building_id: buildingId, name: 'Front', door_code: `F-${randomUUID().slice(0, 5)}`,
      mqtt_topic: 'd/front', active: true,
    });
    [otherDoorId] = await db('doors').insert({
      building_id: buildingId, name: 'Side', door_code: `S-${randomUUID().slice(0, 5)}`,
      mqtt_topic: 'd/side', active: true,
    });
  });

  it('starts with nothing locked down', async () => {
    const res = await state();
    expect(res.body.data.building.active).toBe(false);
    expect(res.body.data.doors.every((d: any) => !d.locked_down)).toBe(true);
  });

  it('locks and releases a single door', async () => {
    await request(app).post(`/api/lockdown/doors/${doorId}`)
      .set('Cookie', cookie).send({ locked_down: true }).expect(200);

    let doors = (await state()).body.data.doors;
    expect(doors.find((d: any) => d.id === doorId).locked_down).toBe(true);
    expect(doors.find((d: any) => d.id === doorId).since).toBeTruthy();
    // Its neighbour is untouched.
    expect(doors.find((d: any) => d.id === otherDoorId).locked_down).toBe(false);

    await request(app).post(`/api/lockdown/doors/${doorId}`)
      .set('Cookie', cookie).send({ locked_down: false }).expect(200);
    doors = (await state()).body.data.doors;
    expect(doors.find((d: any) => d.id === doorId).locked_down).toBe(false);
  });

  it('engages and lifts a building-wide emergency, recording who and when', async () => {
    const on = await request(app).post('/api/lockdown/building')
      .set('Cookie', cookie).send({ active: true }).expect(200);
    expect(on.body.data.building.active).toBe(true);
    expect(on.body.data.building.since).toBeTruthy();
    expect(on.body.data.building.by).toBe('lock@test.com');

    const off = await request(app).post('/api/lockdown/building')
      .set('Cookie', cookie).send({ active: false }).expect(200);
    expect(off.body.data.building.active).toBe(false);
    expect(off.body.data.building.since).toBeNull();
  });

  it('lifting the emergency does not release a door locked by hand', async () => {
    // The whole reason the emergency only writes the building flag: sweeping
    // every door would quietly unlock one an operator had shut deliberately.
    await request(app).post(`/api/lockdown/doors/${doorId}`)
      .set('Cookie', cookie).send({ locked_down: true });
    await request(app).post('/api/lockdown/building').set('Cookie', cookie).send({ active: true });
    await request(app).post('/api/lockdown/building').set('Cookie', cookie).send({ active: false });

    const doors = (await state()).body.data.doors;
    expect(doors.find((d: any) => d.id === doorId).locked_down).toBe(true);
  });

  it('refuses a door in another building', async () => {
    const [otherBuilding] = await db('buildings').insert({
      name: 'Annex', address: 'B', contract_address: '0xother', is_sandbox: false,
    });
    const [foreignDoor] = await db('doors').insert({
      building_id: otherBuilding, name: 'Theirs', door_code: `X-${randomUUID().slice(0, 5)}`,
      mqtt_topic: 'd/x', active: true,
    });
    await request(app).post(`/api/lockdown/doors/${foreignDoor}`)
      .set('Cookie', cookie).send({ locked_down: true }).expect(404);
  });

  it('requires authentication', async () => {
    await request(app).get('/api/lockdown').expect(401);
    await request(app).post('/api/lockdown/building').send({ active: true }).expect(401);
  });
});
