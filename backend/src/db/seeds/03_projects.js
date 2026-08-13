const { randomUUID } = require('crypto');

/** @param {import('knex').Knex} knex */
exports.seed = async function (knex) {
  const tenantId = process.env.DEFAULT_TENANT_ID || '213e6988-e62d-47c5-9fe3-3a0331fa0eea';

  const existing = await knex('projects').where({ tenant_id: tenantId }).first();
  if (existing) return;

  const sandboxId = randomUUID();
  const liveId    = randomUUID();

  // insert sandbox first (live references it)
  await knex('projects').insert({ id: sandboxId, tenant_id: tenantId, name: 'Default', is_sandbox: true });
  await knex('projects').insert({ id: liveId,    tenant_id: tenantId, name: 'Default', is_sandbox: false, sandbox_project_id: sandboxId });

  console.log('Seeded default project (live + sandbox)');
};
