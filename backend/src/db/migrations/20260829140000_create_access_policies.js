exports.up = async function (knex) {
  await knex.schema.createTable('access_schedules', (table) => {
    table.increments('id').primary()
    table.integer('building_id').notNullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.string('name').notNullable()
    table.string('rrule').notNullable()
    table.integer('start_minute').notNullable()
    table.integer('end_minute').notNullable()
    table.string('timezone').notNullable().defaultTo('Europe/Zagreb')
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()
    table.unique(['building_id', 'name'], 'access_schedules_building_name_unique')
  })

  await knex.schema.createTable('access_groups', (table) => {
    table.increments('id').primary()
    table.integer('building_id').notNullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.string('name').notNullable()
    table.text('description').nullable()
    table.boolean('is_default').notNullable().defaultTo(false)
    table.timestamps(true, true)
    table.dateTime('deleted_at').nullable()
    table.unique(['building_id', 'name'], 'access_groups_building_name_unique')
  })

  await knex.schema.createTable('access_group_doors', (table) => {
    table.increments('id').primary()
    table.integer('group_id').notNullable().references('id').inTable('access_groups').onDelete('CASCADE')
    table.integer('door_id').notNullable().references('id').inTable('doors').onDelete('CASCADE')
    table.integer('schedule_id').nullable().references('id').inTable('access_schedules')
    table.timestamps(true, true)
    table.unique(['group_id', 'door_id'], 'access_group_doors_unique')
  })

  await knex.schema.createTable('person_access_groups', (table) => {
    table.increments('id').primary()
    table.text('person_id').notNullable().references('id').inTable('people').onDelete('CASCADE')
    table.integer('group_id').notNullable().references('id').inTable('access_groups').onDelete('CASCADE')
    table.text('granted_by_operator_id').nullable().references('id').inTable('users')
    table.dateTime('granted_at').notNullable().defaultTo(knex.fn.now())
    table.timestamps(true, true)
    table.unique(['person_id', 'group_id'], 'person_access_groups_unique')
  })

  await knex.schema.createTable('access_policy_mirror', (table) => {
    table.increments('id').primary()
    table.text('person_id').notNullable().references('id').inTable('people').onDelete('CASCADE')
    table.integer('door_id').notNullable().references('id').inTable('doors').onDelete('CASCADE')
    table.string('did').notNullable()
    table.string('door_code').notNullable()

    table.string('source').notNullable()
    table.integer('source_group_id').nullable().references('id').inTable('access_groups').onDelete('SET NULL')
    table.integer('schedule_id').nullable().references('id').inTable('access_schedules')
    table.string('schedule_hash').nullable()

    table.string('chain_policy_id').nullable()
    table.string('chain_tx_hash').nullable()

    table.bigInteger('start_time').notNullable().defaultTo(0)
    table.bigInteger('end_time').notNullable().defaultTo(0)

    table.string('sync_status').notNullable().defaultTo('pending')
    table.text('sync_error').nullable()
    table.dateTime('last_synced_at').nullable()
    table.integer('attempts').notNullable().defaultTo(0)

    table.text('granted_by_operator_id').nullable().references('id').inTable('users')
    table.timestamps(true, true)

    table.index('person_id', 'apm_person_id_idx')
    table.index('door_id', 'apm_door_id_idx')
    table.index('sync_status', 'apm_sync_status_idx')
    table.index('did', 'apm_did_idx')

    table.unique(['person_id', 'door_id', 'source_group_id'], 'apm_person_door_group_unique')
  })

  await knex.schema.createTable('access_policy_drift', (table) => {
    table.increments('id').primary()
    table.integer('building_id').notNullable().references('id').inTable('buildings').onDelete('CASCADE')
    table.string('kind').notNullable()
    table.string('severity').notNullable()
    table.string('did').nullable()
    table.string('door_code').nullable()
    table.string('chain_policy_id').nullable()
    table.integer('mirror_id').nullable()
    table.text('detail').nullable()
    table.dateTime('detected_at').notNullable().defaultTo(knex.fn.now())
    table.dateTime('resolved_at').nullable()
    table.timestamps(true, true)
    table.index('building_id', 'apd_building_id_idx')
    table.index('kind', 'apd_kind_idx')
  })
}

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('access_policy_drift')
  await knex.schema.dropTableIfExists('access_policy_mirror')
  await knex.schema.dropTableIfExists('person_access_groups')
  await knex.schema.dropTableIfExists('access_group_doors')
  await knex.schema.dropTableIfExists('access_groups')
  await knex.schema.dropTableIfExists('access_schedules')
}
