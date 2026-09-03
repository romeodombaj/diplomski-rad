/**
 * Where a behaviour score is kept.
 *
 * The engine holds a working window in memory and a fitted model on disk;
 * neither is a record of what it decided about a particular event. Putting the
 * score on the row it belongs to means an operator can still read "0.83,
 * because 03:12 is nowhere near your usual hours" a month later, from a
 * dashboard, with the engine switched off — and it keeps the audit trail and
 * its interpretation in one place rather than in two systems that can disagree.
 *
 * Every column is nullable, and null means "never scored" rather than "normal".
 * The engine is optional (BEHAVIOR_ENGINE_URL empty disables it) and runs off
 * the critical path, so most deployments will have rows with no score at all,
 * and reading those as clean would be exactly backwards.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('access_events', (table) => {
    // 0..1, higher is more unusual. 0.5 is the model's own boundary, not a
    // display convention — see behavior-engine/app/model.py.
    table.float('anomaly_score').nullable()
    // The engine's verdict, kept separately from the score: a deterministic
    // rule ("same identity in two buildings five minutes apart") flags without
    // the score having to be high, and a high score is not always a flag.
    table.boolean('anomaly_flagged').nullable()
    table.string('anomaly_reason').nullable()
    // The per-factor breakdown as JSON. Denormalised on purpose: it is written
    // once, read as a whole, and never queried by its contents — a table for it
    // would buy nothing and cost a join on every audit page.
    table.text('anomaly_factors').nullable()
  })
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('access_events', (table) => {
    table.dropColumn('anomaly_score')
    table.dropColumn('anomaly_flagged')
    table.dropColumn('anomaly_reason')
    table.dropColumn('anomaly_factors')
  })
}
