/**
 * The access path had no event history: `/mobile/verify/totp` logged a line to
 * stdout and returned. That left the behaviour engine with nothing to train on,
 * the dashboard's audit page with no backing table, and the on-chain AuditLog
 * with nothing to hash. This migration adds the missing record.
 *
 * Also adds `person_devices.public_key`. Enrolment already accepted a publicKey
 * from the phone and threw it away, so signatures could never be checked.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('person_devices', (table) => {
    // Uncompressed secp256k1 point (0x04 || X || Y) as sent at enrolment. The
    // on-chain DIDRegistry is the authority; this is the local mirror used when
    // the chain client is disabled, and the source for the registerDID write.
    table.string('public_key').nullable()
  })

  await knex.schema.createTable('access_events', (table) => {
    table.text('id').primary()
    // Nullable: a request naming a door that exists in no building still gets a
    // row. Losing that denial would hide exactly the probing worth seeing.
    table.integer('building_id').nullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.integer('door_id').nullable().references('id').inTable('doors').onDelete('SET NULL')
    // Kept as a plain string alongside door_id: the request may name a door that
    // does not exist, and that denial is exactly the kind of event worth keeping.
    table.string('door_code').notNullable()
    table.text('person_id').nullable().references('id').inTable('people').onDelete('SET NULL')
    table.string('did').notNullable()

    table.string('decision').notNullable()          // granted | denied
    table.string('reason').notNullable()            // machine-readable denial cause; 'ok' when granted

    table.float('face_score').nullable()
    table.boolean('signature_verified').notNullable().defaultTo(false)
    table.boolean('chain_checked').notNullable().defaultTo(false)

    // keccak256 of the signed message — the same value written to the on-chain
    // AuditLog, so a dashboard row can be verified against the chain.
    table.string('event_hash').notNullable()
    // Replay guard: a signature is single-use. Unique across every event,
    // granted or denied, so a captured request cannot be replayed after a denial.
    table.string('signature').nullable().unique()
    table.string('chain_tx').nullable()

    table.dateTime('occurred_at').notNullable()
    table.timestamps(true, true)

    table.index('building_id', 'access_events_building_id_idx')
    table.index('did', 'access_events_did_idx')
    table.index('person_id', 'access_events_person_id_idx')
    table.index('occurred_at', 'access_events_occurred_at_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('access_events')
  await knex.schema.alterTable('person_devices', (table) => {
    table.dropColumn('public_key')
  })
}
