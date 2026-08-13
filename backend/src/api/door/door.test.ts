import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';

describe('Door API', () => {
  let tenantId: string;
  let projectId: string;
  let userId: string;
  let authCookie: string;

  beforeAll(async () => {
    await db.migrate.latest();
    tenantId = randomUUID();
    projectId = randomUUID();
    userId = randomUUID();
    await db('tenants').insert({ id: tenantId, name: 'Test Tenant' });
    await db('projects').insert({ id: projectId, tenant_id: tenantId, name: 'Test Project', is_sandbox: false });
    await db('users').insert({ id: userId, tenant_id: tenantId, email: 'test@test.com', name: 'Test', role: 'admin', password_hash: 'x' });

    const token = jwt.sign(
      { userId, email: 'test@test.com', role: 'admin', tenantId, projectId },
      config.jwt.accessSecret,
      { expiresIn: '1h' }
    );
    authCookie = `access_token=${token}`;
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db('doors').truncate();
  });

  it('GET /doors returns empty array', async () => {
    const res = await request(app)
      .get('/api/doors')
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId));
    expect(res.status).toBe(200);
    expect(res.body.data.data).toEqual([]);
  });

  it('POST /doors creates a door', async () => {
    const res = await request(app)
      .post('/api/doors')
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId))
      .send({
      building_id: 1,
      name: 'test_name',
      door_code: 'test_door_code',
      mqtt_topic: 'test_mqtt_topic',
      active: true
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
  });

  it('GET /doors/:id returns a door', async () => {
    const created = await request(app)
      .post('/api/doors')
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId))
      .send({
      building_id: 1,
      name: 'test_name',
      door_code: 'test_door_code',
      mqtt_topic: 'test_mqtt_topic',
      active: true
      });
    const res = await request(app)
      .get(`/api/doors/${created.body.data.id}`)
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId));
    expect(res.status).toBe(200);
  });

  it('PATCH /doors/:id updates a door', async () => {
    const created = await request(app)
      .post('/api/doors')
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId))
      .send({
      building_id: 1,
      name: 'test_name',
      door_code: 'test_door_code',
      mqtt_topic: 'test_mqtt_topic',
      active: true
      });
    const res = await request(app)
      .patch(`/api/doors/${created.body.data.id}`)
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId))
      .send({
      building_id: 1,
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
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId))
      .send({
      building_id: 1,
      name: 'test_name',
      door_code: 'test_door_code',
      mqtt_topic: 'test_mqtt_topic',
      active: true
      });
    const id = created.body.data.id;
    const res = await request(app)
      .delete(`/api/doors/${id}`)
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId));
    expect(res.status).toBe(200);
    const gone = await request(app)
      .get(`/api/doors/${id}`)
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId));
    expect(gone.status).toBe(404);
  });
})
