/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('users', (table) => {
    table.text('id').primary();
    table.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('email').notNullable();
    table.string('password_hash').notNullable();
    table.string('name').notNullable();
    table.string('role').notNullable().defaultTo('user'); // 'user' | 'admin' | 'owner' | 'superadmin'
    table.boolean('all_projects').notNullable().defaultTo(false);
    table.timestamps(true, true);
    table.timestamp('deleted_at').nullable();
    table.unique(['tenant_id', 'email']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('users');
};
