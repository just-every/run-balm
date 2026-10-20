import { alertsForClients } from './alerts'
import { addVisitFlags } from './visit-flags'
// The schedule as a calendar: a day or a week, by practitioner or by room, in
// the clinic's time zone, by practitioner, room or equipment. A practitioner sees only their own calendar.
import { datePlus, firstInstantOfHostDate, hostDateAt, weekdayForDate } from '../availability/timezone'
import { visibleAppointment } from './booking'
import { one, practitionerId, rows, type Actor, type Data } from './model'

/** Each visit's coverage as the day view's chips show it: the primary payer (none is self-pay), whether Medicare's KX threshold
 * applies to the patient's latest claim, and how many of this visit's own claims a payer denied or rejected. No clinical text. */
const coverage = `(SELECT y.name FROM bm_policies po JOIN bm_payers y ON y.id=po.payer_id WHERE po.client_id=a.client_id AND po.priority=1 ORDER BY po.starts_on DESC LIMIT 1) AS payer,
    (SELECT json_extract(cl.snapshot,'$.kx.required') FROM bm_claims cl WHERE cl.client_id=a.client_id AND cl.status<>'corrected' ORDER BY cl.created_at DESC LIMIT 1) AS kx_required,
    (SELECT COUNT(*) FROM bm_claims cl WHERE cl.appointment_id=a.id AND cl.status IN ('denied','rejected','partial')) AS claims_to_fix`
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value

export async function calendarView(db: D1Database, who: Actor, params: Record<string, string>) {
  const zone = (await one(db, 'SELECT time_zone FROM bm_settings WHERE id=1'))!.time_zone as string
  const desk = who.role === 'owner' || who.staffRole === 'reception', own = practitionerId(who)
  const today = hostDateAt(new Date(), zone), date = isDay(params.date) ? params.date : today
  const view = params.view === 'week' ? 'week' : 'day', by = (params.by === 'room' || params.by === 'equipment') && desk ? params.by : 'practitioner'
  // The signed-in practitioner's own column comes first, then everyone else by name.
  const practitioners = (await rows(db, "SELECT id,name,credentials FROM bm_staff WHERE role='practitioner' AND active=1 AND erased_at IS NULL ORDER BY id=? DESC,name", own ?? '')).filter(p => desk || p.id === own)
  const rooms = await rows(db, 'SELECT id,name FROM bm_rooms WHERE active=1 ORDER BY name'), equipment = await rows(db, 'SELECT id,name FROM bm_equipment WHERE active=1 ORDER BY name')
  const subjects = by === 'room' ? [...rooms, { id: 'none', name: 'No room' }] : by === 'equipment' ? equipment : practitioners
  const chosen = subjects.find(s => s.id === params.id)
  const first = view === 'week' ? datePlus(date, -weekdayForDate(date)) : date, days = view === 'week' ? 7 : 1
  const dates = Array.from({ length: days }, (_, i) => datePlus(first, i))
  const weekly = chosen ?? subjects[0]
  const columns = view === 'week'
    ? (weekly ? dates.map(d => ({ key: d, date: d, label: d, subject: weekly.id as string })) : [])
    : (chosen ? [chosen] : subjects).map(s => ({ key: s.id as string, date, label: s.name as string, credentials: (s.credentials ?? '') as string, subject: s.id as string }))
  const from = firstInstantOfHostDate(first, zone)!.toISOString(), to = firstInstantOfHostDate(datePlus(first, days), zone)!.toISOString()
  const appointments = await rows(db, `SELECT a.id,a.client_id,a.practitioner_id,a.service_id,a.room_id,a.equipment_id,a.series_id,a.start_at,a.end_at,a.status,a.patient_response,a.patient_response_at,a.booked_via,a.version,a.offer_id,
    c.first_name||' '||c.last_name AS client,p.name AS practitioner,s.name AS service,r.name AS room,e.name AS equipment,COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='visit' AND record_id=a.id),'') AS episode_id,(SELECT 1 FROM bm_intake_responses i WHERE i.appointment_id=a.id) AS intake_received,(SELECT 1 FROM bm_intake_responses o WHERE o.client_id=a.client_id) AS intake_on_file,
    (SELECT CASE WHEN MIN(n.signed_at IS NOT NULL)=1 THEN 'signed' WHEN COUNT(*)>0 THEN 'unsigned' END FROM bm_notes n WHERE n.appointment_id=a.id) AS note_status,
    (SELECT pc.status||'|'||COALESCE(pc.certified_at,pc.sent_at)||'|'||pc.physician_name FROM bm_plans_of_care pc WHERE pc.client_id=a.client_id ORDER BY pc.created_at DESC LIMIT 1) AS plan_of_care,${coverage}
    FROM bm_appointments a JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id LEFT JOIN bm_rooms r ON r.id=a.room_id LEFT JOIN bm_equipment e ON e.id=a.equipment_id
    WHERE a.start_at<? AND a.end_at>? AND (? OR a.practitioner_id=?) ORDER BY a.start_at`, to, from, desk ? 1 : 0, own ?? '')
  const hours = await rows(db, 'SELECT practitioner_id,weekday,start_minute,end_minute FROM bm_hours')
  let selected: Data | null = null
  if (params.appt) {
    const row = await visibleAppointment(db, who, params.appt).catch(() => null)
    if (row) {
      const detail = await one(db, `SELECT a.*,COALESCE((SELECT episode_id FROM bm_episode_records WHERE record_kind='visit' AND record_id=a.id),'') AS episode_id,c.first_name||' '||c.last_name AS client,c.date_of_birth,${coverage},(SELECT CASE WHEN MIN(n.signed_at IS NOT NULL)=1 THEN 'signed' WHEN COUNT(*)>0 THEN 'unsigned' END FROM bm_notes n WHERE n.appointment_id=a.id) AS note_status,(SELECT pc.status||'|'||COALESCE(pc.certified_at,pc.sent_at)||'|'||pc.physician_name FROM bm_plans_of_care pc WHERE pc.client_id=a.client_id ORDER BY pc.created_at DESC LIMIT 1) AS plan_of_care,p.name AS practitioner,s.name AS service,r.name AS room,e.name AS equipment FROM bm_appointments a
        JOIN bm_clients c ON c.id=a.client_id JOIN bm_staff p ON p.id=a.practitioner_id JOIN bm_services s ON s.id=a.service_id LEFT JOIN bm_rooms r ON r.id=a.room_id LEFT JOIN bm_equipment e ON e.id=a.equipment_id WHERE a.id=?`, row.id)
      const series = row.series_id ? await one(db, `SELECT COUNT(*) AS total,SUM(start_at<=?) AS position,SUM(status='booked' AND start_at>=?) AS remaining,SUM(status='booked') AS booked,
        (SELECT skipped FROM bm_series WHERE id=?) AS skipped FROM bm_appointments WHERE series_id=?`, row.start_at, row.start_at, row.series_id, row.series_id) : null
      const history = await rows(db, "SELECT at,actor_email,actor_role,action,detail FROM bm_audit WHERE subject_id=? AND action LIKE 'appointment.%' ORDER BY sequence", row.id)
      selected = { ...detail, cancellation: await one(db, 'SELECT * FROM bm_visit_cancellations WHERE appointment_id=?', row.id), history, series: series ? { ...series, skipped: JSON.parse(series.skipped as string) } : null }
    }
  }
  const patientAlerts = await alertsForClients(db, who, [...appointments.map(a => String(a.client_id)), ...(selected ? [String(selected.client_id)] : [])])
  for (const appointment of appointments) appointment.alerts = patientAlerts[appointment.client_id] ?? []
  await addVisitFlags(db, who, zone, [...appointments, ...(selected ? [selected] : [])])
  if (selected) selected.alerts = patientAlerts[selected.client_id] ?? []
  return { zone, today, date, view, by, subject: (view === 'week' ? weekly?.id : chosen?.id) ?? null, dates, columns, appointments, hours, practitioners, rooms, equipment, subjects, selected,
    previous: datePlus(date, -days), next: datePlus(date, days),
    newSlot: /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(params.new ?? '') ? params.new : null, col: subjects.some(x => x.id === params.col) ? params.col : null,
    offered: /^\d{1,3}$/.test(params.offered ?? '') ? Number(params.offered) : 0 }
}
