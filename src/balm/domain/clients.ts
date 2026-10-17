// Client-file access adapted from Satchel's matter membership (src/satchel/matters.ts,
// just-every/run-satchel @ 2d460e4): the owner and reception see every file, a
// practitioner sees a file only through their own appointments. Every file read
// writes its audit rows in the same batch that returns nothing to the caller first.
// @ts-ignore The pinned Base module is JavaScript without declarations.
import { createPortability } from '@runeditrun/rer/modules/portability'
import archivePolicy from '../archive-policy.mjs'
import { intakeFor } from './intake'
import { notesFor } from './notes'
import { plansFor } from './plans'
import { invoicesFor } from './invoices'
import { audit, commit, day, email, guard, human, id, insist, integer, need, now, one, optional, practitionerId, rows, sha256, stmt, text, type Actor, type Data } from './model'

export const clientIdentity = (first: string, last: string, dob: string | null) => sha256(`client:${first.trim().toLowerCase()}|${last.trim().toLowerCase()}|${dob ?? ''}`)

export async function clientVisible(db: D1Database, who: Actor, key: unknown) {
  const client = await one(db, 'SELECT * FROM bm_clients WHERE id=? AND erased_at IS NULL', text(key, 'client', 100))
  const own = practitionerId(who)
  const sees = client && (who.role === 'owner' || who.role === 'agent' || who.staffRole === 'reception'
    || (own && await one(db, 'SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?', client.id, own)))
  insist(sees, 'client_not_found', 404)
  return client!
}

export async function listClients(db: D1Database, who: Actor) {
  const own = practitionerId(who)
  if (who.role === 'owner' || who.staffRole === 'reception') return rows(db, 'SELECT id,first_name,last_name,date_of_birth,created_via FROM bm_clients WHERE erased_at IS NULL ORDER BY last_name,first_name')
  return rows(db, 'SELECT id,first_name,last_name,date_of_birth,created_via FROM bm_clients c WHERE erased_at IS NULL AND EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=c.id AND a.practitioner_id=?) ORDER BY last_name,first_name', own ?? '')
}

export async function saveClient(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception'); human(who)
  const previous = input.id ? await clientVisible(db, who, input.id) : null
  const values = { first: text(input.firstName, 'first_name', 80), last: text(input.lastName, 'last_name', 80),
    dob: input.dateOfBirth ? day(input.dateOfBirth, 'date_of_birth') : null, email: input.email ? email(input.email) : null, phone: optional(input.phone, 'phone', 40) }
  const clientId = previous?.id as string ?? id()
  const identity = await clientIdentity(values.first, values.last, values.dob)
  await commit(db, who, [
    ...(previous ? [guard(db, 'EXISTS(SELECT 1 FROM bm_clients WHERE id=? AND version=?)', clientId, input.version === undefined ? previous.version : integer(input.version, 'version', 1, Number.MAX_SAFE_INTEGER))]
      : [guard(db, 'NOT EXISTS(SELECT 1 FROM bm_erasure_journal WHERE identity_hash=?)', identity)]),
    stmt(db, `INSERT INTO bm_clients(id,first_name,last_name,date_of_birth,email,phone,created_at,created_via) VALUES(?,?,?,?,?,?,?,'staff')
      ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,date_of_birth=excluded.date_of_birth,email=excluded.email,phone=excluded.phone,version=bm_clients.version+1`,
    clientId, values.first, values.last, values.dob, values.email, values.phone, now()),
    audit(db, who, previous ? 'client.updated' : 'client.created', clientId, clientId),
  ])
  return { id: clientId }
}

/** The whole file this actor may read. Reading it records every access. */
export async function clientFile(db: D1Database, who: Actor, key: unknown) {
  const client = await clientVisible(db, who, key)
  const own = practitionerId(who), all = who.role === 'owner' || who.staffRole === 'reception'
  const appointments = await rows(db, `SELECT a.id,a.start_at,a.end_at,a.status,a.booked_via,a.practitioner_id,p.name AS practitioner,s.name AS service,s.id AS service_id,s.note_template,
    (SELECT 1 FROM bm_intake_responses r WHERE r.appointment_id=a.id) AS intake_received,(SELECT 1 FROM bm_intake_responses o WHERE o.client_id=a.client_id) AS intake_on_file
    FROM bm_appointments a JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id WHERE a.client_id=? ORDER BY a.start_at DESC`, client.id)
  const visibleAppointments = appointments.filter(a => all || a.practitioner_id === own)
  const intake = (await intakeFor(db, who, client.id as string))?.filter(r => who.role === 'owner' || visibleAppointments.some(a => a.id === r.appointmentId)) ?? null
  const notes = await notesFor(db, who, client.id as string)
  const plans = await plansFor(db, who, client.id as string)
  const invoices = all ? await invoicesFor(db, client.id as string) : null
  const auditRows = who.role === 'owner' ? await rows(db, 'SELECT sequence,at,actor_email,actor_role,action,subject_id,detail FROM bm_audit WHERE client_id=? ORDER BY sequence DESC LIMIT 500', client.id) : null
  await commit(db, who, [
    audit(db, who, 'file.viewed', client.id as string, client.id as string, [intake ? `intake ${intake.length}` : 'no clinical intake', notes ? `notes ${notes.length}` : 'no notes', auditRows ? 'audit' : ''].filter(Boolean).join('; ')),
    ...(intake ?? []).map(r => audit(db, who, 'intake.read', client.id as string, r.id as string)),
    ...(notes ?? []).map(n => audit(db, who, 'note.read', client.id as string, n.id as string, `revisions ${n.revisions.length}`)),
    ...plans.filter(p => p.content).map(p => audit(db, who, 'plan.read', client.id as string, p.id as string)),
  ])
  return { client, appointments: visibleAppointments, intake, notes, plans, invoices, audit: auditRows }
}

/** Only a client with no appointments, notes, intake, invoices, card payments, card on file or import history can be erased. */
export async function eraseClient(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner'); human(who)
  const client = await clientVisible(db, who, input.id)
  const unused = `NOT EXISTS(SELECT 1 FROM bm_appointments WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_notes WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_plans_of_care WHERE client_id=?)
    AND NOT EXISTS(SELECT 1 FROM bm_intake_responses WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_invoices WHERE client_id=?)
    AND NOT EXISTS(SELECT 1 FROM bm_import_client_revisions WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_waitlist WHERE client_id=?)
    AND NOT EXISTS(SELECT 1 FROM ik_provenance WHERE destination='balm:clients' AND target_id=?)
    AND NOT EXISTS(SELECT 1 FROM bm_card_payments WHERE client_id=?) AND NOT EXISTS(SELECT 1 FROM bm_cards WHERE client_id=? AND removed_at IS NULL)`
  const args = Array(10).fill(client.id)
  insist((await one<{ ok: number }>(db, `SELECT CASE WHEN (${unused}) THEN 1 ELSE 0 END AS ok`, ...args))?.ok === 1, 'clients_with_health_records_are_retained', 409)
  const portability = await createPortability({ db, policy: archivePolicy })
  const at = Date.now()
  await commit(db, who, [
    guard(db, unused, ...args),
    ...await portability.redactionStatements(), ...await portability.invalidateTransfersStatements(),
    stmt(db, 'INSERT INTO bm_erasure_journal(identity_hash,kind,erased_at) VALUES(?,?,?)', await clientIdentity(client.first_name as string, client.last_name as string, client.date_of_birth as string | null), 'client', at),
    stmt(db, "UPDATE bm_clients SET first_name='Erased',last_name='client',date_of_birth=NULL,email=NULL,phone=NULL,version=version+1,erased_at=? WHERE id=?", at, client.id),
    audit(db, who, 'client.erased', client.id as string, client.id as string),
  ])
  return { id: client.id, erased: true }
}
