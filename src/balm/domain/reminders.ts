// Appointment reminders after Dial's reminder commands (src/core/features/bookings/
// reminder-commands.ts, just-every/run-dial @ 66d22da): Balm prepares the exact
// text, a person approves it, and the approved text is exported. Nothing is sent.
import { visibleAppointment } from './booking'
import { approvalStatements } from './approvals'
import { localTime } from './invoices'
import { audit, commit, human, id, insist, need, now, one, stmt, text, type Actor, type Data } from './model'

async function facts(db: D1Database, appointmentId: string) {
  const row = await one(db, `SELECT a.id,a.version,a.status,a.start_at,a.client_id,c.first_name,c.email,p.name AS practitioner,s.name AS service,st.clinic_name,st.address,st.time_zone
    FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id, bm_settings st WHERE a.id=?`, appointmentId)
  insist(row, 'appointment_not_found', 404)
  return { row, basis: JSON.stringify([row.id, row.version, row.status, row.start_at, row.email, row.first_name, row.practitioner, row.service, row.clinic_name, row.address, row.time_zone]) }
}

export async function prepareReminder(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception', 'agent')
  const appointment = await visibleAppointment(db, who, input.appointmentId)
  const { row, basis } = await facts(db, appointment.id as string)
  insist(row.status === 'booked' && Date.parse(row.start_at as string) > Date.now(), 'reminder_needs_an_upcoming_booking', 409)
  insist(row.email, 'client_has_no_email', 409)
  const when = localTime(row.start_at as string, row.time_zone as string)
  const payload = { to: row.email, subject: `Reminder: ${row.service} at ${row.clinic_name}`,
    body: `Hello ${row.first_name},\n\nThis is a reminder of your ${row.service} appointment with ${row.practitioner} on ${when}${row.address ? ` at ${row.address}` : ''}.\n\nIf you need to change it, please contact ${row.clinic_name}.\n` }
  const draftId = id()
  await commit(db, who, [
    stmt(db, "INSERT INTO bm_drafts(id,type,status,payload,basis,client_id,prepared_by,prepared_role,prepared_at) VALUES(?,'reminder','draft',?,?,?,?,?,?)", draftId, JSON.stringify(payload), basis, row.client_id, who.email, who.role, now()),
    audit(db, who, 'reminder.prepared', row.client_id as string, draftId),
  ])
  return { id: draftId, status: 'draft', ...payload }
}

export const reminderText = (payload: Data) => `To: ${payload.to}\nSubject: ${payload.subject}\n\n${payload.body}`

export async function approveReminder(db: D1Database, who: Actor, input: Data) {
  need(who, 'owner', 'reception'); human(who)
  const draft = await one(db, "SELECT * FROM bm_drafts WHERE id=? AND type='reminder'", text(input.id, 'id', 100))
  insist(draft, 'draft_not_found', 404)
  insist(draft.status === 'draft', 'already_decided', 409)
  const appointmentId = JSON.parse(draft.basis as string)[0]
  insist((await facts(db, appointmentId)).basis === draft.basis, 'appointment_changed_prepare_again', 409)
  const exact = reminderText(JSON.parse(draft.payload as string))
  await commit(db, who, [...await approvalStatements(db, who, 'reminder', draft, exact), audit(db, who, 'reminder.approved', draft.client_id as string, draft.id as string)])
  return { id: draft.id, status: 'approved', text: exact }
}

export async function reminderDownload(db: D1Database, who: Actor, draftId: string) {
  need(who, 'owner', 'reception'); human(who)
  const draft = await one(db, "SELECT * FROM bm_drafts WHERE id=? AND type='reminder' AND status='approved'", draftId)
  insist(draft, 'approved_reminder_not_found', 404)
  await commit(db, who, [audit(db, who, 'reminder.downloaded', draft.client_id as string, draft.id as string)])
  return reminderText(JSON.parse(draft.payload as string))
}
