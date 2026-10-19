// All booking doors allocate intake in the appointment transaction. The stored
// hash decides who sends the new link, including bookings racing for one patient.
import { now, one, stmt } from './model'

const currentResponse = `EXISTS(SELECT 1 FROM bm_intake_responses WHERE client_id=? AND form_id=(SELECT id FROM bm_intake_forms ORDER BY number DESC LIMIT 1))`
const openRequest = `EXISTS(SELECT 1 FROM bm_appointments a WHERE a.client_id=? AND a.status='booked' AND a.end_at>? AND a.intake_token_hash IS NOT NULL
  AND a.id NOT IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM bm_intake_responses r WHERE r.appointment_id=a.id))`
export type IntakeRequest = 'ask' | 'past' | 'on_file' | 'link_open'

export async function intakeAsk(db: D1Database, clientId: string, startAt: string, booked: string[]): Promise<IntakeRequest> {
  if (Date.parse(startAt) <= Date.now()) return 'past'
  if (await one(db, `SELECT 1 WHERE ${currentResponse}`, clientId)) return 'on_file'
  return await one(db, `SELECT 1 WHERE ${openRequest}`, clientId, now(), JSON.stringify(booked)) ? 'link_open' : 'ask'
}

/** Called after insertion, in that same batch; only one live request survives. */
export function allocateIntake(db: D1Database, appointmentId: string, clientId: string, startAt: string, hash: string) {
  const at = now()
  return stmt(db, `UPDATE bm_appointments SET intake_token_hash=CASE WHEN ?>? AND NOT ${currentResponse} AND NOT ${openRequest} THEN ? ELSE NULL END WHERE id=?`,
    startAt, at, clientId, clientId, at, JSON.stringify([appointmentId]), hash, appointmentId)
}

export async function bookedIntake(db: D1Database, clientId: string, appointmentId: string, startAt: string, booked: string[]): Promise<IntakeRequest> {
  if ((await one(db, 'SELECT intake_token_hash FROM bm_appointments WHERE id=?', appointmentId))?.intake_token_hash) return 'ask'
  return intakeAsk(db, clientId, startAt, booked)
}
