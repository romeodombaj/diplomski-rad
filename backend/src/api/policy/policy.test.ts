import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Wallet } from 'ethers';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';
import * as scheduleService from '../../services/scheduleService';

/**
 * The policy layer with the chain disabled: authoring, compilation into mirror
 * rows, and the queue semantics. What lands on chain is covered by
 * scripts/verify-chain-e2e.ts, which runs against a real node.
 */
describe('Policy API', () => {
  let buildingId: number;
  let otherBuildingId: number;
  let cookie: string;
  let mainDoorId: number;
  let sideDoorId: number;
  let foreignDoorId: number;
  let personId: string;

  const createPerson = async (name = 'Ana Horvat') => {
    const res = await request(app).post('/api/people').set('Cookie', cookie)
      .send({ full_name: name, employee_no: `E-${randomUUID().slice(0, 6)}` });
    const { person, invite } = res.body.data;
    const phone = Wallet.createRandom();
    await request(app).post('/mobile/enroll/claim').send({
      token: invite.token,
      did: `did:ethr:sep:${phone.address}`,
      publicKey: phone.signingKey.publicKey,
    });
    return person.id as string;
  };

  const createGroup = async (name = 'Engineering') =>
    (await request(app).post('/api/policies/groups').set('Cookie', cookie).send({ name }))
      .body.data.id as number;

  beforeAll(async () => {
    await db.migrate.latest();
    const userId = randomUUID();
    [buildingId] = await db('buildings').insert({
      name: 'HQ', address: 'A', contract_address: '0xc', is_sandbox: false,
    });
    [otherBuildingId] = await db('buildings').insert({
      name: 'Annex', address: 'B', contract_address: '0xd', is_sandbox: false,
    });
    await db('users').insert({
      id: userId, email: 'op@test.com', name: 'Op', role: 'admin', password_hash: 'x',
    });
    [mainDoorId] = await db('doors').insert({
      building_id: buildingId, name: 'Main', door_code: 'MAIN-01', mqtt_topic: 'd/m', active: true,
    });
    [sideDoorId] = await db('doors').insert({
      building_id: buildingId, name: 'Side', door_code: 'SIDE-02', mqtt_topic: 'd/s', active: true,
    });
    [foreignDoorId] = await db('doors').insert({
      building_id: otherBuildingId, name: 'Annex', door_code: 'ANX-01', mqtt_topic: 'd/a', active: true,
    });

    cookie = `access_token=${jwt.sign(
      { userId, email: 'op@test.com', role: 'admin', buildingId, isSandbox: false },
      config.jwt.accessSecret, { expiresIn: '1h' },
    )}`;
  });

  afterAll(async () => { await db.destroy(); });

  beforeEach(async () => {
    await db('access_policy_drift').del();
    await db('access_policy_mirror').del();
    await db('person_access_groups').del();
    await db('access_group_doors').del();
    await db('access_groups').del();
    await db('access_schedules').del();
    await db('totp_secrets').del();
    await db('person_devices').del();
    await db('enrollment_tokens').del();
    await db('people').del();
    personId = await createPerson();
  });

  // ── direct grants ─────────────────────────────────────────────────────────

  it('queues a direct grant rather than blocking on the chain', async () => {
    const res = await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: mainDoorId });

    // 202: the row is authored and queued; the chain write follows.
    expect(res.status).toBe(202);
    expect(res.body.data.sync_status).toBe('pending');
    expect(res.body.data.source).toBe('direct');
    expect(res.body.data.door_code).toBe('MAIN-01');
  });

  it('refuses a grant for a person with no DID', async () => {
    const created = await request(app).post('/api/people').set('Cookie', cookie)
      .send({ full_name: 'Not Enrolled', employee_no: 'E-NONE' });
    const res = await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: created.body.data.person.id, door_id: mainDoorId });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('no_did');
  });

  it('refuses a grant for a door in another building', async () => {
    const res = await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: foreignDoorId });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('door_not_in_scope');
  });

  it('refuses to grant the same door twice', async () => {
    await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: mainDoorId });
    const again = await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: mainDoorId });
    expect(again.status).toBe(409);
    expect(again.body.message).toContain('already_granted');
  });

  // ── groups compile to one policy per door ─────────────────────────────────

  it('expands a group assignment into one mirror row per door', async () => {
    const groupId = await createGroup();
    await request(app).put(`/api/policies/groups/${groupId}/doors`).set('Cookie', cookie)
      .send({ doors: [{ door_id: mainDoorId }, { door_id: sideDoorId }] });

    const res = await request(app).post('/api/policies/assignments').set('Cookie', cookie)
      .send({ person_id: personId, group_id: groupId });

    expect(res.status).toBe(202);
    expect(res.body.data.created).toBe(2);

    const rows = await db('access_policy_mirror').where({ person_id: personId });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'group' && r.source_group_id === groupId)).toBe(true);
  });

  it('is idempotent on re-assignment, so a retry cannot double-grant', async () => {
    const groupId = await createGroup();
    await request(app).put(`/api/policies/groups/${groupId}/doors`).set('Cookie', cookie)
      .send({ doors: [{ door_id: mainDoorId }] });

    await request(app).post('/api/policies/assignments').set('Cookie', cookie)
      .send({ person_id: personId, group_id: groupId });
    const second = await request(app).post('/api/policies/assignments').set('Cookie', cookie)
      .send({ person_id: personId, group_id: groupId });

    expect(second.body.data.created).toBe(0);
    expect(await db('access_policy_mirror').where({ person_id: personId })).toHaveLength(1);
  });

  it('queues revocation when a door leaves a group', async () => {
    const groupId = await createGroup();
    await request(app).put(`/api/policies/groups/${groupId}/doors`).set('Cookie', cookie)
      .send({ doors: [{ door_id: mainDoorId }, { door_id: sideDoorId }] });
    await request(app).post('/api/policies/assignments').set('Cookie', cookie)
      .send({ person_id: personId, group_id: groupId });

    await request(app).put(`/api/policies/groups/${groupId}/doors`).set('Cookie', cookie)
      .send({ doors: [{ door_id: mainDoorId }] });

    const rows = await db('access_policy_mirror').where({ person_id: personId });
    const side = rows.find((r) => r.door_id === sideDoorId);
    // Marked for revocation, not deleted: the on-chain policy still exists
    // until a transaction says otherwise.
    expect(side.sync_status).toBe('revoking');
  });

  it('reports the fan-out of a group before it is edited', async () => {
    const groupId = await createGroup();
    await request(app).put(`/api/policies/groups/${groupId}/doors`).set('Cookie', cookie)
      .send({ doors: [{ door_id: mainDoorId }, { door_id: sideDoorId }] });
    await request(app).post('/api/policies/assignments').set('Cookie', cookie)
      .send({ person_id: personId, group_id: groupId });

    const res = await request(app).get('/api/policies/groups').set('Cookie', cookie);
    const group = res.body.data.find((g: any) => g.id === groupId);
    expect(group.door_count).toBe(2);
    expect(group.member_count).toBe(1);
    expect(group.fan_out).toBe(2);
  });

  it("lists the groups a person belongs to, including one that grants nothing", async () => {
    const withDoors = await createGroup('Has doors');
    const empty = await createGroup('Empty group');
    await request(app).put(`/api/policies/groups/${withDoors}/doors`).set('Cookie', cookie)
      .send({ doors: [{ door_id: mainDoorId }, { door_id: sideDoorId }] });
    await request(app).post('/api/policies/assignments').set('Cookie', cookie)
      .send({ person_id: personId, group_id: withDoors });
    await request(app).post('/api/policies/assignments').set('Cookie', cookie)
      .send({ person_id: personId, group_id: empty });

    const res = await request(app).get(`/api/people/${personId}/groups`)
      .set('Cookie', cookie).expect(200);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.find((g: any) => g.id === withDoors).door_count).toBe(2);
    // The reason this endpoint exists rather than deriving membership from the
    // effective-access rows: a group with no doors produces no rows there, and
    // the person is still in it.
    expect(res.body.data.find((g: any) => g.id === empty).door_count).toBe(0);
  });

  it('drops a person from the list once they are unassigned', async () => {
    const groupId = await createGroup('Temporary');
    await request(app).put(`/api/policies/groups/${groupId}/doors`).set('Cookie', cookie)
      .send({ doors: [{ door_id: mainDoorId }] });
    await request(app).post('/api/policies/assignments').set('Cookie', cookie)
      .send({ person_id: personId, group_id: groupId });

    // 202: the membership row is gone immediately, the chain revocation is queued.
    await request(app).delete(`/api/policies/assignments/${personId}/${groupId}`)
      .set('Cookie', cookie).expect(202);

    const res = await request(app).get(`/api/people/${personId}/groups`).set('Cookie', cookie);
    expect(res.body.data).toHaveLength(0);
  });

  it('queues every policy for revocation when a group is deleted', async () => {
    const groupId = await createGroup();
    await request(app).put(`/api/policies/groups/${groupId}/doors`).set('Cookie', cookie)
      .send({ doors: [{ door_id: mainDoorId }, { door_id: sideDoorId }] });
    await request(app).post('/api/policies/assignments').set('Cookie', cookie)
      .send({ person_id: personId, group_id: groupId });

    const res = await request(app).delete(`/api/policies/groups/${groupId}`).set('Cookie', cookie);
    expect(res.body.data.revoking).toBe(2);
    const rows = await db('access_policy_mirror').where({ person_id: personId });
    expect(rows.every((r) => r.sync_status === 'revoking')).toBe(true);
  });

  // ── schedules and the on-chain commitment ────────────────────────────────

  it('commits a schedule hash on the mirror row', async () => {
    const schedule = await request(app).post('/api/policies/schedules').set('Cookie', cookie)
      .send({
        name: 'Office hours', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        start_minute: 540, end_minute: 1020, timezone: 'Europe/Zagreb',
      });

    await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: mainDoorId, schedule_id: schedule.body.data.id });

    const row = await db('access_policy_mirror').where({ person_id: personId }).first();
    expect(row.schedule_hash).toBe(scheduleService.scheduleHash(schedule.body.data));
    expect(row.schedule_hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('hashes 24/7 access to the zero commitment', async () => {
    await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: mainDoorId });
    const row = await db('access_policy_mirror').where({ person_id: personId }).first();
    expect(row.schedule_hash).toBe(`0x${'0'.repeat(64)}`);
  });

  // ── effective access and its inverse ──────────────────────────────────────

  it('reports effective access with provenance', async () => {
    const groupId = await createGroup('Engineering');
    await request(app).put(`/api/policies/groups/${groupId}/doors`).set('Cookie', cookie)
      .send({ doors: [{ door_id: mainDoorId }] });
    await request(app).post('/api/policies/assignments').set('Cookie', cookie)
      .send({ person_id: personId, group_id: groupId });
    await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: sideDoorId });

    const res = await request(app)
      .get(`/api/people/${personId}/effective-access`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    const bySource = Object.fromEntries(res.body.data.map((r: any) => [r.door_code, r.source_name]));
    // "Ana can open the server room" is useless; "via the Engineering group" is
    // actionable, because it says what to change.
    expect(bySource['MAIN-01']).toBe('Engineering');
    expect(bySource['SIDE-02']).toBe('direct grant');
  });

  it('answers who can open a door', async () => {
    await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: mainDoorId });

    const res = await request(app)
      .get(`/api/doors/${mainDoorId}/who-has-access`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].full_name).toBe('Ana Horvat');
    expect(res.body.data[0].source_name).toBe('direct grant');
  });

  it('does not report a pending grant as open now', async () => {
    await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: mainDoorId });
    const res = await request(app)
      .get(`/api/people/${personId}/effective-access`).set('Cookie', cookie);
    // Nothing is on chain yet, so nothing actually opens.
    expect(res.body.data[0].open_now).toBe(false);
    expect(res.body.data[0].sync_status).toBe('pending');
  });

  // ── lifecycle ────────────────────────────────────────────────────────────

  it('queues policy revocation when a person is offboarded', async () => {
    await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: mainDoorId });

    await request(app).post(`/api/people/${personId}/offboard`).set('Cookie', cookie).send({});

    const rows = await db('access_policy_mirror').where({ person_id: personId });
    expect(rows.every((r) => r.sync_status === 'revoking')).toBe(true);
  });

  it('queues policy revocation when a person is suspended', async () => {
    await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: mainDoorId });
    await request(app).post(`/api/people/${personId}/suspend`).set('Cookie', cookie).send({});
    const row = await db('access_policy_mirror').where({ person_id: personId }).first();
    expect(row.sync_status).toBe('revoking');
  });

  // ── sync health ──────────────────────────────────────────────────────────

  it('reports sync health for the dashboard', async () => {
    await request(app).post('/api/policies/grants').set('Cookie', cookie)
      .send({ person_id: personId, door_id: mainDoorId });

    const res = await request(app).get('/api/policies/health').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.pending).toBe(1);
    expect(res.body.data.synced).toBe(0);
    expect(res.body.data.chain.enabled).toBe(false);
    expect(res.body.data.drift.open).toBe(0);
  });

  it('skips sync and reconcile cleanly with no chain', async () => {
    const sync = await request(app).post('/api/policies/sync').set('Cookie', cookie);
    expect(sync.body.data.skipped).toBe(true);
    const rec = await request(app).post('/api/policies/reconcile').set('Cookie', cookie);
    expect(rec.body.data.skipped).toBe(true);
  });

  it('requires an operator session', async () => {
    expect((await request(app).get('/api/policies/groups')).status).toBe(401);
    expect((await request(app).post('/api/policies/grants').send({})).status).toBe(401);
  });
});
