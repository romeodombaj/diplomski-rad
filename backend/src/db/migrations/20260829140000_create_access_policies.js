/**
 * The access-control authoring model, per specs/06_access_control.md section 2.
 *
 * The chain stores one flat (did, doorCode) pair per policy and nothing else —
 * no groups, no roles, no door sets, no recurring schedules. So it is the
 * enforcement and audit layer, not the authoring model and not the read model.
 * Those live here, and the backend compiles one into the other:
 *
 *   authoring intent        compiled artifact        enforcement
 *   access_group       ──▶  access_policy_mirror ──▶ AccessPolicy.sol
 *   access_group_door       one row per              one Policy per
 *   person_access_group     (person, door)           (did, doorCode)
 *
 * `access_policy_mirror` is deliberately NOT a cache that may be rebuilt on a
 * whim: it is the record of which authoring decision produced which on-chain
 * policy. Without it you cannot revoke a group, because you cannot tell which
 * of a person's forty policies came from which group.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  // Recurring windows. The chain holds a single contiguous [start, end], so a
  // weekly window is inexpressible there; it is committed to as a hash on the
  // policy and enforced here (option C in the spec).
  await knex.schema.createTable('access_schedules', (table) => {
    table.increments('id').primary()
    table.integer('building_id').notNullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.string('name').notNullable()
    table.string('rrule').notNullable()          // e.g. FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
    table.integer('start_minute').notNullable()  // 540 = 09:00, from local midnight
    table.integer('end_minute').notNullable()    // 1020 = 17:00
    table.string('timezone').notNullable().defaultTo('Europe/Zagreb')  // IANA
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()
    table.unique(['building_id', 'name'], 'access_schedules_building_name_unique')
  })

  await knex.schema.createTable('access_groups', (table) => {
    table.increments('id').primary()
    table.integer('building_id').notNullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.string('name').notNullable()
    table.text('description').nullable()
    table.boolean('is_default').notNullable().defaultTo(false)  // auto-applied to new people
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()
    table.unique(['building_id', 'name'], 'access_groups_building_name_unique')
  })

  await knex.schema.createTable('access_group_doors', (table) => {
    table.increments('id').primary()
    table.integer('group_id').notNullable().references('id').inTable('access_groups').onDelete('CASCADE')
    table.integer('door_id').notNullable().references('id').inTable('doors').onDelete('CASCADE')
    table.integer('schedule_id').nullable().references('id').inTable('access_schedules')  // null = 24/7
    table.timestamps(true, true)
    table.unique(['group_id', 'door_id'], 'access_group_doors_unique')
  })

  await knex.schema.createTable('person_access_groups', (table) => {
    table.increments('id').primary()
    table.text('person_id').notNullable().references('id').inTable('people').onDelete('CASCADE')
    table.integer('group_id').notNullable().references('id').inTable('access_groups').onDelete('CASCADE')
    table.text('granted_by_operator_id').nullable().references('id').inTable('users')
    table.dateTime('granted_at').notNullable().defaultTo(knex.fn.now())
    table.timestamps(true, true)
    table.unique(['person_id', 'group_id'], 'person_access_groups_unique')
  })

  // The compiled artifact, and the dashboard's read model. Carries direct
  // grants too (source='direct') — the one-off "give Ana the server room until
  // Friday" that should not create a group.
  await knex.schema.createTable('access_policy_mirror', (table) => {
    table.increments('id').primary()
    table.text('person_id').notNullable().references('id').inTable('people').onDelete('CASCADE')
    table.integer('door_id').notNullable().references('id').inTable('doors').onDelete('CASCADE')
    // Denormalised: these are what actually went on chain, and they must stay
    // readable after the person or door row is renamed or soft-deleted.
    table.string('did').notNullable()
    table.string('door_code').notNullable()

    table.string('source').notNullable()          // group | direct
    table.integer('source_group_id').nullable().references('id').inTable('access_groups').onDelete('SET NULL')
    table.integer('schedule_id').nullable().references('id').inTable('access_schedules')
    table.string('schedule_hash').nullable()      // keccak256 commitment written on chain

    table.string('chain_policy_id').nullable()    // "pol-N", null until confirmed
    table.string('chain_tx_hash').nullable()

    table.bigInteger('start_time').notNullable().defaultTo(0)
    table.bigInteger('end_time').notNullable().defaultTo(0)   // 0 = no expiry

    table.string('sync_status').notNullable().defaultTo('pending')  // pending|synced|failed|revoking|revoked
    table.text('sync_error').nullable()
    table.dateTime('last_synced_at').nullable()
    table.integer('attempts').notNullable().defaultTo(0)

    table.text('granted_by_operator_id').nullable().references('id').inTable('users')
    table.timestamps(true, true)

    table.index('person_id', 'apm_person_id_idx')
    table.index('door_id', 'apm_door_id_idx')
    table.index('sync_status', 'apm_sync_status_idx')
    table.index('did', 'apm_did_idx')

    // Idempotency key from spec section 5: a retried job must not double-grant.
    // A duplicate on-chain policy is not harmful for hasAccess, but it makes
    // revocation incomplete, and the mirror must never miss one.
    // source_group_id is null for direct grants, and SQLite treats NULLs as
    // distinct in a unique index, so direct grants are intentionally not
    // deduplicated here — re-granting one is an explicit operator action.
    table.unique(['person_id', 'door_id', 'source_group_id'], 'apm_person_door_group_unique')
  })

  // Drift detected by reconciliation. Kept as a table rather than a log line
  // because "granted on chain but never authored here" is the tampering signal
  // the whole system exists to surface, and it needs to survive a restart.
  await knex.schema.createTable('access_policy_drift', (table) => {
    table.increments('id').primary()
    table.integer('building_id').notNullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.string('kind').notNullable()            // unauthorised | missing_on_chain | mismatch
    table.string('severity').notNullable()        // high | medium
    table.string('did').nullable()
    table.string('door_code').nullable()
    table.string('chain_policy_id').nullable()
    table.integer('mirror_id').nullable()
    table.text('detail').nullable()
    table.dateTime('detected_at').notNullable().defaultTo(knex.fn.now())
    table.dateTime('resolved_at').nullable()
    table.timestamps(true, true)
    table.index('building_id', 'apd_building_id_idx')
    table.index('kind', 'apd_kind_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('access_policy_drift')
  await knex.schema.dropTableIfExists('access_policy_mirror')
  await knex.schema.dropTableIfExists('person_access_groups')
  await knex.schema.dropTableIfExists('access_group_doors')
  await knex.schema.dropTableIfExists('access_groups')
  await knex.schema.dropTableIfExists('access_schedules')
}
