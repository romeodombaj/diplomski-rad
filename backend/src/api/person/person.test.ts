import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { Wallet } from 'ethers';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';

// A real keypair, not a placeholder string: the access path verifies the
// signature against this public key, so a fake one cannot be substituted.
const PHONE = Wallet.createRandom();
const DID = `did:ethr:sep:${PHONE.address}`;
const PUBLIC_KEY = PHONE.signingKey.publicKey;
const DOOR_CODE = 'MAIN-01';

describe('Person API', () => {
  let buildingId: number;
  let otherBuildingId: number;
  let userId: string;
  let authCookie: string;
  let doorId: number;
  let lastSecret = '';

  const newPerson = (over: Record<string, unknown> = {}) => ({
    full_name: 'Ana Horvat',
    employee_no: 'E-1042',
    email: 'ana@example.com',
    department: 'Engineering',
    job_title: 'Backend Developer',
    person_type: 'employee',
    ...over,
  });

  const create = (body: Record<string, unknown> = {}) =>
    request(app).post('/api/people').set('Cookie', authCookie).send(newPerson(body));

  /**
   * Build a signed access request the way the phone does. The message format
   * must match access.service.ts `accessMessage` byte for byte.
   */
  const signedAccess = async (
    over: Record<string, unknown> = {},
    wallet = PHONE,
    did = DID,
    doorCode = DOOR_CODE,
  ) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = (over.secret as string) ?? lastSecret;
    const nonce = randomUUID().replace(/-/g, '');
    return {
      did,
      door_code: doorCode,
      timestamp,
      nonce,
      signature: await wallet.signMessage(`${did}|${doorCode}|${timestamp}|${nonce}`),
      totp: speakeasy.totp({ secret, encoding: 'base32', digits: 6, step: 30 }),
      faceScore: 0.92,
      ...over,
    };
  };

  /** Create a person and take them all the way to `active` via the mobile handshake. */
  const enrol = async (did = DID, body: Record<string, unknown> = {}) => {
    const created = await create(body);
    const { person, invite } = created.body.data;
    const claim = await request(app)
      .post('/mobile/enroll/claim')
      .send({ token: invite.token, did, publicKey: PUBLIC_KEY, deviceInfo: { platform: 'ios', model: 'iPhone 14' } });
    if (claim.body?.data?.totp?.secret) lastSecret = claim.body.data.totp.secret;
    return { person, invite, claim };
  };

  beforeAll(async () => {
    await db.migrate.latest();
    userId = randomUUID();
    [buildingId] = await db('buildings').insert({ name: 'Test Building', address: 'Addr', contract_address: '0xcontract', is_sandbox: false });
    [otherBuildingId] = await db('buildings').insert({ name: 'Other Building', address: 'Addr 2', contract_address: '0xother', is_sandbox: false });
    await db('users').insert({ id: userId, email: 'test@test.com', name: 'Test', role: 'admin', password_hash: 'x' });
    [doorId] = await db('doors').insert({
      building_id: buildingId, name: 'Main entrance', door_code: DOOR_CODE,
      mqtt_topic: 'doors/main-01/cmd', active: true,
    });

    const token = jwt.sign(
      { userId, email: 'test@test.com', role: 'admin', buildingId, isSandbox: false },
      config.jwt.accessSecret,
      { expiresIn: '1h' },
    );
    authCookie = `access_token=${token}`;
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db('access_events').del();
    await db('totp_secrets').del();
    await db('person_devices').del();
    await db('enrollment_tokens').del();
    await db('people').del();
  });

  // ---------------------------------------------------------------- CRUD

  it('GET /people returns empty array', async () => {
    const res = await request(app).get('/api/people').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.data).toEqual([]);
  });

  it('POST /people creates a person as invited with no DID', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.data.person.id).toBeDefined();
    expect(res.body.data.person.building_id).toBe(buildingId);
    expect(res.body.data.person.status).toBe('invited');
    expect(res.body.data.person.did).toBeNull();
  });

  it('POST /people also mints a first enrolment token', async () => {
    const res = await create();
    expect(res.body.data.invite.token).toBeTruthy();
    expect(new Date(res.body.data.invite.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('POST /people rejects a missing full_name', async () => {
    const res = await request(app).post('/api/people').set('Cookie', authCookie).send({ department: 'X' });
    expect(res.status).toBe(400);
  });

  it('GET /people/:id returns a person', async () => {
    const created = await create();
    const res = await request(app).get(`/api/people/${created.body.data.person.id}`).set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.full_name).toBe('Ana Horvat');
  });

  it('PATCH /people/:id updates a person', async () => {
    const created = await create();
    const res = await request(app)
      .patch(`/api/people/${created.body.data.person.id}`)
      .set('Cookie', authCookie)
      .send({ department: 'Facilities' });
    expect(res.status).toBe(200);
    expect(res.body.data.department).toBe('Facilities');
  });

  it('DELETE /people/:id soft-deletes a person', async () => {
    const created = await create();
    const id = created.body.data.person.id;
    expect((await request(app).delete(`/api/people/${id}`).set('Cookie', authCookie)).status).toBe(200);
    expect((await request(app).get(`/api/people/${id}`).set('Cookie', authCookie)).status).toBe(404);
  });

  it('scopes people to the caller\'s building', async () => {
    await db('people').insert({
      id: randomUUID(), building_id: otherBuildingId,
      full_name: 'Outsider', person_type: 'employee', status: 'active',
    });
    const res = await request(app).get('/api/people').set('Cookie', authCookie);
    expect(res.body.data.data).toEqual([]);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/people')).status).toBe(401);
  });

  // ------------------------------------------------------------ filtering

  it('filters by status and by no_did', async () => {
    await enrol();                                     // -> active, has DID
    await create({ full_name: 'Bez Upisa', employee_no: 'E-2', email: null });  // -> invited, no DID

    const invited = await request(app).get('/api/people?status=invited&count=true').set('Cookie', authCookie);
    expect(invited.body.data.total).toBe(1);

    const noDid = await request(app).get('/api/people?no_did=true&count=true').set('Cookie', authCookie);
    expect(noDid.body.data.total).toBe(1);
    expect(noDid.body.data.data[0].full_name).toBe('Bez Upisa');
  });

  it('searches across name, employee_no and email', async () => {
    await create();
    await create({ full_name: 'Ivan Kovac', employee_no: 'E-9', email: 'ivan@example.com' });
    const res = await request(app).get('/api/people?q=Kovac&count=true').set('Cookie', authCookie);
    expect(res.body.data.total).toBe(1);
  });

  it('hides offboarded people unless asked for', async () => {
    const created = await create();
    await request(app).post(`/api/people/${created.body.data.person.id}/offboard`).set('Cookie', authCookie).send({});

    const def = await request(app).get('/api/people?count=true').set('Cookie', authCookie);
    expect(def.body.data.total).toBe(0);

    const incl = await request(app).get('/api/people?include_offboarded=true&count=true').set('Cookie', authCookie);
    expect(incl.body.data.total).toBe(1);
  });

  // ----------------------------------------------------------- enrolment

  it('claim turns an invited person into an active one and returns a TOTP secret', async () => {
    const { claim } = await enrol();
    expect(claim.status).toBe(200);
    expect(claim.body.data.person.status).toBe('active');
    expect(claim.body.data.totp.secret).toBeTruthy();
    expect(claim.body.data.totp.period).toBe(30);
    expect(claim.body.data.building.contract_address).toBe('0xcontract');
  });

  it('the provisioned credential opens the door it was issued for', async () => {
    await enrol();
    const res = await request(app).post('/mobile/access').send(await signedAccess());
    expect(res.status).toBe(200);
    expect(res.body.data.granted).toBe(true);
    expect(res.body.data.door.code).toBe(DOOR_CODE);
  });

  it('records the enrolling device', async () => {
    const { person, claim } = await enrol();
    expect(claim.status).toBe(200);
    const res = await request(app).get(`/api/people/${person.id}/devices`).set('Cookie', authCookie);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].did).toBe(DID);
    expect(res.body.data[0].platform).toBe('ios');
    expect(res.body.data[0].revoked_at).toBeNull();
  });

  it('rejects a replayed enrolment token', async () => {
    const { invite } = await enrol();
    const replay = await request(app)
      .post('/mobile/enroll/claim')
      .send({ token: invite.token, did: 'did:ethr:sep:0xdead', publicKey: '0x04cc' });
    expect(replay.status).toBe(400);
    expect(replay.body.message).toContain('consumed');
  });

  it('rejects an unknown enrolment token', async () => {
    const res = await request(app)
      .post('/mobile/enroll/claim')
      .send({ token: 'not-a-real-token', did: DID, publicKey: '0x04aa' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('invalid_token');
  });

  it('rejects an expired enrolment token', async () => {
    const created = await create();
    const invite = created.body.data.invite;
    await db('enrollment_tokens')
      .where({ person_id: created.body.data.person.id })
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() });

    const res = await request(app)
      .post('/mobile/enroll/claim')
      .send({ token: invite.token, did: DID, publicKey: '0x04aa' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('expired');
  });

  it('refuses to bind a DID that already belongs to someone else', async () => {
    await enrol();
    const second = await create({ full_name: 'Drugi Covjek', employee_no: 'E-3', email: null });
    const res = await request(app)
      .post('/mobile/enroll/claim')
      .send({ token: second.body.data.invite.token, did: DID, publicKey: '0x04bb' });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('did_taken');
  });

  it('reissuing an enrolment token invalidates the previous one', async () => {
    const created = await create();
    const first = created.body.data.invite;
    const reissued = await request(app)
      .post(`/api/people/${created.body.data.person.id}/enrollment`)
      .set('Cookie', authCookie);
    expect(reissued.status).toBe(201);
    expect(reissued.body.data.token).not.toBe(first.token);

    const oldOne = await request(app).post('/mobile/enroll/claim').send({ token: first.token, did: DID, publicKey: '0x04aa' });
    expect(oldOne.status).toBe(400);

    const newOne = await request(app).post('/mobile/enroll/claim').send({ token: reissued.body.data.token, did: DID, publicKey: '0x04aa' });
    expect(newOne.status).toBe(200);
  });

  it('will not issue an enrolment token to someone already enrolled', async () => {
    const { person } = await enrol();
    const res = await request(app).post(`/api/people/${person.id}/enrollment`).set('Cookie', authCookie);
    expect(res.status).toBe(409);
  });

  it('GET /people/:id/enrollment reports status without leaking the token', async () => {
    const created = await create();
    const res = await request(app)
      .get(`/api/people/${created.body.data.person.id}/enrollment`)
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(true);
    expect(res.body.data.token).toBeUndefined();
  });

  it('stores enrolment tokens hashed, never in the clear', async () => {
    const created = await create();
    const raw = created.body.data.invite.token;
    const row = await db('enrollment_tokens').where({ person_id: created.body.data.person.id }).first();
    expect(row.token_hash).not.toBe(raw);
    expect(row.token_hash).toHaveLength(64);   // sha256 hex
  });

  // ----------------------------------------------------------- lifecycle

  it('suspend keeps the DID so the person can return without re-enrolling', async () => {
    const { person } = await enrol();
    const res = await request(app).post(`/api/people/${person.id}/suspend`).set('Cookie', authCookie).send({ reason: 'leave' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('suspended');
    expect(res.body.data.did).toBe(DID);
  });

  it('reinstate returns a suspended person to active', async () => {
    const { person } = await enrol();
    await request(app).post(`/api/people/${person.id}/suspend`).set('Cookie', authCookie).send({});
    const res = await request(app).post(`/api/people/${person.id}/reinstate`).set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
  });

  it('rejects an illegal transition', async () => {
    const { person } = await enrol();
    await request(app).post(`/api/people/${person.id}/suspend`).set('Cookie', authCookie).send({});
    const res = await request(app).post(`/api/people/${person.id}/suspend`).set('Cookie', authCookie).send({});
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('cannot go from suspended to suspended');
  });

  it('offboarding is terminal', async () => {
    const { person } = await enrol();
    expect((await request(app).post(`/api/people/${person.id}/offboard`).set('Cookie', authCookie).send({})).status).toBe(200);
    const back = await request(app).post(`/api/people/${person.id}/reinstate`).set('Cookie', authCookie);
    expect(back.status).toBe(409);
  });

  it('404s on lifecycle actions for an unknown person', async () => {
    const res = await request(app).post(`/api/people/${randomUUID()}/suspend`).set('Cookie', authCookie).send({});
    expect(res.status).toBe(404);
  });

  // ------------------------------------------------------------- devices

  it('revoking a device clears the DID and drops the person back to invited', async () => {
    const { person } = await enrol();
    const devices = await request(app).get(`/api/people/${person.id}/devices`).set('Cookie', authCookie);

    const res = await request(app)
      .post(`/api/people/${person.id}/devices/${devices.body.data[0].id}/revoke`)
      .set('Cookie', authCookie)
      .send({ reason: 'stolen' });
    expect(res.status).toBe(200);
    expect(res.body.data.revoked_at).toBeTruthy();
    expect(res.body.data.revocation_reason).toBe('stolen');

    const after = await request(app).get(`/api/people/${person.id}`).set('Cookie', authCookie);
    expect(after.body.data.status).toBe('invited');
    expect(after.body.data.did).toBeNull();
  });

  it('a revoked device can no longer open anything', async () => {
    const { person, claim } = await enrol();
    const devices = await request(app).get(`/api/people/${person.id}/devices`).set('Cookie', authCookie);
    await request(app)
      .post(`/api/people/${person.id}/devices/${devices.body.data[0].id}/revoke`)
      .set('Cookie', authCookie)
      .send({ reason: 'stolen' });

    // The same secret that worked a moment ago must now be refused outright,
    // not merely fail the code comparison.
    const res = await request(app)
      .post('/mobile/access')
      .send(await signedAccess({ secret: claim.body.data.totp.secret }));
    expect(res.status).toBe(403);
    expect(res.body.data.reason).toBe('device_revoked');
  });

  it('a person can re-enrol on a replacement device after a revocation', async () => {
    const { person } = await enrol();
    const devices = await request(app).get(`/api/people/${person.id}/devices`).set('Cookie', authCookie);
    await request(app)
      .post(`/api/people/${person.id}/devices/${devices.body.data[0].id}/revoke`)
      .set('Cookie', authCookie).send({});

    const reissued = await request(app).post(`/api/people/${person.id}/enrollment`).set('Cookie', authCookie);
    expect(reissued.status).toBe(201);

    const newDid = 'did:ethr:sep:0xbbbb111122223333444455556666777788889999';
    const claim = await request(app)
      .post('/mobile/enroll/claim')
      .send({ token: reissued.body.data.token, did: newDid, publicKey: '0x04ff' });
    expect(claim.status).toBe(200);
    expect(claim.body.data.person.status).toBe('active');

    const after = await request(app).get(`/api/people/${person.id}`).set('Cookie', authCookie);
    expect(after.body.data.did).toBe(newDid);
  });

  it('404s when revoking a device that is not theirs', async () => {
    const { person } = await enrol();
    const res = await request(app)
      .post(`/api/people/${person.id}/devices/99999/revoke`)
      .set('Cookie', authCookie).send({});
    expect(res.status).toBe(404);
  });
});
