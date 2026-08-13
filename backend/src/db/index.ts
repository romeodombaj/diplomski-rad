import knex from 'knex'
import knexConfig from './knexConfig'

const env = (process.env.NODE_ENV || 'development') as keyof typeof knexConfig
const db = knex(knexConfig[env])

export default db
