import { bookForClient, moveAppointment, setAppointmentStatus } from './booking'
import { eraseStaff, saveHours, saveRoom, saveService, saveSettings, saveStaff } from './clinic'
import { eraseClient, listClients, saveClient } from './clients'
import { prepareForm, publishForm } from './intake'
import { approveInvoice, invoicesFor, prepareInvoice, recordPayment, voidInvoice } from './invoices'
import { audit, commit, DomainError, insist, one, practitionerId, rows, type Actor, type Data } from './model'
import { amendNote, writeNote } from './notes'
import { approveReminder, prepareReminder } from './reminders'
import { addAddendum, signNote } from './signing'
import { bookSeries, cancelRest, moveRest, previewSeries } from './series'
import { addToWaitlist, removeFromWaitlist, waitlistFor } from './waitlist'
export { actor, DomainError, type Actor } from './model'

/** What an agent key may do: prepare work for a person to approve. */
export const preparations = ['invoice.prepare', 'reminder.prepare', 'intake.prepare']
export const approvals = ['invoice.approve', 'reminder.approve', 'intake.publish']

const handlers: Record<string, (db: D1Database, who: Actor, input: Data) => Promise<unknown>> = {
  'settings.save': saveSettings, 'staff.save': saveStaff, 'staff.erase': eraseStaff, 'service.save': saveService, 'hours.save': saveHours, 'room.save': saveRoom,
  'client.save': saveClient, 'client.erase': eraseClient,
  'appointment.book': bookForClient, 'appointment.move': moveAppointment,
  'series.preview': previewSeries, 'series.book': bookSeries, 'series.cancel_rest': cancelRest, 'series.move_rest': moveRest,
  'waitlist.add': addToWaitlist, 'waitlist.remove': removeFromWaitlist,
  'appointment.cancel': (db, who, input) => setAppointmentStatus(db, who, input, 'cancelled'),
  'appointment.attend': (db, who, input) => setAppointmentStatus(db, who, input, 'attended'),
  'appointment.no_show': (db, who, input) => setAppointmentStatus(db, who, input, 'no_show'),
  'note.write': writeNote, 'note.amend': amendNote, 'note.sign': signNote, 'note.addendum': addAddendum,
  'invoice.prepare': prepareInvoice, 'invoice.approve': approveInvoice, 'invoice.void': voidInvoice, 'payment.record': recordPayment,
  'reminder.prepare': prepareReminder, 'reminder.approve': approveReminder,
  'intake.prepare': prepareForm, 'intake.publish': publishForm,
}

export async function command(db: D1Database, who: Actor, name: string, input: Data) {
  insist(input && typeof input === 'object' && !Array.isArray(input), 'invalid_input')
  if (who.role === 'agent') insist(preparations.includes(name), 'agents_can_only_prepare', 403)
  const handler = handlers[name]
  if (!handler) throw new DomainError('unknown_command', 404)
  return handler(db, who, input)
}

/** Role-scoped working state. It never carries intake answers or note text. */
export async function snapshot(db: D1Database, who: Actor) {
  const owner = who.role === 'owner', desk = owner || who.role === 'agent' || who.staffRole === 'reception', own = practitionerId(who)
  const settings = await one(db, 'SELECT clinic_name,time_zone,abn,address,booking_open FROM bm_settings WHERE id=1')
  const staff = await rows(db, owner ? 'SELECT * FROM bm_staff WHERE erased_at IS NULL ORDER BY name' : 'SELECT id,name,role,profession,credentials FROM bm_staff WHERE active=1 AND erased_at IS NULL ORDER BY name')
  const services = await rows(db, 'SELECT * FROM bm_services ORDER BY name')
  const hours = await rows(db, 'SELECT practitioner_id,weekday,start_minute,end_minute FROM bm_hours ORDER BY practitioner_id,weekday,start_minute')
  const rooms = await rows(db, owner ? 'SELECT * FROM bm_rooms ORDER BY name' : 'SELECT id,name FROM bm_rooms WHERE active=1 ORDER BY name')
  const appointments = await rows(db, `SELECT a.id,a.client_id,a.practitioner_id,a.service_id,a.room_id,a.series_id,a.start_at,a.end_at,a.status,a.booked_via,c.first_name||' '||c.last_name AS client,
    p.name AS practitioner,s.name AS service,(SELECT 1 FROM bm_intake_responses r WHERE r.appointment_id=a.id) AS intake_received,
    (SELECT CASE WHEN MIN(n.signed_at IS NOT NULL)=1 THEN 'signed' WHEN COUNT(*)>0 THEN 'unsigned' END FROM bm_notes n WHERE n.appointment_id=a.id) AS note_status,
    (SELECT pc.status||'|'||COALESCE(pc.certified_at,pc.sent_at)||'|'||pc.physician_name FROM bm_plans_of_care pc WHERE pc.client_id=a.client_id ORDER BY pc.created_at DESC LIMIT 1) AS plan_of_care
    FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id
    WHERE a.end_at>? AND (? OR a.practitioner_id=?) ORDER BY a.start_at LIMIT 300`, new Date(Date.now() - 14 * 86400_000).toISOString(), desk ? 1 : 0, own ?? '')
  const invoices = desk ? (await invoicesFor(db)).slice(0, 200) : []
  const drafts = desk ? (await rows(db, `SELECT * FROM bm_drafts WHERE ${owner || who.role === 'agent' ? '1' : "type='reminder'"} ORDER BY prepared_at DESC LIMIT 200`)).map(d => ({ ...d, payload: JSON.parse(d.payload as string) })) : []
  const forms = owner || who.role === 'agent' ? (await rows(db, 'SELECT * FROM bm_intake_forms ORDER BY number DESC')).map(f => ({ ...f, questions: JSON.parse(f.questions as string) })) : []
  const approvalRows = owner ? await rows(db, 'SELECT * FROM bm_approvals ORDER BY approved_at DESC LIMIT 200') : []
  const clients = who.role === 'agent' ? [] : await listClients(db, who)
  if (who.role === 'agent') {
    // An agent's read of client names is an access to those files.
    const seen = [...new Set([...appointments.map(a => a.client_id), ...invoices.map(i => i.client_id)])] as string[]
    if (seen.length) await commit(db, who, seen.map(clientId => audit(db, who, 'agent.context', clientId, null, 'names, appointments and invoices')))
  }
  const waitlist = who.role === 'agent' ? { entries: [], offers: [] } : await waitlistFor(db, who)
  return { actor: who, settings, staff, services, hours, rooms, appointments, clients, invoices, drafts, forms, approvals: approvalRows, waitlist }
}
