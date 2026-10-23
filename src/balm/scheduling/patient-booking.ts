import { hostDateAt } from '../availability/timezone'
import { serviceContext } from './service-rules'
import { appointmentStatements, intakeToken, openSlots, patientPlacement } from '../domain/booking'
import { commit, id, insist, sha256, text, type Data } from '../domain/model'
import { checkSelfService } from './self-service-policy'

/** A portal session supplies its own live patient authority; it is checked in the booking batch. */
export async function bookOwnAppointment(db: D1Database, clientId: string, input: Data, authority: D1PreparedStatement[], who = { email: 'Patient via portal', role: 'patient' }) {
  insist(authority.length > 0, 'patient_authority_required', 403)
  const eligible = await checkSelfService(db, {
    clientId, practitionerId: text(input.practitionerId, 'practitioner', 100), serviceId: text(input.serviceId, 'service', 100), startAt: input.start,
  })
  const startAt = eligible.startAt
  const {zone}=await serviceContext(db,eligible.service.id,eligible.practitioner.id,input.roomId)
  const available = await openSlots(db, { practitionerId: eligible.practitioner.id, serviceId: eligible.service.id, roomId:input.roomId, from: hostDateAt(new Date(startAt),zone) })
  insist(available.slots.some(s => s.startAt === startAt), 'slot_unavailable', 409)
  const placement = await patientPlacement(db, {
    id: '', room_id:input.roomId, practitioner_id: eligible.practitioner.id, service_id: eligible.service.id, start_at: startAt,
    end_at: new Date(Date.parse(startAt) + eligible.service.duration_minutes * 60_000).toISOString(),
  }, { start: startAt })
  const appointmentId = id(), token = intakeToken()
  await commit(db, null, [
    ...authority, ...eligible.guards,
    ...await appointmentStatements(db, who, { id: appointmentId, clientId, practitionerId: eligible.practitioner.id, serviceId: eligible.service.id,
      ...placement, roomId:input.roomId, bookedVia: 'online', tokenHash: await sha256(token) }),
  ])
  return { appointmentId, clientId, token, startAt: placement.startAt }
}
