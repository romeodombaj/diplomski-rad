const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

/** @param {import('knex').Knex} knex */
exports.seed = async function (knex) {
  const tenantId = process.env.DEFAULT_TENANT_ID || '213e6988-e62d-47c5-9fe3-3a0331fa0eea';

  const existing = await knex('users').where({ email: 'admin@gtnet.hr', tenant_id: tenantId }).first();
  if (existing) return;

  await knex('users').insert({
    id: randomUUID(),
    tenant_id: tenantId,
    email: 'admin@gtnet.hr',
    password_hash: bcrypt.hashSync('gtnet123', 12),
    name: 'Admin User',
    role: 'superadmin',
  });

  console.log('Seeded superadmin user: admin@gtnet.hr / gtnet123');
};
