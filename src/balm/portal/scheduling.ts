import {guardianActor} from './guardians'
import type { Bindings } from '../../auth.server'
import { audit, commit, insist, one, rows, type Data } from '../domain/model'
import { bookOwnAppointment } from '../scheduling/patient-booking'
import { cancelOwnAppointment } from '../scheduling/patient-cancellation'
import { eligiblePatientSlots, moveOwnAppointment } from '../scheduling/patient'
import { getVisitPolicy } from '../scheduling/policy'
import { patientBookedNotice, patientChangedNotice } from '../scheduling/patient-effects'
import { patientActor, portalGuard, type Patient } from './auth'

export async function portalSchedule(env: Bindings, patient: Patient, input: Data, appointmentId?: string) {
  const db = env.DB
  const [clinic, services, practitioners] = await Promise.all([
    one(db, 'SELECT clinic_name,time_zone FROM bm_settings WHERE id=1'),
    rows(db, 'SELECT id,name,duration_minutes,price_cents FROM bm_services WHERE active=1 AND self_book_enabled=1 ORDER BY name'),
    rows(db, `SELECT id,name,profession FROM bm_staff WHERE role='practitioner' AND active=1 AND erased_at IS NULL ORDER BY name`),
  ])
  let moving: Data | undefined
  const params = { roomId:String(input.roomId??''), serviceId: String(input.serviceId ?? ''), practitionerId: String(input.practitionerId ?? ''), from: String(input.from ?? '') }
  if (appointmentId) {
    moving = await one(db, `SELECT a.*,s.name AS service,p.name AS practitioner FROM bm_appointments a JOIN bm_services s ON s.id=a.service_id JOIN bm_staff p ON p.id=a.practitioner_id
      WHERE a.id=? AND a.client_id=? AND a.status='booked'`, appointmentId, patient.clientId) ?? undefined
    insist(moving, 'appointment_not_found', 404)
    const policy = await getVisitPolicy(db)
    insist(Date.parse(moving.start_at) >= Date.now() + policy.noticeHours * 3600_000, 'contact_clinic_inside_cancellation_notice', 409)
    params.serviceId = moving.service_id; params.practitionerId = moving.practitioner_id
  }
  const available = params.serviceId && params.practitionerId ? await eligiblePatientSlots(db, patient.clientId, params, moving?.id) : null
  if (available && moving) {
    const policy = await getVisitPolicy(db)
    available.slots = available.slots.filter(s => Date.parse(s.startAt) >= Date.now() + policy.noticeHours * 3600_000)
  }
  await commit(db, null, [portalGuard(db, patient), audit(db, guardianActor(patient), 'portal.scheduling_opened', patient.clientId, moving?.id ?? null)])
  const rooms=await rows(db,'SELECT r.id,r.name,l.name AS location FROM bm_rooms r JOIN bm_room_locations x ON x.room_id=r.id JOIN bm_locations l ON l.id=x.location_id WHERE r.active=1 AND l.active=1 ORDER BY l.name,r.name')
  return { rooms, clinic, patient: { firstName: patient.firstName, lastName: patient.lastName }, services, practitioners, params, moving, slots: available }
}
export async function portalAppointmentAction(env: Bindings, patient: Patient, name: string, input: Data) {
  const db = env.DB, authority = [portalGuard(db, patient)]
  if (name === 'appointment.book') {
    const booked = await bookOwnAppointment(db, patient.clientId, input, authority, patientActor)
    await patientBookedNotice(env, booked)
    return { redirect: '/portal/home?scheduled=1#visits' }
  }
  if (name === 'appointment.move') {
    const moved = await moveOwnAppointment(db, patient.clientId, input, authority, patientActor)
    await patientChangedNotice(env, moved.id, 'moved')
    return { redirect: '/portal/home?rescheduled=1#visits' }
  }
  const cancelled = await cancelOwnAppointment(db, patient.clientId, input, authority, patientActor)
  await patientChangedNotice(env, cancelled.id, 'cancelled')
  return { redirect: '/portal/home?cancelled=1#visits' }
}
