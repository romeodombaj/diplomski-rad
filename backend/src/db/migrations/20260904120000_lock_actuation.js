/**
 * How to actually operate the lock at a door.
 *
 * Until now `mqttService.publishUnlock` posted one fixed JSON payload to the
 * door's `mqtt_topic`, which works for firmware written for this system and for
 * nothing else. A Tasmota plug wants `ON` on `cmnd/<name>/POWER`, a Shelly wants
 * `on` on `<id>/relay/0/command`, Zigbee2MQTT wants `{"state":"ON"}` on
 * `<name>/set`. The door cannot carry that, because it is a policy object and
 * the hardware is swappable — the *device* is where it belongs.
 *
 * So a lock device gains a profile plus overrides, and the door keeps its
 * `mqtt_topic` as the fallback for a door with no lock device registered.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('devices', (table) => {
    // Which dialect this lock speaks. Null for anything that is not a lock.
    //   native_json    — firmware written for this system (the current payload)
    //   tasmota        — cmnd/<address>/POWER, ON/OFF
    //   shelly         — <address>/relay/0/command, on/off
    //   esphome_switch — <address>/command, ON/OFF
    //   zigbee2mqtt    — <address>/set, {"state":"ON"}/{"state":"OFF"}
    //   custom         — command_topic + the two payloads below, verbatim
    table.string('lock_profile').nullable()

    // Set only when the derived topic is wrong for this install. Left null the
    // rest of the time so the profile stays the single source of the shape.
    table.string('command_topic').nullable()
    table.text('unlock_payload').nullable()
    table.text('lock_payload').nullable()

    // How long the lock stays released, for profiles that latch rather than
    // pulse. Null falls back to the broker-wide default.
    table.integer('hold_seconds').nullable()
  })

  // One lock per door.
  //
  // Two relays wired to one door is not a configuration, it is a mistake: the
  // access path has to pick one, and picking silently would mean an unlock that
  // opens whichever row sorted first. Partial so that unassigned locks (door_id
  // null) and the other device kinds are unaffected, and so a soft-deleted lock
  // does not keep the slot it no longer occupies.
  await knex.raw(`
    CREATE UNIQUE INDEX devices_one_lock_per_door_idx
    ON devices (door_id)
    WHERE kind = 'lock' AND door_id IS NOT NULL AND deleted_at IS NULL
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS devices_one_lock_per_door_idx')
  await knex.schema.alterTable('devices', (table) => {
    table.dropColumn('lock_profile')
    table.dropColumn('command_topic')
    table.dropColumn('unlock_payload')
    table.dropColumn('lock_payload')
    table.dropColumn('hold_seconds')
  })
}
