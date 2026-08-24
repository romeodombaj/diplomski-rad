/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // Undocumented pre-existing table (referenced live in code, never had a migration) — clear it if present.
  await knex.schema.dropTableIfExists('user_projects')

  // Drop children before parents to respect FKs.
  await knex.schema.dropTableIfExists('totp_secrets')
  await knex.schema.dropTableIfExists('doors')
  await knex.schema.dropTableIfExists('buildings')
  await knex.schema.dropTableIfExists('users')
  await knex.schema.dropTableIfExists('projects')
  await knex.schema.dropTableIfExists('tenants')

  // Building absorbs Project's switchable/sandboxed-context role (and Tenant's
  // account-boundary role) on top of its existing physical-location fields.
  await knex.schema.createTable('buildings', (table) => {
    table.increments('id').primary()
    table.string('name').notNullable()
    table.text('address').notNullable()
    table.string('contract_address').notNullable()
    table.boolean('is_sandbox').notNullable().defaultTo(false)
    table.integer('sandbox_building_id').nullable().references('id').inTable('buildings')
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()
  })

  await knex.schema.createTable('users', (table) => {
    table.text('id').primary()
    table.string('email').notNullable().unique()
    table.string('password_hash').notNullable()
    table.string('name').notNullable()
    table.string('role').notNullable().defaultTo('user') // 'user' | 'admin' | 'owner' | 'superadmin'
    table.boolean('all_buildings').notNullable().defaultTo(false)
    table.integer('current_building_id').nullable().references('id').inTable('buildings')
    table.timestamps(true, true)
    table.timestamp('deleted_at').nullable()
  })

  // Properly migrated replacement for the old `user_projects` (which had no migration at all).
  await knex.schema.createTable('user_buildings', (table) => {
    table.increments('id').primary()
    table.text('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.integer('building_id').notNullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.timestamps(true, true)
    table.unique(['user_id', 'building_id'])
  })

  await knex.schema.createTable('doors', (table) => {
    table.increments('id').primary()
    // Was an unenforced plain integer column pointing at buildings.id — now a real, indexed FK.
    table.integer('building_id').notNullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.string('name').notNullable()
    table.string('door_code').notNullable()
    table.string('mqtt_topic').notNullable()
    table.boolean('active').defaultTo(false)
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()
    table.index('building_id', 'doors_building_id_idx')
  })

  await knex.schema.createTable('totp_secrets', (table) => {
    table.increments('id').primary()
    table.integer('building_id').notNullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.string('did').notNullable()
    table.string('secret').notNullable()
    table.integer('period').notNullable()
    table.integer('digits').notNullable()
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()
    table.index('building_id', 'totp_secrets_building_id_idx')
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  throw new Error(
    'This migration collapses Tenant+Project into Building and is intentionally irreversible ' +
      '(no production data existed to preserve at the time of the change).'
  )
}
