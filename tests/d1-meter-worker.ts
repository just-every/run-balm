// The product worker with its D1 binding metered: every statement's rows_read and rows_written from workerd's real D1.
import { authResponse, runtimeBindings, type Bindings } from '../src/auth.server'
import { lobbyResponse } from '../src/base/lobby'
import { setupStateResponse } from '../src/base/setup-state'
import { identity } from '../src/identity'
import { balmResponse } from '../src/balm/http'
import { sendDueReminders } from '../src/balm/reminders/scheduler'
import { runDueBackup } from '../src/balm/backup'
import { progressWaitlistOffers } from '../src/balm/scheduling/patient-effects'

type Stat = { calls: number; read: number; written: number }
const queries = new Map<string, Stat>()
let unmetered = 0

function note(sql: string, meta: any) {
  const stat = queries.get(sql) ?? { calls: 0, read: 0, written: 0 }
  if (!Number.isSafeInteger(meta?.rows_read) || !Number.isSafeInteger(meta?.rows_written)) unmetered++
  else { stat.read += meta.rows_read; stat.written += meta.rows_written }
  stat.calls++
  queries.set(sql, stat)
}

function metered(db: D1Database): D1Database {
  const wrap = (statement: D1PreparedStatement, sql: string): any => ({
    __statement: statement, __sql: sql,
    bind: (...values: unknown[]) => wrap(statement.bind(...values), sql),
    run: async () => { const result = await statement.run(); note(sql, result.meta); return result },
    all: async () => { const result = await statement.all(); note(sql, result.meta); return result },
    // first() discards metadata; the first row of all() is the same answer.
    first: async (column?: string) => {
      const row = (await wrap(statement, sql).all()).results[0] as any
      return !row ? null : column === undefined ? row : row[column]
    },
  })
  return {
    prepare: (sql: string) => wrap(db.prepare(sql), sql.replace(/\s+/g, ' ').trim()),
    batch: async (statements: any[]) => {
      const results = await db.batch(statements.map(s => s.__statement))
      results.forEach((result, index) => note(statements[index].__sql, result.meta))
      return results
    },
  } as unknown as D1Database
}

const metrics = () => {
  const entries = [...queries.entries()].map(([sql, stat]) => ({ sql, ...stat }))
  return { read: entries.reduce((n, e) => n + e.read, 0), written: entries.reduce((n, e) => n + e.written, 0), statements: entries.reduce((n, e) => n + e.calls, 0), unmetered, queries: entries.sort((a, b) => b.read - a.read) }
}

export default {
  async scheduled(controller: ScheduledController, env: Bindings) {
    const meter = { ...env, DB: metered(env.DB) }
    await progressWaitlistOffers(meter); await sendDueReminders(meter, controller.scheduledTime); await runDueBackup(meter, controller.scheduledTime)
  },
  async fetch(request: Request, env: Bindings) {
    const url = new URL(request.url)
    if (url.pathname === '/__d1_meter') {
      const report = metrics()
      if (url.searchParams.has('reset')) { queries.clear(); unmetered = 0 }
      return Response.json(report)
    }
    const meter = { ...env, DB: metered(env.DB) }
    return await authResponse(request, meter) ?? await balmResponse(request, meter)
      ?? await setupStateResponse(request, runtimeBindings(meter))
      ?? await lobbyResponse(request, runtimeBindings(meter), identity)
      ?? new Response('Not found', { status: 404 })
  },
}
