const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

// The single operator account for this project. Overridable by env so a real
// deployment is not stuck with a credential committed to the repository.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'romeodombaj@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Romeodombaj1';

/** @param {import('knex').Knex} knex */
exports.seed = async function (knex) {
  const existing = await knex('users').where({ email: ADMIN_EMAIL }).first();
  if (existing) return;

  await knex('users').insert({
    id: randomUUID(),
    email: ADMIN_EMAIL,
    password_hash: bcrypt.hashSync(ADMIN_PASSWORD, 12),
    name: 'Admin User',
    role: 'superadmin',
  });

  console.log(`Seeded superadmin user: ${ADMIN_EMAIL}`);
};
