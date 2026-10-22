import { hostDateAt } from '../availability/timezone'
import { addBusinessDays, businessDistance } from './estimate-days'
import { audit, id, insist, now, stmt, type Data } from '../domain/model'

/** Omitted legacy API answers remain unknown; coverage is never inferred from a missing policy. */
export function bookingCoverage(input: Data) {
 const coverageChoice = input.coverageChoice ?? 'unknown'
 insist(['unknown','insured_claim','uninsured','self_pay'].includes(coverageChoice), 'record_the_patients_coverage_choice')
 const deliveryMethod = input.deliveryMethod ?? ''
 insist(!['uninsured','self_pay'].includes(coverageChoice) || ['portal','paper'].includes(deliveryMethod), 'record_the_requested_estimate_delivery_method')
 return { coverageChoice, deliveryMethod }
}
export function estimateDue(bookedOn:string,startOn:string|null) {
 return addBusinessDays(bookedOn,startOn===null?3:businessDistance(bookedOn,startOn)>=10?3:businessDistance(bookedOn,startOn)>=3?1:0)
}
/** A request and its booking either both commit or neither does. */
export function bookingEstimate(db:D1Database,who:{email:string;role:string},visit:Data,at=now()) {
 if(!['uninsured','self_pay'].includes(visit.coverageChoice))return []
 insist(visit.timeZone,'clinic_time_zone_required')
 const key=id(),booked=hostDateAt(new Date(at),visit.timeZone),start=hostDateAt(new Date(visit.startAt),visit.timeZone)
 return [stmt(db,'INSERT INTO bm_estimate_requests(id,client_id,appointment_id,coverage_kind,coverage_attestation,requested_at,due_on,created_by,delivery_method) VALUES(?,?,?,?,?,?,?,?,?)',key,visit.clientId,visit.id,visit.coverageChoice,'Patient coverage choice recorded at scheduling',at,estimateDue(booked,start),who.email,visit.deliveryMethod),audit(db,who,'estimate.requested',visit.clientId,key,'Explicit scheduling coverage choice')]
}
