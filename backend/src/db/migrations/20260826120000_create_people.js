exports.up = async function (knex) {
  await knex.schema.createTable('people', (table) => {
    table.text('id').primary()
    table.integer('building_id').notNullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.string('full_name').notNullable()
    table.string('employee_no').nullable()
    table.string('email').nullable()
    table.string('phone').nullable()
    table.string('department').nullable()
    table.string('job_title').nullable()
    table.string('person_type').notNullable().defaultTo('employee')
    table.string('status').notNullable().defaultTo('invited')
    table.string('did').nullable().unique()
    table.dateTime('enrolled_at').nullable()
    table.date('employment_start').nullable()
    table.date('employment_end').nullable()
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()
    table.index('building_id', 'people_building_id_idx')
    table.index('status', 'people_status_idx')
    table.unique(['building_id', 'employee_no'], 'people_building_employee_no_unique')
  })

  await knex.schema.createTable('person_buildings', (table) => {
    table.increments('id').primary()
    table.text('person_id').notNullable().references('id').inTable('people').onDelete('CASCADE')
    table.integer('building_id').notNullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.timestamps(true, true)
    table.unique(['person_id', 'building_id'], 'person_buildings_person_building_unique')
  })

  await knex.schema.createTable('person_devices', (table) => {
    table.increments('id').primary()
    table.text('person_id').notNullable().references('id').inTable('people').onDelete('CASCADE')
    table.string('did').notNullable()
    table.string('platform').nullable()
    table.string('model').nullable()
    table.dateTime('enrolled_at').notNullable().defaultTo(knex.fn.now())
    table.dateTime('revoked_at').nullable()
    table.string('revocation_reason').nullable()
    table.timestamps(true, true)
    table.index('person_id', 'person_devices_person_id_idx')
    table.index('did', 'person_devices_did_idx')
  })

  await knex.schema.createTable('enrollment_tokens', (table) => {
    table.increments('id').primary()
    table.text('person_id').notNullable().references('id').inTable('people').onDelete('CASCADE')
    table.string('token_hash').notNullable().unique()
    table.dateTime('expires_at').notNullable()
    table.dateTime('consumed_at').nullable()
    table.text('created_by_user_id').nullable().references('id').inTable('users')
    table.timestamps(true, true)
    table.index('person_id', 'enrollment_tokens_person_id_idx')
  })

  await knex.schema.alterTable('totp_secrets', (table) => {
    table.text('person_id').nullable().references('id').inTable('people').onDelete('CASCADE')
  })
}

exports.down = async function (knex) {
  await knex.schema.alterTable('totp_secrets', (table) => {
    table.dropColumn('person_id')
  })
  await knex.schema.dropTableIfExists('enrollment_tokens')
  await knex.schema.dropTableIfExists('person_devices')
  await knex.schema.dropTableIfExists('person_buildings')
  await knex.schema.dropTableIfExists('people')
}
