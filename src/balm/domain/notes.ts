// Notes keep immutable revisions, as Willow keeps document versions
// (src/willow/documents.ts, just-every/run-willow @ 5b116db): an amendment adds
// a revision with its reason and never rewrites the earlier text.
import { audit, commit, guard, human, id, insist, now, one, practitionerId, rows, stmt, text, type Actor, type Data } from './model'
import { clientVisible } from './clients'

export async function writeNote(db: D1Database, who: Actor, input: Data) {
  human(who)
  const author = practitionerId(who)
  insist(author, 'only_practitioners_write_notes', 403)
  const client = await clientVisible(db, who, input.clientId)
  const appointmentId = input.appointmentId ? text(input.appointmentId, 'appointment', 100) : null
  if (appointmentId) insist(await one(db, 'SELECT 1 FROM bm_appointments WHERE id=? AND client_id=? AND practitioner_id=?', appointmentId, client.id, author), 'appointment_not_found', 404)
  const noteId = id(), body = text(input.body, 'note', 20_000)
  await commit(db, who, [
    // A practitioner writes only for a client they are booked with.
    guard(db, 'EXISTS(SELECT 1 FROM bm_appointments WHERE client_id=? AND practitioner_id=?)', client.id, author),
    stmt(db, 'INSERT INTO bm_notes(id,client_id,appointment_id,author_id,created_at) VALUES(?,?,?,?,?)', noteId, client.id, appointmentId, author, now()),
    stmt(db, 'INSERT INTO bm_note_revisions(note_id,number,body,reason,written_at) VALUES(?,1,?,?,?)', noteId, body, '', now()),
    audit(db, who, 'note.written', client.id as string, noteId),
  ])
  return { id: noteId, revision: 1 }
}

export async function amendNote(db: D1Database, who: Actor, input: Data) {
  human(who)
  const note = await one(db, 'SELECT * FROM bm_notes WHERE id=?', text(input.id, 'id', 100))
  insist(note && note.author_id === practitionerId(who), 'note_not_found', 404)
  const latest = (await one<{ n: number }>(db, 'SELECT MAX(number) AS n FROM bm_note_revisions WHERE note_id=?', note.id))!.n
  insist(input.revision === undefined || Number(input.revision) === latest, 'note_changed_reload', 409)
  await commit(db, who, [
    stmt(db, 'INSERT INTO bm_note_revisions(note_id,number,body,reason,written_at) VALUES(?,?,?,?,?)', note.id, latest + 1, text(input.body, 'note', 20_000), text(input.reason, 'amendment_reason', 300), now()),
    audit(db, who, 'note.amended', note.client_id as string, note.id as string, `revision ${latest + 1}`),
  ])
  return { id: note.id, revision: latest + 1 }
}

/** Notes this actor may read: the owner reads all, a practitioner reads only their own. */
export async function notesFor(db: D1Database, who: Actor, clientId: string) {
  const author = practitionerId(who)
  if (who.role !== 'owner' && !author) return null
  const notes = await rows(db, `SELECT n.*,s.name AS author_name FROM bm_notes n JOIN bm_staff s ON s.id=n.author_id WHERE n.client_id=? AND (?='owner' OR n.author_id=?) ORDER BY n.created_at DESC`, clientId, who.role, author ?? '')
  if (!notes.length) return []
  const revisions = await rows(db, `SELECT * FROM bm_note_revisions WHERE note_id IN (${notes.map(() => '?').join(',')}) ORDER BY number DESC`, ...notes.map(n => n.id))
  return notes.map(n => ({ id: n.id, appointmentId: n.appointment_id, authorId: n.author_id, authorName: n.author_name, createdAt: n.created_at, mine: n.author_id === author,
    revisions: revisions.filter(r => r.note_id === n.id).map(r => ({ number: r.number, body: r.body, reason: r.reason, writtenAt: r.written_at })) }))
}
