/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('totp_secrets', (table) => {
    table.increments('id').primary()
    table.text('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE')
    table.string('did').notNullable()
    table.string('secret').notNullable()
    table.integer('period').notNullable()
    table.integer('digits').notNullable()
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()
    table.index('project_id', 'totp_secrets_project_id_idx')
  })

}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('totp_secrets')
}
