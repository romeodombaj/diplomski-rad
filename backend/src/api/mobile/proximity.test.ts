import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Wallet } from 'ethers';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';
import * as mqttService from '../../services/mqttService';
import { proximityMessage } from './proximity.service';
import { accessMessage } from './access.service';

describe('Mobile proximity path', () => {
  const PHONE = Wallet.createRandom();
  const OTHER = Wallet.createRandom();
  const DID = `did:ethr:sep:${PHONE.address}`;
  const DOOR = 'MAIN-01';
  const CLOSED_DOOR = 'SIDE-02';
  const OTHER_BUILDING_DOOR = 'OTHER-01';

  let buildingId: number;
  let otherBuildingId: number;
  let authCookie: string;
  let personId: string;
  let publishSpy: MockInstance<[string, mqttService.ProximityUpdate], Promise<boolean>>;

  const sign = async (
    over: Record<string, unknown> = {},
    wallet: Wallet | ReturnType<typeof Wallet.createRandom> = PHONE,
  ) => {
    const did = (over.did as string) ?? DID;
    const doorCode = (over.door_code as string) ?? DOOR;
    const timestamp = (over.timestamp as number) ?? Math.floor(Date.now() / 1000);
    const nonce = (over.nonce as string) ?? randomUUID().replace(/-/g, '');
    const level = (over.level as number) ?? 5;
    return {
      did,
      door_code: doorCode,
      level,
      rssi: -61,
      timestamp,
      nonce,
      signature: await wallet.signMessage(
        proximityMessage(did, doorCode, timestamp, nonce, level),
      ),
      ...over,
    };
  };

  const post = async (over: Record<string, unknown> = {}, wallet = PHONE) =>
    request(app).post('/mobile/proximity').send(await sign(over, wallet));

  const enrol = async (did = DID, publicKey = PHONE.signingKey.publicKey) => {
    const created = await request(app)
      .post('/api/people')
      .set('Cookie', authCookie)
      .send({ full_name: 'Ana Horvat', employee_no: `E-${randomUUID().slice(0, 6)}` });
    const { person, invite } = created.body.data;
    await request(app)
      .post('/mobile/enroll/claim')
      .send({ token: invite.token, did, publicKey, deviceInfo: { platform: 'android' } });
    personId = person.id;
    return person;
  };

  beforeAll(async () => {
    await db.migrate.latest();
    const userId = randomUUID();
    [buildingId] = await db('buildings').insert({
      name: 'HQ', address: 'A', contract_address: '0xcontract', is_sandbox: false,
    });
    [otherBuildingId] = await db('buildings').insert({
      name: 'Annex', address: 'B', contract_address: '0xother', is_sandbox: false,
    });
    await db('users').insert({
      id: userId, email: 'prox@test.com', name: 'Op', role: 'admin', password_hash: 'x',
    });
    await db('doors').insert([
      { building_id: buildingId, name: 'Main', door_code: DOOR, mqtt_topic: 'd/main', active: true },
      { building_id: buildingId, name: 'Side', door_code: CLOSED_DOOR, mqtt_topic: 'd/side', active: false },
      { building_id: otherBuildingId, name: 'Annex', door_code: OTHER_BUILDING_DOOR, mqtt_topic: 'd/annex', active: true },
    ]);

    authCookie = `access_token=${jwt.sign(
      { userId, email: 'prox@test.com', role: 'admin', buildingId, isSandbox: false },
      config.jwt.accessSecret,
      { expiresIn: '1h' },
    )}`;
  });

  afterAll(async () => { await db.destroy(); });

  beforeEach(async () => {
    await db('access_events').del();
    await db('totp_secrets').del();
    await db('person_devices').del();
    await db('enrollment_tokens').del();
    await db('people').del();
    await enrol();
    publishSpy = vi.spyOn(mqttService, 'publishProximity').mockResolvedValue(true);
  });


  it('publishes an enrolled phone\'s report to that door\'s topic', async () => {
    const res = await post({ level: 6 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ published: true, level: 6 });
    expect(publishSpy).toHaveBeenCalledWith('d/main', expect.objectContaining({
      doorCode: DOOR, level: 6, levels: config.proximity.levels, rssi: -61,
    }));
  });

  it('reports the broker being down without failing the request', async () => {
    publishSpy.mockResolvedValue(false);
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.data.published).toBe(false);
  });

  it('clamps a level above the configured ring size', async () => {
    const res = await post({ level: 64 });
    expect(res.status).toBe(200);
    expect(res.body.data.level).toBe(config.proximity.levels);
    expect(publishSpy).toHaveBeenCalledWith('d/main', expect.objectContaining({
      level: config.proximity.levels,
    }));
  });


  it('writes no access event, ever', async () => {
    await post();
    await post({ level: 0 });
    expect(await db('access_events').count('* as c').first()).toMatchObject({ c: 0 });
  });

  it('cannot be replayed as an access request', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID().replace(/-/g, '');
    const signature = await PHONE.signMessage(proximityMessage(DID, DOOR, timestamp, nonce, 5));

    const res = await request(app).post('/mobile/access').send({
      did: DID, door_code: `${DOOR}|5`, timestamp, nonce, signature,
      totp: '000000', faceScore: 0.99,
    });

    expect(res.body.data?.granted).toBeFalsy();
    expect(res.body.data?.reason).not.toBe('ok');
  });

  it('rejects an access signature replayed as a proximity report', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID().replace(/-/g, '');
    const signature = await PHONE.signMessage(accessMessage(DID, DOOR, timestamp, nonce));

    const res = await request(app).post('/mobile/proximity').send({
      did: DID, door_code: DOOR, level: 5, rssi: -61, timestamp, nonce, signature,
    });

    expect(res.status).toBe(401);
    expect(publishSpy).not.toHaveBeenCalled();
  });


  it('rejects a signature from the wrong key', async () => {
    const res = await post({}, OTHER);
    expect(res.status).toBe(401);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('rejects a level the signature did not cover', async () => {
    const body = await sign({ level: 2 });
    body.level = 8;
    const res = await request(app).post('/mobile/proximity').send(body);
    expect(res.status).toBe(401);
  });

  it('rejects an unenrolled DID', async () => {
    const stranger = Wallet.createRandom();
    const res = await post({ did: `did:ethr:sep:${stranger.address}` }, stranger);
    expect(res.status).toBe(404);
  });

  it('rejects a revoked device', async () => {
    await db('person_devices').where({ did: DID }).update({ revoked_at: new Date().toISOString() });
    const res = await post();
    expect(res.status).toBe(403);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('rejects a suspended person', async () => {
    await db('people').where({ id: personId }).update({ status: 'suspended' });
    const res = await post();
    expect(res.status).toBe(403);
  });

  it('rejects a stale report', async () => {
    const res = await post({ timestamp: Math.floor(Date.now() / 1000) - 600 });
    expect(res.status).toBe(400);
  });


  it('rejects a door in a building this person does not belong to', async () => {
    const res = await post({ door_code: OTHER_BUILDING_DOOR });
    expect(res.status).toBe(404);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('rejects a door that is out of service', async () => {
    const res = await post({ door_code: CLOSED_DOOR });
    expect(res.status).toBe(403);
  });

  it('answers every rejection with the same body', async () => {
    const bodies = await Promise.all([
      post({}, OTHER),
      post({ door_code: OTHER_BUILDING_DOOR }),
      post({ timestamp: 1 }),
    ]);
    for (const res of bodies) {
      expect(res.body).toEqual({ success: false, message: 'Proximity report rejected' });
    }
  });


  it('rejects a nonce carrying a pipe, which domain separation depends on', async () => {
    const res = await post({ nonce: 'deadbeefdeadbeef|9' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('nonce');
  });

  it('rejects a report with no door', async () => {
    const body = await sign();
    delete (body as Record<string, unknown>).door_code;
    const res = await request(app).post('/mobile/proximity').send(body);
    expect(res.status).toBe(400);
  });
});
