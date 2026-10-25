// Attendance opens work for the treating clinician and billing desk in the same
// guarded batch as the status change. It never records treatment or takes money.
import { packageAttendance } from '../payments/retail'
import { documentationInput } from '../charting/compliance'
import { resolveTemplate } from '../charting/template-catalog'
import { insuredCharge } from '../insurance/invoice-price'
import { snapshot } from './invoices'
import { audit, guard, id, now, one, stmt, type Actor, type Data } from './model'

export async function attendanceStatements(db: D1Database, who: Actor, visit: Data) {
  const packageUse=await packageAttendance(db,who,visit)
  const statements: D1PreparedStatement[] = [...packageUse.statements], at = now()
  const existingNote = await one(db, 'SELECT id FROM bm_notes WHERE appointment_id=?', visit.id)
  const staff = await one(db, 'SELECT kind FROM bm_staff_access WHERE staff_id=?', visit.practitioner_id)
  const service = (await one(db, 'SELECT note_template FROM bm_services WHERE id=?', visit.service_id))!
  const t = await resolveTemplate(db,service.note_template)
  if (!existingNote && (staff?.kind !== 'assistant' || t?.kind === 'daily')) {
    const noteId = id()
    statements.push(
      guard(db, 'NOT EXISTS(SELECT 1 FROM bm_notes WHERE appointment_id=?)', visit.id),
      stmt(db, 'INSERT INTO bm_notes(id,client_id,appointment_id,author_id,created_at,template,template_snapshot) VALUES(?,?,?,?,?,?,?)', noteId, visit.client_id, visit.id, visit.practitioner_id, at, t?.key ?? '', t ? JSON.stringify(t) : null),
      // Revision zero is an empty starter. The clinician's first saved text is revision one.
      stmt(db, 'INSERT INTO bm_note_revisions(note_id,number,body,reason,written_at,sections,charges,documentation) VALUES(?,0,?,?,?,?,?,?)', noteId, '', 'Started at attendance; no treatment recorded', at,
        t ? JSON.stringify(t.sections.map(s => ({ id: s.id, label: s.label, text: '' }))) : null, '[]', JSON.stringify(documentationInput({}))),
      audit(db, who, 'note.started', visit.client_id, noteId, 'attendance; treating practitioner'),
    )
  }
  const existingInvoice = await one(db, "SELECT id FROM bm_invoices WHERE appointment_id=? AND status<>'void'", visit.id)
  if (!existingInvoice) {
    const { value } = await snapshot(db, visit.id, packageUse.covered?0:(await insuredCharge(db, visit.id))?.cents), invoiceId = id()
    statements.push(
      guard(db, "NOT EXISTS(SELECT 1 FROM bm_invoices WHERE appointment_id=? AND status<>'void')", visit.id),
      stmt(db, "INSERT INTO bm_invoices(id,appointment_id,client_id,status,amount_cents,snapshot,prepared_by,prepared_role,prepared_at,attendance_started) VALUES(?,?,?,'draft',?,?,?,?,?,1)", invoiceId, visit.id, visit.client_id, value.amountCents, JSON.stringify(value), who.email, who.role, at),
      audit(db, who, 'invoice.started', visit.client_id, invoiceId, 'attendance; unapproved draft'),
    )
  }
  return statements
}
