exports.up = async function (knex) {
  await knex.schema.createTable('devices', (table) => {
    table.increments('id').primary()
    table.integer('building_id').notNullable()
    table.string('name').notNullable()

    table.string('kind').notNullable().defaultTo('other')

    table.string('address').nullable()

    table.integer('door_id').nullable().references('id').inTable('doors').onDelete('SET NULL')

    table.boolean('active').notNullable().defaultTo(true)
    table.text('notes').nullable()
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()

    table.index('building_id', 'devices_building_id_idx')
    table.index('door_id', 'devices_door_id_idx')
  })
}

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('devices')
}
