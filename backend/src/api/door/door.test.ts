import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';

describe('Door API', () => {
  let buildingId: number;
  let userId: string;
  let authCookie: string;

  beforeAll(async () => {
    await db.migrate.latest();
    userId = randomUUID();
    [buildingId] = await db('buildings').insert({ name: 'Test Building', address: 'Test Address', contract_address: 'Test Contract', is_sandbox: false });
    await db('users').insert({ id: userId, email: 'test@test.com', name: 'Test', role: 'admin', password_hash: 'x' });

    const token = jwt.sign(
      { userId, email: 'test@test.com', role: 'admin', buildingId, isSandbox: false },
      config.jwt.accessSecret,
      { expiresIn: '1h' }
    );
    authCookie = `access_token=${token}`;
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db('access_events').del();
    await db('doors').truncate();
  });

  it('GET /doors returns empty array', async () => {
    const res = await request(app)
      .get('/api/doors')
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.data).toEqual([]);
  });

  it('POST /doors creates a door', async () => {
    const res = await request(app)
      .post('/api/doors')
      .set('Cookie', authCookie)
      .send({
      name: 'test_name',
      door_code: 'test_door_code',
      mqtt_topic: 'test_mqtt_topic',
      active: true
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.building_id).toBe(buildingId);
  });

  it('GET /doors/:id returns a door', async () => {
    const created = await request(app)
      .post('/api/doors')
      .set('Cookie', authCookie)
      .send({
      name: 'test_name',
      door_code: 'test_door_code',
      mqtt_topic: 'test_mqtt_topic',
      active: true
      });
    const res = await request(app)
      .get(`/api/doors/${created.body.data.id}`)
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
  });

  it('PATCH /doors/:id updates a door', async () => {
    const created = await request(app)
      .post('/api/doors')
      .set('Cookie', authCookie)
      .send({
      name: 'test_name',
      door_code: 'test_door_code',
      mqtt_topic: 'test_mqtt_topic',
      active: true
      });
    const res = await request(app)
      .patch(`/api/doors/${created.body.data.id}`)
      .set('Cookie', authCookie)
      .send({
      name: 'test_name',
      door_code: 'test_door_code',
      mqtt_topic: 'test_mqtt_topic',
      active: true
      });
    expect(res.status).toBe(200);
  });

  it('DELETE /doors/:id soft-deletes a door', async () => {
    const created = await request(app)
      .post('/api/doors')
      .set('Cookie', authCookie)
      .send({
      name: 'test_name',
      door_code: 'test_door_code',
      mqtt_topic: 'test_mqtt_topic',
      active: true
      });
    const id = created.body.data.id;
    const res = await request(app)
      .delete(`/api/doors/${id}`)
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
    const gone = await request(app)
      .get(`/api/doors/${id}`)
      .set('Cookie', authCookie);
    expect(gone.status).toBe(404);
  });
  describe('POST /doors/:id/unlock', () => {
    const makeDoor = (over: Record<string, unknown> = {}) =>
      request(app).post('/api/doors').set('Cookie', authCookie).send({
        name: 'Front', door_code: 'FRONT-01', mqtt_topic: 'doors/front-01/cmd', active: true, ...over,
      });

    it('records a granted admin_unlock event', async () => {
      const created = await makeDoor();
      const id = created.body.data.id;

      const res = await request(app)
        .post(`/api/doors/${id}/unlock`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.event_id).toBeDefined();
      expect(res.body.data.door.code).toBe('FRONT-01');

      const event = await db('access_events').where({ id: res.body.data.event_id }).first();
      expect(event.decision).toBe('granted');
      expect(event.reason).toBe('admin_unlock');
      expect(event.door_id).toBe(id);
      expect(event.did).toBe(`admin:${userId}`);
      expect(Boolean(event.signature_verified)).toBe(false);
      expect(event.signature).toBeNull();
      expect(event.event_hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('reports the broker being unreachable without failing the request', async () => {
      const created = await makeDoor({ door_code: 'FRONT-02' });
      const res = await request(app)
        .post(`/api/doors/${created.body.data.id}/unlock`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.unlocked).toBe(false);
    });

    it('refuses a door that is out of service', async () => {
      const created = await makeDoor({ door_code: 'FRONT-03', active: false });
      const res = await request(app)
        .post(`/api/doors/${created.body.data.id}/unlock`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(409);
      expect(await db('access_events').count('* as c').first()).toMatchObject({ c: 0 });
    });

    it('404s for a door in another building', async () => {
      const [otherBuilding] = await db('buildings').insert({
        name: 'Other', address: 'x', contract_address: 'x', is_sandbox: false,
      });
      const [foreignId] = await db('doors').insert({
        building_id: otherBuilding, name: 'Annex', door_code: 'ANX-01',
        mqtt_topic: 'doors/anx/cmd', active: true,
      });
      const res = await request(app)
        .post(`/api/doors/${foreignId}/unlock`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });

    it('requires authentication', async () => {
      const created = await makeDoor({ door_code: 'FRONT-04' });
      const res = await request(app).post(`/api/doors/${created.body.data.id}/unlock`);
      expect(res.status).toBe(401);
    });
  });
})
