import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { clinic } from './clinic.mjs'

// A small clinic on Workers Free shares 5,000,000 D1 rows read a day across all its tools, and the minute
// cron runs 1,440 times a day. What one run reads must not grow with the invoices, payments or visits
// already stored. Rows read are workerd's own D1 meters.
const hour = 3600_000, day = 24 * hour
const iso = t => new Date(t).toISOString()
const sizes = { invoices: Number(process.env.BALM_D1_INVOICES ?? 240), future: Number(process.env.BALM_D1_FUTURE ?? 120) }
const ceilings = { cronRead: 400, cronWritten: 20, firstOfDayRead: 15_000, firstOfDayWritten: 100 }

async function insert(db, table, rows) {
  const columns = Object.keys(rows[0]), sql = `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`
  for (let i = 0; i < rows.length; i += 80) await db.batch(rows.slice(i, i + 80).map(r => db.prepare(sql).bind(...columns.map(c => r[c]))))
}

/** Approved invoices (nine in ten fully paid), future bookings, an aged unpaid backlog and plenty of stopped history. */
async function seed(h, { service, practitioners: [priya] }, { from, invoices, future, backlog = 24 }) {
  const now = Date.now(), db = h.db
  if (!from) await insert(db, 'bm_clients', Array.from({ length: 200 }, (_, i) => ({ id: 'c' + i, first_name: 'Pat', last_name: 'Client' + i, email: `c${i}@client.example`, created_at: iso(now), created_via: 'staff' })))
  const base = from ?? 0, visit = (id, i, start, status) => ({ id, client_id: 'c' + (i % 200), practitioner_id: priya.id, service_id: service.id, start_at: iso(start), end_at: iso(start + 45 * 60_000), status, booked_via: 'staff', created_at: iso(now), created_by: 'seed' })
  const past = Array.from({ length: invoices + backlog }, (_, i) => visit('ap' + (base + i), i, i < invoices ? now - (1 + i * 3) * hour : now - (100 + i) * day, 'attended'))
  await insert(db, 'bm_appointments', past)
  await insert(db, 'bm_invoices', past.map((a, i) => ({ id: 'inv' + (base + i), appointment_id: a.id, client_id: a.client_id, number: base + i + 1, status: 'approved', amount_cents: 9500, snapshot: JSON.stringify({ serviceDate: 'Mon, Jan 5, 2026, 9:00 AM', service: { name: service.name } }), prepared_by: 'seed', prepared_role: 'owner', prepared_at: a.start_at, approved_by: 'seed', approved_at: a.end_at })))
  await insert(db, 'bm_payments', past.flatMap((a, i) => i < invoices && i % 10 !== 0 ? [{ id: 'pay' + (base + i), invoice_id: 'inv' + (base + i), amount_cents: 9500, reference: 'seed:' + (base + i), recorded_by: 'seed', recorded_at: a.end_at }] : []))
  if (future && !from) await insert(db, 'bm_appointments', Array.from({ length: future }, (_, i) => visit('af' + i, i, now + (1 + i * 3) * hour, 'booked')))
  if (from) return
  await insert(db, 'bm_balance_reminders', Array.from({ length: 48 }, (_, i) => ({ id: 'br' + i, client_id: 'c' + i, every_days: 14, next_on: iso(now + 5 * day).slice(0, 10), consent_evidence: 'seed', consented_by: 'seed', consented_on: '2026-01-01', status: i < 8 ? 'active' : 'paid', created_by: 'seed', created_at: iso(now) })))
  await insert(db, 'bm_balance_notices', Array.from({ length: 120 }, (_, i) => ({ id: 'bn' + i, reminder_id: 'br' + (i % 48), due_on: '2026-02-' + String(1 + i % 28).padStart(2, '0') + '-' + i, balance_cents: 9500, status: 'sent', reserved_at: iso(now - 20 * day) })))
  await insert(db, 'bm_statement_preferences', Array.from({ length: 100 }, (_, i) => ({ client_id: 'c' + i, channel: 'email', address: '', hold: 1, consent_evidence: 'seed', recorded_by: 'seed', recorded_at: iso(now) })))
  await insert(db, 'bm_followups', Array.from({ length: 100 }, (_, i) => ({ id: 'f' + i, client_id: 'c' + i, kind: 'welcome', consent_by: 'seed', consent_at: iso(now), consent_record: 'seed', enrolled_at: iso(now), state: 'stopped' })))
}

async function measure(h, action) {
  await h.send('/__d1_meter?reset=1')
  const result = await action()
  const report = (await h.send('/__d1_meter')).value
  assert.equal(report.unmetered, 0, 'every statement reports workerd row counts')
  return { ...report, result }
}
const tick = h => async at => assert.equal((await (await h.mf.getWorker()).scheduled({ scheduledTime: at, cron: '* * * * *' })).outcome, 'ok', 'the scheduled run completes')

test('D1-001: a minute of Cron costs the same rows however much history the clinic holds', { timeout: 300_000 }, async () => {
  const h = await harness({ entry: 'tests/d1-meter-worker.ts' })
  try {
    await h.finishSetup()
    const setup = await clinic(h)
    await seed(h, setup, { invoices: sizes.invoices, future: sizes.future })
    const run = tick(h)
    // The first runs settle the one-off work: reminders for the coming day and the first aging pass.
    await run(Date.now()); await run(Date.now())
    const page = () => h.send('/api/balm/state', undefined, h.owner)
    // The day's first run also does the once-a-day sweeps: the aged-account queue and every reminder's paid check.
    const firstOfDay = async () => { await h.db.prepare('DELETE FROM bm_job_runs').run(); return measure(h, () => run(Date.now())) }
    const first = { cron: await measure(h, () => run(Date.now())), day: await firstOfDay(), state: process.env.BALM_D1_REPORT ? await measure(h, page) : undefined }
    // Four times the invoices, all settled: a minute must read what it read before.
    await seed(h, setup, { from: sizes.invoices + 1000, invoices: sizes.invoices * 3, future: 0, backlog: 0 })
    await firstOfDay()
    const grown = { cron: await measure(h, () => run(Date.now())), day: await firstOfDay(), state: process.env.BALM_D1_REPORT ? await measure(h, page) : undefined }
    if (process.env.BALM_D1_REPORT) {
      for (const [name, r] of [['cron@' + sizes.invoices, first.cron], ['cron@x4', grown.cron], ['first-of-day@' + sizes.invoices, first.day], ['first-of-day@x4', grown.day], ['state@' + sizes.invoices, first.state], ['state@x4', grown.state]])
        console.log(`${name}: ${r.read} rows read, ${r.written} written, ${r.statements} statements\n` + r.queries.slice(0, Number(process.env.BALM_D1_REPORT)).map(q => `   ${q.read} x${q.calls} ${q.sql.slice(0, 110)}`).join('\n'))
    }
    assert.ok(first.cron.read <= ceilings.cronRead, `cron read ${first.cron.read} rows`)
    assert.ok(first.cron.written <= ceilings.cronWritten, `cron wrote ${first.cron.written} rows`)
    assert.ok(grown.day.read <= ceilings.firstOfDayRead, `first run of the day read ${grown.day.read} rows`)
    assert.ok(first.day.written <= ceilings.firstOfDayWritten, `first run of the day wrote ${first.day.written} rows`)
    assert.ok(grown.cron.read <= first.cron.read + 20, `cron grew from ${first.cron.read} to ${grown.cron.read} rows with history`)
  } finally { await h.close() }
})
