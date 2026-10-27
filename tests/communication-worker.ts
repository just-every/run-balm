import worker from './worker'
import type { Bindings } from '../src/auth.server'

/** A test-only boundary changes real D1 authority between a handler read and its guarded batch. */
export default { async fetch(request: Request, env: Bindings) {
  let pending = request.headers.get('x-synthetic-revoke')
  const db = new Proxy(env.DB, { get(target, key) {
    if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
      if (pending) {
        const email = pending; pending = null
        await target.prepare('UPDATE oa_operators SET version=version+1 WHERE email=?').bind(email).run()
      }
      return target.batch(statements)
    }
    const value = Reflect.get(target,key)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  return worker.fetch(request,{...env,DB:db})
} }
