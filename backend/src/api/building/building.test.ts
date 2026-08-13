import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';

describe('Building API', () => {
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
    await db('buildings').truncate();
  });

  it('GET /buildings returns empty array', async () => {
    const res = await request(app)
      .get('/api/buildings')
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId));
    expect(res.status).toBe(200);
    expect(res.body.data.data).toEqual([]);
  });

  it('POST /buildings creates a building', async () => {
    const res = await request(app)
      .post('/api/buildings')
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId))
      .send({
      name: 'test_name',
      address: 'test_address',
      contract_address: 'test_contract_address'
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
  });

  it('GET /buildings/:id returns a building', async () => {
    const created = await request(app)
      .post('/api/buildings')
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId))
      .send({
      name: 'test_name',
      address: 'test_address',
      contract_address: 'test_contract_address'
      });
    const res = await request(app)
      .get(`/api/buildings/${created.body.data.id}`)
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId));
    expect(res.status).toBe(200);
  });

  it('PATCH /buildings/:id updates a building', async () => {
    const created = await request(app)
      .post('/api/buildings')
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId))
      .send({
      name: 'test_name',
      address: 'test_address',
      contract_address: 'test_contract_address'
      });
    const res = await request(app)
      .patch(`/api/buildings/${created.body.data.id}`)
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId))
      .send({
      name: 'test_name',
      address: 'test_address',
      contract_address: 'test_contract_address'
      });
    expect(res.status).toBe(200);
  });

  it('DELETE /buildings/:id soft-deletes a building', async () => {
    const created = await request(app)
      .post('/api/buildings')
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId))
      .send({
      name: 'test_name',
      address: 'test_address',
      contract_address: 'test_contract_address'
      });
    const id = created.body.data.id;
    const res = await request(app)
      .delete(`/api/buildings/${id}`)
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId));
    expect(res.status).toBe(200);
    const gone = await request(app)
      .get(`/api/buildings/${id}`)
      .set('Cookie', authCookie)
      .set('X-Tenant-ID', String(tenantId))
      .set('X-Project-ID', String(projectId));
    expect(gone.status).toBe(404);
  });
})
