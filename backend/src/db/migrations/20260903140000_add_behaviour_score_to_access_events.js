exports.up = async function (knex) {
  await knex.schema.alterTable('access_events', (table) => {
    table.float('anomaly_score').nullable()
    table.boolean('anomaly_flagged').nullable()
    table.string('anomaly_reason').nullable()
    table.text('anomaly_factors').nullable()
  })
}

exports.down = async function (knex) {
  await knex.schema.alterTable('access_events', (table) => {
    table.dropColumn('anomaly_score')
    table.dropColumn('anomaly_flagged')
    table.dropColumn('anomaly_reason')
    table.dropColumn('anomaly_factors')
  })
}
