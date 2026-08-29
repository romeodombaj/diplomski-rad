/**
 * End-to-end proof that the whole stack is actually wired together.
 *
 * Walks sigurnosni-sustav-biometrija.md §"Tijek autentifikacije" against a real
 * chain: enrol -> registerDID on-chain -> grant a policy on-chain -> the phone
 * signs -> the backend verifies against the ON-CHAIN public key -> policy and
 * revocation checks -> the event hash is written on-chain.
 *
 * Unlike the vitest suites, which run with the chain disabled, this one fails
 * if the contracts are unreachable — that is the point of it.
 *
 *   cd blockchain && npx hardhat node                        # terminal 1
 *   cd blockchain && npx hardhat run scripts/deploy.js --network localhost
 *   cd backend   && npx tsx scripts/verify-chain-e2e.ts      # terminal 2
 */
import { randomUUID } from 'crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { Wallet, ethers } from 'ethers';

const RPC = process.env.CHAIN_RPC_URL || 'http://127.0.0.1:8545';
process.env.CHAIN_RPC_URL = RPC;
process.env.CHAIN_NETWORK = process.env.CHAIN_NETWORK || 'localhost';
// hardhat account #0 — the deploy script's deployer, which holds every role.
process.env.CHAIN_BACKEND_PRIVATE_KEY =
  process.env.CHAIN_BACKEND_PRIVATE_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.NODE_ENV = 'test'; // in-memory sqlite, so this never touches dev data

const DOOR = 'MAIN-01';
let failures = 0;

const check = (label: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? `  — ${extra}` : ''}`);
  if (!ok) failures++;
};

async function main() {
  // Imported here, not at the top: the env vars above must be set before the
  // config module is first evaluated, and this file compiles to CJS (no
  // top-level await).
  const app = (await import('../src/app')).default;
  const db = (await import('../src/db')).default;
  const chain = await import('../src/services/chainService');
  const { config } = await import('../src/config/conifg');

  await db.migrate.latest();
  chain.init();

  console.log('\nchain');
  check('client initialises', chain.isEnabled(), JSON.stringify(chain.status().addresses));
  if (!chain.isEnabled()) {
    console.error('\nNo chain. Start `npx hardhat node` and run the deploy script first.');
    process.exit(1);
  }
  const addresses = chain.status().addresses!;

  const [buildingId] = await db('buildings').insert({
    name: 'HQ', address: 'A', contract_address: addresses.AccessPolicy, is_sandbox: false,
  });
  await db('doors').insert({
    building_id: buildingId, name: 'Main', door_code: DOOR, mqtt_topic: 'doors/main/cmd', active: true,
  });
  const userId = randomUUID();
  await db('users').insert({ id: userId, email: 'op@t.com', name: 'Op', role: 'admin', password_hash: 'x' });
  const cookie = `access_token=${jwt.sign(
    { userId, email: 'op@t.com', role: 'admin', buildingId, isSandbox: false },
    config.jwt.accessSecret, { expiresIn: '1h' },
  )}`;

  console.log('\nenrolment');
  const created = await request(app).post('/api/people').set('Cookie', cookie)
    .send({ full_name: 'Ana Horvat', employee_no: 'E-1' });
  const { person, invite } = created.body.data;
  check('operator issues an enrolment token', Boolean(invite?.token));

  const phone = Wallet.createRandom();
  const did = `did:ethr:sep:${phone.address}`;
  const claim = await request(app).post('/mobile/enroll/claim')
    .send({ token: invite.token, did, publicKey: phone.signingKey.publicKey, deviceInfo: { platform: 'ios' } });
  check('phone claims it', claim.status === 200, claim.body?.message ?? '');
  check('DID registered on-chain at enrolment', claim.body.data?.chain_registered === true);
  check('registry holds the DID', await chain.isRegistered(did));

  const onChainKey = await chain.getPublicKey(did);
  check('on-chain key resolves to the phone address',
    Boolean(onChainKey) && ethers.computeAddress(onChainKey!).toLowerCase() === phone.address.toLowerCase());

  const secret = claim.body.data.totp.secret;
  const sign = async (over: Record<string, any> = {}) => {
    const wallet: Wallet = over.wallet ?? phone;
    const doorCode = over.door_code ?? DOOR;
    const timestamp = over.timestamp ?? Math.floor(Date.now() / 1000);
    const nonce = randomUUID().replace(/-/g, '');
    const body: Record<string, unknown> = {
      did, door_code: doorCode, timestamp, nonce,
      signature: await wallet.signMessage(`${did}|${doorCode}|${timestamp}|${nonce}`),
      totp: speakeasy.totp({ secret, encoding: 'base32', digits: 6, step: 30 }),
      faceScore: 0.93, ...over,
    };
    delete body.wallet;
    return body;
  };

  const audit = new ethers.Contract(
    addresses.AuditLog,
    ['function getEventCount() view returns (uint256)',
     'function getEvents(uint256,uint256) view returns (tuple(string eventHash,string doorCode,uint256 timestamp)[])'],
    new ethers.JsonRpcProvider(RPC),
  );
  // The chain is append-only and the node may already hold events from an
  // earlier run, so compare against a baseline rather than against zero.
  const baseline = await audit.getEventCount();

  console.log('\naccess');
  let res = await request(app).post('/mobile/access').send(await sign());
  check('denied while no on-chain policy exists', res.body.data?.reason === 'not_authorized', res.body.data?.reason);

  await chain.grantAccess(did, DOOR, 0, 0);
  check('AccessPolicy grants the DID', await chain.hasAccess(did, DOOR));

  res = await request(app).post('/mobile/access').send(await sign());
  check('access granted end-to-end', res.body.data?.granted === true, res.body.data?.reason);
  check('decision was checked against the chain', res.body.data?.chain_checked === true);

  console.log('\naudit');
  // logEvent is fire-and-forget by design, so poll rather than assume.
  let count = baseline;
  for (let i = 0; i < 40 && count === baseline; i++) {
    count = await audit.getEventCount();
    if (count === baseline) await new Promise((r) => setTimeout(r, 150));
  }
  check('event hash written to the on-chain AuditLog', count > baseline, `+${count - baseline}`);
  if (count > baseline) {
    const [logged] = await audit.getEvents(Number(count) - 1, 1);
    const row = await db('access_events').where({ decision: 'granted' }).first();
    check('on-chain hash matches the local row', logged.eventHash === row.event_hash);
    check('on-chain entry names the door', logged.doorCode === DOOR);
    // The privacy claim: the chain holds a hash and a door code, nothing else.
    const onChain = `${logged.eventHash}|${logged.doorCode}`;
    check('no personal data on-chain — only a hash',
      !onChain.includes('Ana') && !onChain.includes(did) && !onChain.includes('E-1'));
  }

  console.log('\nattacks');
  res = await request(app).post('/mobile/access').send(await sign({ wallet: Wallet.createRandom() }));
  check('signature from another phone refused', res.body.data?.reason === 'invalid_signature', res.body.data?.reason);

  const replayBody = await sign();
  await request(app).post('/mobile/access').send(replayBody);
  res = await request(app).post('/mobile/access').send(replayBody);
  check('replayed request refused', res.body.data?.reason === 'replay', res.body.data?.reason);

  res = await request(app).post('/mobile/access').send(await sign({ faceScore: 0.2 }));
  check('low face score refused', res.body.data?.reason === 'face_below_threshold', res.body.data?.reason);

  res = await request(app).post('/mobile/totp/enroll').send({ did: 'did:x' });
  check('the old self-service enrolment route is gone', res.status === 404);

  console.log('\nrevocation');
  await request(app).post(`/api/people/${person.id}/offboard`).set('Cookie', cookie).send({});
  check('offboarding puts the DID on the on-chain revocation list', await chain.isRevoked(did));

  res = await request(app).post('/mobile/access').send(await sign());
  check('revoked DID is refused', res.body.data?.granted === false, res.body.data?.reason);

  // A revoked DID must not be re-bindable: revocation is permanent, so a
  // re-enrolment would consume the single-use token and mint a credential that
  // is denied at every door with no way back.
  const second = await request(app).post('/api/people').set('Cookie', cookie)
    .send({ full_name: 'Marko Marić', employee_no: 'E-2' });
  const reclaim = await request(app).post('/mobile/enroll/claim').send({
    token: second.body.data.invite.token,
    did,
    publicKey: phone.signingKey.publicKey,
  });
  check('a revoked DID cannot be re-enrolled', reclaim.status === 409,
    `${reclaim.status} ${reclaim.body?.message ?? ''}`);
  check('the refused re-enrolment left the token unspent',
    Boolean((await db('enrollment_tokens')
      .where({ person_id: second.body.data.person.id })
      .whereNull('consumed_at')
      .first())));

  // Revocation must be idempotent: revoking an already-revoked DID reports
  // success rather than failing on the contract's AlreadyRevoked revert.
  const third = await request(app).post('/api/people').set('Cookie', cookie)
    .send({ full_name: 'Iva Ivić', employee_no: 'E-3' });
  const thirdPhone = Wallet.createRandom();
  const thirdDid = `did:ethr:sep:${thirdPhone.address}`;
  await request(app).post('/mobile/enroll/claim').send({
    token: third.body.data.invite.token, did: thirdDid,
    publicKey: thirdPhone.signingKey.publicKey,
  });
  const devices = await db('person_devices').where({ did: thirdDid });
  await request(app)
    .post(`/api/people/${third.body.data.person.id}/devices/${devices[0].id}/revoke`)
    .set('Cookie', cookie).send({ reason: 'stolen' });
  check('stolen-phone revoke reaches the chain', await chain.isRevoked(thirdDid));
  // Device revocation nulls `people.did`, so the `did_taken` guard no longer
  // applies — this is the path where a revoked DID could actually be re-bound
  // and end up permanently denied with no operator-facing way back.
  const fourth = await request(app).post('/api/people').set('Cookie', cookie)
    .send({ full_name: 'Petar Perić', employee_no: 'E-4' });
  const rebind = await request(app).post('/mobile/enroll/claim').send({
    token: fourth.body.data.invite.token,
    did: thirdDid,
    publicKey: thirdPhone.signingKey.publicKey,
  });
  check('a DID revoked by device-revoke cannot be re-bound',
    rebind.status === 409 && /did_revoked/.test(rebind.body?.message ?? ''),
    `${rebind.status} ${rebind.body?.message ?? ''}`);

  const offboardAgain = await request(app)
    .post(`/api/people/${third.body.data.person.id}/offboard`)
    .set('Cookie', cookie).send({});
  check('re-revoking an already-revoked DID still succeeds', offboardAgain.status === 200,
    `${offboardAgain.status}`);

  await db.destroy();
  console.log(failures === 0
    ? '\n\x1b[32mALL CHECKS PASSED\x1b[0m\n'
    : `\n\x1b[31m${failures} CHECK(S) FAILED\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
