/**
 * Drives the containerised stack the way a real operator and phone would, and
 * asserts the unlock actually reaches the MQTT broker.
 *
 * Where verify-chain-e2e.ts exercises the backend in-process against a chain,
 * this one talks only over the network to `docker compose up` — so it catches
 * the things that only break in a container: a missing seeds directory, a
 * contract manifest that never reached the shared volume, a broker hostname
 * that does not resolve.
 *
 *   docker compose up -d --build
 *   node backend/scripts/verify-stack.mjs
 *
 * Honour the same overrides compose does:
 *   BACKEND_PORT=5055 MQTT_PORT=1883 node backend/scripts/verify-stack.mjs
 */
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);
const { Wallet } = require('ethers');
const speakeasy = require('speakeasy');
const mqtt = require('mqtt');

const API = `http://127.0.0.1:${process.env.BACKEND_PORT || 5001}`;
const MQTT_URL = `mqtt://127.0.0.1:${process.env.MQTT_PORT || 1883}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'romeodombaj@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Romeodombaj1';

// Unique per run so repeated runs against a persistent volume do not collide.
const SUFFIX = randomUUID().slice(0, 6).toUpperCase();
const DOOR = `STACK-${SUFFIX}`;
const TOPIC = `doors/stack-${SUFFIX.toLowerCase()}/cmd`;

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? `  — ${extra}` : ''}`);
  if (!ok) failures++;
};

let cookie = '';
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    if (c.startsWith('access_token=')) cookie = c.split(';')[0];
  }
  let body = null;
  try { body = await res.json(); } catch { /* not every response has a body */ }
  return { status: res.status, body };
}

async function main() {
  // Subscribe first, so the assertion is about a real message on the wire
  // rather than the backend's own report of what it did.
  const seen = [];
  const client = mqtt.connect(MQTT_URL, { connectTimeout: 8000 });
  await new Promise((resolve, reject) => {
    client.on('connect', resolve);
    client.on('error', reject);
    setTimeout(() => reject(new Error(`no MQTT broker at ${MQTT_URL}`)), 9000);
  });
  client.subscribe(TOPIC);
  client.on('message', (topic, payload) =>
    seen.push({ topic, payload: JSON.parse(payload.toString()) }));

  console.log('\nstack');
  const health = await api('/api/health');
  check('backend answers /api/health', health.status === 200 && health.body?.data?.status === 'ok');
  check('broker accepted a subscriber', client.connected);

  console.log('\noperator');
  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  check('seeded admin can log in', login.status === 200, `${login.status}`);

  const status = await api('/api/health/status');
  check('chain is live inside the container', status.body?.data?.chain?.enabled === true,
    JSON.stringify(status.body?.data?.chain?.addresses ?? {}));
  check('mqtt is connected inside the container', status.body?.data?.mqtt?.connected === true);

  const door = await api('/api/doors', {
    method: 'POST',
    body: JSON.stringify({ name: `Stack door ${SUFFIX}`, door_code: DOOR, mqtt_topic: TOPIC, active: true }),
  });
  check('door created', door.status === 201 || door.status === 200, `${door.status}`);
  const doorId = door.body?.data?.id;

  console.log('\nenrolment');
  const person = await api('/api/people', {
    method: 'POST',
    body: JSON.stringify({ full_name: 'Stack Tester', employee_no: `E-${SUFFIX}` }),
  });
  const personId = person.body?.data?.person?.id;
  const token = person.body?.data?.invite?.token;
  check('person created with an enrolment token', Boolean(token));

  const phone = Wallet.createRandom();
  const did = `did:ethr:sep:${phone.address}`;
  const claim = await api('/mobile/enroll/claim', {
    method: 'POST',
    body: JSON.stringify({
      token, did, publicKey: phone.signingKey.publicKey, deviceInfo: { platform: 'ios' },
    }),
  });
  check('phone claims the token', claim.status === 200, claim.body?.message ?? '');
  check('DID registered on chain from inside the container',
    claim.body?.data?.chain_registered === true);
  const secret = claim.body?.data?.totp?.secret;

  const sign = async (over = {}) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID().replace(/-/g, '');
    return {
      did, door_code: DOOR, timestamp, nonce,
      signature: await phone.signMessage(`${did}|${DOOR}|${timestamp}|${nonce}`),
      totp: speakeasy.totp({ secret, encoding: 'base32', digits: 6, step: 30 }),
      faceScore: 0.93, ...over,
    };
  };

  console.log('\naccess');
  let res = await api('/mobile/access', { method: 'POST', body: JSON.stringify(await sign()) });
  check('denied before a policy exists', res.body?.data?.reason === 'not_authorized', res.body?.data?.reason);

  const grant = await api('/api/policies/grants', {
    method: 'POST', body: JSON.stringify({ person_id: personId, door_id: doorId }),
  });
  check('operator grants access through the API', grant.status === 202, `${grant.status}`);

  const synced = await api('/api/policies/sync', { method: 'POST' });
  check('sync writes the policy to the chain', synced.body?.data?.granted >= 1,
    JSON.stringify(synced.body?.data));

  res = await api('/mobile/access', { method: 'POST', body: JSON.stringify(await sign()) });
  check('access granted end to end', res.body?.data?.granted === true, res.body?.data?.reason);
  check('backend reports the door was unlocked', res.body?.data?.unlocked === true);

  console.log('\nmqtt');
  for (let i = 0; i < 30 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
  check('an unlock message actually reached the broker', seen.length >= 1, `${seen.length} message(s)`);
  if (seen.length) {
    const msg = seen[seen.length - 1];
    check("published to the door's own topic", msg.topic === TOPIC, msg.topic);
    check('payload names the action and door',
      msg.payload.action === 'unlock' && msg.payload.door_code === DOOR,
      JSON.stringify(msg.payload));
    check('payload carries the audit event id', Boolean(msg.payload.event_id));
  }

  console.log('\ndenials do not open the door');
  const before = seen.length;
  await api('/mobile/access', { method: 'POST', body: JSON.stringify(await sign({ faceScore: 0.1 })) });
  await new Promise((r) => setTimeout(r, 500));
  check('a failed face scan publishes nothing', seen.length === before, `${seen.length - before} extra`);

  console.log('\naudit');
  const logs = await api(`/api/audit-logs?count=true&door_code=${DOOR}`);
  check('access events recorded', (logs.body?.data?.total ?? 0) >= 2, `${logs.body?.data?.total}`);

  client.end(true);
  console.log(failures === 0 ? '\n\x1b[32mSTACK OK\x1b[0m\n' : `\n\x1b[31m${failures} CHECK(S) FAILED\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${err.message}\nIs the stack up?  docker compose up -d --build\n`);
  process.exit(1);
});
