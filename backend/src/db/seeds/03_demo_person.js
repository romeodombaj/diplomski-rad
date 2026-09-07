const crypto = require('crypto')

/**
 * One fully-populated person with enough history to demonstrate the behaviour
 * engine.
 *
 * The engine needs a baseline before a score means anything — twenty events is
 * its own floor, and a model fitted near that floor calls almost everything
 * unusual. A demo therefore cannot start from an empty database and click a few
 * doors: it needs weeks of ordinary comings and goings for the unusual ones to
 * stand against. That is what this generates.
 *
 * What it deliberately does NOT do is invent scores. Every row here is written
 * with `anomaly_score` null; the numbers on the behaviour tab come from the
 * engine actually reading this history (see behavior.service `backfill`). A
 * seeded score would be a fabricated model output presented as a measurement,
 * which is exactly the claim this part of the thesis is making, so it has to be
 * the real one.
 *
 * Idempotent: keyed on a fixed person id, so re-running changes nothing.
 *
 * @param {import('knex').Knex} knex
 */

// Fixed so re-seeding is a no-op and the demo person keeps her id across
// rebuilds — anything derived from Date.now() would create a second copy.
const PERSON_ID = 'demo-0000-4000-8000-000000000001'
const DID = 'did:ethr:0xA11CE00000000000000000000000000000000001'

/** Weeks of ordinary history generated before the unusual entries. */
const WEEKS = 8

/**
 * Deterministic PRNG (mulberry32).
 *
 * Math.random would make every rebuild produce a different baseline, so a score
 * shown in the written work could not be reproduced from the seed that claims
 * to generate it.
 */
function rng(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const at = (day, hour, minute) => {
  const d = new Date(day)
  d.setHours(hour, minute, Math.floor(minute * 1.7) % 60, 0)
  return d
}

/**
 * UTC, the same format the access path writes.
 *
 * The times above are built with setHours, so they are wall-clock times in
 * whatever zone this process runs in, and toISOString converts that instant to
 * UTC. Storing the wall-clock string instead would put naive timestamps in a
 * column that otherwise holds UTC, and the engine — which parses them back as
 * local time — would read the whole baseline shifted by the offset. Set TZ on
 * the backend and behaviour containers (docker-compose.yml) so "08:15" here,
 * in the database, and on the behaviour tab all mean the same moment.
 */
const toUtc = (d) => d.toISOString()

function event(buildingId, door, occurredAt, decision, reason) {
  const id = crypto.randomUUID()
  const message = `${DID}|${door.door_code}|${Math.floor(occurredAt.getTime() / 1000)}|${id}`
  return {
    id,
    building_id: buildingId,
    door_id: door.id,
    door_code: door.door_code,
    person_id: PERSON_ID,
    did: DID,
    decision,
    reason,
    face_score: decision === 'granted' ? 0.82 + (id.charCodeAt(0) % 12) / 100 : null,
    signature_verified: decision === 'granted',
    chain_checked: decision === 'granted',
    event_hash: '0x' + crypto.createHash('sha256').update(message).digest('hex'),
    // Null rather than a fabricated hex string: `signature` carries the unique
    // replay-guard index, and these events were never signed by a real key.
    signature: null,
    occurred_at: toUtc(occurredAt),
    // Left for the engine to fill in. See the note at the top of this file.
    anomaly_score: null,
    anomaly_flagged: null,
    anomaly_reason: null,
    anomaly_factors: null,
  }
}

exports.seed = async function (knex) {
  const existing = await knex('people').where({ id: PERSON_ID }).first()
  if (existing) return

  // The live building, not the sandbox — the sandbox is a scratch copy and a
  // demo baseline seeded there would not appear on the dashboard.
  const building = await knex('buildings').where({ is_sandbox: false }).orderBy('id').first()
  if (!building) {
    console.log('demo person: no live building, skipped')
    return
  }

  const doors = await knex('doors')
    .where({ building_id: building.id })
    .whereNull('deleted_at')
    .orderBy('id')
    .select('id', 'door_code', 'name')

  if (doors.length === 0) {
    console.log('demo person: no doors in the live building, skipped')
    return
  }

  // Same hint the engine's rules use for "did they pass an entrance first". A
  // history that never touches an entrance would train the model on a pattern
  // its own rules call suspicious.
  const isEntry = (code) => /MAIN|ENTRY|ENTRANCE|LOBBY|ULAZ|FRONT|GATE|RECEPTION/i.test(code)
  const entry = doors.find((d) => isEntry(d.door_code)) || doors[0]
  const rest = doors.filter((d) => d.id !== entry.id)

  // One door held back and never used in the ordinary history, so the
  // door-familiarity feature has a genuine 0.0 to report when she finally
  // appears at it. Reserving it is the whole point: if every door turns up in
  // the baseline, the "unfamiliar door" anomaly is not unfamiliar and the
  // engine is right to shrug at it.
  //
  // A building with fewer than two non-entrance doors has none to spare, so
  // the anomaly falls back to the entrance and rests on its hour alone.
  const unfamiliar = rest.length >= 2 ? rest[rest.length - 1] : entry
  const interior = rest.filter((d) => d.id !== unfamiliar.id).slice(0, 3)

  await knex('people').insert({
    id: PERSON_ID,
    building_id: building.id,
    full_name: 'Ana Kovač',
    employee_no: 'EMP-0042',
    email: 'ana.kovac@example.com',
    phone: '+385 91 234 5678',
    department: 'Engineering',
    job_title: 'Backend Engineer',
    person_type: 'employee',
    status: 'active',
    did: DID,
    enrolled_at: toUtc(new Date(Date.now() - WEEKS * 7 * 86_400_000)),
    employment_start: new Date(Date.now() - 420 * 86_400_000).toISOString().slice(0, 10),
  })

  // Membership, so the person record has something to show under Access even
  // before the chain has confirmed anything. The mirror rows below are what
  // actually grant the doors; they stay `pending` because a seed cannot write
  // to the chain, and pretending they were synced would misreport the one
  // thing the sync badge exists to report.
  const group = await knex('access_groups')
    .where({ building_id: building.id })
    .whereNull('deleted_at')
    .orderBy('id')
    .first()

  if (group) {
    await knex('person_access_groups')
      .insert({ person_id: PERSON_ID, group_id: group.id })
      .onConflict(['person_id', 'group_id'])
      .ignore()

    const groupDoors = await knex('access_group_doors as gd')
      .where('gd.group_id', group.id)
      .join('doors as d', 'd.id', 'gd.door_id')
      .whereNull('d.deleted_at')
      .select('d.id as door_id', 'd.door_code', 'gd.schedule_id')

    for (const door of groupDoors) {
      await knex('access_policy_mirror')
        .insert({
          person_id: PERSON_ID,
          door_id: door.door_id,
          did: DID,
          door_code: door.door_code,
          source: 'group',
          source_group_id: group.id,
          schedule_id: door.schedule_id,
          start_time: 0,
          end_time: 0,
          sync_status: 'pending',
        })
        .onConflict(['person_id', 'door_id', 'source_group_id'])
        .ignore()
    }
  }

  // ── The history ───────────────────────────────────────────────────────────
  const rand = rng(20260907)
  const rows = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let back = WEEKS * 7; back >= 1; back--) {
    const day = new Date(today.getTime() - back * 86_400_000)
    const weekday = day.getDay()
    if (weekday === 0 || weekday === 6) continue      // weekends off
    if (rand() < 0.06) continue                       // the occasional day away

    // Arrives 08:05–08:44. The spread matters: a baseline where every entry is
    // at exactly the same minute makes the smallest deviation look enormous.
    const arrival = at(day, 8, 5 + Math.floor(rand() * 40))
    rows.push(event(building.id, entry, arrival, 'granted', 'ok'))

    // One to three interior doors through the working day.
    const trips = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < trips && interior.length; i++) {
      const door = interior[Math.floor(rand() * interior.length)]
      const hour = 9 + Math.floor(rand() * 8)
      rows.push(event(building.id, door, at(day, hour, Math.floor(rand() * 60)), 'granted', 'ok'))
    }

    // Leaves 16:45–17:44, through the entrance again.
    rows.push(
      event(building.id, entry, at(day, 16 + Math.floor(rand() * 2), 45 + Math.floor(rand() * 15)) , 'granted', 'ok'),
    )

    // A mistyped code now and then. Without any denials in the baseline, the
    // first real one would read as far more remarkable than it is.
    if (rand() < 0.04) {
      rows.push(event(building.id, entry, at(day, 8, 3), 'denied', 'totp_invalid'))
    }
  }

  // ── The entries worth flagging ────────────────────────────────────────────
  // Deliberately last and deliberately few. Each one breaks a different column
  // of the feature vector, so the tab's per-factor breakdown has something
  // distinguishable to attribute: the hour, then the door, then both at once.
  const anomalies = [
    // Saturday, 02:47, at the entrance: the time is wrong and so is the day.
    { daysAgo: 6, hour: 2, minute: 47, door: entry, decision: 'granted', reason: 'ok', wantWeekend: true },
    // A door she has never opened, hours after she normally leaves. Both at an
    // ordinary hour and at an ordinary door the model shrugs, correctly — an
    // unfamiliar door on a Friday afternoon is one unusual thing among five
    // ordinary ones, and a detector that flagged it would flag everything.
    // Pairing the new door with the late hour is what makes it isolate.
    { daysAgo: 3, hour: 21, minute: 35, door: unfamiliar, decision: 'granted', reason: 'ok' },
    // Both at once, and refused — the shape of a credential being tried.
    { daysAgo: 2, hour: 3, minute: 12, door: unfamiliar, decision: 'denied', reason: 'no_policy' },
  ]

  for (const a of anomalies) {
    let day = new Date(today.getTime() - a.daysAgo * 86_400_000)
    if (a.wantWeekend) {
      // Walk back to the nearest Saturday so "weekend" is true of the row and
      // not merely of the comment.
      while (day.getDay() !== 6) day = new Date(day.getTime() - 86_400_000)
    }
    rows.push(event(building.id, a.door, at(day, a.hour, a.minute), a.decision, a.reason))
  }

  rows.sort((x, y) => x.occurred_at.localeCompare(y.occurred_at))
  await knex.batchInsert('access_events', rows, 200)

  console.log(
    `Seeded demo person Ana Kovač (${PERSON_ID}) with ${rows.length} access events ` +
      `over ${WEEKS} weeks at ${entry.door_code}` +
      (group ? `, member of "${group.name}"` : '') +
      '. Open her Behaviour tab to have the engine fit and score it.',
  )
}

exports.PERSON_ID = PERSON_ID
