/**
 * Physical hardware at a door, as distinct from the door itself.
 *
 * A door is a policy object — a code, a building, who may open it. The things
 * that make it work are separate objects with their own lifecycle: a BLE beacon
 * broadcasting the door's identity, an indicator ring, a relay or smart plug
 * that actually opens the lock. One may be swapped without touching the door,
 * and a device may sit unattached in a drawer before it is assigned anywhere.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('devices', (table) => {
    table.increments('id').primary()
    table.integer('building_id').notNullable()
    table.string('name').notNullable()

    // What role it plays. Checked in the API rather than as a DB constraint,
    // so adding a kind later does not need a migration on SQLite.
    //   beacon    — broadcasts the door's identity over BLE
    //   indicator — LED ring or similar, shows proximity and grants
    //   lock      — relay or smart plug that releases the door
    //   other     — anything not yet worth its own kind
    table.string('kind').notNullable().defaultTo('other')

    // How to reach it: an MQTT topic for anything on the broker, otherwise a
    // hostname or IP. Free text because the two are not interchangeable and
    // forcing one shape would exclude the other.
    table.string('address').nullable()

    // The door this belongs to, or null while unassigned. SET NULL rather than
    // CASCADE: deleting a door should not destroy the record of hardware that
    // still physically exists and can be reassigned.
    table.integer('door_id').nullable().references('id').inTable('doors').onDelete('SET NULL')

    table.boolean('active').notNullable().defaultTo(true)
    table.text('notes').nullable()
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()

    table.index('building_id', 'devices_building_id_idx')
    table.index('door_id', 'devices_door_id_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('devices')
}
