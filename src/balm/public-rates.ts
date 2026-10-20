import type { Bindings } from '../auth.server'
import { commit, DomainError, guard, sha256, stmt } from './domain/model'

type PublicDoor = 'booking' | 'intake' | 'payment' | 'portal'
type PortalKind = 'signin' | 'confirm'
type Dimension = 'address' | 'email'

const WINDOW_MS = 15 * 60_000
const limits = {
  booking: { address: 30, email: 10 },
  intake: { address: 120, email: 60 },
  payment: { address: 120, email: 60 },
  portal: {
    signin: { address: 20, email: 5 },
    confirm: { address: 30, email: 5 },
  },
} as const

/** Each stage takes only its own allowance, before any domain or provider effects. */
async function take(env: Bindings, door: PublicDoor, dimension: Dimension, value: string, kind: PortalKind) {
  const window = Math.floor(Date.now() / WINDOW_MS)
  const limit = door === 'portal' ? limits.portal[kind][dimension] : limits[door][dimension]
  // Tuple encoding keeps door, purpose and dimension distinct without storing identifying data.
  const keyHash = await sha256(`${env.SESSION_SECRET}:public-rate:${JSON.stringify([door, door === 'portal' ? kind : '', dimension, value])}`)
  try {
    await commit(env.DB, null, [
      stmt(env.DB, 'DELETE FROM bm_portal_rates WHERE window<?', window - 1),
      stmt(env.DB, `INSERT INTO bm_portal_rates(key_hash,window,attempts) VALUES(?,?,1)
        ON CONFLICT(key_hash,window) DO UPDATE SET attempts=attempts+1 WHERE attempts<?`, keyHash, window, limit),
      guard(env.DB, 'changes()=1'),
    ])
    return true
  } catch (error) {
    if (error instanceof DomainError && error.status === 409) return false
    throw error
  }
}

/** Call before parsing a public request body. Local/proxied headers cannot select a fresh bucket. */
export function takeAddressRate(env: Bindings, request: Request, door: PublicDoor, kind: PortalKind = 'signin'): Promise<boolean> {
  const cf = (request as Request & { cf?: unknown }).cf
  const trustedEdge = env.AUTH_LOCAL !== 'true' && cf !== null && typeof cf === 'object'
  const address = trustedEdge ? request.headers.get('CF-Connecting-IP')?.trim() : undefined
  return take(env, door, 'address', address ? `edge:${address}` : 'installation', kind)
}

/** For private-link doors, email must come from the live server-resolved patient record. */
export function takeEmailRate(env: Bindings, door: PublicDoor, email: string, kind: PortalKind = 'signin'): Promise<boolean> {
  return take(env, door, 'email', email.trim().toLowerCase(), kind)
}

/** Missing-email patient records share the same quota through an opaque, salted subject. */
export function takePatientRate(env: Bindings, door: 'intake' | 'payment', patient: { id: string; email?: string | null }): Promise<boolean> {
  const email = patient.email?.trim().toLowerCase()
  return take(env, door, 'email', email ? `email:${email}` : `client:${patient.id}`, 'signin')
}
