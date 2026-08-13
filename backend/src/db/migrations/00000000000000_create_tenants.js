/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('tenants', (table) => {
    table.text('id').primary()
    table.string('name').notNullable()
    table.timestamps(true, true)
    table.timestamp('deleted_at').nullable()
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('tenants')
}
