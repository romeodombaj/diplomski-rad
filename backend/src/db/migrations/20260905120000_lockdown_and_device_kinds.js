exports.up = async function (knex) {
  await knex.schema.alterTable('doors', (table) => {
    table.boolean('locked_down').notNullable().defaultTo(false)
    table.dateTime('locked_down_at').nullable()
  })

  await knex.schema.alterTable('buildings', (table) => {
    table.dateTime('lockdown_at').nullable()
    table.string('lockdown_by').nullable()
  })

  await knex('devices').whereIn('kind', ['beacon', 'indicator']).update({ kind: 'proximity' })
  await knex('devices').whereNotIn('kind', ['proximity', 'lock']).update({ kind: 'proximity' })

  await knex.raw('DROP INDEX IF EXISTS devices_one_lock_per_door_idx')
  await knex.raw(`
    CREATE UNIQUE INDEX devices_one_per_kind_per_door_idx
    ON devices (door_id, kind)
    WHERE door_id IS NOT NULL AND deleted_at IS NULL
  `)
}

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
