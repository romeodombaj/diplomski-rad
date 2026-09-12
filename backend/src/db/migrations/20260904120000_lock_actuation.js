exports.up = async function (knex) {
  await knex.schema.alterTable('devices', (table) => {
    table.string('lock_profile').nullable()

    table.string('command_topic').nullable()
    table.text('unlock_payload').nullable()
    table.text('lock_payload').nullable()

    table.integer('hold_seconds').nullable()
  })

  await knex.raw(`
    CREATE UNIQUE INDEX devices_one_lock_per_door_idx
    ON devices (door_id)
    WHERE kind = 'lock' AND door_id IS NOT NULL AND deleted_at IS NULL
  `)
}

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
