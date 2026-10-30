import worker from './worker'
import type { Bindings } from '../src/auth.server'

/** A test-only boundary changes real D1 authority between a handler read and its guarded batch. */
export default { async fetch(request: Request, env: Bindings) {
  let pending = request.headers.get('x-synthetic-revoke')
  let session = request.headers.get('x-synthetic-session-revoke')
  let patient = request.headers.get('x-synthetic-patient-revoke')
  const db = new Proxy(env.DB, { get(target, key) {
    if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
      if (pending) {
        const email = pending; pending = null
        await target.prepare('UPDATE oa_operators SET version=version+1 WHERE email=?').bind(email).run()
      }
      if (session) {
        const email = session; session = null
        await target.prepare('UPDATE oa_sessions SET revoked_at=? WHERE operator_id IN (SELECT id FROM oa_operators WHERE email=?)').bind(Date.now(),email).run()
      }
      if (patient) {
        const clientId = patient; patient = null
        await target.prepare('UPDATE bm_portal_sessions SET revoked_at=? WHERE client_id=?').bind(new Date().toISOString(), clientId).run()
      }
      return target.batch(statements)
    }
    const value = Reflect.get(target,key)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  return worker.fetch(request,{...env,DB:db})
} }
