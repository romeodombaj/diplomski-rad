/** @param {import('knex').Knex} knex */
exports.seed = async function (knex) {
  const existing = await knex('buildings').where({ name: 'Default' }).first();
  if (existing) return;

  // insert sandbox first (live references it)
  const [sandboxId] = await knex('buildings').insert({
    name: 'Default',
    address: 'TBD',
    contract_address: 'TBD',
    is_sandbox: true,
  });
  await knex('buildings').insert({
    name: 'Default',
    address: 'TBD',
    contract_address: 'TBD',
    is_sandbox: false,
    sandbox_building_id: sandboxId,
  });

  console.log('Seeded default building (live + sandbox)');
};
