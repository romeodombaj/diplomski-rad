import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';

describe('Totp_secret API', () => {
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
    await db('totp_secrets').truncate();
  });

  it('GET /totp_secrets returns empty array', async () => {
    const res = await request(app)
      .get('/api/totp_secrets')
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.data).toEqual([]);
  });

  it('POST /totp_secrets creates a totp_secret', async () => {
    const res = await request(app)
      .post('/api/totp_secrets')
      .set('Cookie', authCookie)
      .send({
      did: 'test_did',
      secret: 'test_secret',
      period: 1,
      digits: 1
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
  });

  it('GET /totp_secrets/:id returns a totp_secret', async () => {
    const created = await request(app)
      .post('/api/totp_secrets')
      .set('Cookie', authCookie)
      .send({
      did: 'test_did',
      secret: 'test_secret',
      period: 1,
      digits: 1
      });
    const res = await request(app)
      .get(`/api/totp_secrets/${created.body.data.id}`)
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
  });

  it('PATCH /totp_secrets/:id updates a totp_secret', async () => {
    const created = await request(app)
      .post('/api/totp_secrets')
      .set('Cookie', authCookie)
      .send({
      did: 'test_did',
      secret: 'test_secret',
      period: 1,
      digits: 1
      });
    const res = await request(app)
      .patch(`/api/totp_secrets/${created.body.data.id}`)
      .set('Cookie', authCookie)
      .send({
      did: 'test_did',
      secret: 'test_secret',
      period: 1,
      digits: 1
      });
    expect(res.status).toBe(200);
  });

  it('DELETE /totp_secrets/:id soft-deletes a totp_secret', async () => {
    const created = await request(app)
      .post('/api/totp_secrets')
      .set('Cookie', authCookie)
      .send({
      did: 'test_did',
      secret: 'test_secret',
      period: 1,
      digits: 1
      });
    const id = created.body.data.id;
    const res = await request(app)
      .delete(`/api/totp_secrets/${id}`)
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
    const gone = await request(app)
      .get(`/api/totp_secrets/${id}`)
      .set('Cookie', authCookie);
    expect(gone.status).toBe(404);
  });
})
