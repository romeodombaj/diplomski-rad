import crypto from 'crypto';
import db from '../../db';
import speakeasy from 'speakeasy';
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
    const countRow = await base.clone().clearOrder().count('* as count').first();
    total = Number((countRow as any).count);
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
  await db('people').where({ id, building_id: buildingId }).update({ status: to, updated_at: now() });
  return getById(buildingId, id);
};

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
  | { ok: false; reason: 'invalid_token' | 'expired' | 'consumed' | 'did_taken' | 'wrong_status' }
  | {
      ok: true;
      person: Person;
      totp: { secret: string; period: number; digits: number };
      building: { id: number; name: string; contract_address: string };
      doors: { door_code: string; name: string }[];
    };

/**
 * Mobile → backend enrolment handshake. Trades a valid one-time token for the
 * TOTP secret, closing AUDIT.md F-02.
 *
 * NOTE: the on-chain DIDRegistry.registerDID() write is NOT performed here — the
 * backend has no chain client yet (see registerDidOnChain below). The DID is
 * recorded locally and will be picked up by reconciliation once the chain client
 * lands. Until then the mobile app's signature cannot be verified against an
 * on-chain public key.
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
  };
};

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

  return db('person_devices').where({ id: deviceId }).first();
};
