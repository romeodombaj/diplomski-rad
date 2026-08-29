/**
 * `door_code` had no uniqueness constraint of any kind — not globally, not per
 * building — and the door API never rejected duplicates. The access path
 * resolves a door by code, so two rows sharing one code inside a building make
 * "which door does MAIN-01 mean" genuinely ambiguous: the lookup takes whichever
 * the query planner returns first, and publishes the unlock to that row's
 * `mqtt_topic`. The wrong door opens.
 *
 * The access path now scopes its lookup to the person's buildings, which fixes
 * the cross-building collision. This closes the remaining within-building case
 * at the source, so the ambiguity cannot be created in the first place.
 *
 * Scoped to (building_id, door_code) rather than door_code alone: two different
 * buildings each calling their entrance MAIN-01 is legitimate, and the system
 * is explicitly multi-building.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const duplicates = await knex('doors')
    .select('building_id', 'door_code')
    .whereNull('deleted_at')
    .groupBy('building_id', 'door_code')
    .havingRaw('count(*) > 1')

  if (duplicates.length > 0) {
    // Refuse rather than guess. Picking a survivor would silently decide which
    // physical door a credential opens, which is not a migration's call.
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

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('doors', (table) => {
    table.dropUnique(['building_id', 'door_code'], 'doors_building_door_code_unique')
  })
}
