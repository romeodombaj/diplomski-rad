/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.text('current_project_id').nullable().references('id').inTable('projects');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('current_project_id');
  });
};
