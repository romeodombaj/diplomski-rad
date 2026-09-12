exports.up = async function (knex) {
  await knex.schema.createTable('buildings', (table) => {
    table.increments('id').primary()
    table.text('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE')
    table.string('name').notNullable()
    table.text('address').notNullable()
    table.string('contract_address').notNullable()
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()
    table.index('project_id', 'buildings_project_id_idx')
  })

}

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('buildings')
}
