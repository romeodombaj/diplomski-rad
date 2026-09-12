const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'romeodombaj@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Romeodombaj1';

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
