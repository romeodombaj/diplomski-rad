import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { Wallet } from 'ethers';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';

/**
 * The access path, end to end.
 *
 * Each case here corresponds to a check that the endpoint this replaces did not
 * perform. The old `/mobile/verify/totp` took `{ did, code, faceScore? }`,
 * looked the secret up with `where({ did })` across every building, logged
 * `face: bypassed`, and returned "Access granted" — so a single enrolled
 * device's code opened every door in the system.
 */
describe('Mobile access path', () => {
  const PHONE = Wallet.createRandom();
  const ATTACKER = Wallet.createRandom();
  const DID = `did:ethr:sep:${PHONE.address}`;
  const DOOR = 'MAIN-01';
  const SIDE_DOOR = 'SIDE-02';
  const OTHER_BUILDING_DOOR = 'OTHER-01';

  let buildingId: number;
  let otherBuildingId: number;
  let authCookie: string;
  let personId: string;
  let secret: string;

  const sign = async (
    over: Record<string, unknown> = {},
    wallet: Wallet | ReturnType<typeof Wallet.createRandom> = PHONE,
  ) => {
    const did = (over.did as string) ?? DID;
    const doorCode = (over.door_code as string) ?? DOOR;
    const timestamp = (over.timestamp as number) ?? Math.floor(Date.now() / 1000);
    const totpSecret = (over.secret as string) ?? secret;
    const nonce = (over.nonce as string) ?? randomUUID().replace(/-/g, '');
    const body: Record<string, unknown> = {
      did,
      door_code: doorCode,
      timestamp,
      nonce,
      signature: await wallet.signMessage(`${did}|${doorCode}|${timestamp}|${nonce}`),
      totp: speakeasy.totp({ secret: totpSecret, encoding: 'base32', digits: 6, step: 30 }),
      faceScore: 0.92,
      ...over,
    };
    delete body.secret;
    return body;
  };

  const post = async (over: Record<string, unknown> = {}, wallet = PHONE) =>
    request(app).post('/mobile/access').send(await sign(over, wallet));

  /** Enrol PHONE against a fresh person and capture the provisioned secret. */
  const enrol = async (did = DID, publicKey = PHONE.signingKey.publicKey) => {
    const created = await request(app)
      .post('/api/people')
      .set('Cookie', authCookie)
      .send({ full_name: 'Ana Horvat', employee_no: `E-${randomUUID().slice(0, 6)}` });
    const { person, invite } = created.body.data;
    const claim = await request(app)
      .post('/mobile/enroll/claim')
      .send({ token: invite.token, did, publicKey, deviceInfo: { platform: 'ios' } });
    personId = person.id;
    secret = claim.body.data.totp.secret;
    return { person, claim };
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
      id: userId, email: 'op@test.com', name: 'Op', role: 'admin', password_hash: 'x',
    });
    await db('doors').insert([
      { building_id: buildingId, name: 'Main', door_code: DOOR, mqtt_topic: 'd/main', active: true },
      { building_id: buildingId, name: 'Side', door_code: SIDE_DOOR, mqtt_topic: 'd/side', active: false },
      { building_id: otherBuildingId, name: 'Annex', door_code: OTHER_BUILDING_DOOR, mqtt_topic: 'd/annex', active: true },
    ]);

    authCookie = `access_token=${jwt.sign(
      { userId, email: 'op@test.com', role: 'admin', buildingId, isSandbox: false },
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
  });

  // ── the happy path ────────────────────────────────────────────────────────

  it('grants when signature, TOTP, door and face all check out', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.data.granted).toBe(true);
    expect(res.body.data.reason).toBe('ok');
    expect(res.body.data.door).toEqual({ code: DOOR, name: 'Main' });
    expect(res.body.data.event_hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('records every grant as an access event', async () => {
    await post();
    const [event] = await db('access_events').select('*');
    expect(event.decision).toBe('granted');
    expect(event.door_code).toBe(DOOR);
    expect(event.person_id).toBe(personId);
    expect(Boolean(event.signature_verified)).toBe(true);
    expect(event.face_score).toBeCloseTo(0.92, 5);
  });

  // ── the request now carries a door ────────────────────────────────────────

  it('rejects a request with no door at all', async () => {
    const body = await sign();
    delete body.door_code;
    const res = await request(app).post('/mobile/access').send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('door_code');
  });

  it('denies an unknown door', async () => {
    const res = await post({ door_code: 'NOPE-99' });
    expect(res.status).toBe(404);
    expect(res.body.data.reason).toBe('unknown_door');
  });

  it('denies a door that is locked down', async () => {
    // Enforced on the access path, not just hidden in the UI: the phone signs
    // its own request, so a modified client could ask regardless of any screen.
    await db('doors').where({ door_code: DOOR }).update({ locked_down: true });
    const res = await post();
    expect(res.body.data.reason).toBe('door_locked_down');
    expect(res.body.data.granted).toBe(false);
    await db('doors').where({ door_code: DOOR }).update({ locked_down: false });
  });

  it('denies everyone while the building is in emergency lockdown', async () => {
    await db('buildings').where({ id: buildingId }).update({ lockdown_at: new Date().toISOString() });
    const res = await post();
    expect(res.body.data.reason).toBe('building_lockdown');
    expect(res.body.data.granted).toBe(false);
    await db('buildings').where({ id: buildingId }).update({ lockdown_at: null });
  });

  it('records a lockdown refusal as an access event', async () => {
    // "Who tried to get in during the lockdown" has to be answerable after.
    await db('doors').where({ door_code: DOOR }).update({ locked_down: true });
    await post();
    const [event] = await db('access_events').where({ reason: 'door_locked_down' });
    expect(event).toBeTruthy();
    expect(event.decision).toBe('denied');
    await db('doors').where({ door_code: DOOR }).update({ locked_down: false });
  });

  it('denies a door that is out of service', async () => {
    const res = await post({ door_code: SIDE_DOOR });
    expect(res.body.data.reason).toBe('door_inactive');
  });

  it("denies a door in a building the person does not belong to", async () => {
    const res = await post({ door_code: OTHER_BUILDING_DOOR });
    expect(res.status).toBe(403);
    expect(res.body.data.reason).toBe('door_not_in_scope');
  });

  it('grants at a second building once the person is attached to it', async () => {
    // No second credential is minted anywhere — enrolment issues one per person.
    // If this needed a hand-inserted totp_secrets row it would be testing a
    // state no product path can reach.
    await db('person_buildings').insert({ person_id: personId, building_id: otherBuildingId });
    const res = await post({ door_code: OTHER_BUILDING_DOOR });
    expect(res.body.data.granted).toBe(true);
  });

  it('resolves same-named doors within the person\'s buildings', async () => {
    // door_code carries no unique constraint, so two buildings may both call
    // their entrance MAIN-01. A global lookup would take the lower id and
    // publish to the wrong building's topic.
    const [twinId] = await db('doors').insert({
      building_id: otherBuildingId, name: 'Annex main', door_code: DOOR,
      mqtt_topic: 'd/annex-main', active: true,
    });
    const res = await post();
    expect(res.body.data.granted).toBe(true);
    const event = await db('access_events').where({ decision: 'granted' }).first();
    expect(event.building_id).toBe(buildingId);
    expect(event.door_id).not.toBe(twinId);
    await db('doors').where({ id: twinId }).del();
  });

  // ── the request is now signed ─────────────────────────────────────────────

  it('denies a signature produced by a different phone', async () => {
    const res = await post({}, ATTACKER);
    expect(res.status).toBe(401);
    expect(res.body.data.reason).toBe('invalid_signature');
  });

  it('denies a signature lifted from a request for another door', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID().replace(/-/g, '');
    const res = await request(app).post('/mobile/access').send({
      did: DID,
      door_code: DOOR,                                                  // claims the main door
      timestamp,
      nonce,
      // ...but signed a message naming the side door.
      signature: await PHONE.signMessage(`${DID}|${SIDE_DOOR}|${timestamp}|${nonce}`),
      totp: speakeasy.totp({ secret, encoding: 'base32', digits: 6, step: 30 }),
      faceScore: 0.92,
    });
    expect(res.status).toBe(401);
    expect(res.body.data.reason).toBe('invalid_signature');
  });

  it('accepts two genuine taps in the same second', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const first = await post({ timestamp });
    const second = await post({ timestamp });
    expect(first.body.data.granted).toBe(true);
    expect(second.body.data.granted).toBe(true);
  });

  it('reveals nothing about doors or people without a valid signature', async () => {
    // Signature verification gates every database fact below it. A DID is an
    // Ethereum address and effectively public, so an attacker holding only a
    // DID string must not be able to tell a real door from a made-up one, or
    // an active person from a suspended one.
    const unknownDoor = await post({ door_code: 'NOPE-99' }, ATTACKER);
    const realDoor = await post({ door_code: DOOR }, ATTACKER);
    const inactiveDoor = await post({ door_code: SIDE_DOOR }, ATTACKER);

    for (const res of [unknownDoor, realDoor, inactiveDoor]) {
      expect(res.status).toBe(401);
      expect(res.body.data.reason).toBe('invalid_signature');
    }

    await request(app).post(`/api/people/${personId}/suspend`).set('Cookie', authCookie).send({});
    const suspended = await post({}, ATTACKER);
    expect(suspended.body.data.reason).toBe('invalid_signature');
  });

  it('denies when the device has no public key on file', async () => {
    await db('person_devices').where({ did: DID }).update({ public_key: null });
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.body.data.reason).toBe('no_public_key');
  });

  // ── replay and freshness ──────────────────────────────────────────────────

  it('refuses to replay a signature that already opened the door', async () => {
    const body = await sign();
    const first = await request(app).post('/mobile/access').send(body);
    expect(first.body.data.granted).toBe(true);

    const replay = await request(app).post('/mobile/access').send(body);
    expect(replay.status).toBe(409);
    expect(replay.body.data.reason).toBe('replay');
    expect(await db('access_events').count('* as c').first()).toEqual({ c: 1 });
  });

  it('refuses to replay a signature that was already denied', async () => {
    const body = await sign({ faceScore: 0.1 });
    const denied = await request(app).post('/mobile/access').send(body);
    expect(denied.body.data.reason).toBe('face_below_threshold');

    const replay = await request(app).post('/mobile/access').send(body);
    expect(replay.body.data.reason).toBe('replay');
  });

  it('unlocks once when the same signature arrives twice concurrently', async () => {
    // The replay lookup and the insert are not atomic; the unique index is the
    // real guard. Exactly one of these must win, and the winner must be the one
    // that also opened the door — an unlock with no audit row is the outcome
    // this system exists to rule out.
    const body = await sign();
    const [a, b] = await Promise.all([
      request(app).post('/mobile/access').send(body),
      request(app).post('/mobile/access').send(body),
    ]);
    const outcomes = [a.body.data.reason, b.body.data.reason].sort();
    expect(outcomes).toEqual(['ok', 'replay']);
    expect(await db('access_events').count('* as c').first()).toEqual({ c: 1 });

    // The loser must not report an unlock, and must never hand back a fake id.
    // Which guard caught it depends on timing — better-sqlite3 serialises, so
    // in practice the step-2 lookup usually wins and returns the original id;
    // under a concurrent driver the unique index catches it and there is no id
    // to give. Both are correct; a hash masquerading as an id is not.
    const winner = [a, b].find((r) => r.body.data.reason === 'ok')!;
    const loser = [a, b].find((r) => r.body.data.reason === 'replay')!;
    expect(loser.body.data.unlocked).toBe(false);
    expect([winner.body.data.event_id, null]).toContain(loser.body.data.event_id);
  });

  it('gives a replay the original event id, never the event hash', async () => {
    const body = await sign();
    const first = await request(app).post('/mobile/access').send(body);
    const replay = await request(app).post('/mobile/access').send(body);
    expect(replay.body.data.event_id).toBe(first.body.data.event_id);
    expect(replay.body.data.event_id).not.toBe(replay.body.data.event_hash);
    // The id must resolve through the read API; a hash would 404.
    const fetched = await request(app)
      .get(`/api/audit-logs/${replay.body.data.event_id}`)
      .set('Cookie', authCookie);
    expect(fetched.status).toBe(200);
  });

  it('denies a request older than the freshness window', async () => {
    const stale = Math.floor(Date.now() / 1000) - (config.access.maxRequestAgeSeconds + 60);
    const res = await post({ timestamp: stale });
    expect(res.status).toBe(401);
    expect(res.body.data.reason).toBe('stale_request');
  });

  it('denies a request timestamped in the future', async () => {
    const res = await post({ timestamp: Math.floor(Date.now() / 1000) + 600 });
    expect(res.body.data.reason).toBe('stale_request');
  });

  // ── TOTP still matters ────────────────────────────────────────────────────

  it('denies a wrong TOTP code', async () => {
    const res = await post({ totp: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.data.reason).toBe('invalid_totp');
  });

  it('denies a TOTP from a secret the backend never issued', async () => {
    const foreign = speakeasy.generateSecret({ length: 20 }).base32;
    const res = await post({ secret: foreign });
    expect(res.body.data.reason).toBe('invalid_totp');
  });

  // ── identity lifecycle ────────────────────────────────────────────────────

  it('denies an unenrolled DID', async () => {
    const stranger = Wallet.createRandom();
    const did = `did:ethr:sep:${stranger.address}`;
    const res = await post({ did }, stranger);
    expect(res.status).toBe(404);
    expect(res.body.data.reason).toBe('unknown_did');
  });

  it('denies a revoked device', async () => {
    const device = await db('person_devices').where({ did: DID }).first();
    await request(app)
      .post(`/api/people/${personId}/devices/${device.id}/revoke`)
      .set('Cookie', authCookie)
      .send({ reason: 'stolen' });
    const res = await post();
    expect(res.body.data.reason).toBe('device_revoked');
  });

  it('denies a suspended person', async () => {
    await request(app).post(`/api/people/${personId}/suspend`).set('Cookie', authCookie).send({});
    const res = await post();
    expect(res.body.data.reason).toBe('person_inactive');
  });

  it('denies an offboarded person', async () => {
    await request(app).post(`/api/people/${personId}/offboard`).set('Cookie', authCookie).send({});
    const res = await post();
    expect(res.body.data.reason).toBe('person_inactive');
  });

  // ── face is enforced, not advisory ────────────────────────────────────────

  it('denies when no face score is supplied', async () => {
    const body = await sign();
    delete body.faceScore;
    const res = await request(app).post('/mobile/access').send(body);
    expect(res.status).toBe(401);
    expect(res.body.data.reason).toBe('face_missing');
  });

  it('denies a face score below the threshold', async () => {
    const res = await post({ faceScore: 0.31 });
    expect(res.body.data.reason).toBe('face_below_threshold');
  });

  // ── denials are recorded, not just logged ────────────────────────────────

  it('records denials with their reason so the log shows attempts', async () => {
    await post({ totp: '000000' });
    await post({ door_code: 'NOPE-99' });
    const rows = await db('access_events').select('reason').orderBy('reason');
    expect(rows.map((r) => r.reason)).toEqual(['invalid_totp', 'unknown_door']);
  });

  it('exposes the events through /api/audit-logs', async () => {
    await post();
    await post({ totp: '000000' });

    const res = await request(app)
      .get('/api/audit-logs?count=true')
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.data[0].person_name).toBe('Ana Horvat');
  });

  it('summarises grants, denials and busy hours for the dashboard', async () => {
    await post();
    await post({ totp: '000000' });

    const res = await request(app).get('/api/audit-logs/stats').set('Cookie', authCookie);
    expect(res.body.data.granted).toBe(1);
    expect(res.body.data.denied).toBe(1);
    expect(res.body.data.byHour).toHaveLength(24);
    expect(res.body.data.byReason.find((r: any) => r.reason === 'invalid_totp').count).toBe(1);
  });

  it('counts correctly on a page past the first', async () => {
    for (let i = 0; i < 3; i++) await post();
    const res = await request(app)
      .get('/api/audit-logs?count=true&page=2&limit=2')
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
  });

  it('filters the log by decision', async () => {
    await post();
    await post({ totp: '000000' });

    const res = await request(app)
      .get('/api/audit-logs?decision=denied&count=true')
      .set('Cookie', authCookie);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.data[0].reason).toBe('invalid_totp');
  });

  it('does not leak another building\'s events', async () => {
    await post();
    const otherCookie = `access_token=${jwt.sign(
      { userId: randomUUID(), email: 'op2@test.com', role: 'admin', buildingId: otherBuildingId, isSandbox: false },
      config.jwt.accessSecret,
      { expiresIn: '1h' },
    )}`;
    const res = await request(app).get('/api/audit-logs?count=true').set('Cookie', otherCookie);
    expect(res.body.data.total).toBe(0);
  });

  it('requires an operator session to read the log', async () => {
    const res = await request(app).get('/api/audit-logs');
    expect(res.status).toBe(401);
  });

  it('keeps the security posture off the public health probe', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'ok' });

    const authed = await request(app).get('/api/health/status').set('Cookie', authCookie);
    expect(authed.body.data.access.requireFace).toBe(true);
    expect(await request(app).get('/api/health/status')).toHaveProperty('status', 401);
  });

  // ── the endpoint that minted credentials for anyone is gone ──────────────

  it('no longer exposes the unauthenticated TOTP enrolment route', async () => {
    const res = await request(app)
      .post('/mobile/totp/enroll')
      .send({ did: 'did:ethr:sep:0xdeadbeef' });
    expect(res.status).toBe(404);
  });

  it('no longer exposes the old door-less verify route', async () => {
    const res = await request(app).post('/mobile/verify/totp').send({ did: DID, code: '123456' });
    expect(res.status).toBe(404);
  });
});
