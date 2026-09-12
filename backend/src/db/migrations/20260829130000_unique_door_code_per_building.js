exports.up = async function (knex) {
  const duplicates = await knex('doors')
    .select('building_id', 'door_code')
    .whereNull('deleted_at')
    .groupBy('building_id', 'door_code')
    .havingRaw('count(*) > 1')

  if (duplicates.length > 0) {
    const list = duplicates.map((d) => `building ${d.building_id}: ${d.door_code}`).join(', ')
    throw new Error(
      `Cannot add the unique index: duplicate door codes exist (${list}). ` +
        'Rename or soft-delete the duplicates, then re-run the migration.',
    )
  }

  await knex.schema.alterTable('doors', (table) => {
    table.unique(['building_id', 'door_code'], 'doors_building_door_code_unique')
  })
}

exports.down = async function (knex) {
  await knex.schema.alterTable('doors', (table) => {
    table.dropUnique(['building_id', 'door_code'], 'doors_building_door_code_unique')
  })
}
