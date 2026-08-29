import crypto from 'crypto';
import db from '../../db';
import speakeasy from 'speakeasy';
import logger from '../../lib/logger';
import * as chain from '../../services/chainService';
import type {
  Person,
  PersonDevice,
  CreatePersonDto,
  UpdatePersonDto,
  PersonSearchParams,
  PersonCursorPage,
  PersonStatus,
  EnrollmentInvite,
} from './person.types';

const ENROLLMENT_TTL_HOURS = 72;

const now = () => new Date().toISOString();

/** Tokens are stored hashed, for the same reason passwords are. */
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Legal status transitions. `suspended` revokes policies but keeps the DID valid
 * so the person can return without re-enrolling their face; `offboarded` retires
 * the identity itself and is terminal.
 */
const TRANSITIONS: Record<PersonStatus, PersonStatus[]> = {
  invited: ['enrolling', 'active', 'offboarded'],
  enrolling: ['active', 'invited', 'offboarded'],
  active: ['suspended', 'offboarded'],
  suspended: ['active', 'offboarded'],
  offboarded: [],
};

export const canTransition = (from: PersonStatus, to: PersonStatus) =>
  TRANSITIONS[from]?.includes(to) ?? false;

export const getAll = async (buildingId: number, params: PersonSearchParams): Promise<PersonCursorPage> => {
  const limit = Number(params.limit) || 20;
  const SORTABLE_COLS = new Set<string>([
    'id', 'full_name', 'employee_no', 'department', 'job_title',
    'person_type', 'status', 'enrolled_at', 'created_at', 'updated_at',
  ]);
  const sortCol = params.sort && SORTABLE_COLS.has(params.sort) ? params.sort : 'full_name';
  const sortDir = params.order === 'desc' ? 'desc' : 'asc';

  const base = db('people').where({ building_id: buildingId }).whereNull('deleted_at').orderBy(sortCol, sortDir);
  if (sortCol === 'id') {
    if (params.cursor) base.where('id', '>', String(params.cursor));
  } else {
    const pg = Number(params.page) || 1;
    base.offset((pg - 1) * limit);
  }

  // Offboarded people stay in the table for audit but would otherwise dominate
  // the list over time, so they are opt-in.
  if (params.include_offboarded !== 'true' && !params.status) base.whereNot('status', 'offboarded');

  if (params.status) base.where('status', params.status);
  if (params.person_type) base.where('person_type', params.person_type);
  if (params.department) base.where('department', params.department);
  if (params.no_did === 'true') base.whereNull('did');
  if (params.q) {
    const q = `%${params.q}%`;
    base.where((b) =>
      b.where('full_name', 'like', q)
        .orWhere('employee_no', 'like', q)
        .orWhere('email', 'like', q)
        .orWhere('department', 'like', q),
    );
  }
  if (params.created_at_from) base.where('created_at', '>=', params.created_at_from);
  if (params.created_at_to) base.where('created_at', '<=', params.created_at_to);
  if (params.updated_at_from) base.where('updated_at', '>=', params.updated_at_from);
  if (params.updated_at_to) base.where('updated_at', '<=', params.updated_at_to);

  const rows = await base.clone().limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = (hasMore ? rows.slice(0, limit) : rows) as Person[];
  const nextCursor = hasMore && sortCol === 'id' ? String(data[data.length - 1].id) : null;

  let total: number | undefined;
  if (params.count === 'true') {
    // Clear the paging the clone inherits — `count(*) … offset 20` returns no
    // rows, so this would throw on every page but the first.
    const countRow = await base
      .clone()
      .clearOrder()
      .clear('limit')
      .clear('offset')
      .count('* as count')
      .first();
    total = Number((countRow as any)?.count ?? 0);
  }

  return { data, nextCursor, hasMore, total };
};

export const getById = async (buildingId: number, id: string): Promise<Person | undefined> =>
  db('people').where({ id, building_id: buildingId }).whereNull('deleted_at').first();

export const getByDid = async (did: string): Promise<Person | undefined> =>
  db('people').where({ did }).whereNull('deleted_at').first();

export const create = async (buildingId: number, data: CreatePersonDto): Promise<Person> => {
  const id = crypto.randomUUID();
  await db('people').insert({
    ...data,
    id,
    building_id: buildingId,
    person_type: data.person_type ?? 'employee',
    status: 'invited',   // no DID yet; they become active by enrolling on their phone
  });
  return getById(buildingId, id) as Promise<Person>;
};

export const update = async (buildingId: number, id: string, data: UpdatePersonDto): Promise<Person | undefined> => {
  await db('people').where({ id, building_id: buildingId }).update({ ...data, updated_at: now() });
  return getById(buildingId, id);
};

export const remove = async (buildingId: number, id: string): Promise<void> => {
  await db('people').where({ id, building_id: buildingId }).whereNull('deleted_at').update({ deleted_at: now() });
};

export const setStatus = async (
  buildingId: number,
  id: string,
  to: PersonStatus,
): Promise<Person | undefined> => {
  const before = await getById(buildingId, id);
  await db('people').where({ id, building_id: buildingId }).update({ status: to, updated_at: now() });

  // Offboarding retires the identity itself, so the DID goes on the on-chain
  // revocation list — that is what makes "one click revokes access everywhere"
  // true without a central server to push the update. Suspension deliberately
  // does not: it revokes policies but keeps the DID valid so the person can
  // return without re-enrolling their face.
  if (to === 'offboarded' && before?.did) await revokeDidOnChain(before.did);

  return getById(buildingId, id);
};

/**
 * Put a DID on the on-chain revocation list.
 *
 * Deliberately does NOT pre-check `chain.isRevoked`: that read fails *closed*
 * and answers "revoked" when the RPC is unreachable, which is correct for the
 * access path but exactly backwards as a skip-the-write guard — a node restart
 * or a provider blip would silently skip the transaction and leave a stolen
 * phone valid at every other building. Instead always attempt the write and
 * treat the contract's AlreadyRevoked revert as the success it is.
 *
 * This awaits confirmation rather than firing and forgetting. Revocation is
 * rare, operator-initiated, and the whole point is that it is durable — an
 * operator who sees "revoked" must not be looking at a transaction that never
 * landed. The cost is that the request blocks for a block time (~12s on a
 * public network); the return value says whether it actually landed.
 */
async function revokeDidOnChain(did: string): Promise<boolean> {
  if (!chain.isEnabled()) return false;
  try {
    const tx = await chain.revokeDID(did);
    logger.info(`[chain] revokeDID ${did} tx=${tx}`);
    return true;
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (/AlreadyRevoked/i.test(message)) {
      logger.info(`[chain] revokeDID ${did}: already on the revocation list`);
      return true;
    }
    logger.error(`[chain] revokeDID ${did} FAILED — the DID is still valid on-chain: ${message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

/**
 * Issue a single-use enrolment token. Returns the raw token exactly once — only
 * its hash is persisted, so a lost token must be reissued rather than recovered.
 * Any outstanding token for this person is consumed first, so a reissue
 * invalidates the old QR code.
 */
export const issueEnrollment = async (
  buildingId: number,
  personId: string,
  operatorId?: string,
): Promise<EnrollmentInvite> => {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_HOURS * 3600 * 1000).toISOString();

  await db('enrollment_tokens')
    .where({ person_id: personId })
    .whereNull('consumed_at')
    .update({ consumed_at: now(), updated_at: now() });

  await db('enrollment_tokens').insert({
    person_id: personId,
    token_hash: hashToken(token),
    expires_at: expiresAt,
    created_by_user_id: operatorId ?? null,
  });

  return { token, expires_at: expiresAt, person_id: personId };
};

export const getActiveEnrollment = async (personId: string) =>
  db('enrollment_tokens')
    .where({ person_id: personId })
    .whereNull('consumed_at')
    .where('expires_at', '>', now())
    .orderBy('id', 'desc')
    .first();

export type ClaimResult =
  | { ok: false; reason: 'invalid_token' | 'expired' | 'consumed' | 'did_taken' | 'did_revoked' | 'wrong_status' }
  | {
      ok: true;
      person: Person;
      totp: { secret: string; period: number; digits: number };
      building: { id: number; name: string; contract_address: string };
      doors: { door_code: string; name: string }[];
      /** False when the DID exists only in this backend's database. */
      chain_registered: boolean;
    };

/**
 * Mobile → backend enrolment handshake. Trades a valid one-time token for the
 * TOTP secret, closing AUDIT.md F-02.
 *
 * The device's public key is now persisted and, when the chain is enabled,
 * written to DIDRegistry — so the access path can verify signatures against a
 * key no single backend operator controls. The chain write happens after the
 * local commit and is allowed to fail: a person whose phone enrolled but whose
 * registerDID transaction did not land is in a recoverable state
 * (`chain_registered` is false, reconciliation can retry), whereas rolling back
 * a consumed one-time token would strand them with a dead QR code.
 */
export const claimEnrollment = async (
  token: string,
  did: string,
  publicKey: string,
  deviceInfo?: { platform?: string; model?: string },
): Promise<ClaimResult> => {
  const row = await db('enrollment_tokens').where({ token_hash: hashToken(token) }).first();
  if (!row) return { ok: false, reason: 'invalid_token' };
  if (row.consumed_at) return { ok: false, reason: 'consumed' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  const person: Person | undefined = await db('people')
    .where({ id: row.person_id })
    .whereNull('deleted_at')
    .first();
  if (!person) return { ok: false, reason: 'invalid_token' };
  if (!canTransition(person.status, 'active')) return { ok: false, reason: 'wrong_status' };

  // A DID is globally unique; refuse to bind one that is already in use.
  const existing = await db('people').where({ did }).whereNot('id', person.id).first();
  if (existing) return { ok: false, reason: 'did_taken' };

  // Refuse a DID that is already on the on-chain revocation list. Revocation is
  // permanent — nothing calls restoreDID — so binding one would consume the
  // single-use token and mint a credential that is denied at every door with
  // `revoked_on_chain`, and the person would have no way back. A reset phone
  // mints a fresh keypair and therefore a fresh DID, so this only catches a
  // handset that kept its key through a revocation.
  if (await chain.isRevoked(did)) return { ok: false, reason: 'did_revoked' };

  const building = await db('buildings').where({ id: person.building_id }).first();

  const secret = speakeasy.generateSecret({ length: 20 }).base32;
  const period = 30;
  const digits = 6;

  await db.transaction(async (trx) => {
    await trx('enrollment_tokens').where({ id: row.id }).update({ consumed_at: now(), updated_at: now() });

    await trx('people').where({ id: person.id }).update({
      did,
      status: 'active',
      enrolled_at: now(),
      updated_at: now(),
    });

    await trx('person_devices').insert({
      person_id: person.id,
      did,
      public_key: publicKey,
      platform: deviceInfo?.platform ?? null,
      model: deviceInfo?.model ?? null,
    });

    await trx('totp_secrets').insert({
      building_id: person.building_id,
      person_id: person.id,
      did,
      secret,
      period,
      digits,
    });
  });

  const chainRegistered = await registerDidOnChain(did, publicKey);

  const doors = await db('doors')
    .where({ building_id: person.building_id, active: true })
    .whereNull('deleted_at')
    .select('door_code', 'name');

  const updated = (await db('people').where({ id: person.id }).first()) as Person;

  return {
    ok: true,
    person: updated,
    totp: { secret, period, digits },
    building: { id: building.id, name: building.name, contract_address: building.contract_address },
    doors,
    chain_registered: chainRegistered,
  };
};

/**
 * Bind the DID to its public key in the on-chain registry.
 * @returns whether the key is on-chain — false when the chain is off, already
 *          registered under a different key, or the transaction failed.
 */
async function registerDidOnChain(did: string, publicKey: string): Promise<boolean> {
  if (!chain.isEnabled()) return false;
  try {
    if (await chain.isRegistered(did)) {
      // registerDID reverts on re-registration by design — silently replacing a
      // key would let a compromised backend take over an existing identity.
      logger.warn(`[chain] DID ${did} already registered; leaving the existing key in place`);
      return true;
    }
    const tx = await chain.registerDID(did, publicKey);
    logger.info(`[chain] registerDID ${did} tx=${tx}`);
    return true;
  } catch (err) {
    logger.error(`[chain] registerDID ${did} failed: ${(err as Error).message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export const listDevices = async (personId: string): Promise<PersonDevice[]> =>
  db('person_devices').where({ person_id: personId }).orderBy('id', 'desc');

/**
 * Revoke one device (stolen phone). Distinct from offboarding: the person stays
 * employed and can enrol a replacement. If the revoked device held the person's
 * current DID, the person drops back to `invited` and needs a fresh enrolment.
 */
export const revokeDevice = async (
  buildingId: number,
  personId: string,
  deviceId: number,
  reason?: string,
): Promise<PersonDevice | undefined> => {
  const device = await db('person_devices').where({ id: deviceId, person_id: personId }).first();
  if (!device) return undefined;

  await db.transaction(async (trx) => {
    await trx('person_devices').where({ id: deviceId }).update({
      revoked_at: now(),
      revocation_reason: reason ?? null,
      updated_at: now(),
    });

    await trx('totp_secrets')
      .where({ person_id: personId, did: device.did })
      .whereNull('deleted_at')
      .update({ deleted_at: now(), updated_at: now() });

    const person = await trx('people').where({ id: personId, building_id: buildingId }).first();
    if (person?.did === device.did) {
      await trx('people').where({ id: personId }).update({
        did: null,
        status: person.status === 'offboarded' ? 'offboarded' : 'invited',
        enrolled_at: null,
        updated_at: now(),
      });
    }
  });

  // The stolen-phone path. The DID belonged to that handset, so it goes on the
  // chain's revocation list and every building's backend sees it on its next
  // read — including buildings this operator has no account on.
  await revokeDidOnChain(device.did);

  return db('person_devices').where({ id: deviceId }).first();
};
