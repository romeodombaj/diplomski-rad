/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('doors', (table) => {
    table.increments('id').primary()
    table.text('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE')
    table.integer('building_id').notNullable()
    table.string('name').notNullable()
    table.string('door_code').notNullable()
    table.string('mqtt_topic').notNullable()
    table.boolean('active').defaultTo(false)
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()
    table.index('project_id', 'doors_project_id_idx')
  })

}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('doors')
}
