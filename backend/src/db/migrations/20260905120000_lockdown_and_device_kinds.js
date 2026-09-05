/**
 * Two changes that belong together, because both are about a door refusing to
 * open regardless of who is asking.
 *
 * 1. Device kinds collapse to the two roles this system actually has. A
 *    ReSpeaker is one physical object doing one job at a door — telling the
 *    phone it is here and showing how close it is — so splitting that into
 *    "beacon" and "indicator" made the operator answer a question about our
 *    internals rather than about their hardware.
 *
 * 2. Lockdown, per door and per building. This is deliberately NOT the same
 *    field as `doors.active`: inactive means "out of service, not installed,
 *    under repair", and is an administrative state. Lockdown means "the
 *    hardware is fine and I am refusing entry right now", and is a security
 *    action taken in a hurry. Collapsing them would make an emergency
 *    indistinguishable from a maintenance ticket in the audit trail.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('doors', (table) => {
    table.boolean('locked_down').notNullable().defaultTo(false)
    table.dateTime('locked_down_at').nullable()
  })

  await knex.schema.alterTable('buildings', (table) => {
    // Building-wide emergency lockdown. Stored as a timestamp rather than a
    // boolean so the audit trail can answer "since when", which is the first
    // question anyone asks afterwards. Null means not in lockdown.
    table.dateTime('lockdown_at').nullable()
    table.string('lockdown_by').nullable()
  })

  // Existing devices predate the collapse. A beacon and an indicator were both
  // the same board doing proximity work; anything else becomes a lock only if
  // it already was one.
  await knex('devices').whereIn('kind', ['beacon', 'indicator']).update({ kind: 'proximity' })
  await knex('devices').whereNotIn('kind', ['proximity', 'lock']).update({ kind: 'proximity' })

  // One device of each kind per door, generalising the lock-only rule.
  //
  // A door has one thing that senses you and one that lets you in, so the UI
  // shows two slots rather than a list. Two proximity devices on one door has
  // the same problem two locks had: the code would have to pick one, and
  // picking silently is how you get a door that reports the wrong distance
  // from whichever row happened to sort first.
  await knex.raw('DROP INDEX IF EXISTS devices_one_lock_per_door_idx')
  await knex.raw(`
    CREATE UNIQUE INDEX devices_one_per_kind_per_door_idx
    ON devices (door_id, kind)
    WHERE door_id IS NOT NULL AND deleted_at IS NULL
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS devices_one_per_kind_per_door_idx')
  await knex.raw(`
    CREATE UNIQUE INDEX devices_one_lock_per_door_idx
    ON devices (door_id)
    WHERE kind = 'lock' AND door_id IS NOT NULL AND deleted_at IS NULL
  `)
  await knex.schema.alterTable('doors', (table) => {
    table.dropColumn('locked_down')
    table.dropColumn('locked_down_at')
  })
  await knex.schema.alterTable('buildings', (table) => {
    table.dropColumn('lockdown_at')
    table.dropColumn('lockdown_by')
  })
}
