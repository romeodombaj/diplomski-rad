const crypto = require('crypto')


const PERSON_ID = 'demo-0000-4000-8000-000000000001'
const DID = 'did:ethr:0xA11CE00000000000000000000000000000000001'

const WEEKS = 8

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
    signature: null,
    occurred_at: toUtc(occurredAt),
    anomaly_score: null,
    anomaly_flagged: null,
    anomaly_reason: null,
    anomaly_factors: null,
  }
}

exports.seed = async function (knex) {
  const existing = await knex('people').where({ id: PERSON_ID }).first()
  if (existing) return

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

  const isEntry = (code) => /MAIN|ENTRY|ENTRANCE|LOBBY|ULAZ|FRONT|GATE|RECEPTION/i.test(code)
  const entry = doors.find((d) => isEntry(d.door_code)) || doors[0]
  const rest = doors.filter((d) => d.id !== entry.id)

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

  const rand = rng(20260907)
  const rows = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let back = WEEKS * 7; back >= 1; back--) {
    const day = new Date(today.getTime() - back * 86_400_000)
    const weekday = day.getDay()
    if (weekday === 0 || weekday === 6) continue
    if (rand() < 0.06) continue

    const arrival = at(day, 8, 5 + Math.floor(rand() * 40))
    rows.push(event(building.id, entry, arrival, 'granted', 'ok'))

    const trips = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < trips && interior.length; i++) {
      const door = interior[Math.floor(rand() * interior.length)]
      const hour = 9 + Math.floor(rand() * 8)
      rows.push(event(building.id, door, at(day, hour, Math.floor(rand() * 60)), 'granted', 'ok'))
    }

    rows.push(
      event(building.id, entry, at(day, 16 + Math.floor(rand() * 2), 45 + Math.floor(rand() * 15)) , 'granted', 'ok'),
    )

    if (rand() < 0.04) {
      rows.push(event(building.id, entry, at(day, 8, 3), 'denied', 'totp_invalid'))
    }
  }

  const anomalies = [
    { daysAgo: 6, hour: 2, minute: 47, door: entry, decision: 'granted', reason: 'ok', wantWeekend: true },
    { daysAgo: 3, hour: 21, minute: 35, door: unfamiliar, decision: 'granted', reason: 'ok' },
    { daysAgo: 2, hour: 3, minute: 12, door: unfamiliar, decision: 'denied', reason: 'no_policy' },
  ]

  for (const a of anomalies) {
    let day = new Date(today.getTime() - a.daysAgo * 86_400_000)
    if (a.wantWeekend) {
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
