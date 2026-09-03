import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { Wallet } from 'ethers';
import app from '../../app';
import db from '../../db';
import { config } from '../../config/conifg';
import * as behavior from '../../services/behaviorService';
import * as events from '../../services/eventBus';

/**
 * The behaviour engine, from the backend's side.
 *
 * Two claims are being pinned down. First that scoring is genuinely off the
 * critical path: a dead, slow or absent engine costs an alert and never an
 * entry, and every recorded outcome — granted *and* denied — is forwarded.
 * Second that a score is durable and explainable: it lands on the row it
 * belongs to together with the reasons behind it, so the dashboard can still
 * answer "why" long after the engine's in-memory window has rolled over.
 *
 * The engine itself is stubbed. Its own behaviour is tested in
 * behavior-engine/tests; what matters here is the contract between the two and
 * what happens when the far side does not hold up its end.
 */
describe('Behaviour engine integration', () => {
  const PHONE = Wallet.createRandom();
  const DID = `did:ethr:sep:${PHONE.address}`;
  const DOOR = 'MAIN-01';
  const ENGINE = 'http://engine.test';

  let buildingId: number;
  let otherBuildingId: number;
  let authCookie: string;
  let personId: string;
  let secret: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  /** What the engine would answer for one event. */
  const scoreBody = (over: Record<string, unknown> = {}) => ({
    event_id: 'x',
    anomaly_score: 0.87,
    is_anomaly: true,
    reason: 'Access at 03:12; usual hours are 08:25–17:27.',
    rule_hits: [],
    factors: [
      {
        factor: 'time_of_day', share: 0.7, delta: 0.09,
        value: '03:12', usual: '08:25–17:27',
        detail: 'Access at 03:12; usual hours are 08:25–17:27.',
      },
      {
        factor: 'door', share: 0.3, delta: 0.04,
        value: 'SERVER-03', usual: 'never used before',
        detail: 'Door SERVER-03: never used before.',
      },
    ],
    model_trained: true,
    events_in_baseline: 43,
    ...over,
  });

  const profileBody = (over: Record<string, unknown> = {}) => ({
    person_id: personId,
    model_trained: true,
    events_in_baseline: 43,
    min_events_to_fit: 20,
    synthetic: true,
    first_seen: '2026-08-03T08:45:00',
    last_seen: '2026-08-21T16:57:00',
    usual_from: '08:25',
    usual_to: '17:27',
    hour_histogram: new Array(24).fill(0),
    doors: [{ door_code: DOOR, count: 30, share: 0.7 }],
    weekend_share: 0,
    night_share: 0,
    median_gap_minutes: 488,
    events_per_day: 2.3,
    ...over,
  });

  /** Answer any engine call with a canned body; record what was asked. */
  const engineAnswers = (route: (url: string) => unknown) => {
    fetchMock.mockImplementation(async (input: any) => ({
      ok: true,
      status: 200,
      json: async () => route(String(input)),
      text: async () => '',
    }));
  };

  const calls = () => fetchMock.mock.calls.map((c) => String(c[0]));
  const bodyOf = (index: number) => JSON.parse(String((fetchMock.mock.calls[index][1] as any).body));

  const sign = async (over: Record<string, unknown> = {}) => {
    const doorCode = (over.door_code as string) ?? DOOR;
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID().replace(/-/g, '');
    return {
      did: DID,
      door_code: doorCode,
      timestamp,
      nonce,
      signature: await PHONE.signMessage(`${DID}|${doorCode}|${timestamp}|${nonce}`),
      totp: speakeasy.totp({ secret, encoding: 'base32', digits: 6, step: 30 }),
      faceScore: 0.92,
      ...over,
    };
  };

  const access = async (over: Record<string, unknown> = {}) =>
    request(app).post('/mobile/access').send(await sign(over));

  const enrol = async () => {
    const created = await request(app)
      .post('/api/people')
      .set('Cookie', authCookie)
      .send({ full_name: 'Ana Horvat', employee_no: `E-${randomUUID().slice(0, 6)}` });
    const { person, invite } = created.body.data;
    const claim = await request(app)
      .post('/mobile/enroll/claim')
      .send({ token: invite.token, did: DID, publicKey: PHONE.signingKey.publicKey, deviceInfo: { platform: 'ios' } });
    personId = person.id;
    secret = claim.body.data.totp.secret;
  };

  /** One already-recorded event, as the access path would have written it. */
  const recordEvent = async (over: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await db('access_events').insert({
      id,
      building_id: buildingId,
      door_id: null,
      door_code: DOOR,
      person_id: personId,
      did: DID,
      decision: 'granted',
      reason: 'ok',
      signature_verified: true,
      chain_checked: false,
      event_hash: `0x${randomUUID().replace(/-/g, '')}`,
      signature: randomUUID(),
      occurred_at: new Date().toISOString(),
      ...over,
    });
    return id;
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
      { building_id: buildingId, name: 'Server room', door_code: 'SERVER-03', mqtt_topic: 'd/srv', active: true },
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

    config.behavior.url = ENGINE;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    engineAnswers(() => scoreBody());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    config.behavior.url = '';
  });

  // ── forwarding, off the critical path ─────────────────────────────────────

  it('forwards a granted decision once the event is recorded', async () => {
    const res = await access();
    expect(res.body.data.granted).toBe(true);

    await vi.waitFor(() => expect(calls().some((u) => u.endsWith('/behavior/event'))).toBe(true));
    const sent = bodyOf(calls().findIndex((u) => u.endsWith('/behavior/event')));
    // The id is an access_events row, so an alert can be traced back to it.
    expect(sent.event_id).toBe(res.body.data.event_id);
    expect(sent).toMatchObject({ did: DID, door_code: DOOR, success: true, building_id: buildingId });
  });

  it('forwards denials too, because a denial is behaviour worth learning from', async () => {
    const res = await access({ totp: '000000' });
    expect(res.body.data.granted).toBe(false);

    await vi.waitFor(() => expect(calls().some((u) => u.endsWith('/behavior/event'))).toBe(true));
    const sent = bodyOf(calls().findIndex((u) => u.endsWith('/behavior/event')));
    expect(sent.success).toBe(false);
  });

  it('still opens the door when the engine is dead', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await access();

    expect(res.status).toBe(200);
    expect(res.body.data.granted).toBe(true);
    // Recorded, just unscored — and unscored is not the same as normal.
    const row = await db('access_events').where({ id: res.body.data.event_id }).first();
    expect(row.anomaly_score).toBeNull();
    expect(row.anomaly_flagged).toBeNull();
  });

  it('calls nothing at all when the engine is not configured', async () => {
    config.behavior.url = '';
    const res = await access();

    expect(res.body.data.granted).toBe(true);
    expect(calls().filter((u) => u.includes('/behavior/'))).toEqual([]);
  });

  // ── the score, and why it is what it is ───────────────────────────────────

  it('stores the score and its reasons on the event row', async () => {
    const id = await recordEvent();
    await behavior.score(
      {
        event_id: id, person_id: personId, did: DID, door_code: 'SERVER-03',
        building_id: buildingId, timestamp: new Date().toISOString(), success: true,
      },
      buildingId,
    );

    const row = await db('access_events').where({ id }).first();
    expect(row.anomaly_score).toBeCloseTo(0.87, 5);
    expect(Boolean(row.anomaly_flagged)).toBe(true);
    expect(row.anomaly_reason).toContain('03:12');
    // The breakdown outlives the engine's memory: it refits and rolls its
    // window, so asking again later would not reproduce this answer.
    expect(JSON.parse(row.anomaly_factors)[0].factor).toBe('time_of_day');
  });

  it('publishes an alert for a flagged event and stays quiet otherwise', async () => {
    const seen: string[] = [];
    const unsubscribe = events.subscribe((e) => seen.push(e.type));

    const flagged = await recordEvent();
    await behavior.score(
      { event_id: flagged, person_id: personId, did: DID, door_code: DOOR, building_id: buildingId, timestamp: new Date().toISOString(), success: true },
      buildingId,
    );

    engineAnswers(() => scoreBody({ is_anomaly: false, anomaly_score: 0.41 }));
    const normal = await recordEvent();
    await behavior.score(
      { event_id: normal, person_id: personId, did: DID, door_code: DOOR, building_id: buildingId, timestamp: new Date().toISOString(), success: true },
      buildingId,
    );

    unsubscribe();
    expect(seen).toEqual(['anomaly']);
    // The quiet one is still recorded — the tab shows a score for every event,
    // not only the alarming ones.
    expect((await db('access_events').where({ id: normal }).first()).anomaly_score).toBeCloseTo(0.41, 5);
  });

  // ── what the dashboard reads ──────────────────────────────────────────────

  it('serves the observed baseline and the model profile together', async () => {
    await recordEvent({ occurred_at: '2026-08-24T08:47:00.000Z' });
    const scored = await recordEvent({ occurred_at: '2026-08-25T03:12:00.000Z', door_code: 'SERVER-03' });
    await db('access_events').where({ id: scored }).update({
      anomaly_score: 0.87,
      anomaly_flagged: true,
      anomaly_reason: 'Access at 03:12; usual hours are 08:25–17:27.',
      anomaly_factors: JSON.stringify(scoreBody().factors),
    });
    engineAnswers(() => profileBody());

    const res = await request(app).get(`/api/people/${personId}/behavior`).set('Cookie', authCookie);
    expect(res.status).toBe(200);

    const body = res.body.data;
    expect(body.engine).toEqual({ enabled: true, reachable: true });
    expect(body.profile.synthetic).toBe(true);
    expect(body.observed.total).toBe(2);
    expect(body.observed.scored).toBe(1);
    expect(body.observed.byDoor.map((d: any) => d.door_code)).toContain('SERVER-03');
    // The tab leads with the newest score, and with why it is what it is.
    expect(body.latest.id).toBe(scored);
    expect(body.latest.factors[0].factor).toBe('time_of_day');
  });

  it('still answers with the observed history when the engine is unreachable', async () => {
    await recordEvent();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await request(app).get(`/api/people/${personId}/behavior`).set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.engine).toEqual({ enabled: true, reachable: false });
    expect(res.body.data.profile).toBeNull();
    // The evidence a score is measured against lives in access_events, so it
    // does not disappear with the microservice.
    expect(res.body.data.observed.total).toBe(1);
  });

  it('reports the engine as disabled rather than pretending it answered', async () => {
    config.behavior.url = '';
    await recordEvent();

    const res = await request(app).get(`/api/people/${personId}/behavior`).set('Cookie', authCookie);
    expect(res.body.data.engine).toEqual({ enabled: false, reachable: false });
    expect(res.body.data.observed.total).toBe(1);
  });

  it('will not serve another building\'s person', async () => {
    const [outsider] = await db('people').insert({
      id: randomUUID(), building_id: otherBuildingId, full_name: 'Outsider', status: 'active',
    }).returning('id');
    const id = typeof outsider === 'object' ? (outsider as any).id : outsider;

    const res = await request(app).get(`/api/people/${id}/behavior`).set('Cookie', authCookie);
    expect(res.status).toBe(404);
  });

  it('requires an operator session', async () => {
    const res = await request(app).get(`/api/people/${personId}/behavior`);
    expect(res.status).toBe(401);
  });

  // ── training and the cold start ───────────────────────────────────────────

  it('trains from the history the backend already holds', async () => {
    await recordEvent({ occurred_at: '2026-08-24T08:47:00.000Z' });
    await recordEvent({ occurred_at: '2026-08-24T17:10:00.000Z', decision: 'denied', reason: 'invalid_totp' });
    engineAnswers(() => ({ person_id: personId, events: 2, model_fitted: false, min_events_to_fit: 20 }));

    const res = await request(app).post(`/api/people/${personId}/behavior/train`).set('Cookie', authCookie);
    expect(res.status).toBe(200);

    const index = calls().findIndex((u) => u.includes('/behavior/train'));
    expect(calls()[index]).toContain(`person_id=${personId}`);
    const sent = bodyOf(index);
    expect(sent).toHaveLength(2);
    // Oldest first: the engine's gap feature is defined against the preceding
    // event, so the order it is trained in is not cosmetic.
    expect(Date.parse(sent[0].timestamp)).toBeLessThan(Date.parse(sent[1].timestamp));
    expect(sent[1].success).toBe(false);
  });

  it('seeds a synthetic baseline through the building\'s own doors', async () => {
    engineAnswers(() => ({ person_id: personId, events_generated: 43, model_fitted: true, synthetic: true }));

    const res = await request(app)
      .post(`/api/people/${personId}/behavior/seed`)
      .set('Cookie', authCookie)
      .send({ days: 21 });
    expect(res.status).toBe(200);

    const sent = bodyOf(calls().findIndex((u) => u.includes('/behavior/seed')));
    expect(sent).toMatchObject({ person_id: personId, days: 21, building_id: buildingId });
    expect(sent.entry_door).toBe(DOOR);
    expect(sent.interior_doors).toContain('SERVER-03');
  });

  it('forgets a person\'s model when they are offboarded', async () => {
    engineAnswers(() => ({ person_id: personId, forgotten: true }));
    await request(app).post(`/api/people/${personId}/offboard`).set('Cookie', authCookie).send({});

    // The model is fitted from nothing but this person's own history, so a
    // retired identity must not leave one behind on the engine's disk.
    expect(calls().some((u) => u.endsWith(`/behavior/${personId}`))).toBe(true);
  });

  it('refuses to train or seed with no engine configured', async () => {
    config.behavior.url = '';
    const train = await request(app).post(`/api/people/${personId}/behavior/train`).set('Cookie', authCookie);
    const seed = await request(app).post(`/api/people/${personId}/behavior/seed`).set('Cookie', authCookie);

    expect(train.status).toBe(503);
    expect(seed.status).toBe(503);
  });
});
