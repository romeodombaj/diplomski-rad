exports.up = async function (knex) {
  await knex.schema.alterTable('person_devices', (table) => {
    table.string('public_key').nullable()
  })

  await knex.schema.createTable('access_events', (table) => {
    table.text('id').primary()
    table.integer('building_id').nullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.integer('door_id').nullable().references('id').inTable('doors').onDelete('SET NULL')
    table.string('door_code').notNullable()
    table.text('person_id').nullable().references('id').inTable('people').onDelete('SET NULL')
    table.string('did').notNullable()

    table.string('decision').notNullable()
    table.string('reason').notNullable()

    table.float('face_score').nullable()
    table.boolean('signature_verified').notNullable().defaultTo(false)
    table.boolean('chain_checked').notNullable().defaultTo(false)

    table.string('event_hash').notNullable()
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

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('access_events')
  await knex.schema.alterTable('person_devices', (table) => {
    table.dropColumn('public_key')
  })
}
