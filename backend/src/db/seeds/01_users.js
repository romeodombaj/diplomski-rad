const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

/** @param {import('knex').Knex} knex */
exports.seed = async function (knex) {
  const existing = await knex('users').where({ email: 'admin@gtnet.hr' }).first();
  if (existing) return;

  await knex('users').insert({
    id: randomUUID(),
    email: 'admin@gtnet.hr',
    password_hash: bcrypt.hashSync('gtnet123', 12),
    name: 'Admin User',
    role: 'superadmin',
  });

  console.log('Seeded superadmin user: admin@gtnet.hr / gtnet123');
};
