import { runtimeBindings, type Bindings } from '../../auth.server'
import { audit, commit, DomainError, guard, id, insist, now, one, rows, sha256, stmt } from '../domain/model'
import { send } from '../mail-out'
import { managedInstall } from '../payments/stripe-api'
import { takeEmailRate } from '../public-rates'

const LINK_MS = 15 * 60_000
const SESSION_MS = 8 * 3600_000
export const portalNotice = 'If one patient file matches that email, we will send a private sign-in link. Check your inbox.'
export const portalManagedNotice = 'Patient portal sign-in is not available yet on RER Managed hosting.'
export const patientActor = { email: 'patient-portal', role: 'patient' }
export const portalToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const validToken = (token: unknown): token is string => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
const cookieName = (request: Request) => new URL(request.url).protocol === 'https:' ? '__Host-balm_patient' : 'balm_patient'
const cookieValue = (request: Request) => (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName(request) + '='))?.slice(cookieName(request).length + 1) ?? ''
const cookie = (request: Request, value: string, seconds: number) => `${cookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}; Expires=${new Date(seconds ? Date.now() + seconds * 1000 : 0).toUTCString()}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
function origin(env: Bindings, request: Request) {
  insist(request.method === 'POST' && request.headers.get('origin') === new URL(runtimeBindings(env).AUTH_ORIGIN).origin, 'cross_site_request_refused', 403)
}

/** Generic response for absent, shared, invalid or rate-limited email; no patient is enrolled here. */
export async function requestPortalLink(env: Bindings, request: Request, emailInput: unknown) {
  origin(env, request)
  if (managedInstall(env)) return { notice: portalManagedNotice }
  const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase().slice(0, 255) : ''
  // portalResponse has already taken the address allowance before reading the body.
  const allowed = await takeEmailRate(env, 'portal', email, 'signin')
  if (!allowed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { notice: portalNotice }
  const clients = await rows<{ id: string; version: number }>(env.DB, 'SELECT id,version FROM bm_clients WHERE lower(email)=? AND erased_at IS NULL LIMIT 2', email)
  if (clients.length !== 1) return { notice: portalNotice }
  const client = clients[0], value = portalToken(), linkId = id(), at = now()
  // Uniqueness is checked again in the write, so a concurrently added shared address grants nothing.
  try {
    await commit(env.DB, null, [
      guard(env.DB, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND lower(email)=? AND erased_at IS NULL) AND (SELECT COUNT(*) FROM bm_clients WHERE lower(email)=? AND erased_at IS NULL)=1', client.id, client.version, email, email),
      stmt(env.DB, 'UPDATE bm_portal_links SET revoked_at=? WHERE client_id=? AND used_at IS NULL AND revoked_at IS NULL', at, client.id),
      stmt(env.DB, 'INSERT INTO bm_portal_links(id,token_hash,client_id,client_version,email,created_at,expires_at) VALUES(?,?,?,?,?,?,?)', linkId, await sha256(value), client.id, client.version, email, at, new Date(Date.now() + LINK_MS).toISOString()),
    ])
  } catch (error) { if (error instanceof DomainError && error.status === 409) return { notice: portalNotice }; throw error }
  const delivery = await send(env, email, 'Your private patient portal sign-in link',
    `Open your private patient portal sign-in link:\n${new URL('/portal/confirm?token=' + value, runtimeBindings(env).AUTH_ORIGIN).href}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.`)
  if (delivery !== 'sent') await stmt(env.DB, 'UPDATE bm_portal_links SET revoked_at=? WHERE id=?', now(), linkId).run()
  return { notice: portalNotice }
}

export interface Patient {
  sessionId: string; clientId: string; clientVersion: number; email: string; firstName: string; lastName: string; expiresAt: string
}
const liveSession = `SELECT s.id AS sessionId,s.client_id AS clientId,s.client_version AS clientVersion,s.email,c.first_name AS firstName,c.last_name AS lastName,s.expires_at AS expiresAt
 FROM bm_portal_sessions s JOIN bm_clients c ON c.id=s.client_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
 AND c.erased_at IS NULL AND c.version=s.client_version AND lower(c.email)=s.email
 AND (SELECT COUNT(*) FROM bm_clients WHERE lower(email)=s.email AND erased_at IS NULL)=1`

/** The cookie cannot authenticate staff, and a staff session cannot authenticate a patient. */
export async function portalPatient(db: D1Database, request: Request): Promise<Patient> {
  const token = cookieValue(request)
  insist(validToken(token), 'patient_sign_in_required', 401)
  const patient = await one<Patient>(db, liveSession, await sha256(token), now())
  insist(patient, 'patient_sign_in_required', 401)
  return patient
}
export const portalGuard = (db: D1Database, patient: Patient) => guard(db, `EXISTS(SELECT 1 FROM bm_portal_sessions s JOIN bm_clients c ON c.id=s.client_id
 WHERE s.id=? AND s.client_id=? AND s.client_version=? AND s.revoked_at IS NULL AND s.expires_at>?
 AND c.erased_at IS NULL AND c.version=s.client_version AND lower(c.email)=s.email
 AND (SELECT COUNT(*) FROM bm_clients WHERE lower(email)=s.email AND erased_at IS NULL)=1)`, patient.sessionId, patient.clientId, patient.clientVersion, now())

/** POST only: scanners visiting the emailed GET link do not consume the credential. */
export async function consumePortalLink(env: Bindings, request: Request, token: unknown) {
  origin(env, request)
  insist(!managedInstall(env), portalManagedNotice, 409)
  insist(validToken(token), 'portal_link_not_available', 410)
  const link = await one<{ id: string; client_id: string; client_version: number; email: string }>(env.DB, `SELECT l.id,l.client_id,l.client_version,l.email FROM bm_portal_links l JOIN bm_clients c ON c.id=l.client_id
    WHERE l.token_hash=? AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>? AND c.erased_at IS NULL
    AND c.version=l.client_version AND lower(c.email)=l.email AND (SELECT COUNT(*) FROM bm_clients WHERE lower(email)=l.email AND erased_at IS NULL)=1`, await sha256(token), now())
  insist(link, 'portal_link_not_available', 410)
  // Resolve the live token without effects, then refuse before consuming it or creating a session.
  insist(await takeEmailRate(env, 'portal', link.email, 'confirm'), portalNotice, 429)
  const session = portalToken(), sessionId = id(), at = now()
  await commit(env.DB, null, [
    guard(env.DB, `EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=? AND lower(email)=? AND erased_at IS NULL)
      AND (SELECT COUNT(*) FROM bm_clients WHERE lower(email)=? AND erased_at IS NULL)=1`, link.client_id, link.client_version, link.email, link.email),
    stmt(env.DB, 'UPDATE bm_portal_links SET used_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?', at, link.id, at), guard(env.DB, 'changes()=1'),
    stmt(env.DB, 'INSERT INTO bm_portal_sessions(id,token_hash,client_id,client_version,email,created_at,expires_at) VALUES(?,?,?,?,?,?,?)', sessionId, await sha256(session), link.client_id, link.client_version, link.email, at, new Date(Date.now() + SESSION_MS).toISOString()),
    audit(env.DB, patientActor, 'portal.signed_in', link.client_id, sessionId),
  ])
  return { cookie: cookie(request, session, SESSION_MS / 1000) }
}

export async function signOutPortal(db: D1Database, request: Request) {
  insist(request.method === 'POST' && request.headers.get('origin') === new URL(request.url).origin, 'cross_site_request_refused', 403)
  const token = cookieValue(request)
  if (validToken(token)) await stmt(db, 'UPDATE bm_portal_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL', now(), await sha256(token)).run()
  return { cookie: cookie(request, '', 0) }
}
