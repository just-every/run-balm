import { saveException } from '../scheduling/service-rules'
import { saveClinicalTemplate, templateCatalog } from '../charting/template-catalog'
import {dailyRules,dailyRuleCommand,attestAssistantSupervision} from './assistant-daily'
import { coSignQueue, returnNote, saveSupervisionDeadline } from './supervision'
import { saveLocation, locateRoom, locateHours } from './role-access'
import { saveBalanceAccess } from './balance-access'
import { saveHoliday } from './holidays'
import { dailyClose } from '../reports/access'
import { breakGlassNotices } from './care-team'
import { alertsForClients } from './alerts'
import { documentationClose, documentationSettings, saveDocumentationSettings, savePayerDocumentation } from '../charting/compliance'
import { bookForClient, moveAppointment, setAppointmentStatus } from './booking'
import { eraseStaff, saveBookingEmbed, saveEquipment, saveHours, saveRoom, saveService, saveSettings, saveStaff } from './clinic'
import { eraseClient, listClients, saveClient } from './clients'
import { prepareForm, preparePacket, publishForm } from './intake'
import { currentPolicies, publishPolicy } from '../intake/policies'
import { approveInvoice, invoicesFor, prepareInvoice, recordPayment, voidInvoice } from './invoices'
import { audit, commit, DomainError, insist, one, practitionerId, rows, type Actor, type Data } from './model'
import { amendNote, writeNote } from './notes'
import { recordMeasure, removeMeasure } from './measures'
import { approveReminder, prepareReminder } from './reminders'
import { addAddendum, signNote } from './signing'
import { bookSeries, cancelRest, moveRest, previewSeries } from './series'
import { addToWaitlist, removeFromWaitlist, waitlistFor } from './waitlist'
export { actor, DomainError, type Actor } from './model'

/** What an agent key may do: prepare work for a person to approve. */
export const preparations = ['invoice.prepare', 'reminder.prepare', 'intake.prepare']
export const approvals = ['invoice.approve', 'reminder.approve', 'intake.publish']

const handlers: Record<string, (db: D1Database, who: Actor, input: Data) => Promise<unknown>> = {
  'assistant_daily.save': (db,who,input)=>dailyRuleCommand(db,who,'assistant_daily.save',input), 'assistant_daily.revoke': (db,who,input)=>dailyRuleCommand(db,who,'assistant_daily.revoke',input), 'note.supervision': attestAssistantSupervision,
  'supervision.deadline.save': saveSupervisionDeadline,
  'insurance.supervision.save': async (db,who,input)=>{
    insist(who.role==='owner','only_the_owner_sets_payer_rules',403)
    insist([true,false,'true','false'].includes(input.billSupervisor),'invalid_supervisor_billing')
    insist(['in_room','on_site','general'].includes(input.minimumSupervision),'record_the_payer_supervision_requirement')
    insist([true,false,'true','false'].includes(input.billable),'record_whether_supervised_visits_are_billable')
    await commit(db,who,[db.prepare('UPDATE bm_payers SET supervisor_billing=?,supervision_minimum=?,supervision_billable=?,supervision_rule_recorded=1,version=version+1 WHERE id=?').bind(input.billSupervisor===true||input.billSupervisor==='true'?1:0,input.minimumSupervision,input.billable===true||input.billable==='true'?1:0,String(input.payerId)),audit(db,who,'payer.supervision_saved',null,String(input.payerId))])
    return {saved:true}
  },
  'schedule.exception': saveException,
  'hours.location': locateHours, 'location.save': saveLocation, 'room.location': locateRoom,
  'staff.balance_access': saveBalanceAccess,
  'booking.embed.save': saveBookingEmbed,
  'template.save': saveClinicalTemplate,
  'documentation.settings.save': saveDocumentationSettings, 'documentation.payer.save': savePayerDocumentation,
  'holiday.save': saveHoliday, 'settings.save': saveSettings, 'staff.save': saveStaff, 'staff.erase': eraseStaff, 'service.save': saveService, 'hours.save': saveHours, 'room.save': saveRoom, 'equipment.save': saveEquipment,
  'client.save': saveClient, 'client.erase': eraseClient,
  'appointment.book': bookForClient, 'appointment.move': moveAppointment,
  'series.preview': previewSeries, 'series.book': bookSeries, 'series.cancel_rest': cancelRest, 'series.move_rest': moveRest,
  'waitlist.add': addToWaitlist, 'waitlist.remove': removeFromWaitlist,
  'appointment.cancel': (db, who, input) => setAppointmentStatus(db, who, input, 'cancelled'),
  'appointment.attend': (db, who, input) => setAppointmentStatus(db, who, input, 'attended'),
  'appointment.no_show': (db, who, input) => setAppointmentStatus(db, who, input, 'no_show'),
  'note.submit': (db,who,input)=>signNote(db,who,input,'submit'), 'note.cosign': (db,who,input)=>signNote(db,who,input,'cosign'), 'note.return': returnNote,
  'note.write': writeNote, 'note.amend': amendNote, 'note.sign': signNote, 'note.addendum': addAddendum,
  'note.measure': recordMeasure, 'note.measure_remove': removeMeasure,
  'invoice.prepare': prepareInvoice, 'invoice.approve': approveInvoice, 'invoice.void': voidInvoice, 'payment.record': recordPayment,
  'reminder.prepare': prepareReminder, 'reminder.approve': approveReminder,
  'intake.packet.prepare': preparePacket, 'intake.prepare': prepareForm, 'intake.publish': publishForm, 'consent.publish': publishPolicy,
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
  const settings = await one(db, "SELECT version,nppes_lookup,booking_embed_origins,cancellation_notice_hours,late_cancel_fee_cents,no_show_fee_cents,holidays,clinic_name,time_zone,time_zone_chosen,abn,address,tax_id_type,practice_npi,street_address,city,state,postal_code,booking_open,(SELECT COUNT(*) FROM bm_appointments WHERE status='booked' AND end_at>?) AS upcoming FROM bm_settings WHERE id=1", new Date().toISOString())
  const staff = await rows(db, owner ? "SELECT s.*,EXISTS(SELECT 1 FROM oa_operators o WHERE lower(o.email)=lower(s.email) AND o.status IN ('active','invited')) AS can_sign_in FROM bm_staff s WHERE s.erased_at IS NULL ORDER BY s.name" : 'SELECT id,name,role,profession,credentials,discipline FROM bm_staff WHERE active=1 AND erased_at IS NULL ORDER BY name')
  const accessRows = await rows(db,'SELECT * FROM bm_staff_access')
  for (const person of staff) Object.assign(person, accessRows.find(a=>a.staff_id===person.id) ?? {kind:person.role})
  const locations = owner ? await rows(db,'SELECT * FROM bm_locations ORDER BY name') : []
  const hourLocations = owner ? await rows(db,'SELECT * FROM bm_hour_locations') : []
  const roomLocations = owner ? await rows(db,'SELECT * FROM bm_room_locations') : []
  const services = await rows(db, 'SELECT * FROM bm_services ORDER BY name')
  const hours = await rows(db, 'SELECT practitioner_id,weekday,start_minute,end_minute FROM bm_hours ORDER BY practitioner_id,weekday,start_minute')
  const rooms = await rows(db, owner ? 'SELECT * FROM bm_rooms ORDER BY name' : 'SELECT id,name FROM bm_rooms WHERE active=1 ORDER BY name')
  const equipment = await rows(db, owner ? 'SELECT * FROM bm_equipment ORDER BY name' : 'SELECT id,name FROM bm_equipment WHERE active=1 ORDER BY name')
  const appointments = await rows(db, `SELECT a.id,a.client_id,a.practitioner_id,a.service_id,a.room_id,a.equipment_id,a.series_id,a.start_at,a.end_at,a.status,a.patient_response,a.patient_response_at,a.booked_via,c.first_name||' '||c.last_name AS client,
    p.name AS practitioner,s.name AS service,(SELECT 1 FROM bm_intake_responses r WHERE r.appointment_id=a.id) AS intake_received,(SELECT 1 FROM bm_intake_responses o WHERE o.client_id=a.client_id) AS intake_on_file,
    (SELECT CASE WHEN MIN(n.signed_at IS NOT NULL)=1 THEN 'signed' WHEN COUNT(*)>0 THEN 'unsigned' END FROM bm_notes n WHERE n.appointment_id=a.id) AS note_status,
    (SELECT pc.status||'|'||COALESCE(pc.certified_at,pc.sent_at)||'|'||pc.physician_name FROM bm_plans_of_care pc WHERE pc.client_id=a.client_id ORDER BY pc.created_at DESC LIMIT 1) AS plan_of_care
    FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id
    WHERE a.end_at>? AND (? OR a.practitioner_id=?) ORDER BY a.start_at LIMIT 300`, new Date(Date.now() - 14 * 86400_000).toISOString(), desk ? 1 : 0, own ?? '')
  const patientAlerts = await alertsForClients(db, who, appointments.map(a => String(a.client_id)))
  for (const appointment of appointments) appointment.alerts = patientAlerts[appointment.client_id] ?? []
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
  return { actor: who, scheduleExceptions: owner?await rows(db,'SELECT * FROM bm_schedule_exceptions ORDER BY date'):[], clinicalTemplates: owner || own ? await templateCatalog(db) : [], assistantDailyRules: await dailyRules(db,who), supervisionDeadlines: owner ? await rows(db,'SELECT * FROM bm_supervision_deadlines ORDER BY staff_id') : [], coSignQueue: await coSignQueue(db,who), documentation: owner ? await documentationSettings(db) : null, documentationClose: await documentationClose(db, who), dailyClose: settings?.time_zone ? await dailyClose(db, who) : null, breakGlass: await breakGlassNotices(db, who), settings, staff, locations, roomLocations, hourLocations, services, hours, rooms, equipment, appointments, clients, invoices, drafts, forms, policies: owner ? await currentPolicies(db) : [], approvals: approvalRows, waitlist }
}
