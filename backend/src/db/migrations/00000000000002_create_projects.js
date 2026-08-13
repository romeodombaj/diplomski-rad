/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('projects', (table) => {
    table.text('id').primary();
    table.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name').notNullable();
    table.boolean('is_sandbox').notNullable().defaultTo(false);
    table.text('sandbox_project_id').nullable().references('id').inTable('projects');
    table.timestamps(true, true);
    table.timestamp('deleted_at').nullable();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('projects');
};
